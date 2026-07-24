/**
 * mailSender.js — Servicio de envío de correos del CRM
 *
 * Características:
 * - Auto-detección de SMTP por dominio del remitente
 * - Lee cuentas desde env vars (MAIL_USER / MAIL_ACCOUNTS) y AppSetting DB
 * - Sistema de plantillas variables: {cliente}, {np_flexxus}, {codigo}, {vendedor}, {asunto_original}, {fecha}
 * - Adjuntos opcionales (PDF del presupuesto)
 */

const nodemailer = require('nodemailer');
const prisma     = require('../db');

// ─── SMTP auto-detect por dominio ─────────────────────────────────────────────

/**
 * Devuelve la configuración SMTP para un email dado.
 * Soporta Gmail, Outlook/Office365, Yahoo y dominios personalizados.
 */
function smtpConfigForEmail(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase() || '';

  // Gmail (incluyendo cuentas Workspace con dominio propio que usan Gmail)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return { host: 'smtp.gmail.com', port: 587, secure: false };
  }

  // Microsoft
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) {
    return { host: 'smtp.office365.com', port: 587, secure: false };
  }

  // Yahoo
  if (['yahoo.com', 'yahoo.com.ar', 'ymail.com'].includes(domain)) {
    return { host: 'smtp.mail.yahoo.com', port: 465, secure: true };
  }

  // Variables de entorno explícitas (para dominios corporativos)
  if (process.env.SMTP_HOST) {
    return {
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
    };
  }

  // Fallback: si el dominio es myselec.com.ar o similares, asumimos Gmail detrás
  // (el MAIL_USER principal es iamyselec@gmail.com)
  // Intentamos con las credenciales del env con Gmail
  return { host: 'smtp.gmail.com', port: 587, secure: false };
}

// ─── Obtener cuenta SMTP para enviar ─────────────────────────────────────────

/**
 * Devuelve { user, password, smtp } de la cuenta "principal" de envío.
 * Prioridad: SMTP_USER/SMTP_PASSWORD > MAIL_USER/MAIL_PASSWORD > primera de MAIL_ACCOUNTS > primera de DB
 */
async function getSenderAccount() {
  // 1. Credenciales SMTP explícitas
  if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    return {
      user:     process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      smtp:     smtpConfigForEmail(process.env.SMTP_USER),
    };
  }

  // 2. Legacy MAIL_USER / MAIL_PASSWORD
  if (process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
    return {
      user:     process.env.MAIL_USER,
      password: process.env.MAIL_PASSWORD,
      smtp:     smtpConfigForEmail(process.env.MAIL_USER),
    };
  }

  // 3. MAIL_ACCOUNTS env
  if (process.env.MAIL_ACCOUNTS) {
    try {
      const accounts = JSON.parse(process.env.MAIL_ACCOUNTS);
      if (Array.isArray(accounts) && accounts.length > 0) {
        const acc = accounts[0];
        return { user: acc.user, password: acc.password, smtp: smtpConfigForEmail(acc.user) };
      }
    } catch (_) {}
  }

  // 4. AppSetting DB — contraseñas encriptadas con AES-256-GCM
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    if (setting?.value) {
      const accounts = JSON.parse(setting.value);
      if (Array.isArray(accounts) && accounts.length > 0) {
        const acc = accounts[0];
        return { user: acc.user, password: decryptPassword(acc.password), smtp: smtpConfigForEmail(acc.user) };
      }
    }
  } catch (_) {}

  throw new Error('No hay cuenta de correo configurada para envío. Configure MAIL_USER y MAIL_PASSWORD en el servidor.');
}

// ─── Crear transporte nodemailer ──────────────────────────────────────────────

async function createTransport() {
  const account = await getSenderAccount();
  const transport = nodemailer.createTransport({
    host:   account.smtp.host,
    port:   account.smtp.port,
    secure: account.smtp.secure,
    auth:   { user: account.user, pass: account.password },
    tls:    { rejectUnauthorized: false },
    connectionTimeout: 20000,
    greetingTimeout:   20000,
    socketTimeout:     60000,
  });
  return { transport, fromEmail: account.user };
}

// ─── Plantillas ───────────────────────────────────────────────────────────────

