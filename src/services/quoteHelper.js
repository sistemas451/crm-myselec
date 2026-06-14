const prisma = require('../db');

async function nextOrderCode() {
  const prefix = `OC-${new Date().getFullYear()}`;
  const last = await prisma.order.findFirst({
    where:   { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select:  { code: true },
  });
  const num = last ? (parseInt(last.code.split('-').pop()) || 0) : 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

/**
 * Cuando una NP se vincula a un presupuesto por código Flexxus exacto:
 * - Si el presupuesto ya está en 'aceptada' → no hace nada (OC ya existe)
 * - Si no → lo mueve a 'aceptada', crea la OC si no existe,
 *   y mueve la SOLICITUD vinculada en paquete
 */
async function autoAcceptPresupuesto(presupuestoId) {
  const pres = await prisma.quote.findUnique({
    where:  { id: presupuestoId },
    select: { id: true, code: true, stage: true, mailType: true,
              clientId: true, sellerId: true, flexxusCode: true, linkedQuoteId: true },
  });
  if (!pres || pres.mailType !== 'PRESUPUESTO') return;
  if (pres.stage === 'aceptada') return;

  // 1. Mover presupuesto a aceptada + crear OC (si no existe) en transacción
  await prisma.$transaction(async (tx) => {
    await tx.quote.update({
      where: { id: pres.id },
      data:  { stage: 'aceptada', stageChangedAt: new Date() },
    });
    await tx.activity.create({
      data: { action: 'STAGE_CHANGE', detail: `Movido a aceptada automáticamente al recibir NP vinculada`, quoteId: pres.id },
    });

    // Buscar OC ya en etapa 'oc' — si no existe, crear el espejo
    const existingOCOrder = await tx.order.findFirst({ where: { fromQuoteId: pres.id, stage: 'oc' } });
    if (!existingOCOrder && pres.clientId) {
      const ocCode = await nextOrderCode();
      const newOrder = await tx.order.create({
        data: {
          code:        ocCode,
          clientId:    pres.clientId,
          sellerId:    pres.sellerId || null,
          fromQuoteId: pres.id,
          stage:       'oc',
          flexxusCode: pres.flexxusCode || null,
        },
      });
      await tx.activity.create({
        data: { action: 'CREATED', detail: `OC ${ocCode} creada automáticamente al recibir NP vinculada a ${pres.code}`, orderId: newOrder.id },
      });
      console.log(`   ✅ OC ${ocCode} creada automáticamente para presupuesto ${pres.code}`);
    }
  });

  // 2. Mover SOLICITUD vinculada en paquete
  if (pres.linkedQuoteId) {
    try {
      const sol = await prisma.quote.findUnique({
        where:  { id: pres.linkedQuoteId },
        select: { id: true, code: true, mailType: true, stage: true },
      });
      if (sol && sol.mailType === 'SOLICITUD' && sol.stage !== 'aceptada') {
        await prisma.quote.update({
          where: { id: sol.id },
          data:  { stage: 'aceptada', stageChangedAt: new Date() },
        });
        await prisma.activity.create({
          data: { action: 'STAGE_CHANGE', detail: `Movida a aceptada junto con ${pres.code} (paquete NP)`, quoteId: sol.id },
        });
        console.log(`   ✅ Solicitud ${sol.code} movida a aceptada en paquete`);
      }
    } catch (e) {
      console.error('Error moviendo solicitud en paquete:', e.message);
    }
  }

  console.log(`   ✅ Presupuesto ${pres.code} auto-aceptado por NP vinculada`);
}

module.exports = { autoAcceptPresupuesto };
