/**
 * Migración de una sola vez: sacar la "OC espejo" (modelo Order) de circulación.
 *
 * Contexto: la OC se creaba sola al aceptar un presupuesto, para que el vendedor
 * pudiera adjuntarle a mano la orden de compra del cliente. Nunca se usó (0
 * adjuntos en 87 órdenes) y sumaba una tarjeta vacía al paquete. El código que
 * la creaba ya se sacó; esto limpia lo que quedó en la base.
 *
 * Qué hace, en orden:
 *   1. Copia el número de OC del cliente (Order.clientOCCode) a la Nota de Pedido
 *      que le corresponde. Es el único dato que vive solo en Order.
 *   2. Borra las órdenes en etapa 'oc' (espejos vacíos, sin ningún dato).
 *   3. Con --incluir-duplicadas, borra también las de 'np_enviada', que son
 *      copias de una NP que ya está en el tablero por su cuenta.
 *   4. Borra la etapa "OC Recibida" si ya no queda ninguna orden en ella.
 *
 * Uso:
 *   railway run node scripts/migrar-oc.js                          # simulacro
 *   railway run node scripts/migrar-oc.js --aplicar
 *   railway run node scripts/migrar-oc.js --aplicar --incluir-duplicadas
 *
 * Correrlo DESPUÉS de desplegar el código: si se corre antes, cada NP que entre
 * mientras tanto vuelve a crear una orden y a guardar el número donde no va.
 *
 * Es de una sola vez — una vez corrido y verificado, se puede borrar el archivo.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

// Antes de copiar números y borrar órdenes, volcar a disco lo que se va a tocar.
async function guardarBackup() {
  const orders = await prisma.order.findMany({ orderBy: { code: 'asc' } });
  const nps = await prisma.quote.findMany({
    where:  { mailType: 'NOTA_PEDIDO' },
    select: { id: true, code: true, clientOCCode: true },
    orderBy: { code: 'asc' },
  });
  const etapas = await prisma.stageDefinition.findMany();
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `oc-antes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), orders, notasDePedido: nps, stageDefinitions: etapas }, null, 2));
  console.log(`   💾 backup: ${path.relative(process.cwd(), file)}  (${orders.length} órdenes, ${nps.length} NP)`);
}

const APLICAR    = process.argv.includes('--aplicar');
const DUPLICADAS = process.argv.includes('--incluir-duplicadas');
const modo = APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)';

// La vinculación presupuesto↔NP puede estar de cualquiera de los dos lados:
// mailReader solo escribía presupuesto.linkedQuoteId si estaba vacío, así que
// cuando el presupuesto ya apuntaba a su solicitud el único puntero quedó en la NP.
function buscarNP(fromQuote) {
  if (!fromQuote) return null;
  const candidatas = [fromQuote.linkedQuote, ...(fromQuote.linkedBy || [])];
  return candidatas.find(q => q && q.mailType === 'NOTA_PEDIDO') || null;
}

async function main() {
  console.log(`\n=== Migración de la OC espejo — ${modo} ===\n`);
  if (APLICAR) await guardarBackup();

  // ── 1. El número de OC del cliente pasa a la Nota de Pedido ──────────────
  const conOC = await prisma.order.findMany({
    where:  { clientOCCode: { not: null } },
    select: {
      code: true, clientOCCode: true,
      fromQuote: {
        select: {
          code: true,
          linkedQuote: { select: { id: true, code: true, mailType: true, clientOCCode: true } },
          linkedBy:    { select: { id: true, code: true, mailType: true, clientOCCode: true } },
        },
      },
    },
  });

  const aMigrar = [];
  const sinDestino = [];
  const choques = [];
  for (const o of conOC) {
    const np = buscarNP(o.fromQuote);
    if (!np) { sinDestino.push(o); continue; }
    if (np.clientOCCode && np.clientOCCode !== o.clientOCCode) { choques.push({ o, np }); continue; }
    if (np.clientOCCode === o.clientOCCode) continue;   // ya estaba, nada que hacer
    aMigrar.push({ npId: np.id, npCode: np.code, ocCode: o.code, valor: o.clientOCCode });
  }

  console.log(`1. Número de OC del cliente`);
  console.log(`   órdenes con el dato : ${conOC.length}`);
  console.log(`   a copiar a su NP    : ${aMigrar.length}`);
  console.log(`   sin NP donde ponerlo: ${sinDestino.length}${sinDestino.length ? ' ← REVISAR' : ''}`);
  console.log(`   choques de valor    : ${choques.length}${choques.length ? ' ← REVISAR' : ''}`);
  if (sinDestino.length) console.log('   ', JSON.stringify(sinDestino.map(o => o.code)));
  if (choques.length)    console.log('   ', JSON.stringify(choques.map(c => `${c.o.code}:${c.o.clientOCCode} vs ${c.np.code}:${c.np.clientOCCode}`)));

  if (APLICAR && aMigrar.length) {
    for (const m of aMigrar) {
      await prisma.quote.update({ where: { id: m.npId }, data: { clientOCCode: m.valor } });
    }
    console.log(`   ✅ ${aMigrar.length} copiados`);
  }

  // Freno: si algo quedó sin migrar, no se borra nada.
  if (sinDestino.length || choques.length) {
    console.log('\n⛔ Hay órdenes cuyo número de OC no se pudo guardar en ninguna NP.');
    console.log('   No se borra nada hasta resolverlas a mano.\n');
    return;
  }

  // ── 2. Los espejos vacíos ────────────────────────────────────────────────
  const vacias = await prisma.order.findMany({ where: { stage: 'oc' }, select: { id: true, code: true } });
  console.log(`\n2. Espejos vacíos en etapa "OC Recibida": ${vacias.length}`);
  if (APLICAR && vacias.length) {
    const r = await prisma.order.deleteMany({ where: { id: { in: vacias.map(v => v.id) } } });
    console.log(`   ✅ ${r.count} borrados (su actividad se va en cascada)`);
  }

  // ── 3. Las que duplican una NP que ya está en el tablero ─────────────────
  const dup = await prisma.order.findMany({ where: { stage: 'np_enviada' }, select: { id: true, code: true, flexxusCode: true } });
  console.log(`\n3. Órdenes en "NP Enviada" que duplican una NP: ${dup.length}`);
  if (!DUPLICADAS) {
    console.log('   (se dejan — correr con --incluir-duplicadas para borrarlas)');
  } else if (APLICAR) {
    const r = await prisma.order.deleteMany({ where: { id: { in: dup.map(d => d.id) } } });
    console.log(`   ✅ ${r.count} borradas`);
  }

  // ── 4. La etapa "OC Recibida" ────────────────────────────────────────────
  const etapa = await prisma.stageDefinition.findFirst({ where: { phase: 'ORDEN_COMPRA', stageKey: 'oc' } });
  const quedan = await prisma.order.count({ where: { stage: 'oc' } });
  console.log(`\n4. Etapa "OC Recibida": ${etapa ? 'existe' : 'ya no existe'} | órdenes que quedan en ella: ${quedan}`);
  if (APLICAR && etapa && quedan === 0) {
    await prisma.stageDefinition.delete({ where: { id: etapa.id } });
    console.log('   ✅ etapa borrada');
  } else if (etapa && quedan > 0) {
    console.log('   ⚠️  no se borra: todavía hay órdenes en esa etapa');
  }

  // ── Resumen final ────────────────────────────────────────────────────────
  console.log(`\n=== Estado final ===`);
  console.log('órdenes totales        :', await prisma.order.count());
  console.log('NPs con número de OC   :', await prisma.quote.count({ where: { mailType: 'NOTA_PEDIDO', clientOCCode: { not: null } } }));
  console.log('etapas de Fase 2       :', (await prisma.stageDefinition.findMany({ where: { phase: 'ORDEN_COMPRA', active: true }, orderBy: { order: 'asc' } })).map(s => s.stageKey).join(' → '));
  if (!APLICAR) console.log('\n(simulacro — no se cambió nada. Agregar --aplicar para ejecutar)');
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
