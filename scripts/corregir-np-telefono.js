/**
 * Corrección de una sola vez: notas de pedido que quedaron con el TELÉFONO del
 * cliente como número de Flexxus.
 *
 * Causa: la regex que buscaba el número de nota de pedido en el PDF era
 * /^\d{4}-\d{7,}$/ y el teléfono del cliente tiene la misma pinta
 * ("0291-4598733"). Como aparece antes en el texto, ganaba el teléfono. Cinco
 * NP distintas de EDES S.A. quedaron todas con el código NP-4598733. El parser
 * ya está arreglado (ahora exige exactamente 8 dígitos); esto corrige lo que
 * quedó mal guardado.
 *
 * De dónde sale el número bueno: del asunto del mail, que siempre trae
 * "Nota de Pedido 0001-000NNNNN". Se verificó que las 8 son recuperables así.
 *
 * Antes de escribir cada una se re-verifica contra la base, y no se toca
 * ninguna cuyo asunto no tenga el número — mejor dejarla mal que inventarlo.
 *
 * Uso:
 *   railway run node scripts/corregir-np-telefono.js            # simulacro
 *   railway run node scripts/corregir-np-telefono.js --aplicar
 *
 * Se puede correr las veces que haga falta: si no queda ninguna mal, no hace nada.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');

// Formato bueno del código de nota de pedido de Flexxus
const BUENO = /^NP-2\d{4}$/;
// El número real, tal como viene en el asunto: "Nota de Pedido 0001-00021427"
const EN_ASUNTO = /0001-(\d{8})/;

async function main() {
  console.log(`\n=== NP con el teléfono como código — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);

  const todas = await prisma.quote.findMany({
    where:  { mailType: 'NOTA_PEDIDO', flexxusCode: { not: null } },
    select: { id: true, code: true, flexxusCode: true, emailSubject: true, amount: true,
              client: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const malas = todas.filter(q => !BUENO.test(q.flexxusCode));
  const aCorregir = [];
  const sinArreglo = [];

  for (const q of malas) {
    const hit = (q.emailSubject || '').match(EN_ASUNTO);
    if (!hit) { sinArreglo.push(q); continue; }
    const nuevo = `NP-${parseInt(hit[1], 10)}`;
    if (!BUENO.test(nuevo)) { sinArreglo.push(q); continue; }
    // Señal de que era el teléfono: el código viejo son los dígitos del teléfono del cliente
    const tel = (q.client?.phone || '').replace(/[^0-9]/g, '');
    const viejoNum = q.flexxusCode.replace(/[^0-9]/g, '');
    const eraTelefono = tel.includes(viejoNum);
    aCorregir.push({ ...q, nuevo, eraTelefono });
  }

  console.log(`notas de pedido con código                : ${todas.length}`);
  console.log(`  con formato inesperado                  : ${malas.length}`);
  console.log(`  recuperables desde el asunto            : ${aCorregir.length}`);
  console.log(`  sin forma de recuperarlas (no se tocan) : ${sinArreglo.length}\n`);

  for (const c of aCorregir) {
    console.log(`  ${c.code.padEnd(13)} ${c.flexxusCode.padEnd(15)} → ${c.nuevo.padEnd(10)} ${c.client?.name || ''}`);
    console.log(`      ${c.eraTelefono ? `era el teléfono del cliente (${c.client.phone})` : 'el código viejo no coincide con el teléfono — revisar'}`);
    console.log(`      asunto: "${(c.emailSubject || '').slice(0, 62)}"`);
  }
  sinArreglo.forEach(q => console.log(`  ⚠ ${q.code} (${q.flexxusCode}) — el asunto no trae el número, se deja como está`));

  // Avisar si dos quedan con el mismo número (legítimo, pero conviene saberlo)
  const porNuevo = new Map();
  for (const c of aCorregir) {
    if (!porNuevo.has(c.nuevo)) porNuevo.set(c.nuevo, []);
    porNuevo.get(c.nuevo).push(c);
  }
  for (const [nuevo, v] of porNuevo) {
    if (v.length > 1) {
      console.log(`\n  ℹ ${nuevo} queda en ${v.length} fichas: ${v.map(x => `${x.code} (${x.amount})`).join(', ')}`);
      console.log('     Son la misma nota de pedido con importes distintos — no las fusiona nadie, queda para revisar a mano.');
    }
  }

  if (!APLICAR) { console.log('\n(simulacro — agregar --aplicar para ejecutar)\n'); return; }
  if (!aCorregir.length) { console.log('\nNada que corregir.\n'); return; }

  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `np-telefono-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), cambios: aCorregir }, null, 2));
  console.log(`\n   💾 backup: ${path.relative(process.cwd(), file)}  (${aCorregir.length} fichas)`);

  for (const c of aCorregir) {
    // Re-verificar contra la base: pudo haber cambiado desde que se leyó
    const actual = await prisma.quote.findUnique({ where: { id: c.id }, select: { flexxusCode: true } });
    if (!actual || actual.flexxusCode !== c.flexxusCode) {
      console.log(`   ⏭️  ${c.code} cambió desde que se leyó — se saltea`);
      continue;
    }
    await prisma.quote.update({ where: { id: c.id }, data: { flexxusCode: c.nuevo } });
    await prisma.activity.create({
      data: {
        action:  'UPDATED',
        detail:  `Se corrigió el número de nota de pedido: ${c.flexxusCode} → ${c.nuevo}. El anterior era el teléfono del cliente, leído mal del PDF.`,
        quoteId: c.id,
      },
    });
    console.log(`   ✅ ${c.code}  ${c.flexxusCode} → ${c.nuevo}`);
  }

  const quedan = (await prisma.quote.findMany({
    where: { mailType: 'NOTA_PEDIDO', flexxusCode: { not: null } }, select: { flexxusCode: true },
  })).filter(q => !BUENO.test(q.flexxusCode)).length;
  console.log(`\n=== Estado final ===`);
  console.log(`notas de pedido con código raro: ${quedan}`);
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
