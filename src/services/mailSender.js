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

  // 4. AppSetting DB
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    if (setting?.value) {
      const accounts = JSON.parse(setting.value);
      if (Array.isArray(accounts) && accounts.length > 0) {
        const acc = accounts[0];
        return { user: acc.user, password: acc.password, smtp: smtpConfigForEmail(acc.user) };
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
    tls:    { rejectUnauthorized: false }, // Permite certs self-signed
  });
  return { transport, fromEmail: account.user };
}

// ─── Plantillas ───────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATES = [
  {
    id:      'estandar',
    name:    'Presupuesto estándar',
    subject: 'Presupuesto {codigo} - Myselec',
    body:    `Estimado/a {cliente},\n\nAdjunto encontrará el presupuesto N° {codigo}{np_line} solicitado.\n\nQuedamos a su disposición para cualquier consulta.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'reply',
    name:    'Re: solicitud del cliente',
    subject: 'Re: {asunto_original}',
    body:    `Estimado/a {cliente},\n\nEn respuesta a su consulta, adjunto el presupuesto N° {codigo}{np_line}.\n\nEstamos a su disposición para cualquier aclaración.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
  {
    id:      'seguimiento',
    name:    'Seguimiento de presupuesto',
    subject: 'Seguimiento - Presupuesto {codigo}',
    body:    `Estimado/a {cliente},\n\nNos contactamos para hacer seguimiento del presupuesto N° {codigo}{np_line} enviado el {fecha}.\n\n¿Ha tenido la oportunidad de revisarlo? Quedamos disponibles para responder cualquier consulta.\n\nSaludos cordiales,\n{vendedor}\nMyselec`,
  },
];

/**
 * Carga las plantillas desde la DB (AppSetting key='email_templates').
 * Si no existen, devuelve las plantillas por defecto.
 */
async function getTemplates() {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'email_templates' } });
    if (setting?.value) {
      const templates = JSON.parse(setting.value);
      if (Array.isArray(templates) && templates.length > 0) return templates;
    }
  } catch (_) {}
  return DEFAULT_TEMPLATES;
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
async function sendEmail({ to, cc, subject, body, attachmentPath, attachmentName, userId }) {
  // Intentar usar cuenta personal del vendedor; fallback a cuenta CRM
  let transport, fromEmail, fromName;
  const userTransport = userId ? await getTransportForUser(userId) : null;
  if (userTransport) {
    transport = userTransport.transport;
    fromEmail = userTransport.fromEmail;
    fromName  = userTransport.fromName;
  } else {
    const fallback = await createTransport();
    transport = fallback.transport;
    fromEmail = fallback.fromEmail;
    fromName  = 'Myselec CRM';
  }

  const mailOptions = {
    from:    `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text:    body,
    // También enviamos versión HTML básica (saltos de línea → <br>)
    html:    `<pre style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`,
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

// ─── Resolver cuenta SMTP por userId (para envío personal) ───────────────

/**
 * Busca la cuenta SMTP vinculada a un usuario (si tiene smtpEmail configurado).
 * Devuelve { transport, fromEmail } o null si no tiene cuenta personal.
 */
async function getTransportForUser(userId) {
  if (!userId) return null;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { smtpEmail: true, name: true } });
    if (!user?.smtpEmail) return null;

    const normalizedSmtp = user.smtpEmail.toLowerCase();

    // Buscar credenciales en env + DB
    const envAccounts = [];
    if (process.env.MAIL_ACCOUNTS) {
      try { envAccounts.push(...JSON.parse(process.env.MAIL_ACCOUNTS)); } catch (_) {}
    } else if (process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
      envAccounts.push({ user: process.env.MAIL_USER, password: process.env.MAIL_PASSWORD });
    }
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    const dbAccounts = setting?.value ? JSON.parse(setting.value) : [];
    const allAccounts = [...envAccounts, ...dbAccounts];

    const account = allAccounts.find(a => a.user.toLowerCase() === normalizedSmtp);
    if (!account?.password) return null;

    const smtp = smtpConfigForEmail(account.user);
    const transport = nodemailer.createTransport({
      host: smtp.host, port: smtp.port, secure: smtp.secure,
      auth: { user: account.user, pass: account.password },
      tls: { rejectUnauthorized: false },
    });

    return { transport, fromEmail: account.user, fromName: user.name || 'MySelec' };
  } catch (e) {
    console.error('getTransportForUser error:', e.message);
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

  // Enviar (userId permite enviar desde la cuenta personal del vendedor)
  const { messageId, sentFrom } = await sendEmail({ to, cc, subject, body, attachmentPath, attachmentName, userId });

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
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 4); // alerta en 4 días si no hay respuesta
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
  getTransportForUser,
  DEFAULT_TEMPLATES,
};
