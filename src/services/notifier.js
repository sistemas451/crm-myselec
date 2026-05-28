const { sendNotification } = require('./mailer');
const prisma = require('../db');

// Construye el contexto para templates a partir de una quote enriquecida
function buildCtx(quote, client, seller) {
  return {
    quote: {
      code:    quote.code,
      stage:   quote.stage,
      monto:   quote.amount ? `USD ${quote.amount.toLocaleString('es-AR')}` : '—',
      flexxus: quote.flexxusCode || '—',
      subject: quote.emailSubject || '—',
    },
    client: {
      name:  client?.name  || '—',
      email: client?.email || '—',
      cuit:  client?.cuit  || '—',
    },
    seller: {
      name:  seller?.name  || '—',
      email: seller?.email || '—',
    },
  };
}

// Resuelve los emails de destino según la regla y el contexto
async function resolveRecipients(rule, seller) {
  const emails = [];
  if (rule.sendTo === 'SELLER' || rule.sendTo === 'BOTH') {
    if (seller?.email) emails.push(seller.email);
  }
  if (rule.sendTo === 'ADMIN' || rule.sendTo === 'BOTH') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { email: true },
    });
    admins.forEach(a => { if (!emails.includes(a.email)) emails.push(a.email); });
  }
  return emails;
}

// Llama a esta función cuando una quote cambia de stage
async function onStageChange(quoteId, fromStage, toStage) {
  try {
    const rules = await prisma.notificationRule.findMany({
      where: {
        trigger:  'STAGE_CHANGE',
        stageTo:  toStage,
        active:   true,
        OR: [{ stageFrom: fromStage }, { stageFrom: null }],
      },
    });
    if (!rules.length) return;

    const quote  = await prisma.quote.findUnique({
      where: { id: quoteId },
      include: { client: true, seller: true },
    });
    if (!quote) return;

    const ctx = buildCtx(quote, quote.client, quote.seller);

    for (const rule of rules) {
      const emails = await resolveRecipients(rule, quote.seller);
      if (!emails.length) continue;
      await sendNotification({ toEmails: emails, subject: rule.subject, body: rule.body, ctx }).catch(e =>
        console.error(`⚠️  Notificación ${rule.name} falló:`, e.message)
      );
    }
  } catch (e) {
    console.error('onStageChange notifier error:', e.message);
  }
}

// Corre periódicamente para detectar quotes idle y follow-ups vencidos
async function runIdleCheck() {
  try {
    const rules = await prisma.notificationRule.findMany({
      where: { trigger: { in: ['IDLE_HOURS', 'FOLLOW_UP'] }, active: true },
    });

    const now = new Date();

    for (const rule of rules) {
      let quotes = [];

      if (rule.trigger === 'IDLE_HOURS' && rule.idleHours) {
        const cutoff = new Date(now - rule.idleHours * 3600 * 1000);
        quotes = await prisma.quote.findMany({
          where: {
            updatedAt: { lte: cutoff },
            stage: { notIn: ['aceptada', 'rechazada'] },
          },
          include: { client: true, seller: true },
          take: 50,
        });
      }

      if (rule.trigger === 'FOLLOW_UP') {
        quotes = await prisma.quote.findMany({
          where: {
            followUpDate: { lte: now },
            stage: { notIn: ['aceptada', 'rechazada'] },
          },
          include: { client: true, seller: true },
          take: 50,
        });
      }

      for (const quote of quotes) {
        const emails = await resolveRecipients(rule, quote.seller);
        if (!emails.length) continue;
        const ctx = buildCtx(quote, quote.client, quote.seller);
        await sendNotification({ toEmails: emails, subject: rule.subject, body: rule.body, ctx }).catch(e =>
          console.error(`⚠️  Notificación idle ${rule.name} quote ${quote.code}:`, e.message)
        );
      }
    }
  } catch (e) {
    console.error('runIdleCheck error:', e.message);
  }
}

