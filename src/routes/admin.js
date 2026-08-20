const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authMiddleware, isDeveloper } = require('../middleware/auth');
const { parseFlexxusPDF, isFlexxusPDF, isNotaPedidoPDF, parseNotaPedidoPDF } = require('../services/flexxusParser');
const prisma = require('../db');

const router = express.Router();

// Cache en memoria para preview pendiente de reparseo
const reparsePreviewCache = new Map(); // token → { results, expiresAt }

function requireDeveloper(req, res, next) {
  if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores' });
  next();
}

// GET /api/admin/reparse-candidates — lista todas las cotizaciones Flexxus reparseables
router.get('/reparse-candidates', authMiddleware, requireDeveloper, async (req, res) => {
  try {
    const quotes = await prisma.quote.findMany({
      where: { mailType: { in: ['PRESUPUESTO', 'NOTA_PEDIDO'] } },
      select: {
        id: true, code: true, mailType: true, flexxusCode: true, createdAt: true,
        client: { select: { name: true } },
        _count: { select: { items: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(quotes.map(q => ({
      id: q.id, code: q.code, mailType: q.mailType, flexxusCode: q.flexxusCode,
      createdAt: q.createdAt, clientName: q.client?.name || null,
      itemsCount: q._count.items, attachmentsCount: q._count.attachments,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: encuentra el adjunto que es el PDF real de Flexxus para esta quote (mailType)
async function findFlexxusAttachment(quoteId, mailType) {
  const attachments = await prisma.attachment.findMany({ where: { quoteId } });
  const check = mailType === 'NOTA_PEDIDO' ? isNotaPedidoPDF : isFlexxusPDF;
  return attachments.find(a => check({ filename: a.originalName || a.filename })) || null;
}

// Helper: reparsea una quote puntual. No escribe nada — devuelve el resultado.
async function reparseOne(quote, catalog) {
  const att = await findFlexxusAttachment(quote.id, quote.mailType);
  if (!att) return { id: quote.id, code: quote.code, mailType: quote.mailType, ok: false, items: [], error: 'No se encontró el PDF de Flexxus entre los adjuntos' };
  if (!fs.existsSync(att.path)) return { id: quote.id, code: quote.code, mailType: quote.mailType, ok: false, items: [], error: 'El archivo del adjunto ya no existe en disco' };

  const buffer = fs.readFileSync(att.path);
  const parsed = quote.mailType === 'NOTA_PEDIDO'
    ? await parseNotaPedidoPDF(buffer, { catalog })
    : await parseFlexxusPDF(buffer, { catalog });

  const items = (parsed.items || []).map((item, i) => ({
    sku:         item.sku || null,
    description: (item.description || '').substring(0, 500),
    quantity:    item.quantity || 0,
    unit:        item.unit || null,
    unitPrice:   item.unitPrice || null,
    total:       item.total || null,
    accepted:    item.accepted !== false,
    sortOrder:   i,
  }));
  const sumItems = items.reduce((s, it) => s + (it.total || 0), 0);

  // Matcheo de cliente por CUIT — solo si la quote no tiene cliente ya asignado
  let matchedClient = null;
  if (!quote.clientId && parsed.cuit) {
    matchedClient = await prisma.client.findFirst({ where: { cuit: { equals: parsed.cuit, mode: 'insensitive' } } });
  }

  return {
    id: quote.id, code: quote.code, mailType: quote.mailType, ok: true,
    attachmentName: att.originalName || att.filename,
    cuit: parsed.cuit || null,
    clientNameParsed: parsed.clientName || null,
    currentClientName: quote.client?.name || null,
    matchedClient: matchedClient ? { id: matchedClient.id, name: matchedClient.name } : null,
    oldItemsCount: quote._count.items,
    newItemsCount: items.length,
    subtotalNeto: parsed.subtotalNeto ?? null,
    sumItems: parseFloat(sumItems.toFixed(2)),
    amountsMatch: parsed.subtotalNeto != null && Math.abs(sumItems - parsed.subtotalNeto) <= 0.02,
    currency: parsed.currency || 'USD',
    items,
    _parsed: parsed,
  };
}

// POST /api/admin/reparse-preview — dry-run sobre las quotes elegidas, no escribe nada
router.post('/reparse-preview', authMiddleware, requireDeveloper, async (req, res) => {
  try {
    const { quoteIds } = req.body;
    if (!Array.isArray(quoteIds) || quoteIds.length === 0) {
      return res.status(400).json({ error: 'quoteIds requerido (array no vacío)' });
    }

    const catalog = await prisma.article.findMany({ select: { code: true, description: true } });
    const quotes = await prisma.quote.findMany({
      where: { id: { in: quoteIds } },
      include: { client: { select: { name: true } }, _count: { select: { items: true } } },
    });

    const results = [];
    for (const q of quotes) {
      results.push(await reparseOne(q, catalog));
    }

    const token = crypto.randomBytes(16).toString('hex');
    reparsePreviewCache.set(token, { results, expiresAt: Date.now() + 30 * 60 * 1000 });
    for (const [k, v] of reparsePreviewCache) if (v.expiresAt < Date.now()) reparsePreviewCache.delete(k);

    res.json({
      token,
      results: results.map(({ _parsed, items, ...r }) => ({ ...r, itemsPreview: (items || []).slice(0, 5) })),
    });
  } catch (err) {
    console.error('reparse-preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/reparse-apply — aplica el preview cacheado por token
router.post('/reparse-apply', authMiddleware, requireDeveloper, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    const cached = reparsePreviewCache.get(token);
    if (!cached || cached.expiresAt < Date.now()) {
      return res.status(400).json({ error: 'El preview expiró. Volvé a generarlo.' });
    }
    reparsePreviewCache.delete(token);

    let applied = 0, skipped = 0;
    const applyLog = [];
    for (const r of cached.results) {
      if (!r.ok) { skipped++; continue; }
      const parsed = r._parsed;

      const updateData = {
        subtotalNeto:      parsed.subtotalNeto ?? null,
        ivaAmount:         parsed.ivaAmount ?? null,
        totalPercepciones: parsed.totalPercepciones ?? null,
        amount:            parsed.total ?? null,
      };
      if (r.mailType === 'NOTA_PEDIDO') updateData.currency = r.currency;
      if (r.matchedClient) {
        updateData.clientId = r.matchedClient.id;
        const seller = await prisma.client.findUnique({ where: { id: r.matchedClient.id }, select: { defaultSellerId: true } });
        if (seller?.defaultSellerId) updateData.sellerId = seller.defaultSellerId;
      }

      await prisma.$transaction([
        prisma.quoteItem.deleteMany({ where: { quoteId: r.id } }),
        prisma.quoteItem.createMany({ data: r.items.map(it => ({ ...it, quoteId: r.id })) }),
        prisma.quote.update({ where: { id: r.id }, data: updateData }),
      ]);

      applyLog.push(`${r.code} (${r.oldItemsCount}→${r.newItemsCount} items${r.matchedClient ? `, cliente: ${r.matchedClient.name}` : ''})`);
      applied++;
    }

    console.log(`[AUDIT] Usuario ${req.user.email} (${req.user.id}) reparseó ${applied} cotización(es) el ${new Date().toISOString()}: ${applyLog.join(' | ')}`);

    res.json({ ok: true, applied, skipped });
  } catch (err) {
    console.error('reparse-apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Diagnóstico de storage (Volume de Railway) ──────────────────────────────
// Solo lectura: recorre las carpetas de uploads y las cruza con la base para
// detectar archivos huérfanos (en disco pero sin registro que los referencie) y
// registros rotos (en la base pero sin archivo en disco). No borra nada.
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

function scanDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .map(name => {
      const full = path.join(dirPath, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) return null;
        return { name, size: st.size, mtime: st.mtime };
      } catch { return null; }
    })
    .filter(Boolean);
}

const sumSize = (files) => files.reduce((s, f) => s + (f.size || 0), 0);
const sampleOf = (files, n = 15) => files
  .slice()
  .sort((a, b) => b.size - a.size)
  .slice(0, n)
  .map(f => ({ name: f.name, size: f.size, mtime: f.mtime }));

// GET /api/admin/storage-report — no escribe nada
router.get('/storage-report', authMiddleware, requireDeveloper, async (req, res) => {
  try {
    const attachmentsDir = path.join(UPLOADS_ROOT, 'attachments');
    const feedbackDir    = path.join(UPLOADS_ROOT, 'feedback');
    const avatarsDir     = path.join(UPLOADS_ROOT, 'avatars');

    const [diskAttachments, diskFeedback, diskAvatars] = [
      scanDir(attachmentsDir), scanDir(feedbackDir), scanDir(avatarsDir),
    ];

    // Referencias vivas en la base
    const dbAttachments = await prisma.attachment.findMany({ select: { filename: true, path: true } });
    const dbPosts       = await prisma.feedbackPost.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } });

    // Match por basename: Attachment.path guarda ruta absoluta (distinta entre
    // local y Railway), así que el nombre de archivo es el criterio confiable.
    const refAttachments = new Set();
    for (const a of dbAttachments) {
      if (a.filename) refAttachments.add(a.filename);
      if (a.path)     refAttachments.add(path.basename(a.path));
    }
    const refFeedback = new Set(
      dbPosts.map(p => { try { return path.basename(p.imageUrl); } catch { return null; } }).filter(Boolean)
    );

    const orphanAttachments = diskAttachments.filter(f => !refAttachments.has(f.name));
    const orphanFeedback    = diskFeedback.filter(f => !refFeedback.has(f.name));
    // Los avatares hoy viven en la base como data-URL (users.js) — la carpeta es legacy
    const orphanAvatars     = diskAvatars;

    // Caso inverso: registros que apuntan a archivos que ya no están
    const diskAttachmentNames = new Set(diskAttachments.map(f => f.name));
    const missingAttachments  = dbAttachments.filter(a => {
      const base = a.filename || (a.path ? path.basename(a.path) : null);
      return base && !diskAttachmentNames.has(base);
    });

    const folder = (label, all, orphans, note) => ({
      label,
      totalFiles: all.length,
      totalBytes: sumSize(all),
      orphanFiles: orphans.length,
      orphanBytes: sumSize(orphans),
      orphanSample: sampleOf(orphans),
      note: note || null,
    });

    const folders = [
      folder('attachments', diskAttachments, orphanAttachments, 'PDFs de cotizaciones, presupuestos y notas de pedido'),
      folder('feedback',    diskFeedback,    orphanFeedback,    'Capturas de pantalla de los reportes del Foro'),
      folder('avatars',     diskAvatars,     orphanAvatars,     'Carpeta legacy — los avatares hoy se guardan en la base, nada lee de acá'),
    ];

    res.json({
      generatedAt: new Date().toISOString(),
      uploadsRoot: UPLOADS_ROOT,
      totalFiles:  folders.reduce((s, f) => s + f.totalFiles, 0),
      totalBytes:  folders.reduce((s, f) => s + f.totalBytes, 0),
      orphanFiles: folders.reduce((s, f) => s + f.orphanFiles, 0),
      orphanBytes: folders.reduce((s, f) => s + f.orphanBytes, 0),
      folders,
      missingFiles: missingAttachments.length,
      missingSample: missingAttachments.slice(0, 15).map(a => a.filename || path.basename(a.path || '')),
    });
  } catch (err) {
    console.error('storage-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
