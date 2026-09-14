/**
 * El paquete: Solicitud → Presupuesto → Nota de Pedido.
 *
 * Hasta ahora el paquete era solo dibujo — el tablero juntaba las tarjetas pero
 * cada documento se movía por su cuenta, así que terminaban en etapas distintas
 * (81 pares desalineados al momento de escribir esto). Acá vive la lógica que lo
 * hace real: quiénes son los miembros, y moverlos juntos.
 *
 * El vínculo se guarda en `Quote.linkedQuoteId`, pero NO siempre del mismo lado:
 * mailReader solo escribe el puntero en el presupuesto si estaba vacío, así que
 * cuando el presupuesto ya apuntaba a su solicitud, el enlace con la nota de
 * pedido queda únicamente del lado de la NP. Por eso hay que recorrer el vínculo
 * en los dos sentidos siempre. Mirar uno solo da resultados incompletos.
 */
const prisma = require('../db');

const CAMPOS = {
  id: true, code: true, mailType: true, stage: true, amount: true, currency: true,
  sellerId: true, clientId: true, flexxusCode: true, linkedQuoteId: true,
  linkedBy: { select: { id: true } },
};

// Tope de seguridad. Un paquete típico son 2 o 3 documentos, pero un cliente
// puede pedir por tandas contra la misma cotización: hay paquetes reales de 14
// (una solicitud, un presupuesto y varias notas de pedido). El tope está para
// que una cadena de vínculos mal armada no recorra media base, no para limitar
// el caso normal.
const MAX_MIEMBROS = 25;

/**
 * Devuelve todos los documentos conectados a este, siguiendo los vínculos en
 * ambos sentidos, y clasificados por tipo.
 */
async function miembrosDelPaquete(quoteId, client = prisma) {
  const vistos = new Map();
  // Se recorre por niveles y cada nivel va en UNA sola consulta. Antes se pedía
  // un documento por vez: en un paquete de 15 eso eran 15 viajes a la base y
  // mover la tarjeta tardaba 4 segundos. Por niveles son 2 o 3 viajes.
  let nivel = [quoteId];

  while (nivel.length && vistos.size < MAX_MIEMBROS) {
    const pedir = nivel.filter(id => id && !vistos.has(id));
    if (!pedir.length) break;

    const docs = await client.quote.findMany({ where: { id: { in: pedir } }, select: CAMPOS });
    const siguiente = [];
    for (const q of docs) {
      vistos.set(q.id, q);
      if (q.linkedQuoteId) siguiente.push(q.linkedQuoteId);
      for (const lb of q.linkedBy || []) siguiente.push(lb.id);
    }
    nivel = [...new Set(siguiente)].filter(id => !vistos.has(id));
  }

  const todos = [...vistos.values()];
  return {
    todos,
    solicitud:   todos.find(q => q.mailType === 'SOLICITUD')   || null,
    presupuesto: todos.find(q => q.mailType === 'PRESUPUESTO') || null,
    notaPedido:  todos.find(q => q.mailType === 'NOTA_PEDIDO') || null,
  };
}

/**
 * Los datos que cambian al mover a una etapa. Los mismos para todos los miembros:
 * si el paquete se mueve, se mueve entero y con el mismo estado.
 */
async function datosDeEtapa(stage, { rejectReason, rejectNotes } = {}) {
  const data = { stage, stageChangedAt: new Date() };

  if (stage === 'rechazada' && rejectReason) {
    data.rejectReason = rejectReason;
    data.rejectNotes  = rejectNotes || null;
  }
  // Al cerrarse ya no hay nada que seguir
  if (stage === 'aceptada' || stage === 'rechazada') {
    data.followUpDate = null;
  }
  if (stage === 'enviado') {
    const s = await prisma.appSetting.findUnique({ where: { key: 'follow_up_days' } });
    const dias = Math.max(1, parseInt(s?.value || '4'));
    const d = new Date();
    d.setDate(d.getDate() + dias);
    data.followUpDate = d;
  }
  return data;
}

