const express = require('express');
const {authMiddleware, requireRole, isAdmin, isDeveloper } = require('../middleware/auth');
const prisma = require('../db');

const router = express.Router();

const DEFAULTS = {
  // ── Mantenimiento ────────────────────────────────────────────────────────
  // Bloquea el acceso a toda la API salvo rol DEVELOPER (ver middleware/auth.js).
  // Solo DEVELOPER puede prender/apagarlo — ver guardia en el PATCH de abajo.
  maintenance_mode:            'false',

  // ── Mail sync ─────────────────────────────────────────────────────────────
  mail_sync_interval_hours:    '2',
  mail_lookback_days:          '2',
  mail_sync_enabled:           'true',
  // Ventana horaria del sync automático de respaldo (el disparador principal es
  // cuando alguien abre el CRM — ver routes/mail.js). Fuera de la ventana no corre,
  // salvo que alguien entre igual.
  mail_sync_window_enabled:     'true',
  mail_sync_window_days:        '1,2,3,4,5', // 0=domingo … 6=sábado
  mail_sync_window_start_hour:  '8',
  mail_sync_window_end_hour:    '20',

  // ── Etapas de entrada ────────────────────────────────────────────────────
  default_stage_solicitud:              'recibida',
  default_stage_solicitud_con_vendedor: 'asignada',
  default_stage_presupuesto:            'enviado',
  default_stage_nota_pedido:            'np_enviada',

  // ── Acceso ───────────────────────────────────────────────────────────────
  allowed_email_domains:       'myselec.com,myselec.com.ar,gmail.com',
  // Correos individuales autorizados aunque su dominio no esté en la lista anterior.
  // Útil para admins/devs con Gmail u otros dominios externos.
  allowed_emails:              '',

  // ── Tiempos de seguimiento ───────────────────────────────────────────────
  // Días tras enviar un presupuesto para marcar seguimiento pendiente (banner naranja)
  follow_up_days:              '4',

  // Días para la fecha límite de armado, se pone automáticamente al asignar
  // vendedor a una cotización (sea al ingresar ya asignada, o al asignarla
  // manualmente después). Editable a mano una vez asignada.
  deadline_days:                '3',

  // ── Alertas en panel (inbox CRM) ─────────────────────────────────────────
  // Días sin actividad para mostrar una cotización como alerta en el panel del CRM.
  // Se controla client-side; el usuario lo ve cada vez que abre el inbox.
  idle_inbox_days:             '5',

  // ── Recordatorio por mail al vendedor ────────────────────────────────────
  // Días sin actividad para enviar un mail recordatorio al vendedor (una vez por día).
  // Recomendado: valor mayor que idle_inbox_days para evitar spam.
  idle_email_days:             '7',

  // ── Resumen semanal ───────────────────────────────────────────────────────
  weekly_report_enabled:       'true',
  weekly_report_day:           '1',
  weekly_report_hour:          '9',

  // ── Notificaciones por mail (sistema) ────────────────────────────────────
  notify_new_register:            'true',
  notify_stage_alert:             'true',
  // Cooldown entre alertas de etapa para la misma cotización (días)
  stage_alert_cooldown_days:      '3',
  notify_unassigned_mail:         'true',
  // Frecuencia del digest sin cliente: immediate | daily | 2days | weekly
  unassigned_mail_frequency:      'daily',
  // ── Alertas in-app (campanita) ───────────────────────────────────────────
  inapp_unassigned_quotes:    'true',
  inapp_pending_users:        'true',
  inapp_overdue_stages:       'true',
  inapp_idle_quotes:          'true',
  inapp_follow_up:            'true',
  inapp_unlinked_solicitudes: 'true',
  // Días sin presupuesto vinculado para alertar sobre una solicitud
  solicitud_sin_pres_days:    '3',
  inapp_follow_up_upcoming:   'true',
  // Días de anticipación para aviso de follow-up próximo (0 = solo hoy)
  follow_up_upcoming_days:    '1',
  // ── Recordatorio de presupuesto sin respuesta ───────────────────────────
  inapp_no_response:          'true',
  // Días sin respuesta para mostrar alerta de recordatorio
  no_response_days:           '4',
  // Días extra de followUp al enviar un recordatorio
  reminder_followup_push_days: '4',
  // Fecha límite de armado vencida (Solicitud sin presupuesto vinculado, ya vencida)
  inapp_deadline_overdue:      'true',
  // Plantilla de recordatorio
  reminder_subject:           'Seguimiento presupuesto {flexxusCode} — MySelec',
  reminder_body:              'Hola {clientName},\n\nTe escribimos para hacer seguimiento del presupuesto {flexxusCode} que te enviamos hace {daysSent} días.\n\n¿Pudiste revisarlo? Quedamos a disposición para cualquier consulta.\n\nSaludos cordiales,\nEquipo MySelec',
};

const adminOrDevMiddleware = (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Sin permisos' });
  next();
};

// GET /api/settings — devuelve todos los settings con defaults
router.get('/', authMiddleware, adminOrDevMiddleware, async (req, res) => {
  try {
    const rows = await prisma.appSetting.findMany();
    const map  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ ...DEFAULTS, ...map });
  } catch (err) {
    res.status(500).json({ error: 'Error al leer configuración' });
  }
});

// PATCH /api/settings — guarda uno o varios settings
router.patch('/', authMiddleware, adminOrDevMiddleware, async (req, res) => {
  try {
    const updates = req.body; // { key: value, ... }

    // maintenance_mode bloquea a todos salvo DEVELOPER — un ADMIN que lo prenda
    // quedaría afuera en su siguiente pedido y no podría revertirlo. Restringido
    // a DEVELOPER para que quien lo activa siempre pueda desactivarlo.
    if ('maintenance_mode' in updates && !isDeveloper(req.user)) {
      return res.status(403).json({ error: 'Solo un Desarrollador puede cambiar el modo mantenimiento.' });
    }

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

// ── Developer: usuarios que reciben mails del foro ───────────────────────────

// GET /api/settings/feedback-notify-users
router.get('/feedback-notify-users', authMiddleware, async (req, res) => {
  if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores.' });
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'feedback_notify_users' } });
    const ids = setting?.value ? JSON.parse(setting.value) : [];
    const allUsers = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, avatar: true },
      orderBy: { name: 'asc' },
    });
    res.json({ notifyIds: ids, users: allUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/feedback-notify-users
router.put('/feedback-notify-users', authMiddleware, async (req, res) => {
  if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores.' });
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids debe ser un array.' });
    await prisma.appSetting.upsert({
      where:  { key: 'feedback_notify_users' },
      update: { value: JSON.stringify(ids) },
      create: { key: 'feedback_notify_users', value: JSON.stringify(ids) },
    });
    res.json({ ok: true, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
