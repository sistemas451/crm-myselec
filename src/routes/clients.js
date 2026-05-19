const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

// GET /api/clients
router.get('/', authMiddleware, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      where: { active: true },
      include: { defaultSeller: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /api/clients/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        defaultSeller: { select: { id: true, name: true } },
        quotes: { select: { code: true, stage: true, amount: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
        orders: { select: { code: true, stage: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients
router.post('/', authMiddleware, async (req, res) => {
  try {
    const last = await prisma.client.findFirst({ orderBy: { code: 'desc' } });
    const nextNum = last ? parseInt(last.code.split('-')[1]) + 1 : 1;
    const code = `CLI-${String(nextNum).padStart(3, '0')}`;

    const domain = req.body.email ? req.body.email.split('@')[1] || null : null;

    const data = { code, ...req.body, emailDomain: domain };

    if (data.defaultSellerId) {
      const seller = await prisma.user.findUnique({ where: { id: data.defaultSellerId } });
      if (!seller) data.defaultSellerId = null;
    }

    const client = await prisma.client.create({ data });
    res.status(201).json(client);
  } catch (err) {
    console.error('Error creating client:', err);
    res.status(500).json({ error: err.message || 'Error al crear cliente' });
  }
});

// PUT /api/clients/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, cuit, email, phone, address, city, province,
            zone, activity, defaultSellerId, postalCode } = req.body;

    const emailDomain = email ? email.split('@')[1] || null : null;

    let sellerId = defaultSellerId || null;
    if (sellerId) {
      const seller = await prisma.user.findUnique({ where: { id: sellerId } });
      if (!seller) sellerId = null;
    }

    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: {
        name, cuit: cuit||null, email: email||null,
        emailDomain, phone: phone||null, address: address||null,
        city: city||null, province: province||null, zone: zone||null,
        activity: activity||null, defaultSellerId: sellerId,
        postalCode: postalCode||null,
      },
      include: { defaultSeller: { select: { id: true, name: true } } },
    });

    res.json(client);
  } catch (err) {
    console.error('Error updating client:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar cliente' });
  }
});

// GET /api/clients/:id/emails — lista emails de matcheo
router.get('/:id/emails', authMiddleware, async (req, res) => {
  try {
    const emails = await prisma.clientEmail.findMany({
      where: { clientId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /api/clients/:id/emails — agregar email de matcheo
router.post('/:id/emails', authMiddleware, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });
    const record = await prisma.clientEmail.upsert({
      where: { email_clientId: { email: email.toLowerCase().trim(), clientId: req.params.id } },
      update: {},
      create: { email: email.toLowerCase().trim(), clientId: req.params.id },
    });
    res.status(201).json(record);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al agregar email' });
  }
});

// DELETE /api/clients/:id/emails/:emailId — eliminar email de matcheo
router.delete('/:id/emails/:emailId', authMiddleware, async (req, res) => {
  try {
    await prisma.clientEmail.delete({ where: { id: req.params.emailId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar email' });
  }
});

module.exports = router;
