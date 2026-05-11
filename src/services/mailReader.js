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

// ─── Filtro CRM: prefijos de asunto y etiqueta ───────────────────────────────
const CRM_SUBJECT_PREFIXES = ['[crm]', 'crm:', 'crm -', '#crm', 'crm '];
const CRM_LABEL = process.env.MAIL_CRM_LABEL || 'crm';

function hasCrmSubject(subject) {
  const s = (subject || '').toLowerCase().trim();
  return CRM_SUBJECT_PREFIXES.some(p => s.startsWith(p));
}

// ─── Regex: extrae email del remitente real en reenvíos ───────────────────────
// Maneja Outlook ES ("De:"), Gmail EN ("From:"), con o sin ángulos, al inicio de línea
const FORWARD_FROM_RE = /(?:^|\r?\n)[ \t]*(?:De|From):[ \t]*(?:[^<\r\n]*?<[ \t]*)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})[ \t]*>?/im;

// Nuestras propias direcciones de reenvío — si directFrom es una de estas
// O viene del dominio @myselec.com.ar → ignorar como cliente externo.
const OWN_ADDRESSES = new Set([
  'ventas@myselec.com.ar',
  'iamyselec@gmail.com',
  'info@myselec.com.ar',
  'compras@myselec.com.ar',
  'logistica@myselec.com.ar',
  'jorge@myselec.com.ar',
]);
const OWN_DOMAINS = ['myselec.com.ar'];

function isOwnAddress(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (OWN_ADDRESSES.has(e)) return true;
  const domain = e.split('@')[1] || '';
  return OWN_DOMAINS.some(d => domain === d);
}

// ─── Strip HTML conservando texto legible ─────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')  // eliminar bloques CSS
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // eliminar bloques JS
    .replace(/<br\s*\/?>/gi, '\n')                    // <br> → salto de línea
    .replace(/<\/p>/gi, '\n\n')                       // </p> → párrafo
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')                          // quitar etiquetas restantes
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')                       // espacios múltiples
    .replace(/\n{3,}/g, '\n\n')                       // saltos excesivos
    .trim();
}

// ─── Tipos de adjunto que ignoramos (firmas de mail, imágenes inline) ───
const IMAGE_MIME_PREFIXES = ['image/'];
const IGNORED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];

// MIME types que sabemos que son documentos reales → conservar aunque no tengan filename
const DOCUMENT_MIME_PREFIXES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats',   // xlsx, docx, pptx
  'application/msword',
  'application/vnd.oasis',            // ods, odt
  'application/zip',
  'application/octet-stream',
  'text/csv',
  'text/plain',
];

function isImageAttachment(att) {
  if (!att) return true;
  const ct = (att.contentType || '').toLowerCase();
  // Claramente una imagen por MIME type → ignorar
  if (IMAGE_MIME_PREFIXES.some(p => ct.startsWith(p))) return true;
  // Tiene filename: verificar extensión
  if (att.filename) {
    const ext = path.extname(att.filename).toLowerCase();
    if (IGNORED_EXTENSIONS.includes(ext)) return true;
    return false; // tiene filename no-imagen → conservar
  }
  // Sin filename: conservar solo si el MIME type es de un documento conocido
  if (DOCUMENT_MIME_PREFIXES.some(p => ct.startsWith(p))) return false;
  // Sin filename y MIME desconocido → probablemente firma inline → ignorar
  return true;
}

function isOCAttachment(att) {
  if (!att?.filename) return false;
  const ext = path.extname(att.filename).toLowerCase();
  return OC_EXTENSIONS.includes(ext);
}

