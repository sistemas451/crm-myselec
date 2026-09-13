/**
 * Migración de una sola vez: unifica los clientes duplicados (MYS-0020).
 *
 * Contexto: el importador de Flexxus matcheaba solo por código. Un cliente
 * cargado a mano queda con código CLI-NNN, así que cuando Flexxus lo traía con
 * su código numérico real no lo reconocía y creaba una segunda ficha. El
 * historial del cliente quedaba partido entre las dos. El código que causaba
 * esto ya está arreglado; esto limpia lo que quedó en la base.
 *
 * NO tiene una lista escrita a mano a propósito: descubre los pares solo, con
 * la misma regla, cada vez que se corre. Una lista fija se desactualiza —
 * mientras se armaba esta migración aparecieron dos pares nuevos.
 *
 * Regla:
 *   · Se agrupan los clientes por CUIT normalizado (solo dígitos).
 *   · Se ignoran los CUIT basura ("-  -", vacíos): 67 clientes los tienen y
 *     todos normalizarían al mismo valor.
 *   · Solo se tocan los grupos donde hay al menos un cliente manual (CLI-),
 *     que son los que causó el CRM. Los grupos de puro código Flexxus son
 *     duplicados que ya venían en la planilla de origen (depósitos de Myselec
 *     con el mismo CUIT, nombres dados vuelta) — no se tocan.
 *   · Se conserva la ficha con más historial. Si empatan, la que tiene código
 *     real de Flexxus. Si las dos son manuales, la más vieja.
 *   · Si la que se conserva es manual y la otra tiene código de Flexxus, se le
 *     pisa el código con el de Flexxus: así los próximos imports la encuentran.
 *   · Se le mueven las cotizaciones, órdenes y mails de la otra, se le rellenan
 *     los campos vacíos, y la otra se borra.
 *
 * Uso:
 *   railway run node scripts/migrar-clientes-duplicados.js            # simulacro
 *   railway run node scripts/migrar-clientes-duplicados.js --aplicar
 *
 * Se puede correr las veces que haga falta: si ya no hay duplicados, no hace
 * nada. Correrlo DESPUÉS de desplegar el código.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const APLICAR = process.argv.includes('--aplicar');

function normCuit(cuit) {
  const d = cuit ? String(cuit).replace(/[^0-9]/g, '') : '';
  return d.length >= 10 ? d : null;
}

async function guardarBackup(ids) {
  const clientes = await prisma.client.findMany({
    where: { id: { in: ids } },
    include: { quotes: { select: { id: true, code: true } },
               orders: { select: { id: true, code: true } },
               emails: true },
  });
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `clientes-duplicados-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), clientes }, null, 2));
  console.log(`   💾 backup: ${path.relative(process.cwd(), file)}  (${clientes.length} clientes)`);
}

async function main() {
  console.log(`\n=== Clientes duplicados — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);

  const clientes = await prisma.client.findMany({
    select: { id: true, code: true, name: true, cuit: true, createdAt: true,
              address: true, city: true, province: true, zone: true, postalCode: true,
              phone: true, email: true, emailDomain: true, activity: true,
              defaultSellerId: true, legacySellerName: true,
              _count: { select: { quotes: true, orders: true } } },
  });

  // Agrupar por CUIT normalizado
  const grupos = new Map();
  for (const c of clientes) {
    const k = normCuit(c.cuit);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }

  const pares = [];
  let sinManual = 0, multiples = 0;
  for (const [cuit, g] of grupos) {
    if (g.length < 2) continue;
    if (!g.some(c => c.code.startsWith('CLI-'))) { sinManual++; continue; }
    if (g.length > 2) { multiples++; console.log(`⚠️  CUIT ${cuit} con ${g.length} fichas — se saltea, revisar a mano:`);
                        g.forEach(c => console.log(`      ${c.code} "${c.name}" (${c._count.quotes} cot / ${c._count.orders} ord)`)); continue; }

    const act = c => c._count.quotes + c._count.orders;
    const esFlexxus = c => !c.code.startsWith('CLI-');
    const [a, b] = g;
    let mantener, eliminar;
    if (act(a) !== act(b))            [mantener, eliminar] = act(a) > act(b) ? [a, b] : [b, a];
    else if (esFlexxus(a) !== esFlexxus(b)) [mantener, eliminar] = esFlexxus(a) ? [a, b] : [b, a];
    else                              [mantener, eliminar] = a.createdAt <= b.createdAt ? [a, b] : [b, a];

    // Si nos quedamos con la manual y la otra tiene código real, adoptamos ese código
    const nuevoCode = (!esFlexxus(mantener) && esFlexxus(eliminar)) ? eliminar.code : null;
    pares.push({ mantener, eliminar, nuevoCode });
  }

  console.log(`grupos de CUIT repetido          : ${[...grupos.values()].filter(g => g.length > 1).length}`);
  console.log(`  sin ninguna ficha manual (se dejan): ${sinManual}`);
  console.log(`  con más de dos fichas (se dejan)   : ${multiples}`);
  console.log(`  a unificar                         : ${pares.length}\n`);

  for (const p of pares) {
    const flecha = p.nuevoCode ? `  →  pasa a ser ${p.nuevoCode}` : '';
    console.log(`  conservar ${p.mantener.code.padEnd(9)} "${p.mantener.name}" (${p.mantener._count.quotes} cot / ${p.mantener._count.orders} ord)${flecha}`);
    console.log(`     absorbe ${p.eliminar.code.padEnd(9)} "${p.eliminar.name}" (${p.eliminar._count.quotes} cot / ${p.eliminar._count.orders} ord)`);
  }

  if (!APLICAR) { console.log('\n(simulacro — agregar --aplicar para ejecutar)\n'); return; }
  if (!pares.length) { console.log('Nada que hacer.\n'); return; }

  await guardarBackup(pares.flatMap(p => [p.mantener.id, p.eliminar.id]));

  console.log('\nAplicando:');
  for (const { mantener, eliminar, nuevoCode } of pares) {
    // Los mails se leen antes: al borrar la ficha se van en cascada.
    const mails = await prisma.clientEmail.findMany({ where: { clientId: eliminar.id }, select: { email: true } });

    await prisma.$transaction([
      prisma.quote.updateMany({ where: { clientId: eliminar.id }, data: { clientId: mantener.id } }),
      prisma.order.updateMany({ where: { clientId: eliminar.id }, data: { clientId: mantener.id } }),
      prisma.client.delete({ where: { id: eliminar.id } }),
      prisma.client.update({
        where: { id: mantener.id },
        data: {
          ...(nuevoCode ? { code: nuevoCode, name: eliminar.name } : {}),
          address:         mantener.address         || eliminar.address,
          city:            mantener.city            || eliminar.city,
          province:        mantener.province        || eliminar.province,
          zone:            mantener.zone            || eliminar.zone,
          postalCode:      mantener.postalCode      || eliminar.postalCode,
          phone:           mantener.phone           || eliminar.phone,
          email:           mantener.email           || eliminar.email,
          emailDomain:     mantener.emailDomain     || eliminar.emailDomain,
          activity:        mantener.activity        || eliminar.activity,
          defaultSellerId: mantener.defaultSellerId || eliminar.defaultSellerId,
          legacySellerName: mantener.legacySellerName || eliminar.legacySellerName,
        },
      }),
    ]);

    for (const { email } of [...mails, ...(eliminar.email ? [{ email: eliminar.email }] : [])]) {
      await prisma.clientEmail.upsert({
        where:  { email_clientId: { email, clientId: mantener.id } },
        update: {},
        create: { email, clientId: mantener.id, isPrimary: false },
      }).catch(() => {});
    }

    console.log(`   ✅ ${eliminar.code} → ${nuevoCode || mantener.code}`);
  }

  console.log(`\n=== Estado final ===`);
  console.log('clientes totales:', await prisma.client.count());
  console.log('manuales (CLI-) :', await prisma.client.count({ where: { code: { startsWith: 'CLI-' } } }));
  console.log('');
}

main()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
