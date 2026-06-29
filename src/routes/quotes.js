const express = require('express');
const fs = require('fs');
const path = require('path');
const {authMiddleware, isAdmin } = require('../middleware/auth');
const { onStageChange } = require('../services/notifier');
const { resyncQuoteEmail } = require('../services/mailReader');
const multer = require('multer');
const { parseFlexxusPDF, parseNotaPedidoPDF } = require('../services/flexxusParser');
const { sendQuoteEmail, getTemplates, saveTemplates, getDefaultCC, applyTemplate } = require('../services/mailSender');
const prisma = require('../db');
const { nextCode } = require('../services/codeHelper');

const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = express.Router();

// POST /api/quotes/parse-presupuesto — parsear PDF Flexxus sin crear nada
router.post('/parse-presupuesto', authMiddleware, memUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const data = await parseFlexxusPDF(req.file.buffer);

    let client = null;
    if (data.cuit) {
      client = await prisma.client.findFirst({
        where: { cuit: { equals: data.cuit, mode: 'insensitive' } },
        select: { id: true, code: true, name: true, defaultSellerId: true },
      });
    }

    let seller = null;
    if (client?.defaultSellerId) {
      seller = await prisma.user.findUnique({
        where: { id: client.defaultSellerId },
        select: { id: true, name: true },
      });
    }

    res.json({
      flexxusCode:       data.npCode,
      cuit:              data.cuit,
      clientName:        data.clientName,
      seller:            data.seller,
      total:             data.total,
      subtotalNeto:      data.subtotalNeto,
      ivaAmount:         data.ivaAmount,
      totalPercepciones: data.totalPercepciones,
      itemCount:         data.items?.length || 0,
      items:             data.items || [],
      client,
      defaultSeller:     seller,
    });
  } catch (err) {
    console.error('Error parseando presupuesto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quotes/create-np — crear Nota de Pedido manualmente (Quote NOTA_PEDIDO)
const UPLOADS_DIR_NP = path.join(__dirname, '../../uploads/attachments');
router.post('/create-np', authMiddleware, memUpload.single('file'), async (req, res) => {
  try {
    const { fromQuoteId, clientId: directClientId, clientOCCode, flexxusCode } = req.body;

    // Parse PDF si vino adjunto
    let npData = null;
    if (req.file) {
      const catalog = await prisma.article.findMany({ select: { code: true, description: true } });
      npData = await parseNotaPedidoPDF(req.file.buffer, { catalog });
    }

    // Resolver presupuesto, cliente y vendedor
    let presupuesto = null;
    if (fromQuoteId) {
      presupuesto = await prisma.quote.findUnique({ where: { id: fromQuoteId } });
      if (!presupuesto) return res.status(404).json({ error: 'Presupuesto no encontrado' });
    }
    const resolvedClientId = directClientId || presupuesto?.clientId || null;
    const resolvedSellerId = presupuesto?.sellerId || req.user.id;

    // Generar código NP-YYYY-NNN
    const year = new Date().getFullYear();
    const code = await nextCode(prisma.quote, `NP-${year}`);

    // Crear Quote NOTA_PEDIDO
    const quote = await prisma.quote.create({
      data: {
        code,
        mailType:           'NOTA_PEDIDO',
        source:             'UPLOAD',
        stage:              await prisma.appSetting.findUnique({ where: { key: 'default_stage_nota_pedido' } }).then(s => s?.value || 'np_enviada'),
        clientId:           resolvedClientId,
        sellerId:           resolvedSellerId,
        flexxusCode:        flexxusCode || npData?.npCode || null,
        clientOCCode:       clientOCCode || npData?.ocNumber || null,
        amount:             npData?.total ?? null,
        currency:           'USD',
        subtotalNeto:       npData?.subtotalNeto       ?? null,
        ivaAmount:          npData?.ivaAmount          ?? null,
        totalPercepciones:  npData?.totalPercepciones  ?? null,
        emailSubject:       (flexxusCode || npData?.npCode || `NP ${clientOCCode || 'manual'}`).substring(0, 500),
        linkedQuoteId:      fromQuoteId || null,
      },
    });

    // Vínculo bidireccional: presupuesto → NP
    if (presupuesto && !presupuesto.linkedQuoteId) {
      await prisma.quote.update({ where: { id: presupuesto.id }, data: { linkedQuoteId: quote.id } });
    }

    // Crear ítems del PDF
    if (npData?.items?.length) {
      await prisma.quoteItem.createMany({
        data: npData.items.map((item, i) => ({
          quoteId:     quote.id,
          sku:         item.sku || null,
          description: (item.description || '').substring(0, 500),
          quantity:    item.quantity || 0,
          unit:        item.unit || null,
          unitPrice:   item.unitPrice || null,
          total:       item.total || null,
          accepted:    true,
          sortOrder:   i,
        })),
      });
    }

    // Guardar PDF como adjunto
    if (req.file) {
      if (!fs.existsSync(UPLOADS_DIR_NP)) fs.mkdirSync(UPLOADS_DIR_NP, { recursive: true });
      const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${quote.id}-${Date.now()}-${safe}`;
      const filepath = path.join(UPLOADS_DIR_NP, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      await prisma.attachment.create({
        data: { filename, path: filepath, size: req.file.size, mimeType: req.file.mimetype, quoteId: quote.id },
      });
    }

    // Auto-aceptar presupuesto vinculado
    if (fromQuoteId) {
      try {
        const { autoAcceptPresupuesto } = require('../services/quoteHelper');
        await autoAcceptPresupuesto(fromQuoteId);
      } catch (e) {
        console.error('Error en auto-accept presupuesto (create-np):', e.message);
      }
    }

    await prisma.activity.create({
      data: {
        action:  'CREATED',
        detail:  `Nota de Pedido ${code} cargada manualmente${presupuesto ? ` | Pres. ${presupuesto.code}` : ''}`,
        quoteId: quote.id,
        userId:  req.user.id,
      },
    });

    res.status(201).json({ id: quote.id, code: quote.code });
  } catch (err) {
    console.error('Error creando NP manual:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quotes - All quotes (admin sees all, seller sees own)
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Excluir OC y NOTA_PEDIDO — esas van en el board de Fase 2 (órdenes)
    // Nota: mailType null (manuales) debe incluirse — OR para manejar nulls en PG
    const mailTypeFilter = {
      OR: [
        { mailType: null },
        { mailType: { notIn: ['OC', 'NOTA_PEDIDO'] } },
      ],
    };
    const where = { ...mailTypeFilter };
    if (req.user.role === 'VENDEDOR') {
      // Vendedor ve: sus propias quotes + las sin asignar (recibida, sin seller)
      // AND: el filtro de mailType se mantiene combinado con el de seller/stage
      where.AND = [
        mailTypeFilter,
        {
          OR: [
            { sellerId: req.user.id },
            { sellerId: null, stage: 'recibida' },
          ],
        },
      ];
      // Limpiar la condición OR del nivel superior para evitar duplicación
      delete where.OR;
    }
    // Filtro de fecha (opcional — carga inicial usa últimos 12 meses)
    if (req.query.since) {
      where.createdAt = { gte: new Date(req.query.since) };
    }

    const quotes = await prisma.quote.findMany({
      where,
      include: {
        client: { select: { id: true, code: true, name: true, city: true, province: true, zone: true } },
        seller: { select: { id: true, name: true, email: true, zone: true } },
        linkedQuote: { select: { id: true, code: true, mailType: true, stage: true, flexxusCode: true } },
        _count: { select: { notes: true, attachments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,  // límite de seguridad — la paginación real puede venir después
    });

    // Format for frontend compatibility
    const formatted = quotes.map(q => ({
      id: q.id,
      code: q.code,
      client: q.client?.code || '',
      clientName: q.client?.name || '',
      clientCity: q.client?.city || '',
      clientProvince: q.client?.province || '',
      seller: q.sellerId || '',
      sellerName: q.seller?.name || '',
      stage: q.stage,
      source: q.source,
      ingreso: q.createdAt.toISOString(),
      dias: Math.floor((Date.now() - q.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      monto: q.amount,
      currency: q.currency || 'USD',
      adj: q._count.attachments,
      notas: q._count.notes,
      flexxus: q.flexxusCode || '',
      isDraft: q.isDraft,
      emailSubject: q.emailSubject,
      emailFrom: q.emailFrom,
      emailMessageId: q.emailMessageId || null,
      mailType: q.mailType || null,
      followUpDate: q.followUpDate?.toISOString() || null,
      rejectReason: q.rejectReason,
      linkedQuoteId:   q.linkedQuoteId || null,
      linkedQuoteCode: q.linkedQuote?.code || null,
      linkedQuoteType: q.linkedQuote?.mailType || null,
      linkedQuoteStage: q.linkedQuote?.stage || null,
      linkedQuoteFlexxus: q.linkedQuote?.flexxusCode || null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching quotes:', err);
    res.status(500).json({ error: 'Error al obtener cotizaciones' });
  }
});

// GET /api/quotes/send-accounts — lista cuentas disponibles para envío SMTP
router.get('/send-accounts', authMiddleware, async (req, res) => {
  try {
    const accounts = [];
    // Env accounts
    if (process.env.MAIL_ACCOUNTS) {
      try { JSON.parse(process.env.MAIL_ACCOUNTS).forEach(a => accounts.push(a.user)); } catch (_) {}
    } else if (process.env.MAIL_USER) {
      accounts.push(process.env.MAIL_USER);
    }
    // DB accounts
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    if (setting?.value) {
      try {
        const dbAccs = JSON.parse(setting.value);
        dbAccs.forEach(a => { if (!accounts.includes(a.user)) accounts.push(a.user); });
      } catch (_) {}
    }
    // Detectar cuál preseleccionar: si el email del usuario logueado coincide con alguna cuenta
    const userEmail = req.user.email?.toLowerCase();
    const defaultAccount = accounts.find(a => a.toLowerCase() === userEmail) || accounts[0] || null;
    res.json({ accounts, defaultAccount });
  } catch (err) {
    res.json({ accounts: [], defaultAccount: null });
  }
});

// POST /api/quotes - Create new quote
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId, amount, source, deadline, notes, currency } = req.body;

    // Generate next code
    const code = await nextCode(prisma.quote, 'COT-2026');

    // followUpDate: hoy + follow_up_days (igual que cuando se cambia a etapa "enviado")
    const fudSetting = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
    const fudDays    = Math.max(1, parseInt(fudSetting?.value || '4'));
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + fudDays);

    const quote = await prisma.quote.create({
      data: {
        code,
        clientId,
        sellerId: sellerId || null,
        amount: amount ? parseFloat(amount) : null,
        source: source || 'MANUAL',
        mailType: 'PRESUPUESTO',
        stage: 'enviado',
        currency: currency === 'ARS' ? 'ARS' : 'USD',
        deadline: deadline ? new Date(deadline) : null,
        followUpDate,
      },
      include: {
        client: { select: { code: true, name: true } },
        seller: { select: { name: true } },
      },
    });

    // Log activity
    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: `Creó cotización ${code} para ${quote.client.name}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    // Si se asignó a un vendedor distinto al creador, agregar a pendingAssigned para notificación persistente
    if (sellerId && sellerId !== req.user.id) {
      try {
        const seller = await prisma.user.findUnique({ where: { id: sellerId }, select: { notificationPrefs: true } });
        const prefs   = seller?.notificationPrefs || {};
        const pending = Array.isArray(prefs.pendingAssigned) ? prefs.pendingAssigned : [];
        if (!pending.includes(quote.id)) {
          await prisma.user.update({
            where: { id: sellerId },
            data:  { notificationPrefs: { ...prefs, pendingAssigned: [...pending, quote.id] } },
          });
        }
      } catch (e) {
        console.error('pendingAssigned update error:', e.message);
      }
    }

    res.status(201).json(quote);
  } catch (err) {
    console.error('Error creating quote:', err);
    res.status(500).json({ error: 'Error al crear cotización' });
  }
});

// PATCH /api/quotes/:id/stage - Change stage
router.patch('/:id/stage', authMiddleware, async (req, res) => {
  try {
    const { stage, rejectReason, rejectNotes } = req.body;
    if (!stage) return res.status(400).json({ error: 'stage es requerido' });

    // Validar motivo de rechazo obligatorio
    if (stage === 'rechazada' && !rejectReason) {
      return res.status(400).json({ error: 'Se requiere un motivo de rechazo al rechazar una cotización' });
    }

    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { client: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    // VENDEDOR solo puede modificar sus propias cotizaciones
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const oldStage = quote.stage;

    // Validar etapas obligatorias (solo al avanzar, no al rechazar ni retroceder)
    if (stage !== 'rechazada') {
      const allStages = await prisma.stageDefinition.findMany({
        where: { active: true, phase: 'COTIZACION' },
        orderBy: { order: 'asc' },
      });
      const orderedKeys = allStages.map(s => s.stageKey);
      const currentIdx = orderedKeys.indexOf(oldStage);
      const targetIdx  = orderedKeys.indexOf(stage);

      if (currentIdx !== -1 && targetIdx > currentIdx + 1) {
        // Hay etapas entre currentIdx y targetIdx — verificar si alguna es obligatoria
        const skipped = allStages.slice(currentIdx + 1, targetIdx);
        const blockers = skipped.filter(s => s.mandatory);
        if (blockers.length > 0) {
          return res.status(400).json({
            error: `No podés saltear la etapa obligatoria "${blockers[0].label}"`,
          });
        }
      }
    }

    const updateData = { stage, stageChangedAt: new Date() };
    if (stage === 'rechazada' && rejectReason) {
      updateData.rejectReason = rejectReason;
      updateData.rejectNotes = rejectNotes || null;
    }
    // Limpiar followUpDate cuando la cotización termina (aceptada / rechazada)
    if (stage === 'aceptada' || stage === 'rechazada') {
      updateData.followUpDate = null;
    }
    if (stage === 'enviado') {
      const fudSetting = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
      const fudDays    = Math.max(1, parseInt(fudSetting?.value || '4'));
      const d = new Date();
      d.setDate(d.getDate() + fudDays);
      updateData.followUpDate = d;
    }

    // ── Ejecutar el cambio de etapa (y creación de OC si aplica) en una transacción
    // para que si falla el order.create la quote no quede en 'aceptada' sin OC.
    let updated;
    await prisma.$transaction(async (tx) => {
      updated = await tx.quote.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await tx.activity.create({
        data: {
          action: 'STAGE_CHANGE',
          detail: `Movió ${quote.code} de ${oldStage} a ${stage}`,
          userId: req.user.id,
          quoteId: quote.id,
        },
      });

      // Si se acepta, crear OC en espejo si no existe ya una en stage 'oc'
      if (stage === 'aceptada') {
        const existingOrder = await tx.order.findFirst({ where: { fromQuoteId: quote.id, stage: 'oc' } });
        if (existingOrder) {
          console.log(`ℹ️  OC en 'oc' ya existe para ${quote.code}: ${existingOrder.code}`);
        } else {
          const ocCode = await nextCode(prisma.order, 'OC-2026');
          await tx.order.create({
            data: {
              code:        ocCode,
              clientId:    quote.clientId,
              sellerId:    quote.sellerId,
              fromQuoteId: quote.id,
              stage:       'oc',
              flexxusCode: quote.flexxusCode,
            },
          });
          await tx.activity.create({
            data: {
              action:  'CREATED',
              detail:  `OC ${ocCode} creada automáticamente desde ${quote.code}`,
              userId:  req.user.id,
              quoteId: quote.id,
            },
          });
        }
      }
    });

    // ── Movimiento en paquete: si es PRESUPUESTO → mover SOLICITUD vinculada también ──
    if ((stage === 'aceptada' || stage === 'rechazada') && quote.mailType === 'PRESUPUESTO' && quote.linkedQuoteId) {
      try {
        const solicitud = await prisma.quote.findUnique({
          where: { id: quote.linkedQuoteId },
          select: { id: true, code: true, mailType: true, stage: true },
        });
        if (solicitud && solicitud.mailType === 'SOLICITUD' && solicitud.stage !== stage) {
          await prisma.quote.update({
            where: { id: solicitud.id },
            data: { stage, stageChangedAt: new Date(), followUpDate: null,
                    ...(stage === 'rechazada' && rejectReason ? { rejectReason, rejectNotes: rejectNotes || null } : {}) },
          });
          await prisma.activity.create({
            data: {
              action: 'STAGE_CHANGE',
              detail: `Movió ${solicitud.code} a ${stage} junto con ${quote.code} (paquete)`,
              userId: req.user.id,
              quoteId: solicitud.id,
            },
          });
        }
      } catch (e) {
        console.error('Package move error:', e.message);
      }
    }

    // Disparar notificaciones fuera de la transacción (no bloquea ni revierte)
    onStageChange(quote.id, oldStage, stage).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error('Error updating stage:', err);
    res.status(500).json({ error: 'Error al actualizar etapa' });
  }
});

// PATCH /api/quotes/:id/assign - Reassign seller (solo admin o logística)
router.patch('/:id/assign', authMiddleware, async (req, res) => {
  if (req.user.role === 'VENDEDOR') {
    return res.status(403).json({ error: 'Solo administradores pueden reasignar cotizaciones' });
  }
  try {
    const { sellerId } = req.body;
    const quote = await prisma.quote.update({
      where: { id: req.params.id },
      data: { sellerId },
      include: { seller: { select: { name: true } } },
    });

    await prisma.activity.create({
      data: {
        action: 'ASSIGNED',
        detail: `Asignó ${quote.code} a ${quote.seller?.name || 'sin asignar'}`,
        userId: req.user.id,
        quoteId: quote.id,
      },
    });

    res.json(quote);
  } catch (err) {
    console.error('Error assigning seller:', err);
    res.status(500).json({ error: 'Error al asignar vendedor' });
  }
});

// GET /api/quotes/:id/detail - Full detail with notes and history
router.get('/:id/detail', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        seller: { select: { id: true, name: true, email: true } },
        notes: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'desc' } },
        activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        items: { orderBy: { sortOrder: 'asc' } },
        linkedQuote: {
          include: {
            activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
          },
        },
        linkedBy: {
          include: {
            activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
          },
          take: 5,
        },
      },
    });
    if (!quote) return res.status(404).json({ error: 'No encontrada' });

    // ── Orden de Compra vinculada ─────────────────────────────────────────
    const linkedOrder = await prisma.order.findFirst({
      where: { fromQuoteId: quote.id },
      select: {
        id: true, code: true, stage: true, createdAt: true,
        activities: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ── Historial unificado: mezclar actividades de TODOS los documentos vinculados ──
    // PRESUPUESTO: linkedQuote(SOLICITUD) + linkedBy[](NP) + linkedOrder(OC)
    // SOLICITUD:   linkedQuote(PRESUPUESTO)
    // NP Quote:    linkedQuote(PRESUPUESTO)
    const ownActivities = (quote.activities || [])
      .map(a => ({ ...a, _fromCode: quote.code, _fromType: quote.mailType }));

    const linkedQuoteActivities = (quote.linkedQuote?.activities || [])
      .map(a => ({ ...a, _fromCode: quote.linkedQuote.code, _fromType: quote.linkedQuote.mailType }));

    const linkedByActivities = (quote.linkedBy || []).flatMap(lb =>
      (lb.activities || []).map(a => ({ ...a, _fromCode: lb.code, _fromType: lb.mailType }))
    );

    const linkedOrderActivities = (linkedOrder?.activities || [])
      .map(a => ({ ...a, _fromCode: linkedOrder.code, _fromType: 'ORDER' }));

    const unifiedHistory = [
      ...ownActivities,
      ...linkedQuoteActivities,
      ...linkedByActivities,
      ...linkedOrderActivities,
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    res.json({ ...quote, unifiedHistory, linkedOrder: linkedOrder || null });
  } catch (err) {
    console.error('Error en detail endpoint:', err);
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/quotes/:id/reparse-items - Re-parse Flexxus PDF from stored attachment
router.post('/:id/reparse-items', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { attachments: true },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    const pdfAtt = (quote.attachments || []).find(a =>
      (a.mimeType || '').includes('pdf') || (a.filename || '').toLowerCase().endsWith('.pdf')
    );
    if (!pdfAtt) return res.status(404).json({ error: 'No se encontró adjunto PDF' });
    if (!fs.existsSync(pdfAtt.path)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });

    const buffer = fs.readFileSync(pdfAtt.path);
    const flexxusData = await parseFlexxusPDF(buffer);

    if (!flexxusData?.items?.length) {
      return res.status(400).json({ error: 'El PDF no contiene ítems Flexxus reconocibles' });
    }

    await prisma.quoteItem.deleteMany({ where: { quoteId: quote.id } });
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

    // Preferir el grand total del PDF (con IVA + percepciones); fallback a suma de ítems
    const itemsTotal = flexxusData.items
      .filter(i => i.accepted !== false)
      .reduce((s, i) => s + (i.total || 0), 0);
    const flexxusTotal = flexxusData.total || itemsTotal;

    const updateData = {};
    if (flexxusTotal > 0)                          updateData.amount             = flexxusTotal;
    if (flexxusData.subtotalNeto != null)           updateData.subtotalNeto       = flexxusData.subtotalNeto;
    if (flexxusData.ivaAmount != null)              updateData.ivaAmount          = flexxusData.ivaAmount;
    if (flexxusData.totalPercepciones != null)      updateData.totalPercepciones  = flexxusData.totalPercepciones;
    if (Object.keys(updateData).length) {
      await prisma.quote.update({ where: { id: quote.id }, data: updateData });
    }

    res.json({ ok: true, itemCount: flexxusData.items.length, total: flexxusTotal });
  } catch (err) {
    console.error('Error re-parseando PDF:', err);
    res.status(500).json({ error: err.message || 'Error al re-parsear PDF' });
  }
});

// POST /api/quotes/:id/resync-email - Re-fetch email from IMAP and update emailFrom/emailBody
router.post('/:id/resync-email', authMiddleware, async (req, res) => {
  try {
    const result = await resyncQuoteEmail(req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al re-sincronizar email' });
  }
});

// POST /api/quotes/:id/notes - Add a note
router.post('/:id/notes', authMiddleware, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'El texto de la nota no puede estar vacío' });

    // VENDEDOR solo puede agregar notas a sus propias cotizaciones
    if (req.user.role === 'VENDEDOR') {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { sellerId: true } });
      if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (q.sellerId !== req.user.id) return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const note = await prisma.note.create({
      data: {
        text,
        userId: req.user.id,
        quoteId: req.params.id,
      },
      include: { user: { select: { name: true } } },
    });

    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    await prisma.activity.create({
      data: {
        action: 'NOTE_ADDED',
        detail: `Agregó nota en ${quote.code}`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar nota' });
  }
});

