/**
 * services/mentions.js — notificar a usuarios etiquetados con @ en una nota
 * (Cotización u Orden). Usado por routes/quotes.js y routes/orders.js.
 */
const prisma = require('../db');
const { sendMail } = require('./mailer');
const { brandedEmail, emailParagraph } = require('./emailTemplate');

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// kind: 'quote' | 'order'
async function notifyMentions({ mentionedUserIds, authorUser, noteId, text, kind, refId, code, clientName }) {
  const ids = [...new Set((mentionedUserIds || []).filter(id => id && id !== authorUser.id))];
  if (!ids.length) return;

  const users = await prisma.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, email: true, name: true, notificationPrefs: true },
  });
  if (!users.length) return;

  const settingRow = await prisma.appSetting.findUnique({ where: { key: 'notify_mentions' } });
  const emailEnabled = settingRow ? settingRow.value !== 'false' : true;

  const snippet = text.length > 140 ? text.slice(0, 140) + '…' : text;
  const entry = {
    noteId, kind, id: refId, code, clientName: clientName || null,
    text: snippet, byName: authorUser.name,
    createdAt: new Date().toISOString(),
  };

  await Promise.all(users.map(async (u) => {
    const prefs = u.notificationPrefs || {};
    const pending = Array.isArray(prefs.pendingMentions) ? prefs.pendingMentions : [];
    await prisma.user.update({
      where: { id: u.id },
      data: { notificationPrefs: { ...prefs, pendingMentions: [...pending, entry] } },
    });

    if (emailEnabled && u.email) {
      try {
        await sendMail({
          to: u.email,
          replyTo: authorUser.email,
          subject: `[MySelec CRM] ${authorUser.name} te mencionó en ${code}`,
          html: brandedEmail({
            title: `Te mencionaron · ${code}`,
            preheader: `${authorUser.name} te etiquetó en una nota`,
            content: [
              emailParagraph(`<strong>${escHtml(authorUser.name)}</strong> te mencionó en una nota${clientName ? ` de <em>${escHtml(clientName)}</em>` : ''} (${code}).`),
              `<div style="background:#F5F6F7;border-left:3px solid #20759E;border-radius:4px;padding:14px 16px;margin:16px 0;white-space:pre-wrap;font-size:14px;color:#231F20;line-height:1.6">${escHtml(text)}</div>`,
            ].join(''),
          }),
          text: `${authorUser.name} te mencionó en una nota de ${code}:\n\n${text}`,
        });
      } catch (mailErr) {
        console.warn('⚠️  mention notify failed:', mailErr.message);
      }
    }
  }));
}

module.exports = { notifyMentions };
