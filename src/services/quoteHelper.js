const { alinearPaquete } = require('./paquete');

/**
 * Se llama cuando una Nota de Pedido queda vinculada a un presupuesto.
 *
 * Antes esta función movía el presupuesto a 'aceptada' y arrastraba a la
 * solicitud, con su propia lógica. Ahora delega en el paquete, que es el que
 * sabe quiénes son los miembros (mirando el vínculo en los dos sentidos) y los
 * deja a todos en la misma etapa. Si hay Nota de Pedido, esa etapa es 'aceptada'.
 *
 * Se mantiene el nombre porque la llaman cuatro lugares distintos: la carga
 * manual de NP, la subida de PDF a una orden, el ingreso por mail y el vínculo
 * manual desde la ficha.
 */
async function autoAcceptPresupuesto(presupuestoId) {
  const r = await alinearPaquete(presupuestoId);
  if (r) console.log(`   ✅ paquete alineado a "${r.destino}": ${r.movidos.join(', ')}`);
}

/**
 * El presupuesto del que sale una Nota de Pedido, por el número que trae su PDF
 * (`presupuestoNP` y, si el comentario dice otro, `presupuestoNPAlt`; ver
 * parseNotaPedidoPDF). Número exacto con o sin "PR-", nunca "contiene" (18850 no
 * tiene que encontrar a 188501), y solo presupuestos: las solicitudes pueden
 * tener el mismo número copiado. Sin número devuelve null — no se adivina
 * (MYS-0021). La usan el ingreso por mail y las dos cargas manuales de NP.
 */
async function buscarPresupuestoDeNP(prisma, npData, select) {
  for (const pr of [npData?.presupuestoNP, npData?.presupuestoNPAlt].filter(Boolean)) {
    const num = pr.replace('PR-', '');
    const p = await prisma.quote.findFirst({
      where: { mailType: 'PRESUPUESTO', OR: [{ flexxusCode: pr }, { flexxusCode: num }, { flexxusCode: { endsWith: ` ${num}` } }] },
      ...(select ? { select } : {}),
    });
    if (p) return p;
  }
  return null;
}

module.exports = { autoAcceptPresupuesto, buscarPresupuestoDeNP };
