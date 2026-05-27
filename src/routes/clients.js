const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const crypto  = require('crypto');
const { authMiddleware } = require('../middleware/auth');
const prisma = require('../db');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Cache en memoria para preview pendiente
const previewCache = new Map(); // token → { rows, expiresAt }

// ── Helper: limpiar teléfono ───────────────────────────────────────────────
function cleanPhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Patrones vacíos: "-", "(-) -", "( -) -", "(-)  -", etc.
  if (/^[\s\-\(\)\s]*$/.test(s) || s === '') return null;
  return s;
}

// ── Helper: extraer dominio de un email ───────────────────────────────────
function emailDomain(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

// ── Helper: parsear XLS de clientes ───────────────────────────────────────
function parseClientsXLS(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Fila 0: headers, Fila 1: vacía, Fila 2+: datos
  return rows.slice(2)
    .filter(r => r[0] && r[1]) // necesita código y razón social
    .map(r => {
      const rawMails = String(r[11] || '').trim();
      const mails = rawMails
        ? rawMails.split(/[,;]/).map(m => m.trim().toLowerCase()).filter(Boolean)
        : [];
      const primaryEmail = mails[0] || null;

      return {
        code:        String(r[0]).trim(),
        name:        String(r[1]).trim(),
        cuit:        r[2]  ? String(r[2]).trim()  : null,
        address:     r[3]  ? String(r[3]).trim()  : null,
        phone:       cleanPhone(r[4]),
        city:        r[6]  ? String(r[6]).trim()  : null,
        province:    r[7]  ? String(r[7]).trim()  : null,
        zone:        r[8]  ? String(r[8]).trim()  : null,
        vendorName:  r[9]  ? String(r[9]).trim()  : null, // solo para matching
        activity:    r[10] ? String(r[10]).trim() : null,
        email:       primaryEmail,
        emailDomain: emailDomain(primaryEmail),
        postalCode:  r[12] !== '' ? String(r[12]).trim() : null,
        allMails:    mails, // para insertar en ClientEmail
      };
    });
}

// ── Helper: generar XLS de exportación ────────────────────────────────────
function buildExportXLS(clients) {
  const headers = ['Código','Razón Social','CUIT','Dirección','Teléfono','Localidad','Provincia','Zona','Actividad','Email','Código Postal','Vendedor'];
  const rows = clients.map(c => [
    c.code, c.name, c.cuit||'', c.address||'', c.phone||'',
    c.city||'', c.province||'', c.zone||'', c.activity||'',
    c.email||'', c.postalCode||'',
    c.defaultSeller?.name || '',
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Column widths
  ws['!cols'] = [8,40,18,30,16,20,18,16,20,30,10,20].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// GET /api/clients
router.get('/', authMiddleware, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { active: true },
      include: {
        defaultSeller: { select: { id: true, name: true } },
        emails:        { select: { email: true, isPrimary: true }, orderBy: { isPrimary: 'desc' }, take: 3 },
      },
      orderBy: { name: 'asc' },
    });
    // Agregar campo emailPrimary: email directo o primer ClientEmail
    const enriched = clients.map(c => ({
      ...c,
      emailPrimary: c.email || c.emails?.[0]?.email || null,
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});


// GET /api/clients/export — descargar XLS con todos los clientes (ANTES de /:id)
router.get('/export', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: 'asc' },
      include: { defaultSeller: { select: { name: true } } },
    });
    const buf = buildExportXLS(clients);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="clientes-${date}.xlsx"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        defaultSeller: { select: { id: true, name: true } },
        quotes: { select: { code: true, stage: true, amount: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
        orders: { select: { code: true, stage: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients
router.post('/', authMiddleware, async (req, res) => {
  try {
    // Solo considerar códigos CLI-NNN para el autoincremental (ignora códigos importados del XLS)
    const allCli = await prisma.client.findMany({
      where: { code: { startsWith: 'CLI-' } },
      select: { code: true },
    });
    const maxNum = allCli.reduce((m, c) => {
      const n = parseInt(c.code.split('-')[1]);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const code = `CLI-${String(maxNum + 1).padStart(3, '0')}`;

    const domain = req.body.email ? req.body.email.split('@')[1] || null : null;

    const data = { code, ...req.body, emailDomain: domain };

    if (data.defaultSellerId) {
      const seller = await prisma.user.findUnique({ where: { id: data.defaultSellerId } });
      if (!seller) data.defaultSellerId = null;
    }

    const client = await prisma.client.create({ data });
    res.status(201).json(client);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: err.message || 'Error al crear cliente' });
  }
});

// PUT /api/clients/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, cuit, email, phone, address, city, province,
            zone, activity, defaultSellerId, postalCode } = req.body;

    const emailDomain = email ? email.split('@')[1] || null : null;

    let sellerId = defaultSellerId || null;
    if (sellerId) {
      const seller = await prisma.user.findUnique({ where: { id: sellerId } });
      if (!seller) sellerId = null;
    }

    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        name, cuit: cuit||null, email: email||null,
        emailDomain, phone: phone||null, address: address||null,
        city: city||null, province: province||null, zone: zone||null,
        activity: activity||null, defaultSellerId: sellerId,
        postalCode: postalCode||null,
      },
      include: { defaultSeller: { select: { id: true, name: true } } },
    });

    res.json(client);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar cliente' });
  }
});

