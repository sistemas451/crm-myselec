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

// ── Resumen semanal por mail ────────────────────────────────────────────────
// Corre cada hora; solo actúa el día/hora configurados en AppSetting.
async function runWeeklyReport() {
  try {
    const [enabledS, dayS, hourS] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: 'weekly_report_enabled' } }),
      prisma.appSetting.findUnique({ where: { key: 'weekly_report_day'     } }),
      prisma.appSetting.findUnique({ where: { key: 'weekly_report_hour'    } }),
    ]);

    if (enabledS?.value === 'false') return; // desactivado

    const targetDay  = parseInt(dayS?.value  ?? '1', 10);  // 1 = Lunes
    const targetHour = parseInt(hourS?.value ?? '9', 10);

    // Hora en Argentina (UTC-3)
    const now     = new Date();
    const argTime = new Date(now.getTime() - 3 * 3600 * 1000);
    const curDay  = argTime.getUTCDay();
    const curHour = argTime.getUTCHours();

    if (curDay !== targetDay || curHour !== targetHour) return;

    // Evitar doble-envío si la función se llama dos veces en el mismo slot
    const lastSentS = await prisma.appSetting.findUnique({ where: { key: 'weekly_report_last_sent' } });
    if (lastSentS?.value) {
      const lastSent = new Date(lastSentS.value);
      if ((now - lastSent) < 3600 * 1000) return; // ya se envió en la última hora
    }
    await prisma.appSetting.upsert({
      where:  { key: 'weekly_report_last_sent' },
      update: { value: now.toISOString() },
      create: { key: 'weekly_report_last_sent', value: now.toISOString() },
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { email: true, name: true },
    });
    if (!admins.length) return;

    // ── Calcular rango semana actual vs semana anterior ─────────────────────
    const startOfToday = new Date(argTime.toISOString().slice(0,10) + 'T03:00:00.000Z'); // 00:00 ARG
    const weekStart    = new Date(startOfToday.getTime() - (curDay === 0 ? 6 : curDay - 1) * 86400000);
    const prevWeekEnd  = new Date(weekStart.getTime() - 1);
    const prevWeekStart= new Date(weekStart.getTime() - 7 * 86400000);

    const [
      quotesThisWeek, quotesPrevWeek,
      ordersThisWeek, ordersPrevWeek,
      allQuotes, allOrders,
      allSellers,
    ] = await Promise.all([
      prisma.quote.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.quote.count({ where: { createdAt: { gte: prevWeekStart, lte: prevWeekEnd } } }),
      prisma.order.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.order.count({ where: { createdAt: { gte: prevWeekStart, lte: prevWeekEnd } } }),
      prisma.quote.findMany({
        where: { stage: { notIn: ['rechazada'] }, isDraft: false },
        select: { stage: true, amount: true, sellerId: true, seller: { select: { name: true } } },
      }),
      prisma.order.findMany({
        where: { stage: { notIn: ['cancelada'] } },
        select: { stage: true, amount: true, sellerId: true },
      }),
      prisma.user.findMany({ where: { role: 'VENDEDOR', active: true }, select: { id: true, name: true } }),
    ]);

    // KPIs generales
    const totalActive = allQuotes.filter(q => !['aceptada','rechazada'].includes(q.stage)).length;
    const wonThisWeek = await prisma.quote.count({ where: { stage: 'aceptada', updatedAt: { gte: weekStart } } });
    const wonPrevWeek = await prisma.quote.count({ where: { stage: 'aceptada', updatedAt: { gte: prevWeekStart, lte: prevWeekEnd } } });
    const totalMonto  = allQuotes.reduce((s, q) => s + (q.amount || 0), 0);

    // Pipeline por etapa
    const byStage = {};
    for (const q of allQuotes) {
      if (['aceptada','rechazada'].includes(q.stage)) continue;
      byStage[q.stage] = (byStage[q.stage] || 0) + 1;
    }

    // Ranking de vendedores
    const vendRanking = allSellers.map(v => {
      const qs = allQuotes.filter(q => q.sellerId === v.id);
      return {
        name:    v.name,
        activas: qs.filter(q => !['aceptada','rechazada'].includes(q.stage)).length,
        ganadas: qs.filter(q => q.stage === 'aceptada').length,
        monto:   qs.reduce((s, q) => s + (q.amount || 0), 0),
      };
    }).sort((a, b) => b.ganadas - a.ganadas || b.activas - a.activas);

    // Alertas de etapas
    const stagesWithLimit = await prisma.stageDefinition.findMany({
      where: { maxHours: { not: null }, active: true },
    });
    let overdueCount = 0;
    for (const sd of stagesWithLimit) {
      const cutoff = new Date(now.getTime() - sd.maxHours * 3600 * 1000);
      const cnt = await prisma.quote.count({
        where: { stage: sd.stageKey, stageChangedAt: { lte: cutoff }, NOT: { stage: { in: ['aceptada','rechazada'] } } },
      });
      overdueCount += cnt;
    }

    const APP_URL = process.env.APP_URL || 'https://crm-gerenciando-canales-production-c7d6.up.railway.app';
    const fmtNum  = n => n.toLocaleString('es-AR', { minimumFractionDigits: 0 });
    const delta   = (cur, prev) => {
      if (!prev) return cur > 0 ? `<span style="color:#22C55E">+${cur}</span>` : '—';
      const d = cur - prev;
      if (d === 0) return '<span style="color:#94A3B8">↔ igual</span>';
      return d > 0
        ? `<span style="color:#22C55E">↑ +${d}</span>`
        : `<span style="color:#EF4444">↓ ${d}</span>`;
    };

    const dayLabels = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const reportDate = argTime.toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resumen semanal MySelec CRM</title></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:620px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:#1B2A4A;padding:32px 36px 28px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="width:36px;height:36px;background:#3B82F6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px">📊</div>
      <div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-.3px">Resumen Semanal</div>
    </div>
    <div style="color:#94A3B8;font-size:13px">MySelec CRM · ${reportDate}</div>
  </div>

  <!-- KPIs -->
  <div style="padding:28px 36px 0">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:14px">Esta semana vs semana anterior</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Nuevas cotizaciones</div>
        <div style="font-size:26px;font-weight:700;color:#1B2A4A">${quotesThisWeek}</div>
        <div style="font-size:12px;margin-top:2px">${delta(quotesThisWeek, quotesPrevWeek)} vs sem. ant.</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Cotizaciones ganadas</div>
        <div style="font-size:26px;font-weight:700;color:#22C55E">${wonThisWeek}</div>
        <div style="font-size:12px;margin-top:2px">${delta(wonThisWeek, wonPrevWeek)} vs sem. ant.</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Órdenes de compra</div>
        <div style="font-size:26px;font-weight:700;color:#1B2A4A">${ordersThisWeek}</div>
        <div style="font-size:12px;margin-top:2px">${delta(ordersThisWeek, ordersPrevWeek)} vs sem. ant.</div>
      </div>
      <div style="background:#F8FAFC;border-radius:10px;padding:16px">
        <div style="font-size:11px;color:#64748B;margin-bottom:4px">Monto total pipeline</div>
        <div style="font-size:22px;font-weight:700;color:#1B2A4A">U$S ${fmtNum(Math.round(totalMonto))}</div>
        <div style="font-size:12px;margin-top:2px;color:#64748B">${totalActive} activa${totalActive!==1?'s':''}</div>
      </div>
    </div>
  </div>

  ${vendRanking.length ? `
  <!-- Ranking vendedores -->
  <div style="padding:24px 36px 0">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:14px">Ranking de vendedores</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;font-size:11px;color:#94A3B8;font-weight:600;padding:0 0 8px;border-bottom:1px solid #E2E8F0">Vendedor</th>
        <th style="text-align:center;font-size:11px;color:#94A3B8;font-weight:600;padding:0 0 8px;border-bottom:1px solid #E2E8F0">Activas</th>
        <th style="text-align:center;font-size:11px;color:#94A3B8;font-weight:600;padding:0 0 8px;border-bottom:1px solid #E2E8F0">Ganadas</th>
        <th style="text-align:right;font-size:11px;color:#94A3B8;font-weight:600;padding:0 0 8px;border-bottom:1px solid #E2E8F0">Monto</th>
      </tr></thead>
      <tbody>
        ${vendRanking.map((v, i) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#1B2A4A;font-weight:${i===0?'700':'400'}">
            ${i===0?'🥇':i===1?'🥈':i===2?'🥉':'  '} ${v.name}
          </td>
          <td style="text-align:center;padding:10px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#64748B">${v.activas}</td>
          <td style="text-align:center;padding:10px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#22C55E;font-weight:600">${v.ganadas}</td>
          <td style="text-align:right;padding:10px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#1B2A4A">U$S ${fmtNum(Math.round(v.monto))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${Object.keys(byStage).length ? `
  <!-- Pipeline por etapa -->
  <div style="padding:24px 36px 0">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94A3B8;margin-bottom:14px">Pipeline activo por etapa</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${Object.entries(byStage).map(([stage, cnt]) => `
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-size:12px;color:#64748B;width:180px;flex-shrink:0">${stage}</div>
        <div style="flex:1;background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden">
          <div style="height:8px;background:#3B82F6;width:${Math.min(100, Math.round(cnt/totalActive*100))}%;border-radius:4px"></div>
        </div>
        <div style="font-size:12px;font-weight:600;color:#1B2A4A;width:28px;text-align:right">${cnt}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${overdueCount > 0 ? `
  <!-- Alertas -->
  <div style="padding:24px 36px 0">
    <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px">
      <div style="font-size:20px">⚠️</div>
      <div>
        <div style="font-size:13px;font-weight:600;color:#92400E">${overdueCount} ítem${overdueCount!==1?'s':''} con tiempo de etapa excedido</div>
        <div style="font-size:12px;color:#B45309;margin-top:2px">Algunos clientes están esperando respuesta fuera del plazo configurado.</div>
      </div>
    </div>
  </div>` : ''}

  <!-- CTA -->
  <div style="padding:28px 36px 32px;text-align:center">
    <a href="${APP_URL}" style="display:inline-block;padding:12px 28px;background:#3B82F6;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:-.2px">
      Abrir el CRM →
    </a>
    <div style="font-size:11px;color:#CBD5E1;margin-top:20px">
      Generado automáticamente por MySelec CRM · ${dayLabels[targetDay]} a las ${String(targetHour).padStart(2,'0')}:00 hs
    </div>
  </div>
</div>
</body></html>`;

    const { sendMail } = require('./mailer');
    const subject = `📊 Resumen semanal MySelec CRM — ${reportDate}`;
    const toEmails = admins.map(a => a.email);
    await sendMail({ to: toEmails, subject, html });
    console.log(`📊 Resumen semanal enviado a ${toEmails.join(', ')}`);

  } catch (e) {
    console.error('runWeeklyReport error:', e.message);
  }
}

module.exports = { onStageChange, runIdleCheck, runStageAlerts, runWeeklyReport };
