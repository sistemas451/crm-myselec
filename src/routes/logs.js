const express = require('express');
const {authMiddleware, requireRole, isAdmin } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

const MAX_LOGS = 500; // cuando se supera este umbral se muestra el botón de exportar

// GET /api/logs/logins — lista logs de ingreso (admin only)
router.get('/logins', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const { from, to, email, result, page = '1' } = req.query;
    const PAGE_SIZE = 50;
    const skip = (parseInt(page) - 1) * PAGE_SIZE;

    const where = {};
    if (email)  where.email   = { contains: email, mode: 'insensitive' };
    if (result === 'ok')     where.success = true;
    if (result === 'failed') where.success = false;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    const [logs, total] = await Promise.all([
      prisma.loginLog.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE_SIZE,
      }),
      prisma.loginLog.count({ where }),
    ]);

    const totalAll = await prisma.loginLog.count();

    res.json({
      logs,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / PAGE_SIZE),
      totalAll,         // total sin filtros — para el botón de exportar
      showExportAlert: totalAll >= MAX_LOGS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs/logins/export — descarga CSV completo (admin only)
router.get('/logins/export', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const logs = await prisma.loginLog.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const lines = [
      'Fecha,Email,Usuario,Resultado,IP,User Agent',
      ...logs.map(l => [
        new Date(l.createdAt).toLocaleString('es-AR'),
        `"${l.email}"`,
        `"${l.user?.name || ''}"`,
        l.success ? 'Exitoso' : 'Fallido',
        l.ip || '',
        `"${(l.userAgent || '').replace(/"/g, "'")}"`,
      ].join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="logins-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + lines.join('\n')); // BOM para Excel
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
