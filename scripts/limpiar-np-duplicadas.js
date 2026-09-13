/**
 * Limpieza de una sola vez: notas de pedido cargadas dos veces.
 *
 * Causa: el mismo PDF entró por dos caminos. Uno por el mail original y otro
 * por un reenvío ("Fwd:") que alguien mandó después. El dedupe por
 * emailMessageId no los agarra porque son mails distintos de verdad.
 *
 * Cada par se revisó a mano, por eso la lista es explícita y no una regla
 * automática: no quiero que una regla borre algo que no miré. El criterio
 * para elegir cuál se conserva, en orden:
 *   1. La que tiene el número de OC del cliente (dato que la otra no tiene).
 *   2. La que el presupuesto apunta (el vínculo es bidireccional con ella).
 *   3. La que NO es el reenvío.
 *
 * Antes de borrar cada una se re-verifica contra la base que siga siendo un
 * duplicado real y que nada dependa de ella. Si algo no cuadra, se saltea ese
 * par y sigue con el resto.
 *
 * Uso:
 *   railway run node scripts/limpiar-np-duplicadas.js             # simulacro
 *   railway run node scripts/limpiar-np-duplicadas.js --aplicar
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');

const PARES = [
  { fx:'NP-21038', conservar:'NP-2026-035', borrar:'NP-2026-037', motivo:'035 tiene el nro de OC del cliente y el presupuesto la apunta' },
  { fx:'NP-21083', conservar:'NP-2026-060', borrar:'NP-2026-061', motivo:'060 tiene el nro de OC del cliente y el presupuesto la apunta' },
  { fx:'NP-21090', conservar:'NP-2026-065', borrar:'NP-2026-010', motivo:'010 es el reenvio (Fwd:)' },
  { fx:'NP-21127', conservar:'NP-2026-076', borrar:'NP-2026-077', motivo:'077 es el reenvio (Fwd:)' },
  { fx:'NP-21135', conservar:'NP-2026-078', borrar:'NP-2026-079', motivo:'079 es el reenvio (Fwd:)' },
  { fx:'NP-21183', conservar:'NP-2026-088', borrar:'NP-2026-090', motivo:'090 es el reenvio (Fwd:)' },
  { fx:'NP-21240', conservar:'NP-2026-126', borrar:'NP-2026-153', motivo:'153 es el reenvio (Fwd:)' },
];

// NP-21419 (ARATIC) queda AFUERA a proposito: la segunda ficha dice
// "***modificada**", no es un duplicado sino una version corregida. Hay que
// decidir cual es la buena, o vincularlas como revision. No se toca.

async function main() {
  console.log(`\n=== NP duplicadas — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);

  const aBorrar = [];
  for (const p of PARES) {
    const keep = await prisma.quote.findUnique({ where: { code: p.conservar },
      select: { id:true, code:true, amount:true, currency:true, clientId:true, flexxusCode:true } });
    const del  = await prisma.quote.findUnique({ where: { code: p.borrar },
      select: { id:true, code:true, amount:true, currency:true, clientId:true, flexxusCode:true, stage:true } });

    if (!del)  { console.log(`  (${p.borrar} ya no existe — salteado)`); continue; }
    if (!keep) { console.log(`  ⚠ ${p.conservar} no existe — NO se borra ${p.borrar}`); continue; }

    // Re-verificar que sigue siendo el mismo documento
    const mismo = keep.flexxusCode === del.flexxusCode
               && keep.clientId === del.clientId
               && Number(keep.amount) === Number(del.amount);
    if (!mismo) { console.log(`  ⚠ ${p.borrar} ya no coincide con ${p.conservar} — se saltea`); continue; }

    // Re-verificar que nada dependa de la que se va
    const apuntan = await prisma.quote.count({ where: { linkedQuoteId: del.id } });
    const revs    = await prisma.quote.count({ where: { revisionDeId: del.id } });
    const ords    = await prisma.order.count({ where: { fromQuoteId: del.id } });
    if (apuntan || revs || ords) {
      console.log(`  ⚠ ${p.borrar} tiene dependencias (apuntan:${apuntan} rev:${revs} ord:${ords}) — se saltea`);
      continue;
    }

    console.log(`  ${p.fx.padEnd(11)} conservar ${p.conservar}  ·  borrar ${p.borrar} (${del.currency} ${del.amount ?? '—'}, ${del.stage})`);
    console.log(`      ${p.motivo}`);
    aBorrar.push(del);
  }

  const plata = aBorrar.filter(d => d.stage === 'aceptada')
    .reduce((s, d) => { const c = d.currency || 'USD'; s[c] = (s[c]||0) + Number(d.amount||0); return s; }, {});
  console.log(`\n  fichas a borrar: ${aBorrar.length}`);
  console.log(`  plata que deja de contarse doble:`,
    Object.entries(plata).map(([c,v]) => `${c} ${v.toLocaleString('es-AR',{maximumFractionDigits:0})}`).join(' · ') || 'nada');

  if (!APLICAR) { console.log('\n(simulacro — agregar --aplicar para ejecutar)\n'); return; }
  if (!aBorrar.length) { console.log('\nNada que borrar.\n'); return; }

  // Backup completo de lo que se va, con todo lo que cuelga
  const ids = aBorrar.map(d => d.id);
  const completo = await prisma.quote.findMany({
    where: { id: { in: ids } },
    include: { items: true, attachments: true, notes: true, activities: true },
  });
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `np-duplicadas-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), pares: PARES, quotes: completo }, null, 2));
  console.log(`\n   💾 backup: ${path.relative(process.cwd(), file)}  (${completo.length} fichas con sus items, adjuntos y actividad)`);

  const r = await prisma.quote.deleteMany({ where: { id: { in: ids } } });
  console.log(`   ✅ ${r.count} borradas`);

  console.log(`\n=== Estado final ===`);
  console.log('cotizaciones :', await prisma.quote.count());
  console.log('notas de pedido:', await prisma.quote.count({ where: { mailType: 'NOTA_PEDIDO' } }));
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
