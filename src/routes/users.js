const express = require('express');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const crypto  = require('crypto');
const { authMiddleware, isAdmin, isDeveloper } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const { brandedEmail, emailButton, emailInfoBox, emailWarning, emailParagraph } = require('../services/emailTemplate');
const { emailAllowed, getAllowedDomains } = require('./auth');
const prisma = require('../db');

// Multer para avatares — memoria (base64 → DB, sin depender del disco de Railway)
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

const router = express.Router();

const adminOnly = (req, res, next) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// GET /api/users/pending — usuarios pendientes de aprobación (admin only)
router.get('/pending', authMiddleware, adminOnly, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { pendingApproval: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, phone: true, dni: true, cuit: true, createdAt: true },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/approve — aprobar usuario pendiente (admin only)
router.post('/:id/approve', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    // Only DEVELOPER can assign DEVELOPER role
    if (role === 'DEVELOPER' && !isDeveloper(req.user)) return res.status(403).json({ error: 'Solo un Desarrollador puede asignar ese rol.' });
    if (!['DEVELOPER', 'ADMIN', 'VENDEDOR', 'LOGISTICA'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || !user.pendingApproval) return res.status(404).json({ error: 'Usuario no encontrado o no está pendiente' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role, active: true, pendingApproval: false, notifyUnassigned: ['DEVELOPER','ADMIN'].includes(role) },
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });

    const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const roleLabel = role === 'DEVELOPER' ? 'Desarrollador' : role === 'ADMIN' ? 'Administrador' : role === 'VENDEDOR' ? 'Vendedor' : 'Logística';
    await sendMail({
      to: user.email,
      subject: '🎉 Tu cuenta fue aprobada · MySelec CRM',
      html: brandedEmail({
        title: 'Bienvenido a MySelec CRM',
        preheader: 'Tu cuenta fue aprobada',
        content: [
          emailParagraph(`Hola <strong>${user.name}</strong>,`),
          emailParagraph('Tu solicitud de acceso fue aprobada. Ya podés ingresar al sistema con el email y contraseña que usaste al registrarte.'),
          emailInfoBox([`<strong>Email:</strong> ${user.email}`, `<strong>Rol:</strong> ${roleLabel}`]),
          emailButton(APP_URL, 'Ingresar al CRM'),
        ].join(''),
      }),
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/reject — rechazar usuario pendiente (admin only)
router.post('/:id/reject', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || !user.pendingApproval) return res.status(404).json({ error: 'Usuario no encontrado o no está pendiente' });

    await prisma.user.delete({ where: { id: req.params.id } });

    await sendMail({
      to: user.email,
      subject: 'Tu solicitud de acceso · MySelec CRM',
      html: brandedEmail({
        title: 'Solicitud de acceso',
        content: [
          emailParagraph(`Hola <strong>${user.name}</strong>,`),
          emailParagraph('Lamentablemente tu solicitud de acceso a MySelec CRM no fue aprobada.'),
          emailParagraph('Si creés que es un error, contactá al administrador del sistema.'),
        ].join(''),
      }),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users — lista usuarios (admin: todos, vendedor: solo activos básico)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { pendingApproval: false },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, avatar: true, phone: true, passwordChangedAt: true, notifyUnassigned: true, notificationPrefs: true, createdAt: true },
    });

    // Enriquecer con stats solo para admin
    if (isAdmin(req.user)) {
      const enriched = await Promise.all(users.map(async u => {
        const [cotiz, ganadas, ocs, clientes] = await Promise.all([
          prisma.quote.count({ where: { sellerId: u.id } }),
          prisma.quote.count({ where: { sellerId: u.id, stage: 'aceptada' } }),
          prisma.order.count({ where: { sellerId: u.id } }),
          prisma.client.count({ where: { defaultSellerId: u.id } }),
        ]);
        return { ...u, cotiz, ganadas, ocs, clientes };
      }));
      return res.json(enriched);
    }

    res.json(users.filter(u => u.active).map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role, zone: u.zone
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — crear usuario (admin only)
// No requiere contraseña: genera una temporal y envía link de "Configurar mi contraseña"
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, role = 'VENDEDOR', zone } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Nombre y email son requeridos' });

    const normalizedEmail = email.toLowerCase().trim();

    // Validar dominio/whitelist
    if (!await emailAllowed(normalizedEmail)) {
      const domains = await getAllowedDomains();
      return res.status(400).json({
        error: `Email no permitido. Dominios válidos: ${domains.join(', ')}. Podés agregar excepciones en Configuración → Acceso.`,
      });
    }

    const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });

    // Generar contraseña temporal (nunca se muestra, solo se hashea)
    const tempPassword = crypto.randomBytes(16).toString('base64url');
    const hashed = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: hashed,
        role,
        zone: zone || null,
        notifyUnassigned: ['DEVELOPER','ADMIN'].includes(role),
      },
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });

    // Generar token de reset para el link "Configurar mi contraseña"
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000); // 48 horas
    await prisma.passwordResetToken.create({
      data: { token: resetToken, userId: user.id, expiresAt },
    });

    // Enviar mails (no bloquean la respuesta al admin)
    const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${APP_URL}?reset=${resetToken}`;
    const roleLabel = role === 'DEVELOPER' ? 'Desarrollador' : role === 'ADMIN' ? 'Administrador' : role === 'VENDEDOR' ? 'Vendedor' : 'Logística';
    const adminName = req.user.name || 'Un administrador';

    // 1. Mail al nuevo usuario
    const welcomeHtml = brandedEmail({
      title: 'Bienvenido a MySelec CRM',
      preheader: 'Configurá tu contraseña para comenzar',
      content: [
        emailParagraph(`Hola <strong>${user.name}</strong>,`),
        emailParagraph(`${adminName} te creó una cuenta en el CRM de MySelec.`),
        emailInfoBox([`<strong>Email:</strong> ${user.email}`, `<strong>Rol:</strong> ${roleLabel}`]),
        emailParagraph('Para empezar, configurá tu contraseña haciendo click en el botón:'),
        emailButton(resetLink, 'Configurar mi contraseña'),
        emailWarning('Este enlace expira en 48 horas', 'Si ya expiró, usá <strong>"Olvidé mi contraseña"</strong> en la pantalla de login para generar uno nuevo.'),
      ].join(''),
    });

    // 2. Mail al admin que lo creó
    const adminHtml = brandedEmail({
      title: 'Usuario creado',
      preheader: `Nuevo usuario: ${user.name}`,
      content: [
        emailParagraph('Creaste un nuevo usuario en MySelec CRM:'),
        emailInfoBox([`<strong>Nombre:</strong> ${user.name}`, `<strong>Email:</strong> ${user.email}`, `<strong>Rol:</strong> ${roleLabel}`]),
        emailParagraph('<span style="color:#939598;font-size:13px">Se envió un mail de bienvenida con el link para configurar la contraseña.</span>'),
      ].join(''),
    });

    // Enviar ambos en paralelo (no bloquean la respuesta)
    Promise.all([
      sendMail({ to: user.email, subject: '🎉 Bienvenido a MySelec CRM — Configurá tu contraseña', html: welcomeHtml }),
      sendMail({ to: req.user.email, subject: `✅ Usuario creado: ${user.name}`, html: adminHtml }),
    ]).catch(err => console.error('Error enviando mails de bienvenida:', err.message));

    res.json({ ...user, welcomeEmailSent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/resend-welcome — reenviar mail de bienvenida (admin only)
router.post('/:id/resend-welcome', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, email: true, role: true } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Invalidar tokens previos y crear uno nuevo
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000);
    await prisma.passwordResetToken.create({ data: { token: resetToken, userId: user.id, expiresAt } });

    const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${APP_URL}?reset=${resetToken}`;
    const roleLabel = user.role === 'DEVELOPER' ? 'Desarrollador' : user.role === 'ADMIN' ? 'Administrador' : user.role === 'VENDEDOR' ? 'Vendedor' : 'Logística';

    const html = brandedEmail({
      title: 'Bienvenido a MySelec CRM',
      preheader: 'Configurá tu contraseña para comenzar',
      content: [
        emailParagraph(`Hola <strong>${user.name}</strong>,`),
        emailParagraph('Te reenviamos el link para configurar tu contraseña en MySelec CRM.'),
        emailInfoBox([`<strong>Email:</strong> ${user.email}`, `<strong>Rol:</strong> ${roleLabel}`]),
        emailButton(resetLink, 'Configurar mi contraseña'),
        emailWarning('Este enlace expira en 48 horas', 'Si ya expiró, usá <strong>"Olvidé mi contraseña"</strong> en la pantalla de login.'),
      ].join(''),
    });

    await sendMail({ to: user.email, subject: '🎉 Bienvenido a MySelec CRM — Configurá tu contraseña', html });
    res.json({ ok: true, sentTo: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — actualizar usuario (admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, role, zone, password } = req.body;

    // Protección: no degradar al último admin/developer activo
    if (role && !['ADMIN', 'DEVELOPER'].includes(role)) {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (target && target.role === 'ADMIN' && target.active) {
        const activePrivileged = await prisma.user.count({ where: { role: { in: ['ADMIN', 'DEVELOPER'] }, active: true } });
        if (activePrivileged <= 1) {
          return res.status(400).json({ error: 'Debe haber al menos un administrador o desarrollador activo' });
        }
      }
    }

    // Validar contraseña si se está cambiando
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'La contraseña debe incluir al menos una mayúscula' });
      if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'La contraseña debe incluir al menos un número' });
    }

    const data = {};
    if (name)  data.name  = name;
    if (email) data.email = email;
    if (role) {
      data.role = role;
      data.passwordChangedAt = new Date(); // invalida JWT con el rol anterior → re-login obligatorio
    }
    if (zone !== undefined) data.zone = zone || null;
    if (password) {
      data.password = await bcrypt.hash(password, 10);
      data.passwordChangedAt = new Date(); // invalida JWTs previos
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });

    // Si se cambió la contraseña, notificar al usuario por mail
    if (password) {
      const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const adminName = req.user.name || 'Un administrador';
      sendMail({
        to: user.email,
        subject: '🔑 Tu contraseña fue cambiada · MySelec CRM',
        html: brandedEmail({
          title: 'Contraseña actualizada',
          preheader: 'Tu contraseña de MySelec CRM fue cambiada',
          content: [
            emailParagraph(`Hola <strong>${user.name}</strong>,`),
            emailParagraph(`${adminName} cambió la contraseña de tu cuenta en MySelec CRM. Contactalo para obtener tu nueva contraseña.`),
            emailWarning('Recomendación', 'Una vez que ingreses, podés cambiar tu contraseña desde <strong>Mi Perfil</strong>.'),
            emailButton(APP_URL, 'Ingresar al CRM'),
          ].join(''),
        }),
      }).catch(err => console.error('Error enviando mail de cambio de contraseña:', err.message));
    }

    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/toggle — activar/desactivar (admin only)
