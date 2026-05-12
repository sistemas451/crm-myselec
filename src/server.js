require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const multer  = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('./middleware/auth');
const { runIdleCheck } = require('./services/notifier');
const { syncMails }    = require('./services/mailReader');

const app    = express();
const prisma = new PrismaClient();
const PORT   = process.env.PORT || 3000;

// Middleware
app.use(cors());
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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
