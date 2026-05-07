const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { parseFlexxusPDF, isFlexxusPDF } = require('./flexxusParser');

const prisma = new PrismaClient();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads', 'attachments');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ─── Regex: extrae email del remitente original en reenvíos Outlook ───
// Formato: "De: Nombre < email@dominio.com >" (con o sin espacios)
const OUTLOOK_FORWARD_RE = /De:\s*.+?<\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\s*>/i;

// ─── Tipos de adjunto que ignoramos (firmas de mail, imágenes inline) ───
const IMAGE_MIME_PREFIXES = ['image/'];
const IGNORED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];

function isImageAttachment(att) {
  if (!att) return true;
  const ct = (att.contentType || '').toLowerCase();
  if (IMAGE_MIME_PREFIXES.some(p => ct.startsWith(p))) return true;
  if (att.filename) {
    const ext = path.extname(att.filename).toLowerCase();
    if (IGNORED_EXTENSIONS.includes(ext)) return true;
  }
  // Inline embebidos (firma) sin filename real también los ignoramos
  if (!att.filename) return true;
  return false;
}

async function nextCode(model, prefix) {
  const all = await model.findMany({ select: { code: true } });
  const nums = all.map(r => parseInt(r.code.split('-')[2]) || 0).filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Conecta a Gmail vía IMAP, lee mails no leídos,
 * matchea remitente con clientes y crea cotizaciones.
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
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          results.errors.push(`Error opening INBOX: ${err.message}`);
          imap.end();
          return resolve(results);
        }

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

          fetch.on('message', (msg) => {
            let buffer = '';
            const mailData = { uid: null };

            msg.on('attributes', (attrs) => { mailData.uid = attrs.uid; });
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
      results.errors.push(`IMAP error: ${err.message}`);
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

    const directFrom  = parsed.from?.value?.[0]?.address || '';
    const subject     = parsed.subject || '(sin asunto)';
    const date        = parsed.date || new Date();
    const messageId   = parsed.messageId || `uid-${mailData.uid}`;

    // Header de threading: apunta al mail al que se responde
    const inReplyTo = parsed.inReplyTo
      ? parsed.inReplyTo.replace(/[<>]/g, '').trim()
      : null;

    // Texto plano del cuerpo (fallback a HTML sin tags)
    const bodyText = parsed.text
      || (parsed.html ? parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim() : '');

    // ── Chequeo de duplicado ──────────────────────────────────────────────
    const existing = await prisma.quote.findFirst({ where: { emailMessageId: messageId } });
    if (existing) {
      console.log(`   ⏭️  Ya procesado: ${messageId}`);
      return null;
    }

    // ── Extraer remitente real (puede ser un reenvío de Outlook) ──────────
    const forwardMatch = bodyText.match(OUTLOOK_FORWARD_RE)
      || subject.match(OUTLOOK_FORWARD_RE);
    const originalSender = (forwardMatch?.[1] || directFrom).toLowerCase().trim();

    // ── Filtrar adjuntos reales (ignorar imágenes/firmas) ─────────────────
    const realAttachments = (parsed.attachments || []).filter(a => !isImageAttachment(a));

    // ── Detectar PDF Flexxus ──────────────────────────────────────────────
    const flexxusAtt = realAttachments.find(a => isFlexxusPDF(a));
    let flexxusData  = null;
    if (flexxusAtt) {
      try {
        flexxusData = await parseFlexxusPDF(flexxusAtt.content);
        console.log(`   📄 Flexxus detectado: ${flexxusData.npCode} | CUIT: ${flexxusData.cuit} | ${flexxusData.clientName}`);
      } catch (e) {
        console.error('   ❌ Error parseando PDF Flexxus:', e.message);
      }
    }

    // ── Clasificar tipo de mail ───────────────────────────────────────────
    const mailType = flexxusData ? 'PRESUPUESTO' : 'SOLICITUD';

    console.log(`   📩 ${subject} | from: ${originalSender} | adjuntos reales: ${realAttachments.length} | tipo: ${mailType}`);

    // ── Matcheo de cliente (orden de prioridad) ───────────────────────────
    let client = null;

    // Para PRESUPUESTO: buscar primero por CUIT del PDF, luego por razón social
    if (flexxusData?.cuit) {
      client = await prisma.client.findFirst({
        where: { cuit: { equals: flexxusData.cuit, mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) console.log(`   ✅ Match CUIT Flexxus: ${client.name}`);
    }
    if (!client && flexxusData?.clientName) {
      client = await prisma.client.findFirst({
        where: { name: { contains: flexxusData.clientName.substring(0, 20), mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) console.log(`   ✅ Match nombre Flexxus: ${client.name}`);
    }

    // Para SOLICITUD y fallback: matchear por email del remitente
    // 1. ClientEmail exacto
    if (!client) {
      try {
        const ce = await prisma.clientEmail.findFirst({
          where: { email: originalSender },
          include: { client: { include: { defaultSeller: true } } },
        });
        if (ce) { client = ce.client; console.log(`   ✅ Match ClientEmail: ${client.name}`); }
      } catch (_) { /* ClientEmail puede no existir en esquemas viejos */ }
    }

    // 2. Client.email exacto
    if (!client) {
      client = await prisma.client.findFirst({
        where: { email: { equals: originalSender, mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) console.log(`   ✅ Match Client.email: ${client.name}`);
    }

    // 3. Dominio del remitente vs Client.emailDomain
    if (!client && originalSender.includes('@')) {
      const domain = originalSender.split('@')[1];
      client = await prisma.client.findFirst({
        where: { emailDomain: { equals: domain, mode: 'insensitive' } },
        include: { defaultSeller: true },
      });
      if (client) console.log(`   ✅ Match dominio @${domain}: ${client.name}`);
    }

    if (!client) console.log(`   ⚠️  Sin match de cliente para ${originalSender}`);

    // ── Crear cotización ──────────────────────────────────────────────────
    const code = await nextCode(prisma.quote, 'COT-2026');

    // Calcular monto total de ítems Flexxus (solo los aceptados)
    const flexxusTotal = flexxusData?.items?.length
      ? flexxusData.items.filter(i => i.accepted).reduce((s, i) => s + (i.total || 0), 0)
      : null;

    const quote = await prisma.quote.create({
      data: {
        code,
        clientId:       client?.id || null,
        sellerId:       client?.defaultSellerId || null,
        stage:          client ? 'asignada' : 'recibida',
        source:         'EMAIL',
        mailType,
        flexxusCode:    flexxusData?.npCode || null,
        amount:         flexxusTotal || null,
        emailSubject:   subject.substring(0, 500),
        emailMessageId: messageId,
        emailFrom:      originalSender,
        emailBody:      bodyText.substring(0, 20000),
        inReplyTo:      inReplyTo,
        createdAt:      date,
      },
    });

    // ── Auto-vincular PRESUPUESTO con SOLICITUD existente ────────────────
    if (mailType === 'PRESUPUESTO') {
      try {
        let solicitudTarget = null;

        // 1. Match por hilo de email (In-Reply-To → emailMessageId) ← más fuerte
        if (inReplyTo) {
          solicitudTarget = await prisma.quote.findFirst({
            where: { emailMessageId: inReplyTo, mailType: 'SOLICITUD', linkedQuoteId: null },
          });
          if (solicitudTarget) console.log(`   🔗 Match por hilo email: ${solicitudTarget.code}`);
        }

        // 2. Fallback: mismo cliente, solicitud abierta, últimos 90 días
        if (!solicitudTarget && client) {
          const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
          const candidatas = await prisma.quote.findMany({
            where: {
              clientId:      client.id,
              mailType:      'SOLICITUD',
              linkedQuoteId: null,
              stage:         { notIn: ['rechazada', 'aceptada'] },
              createdAt:     { gte: cutoff },
            },
            orderBy: { createdAt: 'desc' },
          });

          if (candidatas.length === 1) {
            solicitudTarget = candidatas[0];
            console.log(`   🔗 Match por cliente único: ${solicitudTarget.code}`);
          } else if (candidatas.length > 1) {
            console.log(`   ⚠️  ${candidatas.length} solicitudes abiertas del cliente — vínculo manual requerido`);
          }
        }

        // Vincular + propagar flexxusCode a la SOLICITUD
        if (solicitudTarget) {
          const npCode = flexxusData?.npCode || null;
          await prisma.quote.update({
            where: { id: quote.id },
            data:  { linkedQuoteId: solicitudTarget.id },
          });
          await prisma.quote.update({
            where: { id: solicitudTarget.id },
            data:  {
              linkedQuoteId: quote.id,
              ...(npCode ? { flexxusCode: npCode } : {}),  // propagar NP a la SOLICITUD
            },
          });
          console.log(`   🔗 Vinculado ${quote.code} ↔ ${solicitudTarget.code}${npCode ? ` | NP propagado: ${npCode}` : ''}`);
        }
      } catch (e) {
        console.error('   ❌ Error al auto-vincular:', e.message);
      }
    }

    // ── Crear ítems del presupuesto Flexxus ───────────────────────────────
    if (flexxusData?.items?.length) {
      try {
        await prisma.quoteItem.createMany({
          data: flexxusData.items.map(item => ({
            quoteId:     quote.id,
            description: item.description.substring(0, 500),
            quantity:    item.quantity || 0,
            unitPrice:   item.unitPrice || null,
            total:       item.total || null,
            accepted:    item.accepted !== false,
            sortOrder:   item.sortOrder || 0,
          })),
        });
        console.log(`   📋 ${flexxusData.items.length} ítems creados para ${code}`);
      } catch (e) {
        console.error('   ❌ Error creando ítems:', e.message);
      }
    }

    // ── Guardar adjuntos reales (no imágenes) ─────────────────────────────
    for (const att of realAttachments) {
      try {
        const safeName = `${quote.id}-${att.filename.replace(/[^a-zA-Z0-9._\-]/g, '_')}`;
        const filePath = path.join(UPLOADS_DIR, safeName);
        fs.writeFileSync(filePath, att.content);

        await prisma.attachment.create({
          data: {
            filename: safeName,
            path:     filePath,
            size:     att.size || att.content?.length || null,
            mimeType: att.contentType || null,
            quoteId:  quote.id,
          },
        });
        console.log(`   📎 Adjunto guardado: ${safeName}`);
      } catch (e) {
        console.error(`   ❌ Error guardando adjunto ${att.filename}:`, e.message);
      }
    }

    // ── Log de actividad ──────────────────────────────────────────────────
    const actDetail = flexxusData
      ? (client
          ? `Cotización ${code} [${flexxusData.npCode}] ingresada desde PDF Flexxus — ${client.name}`
          : `Cotización ${code} [${flexxusData.npCode}] ingresada desde PDF Flexxus — cliente sin asignar`)
      : (client
          ? `Cotización ${code} ingresada desde mail — ${client.name} (${originalSender})`
          : `Cotización ${code} ingresada desde mail — cliente sin asignar · ${originalSender}`);

    await prisma.activity.create({
      data: {
        action:  'CREATED',
        detail:  actDetail,
        quoteId: quote.id,
      },
    });

    // ── Marcar como leído en IMAP ─────────────────────────────────────────
    if (mailData.uid) {
      imap.addFlags(mailData.uid, ['\\Seen'], (err) => {
        if (err) console.error('Error marking as seen:', err.message);
      });
    }

    console.log(`   ✅ Creada ${code} ← ${originalSender} → ${client?.name || 'sin cliente'}`);

    return {
      code:        quote.code,
      from:        originalSender,
      subject,
      mailType,
      flexxusCode: flexxusData?.npCode || null,
      clientName:  client?.name || null,
      sellerName:  client?.defaultSeller?.name || null,
      itemCount:   flexxusData?.items?.length || 0,
      date:        date.toISOString(),
    };

  } catch (err) {
    console.error('Error procesando email:', err);
    throw err;
  }
}

/**
 * Lista mails recientes sin procesarlos (para la vista de bandeja)
 */
async function listRecentMails(limit = 20) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) return [];

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

        const fetch = imap.fetch(`${start}:${total}`, {
          bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'],
          struct: true,
        });

        fetch.on('message', (msg) => {
          const mailInfo = { seen: false };

          msg.on('attributes', (attrs) => {
            mailInfo.uid  = attrs.uid;
            mailInfo.seen = attrs.flags?.includes('\\Seen') || false;
            mailInfo.date = attrs.date;
          });

          msg.on('body', (stream) => {
            let buffer = '';
            stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            stream.on('end', () => {
              const fromMatch    = buffer.match(/From:\s*(.+)/i);
              const subjectMatch = buffer.match(/Subject:\s*(.+)/i);
              mailInfo.from    = fromMatch    ? fromMatch[1].trim()    : '';
              mailInfo.subject = subjectMatch ? subjectMatch[1].trim() : '(sin asunto)';
            });
          });

          msg.once('end', () => { mails.push(mailInfo); });
        });

        fetch.once('end',   () => { imap.end(); resolve(mails.reverse()); });
        fetch.once('error', () => { imap.end(); resolve([]); });
      });
    });

    imap.once('error', () => resolve([]));
    imap.connect();
  });
}

module.exports = { syncMails, listRecentMails };
