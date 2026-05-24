const express = require('express');
const multer  = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { parseNotaPedidoPDF } = require('../services/flexxusParser');
const prisma = require('../db');

const router  = express.Router();
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function nextCode(model, prefix) {
  const last = await model.findFirst({
    where:   { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select:  { code: true },
  });
  const num = last ? (parseInt(last.code.split('-').pop()) || 0) : 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

// GET /api/orders
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'VENDEDOR') where.sellerId = req.user.id;
    if (req.query.since) where.createdAt = { gte: new Date(req.query.since) };

    // Órdenes de compra manuales (modelo Order)
    const orders = await prisma.order.findMany({
      where,
      include: {
        client: { select: { code: true, name: true, city: true, province: true } },
        seller: { select: { id: true, name: true } },
        fromQuote: { select: { code: true } },
        _count: { select: { notes: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    // Solo Notas de Pedido ingresadas por email (OC por mail ya no se usa)
    const quoteWhere = { mailType: 'NOTA_PEDIDO' };
    if (req.user.role === 'VENDEDOR') quoteWhere.sellerId = req.user.id;
    const emailOCs = await prisma.quote.findMany({
      where: quoteWhere,
      include: {
        client: { select: { code: true, name: true, city: true, province: true } },
        seller: { select: { id: true, name: true } },
        linkedQuote: { select: { code: true } },
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
      monto: null,
      _source: 'ORDER',
    }));

    const formattedEmailOCs = emailOCs.map(q => ({
      id: q.id,
      code: q.code,
      client: q.client?.code || '',
      clientName: q.client?.name || q.emailSubject || 'Sin cliente',
      seller: q.sellerId || '',
      sellerName: q.seller?.name || '',
      stage: q.stage,
      fromQuote: q.linkedQuote?.code || '',
      entrega: 'EMAIL',
      transp: '—',
      flexxus: q.flexxusCode || '',
      fecha: q.createdAt.toISOString(),
      guia: '',
      invoiceIssued: false,
      waybillReceived: false,
      monto: q.amount || null,
      emailSubject: q.emailSubject || '',
      _source: 'QUOTE',
    }));

    res.json([...formatted, ...formattedEmailOCs]);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/orders/parse-np — parsear PDF de Nota de Pedido sin crear nada
router.post('/parse-np', authMiddleware, memUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const data = await parseNotaPedidoPDF(req.file.buffer);

    // Buscar presupuesto por código PR del COMENTARIO
    let presupuesto = null;
    if (data.presupuestoNP) {
      presupuesto = await prisma.quote.findFirst({
        where: { flexxusCode: data.presupuestoNP },
        select: { id: true, code: true, flexxusCode: true, stage: true, amount: true },
      });
      if (!presupuesto) {
        const rawNum = data.presupuestoNP.replace('PR-', '');
        presupuesto = await prisma.quote.findFirst({
          where: { flexxusCode: { contains: rawNum } },
          select: { id: true, code: true, flexxusCode: true, stage: true, amount: true },
        });
      }
    }

    // Buscar cliente por CUIT
    let client = null;
    if (data.cuit) {
      client = await prisma.client.findFirst({
        where: { cuit: { equals: data.cuit, mode: 'insensitive' } },
        select: { id: true, code: true, name: true },
      });
    }

    res.json({
      npCode:        data.npCode,
      cuit:          data.cuit,
      clientName:    data.clientName,
      ocNumber:      data.ocNumber,
      presupuestoNP: data.presupuestoNP,
      total:         data.total,
      itemCount:     data.items?.length || 0,
      presupuesto,
      client,
    });
  } catch (err) {
    console.error('Error parseando NP:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders - Crear NP manualmente (fromQuoteId opcional si viene del PDF)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { fromQuoteId, clientId: directClientId, clientOCCode, flexxusCode, deliveryType, carrier, estimatedDate } = req.body;

    let resolvedClientId = directClientId || null;
    let resolvedSellerId = req.user.id;
    let quoteCode = null;

    if (fromQuoteId) {
      const quote = await prisma.quote.findUnique({ where: { id: fromQuoteId } });
      if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });
      resolvedClientId = quote.clientId || resolvedClientId;
      resolvedSellerId = quote.sellerId || resolvedSellerId;
      quoteCode = quote.code;
    } else if (resolvedClientId) {
      const client = await prisma.client.findUnique({
        where: { id: resolvedClientId },
        select: { defaultSellerId: true },
      });
      if (client?.defaultSellerId) resolvedSellerId = client.defaultSellerId;
    }

    const code = await nextCode(prisma.order, 'OC-2026');

    const order = await prisma.order.create({
      data: {
        code,
        clientId:     resolvedClientId,
        sellerId:     resolvedSellerId,
        fromQuoteId:  fromQuoteId || null,
        stage:        'oc',
        clientOCCode: clientOCCode || null,
        flexxusCode:  flexxusCode  || null,
        deliveryType: deliveryType || 'AMBA',
        carrier:      carrier      || null,
        estimatedDate: estimatedDate ? new Date(estimatedDate) : null,
      },
    });

    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: quoteCode
          ? `NP ${code} creada desde ${quoteCode}`
          : `NP ${code} creada manualmente${flexxusCode ? ` (${flexxusCode})` : ''}`,
        userId:  req.user.id,
        orderId: order.id,
      },
    });

    res.status(201).json(order);
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: 'Error al crear NP' });
  }
});

