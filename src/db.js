/**
 * Instancia singleton de PrismaClient.
 * Importar desde todos los archivos en lugar de hacer `new PrismaClient()`.
 * Esto evita la explosión del pool de conexiones en Neon (plan gratuito: 5 conexiones).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
