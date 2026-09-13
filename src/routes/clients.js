const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const crypto  = require('crypto');
const {authMiddleware, isAdmin } = require('../middleware/auth');
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

// ── Helper: normalizar CUIT para comparar (sin guiones ni espacios) ───────
// "30-54570591-1" y "30545705911" son el mismo CUIT — comparar tal cual
// como string ya alcanza en el 99% de los casos reales, pero esto evita
// falsos negativos por formato.
function normCuit(cuit) {
  const d = cuit ? String(cuit).replace(/[^0-9]/g, '') : '';
  // Un CUIT de verdad tiene 11 dígitos. Hay clientes con "-", un espacio o
  // basura en el campo: si esos quedaran en cadena vacía matchearían todos
  // contra todos y se fusionarían clientes que no tienen nada que ver.
  return d.length >= 10 ? d : null;
}

// ── Helper: fila cruda (array de columnas) → objeto cliente ───────────────
// Layout real de Flexxus: Código;Razón Social;C.U.I.T.;Dirección;Teléfono;
// Localidad;Provincia;Zona;Vendedor;Tipo Actividad;Mail;Código Postal
// El código se usa tal cual viene (sin sacar ceros): Flexxus no es
// consistente con el padding, y normalizar puede mezclar códigos de
// clientes distintos (ej: "0886" y "00886" son clientes diferentes).
function rowToClient(r) {
  const rawMails = String(r[10] || '').trim();
  const mails = rawMails
    ? rawMails.split(/[,;]/).map(m => m.trim().toLowerCase()).filter(Boolean)
    : [];
  const primaryEmail = mails[0] || null;

  return {
    code:        String(r[0] || '').trim(),
    name:        String(r[1] || '').trim(),
    cuit:        r[2] ? String(r[2]).trim() : null,
    address:     r[3] ? String(r[3]).trim() : null,
    phone:       cleanPhone(r[4]),
    city:        r[5] ? String(r[5]).trim() : null,
    province:    r[6] ? String(r[6]).trim() : null,
    zone:        r[7] ? String(r[7]).trim() : null,
    vendorName:  r[8] ? String(r[8]).trim() : null, // solo para matching
    activity:    r[9] ? String(r[9]).trim() : null,
    email:       primaryEmail,
    emailDomain: emailDomain(primaryEmail),
    postalCode:  r[11] !== undefined && r[11] !== '' ? String(r[11]).trim() : null,
    allMails:    mails, // para insertar en ClientEmail
  };
}

// ── Helper: parsear CSV crudo de Flexxus (Latin-1, ";", campos ="valor") ──
function parseFlexxusCSV(buffer) {
  const text  = buffer.toString('latin1');
  const lines = text.split(/\r\n/).filter(l => l.trim().length > 0);
  return lines.slice(1) // fila 0 = headers, sin fila vacía
    .map(line => line.split(';').map(f => {
      let v = f.trim();
      if (v.startsWith('="') && v.endsWith('"')) v = v.slice(2, -1);
      return v.trim();
    }))
    .filter(r => r[0] && r[1]) // necesita código y razón social
    .map(rowToClient);
}

// ── Helper: parsear XLS/XLSX de Flexxus (mismo layout, sin fila vacía) ────
function parseFlexxusXLS(buffer) {
  const wb   = XLSX.read(buffer, { type: 'buffer' });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  return rows.slice(1) // fila 0 = headers, sin fila vacía
    .filter(r => r[0] && r[1])
    .map(rowToClient);
}

