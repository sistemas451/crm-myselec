const nodemailer = require('nodemailer');

// Deriva host SMTP del host IMAP (imap.X → smtp.X, mail.X → mail.X)
function smtpHost() {
  const h = process.env.MAIL_HOST || 'smtp.gmail.com';
  return h.replace(/^imap\./, 'smtp.');
}

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  // Puerto 465 (SSL) en lugar de 587 (STARTTLS) — Railway bloquea el 587 saliente.
  // Gmail soporta ambos; con 465 + secure:true no se hace upgrade TLS, la conexión
  // es cifrada desde el inicio y más compatible con firewalls de cloud providers.
  _transporter = nodemailer.createTransport({
    host: smtpHost(),
    port: 465,
    secure: true,             // SSL desde el inicio (puerto 465)
    connectionTimeout: 15000, // 15s
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD,
    },
  });
  return _transporter;
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

async function sendMail({ to, subject, html, text }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    console.warn('⚠️  Mailer: MAIL_USER/MAIL_PASSWORD no configurados, mail omitido.');
    return;
  }
  const t = getTransporter();
  await t.sendMail({
    from: `"MySelec CRM" <${process.env.MAIL_USER}>`,
    to,
    subject,
    html: html || `<pre>${text}</pre>`,
    text,
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
    to: toEmails.join(', '),
    subject: renderedSubject,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;white-space:pre-wrap">${renderedBody}</div>`,
    text: renderedBody,
  });
}

module.exports = { sendMail, sendPasswordReset, sendNotification, renderTemplate };
