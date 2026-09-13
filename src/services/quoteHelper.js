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

module.exports = { autoAcceptPresupuesto };
