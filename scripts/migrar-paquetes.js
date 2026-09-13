/**
 * Migración de una sola vez: el paquete pasa a ser una unidad real.
 *
 * Hasta ahora Solicitud, Presupuesto y Nota de Pedido se movían por separado, y
 * la Nota de Pedido vivía en Fase 2. Resultado: 81 pares en etapas distintas y
 * 99 negocios ganados que seguían figurando en "Presupuesto Enviado".
 *
 * Qué hace:
 *   1. Trae las Notas de Pedido a Fase 1 (etapa de entrada 'aceptada').
 *   2. Alinea cada paquete: todos sus documentos en la misma etapa. Si el
 *      paquete tiene Nota de Pedido, esa etapa es 'aceptada'.
 *
 * El paso 2 mueve solicitudes que hoy están en "Asignada" o "Armado" hacia la
 * etapa de su presupuesto. Diego pidió que sobre esas dos columnas se consulte
 * antes (reunión del 02/09, 29:40), así que por defecto NO las toca: hay que
 * pasarle --incluir-en-curso para que también las mueva.
 *
 * Uso:
 *   railway run node scripts/migrar-paquetes.js                       # simulacro
 *   railway run node scripts/migrar-paquetes.js --aplicar
 *   railway run node scripts/migrar-paquetes.js --aplicar --incluir-en-curso
 *
 * Correrlo DESPUÉS de desplegar el código. Es de una sola vez: una vez corrido
 * y verificado, se puede borrar el archivo.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');
const { agruparEnPaquetes, ORDEN } = require('../src/services/paquete');

/**
 * Antes de mover una sola etapa, se vuelca a disco el estado actual de todas las
 * cotizaciones. Este script cambia la etapa de casi 400 documentos y sin esto no
 * habría forma de reconstruir cómo estaban. El archivo queda en backups/ y sirve
 * para revertir a mano si algo sale mal.
 */
async function guardarBackup() {
  const filas = await prisma.quote.findMany({
    select: { id: true, code: true, mailType: true, stage: true, stageChangedAt: true,
              followUpDate: true, linkedQuoteId: true },
    orderBy: { code: 'asc' },
  });
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paquetes-antes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), total: filas.length, quotes: filas }, null, 2));
  console.log(`   💾 backup: ${path.relative(process.cwd(), file)}  (${filas.length} cotizaciones)`);
  return file;
}

const APLICAR    = process.argv.includes('--aplicar');
const EN_CURSO   = process.argv.includes('--incluir-en-curso');
const PROTEGIDAS = ['asignada', 'armado'];

async function main() {
  console.log(`\n=== Migración de paquetes — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);
  if (APLICAR) await guardarBackup();

  // ── 1. Las Notas de Pedido pasan a Fase 1 ────────────────────────────────
  const npFase2 = await prisma.quote.count({
    where: { mailType: 'NOTA_PEDIDO', stage: { notIn: ORDEN } },
  });
  console.log(`1. Notas de pedido en etapas de Fase 2: ${npFase2}`);
  if (APLICAR && npFase2) {
    const r = await prisma.quote.updateMany({
      where: { mailType: 'NOTA_PEDIDO', stage: { notIn: ORDEN } },
      data:  { stage: 'aceptada', stageChangedAt: new Date() },
    });
    console.log(`   ✅ ${r.count} movidas a "aceptada"`);
  }

  // La etapa de entrada de las NP que lleguen de acá en adelante
  const setting = await prisma.appSetting.findUnique({ where: { key: 'default_stage_nota_pedido' } });
  console.log(`   etapa de entrada configurada: ${setting?.value || '(sin setear)'}`);
  if (APLICAR && setting?.value !== 'aceptada') {
    await prisma.appSetting.upsert({
      where:  { key: 'default_stage_nota_pedido' },
      update: { value: 'aceptada' },
      create: { key: 'default_stage_nota_pedido', value: 'aceptada' },
    });
    console.log('   ✅ etapa de entrada → "aceptada"');
  }

  // ── 2. Alinear los paquetes ──────────────────────────────────────────────
  const quotes = await prisma.quote.findMany({
    where:  { OR: [{ mailType: null }, { mailType: { not: 'OC' } }] },
    select: { id: true, code: true, mailType: true, stage: true, amount: true, currency: true,
              linkedQuoteId: true, linkedBy: { select: { id: true } } },
  });
  const porId    = new Map(quotes.map(q => [q.id, q]));
  const paquetes = agruparEnPaquetes(quotes);

  // Un paquete por principal
  const grupos = new Map();
  for (const [quoteId, p] of paquetes) {
    if (!grupos.has(p.principal)) grupos.set(p.principal, []);
    grupos.get(p.principal).push(porId.get(quoteId));
  }

  let alineados = 0, aMover = 0, frenados = 0;
  const cambios = [];
  for (const [principalId, miembros] of grupos) {
    const tieneNP = miembros.some(m => m.mailType === 'NOTA_PEDIDO');
    const destino = tieneNP
      ? 'aceptada'
      : miembros.reduce((max, m) => (ORDEN.indexOf(m.stage) > ORDEN.indexOf(max) ? m.stage : max), miembros[0].stage);

    const desalineados = miembros.filter(m => m.stage !== destino);
    if (!desalineados.length) { alineados++; continue; }

    const tocaProtegida = desalineados.some(m => PROTEGIDAS.includes(m.stage));
    if (tocaProtegida && !EN_CURSO) {
      frenados++;
      continue;
    }
    aMover += desalineados.length;
    cambios.push({ destino, docs: desalineados });
  }

  console.log(`\n2. Paquetes: ${grupos.size}`);
  console.log(`   ya alineados                       : ${alineados}`);
  console.log(`   a alinear                          : ${cambios.length} paquetes (${aMover} documentos)`);
  console.log(`   frenados por tocar asignada/armado : ${frenados}${frenados && !EN_CURSO ? '  ← necesitan --incluir-en-curso' : ''}`);

  for (const c of cambios.slice(0, 8)) {
    console.log(`     → ${c.destino}: ${c.docs.map(d => `${d.code} (${d.stage})`).join(', ')}`);
  }
  if (cambios.length > 8) console.log(`     … y ${cambios.length - 8} más`);

  if (APLICAR && cambios.length) {
    for (const c of cambios) {
      for (const d of c.docs) {
        await prisma.quote.update({
          where: { id: d.id },
          data:  {
            stage: c.destino,
            stageChangedAt: new Date(),
            ...(c.destino === 'aceptada' || c.destino === 'rechazada' ? { followUpDate: null } : {}),
          },
        });
        await prisma.activity.create({
          data: { action: 'STAGE_CHANGE', detail: `Movida a ${c.destino} al unificar el paquete`, quoteId: d.id },
        });
      }
    }
    console.log(`   ✅ ${aMover} documentos alineados`);
  }

  // ── Estado final ─────────────────────────────────────────────────────────
  console.log('\n=== Estado final ===');
  const porEtapa = await prisma.quote.groupBy({
    by: ['stage'],
    where: { OR: [{ mailType: null }, { mailType: { not: 'OC' } }] },
    _count: true,
  });
  const orden = k => { const i = ORDEN.indexOf(k); return i === -1 ? 99 : i; };
  porEtapa.sort((a, b) => orden(a.stage) - orden(b.stage))
          .forEach(e => console.log(`   ${e.stage.padEnd(12)} ${e._count}`));
  if (!APLICAR) console.log('\n(simulacro — agregar --aplicar para ejecutar)');
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
