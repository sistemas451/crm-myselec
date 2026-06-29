/**
 * routes/feedback.js — Foro de soporte interno
 *
 * GET  /meta          — meetingLink + plantillas
 * GET  /              — listar posts (todos ven todos)
 * POST /              — crear post (genera código MYS-XXXX)
 * GET  /:id           — detalle de un post
 * POST /:id/respond   — responder (ADMIN only) + notifica al autor
 * PATCH /:id/status   — cambiar estado (ADMIN only)
 * POST /:id/vote      — toggle +1
 */

const router = require('express').Router();
const prisma  = require('../db');
const {authMiddleware, isAdmin, isDeveloper } = require('../middleware/auth');
const { sendMail }       = require('../services/mailer');

router.use(authMiddleware);

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Constantes ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['OPEN','REVIEWING','PENDING_FIX','SCHEDULE_MEETING','RESPONDED','RESOLVED','CLOSED'];

const TEMPLATES = {
  BUG: [
    {
      id: 'bug_confirmed',
      label: 'Error confirmado',
      status: 'PENDING_FIX',
      body: '¡Muchas gracias por reportar este error! Ya lo registramos en nuestro sistema y lo derivamos al equipo técnico para su corrección. Te avisamos cuando esté resuelto.',
    },
    {
      id: 'bug_fixed',
      label: 'Error ya corregido',
      status: 'RESOLVED',
      body: 'Este inconveniente ya fue corregido en la última actualización del sistema. Si seguís experimentando el problema, por favor avisanos con una nueva captura.',
    },
    {
      id: 'reviewing',
      label: 'En revisión',
      status: 'REVIEWING',
      body: 'Recibimos tu reporte y lo estamos analizando junto al equipo técnico. Te responderemos pronto con novedades.',
    },
    {
      id: 'need_more_info',
      label: 'Pedir más datos',
      status: 'REVIEWING',
      body: 'Para poder ayudarte mejor, ¿podrías adjuntarnos una captura de pantalla del error y los pasos exactos para reproducirlo?',
    },
  ],
  OTHER: [
    {
      id: 'answer_question',
      label: 'Responder consulta',
      status: 'RESPONDED',
      body: '¡Gracias por tu consulta! [Escribí acá la respuesta concreta]. Cualquier otra duda, no dudes en preguntarnos.',
    },
    {
      id: 'schedule_meeting',
      label: 'Agendar reunión (10 min)',
      status: 'SCHEDULE_MEETING',
      body: '', // se completa con el meeting link dinámicamente
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getMeetingLink() {
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: 'meeting_link' } });
    return s?.value || '';
  } catch (_) { return ''; }
}

async function getFeedbackNotifyEmails() {
  try {
    // Si hay usuarios configurados manualmente, usarlos
    const setting = await prisma.appSetting.findUnique({ where: { key: 'feedback_notify_users' } });
    if (setting?.value) {
      const ids = JSON.parse(setting.value);
      if (Array.isArray(ids) && ids.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: ids }, active: true },
          select: { email: true },
        });
        return users.map(u => u.email).filter(Boolean);
      }
    }
  } catch (_) {}
  // Fallback: todos los DEVELOPER activos
  const devs = await prisma.user.findMany({
    where: { role: 'DEVELOPER', active: true },
    select: { email: true },
  });
  return devs.map(u => u.email).filter(Boolean);
}

async function nextCode() {
  const count = await prisma.feedbackPost.count();
  return `MYS-${String(count + 1).padStart(4, '0')}`;
}

const TYPE_LABEL = { BUG: 'Error', QUESTION: 'Pregunta' };

const POST_INCLUDE = {
  user: { select: { id: true, name: true, email: true, avatar: true, role: true } },
  responses: {
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  },
};

