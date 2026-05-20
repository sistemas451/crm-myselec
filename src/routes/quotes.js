const express = require('express');
const fs = require('fs');
const { authMiddleware } = require('../middleware/auth');
const { onStageChange } = require('../services/notifier');
const { resyncQuoteEmail } = require('../services/mailReader');
const { parseFlexxusPDF } = require('../services/flexxusParser');
const prisma = require('../db');

const router = express.Router();

async function nextCode(model, prefix) {
  // findFirst + desc es O(log n) en lugar de cargar toda la tabla.
  // El constraint @unique en 'code' atrapa colisiones; el caller puede relanzar P2002.
  const last = await model.findFirst({
    where:   { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select:  { code: true },
  });
  const num = last ? (parseInt(last.code.split('-').pop()) || 0) : 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

// GET /api/quotes - All quotes (admin sees all, seller sees own)
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Excluir OC y NOTA_PEDIDO — esas van en el board de Fase 2 (órdenes)
    // Nota: mailType null (manuales) debe incluirse — OR para manejar nulls en PG
    const where = {
      OR: [
        { mailType: null },
        { mailType: { notIn: ['OC', 'NOTA_PEDIDO'] } },
      ],
    };
    if (req.user.role === 'VENDEDOR') {
      // Vendedor ve: sus propias quotes + las sin asignar (recibida, sin seller)
      where.OR = [
        { sellerId: req.user.id },
        { sellerId: null, stage: 'recibida' },
      ];
    }
    // Filtro de fecha (opcional — carga inicial usa últimos 12 meses)
    if (req.query.since) {
      where.createdAt = { gte: new Date(req.query.since) };
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true, city: true, province: true, zone: true } },
        seller: { select: { id: true, name: true, email: true, zone: true } },
        linkedQuote: { select: { id: true, code: true, mailType: true, stage: true, flexxusCode: true } },
        _count: { select: { notes: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,  // límite de seguridad — la paginación real puede venir después
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
      emailMessageId: q.emailMessageId || null,
      mailType: q.mailType || null,
      followUpDate: q.followUpDate?.toISOString() || null,
      rejectReason: q.rejectReason,
      linkedQuoteId:   q.linkedQuoteId || null,
      linkedQuoteCode: q.linkedQuote?.code || null,
      linkedQuoteType: q.linkedQuote?.mailType || null,
      linkedQuoteStage: q.linkedQuote?.stage || null,
      linkedQuoteFlexxus: q.linkedQuote?.flexxusCode || null,
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
        mailType: 'PRESUPUESTO',
        stage: 'enviado',
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
    if (!stage) return res.status(400).json({ error: 'stage es requerido' });

    // Validar motivo de rechazo obligatorio
    if (stage === 'rechazada' && !rejectReason) {
      return res.status(400).json({ error: 'Se requiere un motivo de rechazo al rechazar una cotización' });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    // VENDEDOR solo puede modificar sus propias cotizaciones
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const oldStage = quote.stage;

    // Validar etapas obligatorias (solo al avanzar, no al rechazar ni retroceder)
    if (stage !== 'rechazada') {
      const allStages = await prisma.stageDefinition.findMany({
        where: { active: true, phase: 'COTIZACION' },
        orderBy: { order: 'asc' },
      });
      const orderedKeys = allStages.map(s => s.stageKey);
      const currentIdx = orderedKeys.indexOf(oldStage);
      const targetIdx  = orderedKeys.indexOf(stage);

      if (currentIdx !== -1 && targetIdx > currentIdx + 1) {
        // Hay etapas entre currentIdx y targetIdx — verificar si alguna es obligatoria
        const skipped = allStages.slice(currentIdx + 1, targetIdx);
        const blockers = skipped.filter(s => s.mandatory);
        if (blockers.length > 0) {
          return res.status(400).json({
            error: `No podés saltear la etapa obligatoria "${blockers[0].label}"`,
          });
        }
      }
    }

    const updateData = { stage };
    if (stage === 'rechazada' && rejectReason) {
      updateData.rejectReason = rejectReason;
      updateData.rejectNotes = rejectNotes || null;
    }
    if (stage === 'enviado') {
      const d = new Date();
      d.setDate(d.getDate() + 4);
      updateData.followUpDate = d;
    }

    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // Disparar notificaciones de cambio de etapa (async, no bloquea respuesta)
    onStageChange(quote.id, oldStage, stage).catch(() => {});

    // Log activity
    await prisma.activity.create({
      data: {
        action: 'STAGE_CHANGE',
        detail: `Movió ${quote.code} de ${oldStage} a ${stage}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    // If accepted, auto-create an order (solo si no existe ya una)
    if (stage === 'aceptada') {
      const existingOrder = await prisma.order.findFirst({ where: { fromQuoteId: quote.id } });
      if (existingOrder) {
        console.log(`ℹ️  OC ya existe para ${quote.code}: ${existingOrder.code}`);
      } else {
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
      } // end if !existingOrder
    }

    res.json(updated);
  } catch (err) {
    console.error('Error updating stage:', err);
    res.status(500).json({ error: 'Error al actualizar etapa' });
  }
});

// PATCH /api/quotes/:id/assign - Reassign seller (solo admin o logística)
router.patch('/:id/assign', authMiddleware, async (req, res) => {
  if (req.user.role === 'VENDEDOR') {
    return res.status(403).json({ error: 'Solo administradores pueden reasignar cotizaciones' });
  }
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
        activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        items: { orderBy: { sortOrder: 'asc' } },
        linkedQuote: {
          include: {
            activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
          },
        },
        linkedBy: {
          include: {
            activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
          },
          take: 5,
        },
      },
    });
    if (!quote) return res.status(404).json({ error: 'No encontrada' });

    // ── Historial unificado: mezclar actividades de ambas quotes ──────────
    const ownActivities = (quote.activities || []).map(a => ({ ...a, _fromCode: quote.code, _fromType: quote.mailType }));
    const linked = quote.linkedQuote || quote.linkedBy?.[0];
    const linkedActivities = linked
      ? (linked.activities || []).map(a => ({ ...a, _fromCode: linked.code, _fromType: linked.mailType }))
      : [];
    const unifiedHistory = [...ownActivities, ...linkedActivities]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({ ...quote, unifiedHistory });
  } catch (err) {
    console.error('Error en detail endpoint:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/quotes/:id/reparse-items - Re-parse Flexxus PDF from stored attachment
router.post('/:id/reparse-items', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { attachments: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    const pdfAtt = (quote.attachments || []).find(a =>
      (a.mimeType || '').includes('pdf') || (a.filename || '').toLowerCase().endsWith('.pdf')
    );
    if (!pdfAtt) return res.status(404).json({ error: 'No se encontró adjunto PDF' });
    if (!fs.existsSync(pdfAtt.path)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });

    const buffer = fs.readFileSync(pdfAtt.path);
    const flexxusData = await parseFlexxusPDF(buffer);

    if (!flexxusData?.items?.length) {
      return res.status(400).json({ error: 'El PDF no contiene ítems Flexxus reconocibles' });
    }

    await prisma.quoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.quoteItem.createMany({
      data: flexxusData.items.map((item, i) => ({
        quoteId:     quote.id,
        sku:         item.sku || null,
        description: (item.description || '').substring(0, 500),
        quantity:    item.quantity || 0,
        unit:        item.unit || null,
        unitPrice:   item.unitPrice || null,
        total:       item.total || null,
        accepted:    item.accepted !== false,
        sortOrder:   i,
      })),
    });

    const flexxusTotal = flexxusData.items
      .filter(i => i.accepted !== false)
      .reduce((s, i) => s + (i.total || 0), 0);
    if (flexxusTotal > 0) {
      await prisma.quote.update({ where: { id: quote.id }, data: { amount: flexxusTotal } });
    }

    res.json({ ok: true, itemCount: flexxusData.items.length, total: flexxusTotal });
  } catch (err) {
    console.error('Error re-parseando PDF:', err);
    res.status(500).json({ error: err.message || 'Error al re-parsear PDF' });
  }
});

// POST /api/quotes/:id/resync-email - Re-fetch email from IMAP and update emailFrom/emailBody
router.post('/:id/resync-email', authMiddleware, async (req, res) => {
  try {
    const result = await resyncQuoteEmail(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al re-sincronizar email' });
  }
});

// POST /api/quotes/:id/notes - Add a note
router.post('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'El texto de la nota no puede estar vacío' });
    const note = await prisma.note.create({
      data: {
        text,
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

// PATCH /api/quotes/:id/client — assign client (and optionally seller)
router.patch('/:id/client', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId } = req.body;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { defaultSeller: { select: { id: true, name: true } } },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    const updateData = { clientId };
    const resolvedSellerId = sellerId || client.defaultSellerId || null;
    if (resolvedSellerId) {
      updateData.sellerId = resolvedSellerId;
      updateData.stage = 'asignada';
    }

    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await prisma.activity.create({
      data: {
        action: 'ASSIGNED',
        detail: `Cliente asignado: ${client.name}${resolvedSellerId ? ` · Vendedor: ${client.defaultSeller?.name || ''}` : ''}`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    // Retroalimentación: guardar emailFrom en ClientEmail para matcheo futuro
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { emailFrom: true } });
    if (quote?.emailFrom) {
      const emailFrom = quote.emailFrom.toLowerCase().trim();
      await prisma.clientEmail.upsert({
        where: { email_clientId: { email: emailFrom, clientId } },
        update: {},
        create: { email: emailFrom, clientId, isPrimary: false },
      }).catch(() => {}); // silenciar si ya existe
    }

    res.json(updated);
  } catch (err) {
    console.error('Error assigning client:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: copia ítems aceptados de PRESUPUESTO a OC (si la OC no tiene ítems aún)
async function copyPresupuestoItemsToOC(presupuestoId, ocId) {
  const existing = await prisma.quoteItem.count({ where: { quoteId: ocId } });
  if (existing > 0) return;
  const items = await prisma.quoteItem.findMany({
    where: { quoteId: presupuestoId, accepted: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (!items.length) return;
  await prisma.quoteItem.createMany({
    data: items.map((it, i) => ({
      quoteId: ocId, sku: it.sku, description: it.description,
      quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice,
      total: it.total, accepted: true, checked: true, sortOrder: i,
    })),
  });
}

// PATCH /api/quotes/:id/link — vincular quotes (SOLICITUD ↔ PRESUPUESTO ↔ OC)
// body: { linkedQuoteId } — o null para desvincular
router.patch('/:id/link', authMiddleware, async (req, res) => {
  try {
    const { linkedQuoteId } = req.body;

    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    let target = null;
    if (linkedQuoteId) {
      target = await prisma.quote.findUnique({ where: { id: linkedQuoteId } });
      if (!target) return res.status(404).json({ error: 'Cotización destino no encontrada' });
    }

    // Determinar cuál es PRESUPUESTO para propagar NP y copiar ítems a OC
    let presupuesto = null, solicitud = null, oc = null;
    if (target) {
      presupuesto = quote.mailType === 'PRESUPUESTO' ? quote : (target.mailType === 'PRESUPUESTO' ? target : null);
      solicitud   = quote.mailType === 'SOLICITUD'   ? quote : (target.mailType === 'SOLICITUD'   ? target : null);
      oc          = quote.mailType === 'OC'          ? quote : (target.mailType === 'OC'          ? target : null);
    }
    const npToPropagate = presupuesto?.flexxusCode || null;

    // Actualizar vínculo en ambas cotizaciones + propagar flexxusCode a SOLICITUD y OC
    const propagateToReq = npToPropagate && (solicitud?.id === req.params.id || oc?.id === req.params.id);
    const propagateToTarget = npToPropagate && (solicitud?.id === target?.id || oc?.id === target?.id);
    await prisma.quote.update({
      where: { id: req.params.id },
      data: { linkedQuoteId: linkedQuoteId || null, ...(propagateToReq ? { flexxusCode: npToPropagate } : {}) },
    });
    if (target) {
      await prisma.quote.update({
        where: { id: target.id },
        data: {
          linkedQuoteId: req.params.id,
          ...(propagateToTarget ? { flexxusCode: npToPropagate } : {}),
        },
      });

      // Si hay una OC en el vínculo y hay un PRESUPUESTO, copiar ítems
      if (oc && presupuesto) {
        await copyPresupuestoItemsToOC(presupuesto.id, oc.id);
      }
    }

    // Log actividad en ambas
    const detail = target
      ? `Vinculada con ${target.code} (${target.mailType || target.source})${npToPropagate ? ` · NP ${npToPropagate}` : ''}`
      : 'Vínculo eliminado';
    await prisma.activity.create({
      data: { action: 'LINKED', detail, userId: req.user.id, quoteId: req.params.id },
    });
    if (target) {
      await prisma.activity.create({
        data: {
          action: 'LINKED',
          detail: `Vinculada con ${quote.code} (${quote.mailType || quote.source})${npToPropagate ? ` · NP ${npToPropagate}` : ''}`,
          userId: req.user.id,
          quoteId: target.id,
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error linking quotes:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quotes/:id/items/:itemId — actualizar ítem (accepted, checked, quantity, description, sku, unitPrice)
router.patch('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const { accepted, checked, quantity, description, sku, unitPrice } = req.body;
    const data = {};
    if (accepted   !== undefined) data.accepted   = accepted;
    if (checked    !== undefined) data.checked    = checked;
    if (quantity   !== undefined) data.quantity   = parseFloat(quantity);
    if (description !== undefined) data.description = description;
    if (sku        !== undefined) data.sku        = sku || null;
    if (unitPrice  !== undefined) {
      data.unitPrice = unitPrice != null ? parseFloat(unitPrice) : null;
      if (data.unitPrice != null && data.quantity != null) {
        data.total = data.unitPrice * data.quantity;
      }
    }
    // recalcular total si cambia quantity y hay unitPrice
    if (quantity !== undefined && unitPrice === undefined) {
      const item = await prisma.quoteItem.findUnique({ where: { id: req.params.itemId } });
      if (item?.unitPrice != null) data.total = item.unitPrice * data.quantity;
    }
    const updated = await prisma.quoteItem.update({ where: { id: req.params.itemId }, data });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quotes/:id/items — agregar ítem manualmente a una OC
router.post('/:id/items', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    const { description, sku, quantity = 1, unit, unitPrice } = req.body;
    if (!description) return res.status(400).json({ error: 'description es requerida' });

    const last = await prisma.quoteItem.findFirst({
      where: { quoteId: req.params.id }, orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;
    const qty  = parseFloat(quantity) || 1;
    const up   = unitPrice != null ? parseFloat(unitPrice) : null;
    const item = await prisma.quoteItem.create({
      data: {
        quoteId: req.params.id,
        description, sku: sku || null, quantity: qty, unit: unit || null,
        unitPrice: up, total: up != null ? up * qty : null,
        accepted: true, checked: true, sortOrder,
      },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/quotes/:id/items/:itemId — eliminar ítem definitivamente
router.delete('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    await prisma.quoteItem.delete({ where: { id: req.params.itemId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
