const express = require('express');
const {authMiddleware, isAdmin } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

// GET /api/data/users
router.get('/users', authMiddleware, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true },
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error('GET /data/users error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// GET /api/data/stages
router.get('/stages', authMiddleware, async (req, res) => {
  const stages = await prisma.stageDefinition.findMany({
    where: { active: true },
    orderBy: [{ phase: 'asc' }, { order: 'asc' }],
  });
  const mapStage = s => ({ id: s.stageKey, dbId: s.id, label: s.label, tone: s.tone, mandatory: s.mandatory, maxHours: s.maxHours, emailAlert: s.emailAlert });
  const f1 = stages.filter(s => s.phase === 'COTIZACION').map(mapStage);
  const f2 = stages.filter(s => s.phase === 'ORDEN_COMPRA').map(mapStage);
  res.json({ f1, f2 });
});

// GET /api/data/activity
router.get('/activity', authMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200); // máximo 200 actividades
  const activities = await prisma.activity.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user:  { select: { id: true, name: true } },
      quote: { select: { id: true, code: true } },
      order: { select: { id: true, code: true } },
    },
  });
  res.json(activities.map(a => ({
    id:        a.id,
    action:    a.action,
    detail:    a.detail,
    userName:  a.user?.name || 'Sistema',
    userId:    a.userId,
    quoteCode: a.quote?.code || null,
    quoteId:   a.quote?.id   || null,
    orderCode: a.order?.code || null,
    orderId:   a.order?.id   || null,
    createdAt: a.createdAt,
    // keep legacy fields so Dashboard activity feed still works
    at:     a.createdAt.toISOString(),
    by:     a.userId,
    byName: a.user?.name || 'Sistema',
    text:   a.detail,
  })));
});

// GET /api/data/rejection-reasons
router.get('/rejection-reasons', authMiddleware, async (req, res) => {
  const reasons = await prisma.rejectionReason.findMany({
    where: { active: true },
    orderBy: { order: 'asc' },
  });
  res.json(reasons);
});

// ─── Helper: construir filtros de fecha y vendedor desde query params ────────
function buildBaseFilter({ sellerId, from, to } = {}) {
  const filter = {};
  if (sellerId) filter.sellerId = sellerId;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.gte = new Date(from);
    if (to)   { const d = new Date(to); d.setHours(23, 59, 59, 999); filter.createdAt.lte = d; }
  }
  return filter;
}