// DELETE /api/clients/:id — eliminar cliente individual o todos (admin only)
router.delete('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });

  // Caso especial: eliminar TODOS los clientes sin historial
  if (req.params.id === 'all') {
    try {
      const conHistorial = await prisma.client.findMany({
        where: { OR: [{ quotes: { some: {} } }, { orders: { some: {} } }] },
        select: { id: true },
      });
      const protectedIds = conHistorial.map(c => c.id);

      if (protectedIds.length > 0) {
        await prisma.clientEmail.deleteMany({ where: { clientId: { notIn: protectedIds } } });
        const result = await prisma.client.deleteMany({ where: { id: { notIn: protectedIds } } });
        return res.json({ ok: true, deleted: result.count, skipped: protectedIds.length });
      } else {
        await prisma.clientEmail.deleteMany({});
        const result = await prisma.client.deleteMany({});
        return res.json({ ok: true, deleted: result.count, skipped: 0 });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Eliminar cliente individual
  try {
    const cli = await prisma.client.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, _count: { select: { quotes: true, orders: true } } },
    });
    if (!cli) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (cli._count.quotes > 0 || cli._count.orders > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: ${cli.name} tiene ${cli._count.quotes} cotización(es) y ${cli._count.orders} orden(es) asociadas.`
      });
    }
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id/emails — lista emails de matcheo
router.get('/:id/emails', authMiddleware, async (req, res) => {
  try {
    const emails = await prisma.clientEmail.findMany({
      where: { clientId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients/:id/emails — agregar email de matcheo
router.post('/:id/emails', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });
    const record = await prisma.clientEmail.upsert({
      where: { email_clientId: { email: email.toLowerCase().trim(), clientId: req.params.id } },
      update: {},
      create: { email: email.toLowerCase().trim(), clientId: req.params.id },
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al agregar email' });
  }
});

// DELETE /api/clients/:id/emails/:emailId — eliminar email de matcheo
router.delete('/:id/emails/:emailId', authMiddleware, async (req, res) => {
  try {
    await prisma.clientEmail.delete({ where: { id: req.params.emailId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar email' });
  }
});

// POST /api/clients/preview — subir XLS, comparar con DB, devolver diff
router.post('/preview', authMiddleware, upload.single('file'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    // 1. Parsear XLS
    const incoming = parseClientsXLS(req.file.buffer);
    if (!incoming.length) return res.status(400).json({ error: 'No se encontraron clientes en el archivo. Verificá el formato.' });

    const incomingMap = new Map(incoming.map(c => [c.code, c]));

    // 2. Traer todos los clientes actuales de la DB
    const existing = await prisma.client.findMany({
      select: { code: true, name: true, cuit: true, city: true, province: true, zone: true, phone: true, email: true, address: true, postalCode: true, activity: true },
    });
    const existingMap = new Map(existing.map(c => [c.code, c]));

    // 3. Traer usuarios activos para matching de vendedor
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });

    // 4. Intentar matchear vendedores por nombre (case-insensitive, parcial)
    const vendorMatchCache = new Map();
    const unmatchedVendors = new Set();

    function matchVendor(vendorName) {
      if (!vendorName) return null;
      if (vendorMatchCache.has(vendorName)) return vendorMatchCache.get(vendorName);
      const lower = vendorName.toLowerCase();
      const found = users.find(u => {
        const parts = u.name.toLowerCase().split(' ');
        return parts.some(p => p.length > 3 && lower.includes(p));
      }) || null;
      if (!found) unmatchedVendors.add(vendorName);
      vendorMatchCache.set(vendorName, found?.id || null);
      return found?.id || null;
    }

    // 5. Clasificar
    const toAdd     = [];
    const toUpdate  = [];
    const unchanged = [];
    const toRemove  = [];

    for (const [code, row] of incomingMap) {
      const ex = existingMap.get(code);
      if (!ex) {
        toAdd.push(row);
      } else {
        const changed =
          ex.name        !== row.name     ||
          (ex.cuit       || null) !== row.cuit     ||
          (ex.city       || null) !== row.city     ||
          (ex.province   || null) !== row.province ||
          (ex.zone       || null) !== row.zone     ||
          (ex.phone      || null) !== row.phone    ||
          (ex.email      || null) !== row.email    ||
          (ex.address    || null) !== row.address  ||
          (ex.postalCode || null) !== row.postalCode ||
          (ex.activity   || null) !== row.activity;
        changed ? toUpdate.push({ ...row, _old: { name: ex.name, city: ex.city, province: ex.province } }) : unchanged.push(code);
      }
    }
    for (const [code, ex] of existingMap) {
      // Ignorar clientes CLI-NNN (creados manualmente) — no son parte del XLS numérico
      if (!incomingMap.has(code) && !code.startsWith('CLI-')) toRemove.push(ex);
    }

    // Pre-calcular defaultSellerId para preview (informativo)
    const previewAdd = toAdd.slice(0, 20).map(r => ({
      code: r.code, name: r.name, city: r.city, province: r.province,
      zone: r.zone, vendorName: r.vendorName,
    }));
    const previewUpdate = toUpdate.slice(0, 20).map(r => ({
      code: r.code, name: r.name, city: r.city, province: r.province,
      _old: r._old, vendorName: r.vendorName,
    }));

    // Pre-run vendor matching to populate unmatchedVendors
    incoming.forEach(r => matchVendor(r.vendorName));

    // 6. Guardar en cache con token
    const token = crypto.randomBytes(16).toString('hex');
    previewCache.set(token, {
      rows:      incoming,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    for (const [k, v] of previewCache) if (v.expiresAt < Date.now()) previewCache.delete(k);

    res.json({
      token,
      summary: {
        total:     incoming.length,
        toAdd:     toAdd.length,
        toUpdate:  toUpdate.length,
        unchanged: unchanged.length,
        toRemove:  toRemove.length,
      },
      toAdd:    previewAdd,
      toUpdate: previewUpdate,
      toRemove: toRemove.map(c => ({ code: c.code, name: c.name, city: c.city })),
      unmatchedVendors: [...unmatchedVendors],
    });
  } catch (err) {
    console.error('clients/preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/sync — aplicar cambios confirmados
router.post('/sync', authMiddleware, async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { token, deleteCodes = [] } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const cached = previewCache.get(token);
    if (!cached || cached.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'El preview expiró. Volvé a subir el archivo.' });
    }

    const { rows } = cached;
    previewCache.delete(token);

    // Cargar usuarios para matching
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });
    const vendorCache = new Map();
    function matchVendor(vendorName) {
      if (!vendorName) return null;
      if (vendorCache.has(vendorName)) return vendorCache.get(vendorName);
      const lower = vendorName.toLowerCase();
      const found = users.find(u => {
        const parts = u.name.toLowerCase().split(' ');
        return parts.some(p => p.length > 3 && lower.includes(p));
      }) || null;
      vendorCache.set(vendorName, found?.id || null);
      return found?.id || null;
    }

    let upserted = 0;
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      await Promise.all(rows.slice(i, i + BATCH).map(async r => {
        const defaultSellerId = matchVendor(r.vendorName);
        const data = {
          name:            r.name,
          cuit:            r.cuit,
          address:         r.address,
          phone:           r.phone,
          city:            r.city,
          province:        r.province,
          zone:            r.zone,
          activity:        r.activity,
          email:           r.email,
          emailDomain:     r.emailDomain,
          postalCode:      r.postalCode,
          defaultSellerId: defaultSellerId,
        };

        const client = await prisma.client.upsert({
          where:  { code: r.code },
          update: data,
          create: { code: r.code, ...data, active: true },
        });

        // Insertar mails adicionales en ClientEmail (upsert, no duplicar)
        if (r.allMails.length > 0) {
          await Promise.all(r.allMails.map((mail, idx) =>
            prisma.clientEmail.upsert({
              where:  { email_clientId: { email: mail, clientId: client.id } },
              update: {},
              create: { email: mail, clientId: client.id, isPrimary: idx === 0 },
            }).catch(() => {}) // ignorar conflictos
          ));
        }
      }));
      upserted += Math.min(BATCH, rows.length - i);
    }

    // Eliminar los confirmados (solo los que no tienen cotizaciones ni órdenes)
    let deleted = 0;
    let skipped = 0;
    if (deleteCodes.length) {
      for (const code of deleteCodes) {
        const cli = await prisma.client.findUnique({ where: { code }, select: { id: true, _count: { select: { quotes: true, orders: true } } } });
        if (!cli) continue;
        if (cli._count.quotes > 0 || cli._count.orders > 0) { skipped++; continue; }
        await prisma.client.delete({ where: { code } });
        deleted++;
      }
    }

    res.json({ ok: true, upserted, deleted, skipped });
  } catch (err) {
    console.error('clients/sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