// Copia los ítems aceptados de un PRESUPUESTO a una OC (si la OC no tiene ítems aún)
async function copyPresupuestoItemsToOC(presupuestoId, ocId) {
  const existing = await prisma.quoteItem.count({ where: { quoteId: ocId } });
  if (existing > 0) return; // ya tiene ítems, no pisar
  const items = await prisma.quoteItem.findMany({
    where: { quoteId: presupuestoId, accepted: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (!items.length) return;
  await prisma.quoteItem.createMany({
    data: items.map((it, i) => ({
      quoteId:     ocId,
      sku:         it.sku,
      description: it.description,
      quantity:    it.quantity,
      unit:        it.unit,
      unitPrice:   it.unitPrice,
      total:       it.total,
      accepted:    true,
      checked:     true,
      sortOrder:   i,
    })),
  });
  console.log(`   📋 ${items.length} ítems copiados de PRESUPUESTO ${presupuestoId} → OC ${ocId}`);
}

async function nextCode(model, prefix) {
  const all = await model.findMany({ select: { code: true } });
  const nums = all.map(r => parseInt(r.code.split('-')[2]) || 0).filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Abre una carpeta IMAP y devuelve los emails UNSEEN como array de {uid, raw, requiresPrefixCheck}.
 * requiresPrefixCheck=false → vino del label CRM (no necesita verificar prefijo)
 * requiresPrefixCheck=true  → vino de All Mail por subject (hay que verificar prefijo exacto)
 */
function fetchRawFromFolder(imap, folder, searchCriteria, requiresPrefixCheck) {
  return new Promise((resolve) => {
    imap.openBox(folder, false, (err) => {
      if (err) {
        console.warn(`⚠️  Carpeta "${folder}" no disponible: ${err.message}`);
        return resolve([]);
      }
      imap.search(searchCriteria, (err, uids) => {
        if (err || !uids?.length) return resolve([]);
        console.log(`📬 ${uids.length} email(s) en "${folder}"`);
        const mails = [];
        const fetch = imap.fetch(uids, { bodies: '', markSeen: false });
        fetch.on('message', (msg) => {
          const chunks = [];
          const mailData = { uid: null, requiresPrefixCheck };
          msg.on('attributes', (attrs) => { mailData.uid = attrs.uid; });
          msg.on('body', (stream) => {
            stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            stream.on('end', () => { mailData.raw = Buffer.concat(chunks); });
          });
          msg.once('end', () => mails.push(mailData));
        });
        fetch.once('end', () => resolve(mails));
        fetch.once('error', () => resolve(mails));
      });
    });
  });
}

/**
 * Conecta a Gmail vía IMAP y lee mails CRM:
 *  - Fuente 1: etiqueta "crm" (todos los UNSEEN)
 *  - Fuente 2: All Mail con prefijo CRM en el asunto
 * Los duplicados se manejan por messageId en processEmail.
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

    imap.once('ready', async () => {
      try {
        const GMAIL_ALL = process.env.MAIL_ALL_FOLDER || '[Gmail]/All Mail';

        // Fuente 1: etiqueta CRM → no necesita verificar prefijo
        const labelMails = await fetchRawFromFolder(imap, CRM_LABEL, ['UNSEEN'], false);

        // Fuente 2: All Mail con "crm" en asunto (pre-filtro amplio, verificamos prefijo exacto en processEmail)
        const subjectMails = await fetchRawFromFolder(imap, GMAIL_ALL, ['UNSEEN', ['SUBJECT', 'crm']], true);

        // Si All Mail falla, intentar INBOX
        const allMails = [...labelMails, ...subjectMails];

        if (allMails.length === 0) {
          console.log('📧 No hay emails CRM nuevos');
          imap.end();
          return resolve(results);
        }

        console.log(`📧 Total a procesar: ${allMails.length} (label: ${labelMails.length}, asunto: ${subjectMails.length})`);

        const processed = await Promise.allSettled(allMails.map(m => processEmail(m, imap)));
        processed.forEach(p => {
          if (p.status === 'fulfilled' && p.value) {
            results.synced++;
            results.mails.push(p.value);
          } else if (p.status === 'rejected') {
            results.errors.push(p.reason?.message || 'Unknown error');
          }
        });
      } catch (err) {
        results.errors.push(`Sync error: ${err.message}`);
      }
      imap.end();
      resolve(results);
    });

    imap.once('error', (err) => {
      results.errors.push(`IMAP error: ${err.message}`);
      resolve(results);
    });

    imap.once('end', () => console.log('📧 IMAP connection closed'));

    imap.connect();
  });
}

async function processEmail(mailData, imap) {
  try {
    const parsed = await simpleParser(mailData.raw);

    const directFrom  = parsed.from?.value?.[0]?.address || '';
    const subject     = parsed.subject || '(sin asunto)';

    // ── Filtro CRM: si vino de All Mail por subject, verificar prefijo exacto ──
    if (mailData.requiresPrefixCheck && !hasCrmSubject(subject)) {
      console.log(`   ⏭️  Ignorado (no tiene prefijo CRM): "${subject}"`);
      return null; // No marcar como leído
    }
    const date        = parsed.date || new Date();
    const messageId   = parsed.messageId || `uid-${mailData.uid}`;

    // Header de threading: apunta al mail al que se responde
    const inReplyTo = parsed.inReplyTo
      ? parsed.inReplyTo.replace(/[<>]/g, '').trim()
      : null;

    // ── Extraer texto del cuerpo (múltiples estrategias) ─────────────────
    let bodyText = parsed.text
      || (parsed.html ? stripHtml(parsed.html) : '');

    // Si el cuerpo sigue vacío, buscar en mensajes embebidos (message/rfc822)
    let embeddedFrom = '';
    if (!bodyText.trim()) {
      const embeddedMsg = (parsed.attachments || []).find(a =>
        (a.contentType || '').toLowerCase().startsWith('message/')
      );
      if (embeddedMsg?.content) {
        try {
          const embParsed = await simpleParser(embeddedMsg.content);
          bodyText = embParsed.text || (embParsed.html ? stripHtml(embParsed.html) : '');
          embeddedFrom = embParsed.from?.value?.[0]?.address?.toLowerCase()?.trim() || '';
          if (embeddedFrom) console.log(`   📨 Remitente del mensaje embebido: ${embeddedFrom}`);
        } catch (e) {
          console.error('   ⚠️  Error parseando mensaje embebido:', e.message);
        }
      }
    }

    // ── Chequeo de duplicado ──────────────────────────────────────────────
    // Si ya existe, intentar recuperar body e ítems que pudieron haber fallado
    const existing = await prisma.quote.findFirst({
      where: { emailMessageId: messageId },
      include: { _count: { select: { items: true } } },
    });
    if (existing) {
      const updates = {};
      if (!existing.emailBody?.trim() && bodyText.trim()) {
        updates.emailBody = bodyText.substring(0, 20000);
        console.log(`   📝 Body recuperado para ${existing.code} (${bodyText.length} chars)`);
      }

      if (Object.keys(updates).length > 0) {
        await prisma.quote.update({ where: { id: existing.id }, data: updates });
      }

      // Si es PRESUPUESTO sin ítems → intentar re-parsear el PDF adjunto
      if (existing.mailType === 'PRESUPUESTO' && existing._count.items === 0) {
        const realAtts = (parsed.attachments || []).filter(a => !isImageAttachment(a));
        const flexxusAtt = realAtts.find(a => isFlexxusPDF(a));
        if (flexxusAtt) {
          try {
            const fd = await parseFlexxusPDF(flexxusAtt.content);
            if (fd?.items?.length) {
              await prisma.quoteItem.createMany({
                data: fd.items.map((item, i) => ({
                  quoteId:     existing.id,
                  sku:         item.sku || null,
                  description: (item.description || '').substring(0, 500),
                  quantity:    item.quantity || 0,
                  unit:        item.unit || null,
                  unitPrice:   item.unitPrice || null,
                  total:       item.total || null,
                  accepted:    item.accepted !== false,
                  sortOrder:   i,
                })),
              });
              const total = fd.items.filter(i => i.accepted !== false).reduce((s, i) => s + (i.total || 0), 0);
              if (total > 0) await prisma.quote.update({ where: { id: existing.id }, data: { amount: total } });
              console.log(`   📋 ${fd.items.length} ítems recuperados para ${existing.code}`);
            }
          } catch (e) {
            console.error(`   ❌ Error recuperando ítems para ${existing.code}:`, e.message);
          }
        }
      }

      // Marcar como leído para no volver a procesar
      if (mailData.uid) {
        imap.addFlags(mailData.uid, ['\\Seen'], (err) => {
          if (err) console.error('Error marking as seen:', err.message);
        });
      }
      console.log(`   ⏭️  Ya existente: ${existing.code} — datos actualizados`);
      return null;
    }

    // ── Extraer remitente real (puede ser un reenvío) ─────────────────────
    // Prioridad: (1) embedded message From, (2) regex en cuerpo, (3) Reply-To, (4) directFrom
    const isOwnForward = isOwnAddress(directFrom);
    const replyToAddr  = parsed.replyTo?.value?.[0]?.address?.toLowerCase()?.trim() || '';

    const forwardMatch = bodyText.match(FORWARD_FROM_RE) || subject.match(FORWARD_FROM_RE);
    const extractedSender = embeddedFrom || forwardMatch?.[1]?.toLowerCase()?.trim() || '';

    let originalSender;
    if (!isOwnForward) {
      // Mail directo del cliente — el From: ya es el remitente real, sin parsear nada
      originalSender = directFrom.toLowerCase();
      console.log(`   📨 Mail directo de: ${originalSender}`);
    } else if (extractedSender) {
      // Reenvío de cuenta propia — remitente extraído del cuerpo
      originalSender = extractedSender;
    } else if (replyToAddr) {
      originalSender = replyToAddr;
      console.log(`   📨 Remitente via Reply-To: ${replyToAddr}`);
    } else {
      originalSender = directFrom.toLowerCase();
    }
    originalSender = originalSender.trim();

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
    // Cualquier adjunto real no-Flexxus → OC. Sin adjuntos → SOLICITUD.
    const hasOCAttachment = !flexxusData && realAttachments.length > 0;
    const mailType = flexxusData ? 'PRESUPUESTO' : (hasOCAttachment ? 'OC' : 'SOLICITUD');

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
        stage:          mailType === 'PRESUPUESTO' ? 'enviado' : (mailType === 'OC' ? 'oc' : (client ? 'asignada' : 'recibida')),
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

    // ── Auto-vincular OC con PRESUPUESTO existente ───────────────────────
    if (mailType === 'OC') {
      try {
        let presupuestoTarget = null;
        const cutoffOC = new Date(); cutoffOC.setDate(cutoffOC.getDate() - 90);

        // 1. Match por hilo
        if (inReplyTo) {
          presupuestoTarget = await prisma.quote.findFirst({
            where: { emailMessageId: inReplyTo, mailType: 'PRESUPUESTO', linkedQuoteId: null },
          });
          if (presupuestoTarget) console.log(`   🔗 OC: match por hilo email → ${presupuestoTarget.code}`);
        }

        // 2. Fallback: mismo cliente, presupuesto abierto, últimos 90 días
        if (!presupuestoTarget && client) {
          const candidatas = await prisma.quote.findMany({
            where: {
              clientId:      client.id,
              mailType:      'PRESUPUESTO',
              linkedQuoteId: null,
              stage:         { notIn: ['rechazada', 'aceptada'] },
              createdAt:     { gte: cutoffOC },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (candidatas.length === 1) {
            presupuestoTarget = candidatas[0];
            console.log(`   🔗 OC: match por cliente único → ${presupuestoTarget.code}`);
          } else if (candidatas.length > 1) {
            console.log(`   ⚠️  OC: ${candidatas.length} presupuestos abiertos del cliente — vínculo manual requerido`);
          }
        }

        if (presupuestoTarget) {
          const npCode = presupuestoTarget.flexxusCode || null;
          await prisma.quote.update({
            where: { id: quote.id },
            data: { linkedQuoteId: presupuestoTarget.id, ...(npCode ? { flexxusCode: npCode } : {}) },
          });
          await prisma.quote.update({ where: { id: presupuestoTarget.id }, data: { linkedQuoteId: quote.id } });
          console.log(`   🔗 OC ${quote.code} ↔ PRES ${presupuestoTarget.code}${npCode ? ` | NP: ${npCode}` : ''}`);
          await copyPresupuestoItemsToOC(presupuestoTarget.id, quote.id);
        }
      } catch (e) {
        console.error('   ❌ Error al auto-vincular OC:', e.message);
      }
    }

    // ── Crear ítems del presupuesto Flexxus ───────────────────────────────
    if (flexxusData?.items?.length) {
      try {
        await prisma.quoteItem.createMany({
          data: flexxusData.items.map((item, i) => ({
            quoteId:     quote.id,
            sku:         item.sku || null,
            description: (item.description || '').substring(0, 500),
            quantity:    item.quantity || 0,
            unit:        item.unit || null,
            unitPrice:   item.unitPrice || null,
            total:       item.total || null,
            accepted:    item.accepted !== false,
            sortOrder:   i,
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
        const rawName = att.filename || att.name || `adjunto-${Date.now()}`;
        const safeName = `${quote.id}-${rawName.replace(/[^a-zA-Z0-9._\-]/g, '_')}`;
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

/**
 * Re-procesa el email de una cotización específica desde IMAP
 * y actualiza emailFrom / emailBody si estaban mal o vacíos.
 */
async function resyncQuoteEmail(quoteId) {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote?.emailMessageId) return { ok: false, error: 'Sin messageId guardado' };

  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    return { ok: false, error: 'Credenciales de mail no configuradas' };
  }

  return new Promise((resolve) => {
    const imap = new Imap({
      user: process.env.MAIL_USER,
      password: process.env.MAIL_PASSWORD,
      host: process.env.MAIL_HOST || 'imap.gmail.com',
      port: parseInt(process.env.MAIL_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once('ready', () => {
      const GMAIL_ALL = process.env.MAIL_ALL_FOLDER || '[Gmail]/All Mail';
      imap.openBox(GMAIL_ALL, true, async (err) => {
        if (err) { imap.end(); return resolve({ ok: false, error: err.message }); }

        imap.search([['HEADER', 'MESSAGE-ID', quote.emailMessageId]], async (err, uids) => {
          if (err || !uids?.length) {
            imap.end();
            return resolve({ ok: false, error: `Email no encontrado: ${quote.emailMessageId}` });
          }

          const chunks = [];
          const fetch = imap.fetch([uids[0]], { bodies: '' });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
              });
            });
          });

          fetch.once('end', async () => {
            imap.end();
            try {
              const raw = Buffer.concat(chunks);
              const parsed = await simpleParser(raw);
              const directFrom = parsed.from?.value?.[0]?.address || '';

              let bodyText = parsed.text || (parsed.html ? stripHtml(parsed.html) : '');

              let embeddedFrom = '';
              if (!bodyText.trim()) {
                const embeddedMsg = (parsed.attachments || []).find(a =>
                  (a.contentType || '').toLowerCase().startsWith('message/')
                );
                if (embeddedMsg?.content) {
                  try {
                    const embParsed = await simpleParser(embeddedMsg.content);
                    bodyText = embParsed.text || (embParsed.html ? stripHtml(embParsed.html) : '');
                    embeddedFrom = embParsed.from?.value?.[0]?.address?.toLowerCase()?.trim() || '';
                  } catch (_) {}
                }
              }

              const replyToAddr = parsed.replyTo?.value?.[0]?.address?.toLowerCase()?.trim() || '';
              const forwardMatch = bodyText.match(FORWARD_FROM_RE);
              const extractedSender = embeddedFrom || forwardMatch?.[1]?.toLowerCase()?.trim() || '';
              const isOwnForward = isOwnAddress(directFrom);

              let newFrom;
              if (extractedSender) newFrom = extractedSender;
              else if (isOwnForward && replyToAddr) newFrom = replyToAddr;
              else newFrom = directFrom.toLowerCase();

              await prisma.quote.update({
                where: { id: quoteId },
                data: {
                  emailFrom: newFrom.trim(),
                  emailBody: bodyText.substring(0, 20000),
                },
              });

              console.log(`   ✅ Resync ${quote.code}: from=${newFrom} body=${bodyText.length}ch`);
              resolve({ ok: true, emailFrom: newFrom, bodyLength: bodyText.length });
            } catch (e) {
              resolve({ ok: false, error: e.message });
            }
          });

          fetch.once('error', (e) => { imap.end(); resolve({ ok: false, error: e.message }); });
        });
      });
    });

    imap.once('error', (e) => resolve({ ok: false, error: e.message }));
    imap.connect();
  });
}

module.exports = { syncMails, listRecentMails, resyncQuoteEmail };
