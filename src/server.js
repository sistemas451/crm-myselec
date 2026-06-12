require('dotenv').config();

// ── Railway: auto-completar APP_URL desde RAILWAY_PUBLIC_DOMAIN ──────────────
if (!process.env.APP_URL && process.env.RAILWAY_PUBLIC_DOMAIN) {
  process.env.APP_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
}

// ── Validación de variables de entorno críticas ───────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variable de entorno requerida no definida: ${key}`);
    console.error('   El servidor no puede arrancar de forma segura sin esta variable.');
    process.exit(1);
  }
}

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const multer    = require('multer');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma    = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { runIdleCheck, runStageAlerts, runWeeklyReport } = require('./services/notifier');
const { syncMails }    = require('./services/mailReader');
const { parseFlexxusPDF, isFlexxusPDF } = require('./services/flexxusParser');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Trust proxy — necesario en Railway (reverse proxy) ───────────────────────
// Sin esto express-rate-limit lanza ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
app.set('trust proxy', 1);

// ── Seguridad HTTP (headers) ──────────────────────────────────────────────────
// Babel Standalone + Tailwind CDN requieren 'unsafe-eval' y scripts externos.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': [
        "'self'",
        'https://unpkg.com',
        'https://cdn.tailwindcss.com',
        'https://fonts.googleapis.com',
        "'unsafe-eval'",    // necesario para Babel Standalone (eval de JSX compilado)
        "'unsafe-inline'",  // necesario para Babel Standalone (inyección de scripts compilados)
      ],
      'style-src':  ["'self'", 'https://fonts.googleapis.com', 'https://cdn.tailwindcss.com', "'unsafe-inline'"],
      'font-src':   ["'self'", 'https://fonts.gstatic.com'],
      'img-src':    ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'", 'https://unpkg.com'],  // source maps de unpkg
    },
  },
}));

// ── Rate limiting en endpoints de autenticación ───────────────────────────────
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,  // 15 minutos
  max:             15,               // máx 15 intentos por IP por ventana
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Demasiados intentos. Esperá 15 minutos antes de reintentar.' },
});

// Middleware
app.use(cors({
  origin: process.env.APP_URL || true,   // En producción APP_URL debe estar seteado explícitamente
  credentials: true,
}));
if (!process.env.APP_URL) console.warn('⚠️  APP_URL no seteado — CORS acepta cualquier origin. Setear en producción.');
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve uploaded attachments — requiere autenticación (header o query param)
app.use('/uploads', (req, res, next) => {
  // Permitir token en query string para <img src> y <a href> que no envían header
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authMiddleware(req, res, next);
}, express.static(path.join(__dirname, '..', 'uploads')));

// API Routes
app.use('/api/auth/login',          authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/quotes',        require('./routes/quotes'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/clients',       require('./routes/clients'));
app.use('/api/mail',          require('./routes/mail'));
app.use('/api/data',          require('./routes/data'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/articles',      require('./routes/articles'));
app.use('/api/logs',          require('./routes/logs'));
app.use('/api/feedback',      require('./routes/feedback'));
app.use('/api/exports',       require('./routes/exports'));

// POST /api/feedback/upload-image — captura de pantalla adjunta al reporte
const FEEDBACK_IMG_DIR = path.join(__dirname, '..', 'uploads', 'feedback');
require('fs').mkdirSync(FEEDBACK_IMG_DIR, { recursive: true });
const feedbackImgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FEEDBACK_IMG_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const feedbackUpload = multer({
  storage: feedbackImgStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes PNG, JPG, GIF o WEBP.'));
  },
});
app.post('/api/feedback/upload-image', authMiddleware, feedbackUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen.' });
  res.json({ url: `/uploads/feedback/${req.file.filename}` });
});

// POST /api/quotes/:id/attachments — upload de adjunto manual
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'attachments');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
    cb(null, `${req.params.id}-${Date.now()}-${safe}`);
  },
});
const ALLOWED_ATTACH_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/csv',
]);
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_ATTACH_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido. Se aceptan PDF, imágenes, Excel, Word y CSV.'));
  },
});

