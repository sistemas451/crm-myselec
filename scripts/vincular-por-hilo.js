/**
 * Corrección de una sola vez: vincula los presupuestos con la solicitud a cuyo
 * mail responden.
 *
 * El vínculo por hilo de mail (In-Reply-To del presupuesto = Message-ID de la
 * solicitud) nunca funcionó: el Message-ID se guarda con los signos <…> y la
 * búsqueda usaba el In-Reply-To sin ellos, así que no coincidía jamás. Solo
 * andaba el plan B, que vincula por cliente, y cuando el cliente no estaba
 * cargado o tenía varias solicitudes abiertas quedaban dos tarjetas sueltas.
 * Medido el 14/09 en producción: 195 presupuestos respondían al mail de una
 * solicitud sin estar vinculados. El código ya está corregido; esto arregla lo
 * que quedó suelto hasta ahora.
 *
 * Vincula SOLO los casos limpios:
 *   - la solicitud tiene un único presupuesto vivo respondiendo a su mail
 *   - ni la solicitud ni el presupuesto tienen otro vínculo
 *   - son del mismo cliente, o a uno de los dos le falta
 *   - la solicitud no está en No cotiza, Rechazada ni Aceptada (son decisiones
 *     de una persona sobre esa solicitud)
 *   - la solicitud no está más avanzada que el presupuesto: al alinear el
 *     paquete solo se mueve la solicitud, nunca el presupuesto. Es la lección
 *     de la migración del 13/09, donde una solicitud vieja arrastró etapas.
 * De cada presupuesto vinculado se completa lo que esté vacío (cliente,
 * vendedor, semáforo) con lo de la solicitud; nunca se pisa un dato cargado.
 *
 * El resto lo lista con el motivo, para decidirlo a mano.
 *
 * Uso:
 *   railway run node scripts/vincular-por-hilo.js             # simulacro
 *   railway run node scripts/vincular-por-hilo.js --aplicar
 *
 * Correrlo DESPUÉS de desplegar el arreglo de mailReader.js. Es de una sola vez.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');
const { alinearPaquete, ORDEN } = require('../src/services/paquete');

const APLICAR = process.argv.includes('--aplicar');
const limpio = s => (s || '').replace(/[<>]/g, '').trim();
const CERRADAS_SOL = ['no_cotiza', 'rechazada', 'aceptada'];
// Casos que esperan una decisión y no se tocan aunque sean limpios
const NO_TOCAR = {
  'COT-2026-190': 'EDEMSA: Diego todavía tiene que confirmar si este presupuesto está aceptado',
};

async function guardarBackup(ids) {
  const filas = await prisma.quote.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, mailType: true, stage: true, stageChangedAt: true, followUpDate: true,
              linkedQuoteId: true, clientId: true, sellerId: true, priority: true },
    orderBy: { code: 'asc' },
  });
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `vincular-por-hilo-antes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tomadoEl: new Date().toISOString(), total: filas.length, quotes: filas }, null, 2));
  console.log(`   💾 backup: ${path.relative(process.cwd(), file)}  (${filas.length} cotizaciones)\n`);
}

async function main() {
  console.log(`\n=== Vincular por hilo de mail — ${APLICAR ? 'APLICANDO' : 'SIMULACRO (no cambia nada)'} ===\n`);

  const vivas = await prisma.quote.findMany({
    where: { anuladaAt: null },
    select: { id: true, code: true, mailType: true, stage: true, emailMessageId: true, inReplyTo: true,
              linkedQuoteId: true, clientId: true, sellerId: true, priority: true,
              client: { select: { name: true } }, linkedBy: { select: { id: true, code: true } } },
  });
  const porId = new Map(vivas.map(q => [q.id, q]));
  const solPorMensaje = new Map(
    vivas.filter(q => q.mailType === 'SOLICITUD' && q.emailMessageId).map(q => [limpio(q.emailMessageId), q])
  );

  // Presupuestos que responden al mail de una solicitud, agrupados por solicitud
  const porSolicitud = new Map();
  for (const p of vivas) {
    if (p.mailType !== 'PRESUPUESTO' || !p.inReplyTo) continue;
    const sol = solPorMensaje.get(limpio(p.inReplyTo));
    if (!sol) continue;
    if (!porSolicitud.has(sol.id)) porSolicitud.set(sol.id, []);
    porSolicitud.get(sol.id).push(p);
  }

  const vinculado = (a, b) => a.linkedQuoteId === b.id || b.linkedQuoteId === a.id
    || a.linkedBy.some(l => l.id === b.id) || b.linkedBy.some(l => l.id === a.id);
  const otroVinculo = q => {
    const ids = new Set([q.linkedQuoteId, ...q.linkedBy.map(l => l.id)].filter(Boolean));
    return [...ids].map(id => porId.get(id)?.code || '(anulada)');
  };

  const limpios = [], aMano = [];
  let yaEstaban = 0;
  for (const [solId, pres] of porSolicitud) {
    const sol = porId.get(solId);
    const pendientes = pres.filter(p => !vinculado(p, sol));
    yaEstaban += pres.length - pendientes.length;
    if (!pendientes.length) continue;

    const par = p => `${p.code}(${p.stage}) → ${sol.code}(${sol.stage}) · ${sol.client?.name || p.client?.name || 'sin cliente'}`;
    if (pres.length > 1) {
      pendientes.forEach(p => aMano.push({ par: par(p), motivo: `la solicitud tiene ${pres.length} presupuestos respondiendo a su mail: ${pres.map(x => x.code).join(', ')}` }));
      continue;
    }
    const p = pendientes[0];
    const motivos = [];
    if (NO_TOCAR[p.code] || NO_TOCAR[sol.code]) motivos.push(NO_TOCAR[p.code] || NO_TOCAR[sol.code]);
    const vs = otroVinculo(sol);
    // Que el presupuesto ya tenga sus notas de pedido no es conflicto: la
    // solicitud se suma a ese paquete. Sí lo es que tenga otra solicitud.
    const vp = otroVinculo(p).filter(code => !/^NP-/.test(code));
    if (vs.length) motivos.push(`la solicitud ya está vinculada a ${vs.join(', ')}`);
    if (vp.length) motivos.push(`el presupuesto ya está vinculado a ${vp.join(', ')}`);
    if (p.clientId && sol.clientId && p.clientId !== sol.clientId) motivos.push(`clientes distintos (${p.client?.name} / ${sol.client?.name})`);
    // Etapas: la solicitud nunca puede estar más avanzada, y si está cerrada
    // (no cotiza, rechazada, aceptada) solo se acepta si coincide con el presupuesto.
    if (CERRADAS_SOL.includes(sol.stage) && sol.stage !== p.stage) motivos.push(`la solicitud está en ${sol.stage} y el presupuesto en ${p.stage}`);
    else if (ORDEN.indexOf(sol.stage) > ORDEN.indexOf(p.stage)) motivos.push(`la solicitud (${sol.stage}) está más avanzada que el presupuesto (${p.stage})`);
    if (motivos.length) aMano.push({ par: par(p), motivo: motivos.join(' · ') });
    else limpios.push({ sol, p });
  }

  const moveria = limpios.filter(({ sol, p }) => sol.stage !== p.stage).length;
  console.log(`Presupuestos que responden al mail de una solicitud: ${[...porSolicitud.values()].flat().length}`);
  console.log(`   ya vinculados:        ${yaEstaban}`);
  console.log(`   para vincular:        ${limpios.length}  (en ${moveria} la solicitud sube a la etapa del presupuesto)`);
  console.log(`   para decidir a mano:  ${aMano.length}\n`);

  const cambios = [];
  for (const { sol, p } of limpios) {
    const data = {};
    if (!p.clientId && sol.clientId) data.clientId = sol.clientId;
    if (!p.sellerId && sol.sellerId) data.sellerId = sol.sellerId;
    if (!p.priority && sol.priority) data.priority = sol.priority;
    const extra = Object.keys(data).map(k => ({ clientId: 'cliente', sellerId: 'vendedor', priority: 'semáforo' }[k]));
    cambios.push({ sol, p, data });
    console.log(`   ✓ ${p.code}(${p.stage}) ↔ ${sol.code}(${sol.stage}) · ${sol.client?.name || p.client?.name || 'sin cliente'}${extra.length ? `  [completa: ${extra.join(', ')}]` : ''}`);
  }
  if (aMano.length) {
    console.log('\nPara decidir a mano:');
    aMano.forEach(x => console.log(`   • ${x.par}\n       ${x.motivo}`));
  }

  if (!APLICAR) {
    console.log('\nSimulacro: no se cambió nada. Para aplicar: --aplicar\n');
    return;
  }
  if (!cambios.length) { console.log('\nNada para vincular.\n'); return; }

  await guardarBackup(cambios.flatMap(({ sol, p }) => [sol.id, p.id]));
  let hechos = 0, movidas = 0;
  for (const { sol, p, data } of cambios) {
    const detalle = otro => `Vinculada con ${otro.code} (${otro.mailType}) · por hilo de mail (corrección del ${new Date().toLocaleDateString('es-AR')})`;
    // Si el presupuesto ya apunta a su nota de pedido, ese vínculo no se pisa:
    // alcanza con que la solicitud apunte al presupuesto (el paquete se arma
    // con vínculos de cualquiera de los dos lados).
    const actual = await prisma.quote.findUnique({ where: { id: p.id }, select: { linkedQuoteId: true } });
    await prisma.$transaction([
      prisma.quote.update({ where: { id: p.id },   data: { ...(actual.linkedQuoteId ? {} : { linkedQuoteId: sol.id }), ...data } }),
      prisma.quote.update({ where: { id: sol.id }, data: { linkedQuoteId: p.id } }),
      prisma.activity.createMany({ data: [
        { action: 'LINKED', detail: detalle(sol), quoteId: p.id },
        { action: 'LINKED', detail: detalle(p),   quoteId: sol.id },
      ] }),
    ]);
    const al = await alinearPaquete(p.id);
    if (al) movidas += al.movidos.length;
    hechos++;
  }
  console.log(`\n✅ ${hechos} vinculados · ${movidas} documentos movidos al alinear\n`);
}

main()
  .catch(e => { console.error('ERROR:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
