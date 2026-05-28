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

// Construye un mensaje MIME multipart (plain + html)
function buildMime({ from, to, subject, html, text }) {
  const toStr = Array.isArray(to) ? to.join(', ') : to;
  const boundary = 'myseleccrm' + Date.now();
  // Codificar el asunto en Base64 para soportar caracteres especiales (tildes, ñ)
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${toStr}`,
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

async function sendMail({ to, subject, html, text }) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_REFRESH_TOKEN) {
    console.warn('⚠️  Mailer: GMAIL_CLIENT_ID/GMAIL_REFRESH_TOKEN no configurados, mail omitido.');
    return;
  }
  const gmail = getGmailClient();
  const from  = `MySelec CRM <${GMAIL_USER}>`;
  const mime  = buildMime({ from, to: toArray(to), subject, html, text });
  const raw   = Buffer.from(mime).toString('base64url');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
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
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error('GMAIL_CLIENT_ID/GMAIL_REFRESH_TOKEN no configurados');
  }
  const gmail = getGmailClient();
  // Obtiene el perfil del usuario para verificar que el token funcione
  const { data } = await gmail.users.getProfile({ userId: 'me' });
  return { provider: 'gmail-api', user: data.emailAddress, messagesTotal: data.messagesTotal };
}

module.exports = { sendMail, sendPasswordReset, sendNotification, renderTemplate, verifySmtp };
