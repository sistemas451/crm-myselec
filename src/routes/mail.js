const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { syncMails, syncAccount, listRecentMails } = require('../services/mailReader');
const prisma = require('../db');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

// Devuelve todas las cuentas: env vars (origen='env') + AppSetting (origen='db')
async function getMailAccounts() {
  const accounts = [];

  // 1. Cuentas del env (MAIL_ACCOUNTS o MAIL_USER+MAIL_PASSWORD)
  if (process.env.MAIL_ACCOUNTS) {
    try {
      const parsed = JSON.parse(process.env.MAIL_ACCOUNTS);
      if (Array.isArray(parsed)) parsed.forEach(a => accounts.push({ ...a, _origin: 'env' }));
    } catch (_) {}
  }
  if (accounts.length === 0 && process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
    accounts.push({ user: process.env.MAIL_USER, password: process.env.MAIL_PASSWORD, _origin: 'env' });
  }

  // 2. Cuentas agregadas desde la UI (AppSetting key='mail_accounts')
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    if (setting?.value) {
      const dbAccounts = JSON.parse(setting.value);
      if (Array.isArray(dbAccounts)) {
        for (const a of dbAccounts) {
          if (!accounts.find(x => x.user.toLowerCase() === a.user.toLowerCase())) {
            accounts.push({ ...a, _origin: 'db' });
          }
        }
      }
    }
  } catch (_) {}

  return accounts;
}

// ── POST /api/mail/sync — sincroniza TODAS las cuentas ───────────────────────
router.post('/sync', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    console.log('📧 Sync manual: todas las cuentas...');
    const result = await syncMails();
    const accounts = await getMailAccounts();
    for (const acc of accounts) {
      await prisma.emailIntegration.upsert({
        where:  { accountEmail: acc.user },
        update: { lastSyncAt: new Date() },
        create: { accountEmail: acc.user, lastSyncAt: new Date(), isActive: true },
      });
    }
    res.json(result);
  } catch (err) {
    console.error('Mail sync error:', err);
    res.status(500).json({ error: 'Error al sincronizar mails', detail: err.message });
  }
});

// ── POST /api/mail/sync/:email — sincroniza UNA cuenta específica ─────────────
router.post('/sync/:email', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
    const accounts = await getMailAccounts();
    const account = accounts.find(a => a.user.toLowerCase() === targetEmail);
    if (!account) return res.status(404).json({ error: `Cuenta no encontrada: ${targetEmail}` });

    console.log(`📧 Sync manual: ${targetEmail}`);
    const result = await syncAccount(account);
    await prisma.emailIntegration.upsert({
      where:  { accountEmail: account.user },
      update: { lastSyncAt: new Date() },
      create: { accountEmail: account.user, lastSyncAt: new Date(), isActive: true },
    });
    res.json(result);
  } catch (err) {
    console.error('Mail sync error:', err);
    res.status(500).json({ error: 'Error al sincronizar', detail: err.message });
  }
});

// ── GET /api/mail/accounts — lista de cuentas configuradas con estado ─────────
router.get('/accounts', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const accounts = await getMailAccounts();
    const integrations = await prisma.emailIntegration.findMany();
    const integMap = Object.fromEntries(integrations.map(i => [i.accountEmail.toLowerCase(), i]));
    const result = accounts.map(acc => {
      const integ = integMap[acc.user.toLowerCase()];
      return {
        user:       acc.user,
        isActive:   integ?.isActive ?? true,
        lastSyncAt: integ?.lastSyncAt || null,
        origin:     acc._origin || 'env', // 'env' | 'db'
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar cuentas' });
  }
});

// ── POST /api/mail/accounts — agregar cuenta via UI ──────────────────────────
router.post('/accounts', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { user, password } = req.body;
    if (!user || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    const current = setting?.value ? JSON.parse(setting.value) : [];
    if (current.find(a => a.user.toLowerCase() === user.toLowerCase())) {
      return res.status(409).json({ error: 'La cuenta ya está configurada' });
    }
    current.push({ user, password });
    await prisma.appSetting.upsert({
      where:  { key: 'mail_accounts' },
      update: { value: JSON.stringify(current) },
      create: { key: 'mail_accounts', value: JSON.stringify(current) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al agregar cuenta' });
  }
});

// ── DELETE /api/mail/accounts/:email — eliminar cuenta agregada via UI ────────
router.delete('/accounts/:email', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const setting = await prisma.appSetting.findUnique({ where: { key: 'mail_accounts' } });
    const current = setting?.value ? JSON.parse(setting.value) : [];
    const filtered = current.filter(a => a.user.toLowerCase() !== email);
    await prisma.appSetting.upsert({
      where:  { key: 'mail_accounts' },
      update: { value: JSON.stringify(filtered) },
      create: { key: 'mail_accounts', value: JSON.stringify(filtered) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar cuenta' });
  }
});

// ── POST /api/mail/test/:email — diagnóstico de conexión IMAP ────────────────
router.post('/test/:email', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email).toLowerCase();
    const accounts    = await getMailAccounts();
    const account     = accounts.find(a => a.user.toLowerCase() === targetEmail);
    if (!account) return res.status(404).json({ ok: false, error: `Cuenta no encontrada: ${targetEmail}` });

    const Imap = require('imap');
    const diag = await new Promise((resolve) => {
      const imap = new Imap({
        user:        account.user,
        password:    account.password,
        host:        process.env.MAIL_HOST || 'imap.gmail.com',
        port:        parseInt(process.env.MAIL_PORT || '993'),
        tls:         true,
        tlsOptions:  { rejectUnauthorized: true },
        authTimeout: 12000,
        connTimeout: 20000,
      });

      imap.once('ready', () => {
        // Listar todas las carpetas/etiquetas disponibles
        imap.getBoxes((err, boxes) => {
          if (err) {
            imap.end();
            return resolve({ ok: false, error: `getBoxes: ${err.message}`, boxes: [] });
          }
          // Aplanar el árbol de carpetas (un nivel, más Gmail subcarpetas)
          const labels = [];
          const walk = (tree, prefix) => {
            for (const [name, info] of Object.entries(tree || {})) {
              const full = prefix ? `${prefix}${info.delimiter || '/'}${name}` : name;
              labels.push(full);
              if (info.children) walk(info.children, full);
            }
          };
          walk(boxes, '');
          imap.end();
          resolve({ ok: true, labels });
        });
      });

      imap.once('error', (err) => {
        resolve({ ok: false, error: err.message, code: err.source || err.code || null });
      });

      imap.connect();
    });

    res.json(diag);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/mail/inbox — bandeja reciente ────────────────────────────────────
router.get('/inbox', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const mails = await listRecentMails(limit);
    res.json(mails);
  } catch (err) {
    console.error('Inbox error:', err);
    res.status(500).json({ error: 'Error al leer bandeja' });
  }
});

module.exports = router;
