const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { syncMails, syncAccount, listRecentMails } = require('../services/mailReader');

const router = express.Router();
const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getMailAccounts() {
  const accounts = [];
  if (process.env.MAIL_ACCOUNTS) {
    try {
      const parsed = JSON.parse(process.env.MAIL_ACCOUNTS);
      if (Array.isArray(parsed)) accounts.push(...parsed);
    } catch (_) {}
  }
  if (accounts.length === 0 && process.env.MAIL_USER && process.env.MAIL_PASSWORD) {
    accounts.push({ user: process.env.MAIL_USER, password: process.env.MAIL_PASSWORD });
  }
  return accounts;
}

// ── POST /api/mail/sync — sincroniza TODAS las cuentas ───────────────────────
router.post('/sync', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    console.log('📧 Sync manual: todas las cuentas...');
    const result = await syncMails();

    // Actualizar lastSyncAt de cada cuenta en EmailIntegration
    const accounts = getMailAccounts();
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
    const accounts = getMailAccounts();
    const account = accounts.find(a => a.user.toLowerCase() === targetEmail);

    if (!account) {
      return res.status(404).json({ error: `Cuenta no encontrada: ${targetEmail}` });
    }

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
    const accounts = getMailAccounts();

    // Estado de cada cuenta desde EmailIntegration
    const integrations = await prisma.emailIntegration.findMany();
    const integMap = Object.fromEntries(integrations.map(i => [i.accountEmail.toLowerCase(), i]));

    const result = accounts.map(acc => {
      const integ = integMap[acc.user.toLowerCase()];
      return {
        user:      acc.user,
        isActive:  integ?.isActive ?? true,
        lastSyncAt: integ?.lastSyncAt || null,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar cuentas' });
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