// appliesTo: 'PRESUPUESTO' | 'SOLICITUD' | 'ALL' — determina en qué modal de envío
// aparece cada plantilla (ver SendEmailModal). Las 3 originales son de Presupuesto.
const DEFAULT_TEMPLATES = [
  {
    id:      'estandar',
    name:    'Presupuesto estándar',
    appliesTo: 'PRESUPUESTO',
    subject: 'Presupuesto {codigo} - Myselec',
    body:    `Estimado/a {cliente},\n\nAdjunto encontrará el presupuesto N° {codigo}{np_line} solicitado.\n\nQuedamos a su disposición para cualquier consulta.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'reply',
    name:    'Re: solicitud del cliente',
    appliesTo: 'PRESUPUESTO',
    subject: 'Re: {asunto_original}',
    body:    `Estimado/a {cliente},\n\nEn respuesta a su consulta, adjunto el presupuesto N° {codigo}{np_line}.\n\nEstamos a su disposición para cualquier aclaración.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'seguimiento',
    name:    'Seguimiento de presupuesto',
    appliesTo: 'PRESUPUESTO',
    subject: 'Seguimiento - Presupuesto {codigo}',
    body:    `Estimado/a {cliente},\n\nNos contactamos para hacer seguimiento del presupuesto N° {codigo}{np_line} enviado el {fecha}.\n\n¿Ha tenido la oportunidad de revisarlo? Quedamos disponibles para responder cualquier consulta.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
];

// Acuse de recibo para Solicitudes de Cotización recién ingresadas — se auto-agregan
// la primera vez que se leen las plantillas si todavía no existen (ver getTemplates).
const SOLICITUD_DEFAULT_TEMPLATES = [
  {
    id:      'sol_recibida_24h',
    name:    'Solicitud recibida - 24hs',
    appliesTo: 'SOLICITUD',
    subject: 'Confirmación de recepción - Solicitud {codigo}',
    body:    `Estimado/a {cliente},\n\nLe confirmamos la correcta recepción de su solicitud de cotización.\n\nNuestro equipo de ventas ya se encuentra trabajando en la elaboración de su presupuesto, y le haremos llegar una respuesta dentro de las próximas 24 horas hábiles.\n\nAnte cualquier consulta adicional, quedamos a su disposición.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'sol_recibida_48h',
    name:    'Solicitud recibida - 48hs',
    appliesTo: 'SOLICITUD',
    subject: 'Confirmación de recepción - Solicitud {codigo}',
    body:    `Estimado/a {cliente},\n\nLe confirmamos la correcta recepción de su solicitud de cotización.\n\nNuestro equipo de ventas ya se encuentra trabajando en la elaboración de su presupuesto, y le haremos llegar una respuesta dentro de las próximas 48 horas hábiles.\n\nAnte cualquier consulta adicional, quedamos a su disposición.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'sol_recibida_72h',
    name:    'Solicitud recibida - 72hs',
    appliesTo: 'SOLICITUD',
    subject: 'Confirmación de recepción - Solicitud {codigo}',
    body:    `Estimado/a {cliente},\n\nLe confirmamos la correcta recepción de su solicitud de cotización.\n\nNuestro equipo de ventas ya se encuentra trabajando en la elaboración de su presupuesto, y le haremos llegar una respuesta dentro de las próximas 72 horas hábiles.\n\nAnte cualquier consulta adicional, quedamos a su disposición.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
];

/**
 * Carga las plantillas desde la DB (AppSetting key='email_templates').
 * Si no existen, devuelve las plantillas por defecto. De paso:
 * - Etiqueta con appliesTo='PRESUPUESTO' las plantillas viejas guardadas antes de
 *   que existiera ese campo (compatibilidad hacia atrás).
 * - Agrega las plantillas de acuse de recibo de Solicitud si todavía no están.
 */
async function getTemplates() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'email_templates' } });
    if (setting?.value) {
      let templates = JSON.parse(setting.value);
      if (Array.isArray(templates) && templates.length > 0) {
        let changed = false;
        templates = templates.map(t => {
          if (!t.appliesTo) { changed = true; return { ...t, appliesTo: 'PRESUPUESTO' }; }
          return t;
        });
        const missingSol = SOLICITUD_DEFAULT_TEMPLATES.filter(d => !templates.some(t => t.id === d.id));
        if (missingSol.length > 0) { templates = [...templates, ...missingSol]; changed = true; }
        if (changed) { try { await saveTemplates(templates); } catch (_) {} }
        return templates;
      }
    }
  } catch (_) {}
  return [...DEFAULT_TEMPLATES, ...SOLICITUD_DEFAULT_TEMPLATES];
}