/**
 * Mueve al resto del paquete a la misma etapa que `origen`.
 * Devuelve los códigos que efectivamente se movieron.
 */
async function moverResto(origen, stage, { userId = null, rejectReason, rejectNotes } = {}) {
  const { todos } = await miembrosDelPaquete(origen.id);
  const resto = todos.filter(q => q.id !== origen.id && q.stage !== stage);
  if (!resto.length) return [];

  const data = await datosDeEtapa(stage, { rejectReason, rejectNotes });

  await prisma.$transaction([
    prisma.quote.updateMany({ where: { id: { in: resto.map(q => q.id) } }, data }),
    prisma.activity.createMany({
      data: resto.map(q => ({
        action: 'STAGE_CHANGE',
        detail: `Movió ${q.code} a ${stage} junto con ${origen.code} (paquete)`,
        userId,
        quoteId: q.id,
      })),
    }),
  ]);
  return resto.map(q => q.code);
}

/**
 * Al vincular dos documentos, el paquete queda en una sola etapa: la del
 * documento más avanzado. Es lo que evita que se vuelvan a separar.
 *
 * El orden lo da el pipeline, con una excepción: si hay Nota de Pedido, el
 * paquete está aceptado — entró el pedido, no hay nada que discutir.
 */
const ORDEN = ['recibida', 'asignada', 'armado', 'proveedor', 'oferta', 'enviado', 'aceptada', 'rechazada'];

async function alinearPaquete(quoteId, { userId = null } = {}) {
  const { todos, notaPedido } = await miembrosDelPaquete(quoteId);
  if (todos.length < 2) return null;

  // "No cotiza" es una decisión que tomó una persona sobre ESA solicitud, y el
  // paquete no la pisa. Antes no figuraba en ORDEN, así que contaba como la etapa
  // más baja y cualquier alineación la sacaba de ahí: la migración del 13/09
  // arrastró a "enviado" dos solicitudes que Santiago había marcado no cotiza.
  // Si una no_cotiza queda en un paquete, casi siempre es un vínculo equivocado,
  // y es mejor que se vea desalineado a que se mueva sola.
  const movibles = todos.filter(q => q.stage !== 'no_cotiza');
  if (movibles.length < 2) return null;

  let destino;
  if (notaPedido) {
    destino = 'aceptada';
  } else {
    destino = movibles.reduce((masAvanzado, q) => {
      const i = ORDEN.indexOf(q.stage);
      const j = ORDEN.indexOf(masAvanzado);
      return i > j ? q.stage : masAvanzado;
    }, movibles[0].stage);
  }

  const aMover = movibles.filter(q => q.stage !== destino);
  if (!aMover.length) return null;

  const data = await datosDeEtapa(destino);
  await prisma.$transaction([
    prisma.quote.updateMany({ where: { id: { in: aMover.map(q => q.id) } }, data }),
    prisma.activity.createMany({
      data: aMover.map(q => ({
        action: 'STAGE_CHANGE',
        detail: `Movió ${q.code} a ${destino} al armarse el paquete`,
        userId,
        quoteId: q.id,
      })),
    }),
  ]);
  return { destino, movidos: aMover.map(q => q.code) };
}


/**
 * Agrupa una lista ya traída de cotizaciones en paquetes: las componentes
 * conexas del grafo de vínculos. Trabaja en memoria, no consulta la base.
 *
 * Devuelve un Map quoteId → paquete. Los documentos sueltos no aparecen.
 * `principal` es el documento más avanzado (NP > presupuesto > solicitud): es
 * el que dibuja la tarjeta; los otros dos se muestran adentro.
 */