// ── Helper: parsear archivo de clientes (detecta CSV vs Excel) ────────────
function parseClientsFile(buffer, originalname) {
  const ext = (originalname || '').split('.').pop().toLowerCase();
  return ext === 'csv' ? parseFlexxusCSV(buffer) : parseFlexxusXLS(buffer);
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
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
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

// GET /api/clients/legacy-seller-groups — grupos de clientes con vendedor legacy sin asignar (ANTES de /:id)
router.get('/legacy-seller-groups', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const groups = await prisma.client.groupBy({
      by: ['legacySellerName'],
      where: { legacySellerName: { not: null }, active: true },
      _count: { id: true },
    });
    res.json(groups
      .map(g => ({ legacySellerName: g.legacySellerName, count: g._count.id }))
      .sort((a, b) => b.count - a.count));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/delete-all-preview — cuántos se borran, cuántos tienen historial (ANTES de /:id)
router.get('/delete-all-preview', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const total = await prisma.client.count();
    const withHistory = await prisma.client.findMany({
      where: { OR: [{ quotes: { some: {} } }, { orders: { some: {} } }] },
      select: { id: true, name: true, code: true, _count: { select: { quotes: true, orders: true } } },
    });
    res.json({
      total,
      deletableCount: total - withHistory.length,
      protectedClients: withHistory.map(c => ({
        id: c.id, name: c.name, code: c.code,
        quotesCount: c._count.quotes, ordersCount: c._count.orders,
      })),
    });
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
        quotes: {
          select: {
            id: true, code: true, stage: true, amount: true, currency: true, mailType: true,
            flexxusCode: true, linkedQuoteId: true, createdAt: true, updatedAt: true,
            seller: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' }, take: 50,
        },
        orders: {
          select: {
            id: true, code: true, stage: true, flexxusCode: true,
            createdAt: true, updatedAt: true,
            seller: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' }, take: 20,
        },
      },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    // Timeline: actividades de todas las cotizaciones y órdenes de este cliente
    const quoteIds = client.quotes.map(q => q.id);
    const orderIds = client.orders.map(o => o.id);
    const activities = await prisma.activity.findMany({
      where: {
        OR: [
          ...(quoteIds.length ? [{ quoteId: { in: quoteIds } }] : []),
          ...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
      select: {
        id: true, action: true, detail: true, createdAt: true,
        quote: { select: { code: true } },
        order: { select: { code: true } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ ...client, activities });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, cuit, email, phone, address, city, province,
            zone, activity, defaultSellerId, postalCode } = req.body;

    // Frenar el duplicado más común: ya existe un cliente con este CUIT
    // (cargado a mano antes o traído por Flexxus) — no crear otro, avisar
    // cuál es el que ya está. Esto es lo que pasó en MYS-0020: se creaba a
    // mano sin buscar primero, y después el import de Flexxus lo duplicaba.
    const nc = normCuit(cuit);
    if (nc) {
      const existentes = await prisma.client.findMany({
        where: { cuit: { not: null } },
        select: { id: true, code: true, name: true, cuit: true },
      });
      const dup = existentes.find(c => normCuit(c.cuit) === nc);
      if (dup) {
        return res.status(409).json({
          error: `Ya existe un cliente con ese CUIT: ${dup.name} (código ${dup.code}). Buscalo en vez de crear uno nuevo.`,
          existingClient: dup,
        });
      }
    }

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

    const emailDomain = email ? email.split('@')[1] || null : null;

    let sellerId = defaultSellerId || null;
    if (sellerId) {
      const seller = await prisma.user.findUnique({ where: { id: sellerId } });
      if (!seller) sellerId = null;
    }

    const client = await prisma.client.create({
      data: {
        code, name, cuit: cuit||null, email: email||null,
        emailDomain, phone: phone||null, address: address||null,
        city: city||null, province: province||null, zone: zone||null,
        activity: activity||null, defaultSellerId: sellerId,
        postalCode: postalCode||null,
      },
    });
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

    const nc = normCuit(cuit);
    if (nc) {
      const existentes = await prisma.client.findMany({
        where: { cuit: { not: null }, id: { not: req.params.id } },
        select: { id: true, code: true, name: true, cuit: true },
      });
      const dup = existentes.find(c => normCuit(c.cuit) === nc);
      if (dup) {
        return res.status(409).json({
          error: `Ese CUIT ya lo tiene otro cliente: ${dup.name} (código ${dup.code}).`,
          existingClient: dup,
        });
      }
    }

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
        legacySellerName: sellerId ? null : undefined,
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
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });

  // Caso especial: eliminar TODOS los clientes sin historial
  if (req.params.id === 'all') {
    const forceHistory = !!(req.body && req.body.forceHistory);
    try {
      const conHistorial = await prisma.client.findMany({
        where: { OR: [{ quotes: { some: {} } }, { orders: { some: {} } }] },
        select: { id: true, name: true, code: true, _count: { select: { quotes: true, orders: true } } },
      });
      const protectedIds = conHistorial.map(c => c.id);

      // Borrar siempre los que no tienen historial
      let deletedSafe = 0;
      if (protectedIds.length > 0) {
        await prisma.clientEmail.deleteMany({ where: { clientId: { notIn: protectedIds } } });
        const safeResult = await prisma.client.deleteMany({ where: { id: { notIn: protectedIds } } });
        deletedSafe = safeResult.count;
      } else {
        await prisma.clientEmail.deleteMany({});
        const safeResult = await prisma.client.deleteMany({});
        deletedSafe = safeResult.count;
      }

      // Forzar borrado de los que tienen historial (cotizaciones/órdenes/adjuntos en cascada)
      let deletedForced = 0;
      if (forceHistory && protectedIds.length > 0) {
        console.log(`[AUDIT] Usuario ${req.user.email} (${req.user.id}) forzó el borrado de ${protectedIds.length} cliente(s) CON historial el ${new Date().toISOString()}: ${conHistorial.map(c => `${c.code} ${c.name} (${c._count.quotes} cot., ${c._count.orders} ord.)`).join(' | ')}`);

        const quoteIds = (await prisma.quote.findMany({ where: { clientId: { in: protectedIds } }, select: { id: true } })).map(q => q.id);

        // Romper vínculos que apuntan a estas cotizaciones antes de borrar (linkedQuote, fromQuote)
        if (quoteIds.length > 0) {
          await prisma.quote.updateMany({ where: { linkedQuoteId: { in: quoteIds } }, data: { linkedQuoteId: null } });
          await prisma.order.updateMany({ where: { fromQuoteId: { in: quoteIds } }, data: { fromQuoteId: null } });
        }

        await prisma.order.deleteMany({ where: { clientId: { in: protectedIds } } });
        await prisma.quote.deleteMany({ where: { clientId: { in: protectedIds } } });
        await prisma.clientEmail.deleteMany({ where: { clientId: { in: protectedIds } } });
        const forcedResult = await prisma.client.deleteMany({ where: { id: { in: protectedIds } } });
        deletedForced = forcedResult.count;
      }

      const finalTotal = await prisma.client.count();
      return res.json({
        ok: true,
        deleted: deletedSafe + deletedForced,
        skipped: forceHistory ? 0 : protectedIds.length,
        forcedDeleted: deletedForced,
        remaining: finalTotal,
      });
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
    // Validar que el email pertenezca al cliente de la URL (previene IDOR)
    const record = await prisma.clientEmail.findUnique({ where: { id: req.params.emailId } });
    if (!record) return res.status(404).json({ error: 'Email no encontrado' });
    if (record.clientId !== req.params.id) return res.status(403).json({ error: 'El email no pertenece a este cliente' });
    await prisma.clientEmail.delete({ where: { id: req.params.emailId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar email' });
  }
});

// POST /api/clients/preview — subir XLS, comparar con DB, devolver diff
router.post('/preview', authMiddleware, upload.single('file'), async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    // 1. Parsear archivo (CSV o Excel, detecta por extensión)
    const incoming = parseClientsFile(req.file.buffer, req.file.originalname);
    if (!incoming.length) return res.status(400).json({ error: 'No se encontraron clientes en el archivo. Verificá el formato.' });

    const incomingMap = new Map(incoming.map(c => [c.code, c]));

    // 2. Traer todos los clientes actuales de la DB
    const existing = await prisma.client.findMany({
      select: { code: true, name: true, cuit: true, city: true, province: true, zone: true, phone: true, email: true, address: true, postalCode: true, activity: true },
    });
    const existingMap = new Map(existing.map(c => [c.code, c]));
    // Por CUIT, solo entre los cargados a mano (CLI-NNN) — es el caso real:
    // alguien lo cargó manual y Flexxus lo trae después con su código propio.
    // No se cruza contra clientes ya numerados por Flexxus para no pisar
    // casos legítimos de un mismo CUIT en varios códigos (ej. depósitos).
    const manualesPorCuit = new Map(
      existing.filter(c => c.code.startsWith('CLI-') && normCuit(c.cuit))
              .map(c => [normCuit(c.cuit), c])
    );

    // 3. Traer usuarios activos para matching de vendedor
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true },
    });

    // 4. Intentar matchear vendedores por nombre (case-insensitive, parcial)
    const vendorMatchCache = new Map();
    const unmatchedCounts = new Map(); // vendorName -> count
    const matchedCounts   = new Map(); // vendorName -> { sellerId, sellerName, count }

    function matchVendor(vendorName) {
      if (!vendorName) return null;
      if (!vendorMatchCache.has(vendorName)) {
        const lower = vendorName.toLowerCase();
        const found = users.find(u => {
          const parts = u.name.toLowerCase().split(' ');
          return parts.some(p => p.length > 3 && lower.includes(p));
        }) || null;
        vendorMatchCache.set(vendorName, found);
      }
      const found = vendorMatchCache.get(vendorName);
      if (found) {
        const cur = matchedCounts.get(vendorName) || { sellerId: found.id, sellerName: found.name, count: 0 };
        cur.count++;
        matchedCounts.set(vendorName, cur);
      } else {
        unmatchedCounts.set(vendorName, (unmatchedCounts.get(vendorName) || 0) + 1);
      }
      return found?.id || null;
    }

    // 5. Clasificar
    const toAdd     = [];
    const toUpdate  = [];
    const toRecode  = []; // ya existe cargado a mano con otro código — fusionar, no duplicar
    const unchanged = [];
    const toRemove  = [];

    for (const [code, row] of incomingMap) {
      const ex = existingMap.get(code);
      if (!ex) {
        const ncRow  = normCuit(row.cuit);
        const manual = ncRow ? manualesPorCuit.get(ncRow) : null;
        if (manual) {
          toRecode.push({ ...row, _oldCode: manual.code, _oldName: manual.name });
        } else {
          toAdd.push(row);
        }
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
    const previewRecode = toRecode.slice(0, 20).map(r => ({
      code: r.code, name: r.name, _oldCode: r._oldCode, _oldName: r._oldName,
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
        toRecode:  toRecode.length,
        toUpdate:  toUpdate.length,
        unchanged: unchanged.length,
        toRemove:  toRemove.length,
      },
      toAdd:    previewAdd,
      toRecode: previewRecode,
      toUpdate: previewUpdate,
      toRemove: toRemove.map(c => ({ code: c.code, name: c.name, city: c.city })),
      unmatchedVendors: [...unmatchedCounts.keys()], // compatibilidad hacia atrás
      matchedVendors:   [...matchedCounts.entries()].map(([vendorName, v]) => ({ vendorName, ...v })),
      unmatchedVendorCounts: [...unmatchedCounts.entries()].map(([vendorName, count]) => ({ vendorName, count })),
    });
  } catch (err) {
    console.error('clients/preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/sync — aplicar cambios confirmados
router.post('/sync', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
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

    // Clientes cargados a mano (CLI-NNN) que ya existen ahora mismo, por CUIT.
    // Se recalcula acá (no se usa lo del preview) porque puede haber pasado
    // tiempo entre preview y confirmar, y los códigos existentes de verdad
    // importan para no duplicar.
    const codigosExistentes = new Set(
      (await prisma.client.findMany({ select: { code: true } })).map(c => c.code)
    );
    const manualesPorCuit = new Map(
      (await prisma.client.findMany({
        where: { code: { startsWith: 'CLI-' }, cuit: { not: null } },
      })).filter(c => normCuit(c.cuit)).map(c => [normCuit(c.cuit), c])
    );

    let upserted = 0;
    let recoded  = 0;
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
          legacySellerName: defaultSellerId ? null : (r.vendorName || null),
        };

        let client;
        const ncRow  = normCuit(r.cuit);
        const fusion = !codigosExistentes.has(r.code) && ncRow
          ? manualesPorCuit.get(ncRow) : null;

        if (fusion) {
          // Ya estaba cargado a mano con este mismo CUIT bajo otro código:
          // fusionar (pisarle el código, no crear uno nuevo) para no duplicar
          // el cliente ni partir su historial de cotizaciones/órdenes.
          // Flexxus manda el dato bueno, pero si viene vacío no se pisa lo que
          // el vendedor cargó a mano — en la fusión no se pierde nada. Es la
          // misma regla que usa scripts/migrar-clientes-duplicados.js.
          const fusionData = { ...data };
          for (const k of ['address','city','province','zone','postalCode','phone','email','emailDomain','activity','defaultSellerId']) {
            if (fusionData[k] == null) fusionData[k] = fusion[k];
          }
          client = await prisma.client.update({ where: { id: fusion.id }, data: { code: r.code, ...fusionData } });
          manualesPorCuit.delete(ncRow);
          codigosExistentes.add(r.code);
          recoded++;
        } else {
          client = await prisma.client.upsert({
            where:  { code: r.code },
            update: data,
            create: { code: r.code, ...data, active: true },
          });
        }

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

    res.json({ ok: true, upserted, recoded, deleted, skipped });
  } catch (err) {
    console.error('clients/sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/bulk-assign-seller — asigna un vendedor real a todo un grupo legacy
router.post('/bulk-assign-seller', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  try {
    const { legacySellerName, sellerId } = req.body;
    if (!legacySellerName || !sellerId) return res.status(400).json({ error: 'legacySellerName y sellerId son requeridos' });

    const seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller) return res.status(404).json({ error: 'Vendedor no encontrado' });

    const result = await prisma.client.updateMany({
      where: { legacySellerName },
      data: { defaultSellerId: sellerId, legacySellerName: null },
    });

    res.json({ ok: true, updated: result.count, sellerName: seller.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
