/**
 * routes/feedback.js — Foro de feedback / soporte interno
 *
 * GET  /                — listar posts (admin: todos | otros: propios)
 * POST /                — crear post + notificar admins por mail
 * POST /:id/respond     — responder (ADMIN only) + notificar al autor
 * PATCH /:id/status     — cambiar estado (ADMIN only)
 * GET  /meta            — devuelve meeting_link y templates prearmados
 */

const router  = require('express').Router();
const prisma  = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { sendMail }       = require('../services/mailer');

router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getMeetingLink() {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: 'meeting_link' } });
    return s?.value || '';
  } catch (_) { return ''; }
}

async function getAdminEmails() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', active: true },
    select: { email: true },
  });
  return admins.map(a => a.email).filter(Boolean);
}

const TYPE_LABEL = { BUG: '🐛 Error', QUESTION: '❓ Pregunta', MEETING: '📅 Reunión' };
const STATUS_LABEL = { OPEN: 'Abierto', IN_PROGRESS: 'En progreso', RESOLVED: 'Resuelto' };

// ── GET /meta ─────────────────────────────────────────────────────────────────
// Debe ir ANTES de /:id para no ser capturado como parámetro
router.get('/meta', async (req, res) => {
  try {
    const meetingLink = await getMeetingLink();
    res.json({
      meetingLink,
      templates: {
        BUG:      'Gracias por reportarlo. Lo estamos revisando y te avisamos cuando esté corregido. ¡Seguí probando!',
        QUESTION: '',
        MEETING:  meetingLink
          ? `Con gusto coordinamos una reunión de 10 minutos para resolver tu consulta.\nReservá un espacio acá: ${meetingLink}`
          : 'Con gusto coordinamos una reunión de 10 minutos para resolver tu consulta. Te enviamos el link para agendar.',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN';
    const where   = isAdmin ? {} : { userId: req.user.id };
    const posts   = await prisma.feedbackPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user:      { select: { id: true, name: true, email: true, avatar: true, role: true } },
        responses: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { type, title, body } = req.body;
    if (!type || !title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Tipo, título y descripción son obligatorios.' });
    }
    if (!['BUG', 'QUESTION', 'MEETING'].includes(type)) {
      return res.status(400).json({ error: 'Tipo inválido.' });
    }

    const post = await prisma.feedbackPost.create({
      data: { type, title: title.trim(), body: body.trim(), userId: req.user.id },
      include: {
        user:      { select: { id: true, name: true, email: true, avatar: true, role: true } },
        responses: [],
      },
    });

    // Notificar a todos los admins por mail
    try {
      const adminEmails = await getAdminEmails();
      if (adminEmails.length > 0) {
        const typeLabel = TYPE_LABEL[type] || type;
        await sendMail({
          to: adminEmails,
          subject: `[MySelec CRM] Nuevo reporte: ${typeLabel} — ${title.trim()}`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto">
              <h2 style="color:#1B2A4A;margin-bottom:4px">Nuevo reporte en el foro</h2>
              <p style="color:#64748B;margin-top:0">Recibiste un nuevo mensaje de <strong>${req.user.name}</strong> (${req.user.email})</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:600;width:100px">Tipo</td>
                    <td style="padding:8px 12px;border:1px solid #E2E8F0">${typeLabel}</td></tr>
                <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:600">Título</td>
                    <td style="padding:8px 12px;border:1px solid #E2E8F0">${title.trim()}</td></tr>
                <tr><td style="padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:600;vertical-align:top">Descripción</td>
                    <td style="padding:8px 12px;border:1px solid #E2E8F0;white-space:pre-wrap">${body.trim()}</td></tr>
              </table>
              <p style="color:#64748B;font-size:13px">Ingresá al CRM para responder desde la sección <strong>Foro</strong>.</p>
            </div>
          `,
          text: `Nuevo reporte de ${req.user.name} (${req.user.email})\nTipo: ${typeLabel}\nTítulo: ${title.trim()}\n\n${body.trim()}`,
        });
      }
    } catch (mailErr) {
      console.warn('⚠️  feedback notify admins failed:', mailErr.message);
    }

    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/respond ─────────────────────────────────────────────────────────
router.post('/:id/respond', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden responder.' });

    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'La respuesta no puede estar vacía.' });

    const post = await prisma.feedbackPost.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!post) return res.status(404).json({ error: 'Reporte no encontrado.' });

    // Crear respuesta y marcar como IN_PROGRESS si estaba OPEN
    const [response] = await prisma.$transaction([
      prisma.feedbackResponse.create({
        data: { body: body.trim(), userId: req.user.id, postId: post.id },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      }),
      ...(post.status === 'OPEN' ? [prisma.feedbackPost.update({
        where: { id: post.id },
        data:  { status: 'IN_PROGRESS' },
      })] : []),
    ]);

    // Notificar al autor del post
    try {
      if (post.user.email && post.user.email !== req.user.email) {
        const typeLabel = TYPE_LABEL[post.type] || post.type;
        await sendMail({
          to: post.user.email,
          replyTo: req.user.email,
          subject: `[MySelec CRM] Respuesta a tu reporte: ${post.title}`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto">
              <h2 style="color:#1B2A4A;margin-bottom:4px">Respuesta a tu reporte</h2>
              <p style="color:#64748B;margin-top:0"><strong>${req.user.name}</strong> respondió tu reporte <em>${typeLabel}: ${post.title}</em></p>
              <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:16px;margin:16px 0;white-space:pre-wrap">${body.trim()}</div>
              <p style="color:#64748B;font-size:13px">Podés ver el hilo completo en la sección <strong>Foro</strong> del CRM.</p>
            </div>
          `,
          text: `${req.user.name} respondió tu reporte:\n\n${body.trim()}`,
        });
      }
    } catch (mailErr) {
      console.warn('⚠️  feedback notify author failed:', mailErr.message);
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:id/status ────────────────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo admins pueden cambiar el estado.' });
    const { status } = req.body;
    if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }
    const post = await prisma.feedbackPost.update({
      where: { id: req.params.id },
      data:  { status },
    });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
