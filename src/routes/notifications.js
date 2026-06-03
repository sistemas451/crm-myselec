const express = require('express');
const {authMiddleware, isAdmin } = require('../middleware/auth');
const { runStageAlerts, runWeeklyReport } = require('../services/notifier');
const prisma = require('../db');

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// Helper: leer un AppSetting booleano con default true
async function getFlag(key) {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    return row ? row.value !== 'false' : true;
  } catch { return true; }
}

// Helper: preferencias in-app del usuario ({ inapp: { key: bool } })
function userInappPref(prefs, key) {
  if (!prefs || typeof prefs !== 'object') return true;
  const inapp = prefs.inapp;
  if (!inapp || typeof inapp !== 'object') return true;
  return inapp[key] !== false; // default true si no está definido
}

// GET /api/notifications/inbox — alertas accionables según el rol del usuario
router.get('/inbox', authMiddleware, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const now = new Date();
    const alerts = [];

    // Leer usuario completo para prefs personales + settings del sistema
    const [userFull, idleInboxSetting, solSetting, followUpUpcomingSetting, noResponseSetting, sysFlags] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } }),
      prisma.appSetting.findUnique({ where: { key: 'idle_inbox_days' } }),
      prisma.appSetting.findUnique({ where: { key: 'solicitud_sin_pres_days' } }),
      prisma.appSetting.findUnique({ where: { key: 'follow_up_upcoming_days' } }),
      prisma.appSetting.findUnique({ where: { key: 'no_response_days' } }),
      Promise.all([
        getFlag('inapp_unassigned_quotes'),
        getFlag('inapp_pending_users'),
        getFlag('inapp_overdue_stages'),
        getFlag('inapp_idle_quotes'),
        getFlag('inapp_follow_up'),
        getFlag('inapp_unlinked_solicitudes'),
        getFlag('inapp_follow_up_upcoming'),
        getFlag('inapp_no_response'),
      ]),
    ]);
    const [sysUnassigned, sysPending, sysOverdue, sysIdle, sysFollowUp, sysUnlinkedSol, sysFollowUpUpcoming, sysNoResponse] = sysFlags;
    const prefs = userFull?.notificationPrefs || {};
    const idleInboxDays      = parseInt(idleInboxSetting?.value       ?? '5', 10);
    const solSinPresDays     = parseInt(solSetting?.value             ?? '3', 10);
    const followUpUpcomingDays = parseInt(followUpUpcomingSetting?.value ?? '1', 10);
    const noResponseDays     = parseInt(noResponseSetting?.value ?? '4', 10);
    const idleCutoff         = new Date(now.getTime() - idleInboxDays * 86400 * 1000);
    const solCutoff          = new Date(now.getTime() - solSinPresDays * 86400 * 1000);
    const noResponseCutoff   = new Date(now.getTime() - noResponseDays * 86400 * 1000);
    const followUpUpcomingEnd = new Date(now.getTime() + followUpUpcomingDays * 86400 * 1000);

    // "Nuevo desde la última vez que el usuario abrió la campanita"
    const lastCheck = prefs.lastInboxCheck ? new Date(prefs.lastInboxCheck) : null;

    // Función: un alert está pospuesto si dismissed[key] > now
    const isDismissed = (key) => {
      const until = prefs.dismissed?.[key];
      return until && new Date(until) > now;
    };

    if (isAdmin(req.user)) {
      // 1. Solicitudes sin vendedor asignado
      if (sysUnassigned && userInappPref(prefs, 'unassigned_quotes')) {
        const unassigned = await prisma.quote.count({
          where: { stage: 'recibida', sellerId: null, isDraft: false },
        });
        if (unassigned > 0) alerts.push({
          id: 'unassigned-quotes', type: 'UNASSIGNED_QUOTES', severity: 'high', icon: 'user-x',
          title: `${unassigned} solicitud${unassigned > 1 ? 'es' : ''} sin asignar`,
          description: 'Cotizaciones en "Solicitud Recibida" sin vendedor asignado.',
          action: { label: 'Ver solicitudes', view: 'quotes', filter: { stage: 'recibida' } },
          count: unassigned,
        });
      }

      // 2. Usuarios pendientes de aprobación
      if (sysPending && userInappPref(prefs, 'pending_users')) {
        const pendingUsers = await prisma.user.count({ where: { pendingApproval: true } });
        if (pendingUsers > 0) alerts.push({
          id: 'pending-users', type: 'PENDING_USERS', severity: 'high', icon: 'user-check',
          title: `${pendingUsers} usuario${pendingUsers > 1 ? 's' : ''} esperando aprobación`,
          description: 'Usuarios registrados que necesitan aprobación de admin.',
          action: { label: 'Ver equipo', view: 'team' },
          count: pendingUsers,
        });
      }

      // 3. Cotizaciones con tiempo de etapa excedido (todas) — con newCount + byStage + dismissable
      if (sysOverdue && userInappPref(prefs, 'overdue_stages') && !isDismissed('overdue_stages')) {
        const overdueResult = await _getOverdueItems(prisma, now, null, lastCheck);
        if (overdueResult.total > 0) {
          const nc = overdueResult.newCount;
          const stageDesc = _formatByStage(overdueResult.byStage);
          alerts.push({
            id: 'overdue-stages', type: 'OVERDUE_STAGES', severity: 'medium', icon: 'clock-alert',
            title: nc > 0
              ? `${nc} nueva${nc > 1 ? 's' : ''} con tiempo de etapa excedido`
              : `${overdueResult.total} ítem${overdueResult.total > 1 ? 's' : ''} con tiempo de etapa excedido`,
            description: stageDesc || (nc > 0
              ? `${nc} nueva${nc > 1 ? 's' : ''} desde tu última visita (${overdueResult.total} en total).`
              : overdueResult.detail),
            action: { label: 'Ver cotizaciones', view: 'quotes' },
            count: overdueResult.total, newCount: nc, items: overdueResult.items,
            dismissable: true, dismissKey: 'overdue_stages',
          });
        }
      }

      // 4. Cotizaciones activas sin actividad en X días — con newCount + dismissable
      if (sysIdle && userInappPref(prefs, 'idle_quotes') && !isDismissed('idle_quotes')) {
        const idleBase = { isDraft: false, stage: { notIn: ['aceptada', 'rechazada'] }, updatedAt: { lte: idleCutoff } };
        const [total, newIdle] = await Promise.all([
          prisma.quote.count({ where: idleBase }),
          lastCheck
            ? prisma.quote.count({
                where: { ...idleBase, updatedAt: { gt: new Date(lastCheck.getTime() - idleInboxDays * 86400 * 1000), lte: idleCutoff } },
              })
            : Promise.resolve(0),
        ]);
        if (total > 0) {
          alerts.push({
            id: 'idle-quotes', type: 'IDLE_QUOTES', severity: 'low', icon: 'clock',
            title: newIdle > 0
              ? `${newIdle} cotización${newIdle > 1 ? 'es' : ''} nueva${newIdle > 1 ? 's' : ''} sin actividad`
              : `${total} cotización${total > 1 ? 'es' : ''} sin actividad (>${idleInboxDays} días)`,
            description: newIdle > 0
              ? `${newIdle} nueva${newIdle > 1 ? 's' : ''} desde tu última visita (${total} en total, >${idleInboxDays} días sin movimiento).`
              : `Cotizaciones activas que no tuvieron movimiento en más de ${idleInboxDays} días.`,
            action: { label: 'Ver cotizaciones', view: 'quotes' },
            count: total, newCount: newIdle,
            dismissable: true, dismissKey: 'idle_quotes',
          });
        }
      }

      // 5. Solicitudes sin presupuesto vinculado en más de X días
      if (sysUnlinkedSol && userInappPref(prefs, 'unlinked_solicitudes') && !isDismissed('unlinked_solicitudes')) {
        const unlinkedSolicitudes = await prisma.quote.findMany({
          where: {
            mailType: 'SOLICITUD', linkedQuoteId: null, isDraft: false,
            stage: { notIn: ['aceptada', 'rechazada'] },
            createdAt: { lte: solCutoff },
          },
          select: { id: true, code: true, createdAt: true, client: { select: { name: true } } },
          take: 10,
        });
        if (unlinkedSolicitudes.length > 0) {
          alerts.push({
            id: 'unlinked-solicitudes', type: 'UNLINKED_SOLICITUDES', severity: 'high', icon: 'file-question',
            title: `${unlinkedSolicitudes.length} solicitud${unlinkedSolicitudes.length > 1 ? 'es' : ''} sin presupuesto (>${solSinPresDays}d)`,
            description: `Solicitudes sin presupuesto vinculado hace más de ${solSinPresDays} días.`,
            action: { label: 'Ver solicitudes', view: 'quotes' },
            count: unlinkedSolicitudes.length,
            items: unlinkedSolicitudes.map(q => ({
              code: q.code,
              clientName: q.client?.name,
              daysOld: Math.floor((now - new Date(q.createdAt)) / 86400000),
            })),
            dismissable: true, dismissKey: 'unlinked_solicitudes',
          });
        }
      }

    } else if (role === 'VENDEDOR') {
      // 0. Cotizaciones nuevas asignadas por otro usuario (admin/developer)
      {
        const since = lastCheck || new Date(now.getTime() - 48 * 3600 * 1000);
        const recentAssigned = await prisma.quote.findMany({
          where: { sellerId: userId, isDraft: false, createdAt: { gte: since } },
          select: { id: true, code: true, createdAt: true, client: { select: { name: true } } },
          take: 10,
        });
        if (recentAssigned.length > 0) {
          const quoteIds = recentAssigned.map(q => q.id);
          const createdActivities = await prisma.activity.findMany({
            where: { quoteId: { in: quoteIds }, action: 'CREATED' },
            select: { quoteId: true, userId: true, user: { select: { name: true } } },
          });
          const createdByMap = Object.fromEntries(createdActivities.map(a => [a.quoteId, a]));
          // Solo las creadas por alguien que NO es el propio vendedor
          const assignedByOther = recentAssigned.filter(q => {
            const act = createdByMap[q.id];
            return act && act.userId !== userId;
          });
          if (assignedByOther.length > 0) {
            const creators = [...new Set(assignedByOther.map(q => createdByMap[q.id]?.user?.name).filter(Boolean))];
            const creatorStr = creators.length === 1 ? creators[0] : `${creators[0]} y otros`;
            alerts.push({
              id: 'assigned-quotes', type: 'ASSIGNED_QUOTES', severity: 'high', icon: 'user-plus',
              title: `${assignedByOther.length} cotización${assignedByOther.length > 1 ? 'es' : ''} nueva${assignedByOther.length > 1 ? 's' : ''} asignada${assignedByOther.length > 1 ? 's' : ''}`,
              description: `${creatorStr} te asignó${assignedByOther.length > 1 ? ' ' : ' '}${assignedByOther.length === 1 ? 'una nueva cotización' : `${assignedByOther.length} cotizaciones`}.`,
              action: { label: 'Ver mis cotizaciones', view: 'quotes' },
              count: assignedByOther.length,
              items: assignedByOther.map(q => ({
                id: q.id, code: q.code,
                clientName: q.client?.name,
                assignedBy: createdByMap[q.id]?.user?.name || 'Administrador',
              })),
            });
          }
        }
      }

      // 1. Cotizaciones del vendedor con followUpDate vencido
      if (sysFollowUp && userInappPref(prefs, 'follow_up')) {
        const followUps = await prisma.quote.count({
          where: { sellerId: userId, followUpDate: { lte: now }, stage: { notIn: ['aceptada', 'rechazada'] } },
        });
        if (followUps > 0) alerts.push({
          id: 'follow-up-due', type: 'FOLLOW_UP_DUE', severity: 'high', icon: 'calendar-clock',
          title: `${followUps} cotización${followUps > 1 ? 'es' : ''} con seguimiento vencido`,
          description: 'Clientes que deberían haber respondido el presupuesto.',
          action: { label: 'Ver mis cotizaciones', view: 'quotes' },
          count: followUps,
        });
      }

      // 2. Cotizaciones del vendedor con tiempo de etapa excedido — con newCount + byStage + dismissable
      if (sysOverdue && userInappPref(prefs, 'overdue_stages') && !isDismissed('overdue_stages')) {
        const overdueResult = await _getOverdueItems(prisma, now, userId, lastCheck);
        if (overdueResult.total > 0) {
          const nc = overdueResult.newCount;
          const stageDesc = _formatByStage(overdueResult.byStage);
          alerts.push({
            id: 'overdue-stages', type: 'OVERDUE_STAGES', severity: 'medium', icon: 'clock-alert',
            title: nc > 0
              ? `${nc} nueva${nc > 1 ? 's' : ''} con tiempo de etapa excedido`
              : `${overdueResult.total} ítem${overdueResult.total > 1 ? 's' : ''} con tiempo de etapa excedido`,
            description: stageDesc || (nc > 0
              ? `${nc} nueva${nc > 1 ? 's' : ''} desde tu última visita (${overdueResult.total} en total).`
              : overdueResult.detail),
            action: { label: 'Ver mis cotizaciones', view: 'quotes' },
            count: overdueResult.total, newCount: nc, items: overdueResult.items,
            dismissable: true, dismissKey: 'overdue_stages',
          });
        }
      }

      // 3. Cotizaciones del vendedor sin actividad en X días — con newCount + dismissable
      if (sysIdle && userInappPref(prefs, 'idle_quotes') && !isDismissed('idle_quotes')) {
        const idleBase = {
          sellerId: userId, isDraft: false,
          stage: { notIn: ['aceptada', 'rechazada'] }, updatedAt: { lte: idleCutoff },
        };
        const [total, newIdle] = await Promise.all([
          prisma.quote.count({ where: idleBase }),
          lastCheck
            ? prisma.quote.count({
                where: { ...idleBase, updatedAt: { gt: new Date(lastCheck.getTime() - idleInboxDays * 86400 * 1000), lte: idleCutoff } },
              })
            : Promise.resolve(0),
        ]);
        if (total > 0) {
          alerts.push({
            id: 'idle-quotes', type: 'IDLE_QUOTES', severity: 'low', icon: 'clock',
            title: newIdle > 0
              ? `${newIdle} cotización${newIdle > 1 ? 'es' : ''} nueva${newIdle > 1 ? 's' : ''} sin actividad`
              : `${total} cotización${total > 1 ? 'es' : ''} sin actividad (>${idleInboxDays} días)`,
            description: newIdle > 0
              ? `${newIdle} nueva${newIdle > 1 ? 's' : ''} desde tu última visita (${total} en total, >${idleInboxDays} días sin movimiento).`
              : `Tus cotizaciones activas que no tuvieron movimiento en más de ${idleInboxDays} días.`,
            action: { label: 'Ver mis cotizaciones', view: 'quotes' },
            count: total, newCount: newIdle,
            dismissable: true, dismissKey: 'idle_quotes',
          });
        }
      }
      // 4. Solicitudes del vendedor sin presupuesto en más de X días
      if (sysUnlinkedSol && userInappPref(prefs, 'unlinked_solicitudes') && !isDismissed('unlinked_solicitudes')) {
        const unlinkedSolicitudes = await prisma.quote.findMany({
          where: {
            sellerId: userId, mailType: 'SOLICITUD', linkedQuoteId: null, isDraft: false,
            stage: { notIn: ['aceptada', 'rechazada'] },
            createdAt: { lte: solCutoff },
          },
          select: { id: true, code: true, createdAt: true, client: { select: { name: true } } },
          take: 10,
        });
        if (unlinkedSolicitudes.length > 0) {
          alerts.push({
            id: 'unlinked-solicitudes', type: 'UNLINKED_SOLICITUDES', severity: 'high', icon: 'file-question',
            title: `${unlinkedSolicitudes.length} solicitud${unlinkedSolicitudes.length > 1 ? 'es' : ''} sin presupuesto (>${solSinPresDays}d)`,
            description: `Tenés solicitudes sin presupuesto enviado hace más de ${solSinPresDays} días.`,
            action: { label: 'Ver mis cotizaciones', view: 'quotes' },
            count: unlinkedSolicitudes.length,
            items: unlinkedSolicitudes.map(q => ({
              code: q.code,
              clientName: q.client?.name,
              daysOld: Math.floor((now - new Date(q.createdAt)) / 86400000),
            })),
            dismissable: true, dismissKey: 'unlinked_solicitudes',
          });
        }
      }

      // 5. Seguimientos próximos (en las siguientes X horas/días)
      if (sysFollowUpUpcoming && userInappPref(prefs, 'follow_up_upcoming')) {
        const upcoming = await prisma.quote.findMany({
          where: {
            sellerId: userId,
            followUpDate: { gt: now, lte: followUpUpcomingEnd },
            stage: { notIn: ['aceptada', 'rechazada'] },
          },
          select: { id: true, code: true, followUpDate: true, client: { select: { name: true } } },
          take: 10,
        });
        if (upcoming.length > 0) {
          alerts.push({
            id: 'follow-up-upcoming', type: 'FOLLOW_UP_UPCOMING', severity: 'low', icon: 'calendar',
            title: `${upcoming.length} seguimiento${upcoming.length > 1 ? 's' : ''} próximo${upcoming.length > 1 ? 's' : ''}`,
            description: `Cotizaciones con seguimiento en las próximas ${followUpUpcomingDays <= 1 ? '24 horas' : followUpUpcomingDays + ' días'}.`,
            action: { label: 'Ver mis cotizaciones', view: 'quotes' },
            count: upcoming.length,
            items: upcoming.map(q => ({
              code: q.code,
              clientName: q.client?.name,
              followUpDate: q.followUpDate,
            })),
          });
        }
      }

      // 6. Presupuestos sin respuesta — enviados hace >X días sin actividad del cliente
      if (sysNoResponse && userInappPref(prefs, 'no_response')) {
        // Buscar presupuestos enviados sin respuesta
        const noResponseQuotes = await prisma.quote.findMany({
          where: {
            sellerId: userId,
            mailType: 'PRESUPUESTO',
            stage: 'enviado',
            isDraft: false,
            createdAt: { lte: noResponseCutoff },
          },
          select: {
            id: true, code: true, flexxusCode: true, amount: true, createdAt: true,
            client: { select: { id: true, name: true, email: true } },
          },
          take: 15,
        });

        if (noResponseQuotes.length > 0) {
          // Filtrar: excluir los que ya tienen actividad reciente (nota de respuesta o reminder enviado)
          const quoteIds = noResponseQuotes.map(q => q.id);
          const recentActivity = await prisma.activity.findMany({
            where: {
              quoteId: { in: quoteIds },
              action: { in: ['NOTE', 'REMINDER_SENT'] },
              createdAt: { gte: noResponseCutoff },
            },
            select: { quoteId: true },
          });
          const activeQuoteIds = new Set(recentActivity.map(a => a.quoteId));
          const filtered = noResponseQuotes.filter(q => !activeQuoteIds.has(q.id));

          if (filtered.length > 0) {
            alerts.push({
              id: 'no-response', type: 'NO_RESPONSE', severity: 'medium', icon: 'mail-question',
              title: `${filtered.length} presupuesto${filtered.length > 1 ? 's' : ''} sin respuesta`,
              description: `Presupuestos enviados hace más de ${noResponseDays} días sin respuesta del cliente.`,
              action: { label: 'Ver mis cotizaciones', view: 'quotes' },
              count: filtered.length,
              items: filtered.map(q => ({
                id: q.id,
                code: q.code,
                flexxusCode: q.flexxusCode,
                clientName: q.client?.name,
                clientEmail: q.client?.email,
                amount: q.amount,
                daysSent: Math.floor((now - new Date(q.createdAt)) / 86400000),
                canRemind: !!q.client?.email,
              })),
            });
          }
        }
      }
    }

    res.json(alerts);
  } catch (err) {
    console.error('GET /notifications/inbox error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/mark-seen — actualiza lastInboxCheck del usuario
router.post('/mark-seen', authMiddleware, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const userFull = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs = userFull?.notificationPrefs || {};
    const updated = { ...prefs, lastInboxCheck: new Date().toISOString() };
    await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: updated } });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /notifications/mark-seen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/dismiss — pospone (snooze) una alerta por N días