router.patch('/:id/toggle', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'No podés desactivarte a vos mismo' });

    // Protección: no dejar sin admins ni developers activos
    if (['ADMIN', 'DEVELOPER'].includes(user.role) && user.active) {
      const activePrivileged = await prisma.user.count({ where: { role: { in: ['ADMIN', 'DEVELOPER'] }, active: true } });
      if (activePrivileged <= 1) {
        return res.status(400).json({ error: 'Debe haber al menos un administrador o desarrollador activo' });
      }
    }

    // Al desactivar un vendedor, advertir si tiene cotizaciones abiertas
    if (user.active && user.role === 'VENDEDOR' && !req.body.forceDeactivate) {
      const openQuotes = await prisma.quote.count({
        where: {
          sellerId: req.params.id,
          stage: { notIn: ['aceptada', 'rechazada'] },
        },
      });
      if (openQuotes > 0) {
        return res.status(409).json({
          error: `${user.name} tiene ${openQuotes} cotización(es) activa(s). ¿Confirmar desactivación?`,
          openQuotes,
          requiresConfirmation: true,
        });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: !user.active },
      select: { id: true, name: true, active: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/notification-prefs — guardar preferencias personales de notificación
router.patch('/:id/notification-prefs', authMiddleware, async (req, res) => {
  try {
    const isSelf  = req.user.id === req.params.id;
    const isAdminUser = isAdmin(req.user);
    if ((!isAdminUser && !isSelf)) return res.status(403).json({ error: 'Sin permiso' });

    const { prefs } = req.body; // { email: {...}, inapp: {...} }
    if (!prefs || typeof prefs !== 'object') return res.status(400).json({ error: 'prefs requerido' });

    // Merge con las prefs existentes
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { notificationPrefs: true } });
    const current  = (existing?.notificationPrefs && typeof existing.notificationPrefs === 'object') ? existing.notificationPrefs : {};
    const merged   = {
      email: { ...(current.email || {}), ...(prefs.email || {}) },
      inapp: { ...(current.inapp  || {}), ...(prefs.inapp  || {}) },
    };

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data:  { notificationPrefs: merged },
      select: { id: true, notificationPrefs: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/notify-unassigned — toggle notificación de mails sin cliente
router.patch('/:id/notify-unassigned', authMiddleware, adminOnly, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data:  { notifyUnassigned: !user.notifyUnassigned },
      select: { id: true, notifyUnassigned: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/password — cambiar contraseña (admin o el propio usuario)
router.patch('/:id/password', authMiddleware, async (req, res) => {
  try {
    const isSelf  = req.user.id === req.params.id;
    const isAdminUser = isAdmin(req.user);
    if ((!isAdminUser && !isSelf)) return res.status(403).json({ error: 'Sin permiso' });

    const { password, currentPassword } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Contraseña mínimo 8 caracteres' });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'Debe incluir al menos una mayúscula' });
    if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'Debe incluir al menos un número' });

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si es el propio usuario (no admin cambiando la de otro), verificar contraseña actual
    if (isSelf) {
      if (!currentPassword) return res.status(400).json({ error: 'Ingresá tu contraseña actual' });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    }

    // Bloquear si la nueva contraseña es igual a la actual
    const isSame = await bcrypt.compare(password, user.password);
    if (isSame) return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual' });

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { password: hashed, passwordChangedAt: new Date() },
    });

    // Notificar al usuario por mail
    await sendMail({
      to: user.email,
      subject: 'Tu contraseña fue cambiada · MySelec CRM',
      html: brandedEmail({
        title: 'Contraseña actualizada',
        content: [
          emailParagraph(`Hola <strong>${user.name}</strong>,`),
          emailParagraph('Tu contraseña de MySelec CRM fue cambiada exitosamente.'),
          emailWarning('Importante', 'Si no fuiste vos, contactá al administrador del sistema de inmediato.'),
        ].join(''),
      }),
    });

    res.json({ ok: true, passwordChangedAt: new Date() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/profile — actualizar nombre (propio usuario o admin)
router.patch('/:id/profile', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user) && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const { name, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    const data = { name: name.trim() };
    if (phone !== undefined) data.phone = phone.trim() || null;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true, phone: true, passwordChangedAt: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/avatar — subir foto de perfil (propio usuario o admin)
router.post('/:id/avatar', authMiddleware, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!isAdmin(req.user) && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

    // Guardar como data URL base64 en la DB (sin disco — compatible con Railway)
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { avatar: dataUrl },
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id/avatar — eliminar foto de perfil
router.delete('/:id/avatar', authMiddleware, async (req, res) => {
  try {
    if (!isAdmin(req.user) && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { avatar: null },
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
