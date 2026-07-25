/**
 * routes/feedback.js — Foro de soporte interno
 *
 * GET  /meta          — meetingLink + plantillas
 * GET  /              — listar posts (todos ven todos)
 * POST /              — crear post (genera código MYS-XXXX)
 * GET  /:id           — detalle de un post
 * POST /:id/respond   — responder (DEVELOPER only) + notifica al autor
 * POST /:id/comment   — seguir el hilo (cualquier usuario autenticado) + notifica
 * PATCH /:id/status   — cambiar estado (DEVELOPER only)
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

// true si el usuario tiene activada la pref de email para esa clave (default: activada)
function userEmailPref(notificationPrefs, key) {
  const emailPrefs = notificationPrefs?.email;
  if (!emailPrefs || typeof emailPrefs !== 'object') return true;
  return emailPrefs[key] !== false;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['OPEN','REVIEWING','PENDING_FIX','SCHEDULE_MEETING','RESPONDED','RESOLVED','CLOSED'];

// {nombre} se reemplaza en el frontend por el nombre (de pila) de quien publicó el post
const TEMPLATES = {
  BUG: [
    {
      id: 'bug_confirmed',
      label: 'Error confirmado',
      status: 'PENDING_FIX',
      body: 'Hola {nombre}, ¡muchas gracias por reportar este error! Lo registro y lo reviso — cuando esté corregido te actualizo acá. Cualquier otra duda, avisame.',
    },
    {
      id: 'bug_fixed',
      label: 'Error ya corregido',
      status: 'RESOLVED',
      body: 'Hola {nombre}, este error ya lo corregí en la última actualización. Si seguís teniendo el problema, avisame con una captura nueva.',
    },
    {
      id: 'reviewing',
      label: 'En revisión',
      status: 'REVIEWING',
      body: 'Hola {nombre}, recibí tu reporte y lo estoy analizando. Te actualizo apenas tenga novedades. Cualquier otra duda, avisame.',
    },
    {
      id: 'need_more_info',
      label: 'Pedir más datos',
      status: 'REVIEWING',
      body: 'Hola {nombre}, para poder ayudarte mejor, ¿me pasás una captura del error y los pasos para reproducirlo? Cualquier otra duda, avisame.',
    },
    {
      id: 'not_a_bug',
      label: 'No es un error',
      status: 'RESOLVED',
      body: 'Hola {nombre}, gracias por avisarme — revisé esto y en realidad es el comportamiento esperado del sistema, no un error. [Explicación acá]. Cualquier otra duda, avisame.',
    },
  ],
  QUESTION: [
    {
      id: 'question_reviewing',
      label: 'Lo voy a revisar',
      status: 'REVIEWING',
      body: 'Hola {nombre}, ¡gracias por tu consulta! La recibí y la voy a analizar, te respondo a la brevedad. Cualquier otra duda, avisame.',
    },
    {
      id: 'question_answer',
      label: 'Responder ahora',
      status: 'RESPONDED',
      body: 'Hola {nombre}, ¡gracias por tu consulta! [Escribí acá la respuesta]. Cualquier otra duda, avisame.',
    },
    {
      id: 'question_followup',
      label: 'Retomando consulta',
      status: 'RESPONDED',
      body: '¡Buenas {nombre}! Retomando tu consulta: [Escribí acá la respuesta]. Cualquier otra duda, avisame.',
    },
    {
      id: 'question_more_info',
      label: 'Pedir más info',
      status: 'REVIEWING',
      body: 'Hola {nombre}, ¡gracias por la consulta! Para poder ayudarte mejor, ¿me podrías dar un poco más de detalle sobre [...]? Cualquier otra duda, avisame.',
    },
  ],
  OTHER: [
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
          select: { email: true, notificationPrefs: true },
        });
        return users.filter(u => userEmailPref(u.notificationPrefs, 'foro_activity')).map(u => u.email).filter(Boolean);
      }
    }
  } catch (_) {}
  // Fallback: todos los DEVELOPER activos
  const devs = await prisma.user.findMany({
    where: { role: 'DEVELOPER', active: true },
    select: { email: true, notificationPrefs: true },
  });
  return devs.filter(u => userEmailPref(u.notificationPrefs, 'foro_activity')).map(u => u.email).filter(Boolean);
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
    include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
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
    const userFull = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } });
    const lastForoCheck = userFull?.notificationPrefs?.lastForoCheck || null;

    res.json({ meetingLink, templates: tpls, lastForoCheck });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /mark-seen — actualiza lastForoCheck del usuario (limpia el badge del sidebar) ───
router.post('/mark-seen', async (req, res) => {
  try {
    const userFull = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationPrefs: true } });
    const prefs = userFull?.notificationPrefs || {};
    await prisma.user.update({
      where: { id: req.user.id },
      data: { notificationPrefs: { ...prefs, lastForoCheck: new Date().toISOString() } },
    });
    res.json({ ok: true });
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
      include: { user: { select: { name: true, email: true, notificationPrefs: true } } },
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
      if (post.user.email && post.user.email !== req.user.email && userEmailPref(post.user.notificationPrefs, 'foro_response')) {
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

// ── POST /:id/comment — seguir el hilo (cualquier usuario autenticado) ────────
router.post('/:id/comment', async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'El comentario no puede estar vacío.' });

    const post = await prisma.feedbackPost.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, notificationPrefs: true } } },
    });
    if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
    if (post.status === 'CLOSED') return res.status(400).json({ error: 'Este caso está cerrado.' });

    const dev = isDeveloper(req.user);
    // Si alguien que no es desarrollador comenta un caso ya dado por resuelto, lo reabrimos
    // para que no quede enterrado — necesita que el equipo lo vuelva a mirar.
    const reopenStatuses = ['RESPONDED', 'RESOLVED'];
    const newStatus = (!dev && reopenStatuses.includes(post.status)) ? 'OPEN' : post.status;

    const ops = [
      prisma.feedbackResponse.create({
        data: { body: body.trim(), userId: req.user.id, postId: post.id },
        include: { user: { select: { id: true, name: true, avatar: true, role: true } } },
      }),
    ];
    if (newStatus !== post.status) {
      ops.push(prisma.feedbackPost.update({ where: { id: post.id }, data: { status: newStatus } }));
    }
    const [response] = await prisma.$transaction(ops);

    // Notificar: si comenta el dev, avisar al autor; si comenta cualquier otro, avisar a los devs
    try {
      if (dev) {
        if (post.user.email && post.user.email !== req.user.email && userEmailPref(post.user.notificationPrefs, 'foro_response')) {
          await sendMail({
            to: post.user.email,
            replyTo: req.user.email,
            subject: `[MySelec CRM] Nueva respuesta en tu reporte ${post.code}`,
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
      } else {
        const devEmails = (await getFeedbackNotifyEmails()).filter(e => e !== req.user.email);
        if (devEmails.length > 0) {
          await sendMail({
            to: devEmails,
            subject: `[MySelec CRM] ${post.code} — nuevo comentario de ${req.user.name}`,
            html: require('../services/emailTemplate').brandedEmail({
              title: `Foro · ${post.code}`,
              preheader: `${req.user.name} comentó: ${post.title}`,
              content: [
                require('../services/emailTemplate').emailParagraph(`<strong>${req.user.name}</strong> sumó un comentario en: <em>${post.title}</em>`),
                `<div style="background:#F5F6F7;border-radius:8px;padding:14px 16px;margin:16px 0;white-space:pre-wrap;font-size:14px;color:#231F20;line-height:1.6">${escHtml(body.trim())}</div>`,
                require('../services/emailTemplate').emailParagraph('Ingresá al CRM → sección <strong>Foro</strong> para responder.'),
              ].join(''),
            }),
            text: `${req.user.name} comentó ${post.code}:\n\n${body.trim()}`,
          });
        }
        // Si además hay un tercero (ni autor ni comentarista) siguiendo el hilo, no hace falta avisarle acá —
        // solo notificamos al autor cuando responde un dev, y a los devs cuando responde cualquier otro.
      }
    } catch (mailErr) {
      console.warn('⚠️  feedback comment notify failed:', mailErr.message);
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
