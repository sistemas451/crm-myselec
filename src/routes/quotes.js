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

// GET /api/quotes - All quotes (admin sees all, seller sees own)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'VENDEDOR') {
      where.sellerId = req.user.id;
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true, city: true, province: true, zone: true } },
        seller: { select: { id: true, name: true, email: true, zone: true } },
        _count: { select: { notes: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Format for frontend compatibility
    const formatted = quotes.map(q => ({
      id: q.id,
      code: q.code,
      client: q.client?.code || '',
      clientName: q.client?.name || '',
      clientCity: q.client?.city || '',
      clientProvince: q.client?.province || '',
      seller: q.sellerId || '',
      sellerName: q.seller?.name || '',
      stage: q.stage,
      source: q.source,
      ingreso: q.createdAt.toISOString(),
      dias: Math.floor((Date.now() - q.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      monto: q.amount,
      adj: q._count.attachments,
      notas: q._count.notes,
      flexxus: q.flexxusCode || '',
      isDraft: q.isDraft,
      emailSubject: q.emailSubject,
      emailFrom: q.emailFrom,
      rejectReason: q.rejectReason,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: 'Error al obtener cotizaciones' });
  }
});

// POST /api/quotes - Create new quote
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId, amount, source, deadline, notes } = req.body;

    // Generate next code
    const code = await nextCode(prisma.quote, 'COT-2026');

    const quote = await prisma.quote.create({
      data: {
        code,
        clientId,
        sellerId: sellerId || null,
        amount: amount ? parseFloat(amount) : null,
        source: source || 'MANUAL',
        stage: sellerId ? 'asignada' : 'recibida',
        deadline: deadline ? new Date(deadline) : null,
      },
      include: {
        client: { select: { code: true, name: true } },
        seller: { select: { name: true } },
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: `Creó cotización ${code} para ${quote.client.name}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    res.status(201).json(quote);
  } catch (err) {
    console.error('Error creating quote:', err);
    res.status(500).json({ error: 'Error al crear cotización' });
  }
});

// PATCH /api/quotes/:id/stage - Change stage
router.patch('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const { stage, rejectReason, rejectNotes } = req.body;

    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    const oldStage = quote.stage;

    const updateData = { stage };
    if (stage === 'rechazada' && rejectReason) {
      updateData.rejectReason = rejectReason;
      updateData.rejectNotes = rejectNotes || null;
    }

    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Log activity
    await prisma.activity.create({
      data: {
        action: 'STAGE_CHANGE',
        detail: `Movió ${quote.code} de ${oldStage} a ${stage}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    // If accepted, auto-create an order
    if (stage === 'aceptada') {
      const ocCode = await nextCode(prisma.order, 'OC-2026');

      await prisma.order.create({
        data: {
          code: ocCode,
          clientId: quote.clientId,
          sellerId: quote.sellerId,
          fromQuoteId: quote.id,
          stage: 'oc',
          flexxusCode: quote.flexxusCode,
        },
      });

      await prisma.activity.create({
        data: {
          action: 'CREATED',
          detail: `OC ${ocCode} creada automáticamente desde ${quote.code}`,
          userId: req.user.id,
          quoteId: quote.id,
        },
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Error updating stage:', err);
    res.status(500).json({ error: 'Error al actualizar etapa' });
  }
});

// PATCH /api/quotes/:id/assign - Reassign seller
router.patch('/:id/assign', authMiddleware, async (req, res) => {
  try {
    const { sellerId } = req.body;
    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data: { sellerId },
      include: { seller: { select: { name: true } } },
    });

    await prisma.activity.create({
      data: {
        action: 'ASSIGNED',
        detail: `Asignó ${quote.code} a ${quote.seller?.name || 'sin asignar'}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    res.json(quote);
  } catch (err) {
    console.error('Error assigning seller:', err);
    res.status(500).json({ error: 'Error al asignar vendedor' });
  }
});

// GET /api/quotes/:id/detail - Full detail with notes and history
router.get('/:id/detail', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        seller: { select: { id: true, name: true, email: true } },
        notes: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'desc' } },
        activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!quote) return res.status(404).json({ error: 'No encontrada' });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/quotes/:id/notes - Add a note
router.post('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const note = await prisma.note.create({
      data: {
        text: req.body.text,
        userId: req.user.id,
        quoteId: req.params.id,
      },
      include: { user: { select: { name: true } } },
    });

    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    await prisma.activity.create({
      data: {
        action: 'NOTE_ADDED',
        detail: `Agregó nota en ${quote.code}`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar nota' });
  }
});

// DELETE /api/quotes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
    });
    if (!quote) return res.status(404).json({ error: 'No encontrada' });

    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar cotizaciones' });
    }

    await prisma.quote.delete({ where: { id: req.params.id } });
    res.json({ ok: true, code: quote.code });
  } catch (err) {
    console.error('Error deleting quote:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;