function agruparEnPaquetes(quotes) {
  const porId   = new Map(quotes.map(q => [q.id, q]));
  const vecinos = new Map();
  const unir = (a, b) => {
    if (!porId.has(a) || !porId.has(b)) return;
    if (!vecinos.has(a)) vecinos.set(a, new Set());
    if (!vecinos.has(b)) vecinos.set(b, new Set());
    vecinos.get(a).add(b);
    vecinos.get(b).add(a);
  };

  // El vínculo puede estar guardado de cualquiera de los dos lados
  for (const q of quotes) {
    if (q.linkedQuoteId) unir(q.id, q.linkedQuoteId);
    for (const lb of q.linkedBy || []) unir(q.id, lb.id);
  }

  const resultado = new Map();
  const visto     = new Set();

  for (const q of quotes) {
    if (visto.has(q.id)) continue;
    const comp = [];
    const cola = [q.id];
    while (cola.length) {
      const id = cola.shift();
      if (visto.has(id)) continue;
      visto.add(id);
      const doc = porId.get(id);
      if (doc) comp.push(doc);
      for (const v of vecinos.get(id) || []) if (!visto.has(v)) cola.push(v);
    }
    if (comp.length < 2) continue;   // solo: no es paquete

    const sol  = comp.find(x => x.mailType === 'SOLICITUD')   || null;
    const pres = comp.find(x => x.mailType === 'PRESUPUESTO') || null;
    // Varias notas de pedido contra el mismo presupuesto es un caso real: el
    // cliente compra por tandas. Van todas, y el total es la suma.
    const nps  = comp.filter(x => x.mailType === 'NOTA_PEDIDO')
                     .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    const principal = nps[0] || pres || sol || comp[0];

    // El total se suma POR MONEDA. Tomar la moneda del primero y sumar todo
    // junto daba mal: hay paquetes donde la primera nota de pedido está en pesos
    // y sin monto, y las que sí tienen plata están en dólares — la tarjeta
    // mostraba "AR$" sobre una suma de dólares.
    const totales = {};
    for (const n of nps) {
      if (n.amount == null) continue;
      const cur = n.currency || 'USD';
      totales[cur] = (totales[cur] || 0) + n.amount;
    }
    const monedas = Object.keys(totales);

    const paquete = {
      principal:   principal.id,
      solicitud:   sol  ? { code: sol.code }  : null,
      presupuesto: pres ? { code: pres.code, amount: pres.amount, currency: pres.currency || 'USD' } : null,
      notasPedido: nps.map(n => ({ code: n.code, amount: n.amount, currency: n.currency || 'USD' })),
      // npTotales lleva una entrada por moneda; npTotal/npCurrency quedan para
      // el caso normal, que es una sola moneda.
      npTotales:   totales,
      npTotal:     monedas.length ? totales[monedas[0]] : null,
      npCurrency:  monedas[0] || (nps[0]?.currency || 'USD'),
    };
    for (const m of comp) resultado.set(m.id, paquete);
  }
  return resultado;
}


/**
 * Cadena de revisiones. Cuando el cliente pide recotizar, el presupuesto nuevo
 * apunta al anterior con `revisionDeId`, y así sucesivamente. Esto arma, para
 * cada cotización, en qué número de revisión va y la cadena completa desde la
 * primera — para poder mostrar "Revisión 3 · COT-325 → COT-410 → esta".
 *
 * Trabaja en memoria sobre lo ya traído, igual que agruparEnPaquetes.
 */