// DELETE /api/quotes/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
    });
    if (!quote) return res.status(404).json({ error: 'No encontrada' });

    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Solo administradores pueden eliminar cotizaciones' });
    }

    // ── Limpiar todas las referencias FK antes de eliminar ──────────────────

    // 1. Si es PRESUPUESTO: revertir datos propagados a SOLICITUDes vinculadas
    if (quote.mailType === 'PRESUPUESTO') {
      const linkedSolicitudes = await prisma.quote.findMany({
        where: { linkedQuoteId: req.params.id, mailType: 'SOLICITUD' },
        select: { id: true, stage: true, sellerId: true },
      });
      for (const sol of linkedSolicitudes) {
        const revertData = { linkedQuoteId: null, flexxusCode: null };
        if (sol.stage === 'aceptada' || sol.stage === 'rechazada') {
          revertData.stage = sol.sellerId ? 'asignada' : 'recibida';
          revertData.stageChangedAt = new Date();
          revertData.rejectReason = null;
          revertData.rejectNotes = null;
        }
        await prisma.quote.update({ where: { id: sol.id }, data: revertData });
      }
    }

    // 2. Resto de quotes que apuntan a esta vía linkedQuoteId (NP, etc.)
    await prisma.quote.updateMany({
      where: { linkedQuoteId: req.params.id },
      data:  { linkedQuoteId: null },
    });

    // 3. Orders que apuntan a esta vía fromQuoteId
    await prisma.order.updateMany({
      where: { fromQuoteId: req.params.id },
      data:  { fromQuoteId: null },
    });

    // 4. Limpiar el propio linkedQuoteId (para no tener FK roto al borrar)
    if (quote.linkedQuoteId) {
      await prisma.quote.update({
        where: { id: req.params.id },
        data:  { linkedQuoteId: null },
      });
    }

    await prisma.quote.delete({ where: { id: req.params.id } });
    res.json({ ok: true, code: quote.code });
  } catch (err) {
    console.error('Error deleting quote:', err);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// PATCH /api/quotes/:id/client — assign client (and optionally seller)
router.patch('/:id/client', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId } = req.body;

    // VENDEDOR solo puede asignar cliente a sus propias cotizaciones
    if (req.user.role === 'VENDEDOR') {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { sellerId: true } });
      if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (q.sellerId !== req.user.id) return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { defaultSeller: { select: { id: true, name: true } } },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    const updateData = { clientId };
    const resolvedSellerId = sellerId || client.defaultSellerId || null;
    if (resolvedSellerId) {
      updateData.sellerId = resolvedSellerId;
      // Solo avanzar a 'asignada' si la quote está en etapa inicial (nueva/sin asignar).
      // Si ya pasó por etapas posteriores, no la retrocedemos.
      const current = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { stage: true } });
      if (current?.stage === 'recibida') updateData.stage = 'asignada';
    }

    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await prisma.activity.create({
      data: {
        action: 'ASSIGNED',
        detail: `Cliente asignado: ${client.name}${resolvedSellerId ? ` · Vendedor: ${client.defaultSeller?.name || ''}` : ''}`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    // Retroalimentación: guardar emailFrom en ClientEmail para matcheo futuro
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { emailFrom: true } });
    if (quote?.emailFrom) {
      const emailFrom = quote.emailFrom.toLowerCase().trim();
      await prisma.clientEmail.upsert({
        where: { email_clientId: { email: emailFrom, clientId } },
        update: {},
        create: { email: emailFrom, clientId, isPrimary: false },
      }).catch(() => {}); // silenciar si ya existe
    }

    res.json(updated);
  } catch (err) {
    console.error('Error assigning client:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quotes/:id/duplicate — duplicar cotización para otro cliente
router.post('/:id/duplicate', authMiddleware, async (req, res) => {
  try {
    const { clientId, sellerId } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId requerido' });

    // Cargar original con ítems
    const original = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!original) return res.status(404).json({ error: 'Cotización no encontrada' });

    // Verificar que el cliente destino existe
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, defaultSellerId: true },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

    const resolvedSellerId = sellerId || client.defaultSellerId || original.sellerId || null;
    const code = await nextCode(prisma.quote, 'COT-2026');

    // Crear la copia
    const duplicate = await prisma.quote.create({
      data: {
        code,
        clientId,
        sellerId: resolvedSellerId,
        stage: resolvedSellerId ? 'asignada' : 'recibida',
        source: original.source,
        mailType: original.mailType,
        emailSubject: original.emailSubject ? `[Dup] ${original.emailSubject}` : null,
        emailFrom: original.emailFrom,
        amount: original.amount,
        currency: original.currency || 'USD',
        subtotalNeto: original.subtotalNeto,
        ivaAmount: original.ivaAmount,
        totalPercepciones: original.totalPercepciones,
      },
      include: {
        client: { select: { code: true, name: true } },
        seller: { select: { name: true } },
      },
    });

    // Copiar ítems
    if (original.items.length > 0) {
      await prisma.quoteItem.createMany({
        data: original.items.map((it, i) => ({
          quoteId: duplicate.id,
          sku: it.sku,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          total: it.total,
          accepted: it.accepted,
          checked: true,
          sortOrder: i,
        })),
      });
    }

    // Activity en la copia
    await prisma.activity.create({
      data: {
        action: 'CREATED',
        detail: `Duplicada desde ${original.code} para ${client.name}`,
        userId: req.user.id,
        quoteId: duplicate.id,
      },
    });

    // Activity en la original
    await prisma.activity.create({
      data: {
        action: 'NOTE',
        detail: `Cotización duplicada como ${code} para ${client.name}`,
        userId: req.user.id,
        quoteId: original.id,
      },
    });

    res.json({
      id: duplicate.id,
      code: duplicate.code,
      client: duplicate.client?.code || '',
      clientName: duplicate.client?.name || '',
      sellerName: duplicate.seller?.name || '',
      stage: duplicate.stage,
      monto: duplicate.amount,
    });
  } catch (err) {
    console.error('Error duplicating quote:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: copia ítems aceptados de PRESUPUESTO a OC (si la OC no tiene ítems aún)
async function copyPresupuestoItemsToOC(presupuestoId, ocId) {
  const existing = await prisma.quoteItem.count({ where: { quoteId: ocId } });
  if (existing > 0) return;
  const items = await prisma.quoteItem.findMany({
    where: { quoteId: presupuestoId, accepted: true },
    orderBy: { sortOrder: 'asc' },
  });
  if (!items.length) return;
  await prisma.quoteItem.createMany({
    data: items.map((it, i) => ({
      quoteId: ocId, sku: it.sku, description: it.description,
      quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice,
      total: it.total, accepted: true, checked: true, sortOrder: i,
    })),
  });
}

// PATCH /api/quotes/:id/amount — editar monto manualmente
router.patch('/:id/amount', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount == null || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: 'Monto inválido' });
    }
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }
    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: { amount: parseFloat(amount) },
    });
    await prisma.activity.create({
      data: {
        action: 'STAGE_CHANGE',
        detail: `Monto actualizado a ${parseFloat(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${quote.currency || 'USD'}`,
        quoteId: quote.id,
        userId: req.user.id,
      },
    });
    res.json({ id: updated.id, amount: updated.amount });
  } catch (err) {
    console.error('Error updating amount:', err);
    res.status(500).json({ error: 'Error al actualizar monto' });
  }
});

