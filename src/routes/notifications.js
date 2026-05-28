const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { runStageAlerts } = require('../services/notifier');
const prisma = require('../db');

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// GET /api/notifications/inbox — alertas accionables según el rol del usuario
router.get('/inbox', authMiddleware, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const now = new Date();
    const alerts = [];

    if (role === 'ADMIN') {
      // 1. Solicitudes sin vendedor asignado
      const unassigned = await prisma.quote.count({
        where: { stage: 'recibida', sellerId: null, isDraft: false },
      });
      if (unassigned > 0) {
        alerts.push({
          id: 'unassigned-quotes',
          type: 'UNASSIGNED_QUOTES',
          severity: 'high',
          icon: 'user-x',
          title: `${unassigned} solicitud${unassigned > 1 ? 'es' : ''} sin asignar`,
          description: 'Cotizaciones en "Solicitud Recibida" sin vendedor asignado.',
          action: { label: 'Ver solicitudes', view: 'quotes', filter: { stage: 'recibida' } },
          count: unassigned,
        });
      }

      // 2. Presupuestos de mail sin vincular a solicitud
      const unlinkedPres = await prisma.quote.count({
        where: { mailType: 'PRESUPUESTO', linkedQuoteId: null, stage: { notIn: ['rechazada'] } },
      });
      if (unlinkedPres > 0) {
        alerts.push({
          id: 'unlinked-presupuestos',
          type: 'UNLINKED_PRESUPUESTOS',
          severity: 'medium',
          icon: 'link-2-off',
          title: `${unlinkedPres} presupuesto${unlinkedPres > 1 ? 's' : ''} sin vincular`,
          description: 'Presupuestos recibidos por mail que aún no están vinculados a una solicitud.',
          action: { label: 'Ver presupuestos', view: 'quotes', filter: { mailType: 'PRESUPUESTO' } },
          count: unlinkedPres,
        });
      }

      // 3. Usuarios pendientes de aprobación
      const pendingUsers = await prisma.user.count({
        where: { pendingApproval: true },
      });
      if (pendingUsers > 0) {
        alerts.push({
          id: 'pending-users',
          type: 'PENDING_USERS',
          severity: 'high',
          icon: 'user-check',
          title: `${pendingUsers} usuario${pendingUsers > 1 ? 's' : ''} esperando aprobación`,
          description: 'Usuarios registrados que necesitan aprobación de admin.',
          action: { label: 'Ver equipo', view: 'team' },
          count: pendingUsers,
        });
      }

      // 4. Cotizaciones con tiempo de etapa excedido (todas)
      const overdueQuotes = await _getOverdueItems(prisma, now, null);
      if (overdueQuotes.total > 0) {
        alerts.push({
          id: 'overdue-stages',
          type: 'OVERDUE_STAGES',
          severity: 'medium',
          icon: 'clock-alert',
          title: `${overdueQuotes.total} ítem${overdueQuotes.total > 1 ? 's' : ''} con tiempo de etapa excedido`,
          description: overdueQuotes.detail,
          action: { label: 'Ver cotizaciones', view: 'quotes' },
          count: overdueQuotes.total,
          items: overdueQuotes.items,
        });
      }

    } else if (role === 'VENDEDOR') {
      // 1. Cotizaciones del vendedor con followUpDate vencido
      const followUps = await prisma.quote.count({
        where: {
          sellerId: userId,
          followUpDate: { lte: now },
          stage: { notIn: ['aceptada', 'rechazada'] },
        },
      });
      if (followUps > 0) {
        alerts.push({
          id: 'follow-up-due',
          type: 'FOLLOW_UP_DUE',
          severity: 'high',
          icon: 'calendar-clock',
          title: `${followUps} cotización${followUps > 1 ? 'es' : ''} con seguimiento vencido`,
          description: 'Clientes que deberían haber respondido el presupuesto.',
          action: { label: 'Ver mis cotizaciones', view: 'quotes' },
          count: followUps,
        });
      }

      // 2. Cotizaciones del vendedor con tiempo de etapa excedido
      const overdueQuotes = await _getOverdueItems(prisma, now, userId);
      if (overdueQuotes.total > 0) {
        alerts.push({
          id: 'overdue-stages',
          type: 'OVERDUE_STAGES',
          severity: 'medium',
          icon: 'clock-alert',
          title: `${overdueQuotes.total} ítem${overdueQuotes.total > 1 ? 's' : ''} con tiempo de etapa excedido`,
          description: overdueQuotes.detail,
          action: { label: 'Ver cotizaciones', view: 'quotes' },
          count: overdueQuotes.total,
          items: overdueQuotes.items,
        });
      }
    }

    res.json(alerts);
  } catch (err) {
    console.error('GET /notifications/inbox error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Función interna: detecta quotes/orders cuyo tiempo en la etapa actual supera maxHours
async function _getOverdueItems(prisma, now, sellerId) {
  const stagesWithLimit = await prisma.stageDefinition.findMany({
    where: { maxHours: { not: null }, active: true },
  });
  if (!stagesWithLimit.length) return { total: 0, detail: '', items: [] };

  const items = [];
  for (const stageDef of stagesWithLimit) {
    const cutoff = new Date(now.getTime() - stageDef.maxHours * 3600 * 1000);
    const where = {
      stage: stageDef.stageKey,
      NOT: { stage: { in: ['aceptada', 'rechazada'] } },
      ...(sellerId ? { sellerId } : {}),
    };

    const quotes = await prisma.quote.findMany({
      where,
      select: { id: true, code: true, stageChangedAt: true, createdAt: true, client: { select: { name: true } } },
      take: 5,
    });
    for (const q of quotes) {
      const changedAt = q.stageChangedAt || q.createdAt;
      if (changedAt <= cutoff) {
        items.push({ kind: 'quote', code: q.code, id: q.id, stage: stageDef.label, clientName: q.client?.name });
      }
    }
  }

  if (!items.length) return { total: 0, detail: '', items: [] };
  const example = items[0];
  const detail = `${example.code}${items.length > 1 ? ` y ${items.length - 1} más` : ''} superaron el tiempo en su etapa.`;
  return { total: items.length, detail, items };
}

// POST /api/notifications/cron/stage-alerts — ejecuta el check de alertas por etapa
// Protegido por CRON_SECRET en headers (Railway lo puede llamar por cron schedule)
router.post('/cron/stage-alerts', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  const CRON_SECRET = process.env.CRON_SECRET;
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runStageAlerts();
    res.json({ ok: true, ran: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/notifications/rules
router.get('/rules', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rules = await prisma.notificationRule.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/rules
router.post('/rules', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, trigger, stageFrom, stageTo, idleHours, subject, body, sendTo } = req.body;
    if (!name || !trigger || !subject || !body) {
      return res.status(400).json({ error: 'name, trigger, subject y body son requeridos' });
    }
    const rule = await prisma.notificationRule.create({
      data: { name, trigger, stageFrom: stageFrom || null, stageTo: stageTo || null,
              idleHours: idleHours || null, subject, body, sendTo: sendTo || 'SELLER' },
    });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/rules/:id
router.put('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, trigger, stageFrom, stageTo, idleHours, subject, body, sendTo, active } = req.body;
    const data = {};
    if (name      !== undefined) data.name      = name;
    if (trigger   !== undefined) data.trigger   = trigger;
    if (stageFrom !== undefined) data.stageFrom = stageFrom || null;
    if (stageTo   !== undefined) data.stageTo   = stageTo   || null;
    if (idleHours !== undefined) data.idleHours = idleHours || null;
    if (subject   !== undefined) data.subject   = subject;
    if (body      !== undefined) data.body      = body;
    if (sendTo    !== undefined) data.sendTo    = sendTo;
    if (active    !== undefined) data.active    = active;
    const rule = await prisma.notificationRule.update({ where: { id: req.params.id }, data });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/rules/:id
router.delete('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await prisma.notificationRule.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
