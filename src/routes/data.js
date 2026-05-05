const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/data/users
router.get('/users', authMiddleware, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true, zone: true },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// GET /api/data/stages
router.get('/stages', authMiddleware, async (req, res) => {
  const stages = await prisma.stageDefinition.findMany({
    where: { active: true },
    orderBy: [{ phase: 'asc' }, { order: 'asc' }],
  });
  const f1 = stages.filter(s => s.phase === 'COTIZACION').map(s => ({ id: s.stageKey, label: s.label, tone: s.tone, mandatory: s.mandatory, maxHours: s.maxHours }));
  const f2 = stages.filter(s => s.phase === 'ORDEN_COMPRA').map(s => ({ id: s.stageKey, label: s.label, tone: s.tone, mandatory: s.mandatory, maxHours: s.maxHours }));
  res.json({ f1, f2 });
});

// GET /api/data/activity
router.get('/activity', authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
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

// GET /api/data/dashboard - Stats for admin dashboard
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const [totalQuotes, sentQuotes, activeOrders, deliveredOrders] = await Promise.all([
      prisma.quote.count({ where: { stage: { notIn: ['aceptada', 'rechazada'] } } }),
      prisma.quote.count({ where: { stage: 'enviado' } }),
      prisma.order.count({ where: { stage: { notIn: ['entregada'] } } }),
      prisma.order.count({ where: { stage: 'entregada' } }),
    ]);

    const totalAmount = await prisma.quote.aggregate({
      _sum: { amount: true },
      where: { amount: { not: null } },
    });

    const accepted = await prisma.quote.count({ where: { stage: 'aceptada' } });
    const total = await prisma.quote.count();
    const conversionRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    res.json({
      cotizacionesActivas: totalQuotes,
      presupuestosEnviados: sentQuotes,
      ocEnCurso: activeOrders,
      entregasEsteMes: deliveredOrders,
      montoTotal: totalAmount._sum.amount || 0,
      tasaConversion: conversionRate,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /data/charts/sellers
router.get('/charts/sellers', authMiddleware, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true, role: { in: ['VENDEDOR', 'ADMIN'] } },
      select: { id: true, name: true },
    });
    const result = await Promise.all(users.map(async (u) => {
      const [cotiz, ganadas] = await Promise.all([
        prisma.quote.count({ where: { sellerId: u.id } }),
        prisma.quote.count({ where: { sellerId: u.id, stage: 'aceptada' } }),
      ]);
      return { name: u.name.split(' ')[0], cotiz, ganadas };
    }));
    res.json(result.filter(r => r.cotiz > 0));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/stages
router.get('/charts/stages', authMiddleware, async (req, res) => {
  try {
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
      const value = await prisma.quote.count({ where: { stage: s.stageKey } });
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
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    const { mandatory, maxHours } = req.body;
    const data = {};
    if (mandatory !== undefined) data.mandatory = mandatory;
    if (maxHours  !== undefined) data.maxHours  = maxHours || null;
    const updated = await prisma.stageDefinition.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /data/charts/monthly
router.get('/charts/monthly', authMiddleware, async (req, res) => {
  try {
    const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const [recibidas, ganadas] = await Promise.all([
        prisma.quote.count({ where: { createdAt: { gte: start, lte: end } } }),
        prisma.quote.count({ where: { stage: 'aceptada', createdAt: { gte: start, lte: end } } }),
      ]);
      months.push({ month: MONTHS_ES[d.getMonth()], recibidas, ganadas });
    }
    res.json(months);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
