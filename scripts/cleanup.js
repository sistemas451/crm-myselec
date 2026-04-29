const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const deleted = await prisma.quote.deleteMany({
    where: { clientId: null }
  });
  console.log('Eliminados:', deleted.count, 'registros sin cliente');
  await prisma.$disconnect();
}

main().catch(console.error);
