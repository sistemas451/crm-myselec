const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function nextCode(model, prefix) {
  const all = await model.findMany({ select: { code: true } });
  const nums = all.map(r => parseInt(r.code.split('-')[2]) || 0).filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Connects to Gmail via IMAP, reads unread emails,
 * matches sender email to clients, and creates quotes.
 */
async function syncMails() {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    console.log('⚠️  Mail credentials not configured, skipping sync');
    return { synced: 0, errors: [] };
  }

  return new Promise((resolve) => {
    const results = { synced: 0, errors: [], mails: [] };

    const imap = new Imap({
      user: process.env.MAIL_USER,
      password: process.env.MAIL_PASSWORD,
      host: process.env.MAIL_HOST || 'imap.gmail.com',
      port: parseInt(process.env.MAIL_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          results.errors.push(`Error opening INBOX: ${err.message}`);
          imap.end();
          return resolve(results);
        }

        // Search for unseen emails
        imap.search(['UNSEEN'], (err, uids) => {
          if (err) {
            results.errors.push(`Error searching: ${err.message}`);
            imap.end();
            return resolve(results);
          }

          if (!uids || uids.length === 0) {
            console.log('📧 No new emails found');
            imap.end();
            return resolve(results);
          }

          console.log(`📧 Found ${uids.length} new email(s)`);

          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });
          const mailPromises = [];

          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            const mailData = { uid: null };

            msg.on('attributes', (attrs) => {
              mailData.uid = attrs.uid;
            });

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.on('end', () => { mailData.raw = buffer; });
            });

            msg.once('end', () => {
              mailPromises.push(processEmail(mailData, imap));
            });
          });

          fetch.once('error', (err) => {
            results.errors.push(`Fetch error: ${err.message}`);
          });

          fetch.once('end', async () => {
            const processed = await Promise.allSettled(mailPromises);
            processed.forEach(p => {
              if (p.status === 'fulfilled' && p.value) {
                results.synced++;
                results.mails.push(p.value);
              } else if (p.status === 'rejected') {
                results.errors.push(p.reason?.message || 'Unknown error');
              }
            });
            imap.end();
            resolve(results);
          });
        });
      });
    });

    imap.once('error', (err) => {
      results.errors.push(`IMAP connection error: ${err.message}`);
      resolve(results);
    });

    imap.once('end', () => {
      console.log('📧 IMAP connection closed');
    });

    imap.connect();
  });
}

async function processEmail(mailData, imap) {
  try {
    const parsed = await simpleParser(mailData.raw);

    const from = parsed.from?.value?.[0]?.address || '';
    const fromName = parsed.from?.value?.[0]?.name || from;
    const subject = parsed.subject || '(sin asunto)';
    const date = parsed.date || new Date();
    const messageId = parsed.messageId || `uid-${mailData.uid}`;

    // Check if already processed
    const existing = await prisma.quote.findFirst({
      where: { emailMessageId: messageId },
    });
    if (existing) return null;

    // Try to match client: first by email found in subject, then by sender
    let client = null;
    let matchSource = null;

    const subjectEmailMatch = subject.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    const subjectEmail = subjectEmailMatch ? subjectEmailMatch[0] : null;

    if (subjectEmail) {
      client = await prisma.client.findFirst({
        where: { email: { equals: subjectEmail, mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) matchSource = 'asunto';
    }

    if (!client && from) {
      client = await prisma.client.findFirst({
        where: { email: { equals: from, mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) matchSource = 'remitente';
    }

    // Generate quote code
    const code = await nextCode(prisma.quote, 'COT-2026');

    console.log('   📝 Creando cotización:', { code, clientId: client?.id || null, subject });
    const quote = await prisma.quote.create({
      data: {
        code,
        clientId: client?.id || null,
        sellerId: client?.defaultSellerId || null,
        stage: client ? 'asignada' : 'recibida',
        source: 'EMAIL',
        isDraft: false,
        emailSubject: subject.substring(0, 500),
        emailMessageId: messageId,
        emailFrom: from,
        createdAt: date,
      },
    });

    // Log activity
    const activityDetail = matchSource === 'asunto'
      ? `Cotización ${code} ingresada desde mail — ${client.name} (identificado por asunto)`
      : matchSource === 'remitente'
        ? `Cotización ${code} ingresada desde mail — ${client.name} (identificado por remitente)`
        : `Cotización ${code} ingresada desde mail — cliente pendiente de asignar · Asunto: ${subject}`;

    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: activityDetail,
        quoteId: quote.id,
      },
    });

    // Mark as seen in IMAP
    if (mailData.uid) {
      imap.addFlags(mailData.uid, ['\\Seen'], (err) => {
        if (err) console.error('Error marking as seen:', err.message);
      });
    }

    console.log(`   ✅ Created ${code} from ${from} → ${client?.name || 'Unknown client'}`);

    return {
      code: quote.code,
      from,
      fromName,
      subject,
      clientName: client?.name || null,
      sellerName: client?.defaultSeller?.name || null,
      isDraft: quote.isDraft,
      date: date.toISOString(),
    };
  } catch (err) {
    console.error('Error processing email completo:', err);
    throw err;
  }
}

/**
 * List recent emails without processing them (for the inbox view)
 */
async function listRecentMails(limit = 20) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    return [];
  }

  return new Promise((resolve) => {
    const mails = [];

    const imap = new Imap({
      user: process.env.MAIL_USER,
      password: process.env.MAIL_PASSWORD,
      host: process.env.MAIL_HOST || 'imap.gmail.com',
      port: parseInt(process.env.MAIL_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) { imap.end(); return resolve([]); }

        const total = box.messages.total;
        const start = Math.max(1, total - limit + 1);
        const range = `${start}:${total}`;

        const fetch = imap.fetch(range, { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], struct: true });
        
        fetch.on('message', (msg) => {
          const mailInfo = { seen: false };
          
          msg.on('attributes', (attrs) => {
            mailInfo.uid = attrs.uid;
            mailInfo.seen = attrs.flags?.includes('\\Seen') || false;
            mailInfo.date = attrs.date;
          });

          msg.on('body', (stream) => {
            let buffer = '';
            stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            stream.on('end', () => {
              const fromMatch = buffer.match(/From:\s*(.+)/i);
              const subjectMatch = buffer.match(/Subject:\s*(.+)/i);
              mailInfo.from = fromMatch ? fromMatch[1].trim() : '';
              mailInfo.subject = subjectMatch ? subjectMatch[1].trim() : '(sin asunto)';
            });
          });

          msg.once('end', () => { mails.push(mailInfo); });
        });

        fetch.once('end', () => {
          imap.end();
          resolve(mails.reverse());
        });

        fetch.once('error', () => {
          imap.end();
          resolve([]);
        });
      });
    });

    imap.once('error', () => resolve([]));
    imap.connect();
  });
}

module.exports = { syncMails, listRecentMails };