function cadenaDeRevisiones(quotes) {
  const porId  = new Map(quotes.map(q => [q.id, q]));
  const result = new Map();

  // Hijo de cada uno, para poder recorrer también hacia adelante
  const hijoDe = new Map();
  for (const q of quotes) if (q.revisionDeId) hijoDe.set(q.revisionDeId, q);

  for (const q of quotes) {
    if (!q.revisionDeId && !hijoDe.has(q.id)) continue; // ni padre ni hijo: no está en ninguna cadena

    // Hacia atrás, hasta la primera
    const atras = [];
    let cursor = q.revisionDeId ? porId.get(q.revisionDeId) : null, guarda = 0;
    while (cursor && guarda++ < 20) {
      atras.unshift(cursor);
      cursor = cursor.revisionDeId ? porId.get(cursor.revisionDeId) : null;
    }
    // Y hacia adelante, hasta la última. Sin esto, el primer presupuesto de la
    // cadena no veía a las revisiones que vinieron después: quedaba anulado y
    // sin forma de llegar a la que lo reemplazó.
    const adelante = [];
    cursor = hijoDe.get(q.id); guarda = 0;
    while (cursor && guarda++ < 20) {
      adelante.push(cursor);
      cursor = hijoDe.get(cursor.id);
    }

    const cadena = [...atras, q, ...adelante];
    // Si el primero que se alcanzó todavía apunta a otro, falta un eslabón que
    // no vino en esta lista: se marca para no afirmar un número que puede estar mal.
    const completa = !cadena[0]?.revisionDeId;

    result.set(q.id, {
      nro: atras.length + 1,        // en qué posición está ESTA
      total: cadena.length,
      completa,
      cadena: cadena.map(x => ({ id: x.id, code: x.code, anulada: !!x.anuladaAt })),
    });
  }
  return result;
}

/**
 * Deja `nuevoId` como revisión de `anteriorId`: engancha la cadena, muda el
 * paquete al nuevo y anula el anterior.
 *
 * Lo usan los dos caminos —el botón de la ficha y la detección automática al
 * ingresar un presupuesto por mail— para que se comporten igual. Es donde vive
 * la regla de que un presupuesto reemplazado sale del tablero pero no se borra.
 */
async function marcarComoRevision(nuevoId, anteriorId, { motivo = null, userId = null } = {}) {
  const [nuevo, anterior] = await Promise.all([
    prisma.quote.findUnique({ where: { id: nuevoId },    select: { id: true, code: true, linkedQuoteId: true } }),
    prisma.quote.findUnique({ where: { id: anteriorId }, select: { id: true, code: true, linkedQuoteId: true, revisionDeId: true } }),
  ]);
  if (!nuevo || !anterior) return null;

  // En qué número de revisión queda
  let nivel = 1, cursor = anterior, guarda = 0;
  while (cursor?.revisionDeId && guarda++ < 20) {
    cursor = await prisma.quote.findUnique({ where: { id: cursor.revisionDeId }, select: { revisionDeId: true } });
    nivel++;
  }

  await prisma.quote.update({
    where: { id: nuevo.id },
    data: {
      revisionDeId: anterior.id,
      // Si el nuevo entró sin vínculo, hereda el paquete del que reemplaza
      ...(nuevo.linkedQuoteId ? {} : { linkedQuoteId: anterior.linkedQuoteId }),
    },
  });

  // Lo que apuntaba al anterior (la solicitud, la nota de pedido) pasa al nuevo
  await prisma.quote.updateMany({
    where: { linkedQuoteId: anterior.id, id: { not: nuevo.id } },
    data:  { linkedQuoteId: nuevo.id },
  });

  await prisma.quote.update({
    where: { id: anterior.id },
    data:  { anuladaAt: new Date(), anuladaMotivo: motivo, linkedQuoteId: null, followUpDate: null },
  });

  await prisma.activity.createMany({
    data: [
      { action: 'REVISION_CREADA', quoteId: nuevo.id,
        detail: `Revisión ${nivel + 1} — reemplaza a ${anterior.code}${motivo ? `: ${motivo}` : ''}`, userId },
      { action: 'ANULADA', quoteId: anterior.id,
        detail: `Anulada — reemplazada por ${nuevo.code}${motivo ? `: ${motivo}` : ''}`, userId },
    ],
  });

  return { revisionNro: nivel + 1, reemplaza: anterior.code };
}

module.exports = { miembrosDelPaquete, moverResto, alinearPaquete, agruparEnPaquetes, cadenaDeRevisiones, marcarComoRevision, ORDEN };