// PATCH /api/quotes/:id/link — vincular quotes (SOLICITUD ↔ PRESUPUESTO ↔ OC)
// body: { linkedQuoteId } — o null para desvincular
router.patch('/:id/link', authMiddleware, async (req, res) => {
  try {
    const { linkedQuoteId } = req.body;

    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    // VENDEDOR solo puede vincular sus propias cotizaciones
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    let target = null;
    if (linkedQuoteId) {
      target = await prisma.quote.findUnique({ where: { id: linkedQuoteId } });
      if (!target) return res.status(404).json({ error: 'Cotización destino no encontrada' });
    }

    // Determinar cuál es PRESUPUESTO para propagar NP y copiar ítems a OC
    let presupuesto = null, solicitud = null, oc = null;
    if (target) {
      presupuesto = quote.mailType === 'PRESUPUESTO' ? quote : (target.mailType === 'PRESUPUESTO' ? target : null);
      solicitud   = quote.mailType === 'SOLICITUD'   ? quote : (target.mailType === 'SOLICITUD'   ? target : null);
      oc          = quote.mailType === 'OC'          ? quote : (target.mailType === 'OC'          ? target : null);
    }
    const npToPropagate = presupuesto?.flexxusCode || null;

    // Actualizar vínculo en ambas cotizaciones + propagar flexxusCode a SOLICITUD y OC
    const propagateToReq = npToPropagate && (solicitud?.id === req.params.id || oc?.id === req.params.id);
    const propagateToTarget = npToPropagate && (solicitud?.id === target?.id || oc?.id === target?.id);
    await prisma.quote.update({
      where: { id: req.params.id },
      data: { linkedQuoteId: linkedQuoteId || null, ...(propagateToReq ? { flexxusCode: npToPropagate } : {}) },
    });
    if (target) {
      await prisma.quote.update({
        where: { id: target.id },
        data: {
          linkedQuoteId: req.params.id,
          ...(propagateToTarget ? { flexxusCode: npToPropagate } : {}),
        },
      });
      // Si hay una OC en el vínculo y hay un PRESUPUESTO, copiar ítems
      if (oc && presupuesto) {
        await copyPresupuestoItemsToOC(presupuesto.id, oc.id);
      }
    } else {
      // Desvincular: limpiar el linkedQuoteId de SOLICITUD/PRESUPUESTO que apuntan a esta,
      // pero NO tocar las NOTA_PEDIDO vinculadas (ese es un vínculo diferente)
      await prisma.quote.updateMany({
        where: {
          linkedQuoteId: req.params.id,
          mailType: { notIn: ['NOTA_PEDIDO'] },
        },
        data: { linkedQuoteId: null },
      });
      // También limpiar quotes sin mailType (manuales)
      await prisma.quote.updateMany({
        where: {
          linkedQuoteId: req.params.id,
          mailType: null,
        },
        data: { linkedQuoteId: null },
      });
    }

    // Log actividad en ambas
    const detail = target
      ? `Vinculada con ${target.code} (${target.mailType || target.source})${npToPropagate ? ` · NP ${npToPropagate}` : ''}`
      : 'Vínculo eliminado';
    await prisma.activity.create({
      data: { action: 'LINKED', detail, userId: req.user.id, quoteId: req.params.id },
    });
    if (target) {
      await prisma.activity.create({
        data: {
          action: 'LINKED',
          detail: `Vinculada con ${quote.code} (${quote.mailType || quote.source})${npToPropagate ? ` · NP ${npToPropagate}` : ''}`,
          userId: req.user.id,
          quoteId: target.id,
        },
      });
    }

    // Auto-aceptar presupuesto cuando una NP se vincula manualmente a él
    const npQuote = quote.mailType === 'NOTA_PEDIDO' ? quote : (target?.mailType === 'NOTA_PEDIDO' ? target : null);
    if (npQuote && presupuesto && linkedQuoteId) {
      try {
        const { autoAcceptPresupuesto } = require('../services/quoteHelper');
        await autoAcceptPresupuesto(presupuesto.id);
      } catch (e) {
        console.error('Error en auto-accept presupuesto (link):', e.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error linking quotes:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/quotes/:id/items/:itemId — actualizar ítem (accepted, checked, quantity, description, sku, unitPrice)
router.patch('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    // Verificar que el ítem pertenece a esta cotización
    const item = await prisma.quoteItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.quoteId !== req.params.id) return res.status(404).json({ error: 'Ítem no encontrado en esta cotización' });

    // VENDEDOR solo puede modificar ítems de sus propias cotizaciones
    if (req.user.role === 'VENDEDOR') {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { sellerId: true } });
      if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (q.sellerId !== req.user.id) return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const { accepted, checked, quantity, description, sku, unitPrice } = req.body;
    const data = {};
    if (accepted   !== undefined) data.accepted   = accepted;
    if (checked    !== undefined) data.checked    = checked;
    if (quantity   !== undefined) data.quantity   = parseFloat(quantity);
    if (description !== undefined) data.description = description;
    if (sku        !== undefined) data.sku        = sku || null;
    if (unitPrice  !== undefined) {
      data.unitPrice = unitPrice != null ? parseFloat(unitPrice) : null;
      if (data.unitPrice != null && data.quantity != null) {
        data.total = data.unitPrice * data.quantity;
      }
    }
    // recalcular total si cambia quantity y hay unitPrice
    if (quantity !== undefined && unitPrice === undefined) {
      if (item?.unitPrice != null) data.total = item.unitPrice * data.quantity;
    }
    const updated = await prisma.quoteItem.update({ where: { id: req.params.itemId }, data });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quotes/:id/items — agregar ítem manualmente a una OC
router.post('/:id/items', authMiddleware, async (req, res) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });

    // VENDEDOR solo puede agregar ítems a sus propias cotizaciones
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    const { description, sku, quantity = 1, unit, unitPrice } = req.body;
    if (!description) return res.status(400).json({ error: 'description es requerida' });

    const last = await prisma.quoteItem.findFirst({
      where: { quoteId: req.params.id }, orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;
    const qty  = parseFloat(quantity) || 1;
    const up   = unitPrice != null ? parseFloat(unitPrice) : null;
    const item = await prisma.quoteItem.create({
      data: {
        quoteId: req.params.id,
        description, sku: sku || null, quantity: qty, unit: unit || null,
        unitPrice: up, total: up != null ? up * qty : null,
        accepted: true, checked: true, sortOrder,
      },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/quotes/:id/items/:itemId — eliminar ítem definitivamente
router.delete('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    // Verificar que el ítem pertenece a esta cotización (evita IDOR cross-quote)
    const item = await prisma.quoteItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.quoteId !== req.params.id) return res.status(404).json({ error: 'Ítem no encontrado en esta cotización' });

    // VENDEDOR solo puede eliminar ítems de sus propias cotizaciones
    if (req.user.role === 'VENDEDOR') {
      const q = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { sellerId: true } });
      if (!q) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (q.sellerId !== req.user.id) return res.status(403).json({ error: 'Sin permiso sobre esta cotización' });
    }

    await prisma.quoteItem.delete({ where: { id: req.params.itemId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Email sending ─────────────────────────────────────────────────────────────

// GET /api/quotes/email-templates — lista de plantillas + CC default
router.get('/email-templates', authMiddleware, async (req, res) => {
  try {
    const [templates, cc] = await Promise.all([getTemplates(), getDefaultCC()]);
    res.json({ templates, ccDefault: cc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/quotes/email-templates — guardar plantillas + CC default
router.put('/email-templates', authMiddleware, async (req, res) => {
  try {
    const { templates, ccDefault } = req.body;
    if (templates) await saveTemplates(templates);
    if (ccDefault !== undefined) {
      await prisma.appSetting.upsert({
        where:  { key: 'email_cc_default' },
        update: { value: ccDefault },
        create: { key: 'email_cc_default', value: ccDefault },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quotes/:id/send-email — enviar presupuesto por email (o registrar envío por Gmail)
router.post('/:id/send-email', authMiddleware, async (req, res) => {
  try {
    const { to, cc, subject, body, attachmentId, fromEmail, _gmailOnly } = req.body;
    if (!to)      return res.status(400).json({ error: '"to" es requerido' });
    if (!subject) return res.status(400).json({ error: '"subject" es requerido' });
    if (!body)    return res.status(400).json({ error: '"body" es requerido' });

    // Modo Gmail: solo logear actividad y avanzar etapa, sin envío SMTP
    if (_gmailOnly) {
      // Fetch quote first — valida existencia y permite check de ownership
      const STAGES_TO_ADVANCE = ['asignada', 'armado', 'revision', 'presupuestado', 'recibida', 'oferta', 'proveedor'];
      const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { stage: true, sellerId: true } });
      if (!quote) return res.status(404).json({ error: 'Presupuesto no encontrado' });
      if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
        return res.status(403).json({ error: 'Sin permiso para este presupuesto' });
      }

      await prisma.activity.create({
        data: {
          action:  'EMAIL_SENT',
          detail:  `Presupuesto abierto en Gmail para ${to}${cc ? ` (CC: ${cc})` : ''} · Asunto: "${subject}"`,
          userId:  req.user.id,
          quoteId: req.params.id,
        },
      });
      let stageAdvanced = false;
      if (STAGES_TO_ADVANCE.includes(quote.stage)) {
        const fudSetting = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
        const fudDays    = Math.max(1, parseInt(fudSetting?.value || '4'));
        const followUpDate = new Date();
        followUpDate.setDate(followUpDate.getDate() + fudDays);
        await prisma.quote.update({ where: { id: req.params.id }, data: { stage: 'enviado', followUpDate } });
        await prisma.activity.create({
          data: {
            action: 'STAGE_CHANGE',
            detail: `Etapa cambiada de "${quote.stage}" a "enviado" (Gmail)`,
            userId: req.user.id,
            quoteId: req.params.id,
          },
        });
        stageAdvanced = true;
      }
      return res.json({ messageId: null, stageAdvanced, gmailOnly: true });
    }

    // Buscar adjunto si se especificó
    const fs = require('fs');
    let attachmentPath = null;
    let attachmentName = null;
    if (attachmentId) {
      const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      if (att) {
        if (!fs.existsSync(att.path)) {
          return res.status(400).json({
            error: `El archivo "${att.filename}" ya no existe en el servidor (Railway reinició el contenedor). Por favor, volvé a subir el PDF desde el tab Adjuntos y reintentá.`,
          });
        }
        attachmentPath = att.path;
        attachmentName = att.filename;
        console.log(`📎 Adjunto: ${attachmentName} en ${attachmentPath}`);
      }
    }

    // Enviar via Gmail API (funciona en Railway — usa HTTPS, no SMTP)
    const { sendMail } = require('../services/mailer');
    const { brandedEmail, quoteBodyToHtml } = require('../services/emailTemplate');
    const htmlBody = brandedEmail({ title: 'MySelec', content: quoteBodyToHtml(body) });

    const attachments = [];
    if (attachmentPath) {
      attachments.push({ path: attachmentPath, filename: attachmentName, mimeType: 'application/pdf' });
    }

    console.log(`📧 send-email (Gmail API) → to:${to} adjunto:${attachments.length > 0 ? attachmentName : 'no'}`);
    const start = Date.now();

    await sendMail({
      to,
      cc: cc || undefined,
      subject,
      text: body,
      html: htmlBody,
      replyTo: req.user.email || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    console.log(`✅ send-email OK en ${Date.now() - start}ms`);

    // Log actividad + avanzar etapa
    await prisma.activity.create({
      data: {
        action: 'EMAIL_SENT',
        detail: `Presupuesto enviado vía Gmail CRM a ${to}${cc ? ` (CC: ${cc})` : ''}${attachments.length ? ' con adjunto PDF' : ''} · Asunto: "${subject}"`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    const STAGES_TO_ADVANCE = ['asignada', 'armado', 'revision', 'presupuestado', 'recibida', 'oferta', 'proveedor'];
    const quoteForStage = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { stage: true } });
    let stageAdvanced = false;
    if (quoteForStage && STAGES_TO_ADVANCE.includes(quoteForStage.stage)) {
      const fudSetting = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
      const fudDays = Math.max(1, parseInt(fudSetting?.value || '4'));
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + fudDays);
      await prisma.quote.update({ where: { id: req.params.id }, data: { stage: 'enviado', followUpDate } });
      await prisma.activity.create({
        data: {
          action: 'STAGE_CHANGE',
          detail: `Etapa cambiada de "${quoteForStage.stage}" a "enviado" (envío por Gmail CRM)`,
          userId: req.user.id,
          quoteId: req.params.id,
        },
      });
      stageAdvanced = true;
    }

    res.json({ messageId: null, stageAdvanced, sentFrom: process.env.MAIL_USER || 'iamyselec@gmail.com' });
  } catch (err) {
    console.error('❌ send-email ERROR:', err.message);
    res.status(500).json({ error: err.message || 'Error al enviar el email' });
  }
});

// POST /api/quotes/:id/send-reminder — enviar recordatorio al cliente por presupuesto sin respuesta
router.post('/:id/send-reminder', authMiddleware, async (req, res) => {
  try {
    const { subject, body } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject y body son requeridos' });

    const quote = await prisma.quote.findUnique({
      where: { id: req.params.id },
      include: { client: { select: { name: true, email: true } }, seller: { select: { name: true } } },
    });
    if (!quote) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (req.user.role === 'VENDEDOR' && quote.sellerId !== req.user.id) {
      return res.status(403).json({ error: 'Sin permiso para esta cotización' });
    }
    if (!quote.client?.email) return res.status(400).json({ error: 'El cliente no tiene email registrado' });

    // Enviar via Gmail API (funciona en Railway — usa HTTPS, no SMTP)
    const { sendMail: sendMailGmailApi } = require('../services/mailer');
    const { brandedEmail: brandEmail, quoteBodyToHtml: bodyToHtml } = require('../services/emailTemplate');
    const htmlContent = brandEmail({ title: 'MySelec', content: bodyToHtml(body) });

    await sendMailGmailApi({
      to: quote.client.email,
      subject,
      html: htmlContent,
      text: body,
      replyTo: req.user.email || undefined,
    });
    const sentFrom = process.env.MAIL_USER || 'iamyselec@gmail.com';

    // Registrar actividad
    await prisma.activity.create({
      data: {
        action: 'REMINDER_SENT',
        detail: `Recordatorio enviado a ${quote.client.email} desde ${sentFrom} — "${subject}"`,
        userId: req.user.id,
        quoteId: req.params.id,
      },
    });

    // Pushear followUpDate
    const pushSetting = await prisma.appSetting.findUnique({ where: { key: 'reminder_followup_push_days' } });
    const pushDays = parseInt(pushSetting?.value || '4', 10);
    const newFollowUp = new Date();
    newFollowUp.setDate(newFollowUp.getDate() + pushDays);
    await prisma.quote.update({
      where: { id: req.params.id },
      data: { followUpDate: newFollowUp },
    });

    res.json({ ok: true, sentTo: quote.client.email, sentFrom, nextFollowUp: newFollowUp.toISOString() });
  } catch (err) {
    console.error('Error sending reminder:', err);
    res.status(500).json({ error: err.message || 'Error al enviar recordatorio' });
  }
});

module.exports = router;
