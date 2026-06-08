const { google } = require('googleapis');

const GMAIL_USER = process.env.MAIL_USER || 'iamyselec@gmail.com';

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Construye un mensaje MIME — soporta adjuntos y Reply-To
function buildMime({ from, to, cc, subject, html, text, replyTo, attachments }) {
  const toStr = Array.isArray(to) ? to.join(', ') : to;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const hasAttachments = attachments && attachments.length > 0;

  if (!hasAttachments) {
    // Sin adjuntos: multipart/alternative (plain + html)
    const boundary = 'myseleccrm_alt_' + Date.now();
    const lines = [
      `From: ${from}`,
      `To: ${toStr}`,
      ...(cc ? [`CC: ${cc}`] : []),
      ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
      `Subject: ${subjectEncoded}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text || '').toString('base64'),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(html || `<pre>${text || ''}</pre>`).toString('base64'),
      '',
      `--${boundary}--`,
    ];
    return lines.join('\r\n');
  }

  // Con adjuntos: multipart/mixed que contiene multipart/alternative + adjuntos
  const fs = require('fs');
  const path = require('path');
  const outerBoundary = 'myseleccrm_mix_' + Date.now();
  const innerBoundary = 'myseleccrm_alt_' + (Date.now() + 1);

  const lines = [
    `From: ${from}`,
    `To: ${toStr}`,
    ...(cc ? [`CC: ${cc}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${subjectEncoded}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${outerBoundary}"`,
    '',
    `--${outerBoundary}`,
    `Content-Type: multipart/alternative; boundary="${innerBoundary}"`,
    '',
    `--${innerBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text || '').toString('base64'),
    '',
    `--${innerBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html || `<pre>${text || ''}</pre>`).toString('base64'),
    '',
    `--${innerBoundary}--`,
  ];

  // Agregar adjuntos
  for (const att of attachments) {
    try {
      const fileData = fs.readFileSync(att.path);
      const filename = att.filename || path.basename(att.path);
      const mimeType = att.mimeType || 'application/octet-stream';
      const filenameEncoded = `=?UTF-8?B?${Buffer.from(filename).toString('base64')}?=`;
      lines.push('');
      lines.push(`--${outerBoundary}`);
      lines.push(`Content-Type: ${mimeType}; name="${filenameEncoded}"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push(`Content-Disposition: attachment; filename="${filenameEncoded}"`);
      lines.push('');
      lines.push(fileData.toString('base64'));
    } catch (e) {
      console.warn('⚠️  No se pudo leer adjunto:', att.path, e.message);
    }
  }

  lines.push('');
  lines.push(`--${outerBoundary}--`);
  return lines.join('\r\n');
}

// Reemplaza {{key}} en template con valores del objeto ctx
function renderTemplate(text, ctx) {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const parts = key.split('.');
    let val = ctx;
    for (const p of parts) val = val?.[p];
    return val ?? '';
  });
}

// Convierte string o array en array limpio de emails
function toArray(to) {
  if (Array.isArray(to)) return to.map(s => s.trim()).filter(Boolean);
  return String(to).split(',').map(s => s.trim()).filter(Boolean);
}

async function sendMail({ to, cc, subject, html, text, replyTo, attachments }) {
  const from       = `MySelec CRM <${GMAIL_USER}>`;
  const recipients = toArray(to);

  // 1) Intentar Gmail API (preferido)
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
    try {
      const gmail = getGmailClient();
      const mime  = buildMime({ from, to: recipients, cc, subject, html, text, replyTo, attachments });
      const raw   = Buffer.from(mime).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return; // OK — enviado por Gmail API
    } catch (err) {
      console.warn('⚠️  Gmail API falló:', err.message, '— intentando SMTP fallback…');
    }
  }

  // 2) Fallback: SMTP directo (usa MAIL_USER + MAIL_PASSWORD)
  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    console.warn('⚠️  Mailer: ni Gmail API ni SMTP configurados — mail omitido.');
    return;
  }

  const nodemailer = require('nodemailer');
  const { smtpConfigForEmail } = require('./mailSender');
  const smtp = smtpConfigForEmail(process.env.MAIL_USER);
  const transport = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    tls:  { rejectUnauthorized: false },
    connectionTimeout: 20000,
    greetingTimeout:   20000,
    socketTimeout:     60000,
  });

  const mailOpts = {
    from,
    to: recipients.join(', '),
    subject,
    ...(html && { html }),
    ...(text && { text }),
    ...(replyTo && { replyTo }),
  };
  if (cc) mailOpts.cc = cc;

  if (attachments?.length) {
    const path = require('path');
    mailOpts.attachments = attachments.map(a => ({
      filename:    a.filename || path.basename(a.path),
      path:        a.path,
      contentType: a.mimeType,
    }));
  }

  await transport.sendMail(mailOpts);
  console.log('✅ Mail enviado por SMTP fallback a', recipients.join(', '));
}

async function sendPasswordReset(toEmail, resetUrl) {
  await sendMail({
    to: toEmail,
    subject: 'Recuperar contraseña · MySelec CRM',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1B2A4A">Recuperar contraseña</h2>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en MySelec CRM.</p>
        <p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 24px;background:#3B82F6;color:white;text-decoration:none;border-radius:8px;font-weight:600">
            Restablecer contraseña
          </a>
        </p>
        <p style="color:#64748B;font-size:13px">Este link expira en 1 hora. Si no solicitaste esto, ignorá este mail.</p>
      </div>
    `,
  });
}

async function sendNotification({ toEmails, subject, body, ctx }) {
  const renderedSubject = renderTemplate(subject, ctx);
  const renderedBody    = renderTemplate(body,    ctx);
  await sendMail({
    to: toEmails,
    subject: renderedSubject,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;white-space:pre-wrap">${renderedBody}</div>`,
    text: renderedBody,
  });
}

// Verifica la configuración — útil para diagnóstico desde el admin panel
async function verifySmtp() {
  const result = { provider: null, user: null, gmailApi: false, smtpFallback: false };

  // Probar Gmail API
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
    try {
      const gmail = getGmailClient();
      const { data } = await gmail.users.getProfile({ userId: 'me' });
      result.provider = 'gmail-api';
      result.user = data.emailAddress;
      result.gmailApi = true;
      result.messagesTotal = data.messagesTotal;
    } catch (err) {
      result.gmailApiError = err.message;
    }
  }

  // Probar SMTP fallback
  if (process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
    try {
      const nodemailer = require('nodemailer');
      const { smtpConfigForEmail } = require('./mailSender');
      const smtp = smtpConfigForEmail(process.env.MAIL_USER);
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.secure,
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
        tls:  { rejectUnauthorized: false },
        connectionTimeout: 10000,
      });
      await transport.verify();
      result.smtpFallback = true;
      if (!result.provider) { result.provider = 'smtp'; result.user = process.env.MAIL_USER; }
    } catch (err) {
      result.smtpError = err.message;
    }
  }

  if (!result.provider) throw new Error('Ni Gmail API ni SMTP funcionan. Revise la configuración.');
  return result;
}

module.exports = { sendMail, sendPasswordReset, sendNotification, renderTemplate, verifySmtp };
