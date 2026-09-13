/**
 * Corrección de una sola vez: la nota de pedido NP-20970 quedó en dos fichas.
 *
 * Qué pasó: Flexxus regeneró la misma nota de pedido al día siguiente con menos
 * cantidad, y el PDF corregido entró como una ficha nueva en vez de reemplazar
 * a la anterior.
 *
 *   NP-2026-016  22/06  10 x CAJA P/MEDIDOR @205  →  USD 2.480,50
 *   NP-2026-021  23/06   5 x CAJA P/MEDIDOR @205  →  USD 1.240,25   ← la buena
 *
 * No es una entrega parcial: si lo fuera, las cantidades sumarían (10 + 5 = 15)
 * y el pedido original era de 10. Es el mismo pedido con la cantidad corregida
 * a la mitad. Hoy las dos están en "aceptada" sumando 3.720,75 cuando lo real
 * es 1.240,25 — hay 2.480,50 contados de más.
 *
 * Se resuelve con la misma maquinaria de revisiones que usan los presupuestos:
 * la corregida queda como revisión de la vieja, y la vieja se anula (sigue
 * consultable, sale del tablero y de todos los totales).
 *
 * Es a propósito un script para ESTE par y no una regla general: hay otras NP
 * que comparten número y NO son este caso (NP-21419 de ARATIC tiene el mismo
 * importe en las dos, NP-21223 de EDEA son modificaciones con importes
 * iguales). Cada una necesita ojo humano.
 *
 * Uso:
 *   railway run node scripts/corregir-np-20970.js            # simulacro
 *   railway run node scripts/corregir-np-20970.js --aplicar
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');
const { marcarComoRevision } = require('../src/services/paquete');

const APLICAR  = process.argv.includes('--aplicar');
const VIEJA    = 'NP-2026-016';   // 10 cajas — queda anulada
const CORREGIDA = 'NP-2026-021';  //  5 cajas — es la que vale
const MOTIVO   = 'Flexxus regeneró la nota de pedido con la cantidad corregida (10 → 5 cajas)';

async function main() {
  console.log(`\n=== NP-20970 en dos fichas — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);

  const sel = { id: true, code: true, flexxusCode: true, amount: true, currency: true, stage: true,
                clientId: true, anuladaAt: true, revisionDeId: true, linkedQuoteId: true,
                client: { select: { name: true } },
                items: { select: { description: true, quantity: true, total: true } } };
  const vieja    = await prisma.quote.findUnique({ where: { code: VIEJA },    select: sel });
  const corregida = await prisma.quote.findUnique({ where: { code: CORREGIDA }, select: sel });

  if (!vieja || !corregida) { console.log('⛔ No están las dos fichas. Nada que hacer.\n'); return; }

  // Re-verificar que siguen siendo el caso que analizamos
  const checks = [
    ['mismo número de Flexxus',   vieja.flexxusCode === corregida.flexxusCode, `${vieja.flexxusCode} / ${corregida.flexxusCode}`],
    ['mismo cliente',             vieja.clientId === corregida.clientId, vieja.client?.name],
    ['ninguna está ya anulada',   !vieja.anuladaAt && !corregida.anuladaAt],
    ['ninguna es ya revisión',    !vieja.revisionDeId && !corregida.revisionDeId],
    ['la vieja es la del importe mayor', Number(vieja.amount) > Number(corregida.amount), `${vieja.amount} > ${corregida.amount}`],
  ];
  let frenar = false;
  for (const [t, ok, extra] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${t}${extra ? '  — ' + extra : ''}`);
    if (!ok) frenar = true;
  }
  if (frenar) { console.log('\n⛔ Algo no coincide con lo analizado. No se toca nada.\n'); return; }

  console.log(`\n  ${vieja.code}  ${vieja.currency} ${vieja.amount}  (${vieja.stage})  → se ANULA`);
  vieja.items.forEach(i => console.log(`       ${i.quantity} x ${i.description}  = ${i.total}`));
  console.log(`  ${corregida.code}  ${corregida.currency} ${corregida.amount}  (${corregida.stage})  → queda como la vigente`);
  corregida.items.forEach(i => console.log(`       ${i.quantity} x ${i.description}  = ${i.total}`));
  console.log(`\n  deja de contarse de más: ${vieja.currency} ${Number(vieja.amount).toLocaleString('es-AR')}`);

  if (!APLICAR) { console.log('\n(simulacro — agregar --aplicar para ejecutar)\n'); return; }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `np-20970-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), vieja, corregida }, null, 2));
  console.log(`\n   💾 backup: ${path.relative(process.cwd(), file)}`);

  const r = await marcarComoRevision(corregida.id, vieja.id, { motivo: MOTIVO });
  console.log(`   ✅ ${corregida.code} quedó como revisión ${r?.revisionNro} de ${r?.reemplaza}`);

  const ctrl = await prisma.quote.findUnique({ where: { id: vieja.id }, select: { anuladaAt: true, anuladaMotivo: true } });
  console.log(`   ${ctrl.anuladaAt ? '✅' : '❌'} ${VIEJA} anulada: ${ctrl.anuladaAt ? ctrl.anuladaAt.toISOString().slice(0, 16) : 'NO'}`);
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