/**
 * Guarda plantillas en AppSetting.
 */
async function saveTemplates(templates) {
  await prisma.appSetting.upsert({
    where:  { key: 'email_templates' },
    update: { value: JSON.stringify(templates) },
    create: { key: 'email_templates', value: JSON.stringify(templates) },
  });
}

/**
 * Obtiene el CC por defecto configurado.
 */
async function getDefaultCC() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'email_cc_default' } });
    return setting?.value || '';
  } catch (_) { return ''; }
}

// ─── Sustitución de variables en plantilla ────────────────────────────────────

/**
 * Reemplaza variables de plantilla: {cliente}, {codigo}, {np_flexxus}, {vendedor}, {asunto_original}, {fecha}, {np_line}
 */
function applyTemplate(text, vars) {
  return text
    .replace(/\{cliente\}/g,          vars.cliente          || '')
    .replace(/\{codigo\}/g,           vars.codigo           || '')
    .replace(/\{np_flexxus\}/g,       vars.np_flexxus       || '')
    .replace(/\{np_line\}/g,          vars.np_flexxus ? ` (NP Flexxus: ${vars.np_flexxus})` : '')
    .replace(/\{vendedor\}/g,         vars.vendedor         || '')
    .replace(/\{asunto_original\}/g,  vars.asunto_original  || '')
    .replace(/\{fecha\}/g,            vars.fecha            || '');
}

// ─── Función principal de envío ───────────────────────────────────────────────

/**
 * Envía el presupuesto por email.
 *
 * @param {object} opts
 * @param {string}   opts.to              — Destinatario
 * @param {string}   [opts.cc]            — CC (puede ser vacío)
 * @param {string}   opts.subject         — Asunto ya con variables reemplazadas
 * @param {string}   opts.body            — Cuerpo ya con variables reemplazadas
 * @param {string}   [opts.attachmentPath] — Ruta absoluta del PDF a adjuntar
 * @param {string}   [opts.attachmentName] — Nombre de archivo para el adjunto
 * @returns {Promise<{ messageId: string }>}
 */
