require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const qi  = await prisma.quoteItem.deleteMany({});
  console.log('QuoteItems borrados:', qi.count);
  const act = await prisma.activity.deleteMany({});
  console.log('Activities borradas:', act.count);
  const nt  = await prisma.note.deleteMany({});
  console.log('Notes borradas:', nt.count);
  const att = await prisma.attachment.deleteMany({});
  console.log('Attachments borrados:', att.count);
  const ord = await prisma.order.deleteMany({});
  console.log('Orders borradas:', ord.count);
  const q   = await prisma.quote.deleteMany({});
  console.log('Quotes borradas:', q.count);
  console.log('\n✅ Todo limpio. Ahora sincronizá el mail para reprocesar.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