// Body: { key: 'overdue_stages' | 'idle_quotes', days: 3 | 7 | 30 }
router.post('/dismiss', authMiddleware, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { key, days } = req.body;
    if (!key || !days) return res.status(400).json({ error: 'key y days son requeridos' });
    const allowedKeys = ['overdue_stages', 'idle_quotes', 'unlinked_solicitudes'];
    if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'key inválida' });
    const allowedDays = [3, 7, 30];
    const d = parseInt(days, 10);
    if (!allowedDays.includes(d)) return res.status(400).json({ error: 'days debe ser 3, 7 o 30' });

    const userFull = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs = userFull?.notificationPrefs || {};
    const until = new Date(Date.now() + d * 86400 * 1000).toISOString();
    const updated = { ...prefs, dismissed: { ...(prefs.dismissed || {}), [key]: until } };
    await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: updated } });
    res.json({ ok: true, dismissedUntil: until });
  } catch (err) {
    console.error('POST /notifications/dismiss error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Función interna: detecta quotes/orders cuyo tiempo en la etapa actual supera maxHours
// lastInboxCheck: Date | null — si se provee, calcula newCount (items que entraron DESDE la última visita)
// Retorna byStage: { stageName: count } para descripción agrupada
async function _getOverdueItems(prisma, now, sellerId, lastInboxCheck) {
  const stagesWithLimit = await prisma.stageDefinition.findMany({
    where: { maxHours: { not: null }, active: true },
  });
  if (!stagesWithLimit.length) return { total: 0, newCount: 0, detail: '', items: [], byStage: {} };

  const items = [];
  const byStage = {};
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
      take: 20,
    });
    let stageCount = 0;
    for (const q of quotes) {
      const changedAt = q.stageChangedAt || q.createdAt;
      if (changedAt <= cutoff) {
        items.push({
          kind: 'quote', code: q.code, id: q.id,
          stage: stageDef.label, clientName: q.client?.name,
          becameOverdueAt: changedAt,
        });
        stageCount++;
      }
    }
    if (stageCount > 0) byStage[stageDef.label] = stageCount;
  }

  if (!items.length) return { total: 0, newCount: 0, detail: '', items: [], byStage: {} };

  // newCount: items que se volvieron overdue DESPUÉS del lastInboxCheck
  let newCount = 0;
  if (lastInboxCheck) {
    newCount = items.filter(i => i.becameOverdueAt > lastInboxCheck).length;
  }

  const example = items[0];
  const detail = `${example.code}${items.length > 1 ? ` y ${items.length - 1} más` : ''} superaron el tiempo en su etapa.`;
  return { total: items.length, newCount, detail, items, byStage };
}

