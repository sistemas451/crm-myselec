const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

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

module.exports = router;
