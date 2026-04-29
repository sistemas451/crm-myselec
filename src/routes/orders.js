const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

async function nextCode(model, prefix) {
  const all = await model.findMany({ select: { code: true } });
  const nums = all.map(r => parseInt(r.code.split('-')[2]) || 0).filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// GET /api/orders
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'VENDEDOR') where.sellerId = req.user.id;

    const orders = await prisma.order.findMany({
      where,
      include: {
        client: { select: { code: true, name: true, city: true, province: true } },
        seller: { select: { id: true, name: true } },
        fromQuote: { select: { code: true } },
        _count: { select: { notes: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = orders.map(o => ({
      id: o.id,
      code: o.code,
      client: o.client?.code || '',
      clientName: o.client?.name || '',
      seller: o.sellerId || '',
      sellerName: o.seller?.name || '',
      stage: o.stage,
      fromQuote: o.fromQuote?.code || '',
      entrega: o.deliveryType || 'AMBA',
      transp: o.carrier || '—',
      flexxus: o.flexxusCode || '',
      fecha: o.createdAt.toISOString(),
      guia: o.trackingNumber || '',
      invoiceIssued: o.invoiceIssued,
      waybillReceived: o.waybillReceived,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/orders - Create order manually from an accepted quote
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { fromQuoteId, clientOCCode, flexxusCode, deliveryType, carrier, estimatedDate } = req.body;

    const quote = await prisma.quote.findUnique({
      where: { id: fromQuoteId },
      include: { client: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    const code = await nextCode(prisma.order, 'OC-2026');

    const order = await prisma.order.create({
      data: {
        code,
        clientId: quote.clientId,
        sellerId: quote.sellerId,
        fromQuoteId,
        stage: 'oc',
        clientOCCode: clientOCCode || null,
        flexxusCode: flexxusCode || null,
        deliveryType: deliveryType || 'AMBA',
        carrier: carrier || null,
        estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
      },
    });

    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: `OC ${code} creada manualmente desde ${quote.code}`,
        userId: req.user.id,
        orderId: order.id,
      },
    });

    res.status(201).json(order);
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Error al crear OC' });
  }
});

// PATCH /api/orders/:id/stage
router.patch('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const { stage } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'OC no encontrada' });

    const oldStage = order.stage;
    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { stage },
    });

    await prisma.activity.create({
      data: {
        action: 'STAGE_CHANGE',
        detail: `Movió ${order.code} de ${oldStage} a ${stage}`,
        userId: req.user.id,
        orderId: order.id,
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;