// Formatea byStage como "3 en Presupuesto Enviado · 2 en Revisión"
function _formatByStage(byStage) {
  if (!byStage || !Object.keys(byStage).length) return '';
  return Object.entries(byStage)
    .map(([stage, count]) => `${count} en ${stage}`)
    .join(' · ');
}

// GET /api/notifications/counts — conteos ligeros para badges del sidebar (solo admin)
router.get('/counts', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.json({ unlinkedPresupuestos: 0 });
    const unlinkedPresupuestos = await prisma.quote.count({
      where: { mailType: 'PRESUPUESTO', linkedQuoteId: null, stage: { notIn: ['rechazada'] } },
    });
    res.json({ unlinkedPresupuestos });
  } catch (err) {
    console.error('GET /notifications/counts error:', err);
    res.json({ unlinkedPresupuestos: 0 }); // fallar silencioso para no romper sidebar
  }
});

// POST /api/notifications/cron/weekly-report — fuerza el envío del resumen semanal
// Solo admin autenticado puede dispararlo manualmente; ignora restricción de día/hora.
// Ejecuta paso a paso y devuelve diagnóstico exacto si algo falla.
router.post('/cron/weekly-report', authMiddleware, adminOnly, async (req, res) => {
  const diag = {};
  try {
    const { sendMail } = require('../services/mailer');

    // Paso 1: obtener admins
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN','DEVELOPER'] }, active: true },
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
  if (!CRON_SECRET || secret !== CRON_SECRET) {
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
