/**
 * Corrección puntual: 2 solicitudes que quedaron "colgadas" de una revisión
 * que ya tenía otra solicitud vinculada — el bug arreglado en paquete.js
 * (marcarComoRevision, commit 28ac91b, 17/09/2026).
 *
 * Encontradas al revisar si los cambios de la semana funcionaron bien:
 *   - SOL-2026-550 apuntaba a COT-2026-602, que en realidad ya era de SOL-2026-583.
 *   - SOL-2026-544 apuntaba a COT-2026-613, que en realidad ya era de SOL-2026-598.
 * En los dos casos el presupuesto (linkedQuoteId) NO apunta de vuelta a estas
 * solicitudes — es un vínculo de un solo lado, no un vínculo real.
 *
 * Qué hace: solo LIMPIA el vínculo de un solo lado (linkedQuoteId = null).
 * No las mueve de etapa, no las anula, no decide nada por Santiago o Luciano —
 * las deja sueltas y visibles, como si nunca se hubieran vinculado, para que
 * el vendedor decida qué hacer con cada una.
 *
 * Uso:
 *   railway run node scripts/corregir-recotizacion-colgada.js             # simulacro
 *   railway run node scripts/corregir-recotizacion-colgada.js --aplicar
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');
const CASOS = [
  { colgada: 'SOL-2026-550', revisionQueLaTomo: 'COT-2026-602', duenoReal: 'SOL-2026-583' },
  { colgada: 'SOL-2026-544', revisionQueLaTomo: 'COT-2026-613', duenoReal: 'SOL-2026-598' },
];

async function guardarBackup(ids) {
  const filas = await prisma.quote.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, mailType: true, stage: true, linkedQuoteId: true, clientId: true, sellerId: true },
  });
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `recotizacion-colgada-antes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), quotes: filas }, null, 2));
  console.log(`   💾 backup: ${path.relative(process.cwd(), file)}\n`);
}

async function main() {
  console.log(`\n=== Corregir solicitudes colgadas de una recotización ajena — ${APLICAR ? 'APLICANDO' : 'SIMULACRO'} ===\n`);

  const codes = CASOS.flatMap(c => [c.colgada, c.revisionQueLaTomo, c.duenoReal]);
  const qs = await prisma.quote.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, linkedQuoteId: true, stage: true } });
  const porCode = Object.fromEntries(qs.map(q => [q.code, q]));

  const aCorregir = [];
  for (const c of CASOS) {
    const colgada = porCode[c.colgada], revision = porCode[c.revisionQueLaTomo], dueno = porCode[c.duenoReal];
    if (!colgada || !revision || !dueno) { console.log(`   ⚠ ${c.colgada}: no se encontró alguno de los 3 documentos, se saltea`); continue; }
    const esColgada = colgada.linkedQuoteId === revision.id;
    const revisionEsDeOtro = revision.linkedQuoteId === dueno.id;
    if (!esColgada) { console.log(`   ⚠ ${c.colgada}: ya no apunta a ${c.revisionQueLaTomo} (¿ya se corrigió a mano?) — se saltea`); continue; }
    if (!revisionEsDeOtro) { console.log(`   ⚠ ${c.revisionQueLaTomo}: ya no apunta a ${c.duenoReal} — se saltea, no toco algo que cambió`); continue; }
    console.log(`   ✓ ${c.colgada} (${colgada.stage}) → se desvincula. ${c.revisionQueLaTomo} sigue con ${c.duenoReal}, sin tocar.`);
    aCorregir.push(colgada);
  }

  if (!APLICAR) { console.log('\nSimulacro: no se cambió nada. Para aplicar: --aplicar\n'); return; }
  if (!aCorregir.length) { console.log('\nNada para corregir.\n'); return; }

  await guardarBackup(aCorregir.map(q => q.id));
  for (const q of aCorregir) {
    await prisma.$transaction([
      prisma.quote.update({ where: { id: q.id }, data: { linkedQuoteId: null } }),
      prisma.activity.create({ data: {
        action: 'LINKED',
        detail: 'Vínculo eliminado — quedó apuntando a una revisión que ya tenía otra solicitud vinculada (bug corregido el 17/09/2026, ver commit 28ac91b)',
      quoteId: q.id } }),
    ]);
  }
  console.log(`\n✅ ${aCorregir.length} solicitud(es) desvinculada(s)\n`);
}

main().catch(e => { console.error('ERROR:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