async function sendEmail({ to, cc, subject, body, attachmentPath, attachmentName, fromEmail: requestedFrom, fromName: requestedName }) {
  // Si se pide enviar desde una cuenta específica, buscar sus credenciales
  let transport, fromEmail, fromName;
  const specificTransport = requestedFrom ? await getTransportForEmail(requestedFrom, requestedName) : null;
  if (specificTransport) {
    transport = specificTransport.transport;
    fromEmail = specificTransport.fromEmail;
    fromName  = specificTransport.fromName;
  } else {
    const fallback = await createTransport();
    transport = fallback.transport;
    fromEmail = fallback.fromEmail;
    fromName  = requestedName || 'Myselec CRM';
  }

  const { brandedEmail, quoteBodyToHtml } = require('./emailTemplate');
  const mailOptions = {
    from:    `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text:    body,
    html:    brandedEmail({ title: 'MySelec', content: quoteBodyToHtml(body) }),
  };

  if (cc && cc.trim()) mailOptions.cc = cc.trim();

  if (attachmentPath) {
    const fs   = require('fs');
    const path = require('path');
    if (fs.existsSync(attachmentPath)) {
      mailOptions.attachments = [{
        filename: attachmentName || path.basename(attachmentPath),
        path:     attachmentPath,
      }];
    }
  }

  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId, sentFrom: fromEmail };
}

// ─── Resolver cuenta SMTP por email (para envío desde cuenta específica) ──

/**
 * Busca las credenciales de una cuenta de mail en mail_accounts (env + DB).
 * Devuelve { transport, fromEmail } o null si no se encontró.
 * @param {string} email — dirección de la cuenta (ej: "bruscofacundo1@gmail.com")
 * @param {string} [fromName] — nombre para el "From" header
 */
async function getTransportForEmail(email, fromName) {
  if (!email) return null;
  try {
    const normalized = email.toLowerCase().trim();

    const envAccounts = [];
    if (process.env.MAIL_ACCOUNTS) {
      try { envAccounts.push(...JSON.parse(process.env.MAIL_ACCOUNTS)); } catch (_) {}
    } else if (process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
      envAccounts.push({ user: process.env.MAIL_USER, password: process.env.MAIL_PASSWORD });
    }
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    const dbAccountsRaw = setting?.value ? JSON.parse(setting.value) : [];
    const dbAccounts = dbAccountsRaw.map(a => ({ ...a, password: decryptPassword(a.password) }));
    const allAccounts = [...envAccounts, ...dbAccounts];

    const account = allAccounts.find(a => a.user.toLowerCase() === normalized);
    if (!account?.password) {
      console.warn(`⚠️  getTransportForEmail: no se encontró cuenta con password para ${email}. Cuentas disponibles: ${allAccounts.map(a=>a.user).join(', ')}`);
      return null;
    }
    console.log(`📬 getTransportForEmail: usando ${account.user}`);

    const smtp = smtpConfigForEmail(account.user);
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: { user: account.user, pass: account.password },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20000,  // 20s para conectar
      greetingTimeout: 20000,
      socketTimeout: 60000,      // 60s para enviar (PDF puede ser grande)
    });

    return { transport, fromEmail: account.user, fromName: fromName || 'MySelec' };
  } catch (e) {
    console.error('getTransportForEmail error:', e.message);
    return null;
  }
}

// ─── Función de alto nivel usada por la ruta ─────────────────────────────────

/**
 * Envía presupuesto para una cotización dado su ID.
 * Resuelve variables de plantilla, envía, loguea actividad y avanza etapa.
 *
 * @param {string} quoteId
 * @param {object} opts
 * @param {string}   opts.to
 * @param {string}   [opts.cc]
 * @param {string}   opts.subject
 * @param {string}   opts.body
 * @param {string}   [opts.attachmentPath]
 * @param {string}   [opts.attachmentName]
 * @param {string}   opts.userId   — ID del usuario que envía
 * @returns {Promise<{ messageId: string, stageAdvanced: boolean }>}
 */
async function sendQuoteEmail(quoteId, opts) {
  const { to, cc, subject, body, attachmentPath, attachmentName, userId } = opts;

  // Enviar (fromEmail permite enviar desde una cuenta específica)
  const { messageId, sentFrom } = await sendEmail({ to, cc, subject, body, attachmentPath, attachmentName, fromEmail: opts.fromEmail, fromName: opts.fromName });

  // Log de actividad
  await prisma.activity.create({
    data: {
      action:  'EMAIL_SENT',
      detail:  `Presupuesto enviado por email a ${to}${cc ? ` (CC: ${cc})` : ''} · Asunto: "${subject}"`,
      userId,
      quoteId,
    },
  });

  // Avanzar etapa → 'enviado' (solo si está en asignada, armado, revisión o similar — no si ya está más avanzada)
  const STAGES_TO_ADVANCE = ['asignada', 'armado', 'revision', 'presupuestado'];
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, select: { stage: true } });
  let stageAdvanced = false;
  if (quote && STAGES_TO_ADVANCE.includes(quote.stage)) {
    const fudSetting = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
    const fudDays = Math.max(1, parseInt(fudSetting?.value || '4'));
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + fudDays);
    await prisma.quote.update({ where: { id: quoteId }, data: { stage: 'enviado', followUpDate } });
    await prisma.activity.create({
      data: {
        action: 'STAGE_CHANGE',
        detail: `Etapa cambiada de "${quote.stage}" a "enviado" (envío de presupuesto por email)`,
        userId,
        quoteId,
      },
    });
    stageAdvanced = true;
  }

  return { messageId, stageAdvanced, sentFrom };
}

module.exports = {
  sendQuoteEmail,
  sendEmail,
  getTemplates,
  saveTemplates,
  getDefaultCC,
  applyTemplate,
  smtpConfigForEmail,
  getTransportForEmail,
  DEFAULT_TEMPLATES,
};
