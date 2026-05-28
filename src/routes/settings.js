const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

const DEFAULTS = {
  // ── Mail sync ─────────────────────────────────────────────────────────────
  mail_sync_interval_hours:    '2',
  mail_lookback_days:          '2',
  mail_sync_enabled:           'true',

  // ── Etapas de entrada ────────────────────────────────────────────────────
  default_stage_solicitud:     'recibida',
  default_stage_presupuesto:   'enviado',
  default_stage_nota_pedido:   'np_enviada',

  // ── Acceso ───────────────────────────────────────────────────────────────
  allowed_email_domains:       'myselec.com,myselec.com.ar,gmail.com',

  // ── Tiempos de seguimiento ───────────────────────────────────────────────
  // Días tras enviar un presupuesto para marcar seguimiento pendiente (banner naranja)
  follow_up_days:              '4',

  // ── Alertas en panel (inbox CRM) ─────────────────────────────────────────
  // Días sin actividad para mostrar una cotización como alerta en el panel del CRM.
  // Se controla client-side; el usuario lo ve cada vez que abre el inbox.
  idle_inbox_days:             '5',

  // ── Recordatorio por mail al vendedor ────────────────────────────────────
  // Días sin actividad para enviar un mail recordatorio al vendedor (una vez por día).
  // Recomendado: valor mayor que idle_inbox_days para evitar spam.
  idle_email_days:             '7',

  // ── Resumen semanal ───────────────────────────────────────────────────────
  // Activa el envío automático del resumen semanal por mail a los administradores.
  weekly_report_enabled:       'true',
  // Día de la semana en que se envía (0=Domingo … 6=Sábado). Default 1=Lunes.
  weekly_report_day:           '1',
  // Hora del día (0-23) en horario de Argentina (UTC-3) en que se envía. Default 9=09:00.
  weekly_report_hour:          '9',
};

// GET /api/settings — devuelve todos los settings con defaults
router.get('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ...DEFAULTS, ...map });
  } catch (err) {
    res.status(500).json({ error: 'Error al leer configuración' });
  }
});

// PATCH /api/settings — guarda uno o varios settings
router.patch('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
  try {
    const updates = req.body; // { key: value, ... }
    for (const [key, value] of Object.entries(updates)) {
      await prisma.appSetting.upsert({
        where:  { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    const rows = await prisma.appSetting.findMany();
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ...DEFAULTS, ...map });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

module.exports = router;