// GET /api/orders/:id/detail — full detail with notes, attachments, activities, NP
router.get('/:id/detail', authMiddleware, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        seller: { select: { id: true, name: true, email: true } },
        fromQuote: {
          select: {
            id: true, code: true, flexxusCode: true, amount: true,
            items: { orderBy: { sortOrder: 'asc' } },
          },
        },
        notes: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: { orderBy: { createdAt: 'desc' } },
        activities: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'OC no encontrada' });

    // Buscar Nota de Pedido vinculada al presupuesto origen
    let notaPedido = null;
    if (order.fromQuoteId) {
      notaPedido = await prisma.quote.findFirst({
        where: { mailType: 'NOTA_PEDIDO', linkedQuoteId: order.fromQuoteId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    res.json({ ...order, notaPedido });
  } catch (err) {
    console.error('Error en order detail:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/orders/:id/notes — add a note to an order
router.post('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'El texto de la nota no puede estar vacío' });
    const note = await prisma.note.create({
      data: {
        text,
        userId: req.user.id,
        orderId: req.params.id,
      },
      include: { user: { select: { name: true } } },
    });

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (order) {
      await prisma.activity.create({
        data: {
          action: 'NOTE_ADDED',
          detail: `Agregó nota en ${order.code}`,
          userId: req.user.id,
          orderId: req.params.id,
        },
      });
    }

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar nota' });
  }
});

// PATCH /api/orders/:id — update order fields (carrier, tracking, etc.)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    // VENDEDOR solo puede modificar sus propias OCs
    if (req.user.role === 'VENDEDOR') {
      const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { sellerId: true } });
      if (order && order.sellerId !== req.user.id) {
        return res.status(403).json({ error: 'Sin permiso sobre esta orden' });
      }
    }
    const { carrier, trackingNumber, flexxusCode, clientOCCode, estimatedDate, invoiceIssued, waybillReceived } = req.body;
    const data = {};
    if (carrier          !== undefined) data.carrier          = carrier || null;
    if (trackingNumber   !== undefined) data.trackingNumber   = trackingNumber || null;
    if (flexxusCode      !== undefined) data.flexxusCode      = flexxusCode || null;
    if (clientOCCode     !== undefined) data.clientOCCode     = clientOCCode || null;
    if (estimatedDate    !== undefined) data.estimatedDate    = estimatedDate ? new Date(estimatedDate) : null;
    if (invoiceIssued    !== undefined) data.invoiceIssued    = invoiceIssued;
    if (waybillReceived  !== undefined) data.waybillReceived  = waybillReceived;

    const updated = await prisma.order.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar OC' });
  }
});

// PATCH /api/orders/:id/stage — maneja tanto Order como Quote(mailType=OC)
router.patch('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage es requerido' });

    // Verificar si es un Quote-OC de email
    const emailOC = await prisma.quote.findFirst({
      where: { id: req.params.id, mailType: 'OC' },
    });
    if (emailOC) {
      await prisma.quote.update({ where: { id: req.params.id }, data: { stage } });
      await prisma.activity.create({
        data: { action: 'STAGE_CHANGE', detail: `Etapa → ${stage}`, userId: req.user.id, quoteId: req.params.id },
      });
      return res.json({ ok: true, stage });
    }

    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'OC no encontrada' });

    // VENDEDOR solo puede mover sus propias OCs
    if (req.user.role === 'VENDEDOR' && order.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta orden' });
    }

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

// DELETE /api/orders/:id — elimina NP/OC y devuelve el presupuesto a 'enviado'
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar órdenes' });
    }

    // ¿Es una NOTA_PEDIDO (Quote)?
    const npQuote = await prisma.quote.findFirst({
      where: { id: req.params.id, mailType: 'NOTA_PEDIDO' },
      select: { id: true, code: true, linkedQuoteId: true },
    });

    if (npQuote) {
      // Si tiene presupuesto vinculado, devolverlo a 'enviado'
      if (npQuote.linkedQuoteId) {
        await prisma.quote.update({
          where: { id: npQuote.linkedQuoteId },
          data: { stage: 'enviado' },
        });
      }
      await prisma.quote.delete({ where: { id: req.params.id } });
      return res.json({ ok: true, code: npQuote.code });
    }

    // Es una Order manual
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      select: { id: true, code: true, fromQuoteId: true },
    });
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    // Si vino de un presupuesto, devolverlo a 'enviado'
    if (order.fromQuoteId) {
      await prisma.quote.update({
        where: { id: order.fromQuoteId },
        data: { stage: 'enviado' },
      });
    }

    await prisma.order.delete({ where: { id: req.params.id } });
    res.json({ ok: true, code: order.code });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;