app.post('/api/quotes/:id/attachments', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const created = await Promise.all((req.files || []).map(f =>
      prisma.attachment.create({
        data: {
          filename: f.filename,
          path:     f.path,
          size:     f.size,
          mimeType: f.mimetype,
          quoteId:  req.params.id,
        },
      })
    ));

    // ── Auto-parseo de PDF Flexxus ───────────────────────────────────────────
    // Si alguno de los archivos subidos es un presupuesto Flexxus, lo parseamos
    // automáticamente y completamos los datos de la cotización.
    let flexxusParsed = null;
    const flexxusFile = (req.files || []).find(f =>
      isFlexxusPDF({ filename: f.originalname })
    );

    if (flexxusFile) {
      try {
        const fs = require('fs');
        const buffer = fs.readFileSync(flexxusFile.path);
        const data = await parseFlexxusPDF(buffer);

        if (data.npCode || data.items?.length) {
          const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
          const updateData = {};

          // Código Flexxus, monto y desglose de precios
          if (data.npCode)              updateData.flexxusCode        = data.npCode;
          if (data.total)               updateData.amount             = data.total;
          if (data.subtotalNeto != null) updateData.subtotalNeto      = data.subtotalNeto;
          if (data.ivaAmount != null)    updateData.ivaAmount         = data.ivaAmount;
          if (data.totalPercepciones != null) updateData.totalPercepciones = data.totalPercepciones;

          // Asignar cliente por CUIT si la cotización no tiene cliente aún
          if (data.cuit && !quote?.clientId) {
            const client = await prisma.client.findFirst({
              where: { cuit: { equals: data.cuit, mode: 'insensitive' } },
              include: { defaultSeller: true },
            });
            if (client) {
              updateData.clientId = client.id;
              if (!quote?.sellerId && client.defaultSellerId) {
                updateData.sellerId = client.defaultSellerId;
              }
            }
          }

          if (Object.keys(updateData).length) {
            await prisma.quote.update({ where: { id: req.params.id }, data: updateData });
          }

          // Ítems: reemplazar si el PDF tiene ítems
          if (data.items?.length) {
            await prisma.quoteItem.deleteMany({ where: { quoteId: req.params.id } });
            await prisma.quoteItem.createMany({
              data: data.items.map((item, i) => ({
                quoteId:     req.params.id,
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
          }

          flexxusParsed = {
            npCode:     data.npCode,
            cuit:       data.cuit,
            clientName: data.clientName,
            total:      data.total,
            itemCount:  data.items?.length || 0,
          };
        }
      } catch (parseErr) {
        console.error('Auto-parseo Flexxus falló:', parseErr.message);
        // No rompemos la respuesta — el archivo ya fue guardado igual
      }
    }

    res.json({ attachments: created, flexxusParsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:id/attachments — upload de adjunto a una NP/OC
app.post('/api/orders/:id/attachments', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const created = await Promise.all((req.files || []).map(f =>
      prisma.attachment.create({
        data: {
          filename: f.filename,
          path:     f.path,
          size:     f.size,
          mimeType: f.mimetype,
          orderId:  req.params.id,
        },
      })
    ));

    // ── Auto-parseo de Nota de Pedido Flexxus ───────────────────────────────
    const { parseNotaPedidoPDF, isNotaPedidoPDF } = require('./services/flexxusParser');
    let npParsed = null;
    const npFile = (req.files || []).find(f => isNotaPedidoPDF({ filename: f.originalname }));
    if (npFile) {
      try {
        const fs = require('fs');
        const buffer = fs.readFileSync(npFile.path);
        const data = await parseNotaPedidoPDF(buffer);

        if (data.npCode || data.items?.length) {
          const updateData = {};
          if (data.npCode)   updateData.flexxusCode  = data.npCode;
          if (data.ocNumber) updateData.clientOCCode = data.ocNumber;

          // Asignar cliente por CUIT si la orden no tiene cliente
          const order = await prisma.order.findUnique({ where: { id: req.params.id } });
          if (data.cuit && !order?.clientId) {
            const client = await prisma.client.findFirst({
              where: { cuit: { equals: data.cuit, mode: 'insensitive' } },
              select: { id: true, defaultSellerId: true },
            });
            if (client) {
              updateData.clientId = client.id;
              if (!order?.sellerId && client.defaultSellerId) updateData.sellerId = client.defaultSellerId;
            }
          }

          // Vincular al presupuesto si no tiene fromQuote
          let linkedPresId = order?.fromQuoteId || null;
          if (!order?.fromQuoteId && data.presupuestoNP) {
            const pres = await prisma.quote.findFirst({
              where: { flexxusCode: data.presupuestoNP },
            }) || await prisma.quote.findFirst({
              where: { flexxusCode: { contains: data.presupuestoNP.replace('PR-', '') } },
            });
            if (pres) { updateData.fromQuoteId = pres.id; linkedPresId = pres.id; }
          }

          if (Object.keys(updateData).length) {
            await prisma.order.update({ where: { id: req.params.id }, data: updateData });
          }

          // Crear/actualizar Quote NOTA_PEDIDO con los ítems del PDF
          // → necesario para que la vista comparativa (tab NP) tenga los datos
          // Se crea siempre que haya ítems (igual que la ruta por mail)
          if (data.items?.length > 0) {
            try {
              // ¿Ya existe una NP Quote vinculada al presupuesto?
              let npQuote = linkedPresId
                ? await prisma.quote.findFirst({
                    where: { mailType: 'NOTA_PEDIDO', linkedQuoteId: linkedPresId },
                    include: { _count: { select: { items: true } } },
                  })
                : null;

              if (!npQuote) {
                // Obtener datos del presupuesto para heredar cliente/vendedor
                const pres = linkedPresId
                  ? await prisma.quote.findUnique({
                      where:  { id: linkedPresId },
                      select: { clientId: true, sellerId: true },
                    })
                  : null;

                // Código único para la NP Quote
                const lastQ = await prisma.quote.findFirst({
                  where:   { code: { startsWith: 'COT-2026' } },
                  orderBy: { code: 'desc' },
                  select:  { code: true },
                });
                const lastNum  = lastQ ? (parseInt(lastQ.code.split('-').pop()) || 0) : 0;
                const npQCode  = `COT-2026-${String(lastNum + 1).padStart(3, '0')}`;

                npQuote = await prisma.quote.create({
                  data: {
                    code:          npQCode,
                    source:        'MANUAL',
                    mailType:      'NOTA_PEDIDO',
                    stage:         'np_enviada',
                    flexxusCode:   data.npCode   || null,
                    amount:        data.total    || null,
                    currency:      'USD',
                    subtotalNeto:  data.subtotalNeto       || null,
                    ivaAmount:     data.ivaAmount          || null,
                    totalPercepciones: data.totalPercepciones || null,
                    clientId:      order?.clientId  || pres?.clientId  || null,
                    sellerId:      order?.sellerId  || pres?.sellerId  || null,
                    linkedQuoteId: linkedPresId || null,
                    emailSubject:  `NP ${data.npCode || ''} — ${data.clientName || ''}`.trim(),
                  },
                });
                console.log(`   ✅ NOTA_PEDIDO Quote creada: ${npQCode}${linkedPresId ? ` ← presupuesto ${linkedPresId}` : ' (sin presupuesto vinculado)'}`);

                // Vínculo bidireccional: el presupuesto apunta a la NP (igual que ruta por mail)
                if (linkedPresId) {
                  const presCheck = await prisma.quote.findUnique({ where: { id: linkedPresId }, select: { linkedQuoteId: true } });
                  if (presCheck && !presCheck.linkedQuoteId) {
                    await prisma.quote.update({ where: { id: linkedPresId }, data: { linkedQuoteId: npQuote.id } });
                  }
                }

                // Actividad en la NP Quote (igual que ruta por mail)
                await prisma.activity.create({
                  data: {
                    action:  'CREATED',
                    detail:  `Nota de Pedido ${data.npCode || ''} cargada manualmente${linkedPresId ? ` → Pres. vinculado` : ''}`,
                    quoteId: npQuote.id,
                  },
                });
              }

              // Crear ítems si no existen aún
              if (npQuote._count?.items === 0 || !npQuote._count) {
                await prisma.quoteItem.createMany({
                  data: data.items.map((item, i) => ({
                    quoteId:     npQuote.id,
                    sku:         item.sku         || null,
                    description: (item.description || '').substring(0, 500),
                    quantity:    item.quantity     || 0,
                    unit:        item.unit         || null,
                    unitPrice:   item.unitPrice    || null,
                    total:       item.total        || null,
                    accepted:    true,
                    sortOrder:   i,
                  })),
                  skipDuplicates: true,
                });
                console.log(`   📋 ${data.items.length} ítems NP guardados en ${npQuote.id}`);
              }
            } catch (npErr) {
              console.error('Error creando NOTA_PEDIDO Quote:', npErr.message);
            }
          }

          npParsed = {
            npCode:        data.npCode,
            ocNumber:      data.ocNumber,
            clientName:    data.clientName,
            subtotalNeto:  data.subtotalNeto,
            ivaAmount:     data.ivaAmount,
            totalPercepciones: data.totalPercepciones,
            total:         data.total,
            itemCount:     data.items?.length || 0,
            items:         data.items || [],
          };
        }
      } catch (parseErr) {
        console.error('Auto-parseo NP falló:', parseErr.message);
      }
    }

    res.json({ attachments: created, npParsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attachments/:id — eliminar adjunto (DB + disco)
app.delete('/api/attachments/:id', authMiddleware, async (req, res) => {
  try {
    const att = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!att) return res.status(404).json({ error: 'Adjunto no encontrado' });
    await prisma.attachment.delete({ where: { id: req.params.id } });
    // Borrar del disco (sin error si ya no existe)
    try { require('fs').unlinkSync(att.path); } catch (_) {}
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar adjunto' });
  }
});

// Health check — verifica también la conexión a la DB
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'unreachable', timestamp: new Date().toISOString() });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Graceful shutdown — cierra conexiones de DB correctamente ────────────────
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido — cerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recibido — cerrando servidor...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 MySelec CRM running at http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/health`);
  console.log(`   Frontend: http://localhost:${PORT}\n`);

  // Checker de notificaciones idle — corre cada hora
  setInterval(() => {
    runIdleCheck().catch(e => console.error('idle check error:', e.message));
  }, 60 * 60 * 1000);

  // Alertas por tiempo de etapa — corre una vez al día
  setInterval(() => {
    runStageAlerts().catch(e => console.error('stage alerts error:', e.message));
  }, 24 * 60 * 60 * 1000);
  // Primera ejecución 1 minuto después del arranque (deja tiempo para conectar DB)
  setTimeout(() => {
    runStageAlerts().catch(e => console.error('stage alerts initial error:', e.message));
  }, 60 * 1000);

  // Resumen semanal — corre cada hora y actúa solo el día/hora configurados
  setInterval(() => {
    runWeeklyReport().catch(e => console.error('weekly report error:', e.message));
  }, 60 * 60 * 1000);

  // Sync automático de mails — intervalo configurable desde AppSetting
  async function scheduleMailSync() {
    try {
      const [settingInterval, settingEnabled] = await Promise.all([
        prisma.appSetting.findUnique({ where: { key: 'mail_sync_interval_hours' } }),
        prisma.appSetting.findUnique({ where: { key: 'mail_sync_enabled' } }),
      ]);
      const hours   = parseFloat(settingInterval?.value || '2');
      const enabled = settingEnabled?.value !== 'false'; // default true
      const ms      = Math.max(0.25, hours) * 60 * 60 * 1000; // mínimo 15 min
      if (!enabled) {
        console.log(`📧 Mail sync automático DESACTIVADO — reintentando en ${hours}h`);
        setTimeout(scheduleMailSync, ms);
        return;
      }
      console.log(`📧 Mail sync automático cada ${hours}h`);
      setTimeout(async () => {
        console.log('📧 Auto-sync de mails...');
        try { await syncMails(); } catch (e) { console.error('Auto-sync error:', e.message); }
        scheduleMailSync(); // releer el intervalo en cada ciclo
      }, ms);
    } catch (e) {
      console.error('scheduleMailSync error:', e.message);
      setTimeout(scheduleMailSync, 2 * 60 * 60 * 1000); // retry en 2h
    }
  }
  scheduleMailSync();
});
