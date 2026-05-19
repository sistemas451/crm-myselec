const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// GET /api/notifications/rules
router.get('/rules', authMiddleware, adminOnly, async (req, res) => {
  try {
    const rules = await prisma.notificationRule.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/rules
router.post('/rules', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, trigger, stageFrom, stageTo, idleHours, subject, body, sendTo } = req.body;
    if (!name || !trigger || !subject || !body) {
      return res.status(400).json({ error: 'name, trigger, subject y body son requeridos' });
    }
    const rule = await prisma.notificationRule.create({
      data: { name, trigger, stageFrom: stageFrom || null, stageTo: stageTo || null,
              idleHours: idleHours || null, subject, body, sendTo: sendTo || 'SELLER' },
    });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/rules/:id
router.put('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, trigger, stageFrom, stageTo, idleHours, subject, body, sendTo, active } = req.body;
    const data = {};
    if (name      !== undefined) data.name      = name;
    if (trigger   !== undefined) data.trigger   = trigger;
    if (stageFrom !== undefined) data.stageFrom = stageFrom || null;
    if (stageTo   !== undefined) data.stageTo   = stageTo   || null;
    if (idleHours !== undefined) data.idleHours = idleHours || null;
    if (subject   !== undefined) data.subject   = subject;
    if (body      !== undefined) data.body      = body;
    if (sendTo    !== undefined) data.sendTo    = sendTo;
    if (active    !== undefined) data.active    = active;
    const rule = await prisma.notificationRule.update({ where: { id: req.params.id }, data });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/rules/:id
router.delete('/rules/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await prisma.notificationRule.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
