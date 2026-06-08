const { sendNotification } = require('./mailer');
const prisma = require('../db');
const { brandedEmail, emailButton, emailWarning, emailParagraph, BRAND_COLORS: C } = require('./emailTemplate');

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

// Corre diariamente: detecta quotes/orders con etapa excedida y manda UN digest por vendedor.
// Cooldown configurable (stage_alert_cooldown_days) para no repetir la misma alerta cada día.
async function runStageAlerts() {
  try {
    const flagRow = await prisma.appSetting.findUnique({ where: { key: 'notify_stage_alert' } });
    if (flagRow?.value === 'false') return;

    const cooldownRow = await prisma.appSetting.findUnique({ where: { key: 'stage_alert_cooldown_days' } });
    const cooldownDays = Math.max(1, parseInt(cooldownRow?.value ?? '3', 10));

    const alertStages = await prisma.stageDefinition.findMany({
      where: { emailAlert: true, maxHours: { not: null }, active: true },
    });
    if (!alertStages.length) return;

    const now       = new Date();
    const APP_URL   = process.env.APP_URL || 'https://crm-gerenciando-canales-production-c7d6.up.railway.app';
    const cooloffAt = new Date(now.getTime() - cooldownDays * 86400 * 1000);

    // Construir mapa stageKey → { label, maxHours, cutoff }
    const stageMap = Object.fromEntries(alertStages.map(s => [s.stageKey, {
      label: s.label, maxHours: s.maxHours,
      cutoff: new Date(now.getTime() - s.maxHours * 3600 * 1000),
    }]));
    const alertStageKeys = alertStages.map(s => s.stageKey);

    // Cargar todos los items overdue de una sola vez, con activities del cooldown
    const [allQuotes, allOrders] = await Promise.all([
      prisma.quote.findMany({
        where: { stage: { in: alertStageKeys }, NOT: { stage: { in: ['aceptada','rechazada'] } } },
        include: {
          client: true, seller: true,
          activities: { where: { action: 'STAGE_ALERT_SENT', createdAt: { gte: cooloffAt } }, take: 1 },
        },
      }),
      prisma.order.findMany({
        where: { stage: { in: alertStageKeys } },
        include: {
          client: true, seller: true,
          activities: { where: { action: 'STAGE_ALERT_SENT', createdAt: { gte: cooloffAt } }, take: 1 },
        },
      }),
    ]);

    // Filtrar overdue + no en cooldown, agrupar por vendedor
    const sellerMap = {};  // sellerId → { seller, quotes: [], orders: [] }
    const addToSeller = (item, entry, kind) => {
      const stageInfo = stageMap[item.stage];
      if (!stageInfo) return;
      const changedAt = item.stageChangedAt || item.createdAt;
      if (changedAt > stageInfo.cutoff) return;      // aún no excedió
      if (item.activities.length > 0) return;         // ya alertado en cooldown
      const seller = item.seller;
      if (!seller?.email) return;
      if (!sellerMap[seller.id]) sellerMap[seller.id] = { seller, quotes: [], orders: [] };
      sellerMap[seller.id][kind].push({
        code: item.code, id: item.id,
        clientName: item.client?.name || '—',
        stageLabel: stageInfo.label,
        hoursElapsed: Math.round((now - changedAt) / 3600000),
      });
    };

    for (const q of allQuotes) addToSeller(q, q, 'quotes');
    for (const o of allOrders) addToSeller(o, o, 'orders');

    const { sendMail } = require('./mailer');

    for (const { seller, quotes, orders } of Object.values(sellerMap)) {
      if (!quotes.length && !orders.length) continue;
      const total = quotes.length + orders.length;

      // Construir tabla HTML
      const buildRows = (items, kind) => items.map(i =>
        '<tr>' +
        '<td style="padding:8px 10px;font-family:monospace;font-size:12px;color:' + C.brandDark + '">' + i.code + '</td>' +
        '<td style="padding:8px 10px;font-size:12px;color:' + C.grayDark + '">' + kind + '</td>' +
        '<td style="padding:8px 10px;font-size:12px;color:' + C.black + '">' + i.clientName + '</td>' +
        '<td style="padding:8px 10px;font-size:12px;color:' + C.black + '">' + i.stageLabel + '</td>' +
        '<td style="padding:8px 10px;font-size:12px;color:#EF4444;font-weight:600">' + i.hoursElapsed + 'h</td>' +
        '</tr>'
      ).join('');

      const tableHtml =
        '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;border:1px solid ' + C.grayLight + '">' +
        '<thead><tr style="background:' + C.bg + '">' +
        '<th style="padding:8px 10px;text-align:left;color:' + C.grayDark + ';font-size:11px">Código</th>' +
        '<th style="padding:8px 10px;text-align:left;color:' + C.grayDark + ';font-size:11px">Tipo</th>' +
        '<th style="padding:8px 10px;text-align:left;color:' + C.grayDark + ';font-size:11px">Cliente</th>' +
        '<th style="padding:8px 10px;text-align:left;color:' + C.grayDark + ';font-size:11px">Etapa</th>' +
        '<th style="padding:8px 10px;text-align:left;color:' + C.grayDark + ';font-size:11px">Tiempo</th>' +
        '</tr></thead><tbody>' +
        buildRows(quotes, 'Cotización') + buildRows(orders, 'Orden') +
        '</tbody></table>';

      const html = brandedEmail({
        title: 'Alerta de seguimiento',
        preheader: total + ' ítem' + (total !== 1 ? 's' : '') + ' con tiempo excedido',
        content: [
          emailParagraph('Hola <strong>' + seller.name + '</strong>, los siguientes ítems superaron el tiempo de etapa configurado:'),
          tableHtml,
          emailParagraph('Próximo recordatorio en ' + cooldownDays + ' día' + (cooldownDays !== 1 ? 's' : '') + ' si no hay cambios.'),
          emailButton(APP_URL, 'Ver en el CRM →'),
        ].join(''),
      });

      await sendMail({
        to: seller.email,
        subject: '⏰ ' + total + ' ítem' + (total !== 1 ? 's' : '') + ' con tiempo de etapa excedido · MySelec CRM',
        html,
      }).catch(e => console.error('Stage alert digest falló para', seller.email, ':', e.message));

      // Registrar en Activity para cada ítem (cooldown)
      await Promise.all([
        ...quotes.map(q => prisma.activity.create({ data: { action: 'STAGE_ALERT_SENT', detail: `Alerta digest: ${q.code} lleva ${q.hoursElapsed}h en "${q.stageLabel}"`, quoteId: q.id } }).catch(() => {})),
        ...orders.map(o => prisma.activity.create({ data: { action: 'STAGE_ALERT_SENT', detail: `Alerta digest: ${o.code} lleva ${o.hoursElapsed}h en "${o.stageLabel}"`, orderId: o.id } }).catch(() => {})),
      ]);

      console.log(`📧 Stage alert digest → ${seller.email} (${total} ítems, cooldown ${cooldownDays}d)`);
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
    const [wonThisWeek, wonPrevWeek, lostThisWeek, lostPrevWeek] = await Promise.all([
      prisma.quote.count({ where: { stage: 'aceptada', stageChangedAt: { gte: weekStart } } }),
      prisma.quote.count({ where: { stage: 'aceptada', stageChangedAt: { gte: prevWeekStart, lte: prevWeekEnd } } }),
      prisma.quote.count({ where: { stage: 'rechazada', stageChangedAt: { gte: weekStart } } }),
      prisma.quote.count({ where: { stage: 'rechazada', stageChangedAt: { gte: prevWeekStart, lte: prevWeekEnd } } }),
    ]);
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

    const APP_URL  = process.env.APP_URL || 'https://crm-gerenciando-canales-production-c7d6.up.railway.app';
    const fmtNum   = n => (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 });
    const dayLabels = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const reportDate = argTime.toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' });

    const deltaHtml = (cur, prev) => {
      if (!prev) return cur > 0 ? '<span style="color:#22C55E">+' + cur + '</span>' : '—';
      const d = cur - prev;
      if (d === 0) return '<span style="color:#939598">↔ igual</span>';
      return d > 0
        ? '<span style="color:#22C55E">↑ +' + d + '</span>'
        : '<span style="color:#EF4444">↓ ' + d + '</span>';
    };

    // Construir contenido interior del email
    let body = '';

    // KPIs
    body += '<div style="margin-bottom:20px">';
    body += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:' + C.grayDark + ';margin-bottom:14px">Esta semana vs semana anterior</div>';
    body += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">';
    body += '<div style="background:' + C.bg + ';border-radius:10px;padding:16px">';
    body +=   '<div style="font-size:11px;color:' + C.grayDark + ';margin-bottom:4px">Nuevas cotizaciones</div>';
    body +=   '<div style="font-size:26px;font-weight:700;color:' + C.brandDark + '">' + quotesThisWeek + '</div>';
    body +=   '<div style="font-size:12px;margin-top:2px">' + deltaHtml(quotesThisWeek, quotesPrevWeek) + ' vs sem. ant.</div>';
    body += '</div>';
    body += '<div style="background:' + C.bg + ';border-radius:10px;padding:16px">';
    body +=   '<div style="font-size:11px;color:' + C.grayDark + ';margin-bottom:4px">Cerradas esta semana</div>';
    body +=   '<div style="display:flex;align-items:baseline;gap:10px">';
    body +=     '<div style="font-size:22px;font-weight:700;color:#22C55E">' + wonThisWeek + ' ✅</div>';
    body +=     '<div style="font-size:22px;font-weight:700;color:#EF4444">' + lostThisWeek + ' ❌</div>';
    body +=   '</div>';
    body +=   '<div style="font-size:11px;color:' + C.grayDark + ';margin-top:2px">ganadas / perdidas</div>';
    body +=   '<div style="font-size:12px;margin-top:4px">' + deltaHtml(wonThisWeek, wonPrevWeek) + ' ganadas vs sem. ant.</div>';
    body += '</div>';
    body += '<div style="background:' + C.bg + ';border-radius:10px;padding:16px">';
    body +=   '<div style="font-size:11px;color:' + C.grayDark + ';margin-bottom:4px">Órdenes de compra</div>';
    body +=   '<div style="font-size:26px;font-weight:700;color:' + C.brandDark + '">' + ordersThisWeek + '</div>';
    body +=   '<div style="font-size:12px;margin-top:2px">' + deltaHtml(ordersThisWeek, ordersPrevWeek) + ' vs sem. ant.</div>';
    body += '</div>';
    body += '<div style="background:' + C.bg + ';border-radius:10px;padding:16px">';
    body +=   '<div style="font-size:11px;color:' + C.grayDark + ';margin-bottom:4px">Monto total pipeline</div>';
    body +=   '<div style="font-size:22px;font-weight:700;color:' + C.brandDark + '">U$S ' + fmtNum(Math.round(totalMonto)) + '</div>';
    body +=   '<div style="font-size:12px;margin-top:2px;color:' + C.grayDark + '">' + totalActive + ' activa' + (totalActive !== 1 ? 's' : '') + '</div>';
    body += '</div>';
    body += '</div></div>'; // cierra grid y section KPIs

    // Ranking de vendedores
    if (vendRanking.length) {
      const medals = ['🥇','🥈','🥉'];
      body += '<div style="margin-top:24px">';
      body += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:' + C.grayDark + ';margin-bottom:14px">Ranking de vendedores</div>';
      body += '<table style="width:100%;border-collapse:collapse">';
      body += '<thead><tr>';
      body += '<th style="text-align:left;font-size:11px;color:' + C.grayDark + ';font-weight:600;padding:0 0 8px;border-bottom:1px solid ' + C.grayLight + '">Vendedor</th>';
      body += '<th style="text-align:center;font-size:11px;color:' + C.grayDark + ';font-weight:600;padding:0 0 8px;border-bottom:1px solid ' + C.grayLight + '">Activas</th>';
      body += '<th style="text-align:center;font-size:11px;color:' + C.grayDark + ';font-weight:600;padding:0 0 8px;border-bottom:1px solid ' + C.grayLight + '">Ganadas</th>';
      body += '<th style="text-align:right;font-size:11px;color:' + C.grayDark + ';font-weight:600;padding:0 0 8px;border-bottom:1px solid ' + C.grayLight + '">Monto</th>';
      body += '</tr></thead><tbody>';
      vendRanking.forEach(function(v, i) {
        const fw = i === 0 ? '700' : '400';
        body += '<tr>';
        body += '<td style="padding:10px 0;border-bottom:1px solid ' + C.bg + ';font-size:13px;color:' + C.brandDark + ';font-weight:' + fw + '">' + (medals[i] || '  ') + ' ' + v.name + '</td>';
        body += '<td style="text-align:center;padding:10px 0;border-bottom:1px solid ' + C.bg + ';font-size:13px;color:' + C.grayDark + '">' + v.activas + '</td>';
        body += '<td style="text-align:center;padding:10px 0;border-bottom:1px solid ' + C.bg + ';font-size:13px;color:#22C55E;font-weight:600">' + v.ganadas + '</td>';
        body += '<td style="text-align:right;padding:10px 0;border-bottom:1px solid ' + C.bg + ';font-size:13px;color:' + C.brandDark + '">U$S ' + fmtNum(Math.round(v.monto)) + '</td>';
        body += '</tr>';
      });
      body += '</tbody></table></div>';
    }

    // Pipeline por etapa
    const stageEntries = Object.entries(byStage);
    if (stageEntries.length && totalActive > 0) {
      body += '<div style="margin-top:24px">';
      body += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:' + C.grayDark + ';margin-bottom:14px">Pipeline activo por etapa</div>';
      body += '<div style="display:flex;flex-direction:column;gap:8px">';
      stageEntries.forEach(function(entry) {
        const stageName = entry[0];
        const cnt = entry[1];
        const pct = Math.min(100, Math.round(cnt / totalActive * 100));
        body += '<div style="display:flex;align-items:center;gap:10px">';
        body += '<div style="font-size:12px;color:' + C.grayDark + ';width:180px;flex-shrink:0">' + stageName + '</div>';
        body += '<div style="flex:1;background:' + C.bg + ';border-radius:4px;height:8px;overflow:hidden">';
        body += '<div style="height:8px;background:' + C.brand + ';width:' + pct + '%;border-radius:4px"></div>';
        body += '</div>';
        body += '<div style="font-size:12px;font-weight:600;color:' + C.brandDark + ';width:28px;text-align:right">' + cnt + '</div>';
        body += '</div>';
      });
      body += '</div></div>';
    }

    // Alerta de ítems vencidos
    if (overdueCount > 0) {
      body += emailWarning(
        overdueCount + ' ítem' + (overdueCount !== 1 ? 's' : '') + ' con tiempo de etapa excedido',
        'Algunos clientes están esperando respuesta fuera del plazo configurado.'
      );
    }

    // CTA
    body += emailButton(APP_URL, 'Abrir el CRM →');
    body += '<div style="font-size:11px;color:' + C.grayMid + ';margin-top:16px;text-align:center">Generado automáticamente · ' + dayLabels[targetDay] + ' a las ' + String(targetHour).padStart(2,'0') + ':00 hs</div>';

    const html = brandedEmail({
      title: 'Resumen Semanal',
      preheader: 'Resumen semanal MySelec CRM · ' + reportDate,
      content: body,
    });

    const { sendMail } = require('./mailer');
    const subject  = '📊 Resumen semanal MySelec CRM — ' + reportDate;
    const toEmails = admins.map(a => a.email);
    await sendMail({ to: toEmails, subject, html });
    console.log('📊 Resumen semanal enviado a ' + toEmails.join(', '));

  } catch (e) {
    console.error('runWeeklyReport error:', e.message);
  }
}

module.exports = { onStageChange, runIdleCheck, runStageAlerts, runWeeklyReport };