// ── GET /meta ─────────────────────────────────────────────────────────────────
router.get('/meta', async (req, res) => {
  try {
    const meetingLink = await getMeetingLink();
    // Inyectar link de reunión en plantilla dinámica
    const tpls = JSON.parse(JSON.stringify(TEMPLATES));
    const mtg = tpls.OTHER.find(t => t.id === 'schedule_meeting');
    if (mtg) {
      mtg.body = meetingLink
        ? `Con gusto coordinamos una reunión de 10 minutos para resolver tu consulta.\nReservá un espacio acá: ${meetingLink}`
        : 'Con gusto coordinamos una reunión de 10 minutos para resolver tu consulta. Te enviamos el link para agendar.';
    }
    res.json({ meetingLink, templates: tpls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const posts = await prisma.feedbackPost.findMany({
      orderBy: { createdAt: 'desc' },
      include: POST_INCLUDE,
    });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const post = await prisma.feedbackPost.findUnique({
      where: { id: req.params.id },
      include: POST_INCLUDE,
    });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { type, module: mod, title, body, imageUrl } = req.body;
    if (!['BUG','QUESTION'].includes(type)) return res.status(400).json({ error: 'Tipo inválido.' });
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Título y descripción obligatorios.' });

    const code = await nextCode();
    const post = await prisma.feedbackPost.create({
      data: {
        code,
        type,
        module: mod || null,
        title: title.trim(),
        body:  body.trim(),
        imageUrl: imageUrl || null,
        userId: req.user.id,
      },
      include: POST_INCLUDE,
    });

    // Notificar admins
    try {
      const adminEmails = await getFeedbackNotifyEmails();
      if (adminEmails.length > 0) {
        const typeLabel = TYPE_LABEL[type] || type;
        await sendMail({
          to: adminEmails,
          subject: `[MySelec CRM] ${code} — ${typeLabel}: ${title.trim()}`,
          html: require('../services/emailTemplate').brandedEmail({
            title: `Foro · ${code}`,
            preheader: `${typeLabel}: ${title.trim()}`,
            content: [
              require('../services/emailTemplate').emailParagraph(`De <strong>${req.user.name}</strong> (${req.user.email})`),
              require('../services/emailTemplate').emailInfoBox([
                `<strong>Tipo:</strong> ${typeLabel}`,
                ...(mod ? [`<strong>Módulo:</strong> ${mod}`] : []),
                `<strong>Título:</strong> ${escHtml(title.trim())}`,
              ]),
              `<div style="background:#F5F6F7;border-radius:8px;padding:14px 16px;margin:16px 0;white-space:pre-wrap;font-size:14px;color:#231F20;line-height:1.6">${escHtml(body.trim())}</div>`,
              require('../services/emailTemplate').emailParagraph('Ingresá al CRM → sección <strong>Foro</strong> para responder.'),
            ].join(''),
          }),
          text: `${code} · ${req.user.name}\nTipo: ${typeLabel}${mod ? `\nMódulo: ${mod}` : ''}\n\n${title.trim()}\n\n${body.trim()}`,
        });
      }
    } catch (mailErr) {
      console.warn('⚠️  feedback notify failed:', mailErr.message);
    }

    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/respond ─────────────────────────────────────────────────────────
router.post('/:id/respond', async (req, res) => {
  try {
    if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores pueden responder.' });
    const { body, status } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'La respuesta no puede estar vacía.' });
    if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });

    const post = await prisma.feedbackPost.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });

    const newStatus = status || (post.status === 'OPEN' ? 'REVIEWING' : post.status);

    const [response] = await prisma.$transaction([
      prisma.feedbackResponse.create({
        data: { body: body.trim(), userId: req.user.id, postId: post.id },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.feedbackPost.update({
        where: { id: post.id },
        data:  { status: newStatus },
      }),
    ]);

    // Notificar al autor
    try {
      if (post.user.email && post.user.email !== req.user.email) {
        await sendMail({
          to: post.user.email,
          replyTo: req.user.email,
          subject: `[MySelec CRM] Respuesta a tu reporte ${post.code}`,
          html: require('../services/emailTemplate').brandedEmail({
            title: `Respuesta · ${post.code}`,
            preheader: `${req.user.name} respondió a tu reporte`,
            content: [
              require('../services/emailTemplate').emailParagraph(`<strong>${req.user.name}</strong> respondió a: <em>${post.title}</em>`),
              `<div style="background:#F5F6F7;border-left:3px solid #20759E;border-radius:4px;padding:14px 16px;margin:16px 0;white-space:pre-wrap;font-size:14px;color:#231F20;line-height:1.6">${escHtml(body.trim())}</div>`,
              require('../services/emailTemplate').emailParagraph('Podés ver el hilo completo en la sección <strong>Foro</strong> del CRM.'),
            ].join(''),
          }),
          text: `${req.user.name} respondió tu reporte ${post.code}:\n\n${body.trim()}`,
        });
      }
    } catch (mailErr) {
      console.warn('⚠️  feedback respond notify failed:', mailErr.message);
    }

    res.json({ response, newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:id/status ────────────────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  try {
    if (!isDeveloper(req.user)) return res.status(403).json({ error: 'Solo desarrolladores pueden cambiar el estado.' });
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
    const post = await prisma.feedbackPost.update({ where: { id: req.params.id }, data: { status } });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:id — editar post (autor) ─────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const post = await prisma.feedbackPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    if (post.userId !== req.user.id) return res.status(403).json({ error: 'Solo el autor puede editar su publicación.' });

    const { type, module: mod, title, body } = req.body;
    if (type && !['BUG','QUESTION'].includes(type)) return res.status(400).json({ error: 'Tipo inválido.' });
    if (title !== undefined && !title?.trim()) return res.status(400).json({ error: 'El título no puede estar vacío.' });
    if (body  !== undefined && !body?.trim())  return res.status(400).json({ error: 'La descripción no puede estar vacía.' });

    const updated = await prisma.feedbackPost.update({
      where: { id: post.id },
      data: {
        ...(type  !== undefined && { type }),
        ...(mod   !== undefined && { module: mod || null }),
        ...(title !== undefined && { title: title.trim() }),
        ...(body  !== undefined && { body: body.trim() }),
      },
      include: POST_INCLUDE,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — eliminar post (autor o developer) ───────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const post = await prisma.feedbackPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    if (post.userId !== req.user.id && !isDeveloper(req.user)) return res.status(403).json({ error: 'Sin permiso para eliminar esta publicación.' });

    await prisma.feedbackPost.delete({ where: { id: post.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/vote ────────────────────────────────────────────────────────────
router.post('/:id/vote', async (req, res) => {
  try {
    const post = await prisma.feedbackPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    if (post.userId === req.user.id) return res.status(400).json({ error: 'No podés votar tu propio reporte.' });

    const already = post.voters.includes(req.user.id);
    const updated = await prisma.feedbackPost.update({
      where: { id: post.id },
      data: {
        voters: already
          ? { set: post.voters.filter(v => v !== req.user.id) }
          : { push: req.user.id },
      },
      select: { id: true, voters: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
