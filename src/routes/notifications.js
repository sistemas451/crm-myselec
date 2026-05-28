const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { runStageAlerts, runWeeklyReport } = require('../services/notifier');
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

    // Leer umbral de inactividad configurable
    const idleInboxSetting = await prisma.appSetting.findUnique({ where: { key: 'idle_inbox_days' } });
    const idleInboxDays    = parseInt(idleInboxSetting?.value ?? '5', 10);
    const idleCutoff       = new Date(now.getTime() - idleInboxDays * 86400 * 1000);

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

      // 5. Cotizaciones activas sin actividad en X días (configurable)
      const idleQuotesAdmin = await prisma.quote.count({
        where: {
          isDraft: false,
          stage: { notIn: ['aceptada', 'rechazada'] },
          updatedAt: { lte: idleCutoff },
        },
      });
      if (idleQuotesAdmin > 0) {
        alerts.push({
          id: 'idle-quotes',
          type: 'IDLE_QUOTES',
          severity: 'low',
          icon: 'clock',
          title: `${idleQuotesAdmin} cotización${idleQuotesAdmin > 1 ? 'es' : ''} sin actividad (>${idleInboxDays} días)`,
          description: `Cotizaciones activas que no tuvieron movimiento en más de ${idleInboxDays} días.`,
          action: { label: 'Ver cotizaciones', view: 'quotes' },
          count: idleQuotesAdmin,
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

      // 3. Cotizaciones del vendedor sin actividad en X días (configurable)
      const idleQuotesVend = await prisma.quote.count({
        where: {
          sellerId: userId,
          isDraft: false,
          stage: { notIn: ['aceptada', 'rechazada'] },
          updatedAt: { lte: idleCutoff },
        },
      });
      if (idleQuotesVend > 0) {
        alerts.push({
          id: 'idle-quotes',
          type: 'IDLE_QUOTES',
          severity: 'low',
          icon: 'clock',
          title: `${idleQuotesVend} cotización${idleQuotesVend > 1 ? 'es' : ''} sin actividad (>${idleInboxDays} días)`,
          description: `Tus cotizaciones activas que no tuvieron movimiento en más de ${idleInboxDays} días.`,
          action: { label: 'Ver mis cotizaciones', view: 'quotes' },
          count: idleQuotesVend,
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

// POST /api/notifications/cron/weekly-report — fuerza el envío del resumen semanal
// Solo admin autenticado puede dispararlo manualmente; ignora restricción de día/hora.
// Ejecuta paso a paso y devuelve diagnóstico exacto si algo falla.
router.post('/cron/weekly-report', authMiddleware, adminOnly, async (req, res) => {
  const diag = {};
  try {
    const { sendMail } = require('../services/mailer');

    // Paso 1: obtener admins
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { email: true, name: true },
    });
    diag.step = 'admins'; diag.adminEmails = admins.map(a => a.email);
    if (!admins.length) return res.json({ ok: false, error: 'No hay admins activos', diag });

    // Paso 2: construir stats básicos
    const now = new Date();
    const argTime = new Date(now.getTime() - 3 * 3600 * 1000);
    const reportDate = argTime.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const weekStart = new Date(now.getTime() - 7 * 86400000);

    const [quotesThisWeek, wonThisWeek] = await Promise.all([
      prisma.quote.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.quote.count({ where: { stage: 'aceptada', updatedAt: { gte: weekStart } } }),
    ]);
    diag.step = 'stats'; diag.quotesThisWeek = quotesThisWeek; diag.wonThisWeek = wonThisWeek;

    const allQuotes = await prisma.quote.findMany({
      where: { isDraft: false },
      select: { stage: true, amount: true, sellerId: true },
    });
    diag.step = 'allQuotes'; diag.total = allQuotes.length;

    const totalActive = allQuotes.filter(q => !['aceptada','rechazada'].includes(q.stage)).length;
    const totalMonto  = allQuotes.reduce((s, q) => s + (q.amount || 0), 0);
    const APP_URL = process.env.APP_URL || 'https://crm-gerenciando-canales-production-c7d6.up.railway.app';

    // Paso 3: enviar mail de prueba con HTML simplificado
    diag.step = 'sendMail';
    const subject = `📊 Resumen semanal MySelec CRM — ${reportDate}`;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:sans-serif">
<div style="max-width:620px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:#1B2A4A;padding:32px 36px 28px">
    <div style="color:#fff;font-size:20px;font-weight:700">📊 Resumen Semanal</div>
    <div style="color:#94A3B8;font-size:13px;margin-top:4px">MySelec CRM · ${reportDate}</div>
  </div>
  <div style="padding:28px 36px">
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Nuevas cotizaciones</div>
        <div style="font-size:28px;font-weight:700;color:#1B2A4A">${quotesThisWeek}</div>
        <div style="font-size:11px;color:#94A3B8">últimos 7 días</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Ganadas esta semana</div>
        <div style="font-size:28px;font-weight:700;color:#22C55E">${wonThisWeek}</div>
        <div style="font-size:11px;color:#94A3B8">${totalActive} activas en total</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Monto total pipeline</div>
        <div style="font-size:22px;font-weight:700;color:#1B2A4A">U$S ${Math.round(totalMonto).toLocaleString('es-AR')}</div>
        <div style="font-size:11px;color:#94A3B8">cotizaciones activas</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Cotizaciones activas</div>
        <div style="font-size:28px;font-weight:700;color:#1B2A4A">${totalActive}</div>
        <div style="font-size:11px;color:#94A3B8">en pipeline</div>
      </div>
    </div>
    <div style="text-align:center;margin-top:28px">
      <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
        Abrir el CRM →
      </a>
    </div>
    <div style="font-size:11px;color:#CBD5E1;margin-top:20px;text-align:center">
      Generado automáticamente por MySelec CRM
    </div>
  </div>
</div>
</body></html>`;

    await sendMail({ to: admins.map(a => a.email), subject, html });
    diag.step = 'done';

    // Registrar envío
    await prisma.appSetting.upsert({
      where:  { key: 'weekly_report_last_sent' },
      update: { value: now.toISOString() },
      create: { key: 'weekly_report_last_sent', value: now.toISOString() },
    });

    res.json({ ok: true, ran: now.toISOString(), sentTo: admins.map(a => a.email), diag });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack?.split('\n').slice(0,5), diag });
  }
});

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
