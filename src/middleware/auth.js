const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded;

    // Invalidar tokens emitidos antes del último cambio de contraseña
    if (decoded.iat) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          select: { passwordChangedAt: true, active: true, pendingApproval: true },
        });
        if (user) {
          if (!user.active || user.pendingApproval) {
            return res.status(401).json({ error: 'Sesión inválida' });
          }
          if (user.passwordChangedAt) {
            const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
            if (decoded.iat < changedAt) {
              return res.status(401).json({ error: 'Sesión expirada. Iniciá sesión nuevamente.' });
            }
          }
        }
      } catch {
        // Si la consulta falla (ej: cliente Prisma desactualizado), dejamos pasar
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sin permisos' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
