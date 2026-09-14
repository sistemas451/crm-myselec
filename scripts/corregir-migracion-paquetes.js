/**
 * Corrección de una sola vez: lo que la migración de paquetes del 13/09 hizo mal.
 *
 * Se revisaron los 125 paquetes que movió la migración comparando la etapa final
 * con la última decisión que tomó una PERSONA sobre cualquier documento del
 * paquete. En casi todos coincidió o era correcto. Estos 5 no:
 *
 *  1. EDEMSA (COT-2026-008): una nota de pedido de OTRO cliente (Lujanense,
 *     otros productos, anterior al presupuesto) quedó vinculada en julio. Diego
 *     ya había devuelto el presupuesto a "enviado" a mano el 23/07 y la migración
 *     lo volvió a pasar a "aceptada" por esa NP ajena.
 *  2. DISCUALCO (COT-2026-264) y 3. ELECNOR (COT-2026-311): sin nota de pedido.
 *     Victoria y Diego lo pasaron a aceptada y lo devolvieron enseguida; la
 *     solicitud quedó olvidada en "aceptada" y la migración usó ese resto como
 *     destino del paquete.
 *  4. NORRIS (SOL-2026-241 "herrajes") y 5. ILUBAIRES (SOL-2026-021
 *     "descargadores"): solicitudes que Santiago marcó "no cotiza", vinculadas
 *     por cliente a presupuestos de OTROS productos. "no_cotiza" no estaba en el
 *     orden de etapas de la migración y las arrastró a "enviado".
 *
 * Qué hace: corta los vínculos equivocados y devuelve cada documento a la etapa
 * que había decidido la persona, tomada del backup que la propia migración
 * guardó antes de mover nada. Verifica que todo siga como se analizó antes de
 * tocar: si algo cambió, saltea ese caso.
 *
 * Uso:
 *   railway run node scripts/corregir-migracion-paquetes.js            # simulacro
 *   railway run node scripts/corregir-migracion-paquetes.js --aplicar
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');
const BACKUP_MIGRACION = path.join(__dirname, '..', 'backups', 'paquetes-antes-2026-09-13T19-36-09.json');

// Cada caso: vínculos a cortar/reapuntar y etapa final de cada documento.
//   etapa 'backup'  → la que tenía antes de la migración (decisión de la persona)
//   etapa 'enviado' → alineada con su presupuesto (la solicitud estaba en un resto viejo)
const CASOS = [
  {
    nombre: 'EDEMSA — NP de otro cliente',
    esperado: { 'COT-2026-008': 'aceptada', 'SOL-2026-001': 'aceptada', 'NP-2026-051': 'aceptada' },
    vinculos: [['NP-2026-051', null]],
    etapas: { 'COT-2026-008': 'backup', 'SOL-2026-001': 'enviado' },
    backupDebeSer: { 'COT-2026-008': 'enviado' },
    motivo: 'La migración de paquetes la había pasado a aceptada por una nota de pedido de otro cliente (NP-2026-051, Lujanense). Se respeta la corrección manual de Diego del 23/07.',
  },
  {
    nombre: 'DISCUALCO — solicitud olvidada en aceptada',
    esperado: { 'COT-2026-264': 'aceptada', 'SOL-2026-227': 'aceptada' },
    vinculos: [],
    etapas: { 'COT-2026-264': 'backup', 'SOL-2026-227': 'enviado' },
    backupDebeSer: { 'COT-2026-264': 'enviado' },
    motivo: 'La migración de paquetes la había pasado a aceptada sin nota de pedido, siguiendo una solicitud que quedó en aceptada. Se respeta la corrección manual de Victoria del 24/08.',
  },
  {
    nombre: 'ELECNOR — solicitud olvidada en aceptada',
    esperado: { 'COT-2026-311': 'aceptada', 'SOL-2026-238': 'aceptada' },
    vinculos: [],
    etapas: { 'COT-2026-311': 'backup', 'SOL-2026-238': 'enviado' },
    backupDebeSer: { 'COT-2026-311': 'enviado' },
    motivo: 'La migración de paquetes la había pasado a aceptada sin nota de pedido, siguiendo una solicitud que quedó en aceptada. Se respeta la corrección manual de Diego del 15/08.',
  },
  {
    nombre: 'NORRIS — solicitud de herrajes pegada al presupuesto de raychem',
    esperado: { 'SOL-2026-241': 'enviado', 'COT-2026-535': 'enviado', 'SOL-2026-023': 'enviado' },
    vinculos: [['SOL-2026-241', null], ['COT-2026-535', 'SOL-2026-023']],
    etapas: { 'SOL-2026-241': 'backup' },
    backupDebeSer: { 'SOL-2026-241': 'no_cotiza' },
    motivo: 'Estaba vinculada por cliente a un presupuesto de otros productos (raychem) y la migración la había arrastrado a enviado. Santiago la había marcado "no cotiza" el 26/08.',
  },
  {
    nombre: 'ILUBAIRES — solicitud de descargadores pegada a un presupuesto de terminales',
    esperado: { 'SOL-2026-021': 'enviado', 'COT-2026-120': 'enviado' },
    vinculos: [['SOL-2026-021', null], ['COT-2026-120', null]],
    etapas: { 'SOL-2026-021': 'backup' },
    backupDebeSer: { 'SOL-2026-021': 'no_cotiza' },
    motivo: 'Estaba vinculada por cliente a un presupuesto de otros productos (terminales y empalmes) y la migración la había arrastrado a enviado. Santiago la había marcado "no cotiza" el 10/09.',
  },
];

async function main() {
  console.log(`\n=== Corrección de la migración de paquetes — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);
  const bk = JSON.parse(fs.readFileSync(BACKUP_MIGRACION, 'utf8'));
  const enBackup = code => bk.quotes.find(q => q.code === code);

  const todosLosCodigos = [...new Set(CASOS.flatMap(c => [...Object.keys(c.esperado), ...c.vinculos.flat().filter(Boolean)]))];
  const actuales = await prisma.quote.findMany({
    where: { code: { in: todosLosCodigos } },
    select: { id: true, code: true, stage: true, stageChangedAt: true, followUpDate: true, linkedQuoteId: true, anuladaAt: true },
  });
  const por = new Map(actuales.map(q => [q.code, q]));
  const idACodigo = new Map(actuales.map(q => [q.id, q.code]));

  const aplicables = [];
  for (const c of CASOS) {
    const problemas = [];
    for (const [code, etapa] of Object.entries(c.esperado)) {
      const q = por.get(code);
      if (!q) problemas.push(`${code} no existe`);
      else if (q.anuladaAt) problemas.push(`${code} está anulada`);
      else if (q.stage !== etapa) problemas.push(`${code} está en ${q.stage}, se esperaba ${etapa}`);
    }
    for (const [code, etapa] of Object.entries(c.backupDebeSer)) {
      if (enBackup(code)?.stage !== etapa) problemas.push(`en el backup ${code} figura en ${enBackup(code)?.stage}, se esperaba ${etapa}`);
    }
    console.log(`${problemas.length ? '⚠' : '•'} ${c.nombre}`);
    if (problemas.length) { problemas.forEach(p => console.log(`     se saltea: ${p}`)); continue; }

    for (const [code, destino] of c.vinculos) {
      const q = por.get(code);
      console.log(`     vínculo ${code}: ${idACodigo.get(q.linkedQuoteId) || '—'} → ${destino || '(sin vínculo)'}`);
    }
    for (const [code, modo] of Object.entries(c.etapas)) {
      const q = por.get(code);
      const final = modo === 'backup' ? enBackup(code).stage : modo;
      console.log(`     etapa   ${code}: ${q.stage} → ${final}`);
    }
    aplicables.push(c);
  }

  if (!APLICAR) { console.log(`\n${aplicables.length}/${CASOS.length} casos listos para aplicar.\n(simulacro — agregar --aplicar para ejecutar)\n`); return; }
  if (!aplicables.length) { console.log('\nNada que aplicar.\n'); return; }

  const dir = path.join(__dirname, '..', 'backups');
  const file = path.join(dir, `correccion-migracion-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), quotes: actuales }, null, 2));
  console.log(`\n   💾 backup: ${path.relative(process.cwd(), file)}  (${actuales.length} cotizaciones)`);

  for (const c of aplicables) {
    const ops = [];
    for (const [code, destino] of c.vinculos) {
      ops.push(prisma.quote.update({ where: { id: por.get(code).id }, data: { linkedQuoteId: destino ? por.get(destino).id : null } }));
    }
    for (const [code, modo] of Object.entries(c.etapas)) {
      const q = por.get(code);
      const b = enBackup(code);
      const data = modo === 'backup'
        ? { stage: b.stage, stageChangedAt: b.stageChangedAt ? new Date(b.stageChangedAt) : new Date(), followUpDate: b.followUpDate ? new Date(b.followUpDate) : null }
        : { stage: modo, stageChangedAt: new Date(), followUpDate: b?.followUpDate ? new Date(b.followUpDate) : null };
      ops.push(prisma.quote.update({ where: { id: q.id }, data }));
      ops.push(prisma.activity.create({ data: { action: 'STAGE_CHANGE', quoteId: q.id,
        detail: `Movida de ${q.stage} a ${data.stage} al corregir la migración de paquetes. ${c.motivo}` } }));
    }
    await prisma.$transaction(ops);
    console.log(`   ✅ ${c.nombre}`);
  }
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
