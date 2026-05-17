const express = require('express');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

// Multer para avatares
const AVATARS_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATARS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

const router = express.Router();
const prisma  = new PrismaClient();

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
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
    if (!['ADMIN', 'VENDEDOR', 'LOGISTICA'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || !user.pendingApproval) return res.status(404).json({ error: 'Usuario no encontrado o no está pendiente' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role, active: true, pendingApproval: false },
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });

    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    await sendMail({
      to: user.email,
      subject: 'Tu cuenta fue aprobada · MySelec CRM',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#1B2A4A">¡Bienvenido/a a MySelec CRM!</h2>
          <p>Hola ${user.name}, tu cuenta fue aprobada. Ya podés ingresar al sistema.</p>
          <p>
            <a href="${baseUrl}"
               style="display:inline-block;padding:12px 24px;background:#3B82F6;color:white;text-decoration:none;border-radius:8px;font-weight:600">
              Ingresar al CRM
            </a>
          </p>
        </div>
      `,
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
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#1B2A4A">Solicitud de acceso</h2>
          <p>Hola ${user.name}, lamentablemente tu solicitud de acceso a MySelec CRM no fue aprobada.</p>
          <p>Si creés que es un error, contactá al administrador del sistema.</p>
        </div>
      `,
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
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });

    // Enriquecer con stats solo para admin
    if (req.user.role === 'ADMIN') {
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
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role = 'VENDEDOR', zone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email y password son requeridos' });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role, zone: zone || null },
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — actualizar usuario (admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, role, zone, password } = req.body;

    // Protección: no degradar al último admin activo
    if (role && role !== 'ADMIN') {
      const target = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (target && target.role === 'ADMIN' && target.active) {
        const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
        if (activeAdmins <= 1) {
          return res.status(400).json({ error: 'Debe haber al menos un administrador activo' });
        }
      }
    }

    const data = {};
    if (name)  data.name  = name;
    if (email) data.email = email;
    if (role)  data.role  = role;
    if (zone !== undefined) data.zone = zone || null;
    if (password) data.password = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, email: true, role: true, zone: true, active: true, createdAt: true },
    });
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

    // Protección: no dejar sin admins activos
    if (user.role === 'ADMIN' && user.active) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins <= 1) {
        return res.status(400).json({ error: 'Debe haber al menos un administrador activo' });
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

// PATCH /api/users/:id/password — cambiar contraseña (admin o el propio usuario)
router.patch('/:id/password', authMiddleware, async (req, res) => {
  try {
    const isSelf  = req.user.id === req.params.id;
    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Sin permiso' });

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

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hashed } });

    // Notificar al usuario por mail
    await sendMail({
      to: user.email,
      subject: 'Tu contraseña fue cambiada · MySelec CRM',
      html: `
        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
          <h2 style="color:#1B2A4A">Contraseña actualizada</h2>
          <p>Hola ${user.name}, tu contraseña de MySelec CRM fue cambiada exitosamente.</p>
          <p style="color:#64748B;font-size:13px">Si no fuiste vos, contactá al administrador del sistema de inmediato.</p>
        </div>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/profile — actualizar nombre (propio usuario o admin)
router.patch('/:id/profile', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/:id/avatar — subir foto de perfil (propio usuario o admin)
router.post('/:id/avatar', authMiddleware, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

    // Borrar avatar anterior si existe
    const existing = await prisma.user.findUnique({ where: { id: req.params.id }, select: { avatar: true } });
    if (existing?.avatar) {
      const oldPath = path.join(__dirname, '..', '..', existing.avatar.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { avatar: avatarUrl },
      select: { id: true, name: true, email: true, role: true, zone: true, avatar: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
