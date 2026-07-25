const express = require('express');
const {authMiddleware, isAdmin, isDeveloper } = require('../middleware/auth');
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
        getFlag('inapp_deadline_overdue'),
        getFlag('inapp_mentions'),
      ]),
    ]);
    const [sysUnassigned, sysPending, sysOverdue, sysIdle, sysFollowUp, sysUnlinkedSol, sysFollowUpUpcoming, sysNoResponse, sysDeadlineOverdue, sysMentions] = sysFlags;
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

    // 0. Menciones pendientes en notas (aplica a cualquier rol)
    if (sysMentions) {
      const pendingMentions = Array.isArray(prefs.pendingMentions) ? prefs.pendingMentions : [];
      if (pendingMentions.length > 0) {
        alerts.push({
          id: 'mentions', type: 'MENTIONS', severity: 'medium', icon: 'at-sign',
          title: `${pendingMentions.length} mención${pendingMentions.length > 1 ? 'es' : ''} en notas`,
          description: 'Te etiquetaron en una nota.',
          count: pendingMentions.length,
          items: pendingMentions.slice(-10).reverse().map(m => ({
            noteId: m.noteId, kind: m.kind, id: m.id, code: m.code,
            clientName: m.clientName, text: m.text, byName: m.byName,
          })),
        });
      }
    }

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

      // 6. Solicitudes con fecha límite de armado vencida (todas)
      if (sysDeadlineOverdue && userInappPref(prefs, 'deadline_overdue') && !isDismissed('deadline_overdue')) {
        const deadlineOverdueQuotes = await prisma.quote.findMany({
          where: {
            mailType: 'SOLICITUD', linkedQuoteId: null, isDraft: false,
            stage: { notIn: ['enviado', 'aceptada', 'rechazada'] },
            deadline: { lte: now },
          },
          select: { id: true, code: true, deadline: true, client: { select: { name: true } } },
          take: 10,
        });
        if (deadlineOverdueQuotes.length > 0) {
          alerts.push({
            id: 'deadline-overdue', type: 'DEADLINE_OVERDUE', severity: 'high', icon: 'flag',
            title: `${deadlineOverdueQuotes.length} solicitud${deadlineOverdueQuotes.length > 1 ? 'es' : ''} con fecha límite vencida`,
            description: 'Solicitudes que pasaron la fecha límite para tener el presupuesto listo, sin enviar todavía.',
            action: { label: 'Ver solicitudes', view: 'quotes' },
            count: deadlineOverdueQuotes.length,
            items: deadlineOverdueQuotes.map(q => ({
              code: q.code,
              clientName: q.client?.name,
              daysOld: Math.floor((now - new Date(q.deadline)) / 86400000),
            })),
            dismissable: true, dismissKey: 'deadline_overdue',
          });
        }
      }

    } else if (role === 'VENDEDOR') {
      // 0. Cotizaciones asignadas pendientes de "Listo" (persisten hasta que el vendedor confirma)
      {
        const pendingAssigned = Array.isArray(prefs.pendingAssigned) ? prefs.pendingAssigned : [];
        if (pendingAssigned.length > 0) {
          const assignedQuotes = await prisma.quote.findMany({
            where: { id: { in: pendingAssigned }, isDraft: false },
            select: { id: true, code: true, createdAt: true, client: { select: { name: true } } },
            take: 10,
          });
          if (assignedQuotes.length > 0) {
            const quoteIds = assignedQuotes.map(q => q.id);
            const createdActivities = await prisma.activity.findMany({
              where: { quoteId: { in: quoteIds }, action: 'CREATED' },
              select: { quoteId: true, userId: true, user: { select: { name: true } } },
            });
            const createdByMap = Object.fromEntries(createdActivities.map(a => [a.quoteId, a]));
            const creators = [...new Set(assignedQuotes.map(q => createdByMap[q.id]?.user?.name).filter(Boolean))];
            const creatorStr = creators.length === 1 ? creators[0] : creators.length > 1 ? `${creators[0]} y otros` : 'Un administrador';
            alerts.push({
              id: 'assigned-quotes', type: 'ASSIGNED_QUOTES', severity: 'high', icon: 'user-plus',
              title: `${assignedQuotes.length} cotización${assignedQuotes.length > 1 ? 'es' : ''} nueva${assignedQuotes.length > 1 ? 's' : ''} asignada${assignedQuotes.length > 1 ? 's' : ''}`,
              description: `${creatorStr} te asignó${assignedQuotes.length === 1 ? ' una nueva cotización' : ` ${assignedQuotes.length} cotizaciones`}. Confirmá cada una cuando la hayas revisado.`,
              action: { label: 'Ver mis cotizaciones', view: 'quotes' },
              count: assignedQuotes.length,
              items: assignedQuotes.map(q => ({
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

      // 4b. Solicitudes del vendedor con fecha límite de armado vencida
      if (sysDeadlineOverdue && userInappPref(prefs, 'deadline_overdue') && !isDismissed('deadline_overdue')) {
        const deadlineOverdueQuotes = await prisma.quote.findMany({
          where: {
            sellerId: userId, mailType: 'SOLICITUD', linkedQuoteId: null, isDraft: false,
            stage: { notIn: ['enviado', 'aceptada', 'rechazada'] },
            deadline: { lte: now },
          },
          select: { id: true, code: true, deadline: true, client: { select: { name: true } } },
          take: 10,
        });
        if (deadlineOverdueQuotes.length > 0) {
          alerts.push({
            id: 'deadline-overdue', type: 'DEADLINE_OVERDUE', severity: 'high', icon: 'flag',
            title: `${deadlineOverdueQuotes.length} solicitud${deadlineOverdueQuotes.length > 1 ? 'es' : ''} con fecha límite vencida`,
            description: 'Tenés solicitudes que pasaron la fecha límite para tener el presupuesto listo.',
            action: { label: 'Ver mis cotizaciones', view: 'quotes' },
            count: deadlineOverdueQuotes.length,
            items: deadlineOverdueQuotes.map(q => ({
              code: q.code,
              clientName: q.client?.name,
              daysOld: Math.floor((now - new Date(q.deadline)) / 86400000),
            })),
            dismissable: true, dismissKey: 'deadline_overdue',
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
            // Usar stageChangedAt (cuándo se envió) si existe, sino createdAt como fallback
            OR: [
              { stageChangedAt: { not: null, lte: noResponseCutoff } },
              { stageChangedAt: null, createdAt: { lte: noResponseCutoff } },
            ],
          },
          select: {
            id: true, code: true, flexxusCode: true, amount: true, createdAt: true, stageChangedAt: true,
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
                daysSent: Math.floor((now - new Date(q.stageChangedAt || q.createdAt)) / 86400000),
                canRemind: !!q.client?.email,
              })),
            });
          }
        }
      }
    } else if (role === 'LOGISTICA') {
      // 1. Etapas de OC excedidas (todas las órdenes, sin filtro de vendedor)
      if (sysOverdue && userInappPref(prefs, 'overdue_stages') && !isDismissed('overdue_stages')) {
        const overdueResult = await _getOverdueItems(prisma, now, null, lastCheck);
        // Filtrar solo items de órdenes (kind === 'order')
        const orderItems = overdueResult.items.filter(i => i.kind === 'order');
        if (orderItems.length > 0) {
          const byStage = {};
          orderItems.forEach(i => { byStage[i.stage] = (byStage[i.stage] || 0) + 1; });
          const nc = lastCheck ? orderItems.filter(i => i.becameOverdueAt > lastCheck).length : 0;
          const stageDesc = _formatByStage(byStage);
          alerts.push({
            id: 'overdue-stages', type: 'OVERDUE_STAGES', severity: 'medium', icon: 'clock-alert',
            title: nc > 0
              ? `${nc} orden${nc > 1 ? 'es' : ''} nueva${nc > 1 ? 's' : ''} con etapa vencida`
              : `${orderItems.length} orden${orderItems.length > 1 ? 'es' : ''} con etapa vencida`,
            description: stageDesc || 'Órdenes que superaron el tiempo máximo en su etapa.',
            action: { label: 'Ver órdenes', view: 'orders' },
            count: orderItems.length,
            newCount: nc,
            dismissable: true,
            items: orderItems.slice(0, 5).map(i => ({ id: i.id, code: i.code, clientName: i.clientName, stage: i.stage })),
          });
        }
      }

      // 2. OCs en etapa inicial (pendientes de procesar)
      const pendingOrders = await prisma.order.count({
        where: { stage: { notIn: ['entregada'] } },
      });
      if (pendingOrders > 0) alerts.push({
        id: 'pending-orders', type: 'PENDING_ORDERS', severity: 'low', icon: 'clipboard-list',
        title: `${pendingOrders} orden${pendingOrders > 1 ? 'es' : ''} en curso`,
        description: 'Órdenes de compra activas en el tablero de logística.',
        action: { label: 'Ver órdenes', view: 'orders' },
        count: pendingOrders,
      });
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

// POST /api/notifications/ack-assigned — vendedor confirma que vio una cotización asignada
router.post('/ack-assigned', authMiddleware, async (req, res) => {
  try {
    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId requerido' });
    const { id: userId } = req.user;
    const userFull = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs   = userFull?.notificationPrefs || {};
    const pending = Array.isArray(prefs.pendingAssigned) ? prefs.pendingAssigned : [];
    await prisma.user.update({
      where: { id: userId },
      data:  { notificationPrefs: { ...prefs, pendingAssigned: pending.filter(id => id !== quoteId) } },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/ack-mention — usuario confirma que vio una mención en una nota
router.post('/ack-mention', authMiddleware, async (req, res) => {
  try {
    const { noteId } = req.body;
    if (!noteId) return res.status(400).json({ error: 'noteId requerido' });
    const { id: userId } = req.user;
    const userFull = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const prefs   = userFull?.notificationPrefs || {};
    const pending = Array.isArray(prefs.pendingMentions) ? prefs.pendingMentions : [];
    await prisma.user.update({
      where: { id: userId },
      data:  { notificationPrefs: { ...prefs, pendingMentions: pending.filter(m => m.noteId !== noteId) } },
    });
    res.json({ ok: true });
  } catch (err) {
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

    // También incluir órdenes de compra manuales en etapas con límite de tiempo
    if (stageDef.phase === 'ORDEN_COMPRA') {
      const orders = await prisma.order.findMany({
        where: { stage: stageDef.stageKey, ...(sellerId ? { sellerId } : {}) },
        select: { id: true, code: true, stageChangedAt: true, createdAt: true, client: { select: { name: true } } },
        take: 20,
      });
      for (const o of orders) {
        const changedAt = o.stageChangedAt || o.createdAt;
        if (changedAt <= cutoff) {
          items.push({
            kind: 'order', code: o.code, id: o.id,
            stage: stageDef.label, clientName: o.client?.name,
            becameOverdueAt: changedAt,
          });
          stageCount++;
        }
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

// GET /api/notifications/counts — conteos ligeros para badges del sidebar
router.get('/counts', authMiddleware, async (req, res) => {
  try {
    let unlinkedPresupuestos = 0;
    if (isAdmin(req.user)) {
      unlinkedPresupuestos = await prisma.quote.count({
        where: { mailType: 'PRESUPUESTO', linkedQuoteId: null, stage: { notIn: ['rechazada'] } },
      });
    }

    // Foro: cuántas publicaciones PROPIAS tienen una respuesta nueva de un admin/developer
    // desde la última vez que el usuario visitó el Foro (para cualquier rol, no solo admin)
    const userFull = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } });
    const lastForoCheck = userFull?.notificationPrefs?.lastForoCheck
      ? new Date(userFull.notificationPrefs.lastForoCheck)
      : new Date(0);
    const foroUnread = await prisma.feedbackPost.count({
      where: {
        userId: req.user.id,
        responses: {
          some: {
            createdAt: { gt: lastForoCheck },
            userId: { not: req.user.id },
            user: { role: { in: ['ADMIN', 'DEVELOPER'] } },
          },
        },
      },
    });

    res.json({ unlinkedPresupuestos, foroUnread });
  } catch (err) {
    console.error('GET /notifications/counts error:', err);
    res.json({ unlinkedPresupuestos: 0, foroUnread: 0 }); // fallar silencioso para no romper sidebar
  }
});

// POST /api/notifications/weekly-report/test — manda el resumen semanal real (mismo
// contenido/queries que el envío automático) solo al usuario que lo dispara, para
// previsualizarlo sin esperar al lunes ni afectar el envío real (no toca dedup ni
// respeta día/hora).
router.post('/weekly-report/test', authMiddleware, async (req, res) => {
  if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores' });
  try {
    await runWeeklyReport({ testEmail: req.user.email });
    res.json({ ok: true, sentTo: req.user.email });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/notifications/cron/weekly-report — ejecuta el chequeo del resumen semanal
// Protegido por CRON_SECRET (Railway lo puede llamar por cron schedule, ej. cada hora).
// runWeeklyReport() ya respeta el día/hora configurados en Config y evita doble envío
// (dedup por weekly_report_last_sent) — pensado para pingearse seguido sin riesgo de
// mandar de más, igual que /cron/stage-alerts. Reemplaza al setInterval de server.js
// como mecanismo confiable: ese timer se resetea en cada redeploy y puede pasar
// semanas sin coincidir nunca con el día/hora configurado.
router.post('/cron/weekly-report', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runWeeklyReport();
    res.json({ ok: true, ran: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
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