// GET /api/data/dashboard - Stats for admin dashboard
// Acepta query params opcionales: ?sellerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query);

    const [totalQuotes, sentQuotes, activeOrders, deliveredOrders] = await Promise.all([
      prisma.quote.count({ where: { ...base, stage: { notIn: ['aceptada', 'rechazada'] } } }),
      prisma.quote.count({ where: { ...base, stage: 'enviado' } }),
      prisma.order.count({ where: { stage: { notIn: ['entregada'] } } }),
      prisma.order.count({ where: { stage: 'entregada' } }),
    ]);

    const [totalAmount, montoConfirmado] = await Promise.all([
      prisma.quote.aggregate({
        _sum:  { amount: true },
        where: { ...base, amount: { not: null } },
      }),
      prisma.quote.aggregate({
        _sum:  { amount: true },
        where: { ...base, mailType: 'NOTA_PEDIDO', amount: { not: null } },
      }),
    ]);

    const [accepted, totalInPeriod] = await Promise.all([
      prisma.quote.count({ where: { ...base, stage: 'aceptada' } }),
      prisma.quote.count({ where: { ...base } }),
    ]);
    const conversionRate = totalInPeriod > 0 ? Math.round((accepted / totalInPeriod) * 100) : 0;

    // ── KPI: Tiempo de respuesta ──────────────────────────────────────────
    // Cotizaciones que ya pasaron de 'recibida' → primera actividad = tiempo de respuesta
    const respondedQuotes = await prisma.quote.findMany({
      where: { ...base, stage: { notIn: ['recibida'] } },
      select: {
        createdAt: true,
        activities: {
          where: { action: { in: ['STAGE_CHANGE', 'ASSIGNED'] } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    const responseTimes = respondedQuotes
      .filter(q => q.activities.length > 0)
      .map(q => (q.activities[0].createdAt.getTime() - q.createdAt.getTime()) / (1000 * 60 * 60)); // horas
    const avgResponseHours = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((s, h) => s + h, 0) / responseTimes.length)
      : null;

    // Cotizaciones en 'recibida' por más de 24h (pendientes de atención)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingAttention = await prisma.quote.count({
      where: { ...base, stage: 'recibida', createdAt: { lt: oneDayAgo } },
    });

    res.json({
      cotizacionesActivas:  totalQuotes,
      presupuestosEnviados: sentQuotes,
      ocEnCurso:            activeOrders,
      entregasEsteMes:      deliveredOrders,
      montoTotal:           totalAmount._sum.amount    || 0,
      montoConfirmado:      montoConfirmado._sum.amount || 0,
      tasaConversion:       conversionRate,
      avgResponseHours,
      pendingAttention,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /data/charts/sellers
// Acepta: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/charts/sellers', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query); // from/to aplican; sellerId ignorado (siempre mostramos todos)
    const { sellerId: _ignored, ...dateFilter } = base; // excluir sellerId del where de vendedores
    const users = await prisma.user.findMany({
      where: { active: true, role: { in: ['VENDEDOR', 'ADMIN'] } },
      select: { id: true, name: true },
    });
    const result = await Promise.all(users.map(async (u) => {
      const [cotiz, ganadas] = await Promise.all([
        prisma.quote.count({ where: { ...dateFilter, sellerId: u.id } }),
        prisma.quote.count({ where: { ...dateFilter, sellerId: u.id, stage: 'aceptada' } }),
      ]);
      return { name: u.name.split(' ')[0], cotiz, ganadas };
    }));
    res.json(result.filter(r => r.cotiz > 0));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/stages
// Acepta: ?sellerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/charts/stages', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query);
    const stages = await prisma.stageDefinition.findMany({
      where: { active: true, phase: 'COTIZACION' },
      orderBy: { order: 'asc' },
    });
    const COLORS = {
      gray:'#94A3B8', blue:'#3B82F6', navy:'#1B2A4A', amber:'#F59E0B',
      sky:'#0EA5E9', orange:'#F97316', green:'#10B981', red:'#EF4444',
      purple:'#8B5CF6',
    };
    const result = await Promise.all(stages.map(async (s) => {
      const value = await prisma.quote.count({ where: { ...base, stage: s.stageKey } });
      return { name: s.label, value, color: COLORS[s.tone] || '#94A3B8', stageKey: s.stageKey };
    }));
    const total = result.reduce((a, b) => a + b.value, 0);
    res.json({ stages: result.filter(r => r.value > 0), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/stages/full — all fields for config editing
router.get('/stages/full', authMiddleware, async (req, res) => {
  try {
    const stages = await prisma.stageDefinition.findMany({
      orderBy: [{ phase: 'asc' }, { order: 'asc' }],
    });
    res.json(stages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /data/stages/:id — edit a stage definition (admin only)
router.patch('/stages/:id', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    const { mandatory, maxHours, label, tone, emailAlert } = req.body;
    const data = {};
    if (mandatory   !== undefined) data.mandatory  = mandatory;
    if (maxHours    !== undefined) data.maxHours   = maxHours || null;
    if (label       !== undefined) data.label      = label;
    if (tone        !== undefined) data.tone       = tone;
    if (emailAlert  !== undefined) data.emailAlert = emailAlert;
    const updated = await prisma.stageDefinition.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /data/stages — crear nueva etapa (admin only)
router.post('/stages', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    const { label, phase, tone = 'gray' } = req.body;
    if (!label || !phase) return res.status(400).json({ error: 'label y phase son requeridos' });
    if (!['COTIZACION', 'ORDEN_COMPRA'].includes(phase)) {
      return res.status(400).json({ error: 'phase inválida' });
    }

    // stageKey: slug del label
    const stageKey = label.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    // order: al final de su fase
    const last = await prisma.stageDefinition.findFirst({
      where: { phase },
      orderBy: { order: 'desc' },
    });
    const order = (last?.order ?? 0) + 1;

    const stage = await prisma.stageDefinition.create({
      data: { label, phase, tone, stageKey, order, active: true },
    });
    res.json(stage);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Ya existe una etapa con ese nombre en esa fase' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /data/stages/:id — eliminar etapa (admin only, solo si no tiene quotes)
router.delete('/stages/:id', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    const stage = await prisma.stageDefinition.findUnique({ where: { id: req.params.id } });
    if (!stage) return res.status(404).json({ error: 'Etapa no encontrada' });

    const quotesInStage = await prisma.quote.count({ where: { stage: stage.stageKey } });
    if (quotesInStage > 0) {
      return res.status(400).json({ error: `No se puede eliminar: hay ${quotesInStage} cotización(es) en esta etapa` });
    }

    await prisma.stageDefinition.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /data/stages/reorder — reordenar etapas (admin only)
router.patch('/stages-reorder', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    // ids: array de IDs en el nuevo orden (por fase)
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array' });

    await Promise.all(ids.map((id, i) =>
      prisma.stageDefinition.update({ where: { id }, data: { order: i + 1 } })
    ));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/monthly
// Acepta: ?sellerId= (filtra por vendedor; siempre muestra últimos 6 meses)
router.get('/charts/monthly', authMiddleware, async (req, res) => {
  try {
    const { sellerId } = req.query;
    const sellerFilter = sellerId ? { sellerId } : {};
    const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const [recibidas, ganadas] = await Promise.all([
        prisma.quote.count({ where: { ...sellerFilter, createdAt: { gte: start, lte: end } } }),
        prisma.quote.count({ where: { ...sellerFilter, stage: 'aceptada', createdAt: { gte: start, lte: end } } }),
      ]);
      months.push({ month: MONTHS_ES[d.getMonth()], recibidas, ganadas });
    }
    res.json(months);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/alerts — presupuestos en etapa "enviado" cuyo followUpDate ya venció
// Acepta: ?sellerId=
router.get('/alerts', authMiddleware, async (req, res) => {
  try {
    const { sellerId } = req.query;
    const now = new Date();
    const where = {
      stage: 'enviado',
      followUpDate: { lte: now },   // solo los que tienen fecha de seguimiento vencida
    };
    if (sellerId) where.sellerId = sellerId;
    if (req.user.role === 'VENDEDOR') where.sellerId = req.user.id;
    const quotes = await prisma.quote.findMany({
      where,
      orderBy: { followUpDate: 'asc' },
      include: {
        client: { select: { name: true } },
        seller: { select: { name: true } },
      },
      take: 30,
    });
    res.json(quotes.map(q => ({
      id:          q.id,
      code:        q.code,
      clientName:  q.client?.name  || '—',
      sellerName:  q.seller?.name  || '—',
      amount:      q.amount,
      followUpDate: q.followUpDate?.toISOString() || null,
      daysWaiting: q.followUpDate
        ? Math.floor((now - new Date(q.followUpDate)) / (1000 * 60 * 60 * 24))
        : 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/funnel — embudo de conversión
// Acepta: ?sellerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/charts/funnel', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query);
    const [total, enviado, aceptada, rechazada] = await Promise.all([
      prisma.quote.count({ where: base }),
      prisma.quote.count({ where: { ...base, stage: 'enviado' } }),
      prisma.quote.count({ where: { ...base, stage: 'aceptada' } }),
      prisma.quote.count({ where: { ...base, stage: 'rechazada' } }),
    ]);
    res.json([
      { label: 'Recibidas',  value: total,     color: '#1B2A4A' },
      { label: 'Enviadas',   value: enviado,   color: '#3B82F6' },
      { label: 'Aceptadas',  value: aceptada,  color: '#10B981' },
      { label: 'Rechazadas', value: rechazada, color: '#EF4444' },
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/rejections — motivos de rechazo agrupados
// Acepta: ?sellerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/charts/rejections', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query);
    const rejected = await prisma.quote.findMany({
      where: { ...base, stage: 'rechazada' },
      select: { rejectReason: true },
    });
    const counts = {};
    for (const q of rejected) {
      const reason = q.rejectReason?.trim() || 'Sin especificar';
      counts[reason] = (counts[reason] || 0) + 1;
    }
    const result = Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/rejections-detail — lista completa de cotizaciones rechazadas
// Acepta: ?sellerId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/rejections-detail', authMiddleware, async (req, res) => {
  try {
    const base = buildBaseFilter(req.query);
    const rejected = await prisma.quote.findMany({
      where: { ...base, stage: 'rechazada' },
      include: {
        client: { select: { name: true, code: true, city: true, province: true } },
        seller: { select: { name: true, id: true } },
        items: { select: { sku: true, description: true, quantity: true, unitPrice: true, total: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(rejected.map(q => ({
      id:           q.id,
      code:         q.code,
      clientName:   q.client?.name || '—',
      clientCode:   q.client?.code || null,
      clientCity:   q.client?.city || null,
      sellerName:   q.seller?.name || '—',
      sellerId:     q.seller?.id || null,
      monto:        q.amount,
      rejectReason: q.rejectReason || 'Sin especificar',
      rejectNotes:  q.rejectNotes || '',
      flexxus:      q.flexxusCode || '',
      fechaRechazo: q.updatedAt.toISOString(),
      fechaIngreso: q.createdAt.toISOString(),
      diasHastaRechazo: Math.floor((q.updatedAt.getTime() - q.createdAt.getTime()) / (1000*60*60*24)),
      items:        q.items.map(i => ({ sku: i.sku, desc: i.description, qty: i.quantity, price: i.unitPrice, total: i.total })),
      itemCount:    q.items.length,
    })));
  } catch (err) {
    console.error('rejections-detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /data/search/products — buscar por SKU o descripción de producto
// Retorna cotizaciones y órdenes que contienen el producto
router.get('/search/products', authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const items = await prisma.quoteItem.findMany({
      where: {
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: {
        quote: {
          select: { id: true, code: true, stage: true, mailType: true, amount: true, flexxusCode: true,
                    client: { select: { name: true, code: true } },
                    seller: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // Agrupar por quote para no repetir
    const seen = new Set();
    const results = [];
    for (const it of items) {
      if (seen.has(it.quote.id)) continue;
      seen.add(it.quote.id);
      results.push({
        quoteId:    it.quote.id,
        quoteCode:  it.quote.code,
        stage:      it.quote.stage,
        mailType:   it.quote.mailType,
        monto:      it.quote.amount,
        flexxus:    it.quote.flexxusCode,
        clientName: it.quote.client?.name || '—',
        sellerName: it.quote.seller?.name || '—',
        matchedSku:  it.sku,
        matchedDesc: it.description,
        matchedQty:  it.quantity,
      });
    }
    res.json(results);
  } catch (err) {
    console.error('search/products error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/data/comparativa ───────────────────────────────────────────────
// Compara ítems de un PRESUPUESTO vs su NOTA_DE_PEDIDO vinculada.
// Filtros: clientId, sellerId, quoteId (presupuesto), npCode, from, to
// Devuelve: array de pares { presupuesto, notaPedido, items[] } con diferencias por ítem.
router.get('/comparativa', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId, quoteId, npCode, from, to } = req.query;

    // ── Construir filtro base para buscar PRESUPUESTOS ──────────────────────
    const where = { mailType: 'PRESUPUESTO' };
    if (clientId) where.clientId = clientId;
    if (sellerId) where.sellerId = sellerId;
    // quoteId es un código exacto como "COT-2026-041"
    if (quoteId)  where.code = { equals: quoteId, mode: 'insensitive' };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    // Si se filtra por npCode, buscar la NP y tomar su linkedQuoteId
    if (npCode) {
      const np = await prisma.quote.findFirst({ where: { mailType: 'NOTA_PEDIDO', flexxusCode: { contains: npCode } } });
      if (np?.linkedQuoteId) where.id = np.linkedQuoteId;
      else return res.json([]);
    }

    // ── Buscar presupuestos que tengan al menos una NP vinculada ────────────
    const presupuestos = await prisma.quote.findMany({
      where: {
        ...where,
        linkedBy: { some: { mailType: 'NOTA_PEDIDO' } },
      },
      include: {
        client:  { select: { id: true, name: true, code: true } },
        seller:  { select: { id: true, name: true } },
        items:   { orderBy: { sortOrder: 'asc' } },
        linkedBy: {
          where: { mailType: 'NOTA_PEDIDO' },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: 1, // la NP más reciente
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // ── Construir respuesta con comparativa por ítem ────────────────────────
    const result = presupuestos.map(pres => {
      const np = pres.linkedBy[0] || null;

      // Índice de ítems NP por SKU y descripción normalizada
      const npBySku  = {};
      const npByDesc = {};
      for (const it of (np?.items || [])) {
        if (it.sku)  npBySku[it.sku.toUpperCase()] = it;
        const dk = it.description.toLowerCase().trim().substring(0, 40);
        npByDesc[dk] = it;
      }

      // ── Comparar ítems del presupuesto vs NP ────────────────────────────
      const rows = [];
      const npUsed = new Set();

      for (const pi of pres.items) {
        const key  = pi.sku?.toUpperCase();
        const dkey = pi.description.toLowerCase().trim().substring(0, 40);
        const ni   = (key && npBySku[key]) || npByDesc[dkey] || null;

        if (ni) npUsed.add(ni.id);

        const qtyPres = pi.quantity || 0;
        const qtyNP   = ni?.quantity || 0;
        const totPres = pi.total    || (pi.unitPrice || 0) * qtyPres || 0;
        const totNP   = ni?.total   || (ni?.unitPrice || 0) * qtyNP  || 0;

        let estado;
        if (!ni)                       estado = 'no_compro';    // en pres, no en NP
        else if (qtyPres === qtyNP)    estado = 'igual';
        else                           estado = 'cantidad_distinta';

        rows.push({
          sku:         pi.sku || ni?.sku || null,
          description: pi.description,
          // Presupuesto
          qtyPres,
          unitPricePres: pi.unitPrice || null,
          totalPres:     totPres,
          // Nota de Pedido
          qtyNP:         ni ? qtyNP   : null,
          unitPriceNP:   ni?.unitPrice || null,
          totalNP:       ni ? totNP   : null,
          // Diferencia
          qtyDiff:       ni ? (qtyNP - qtyPres) : null,
          totalDiff:     ni ? (totNP - totPres)  : null,
          estado,
        });
      }

      // Ítems que están en NP pero no en presupuesto → "agregado"
      for (const ni of (np?.items || [])) {
        if (npUsed.has(ni.id)) continue;
        rows.push({
          sku:           ni.sku || null,
          description:   ni.description,
          qtyPres:       null,
          unitPricePres: null,
          totalPres:     null,
          qtyNP:         ni.quantity || 0,
          unitPriceNP:   ni.unitPrice || null,
          totalNP:       ni.total     || 0,
          qtyDiff:       null,
          totalDiff:     null,
          estado:        'agregado',
        });
      }

      // ── Totales resumen ─────────────────────────────────────────────────
      const totalPres = rows.reduce((s, r) => s + (r.totalPres || 0), 0);
      const totalNP   = rows.reduce((s, r) => s + (r.totalNP   || 0), 0);

      return {
        presupuesto: {
          id:          pres.id,
          code:        pres.code,
          flexxusCode: pres.flexxusCode,
          stage:       pres.stage,
          createdAt:   pres.createdAt,
          client:      pres.client,
          seller:      pres.seller,
        },
        notaPedido: np ? {
          id:          np.id,
          code:        np.code,
          flexxusCode: np.flexxusCode,
          createdAt:   np.createdAt,
          ocNumber:    np.rejectNotes?.startsWith('OC_CLIENTE:') ? np.rejectNotes.slice(11) : null,
        } : null,
        resumen: {
          totalPres:    Math.round(totalPres * 100) / 100,
          totalNP:      Math.round(totalNP   * 100) / 100,
          diferencia:   Math.round((totalNP - totalPres) * 100) / 100,
          conversion:   totalPres > 0 ? Math.round((totalNP / totalPres) * 100) : null,
          itemsTotal:   rows.length,
          itemsIguales:          rows.filter(r => r.estado === 'igual').length,
          itemsCantDistinta:     rows.filter(r => r.estado === 'cantidad_distinta').length,
          itemsNoCompro:         rows.filter(r => r.estado === 'no_compro').length,
          itemsAgregado:         rows.filter(r => r.estado === 'agregado').length,
        },
        items: rows,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Comparativa error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
