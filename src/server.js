require('dotenv').config();

// ── Validación de variables de entorno críticas ───────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variable de entorno requerida no definida: ${key}`);
    console.error('   El servidor no puede arrancar de forma segura sin esta variable.');
    process.exit(1);
  }
}

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const multer  = require('multer');
const prisma  = require('./db');
const { authMiddleware } = require('./middleware/auth');
const { runIdleCheck } = require('./services/notifier');
const { syncMails }    = require('./services/mailReader');

const app  = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.APP_URL || true,   // true = refleja el origin (equivalente a * pero funciona con credentials)
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve uploaded attachments
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API Routes
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

// POST /api/quotes/:id/attachments — upload de adjunto manual
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'attachments');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
    cb(null, `${req.params.id}-${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

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
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:id/attachments — upload de adjunto a una OC
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
    res.json(created);
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

  // Sync automático de mails — intervalo configurable desde AppSetting
  async function scheduleMailSync() {
    try {
      const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_sync_interval_hours' } });
      const hours   = parseFloat(setting?.value || '2');
      const ms      = Math.max(0.25, hours) * 60 * 60 * 1000; // mínimo 15 min
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
