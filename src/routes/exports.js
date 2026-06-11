/**
 * exports.js — Endpoints para exportación de reportes PDF y envío por mail
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { authMiddleware } = require('../middleware/auth');
const { generateCotizaciones, generateRechazos, generateOrdenes } = require('../services/pdfExporter');
const { sendEmail } = require('../services/mailSender');
const prisma = require('../db');

const router = express.Router();

// ─── Helper: filtros comunes ──────────────────────────────────────────────────

// Excluir solicitudes vinculadas a presupuesto (evita contar doble en paquetes)
const NO_PACKAGE_DUPES = { NOT: { mailType: 'SOLICITUD', linkedQuoteId: { not: null } } };

function buildFilter({ sellerId, from, to } = {}) {
  const filter = {};
  if (sellerId) filter.sellerId = sellerId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.gte = new Date(from);
    if (to)   { const d = new Date(to); d.setHours(23, 59, 59, 999); filter.createdAt.lte = d; }
  }
  return filter;
}

async function getStages(phase) {
  return prisma.stageDefinition.findMany({
    where: { active: true, phase },
    orderBy: { order: 'asc' },
  });
}

async function resolveFilterLabels({ sellerId }) {
  if (!sellerId) return {};
  const user = await prisma.user.findUnique({ where: { id: sellerId }, select: { name: true } });
  return { seller: user?.name || sellerId };
}


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exports/cotizaciones — PDF de cotizaciones
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/cotizaciones', authMiddleware, async (req, res) => {
  try {
    const base = buildFilter(req.query);
    // Excluir OC y NOTA_PEDIDO (igual que el GET /api/quotes)
    const mailTypeFilter = {
      OR: [
        { mailType: null },
        { mailType: { notIn: ['OC', 'NOTA_PEDIDO'] } },
      ],
    };
    const where = { ...mailTypeFilter, ...base };
    if (req.user.role === 'VENDEDOR') {
      where.AND = [
        mailTypeFilter,
        { OR: [{ sellerId: req.user.id }, { sellerId: null, stage: 'recibida' }] },
      ];
      delete where.OR;
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        client: { select: { name: true, code: true } },
        seller: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const stages = await getStages('COTIZACION');
    const filterLabels = await resolveFilterLabels(req.query);
    const filters = { ...filterLabels, from: req.query.from, to: req.query.to };

    const style = req.query.style === 'executive' ? 'executive' : undefined;
    const pdf = await generateCotizaciones(quotes, { filters, stages, style });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cotizaciones_${new Date().toISOString().slice(0,10)}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  } catch (err) {
    console.error('Export cotizaciones error:', err);
    res.status(500).json({ error: err.message || 'Error al generar PDF' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exports/rechazos — PDF de rechazos
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/rechazos', authMiddleware, async (req, res) => {
  try {
    const base = buildFilter(req.query);
    const quotes = await prisma.quote.findMany({
      where: { ...base, ...NO_PACKAGE_DUPES, stage: 'rechazada' },
      include: {
        client: { select: { name: true, code: true } },
        seller: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    const filterLabels = await resolveFilterLabels(req.query);
    const filters = { ...filterLabels, from: req.query.from, to: req.query.to };

    const style = req.query.style === 'executive' ? 'executive' : undefined;
    const pdf = await generateRechazos(quotes, { filters, style });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="rechazos_${new Date().toISOString().slice(0,10)}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  } catch (err) {
    console.error('Export rechazos error:', err);
    res.status(500).json({ error: err.message || 'Error al generar PDF' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exports/ordenes — PDF de órdenes de compra
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/ordenes', authMiddleware, async (req, res) => {
  try {
    const base = buildFilter(req.query);
    const orders = await prisma.order.findMany({
      where: base,
      include: {
        client: { select: { name: true, code: true } },
        seller: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const stages = await getStages('ORDEN_COMPRA');
    const filterLabels = await resolveFilterLabels(req.query);
    const filters = { ...filterLabels, from: req.query.from, to: req.query.to };

    const style = req.query.style === 'executive' ? 'executive' : undefined;
    const pdf = await generateOrdenes(orders, { filters, stages, style });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ordenes_${new Date().toISOString().slice(0,10)}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.end(pdf);
  } catch (err) {
    console.error('Export ordenes error:', err);
    res.status(500).json({ error: err.message || 'Error al generar PDF' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/exports/send — Enviar reporte por mail
// Body: { type: 'cotizaciones'|'rechazos'|'ordenes', to, cc?, subject?, body?, filters? }
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { type, to, cc, subject, body: emailBody, filters: rawFilters, style: rawStyle } = req.body;
    const style = rawStyle === 'executive' ? 'executive' : undefined;
    if (!type || !to) return res.status(400).json({ error: 'Faltan campos requeridos (type, to)' });
    if (!['cotizaciones', 'rechazos', 'ordenes'].includes(type)) {
      return res.status(400).json({ error: 'Tipo inválido. Debe ser: cotizaciones, rechazos, ordenes' });
    }

    const parsedFilters = rawFilters || {};
    const base = buildFilter(parsedFilters);
    const filterLabels = await resolveFilterLabels(parsedFilters);
    const filters = { ...filterLabels, from: parsedFilters.from, to: parsedFilters.to };

    let pdf, filename;

    if (type === 'cotizaciones') {
      const mailTypeFilter = {
        OR: [{ mailType: null }, { mailType: { notIn: ['OC', 'NOTA_PEDIDO'] } }],
      };
      const where = { ...mailTypeFilter, ...base };
      if (req.user.role === 'VENDEDOR') {
        where.AND = [mailTypeFilter, { OR: [{ sellerId: req.user.id }, { sellerId: null, stage: 'recibida' }] }];
        delete where.OR;
      }
      const quotes = await prisma.quote.findMany({
        where,
        include: { client: { select: { name: true } }, seller: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: 500,
      });
      const stages = await getStages('COTIZACION');
      pdf = await generateCotizaciones(quotes, { filters, stages, style });
      filename = `cotizaciones_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (type === 'rechazos') {
      const quotes = await prisma.quote.findMany({
        where: { ...base, ...NO_PACKAGE_DUPES, stage: 'rechazada' },
        include: { client: { select: { name: true } }, seller: { select: { name: true } } },
        orderBy: { updatedAt: 'desc' }, take: 500,
      });
      pdf = await generateRechazos(quotes, { filters, style });
      filename = `rechazos_${new Date().toISOString().slice(0, 10)}.pdf`;
    } else {
      const orders = await prisma.order.findMany({
        where: base,
        include: { client: { select: { name: true } }, seller: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: 500,
      });
      const stages = await getStages('ORDEN_COMPRA');
      pdf = await generateOrdenes(orders, { filters, stages, style });
      filename = `ordenes_${new Date().toISOString().slice(0, 10)}.pdf`;
    }

    // Guardar PDF temporal
    const tmpPath = path.join(os.tmpdir(), `myselec_${Date.now()}_${filename}`);
    fs.writeFileSync(tmpPath, pdf);

    // Enviar mail
    const reportNames = { cotizaciones: 'Cotizaciones', rechazos: 'Rechazos', ordenes: 'Órdenes de Compra' };
    const defaultSubject = subject || `Reporte ${reportNames[type]} — Myselec CRM`;
    const defaultBody = emailBody || `Adjunto el reporte de ${reportNames[type].toLowerCase()} generado desde Myselec CRM.\n\nSaludos,\n${req.user.name || 'Myselec CRM'}`;

    const result = await sendEmail({
      to,
      cc: cc || null,
      subject: defaultSubject,
      body: defaultBody,
      attachmentPath: tmpPath,
      attachmentName: filename,
    });

    // Limpiar tmp
    try { fs.unlinkSync(tmpPath); } catch (_) {}

    res.json({ ok: true, messageId: result.messageId, filename });
  } catch (err) {
    console.error('Export send error:', err);
    res.status(500).json({ error: err.message || 'Error al enviar reporte' });
  }
});

module.exports = router;
