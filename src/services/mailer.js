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
  const recipients = toArray(to);

  // 1) Intentar Gmail API (preferido)
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
    try {
      const gmail = getGmailClient();
      const from  = `MySelec CRM <${GMAIL_USER}>`;
      const mime  = buildMime({ from, to: recipients, cc, subject, html, text, replyTo, attachments });
      const raw   = Buffer.from(mime).toString('base64url');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return; // OK — enviado por Gmail API
    } catch (err) {
      console.warn('⚠️  Gmail API falló:', err.message, '— intentando Resend fallback…');
    }
  }

  // 2) Fallback: Resend API (HTTP, no SMTP — funciona en Railway)
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  Mailer: ni Gmail API ni RESEND_API_KEY configurados — mail omitido.');
    return;
  }

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const payload = {
    from: `MySelec CRM <${process.env.RESEND_FROM || 'onboarding@resend.dev'}>`,
    to:   recipients,
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (cc)   payload.cc   = toArray(cc);
  if (replyTo) payload.reply_to = replyTo;

  if (attachments?.length) {
    const fs = require('fs');
    payload.attachments = attachments.map(a => ({
      filename: a.filename || require('path').basename(a.path),
      content:  fs.readFileSync(a.path),
    }));
  }

  const { error } = await resend.emails.send(payload);
  if (error) throw new Error(`Resend error: ${error.message}`);
  console.log('✅ Mail enviado por Resend fallback a', recipients.join(', '));
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

  // Probar Resend fallback
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      // Resend no tiene un verify(), pero si la key es válida no tira error en el constructor
      result.resendFallback = true;
      result.resendFrom = process.env.RESEND_FROM || 'onboarding@resend.dev';
      if (!result.provider) { result.provider = 'resend'; result.user = result.resendFrom; }
    } catch (err) {
      result.resendError = err.message;
    }
  }

  if (!result.provider) throw new Error('Ni Gmail API ni Resend API configurados. Revise la configuración.');
  return result;
}

module.exports = { sendMail, sendPasswordReset, sendNotification, renderTemplate, verifySmtp };