// Corre diariamente para detectar quotes/orders que superaron el tiempo máximo de etapa
// Solo envía si la etapa tiene emailAlert=true y aún no se envió alerta hoy.
async function runStageAlerts() {
  try {
    const alertStages = await prisma.stageDefinition.findMany({
      where: { emailAlert: true, maxHours: { not: null }, active: true },
    });
    if (!alertStages.length) return;

    const now = new Date();
    const APP_URL = process.env.APP_URL || 'https://crm-gerenciando-canales-production-c7d6.up.railway.app';

    for (const stageDef of alertStages) {
      const cutoff = new Date(now.getTime() - stageDef.maxHours * 3600 * 1000);
      const since24h = new Date(now.getTime() - 23 * 3600 * 1000);

      // ── COTIZACIONES en esta etapa que superaron el tiempo ──────────────────
      const quotes = await prisma.quote.findMany({
        where: {
          stage: stageDef.stageKey,
          NOT: { stage: { in: ['aceptada', 'rechazada'] } },
        },
        include: { client: true, seller: true, activities: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });

      for (const quote of quotes) {
        const changedAt = quote.stageChangedAt || quote.createdAt;
        if (changedAt > cutoff) continue; // aún dentro del tiempo límite

        // Evitar duplicados: no enviar si ya se alertó en las últimas 23h
        const alreadySent = quote.activities.some(
          a => a.action === 'STAGE_ALERT_SENT' && new Date(a.createdAt) >= since24h
        );
        if (alreadySent) continue;

        const seller = quote.seller;
        const emails = [];
        if (seller?.email) emails.push(seller.email);
        if (!emails.length) continue;

        const hoursElapsed = Math.round((now - changedAt) / 3600000);
        const subject = `⏰ ${quote.code} lleva ${hoursElapsed}h en "${stageDef.label}"`;
        const body = `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1B2A4A">Recordatorio de seguimiento</h2>
            <p>La cotización <strong>${quote.code}</strong>${quote.client ? ` de <strong>${quote.client.name}</strong>` : ''} lleva <strong>${hoursElapsed} horas</strong> en la etapa <strong>"${stageDef.label}"</strong>.</p>
            <p style="color:#64748B">Tiempo máximo configurado: ${stageDef.maxHours} horas.</p>
            <p>
              <a href="${APP_URL}" style="display:inline-block;padding:10px 22px;background:#3B82F6;color:white;text-decoration:none;border-radius:8px;font-weight:600">
                Ver en el CRM →
              </a>
            </p>
          </div>`;

        const { sendMail } = require('./mailer');
        await sendMail({ to: emails, subject, html: body }).catch(e =>
          console.error(`⚠️  Stage alert mail para ${quote.code} falló:`, e.message)
        );

        // Registrar en Activity para no re-enviar
        await prisma.activity.create({
          data: {
            action: 'STAGE_ALERT_SENT',
            detail: `Alerta de tiempo enviada: ${quote.code} lleva ${hoursElapsed}h en "${stageDef.label}"`,
            userId: null,
            quoteId: quote.id,
          },
        }).catch(() => {});
      }

      // ── ÓRDENES DE COMPRA en esta etapa ─────────────────────────────────────
      const orders = await prisma.order.findMany({
        where: { stage: stageDef.stageKey },
        include: { client: true, seller: true, activities: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });

      for (const order of orders) {
        const changedAt = order.stageChangedAt || order.createdAt;
        if (changedAt > cutoff) continue;

        const alreadySent = order.activities.some(
          a => a.action === 'STAGE_ALERT_SENT' && new Date(a.createdAt) >= since24h
        );
        if (alreadySent) continue;

        const seller = order.seller;
        const emails = [];
        if (seller?.email) emails.push(seller.email);
        if (!emails.length) continue;

        const hoursElapsed = Math.round((now - changedAt) / 3600000);
        const subject = `⏰ ${order.code} lleva ${hoursElapsed}h en "${stageDef.label}"`;
        const body = `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1B2A4A">Recordatorio de seguimiento</h2>
            <p>La orden <strong>${order.code}</strong>${order.client ? ` de <strong>${order.client.name}</strong>` : ''} lleva <strong>${hoursElapsed} horas</strong> en la etapa <strong>"${stageDef.label}"</strong>.</p>
            <p style="color:#64748B">Tiempo máximo configurado: ${stageDef.maxHours} horas.</p>
            <p>
              <a href="${APP_URL}" style="display:inline-block;padding:10px 22px;background:#3B82F6;color:white;text-decoration:none;border-radius:8px;font-weight:600">
                Ver en el CRM →
              </a>
            </p>
          </div>`;

        const { sendMail } = require('./mailer');
        await sendMail({ to: emails, subject, html: body }).catch(e =>
          console.error(`⚠️  Stage alert mail para ${order.code} falló:`, e.message)
        );

        await prisma.activity.create({
          data: {
            action: 'STAGE_ALERT_SENT',
            detail: `Alerta de tiempo enviada: ${order.code} lleva ${hoursElapsed}h en "${stageDef.label}"`,
            userId: null,
            orderId: order.id,
          },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('runStageAlerts error:', e.message);
  }
}

module.exports = { onStageChange, runIdleCheck, runStageAlerts };
