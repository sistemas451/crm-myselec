/**
 * Migración de una sola vez: encadena las recotizaciones históricas.
 *
 * Flexxus reusa el mismo número de presupuesto cuando el cliente pide
 * recotizar. Hasta que se agregó la detección automática, cada recotización
 * entraba como una cotización nueva e independiente: el mismo negocio quedaba
 * contado dos o tres veces en "Presupuesto Enviado".
 *
 * Esto las encadena hacia atrás con la misma maquinaria que usa la detección
 * automática (marcarComoRevision): la última queda vigente y las anteriores se
 * anulan — siguen consultables, pero salen del tablero y de los totales.
 *
 * NO tiene lista escrita a mano: descubre los grupos solo, con la regla, cada
 * vez que corre.
 *
 * Qué se saltea, y por qué importa:
 *   · Grupos donde todas las fichas tienen el mismo importe: eso no es una
 *     recotización sino el mismo presupuesto entrado dos veces. Otro problema.
 *   · Grupos ya encadenados (alguna tiene revisionDeId o anuladaAt).
 *   · Grupos donde una ficha PREVIA tiene nota de pedido: esa se ganó de
 *     verdad. Anularla sería borrar una venta. Son 2 casos reales (EDEA
 *     PR-18652, donde las dos tienen NP; y EDELAP PR-19072, donde la ganada es
 *     justamente la previa).
 *   · Por defecto también saltea los grupos con una previa en "aceptada": esas
 *     no tocan el pipeline sino el MONTO GANADO, que es otra conversación.
 *     Con --incluir-aceptadas se encadenan también.
 *
 * Uso:
 *   railway run node scripts/encadenar-recotizaciones.js                        # simulacro
 *   railway run node scripts/encadenar-recotizaciones.js --aplicar
 *   railway run node scripts/encadenar-recotizaciones.js --aplicar --incluir-aceptadas
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');
const { marcarComoRevision } = require('../src/services/paquete');

const APLICAR   = process.argv.includes('--aplicar');
const ACEPTADAS = process.argv.includes('--incluir-aceptadas');
const MOTIVO    = 'Recotización histórica: el mismo presupuesto de Flexxus volvió a entrar con otro importe';

// Grupos que no se tocan aunque cumplan la regla, con el motivo a la vista.
// Se saltean SIEMPRE, incluso con --incluir-aceptadas.
const NO_TOCAR = {
  'PR-18742': 'EDEMSA: la previa la aceptó una persona a mano — lo decide el negocio, no un script',
};

async function main() {
  console.log(`\n=== Recotizaciones históricas — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===`);
  console.log(`    previas en "aceptada": ${ACEPTADAS ? 'SE INCLUYEN' : 'se saltean (--incluir-aceptadas para tomarlas)'}\n`);

  const pres = await prisma.quote.findMany({
    where:  { mailType: 'PRESUPUESTO', flexxusCode: { not: null } },
    select: { id: true, code: true, flexxusCode: true, amount: true, currency: true, stage: true,
              createdAt: true, anuladaAt: true, revisionDeId: true, linkedQuoteId: true,
              client: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // ¿Tiene nota de pedido? El vínculo puede estar de cualquiera de los dos lados.
  const nps = await prisma.quote.findMany({
    where:  { mailType: 'NOTA_PEDIDO' },
    select: { id: true, linkedQuoteId: true },
  });
  const apuntadosPorNP = new Set(nps.map(n => n.linkedQuoteId).filter(Boolean));
  const idsNP = new Set(nps.map(n => n.id));
  const tieneNP = p => apuntadosPorNP.has(p.id) || (p.linkedQuoteId && idsNP.has(p.linkedQuoteId));

  const grupos = new Map();
  for (const p of pres) {
    if (!grupos.has(p.flexxusCode)) grupos.set(p.flexxusCode, []);
    grupos.get(p.flexxusCode).push(p);
  }

  const aEncadenar = [], salteados = [];
  for (const [fx, v] of grupos) {
    if (v.length < 2) continue;
    if (NO_TOCAR[fx]) { salteados.push([fx, v, NO_TOCAR[fx]]); continue; }
    if (v.every(x => Number(x.amount) === Number(v[0].amount))) { salteados.push([fx, v, 'mismo importe: es un duplicado, no una recotización']); continue; }
    if (v.some(x => x.revisionDeId || x.anuladaAt))            { salteados.push([fx, v, 'ya encadenado']); continue; }

    const orden   = v.slice().sort((a, b) => a.createdAt - b.createdAt);
    const previas = orden.slice(0, -1);
    if (previas.some(tieneNP))                                  { salteados.push([fx, orden, '⚠ una previa TIENE nota de pedido — se ganó de verdad']); continue; }
    if (!ACEPTADAS && previas.some(x => x.stage === 'aceptada')) { salteados.push([fx, orden, 'una previa está en "aceptada" (toca el monto ganado)']); continue; }
    aEncadenar.push([fx, orden]);
  }

  const fmt = n => n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const plataDe = etapa => aEncadenar.reduce((s, [, v]) =>
    s + v.slice(0, -1).filter(x => x.stage === etapa).reduce((t, x) => t + Number(x.amount || 0), 0), 0);

  console.log(`grupos a encadenar : ${aEncadenar.length}   (${aEncadenar.reduce((s, [, v]) => s + v.length - 1, 0)} cotizaciones se anulan)`);
  console.log(`grupos salteados   : ${salteados.length}\n`);

  for (const [fx, v] of aEncadenar) {
    console.log(`  ${fx.padEnd(10)} ${String(v[0].client?.name).slice(0, 34)}`);
    v.forEach((x, i) => console.log(`     ${x.code.padEnd(13)} ${x.currency} ${String(x.amount).padEnd(11)} ${x.stage.padEnd(9)} ${x.createdAt.toISOString().slice(0, 10)} ${i === v.length - 1 ? '← queda vigente' : '→ se anula'}`));
  }

  console.log(`\n  sale del pipeline ("enviado") : USD ${fmt(plataDe('enviado'))}`);
  const gan = plataDe('aceptada');
  if (gan) console.log(`  sale del monto GANADO         : USD ${fmt(gan)}  ← revisar bien esto`);

  if (salteados.length) {
    console.log('\n  Salteados:');
    salteados.forEach(([fx, v, por]) => console.log(`     ${fx.padEnd(10)} ${String(v[0].client?.name).slice(0, 30).padEnd(32)} ${por}`));
  }

  if (!APLICAR) { console.log('\n(simulacro — agregar --aplicar para ejecutar)\n'); return; }
  if (!aEncadenar.length) { console.log('Nada que encadenar.\n'); return; }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `recotizaciones-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), grupos: aEncadenar }, null, 2));
  console.log(`\n   💾 backup: ${path.relative(process.cwd(), file)}  (${aEncadenar.length} grupos)`);

  console.log('\nAplicando:');
  for (const [fx, v] of aEncadenar) {
    // De la más vieja a la más nueva, de a pares: 1→2, 2→3, …
    for (let i = 1; i < v.length; i++) {
      const anterior = v[i - 1], nuevo = v[i];
      const actual = await prisma.quote.findUnique({ where: { id: anterior.id }, select: { anuladaAt: true } });
      if (actual?.anuladaAt) { console.log(`   ⏭️  ${anterior.code} ya estaba anulada — se saltea`); continue; }
      const r = await marcarComoRevision(nuevo.id, anterior.id, { motivo: MOTIVO });
      console.log(`   ✅ ${fx.padEnd(10)} ${nuevo.code} = revisión ${r?.revisionNro} de ${r?.reemplaza}`);
    }
  }

  console.log(`\n=== Estado final ===`);
  console.log('presupuestos anulados en total:', await prisma.quote.count({ where: { mailType: 'PRESUPUESTO', anuladaAt: { not: null } } }));
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
