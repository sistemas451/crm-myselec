/**
 * flexxusParser.js
 * Extrae datos de PDFs de presupuestos Flexxus:
 *   - NP (número de presupuesto)
 *   - CUIT del cliente
 *   - Razón social
 *   - Líneas de detalle (ítems)
 */

const pdfParse = require('pdf-parse');

// ─── Regex helpers ───────────────────────────────────────────────────────────

// CUIT argentino: XX-XXXXXXXX-X
const CUIT_RE   = /\b(\d{2}-\d{8}-\d{1})\b/;

// NP Flexxus: formato "0000-00017680"  →  4+ ceros, guión, luego ceros + número
const NP_RE     = /^0{4,}-0*(\d+)$/;

// ─── Parsear ítems ────────────────────────────────────────────────────────────
/**
 * Cada línea de ítem tiene la forma (todo concatenado sin separadores):
 *   {descripción}{código}{cant}U$S {total}U$S {unitario}{marca}{N°item}
 *
 * Estrategia:
 *   1. Detectar línea válida: contiene "U$S" al menos 2 veces.
 *   2. Extraer los dos precios con regex sencilla.
 *   3. Guardar el texto previo al primer precio como "descripción bruta".
 *   4. Extraer el número de ítem del final.
 *   5. Marcar NC ("NO COTIZA") con accepted=false.
 */
function parseItems(lines) {
  const items = [];

  for (const line of lines) {
    // Debe tener dos ocurrencias de U$S
    if ((line.match(/U\$S/g) || []).length < 2) continue;

    // Extraer: (todo antes 1er U$S) | precio1 | precio2 | (marca + N°)
    const m = line.match(
      /^(.+?)U\$S\s+([\d,]+)\s*U\$S\s+([\d,]+)(.+?)(\d+)$/
    );
    if (!m) continue;

    const rawDesc  = m[1].trim();     // descripción+código+cant
    const total    = parseArFloat(m[2]);
    const unitPrice= parseArFloat(m[3]);
    const brand    = m[4].trim();
    const sortOrder= parseInt(m[5], 10) - 1;  // 0-based

    // "NO COTIZA" → accepted=false (ítem sin precio)
    const isNC = rawDesc.toUpperCase().startsWith('NO COTIZA');

    // Intentar separar descripción del código:
    // El código suele aparecer al final de rawDesc, en mayúsculas/alfanum sin espacios largos.
    // Simplificación: usamos rawDesc completo como descripción para la demo.
    items.push({
      description: rawDesc,
      quantity:    extractQty(rawDesc, total, unitPrice),
      unit:        null,
      unitPrice:   isNC ? null : unitPrice,
      total:       isNC ? null : total,
      accepted:    !isNC,
      sortOrder,
      brand:       brand || null,
    });
  }

  return items;
}

/**
 * Intenta extraer la cantidad del rawDesc comparando total / unitario.
 * Si no coincide, devuelve 1.
 */
function extractQty(rawDesc, total, unit) {
  if (!unit || unit === 0) return 0;
  const ratio = total / unit;
  if (Number.isInteger(ratio) || Math.abs(ratio - Math.round(ratio)) < 0.01) {
    return Math.round(ratio);
  }
  return 1;
}

function parseArFloat(s) {
  // Formato argentino: "1.234,56" o "208,60"
  return parseFloat((s || '0').replace(/\./g, '').replace(',', '.')) || 0;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Parsea un buffer de PDF Flexxus.
 * Retorna:
 *   { npCode, cuit, clientName, date, seller, total, items }
 * Todos los campos pueden ser null si no se encontraron.
 */
async function parseFlexxusPDF(buffer) {
  const result = {
    npCode:           null,   // "PR-17680" (PR = Presupuesto)
    npRaw:            null,   // "17680"
    cuit:             null,   // "30-68621830-5"
    clientName:       null,
    date:             null,
    seller:           null,
    subtotalNeto:     null,   // U$S 4.896,00
    discountPct:      null,   // 0
    discountAmt:      null,   // U$S 0,00
    ivaAmount:        null,   // U$S 1.028,16
    totalPercepciones:null,   // U$S 146,88
    total:            null,   // U$S 6.071,04 — grand total con IVA y percepciones
    items:            [],
  };

  try {
    const data  = await pdfParse(buffer);
    const lines = data.text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    // ── CUIT ──────────────────────────────────────────────────────────────────
    for (const line of lines) {
      const m = line.match(CUIT_RE);
      if (m) { result.cuit = m[1]; break; }
    }

    // ── Razón social (línea después del primer guión tras CUIT) ──────────────
    // Estructura típica: CUIT / "-" / RAZON SOCIAL / "-" / NP
    let cuitIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (CUIT_RE.test(lines[i])) { cuitIdx = i; break; }
    }
    if (cuitIdx >= 0 && cuitIdx + 2 < lines.length) {
      result.clientName = lines[cuitIdx + 2]; // skip "-"
    }

    // ── Código de Presupuesto (PR-XXXXX) ─────────────────────────────────────
    for (const line of lines) {
      const m = line.match(NP_RE);
      if (m) {
        result.npRaw  = m[1];
        result.npCode = `PR-${m[1]}`;   // PR = Presupuesto
        break;
      }
    }

    // ── Fecha ─────────────────────────────────────────────────────────────────
    for (const line of lines) {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) {
        result.date = line;
        break;
      }
    }

    // ── Vendedor (línea antes de "Vendedor:") ─────────────────────────────────
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === 'Vendedor:') {
        result.seller = lines[i - 1];
        break;
      }
    }

    // ── Ítems ─────────────────────────────────────────────────────────────────
    result.items = parseItems(lines);

    // ── Breakdown de precios ──────────────────────────────────────────────────
    // El PDF puede concatenar label+valor en la misma línea o separarlos.
    // Manejamos ambos casos con marcador de contexto (totalMarker).
    let totalMarker = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      // "Subtotal. Neto: U$S 4896,00"
      if (!result.subtotalNeto && (m = line.match(/Subtotal[.\s]+Neto\s*:?\s*U\$S\s*([\d,.]+)/i)))
        result.subtotalNeto = parseArFloat(m[1]);
      // "Desc. 0,00 % : U$S 0,00"
      if (!result.discountAmt && (m = line.match(/Desc\.\s*([\d,.]+)\s*%\s*:?\s*U\$S\s*([\d,.]+)/i))) {
        result.discountPct = parseArFloat(m[1]);
        result.discountAmt = parseArFloat(m[2]);
      }
      // "Total Perc.: U$S 146,88"
      if (!result.totalPercepciones && (m = line.match(/Total\s+Perc\.?\s*:?\s*U\$S\s*([\d,.]+)/i)))
        result.totalPercepciones = parseArFloat(m[1]);
      // Grand total — "Total: U$S 6071,04" en la misma línea (mixed case)
      if (!result.total && (m = line.match(/^Total\s*:\s*U\$S\s*([\d,.]+)$/)))
        result.total = parseArFloat(m[1]);
      // Grand total — "Total:" en una línea, "U$S 6071,04" en la siguiente
      if (!result.total && /^Total\s*:?\s*$/.test(line)) {
        totalMarker = true;
      } else if (totalMarker) {
        if (!result.total && (m = line.match(/^U\$S\s+([\d,.]+)$/)))
          result.total = parseArFloat(m[1]);
        totalMarker = false;
      }
    }
    // Calcular IVA si no fue parseado directamente:
    // Total = (SubtotalNeto - Descuento) + IVA + Percepciones
    // → IVA  = Total - SubtotalNeto + Descuento - Percepciones
    if (result.total != null && result.subtotalNeto != null && result.ivaAmount === null) {
      const disc = result.discountAmt || 0;
      const perc = result.totalPercepciones || 0;
      result.ivaAmount = parseFloat((result.total - result.subtotalNeto + disc - perc).toFixed(2));
    }

  } catch (err) {
    console.error('flexxusParser error:', err.message);
  }

  return result;
}

/**
 * Detecta si un attachment es un presupuesto Flexxus.
 * Criterio: filename contiene "Presupuesto" y extensión .pdf
 */
function isFlexxusPDF(att) {
  if (!att || !att.filename) return false;
  const name = att.filename.toLowerCase();
  return name.endsWith('.pdf') && name.includes('presupuesto');
}

/**
 * Detecta si un attachment es una Nota de Pedido Flexxus.
 * Criterio: filename contiene "Nota de Pedido" y extensión .pdf
 */
function isNotaPedidoPDF(att) {
  if (!att || !att.filename) return false;
  const name = att.filename.toLowerCase();
  return name.endsWith('.pdf') && name.includes('nota de pedido');
}

// NP Nota de Pedido: formato "0001-00020728" (4 dígitos, guión, 8+ dígitos)
const NP_PEDIDO_RE = /^\d{4}-\d{7,}$/;

/**
 * Parsea líneas de ítems de una Nota de Pedido Flexxus.
 *
 * El PDF genera DOS tipos de líneas para cada ítem:
 *  a) Descripción limpia (sin precios): "ETA 0063 - TERMINAL TERMOC. 1KV 3X185/95 A 3X300/1"
 *  b) Línea completa (con precios):     "ETA 0063 - TERMINAL TERMOC...1893710-0002000U$S 4896,00U$S 24,48"
 *
 * Estrategia:
 *  1. Primero recolectamos las líneas de descripción limpia (sin U$S).
 *  2. Para cada línea completa, buscamos si empieza con alguna descripción limpia conocida.
 *  3. Lo que sigue a la descripción es: {SKU}{qty}{remitida} — extraemos el SKU con /^(\d{6}-\d{3})/.
 *
 * Notas sobre el formato:
 *  - El PDF concatena sin espacios separadores.
 *  - El primer U$S es el TOTAL, el segundo es el precio UNITARIO.
 */
function parseNotaPedidoItems(lines) {
  // Líneas candidatas a ser descripciones puras (sin precios, con texto)
  const descCandidates = lines.filter(l =>
    !l.includes('U$S') && l.length > 8 && /[A-Za-z]/.test(l) &&
    !/^(NOTA|DATOS|DETALLE|MYSELEC|ROWING|COMENTARIO|TRABAJO|Forma|Anticipo|Firma|FLETE|ORDEN|PRESUP|Responsable|Vendedor|Fecha|Operaci|Transpor|Dep|Localidad|Direcci|Telef|E-mail|C\.U\.I|Barrio|Provin|Condic|R\. Social)/i.test(l)
  );

  const items = [];
  for (const line of lines) {
    const usdCount = (line.match(/U\$S/g) || []).length;
    if (usdCount < 2) continue;
    if (line.startsWith('U$S')) continue;

    // Extraer los dos precios: "U$S {total}U$S {unitario}"
    const priceM = line.match(/U\$S\s*([\d,.]+)U\$S\s*([\d,.]+)/);
    if (!priceM) continue;

    const total     = parseArFloat(priceM[1]); // primero = total
    const unitPrice = parseArFloat(priceM[2]); // segundo = unitario
    const qty       = (unitPrice > 0 && total > 0) ? Math.round(total / unitPrice) : 0;
    if (total === 0) continue;

    const beforePrices = line.slice(0, line.indexOf('U$S')).trim();

    let sku         = null;
    let description = beforePrices;

    // Buscar descripción limpia que sea prefijo de la línea completa
    const matchDesc = descCandidates.find(d => beforePrices.startsWith(d) && beforePrices.length > d.length);
    if (matchDesc) {
      description = matchDesc.trim();
      const afterDesc = beforePrices.slice(matchDesc.length);
      // afterDesc = "{SKU}{qty}{remitida}", ej: "893710-0002000"
      const skuM = afterDesc.match(/^(\d{5,7}-\d{3})/);
      if (skuM) sku = skuM[1].toUpperCase();
    } else {
      // Fallback: buscar patrón SKU al final del blob (antes de las cantidades)
      const skuM = beforePrices.match(/(\d{5,7}-\d{3})\d*$/);
      if (skuM) {
        sku = skuM[1].toUpperCase();
        description = beforePrices.slice(0, skuM.index).trim() || beforePrices;
      }
    }

    items.push({
      sku,
      description,
      quantity:  qty,
      unit:      null,
      unitPrice: unitPrice || null,
      total:     total     || null,
      accepted:  true,
      sortOrder: items.length,
    });
  }
  return items;
}

/**
 * Parsea un buffer de PDF Nota de Pedido Flexxus.
 * Retorna:
 *   { npCode, npRaw, cuit, clientName, ocNumber, presupuestoRef, presupuestoNP, date, seller, total, items }
 */
async function parseNotaPedidoPDF(buffer) {
  const result = {
    npCode:        null,  // "NP-20728" — número de la Nota de Pedido (NP = Nota de Pedido)
    npRaw:         null,  // "20728"
    cuit:          null,  // CUIT del cliente
    clientName:    null,  // Razón social del cliente
    ocNumber:      null,  // Número de OC del cliente
    presupuestoRef: null, // Texto raw del COMENTARIO
    presupuestoNP:  null, // Código PR del presupuesto extraído del COMENTARIO (ej: "PR-17680")
    date:          null,
    seller:        null,
    total:         null,
    items:         [],
  };

  try {
    const data  = await pdfParse(buffer);
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean);

    // ── Número de Nota de Pedido ("0001-00020728") ────────────────────────────
    for (const line of lines) {
      if (NP_PEDIDO_RE.test(line)) {
        const parts = line.split('-');
        result.npRaw  = String(parseInt(parts[1], 10)); // "20728"
        result.npCode = `NP-${result.npRaw}`;
        break;
      }
    }

    // ── CUIT del cliente (primera aparición) ─────────────────────────────────
    let cuitIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(CUIT_RE);
      if (m) { result.cuit = m[1]; cuitIdx = i; break; }
    }

    // ── Razón social (2 líneas después del CUIT: CUIT / dirección / nombre) ──
    if (cuitIdx >= 0 && cuitIdx + 2 < lines.length) {
      result.clientName = lines[cuitIdx + 2];
    }

    // ── Número de OC del cliente (línea después de "Nº OC:") ─────────────────
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'Nº OC:' && lines[i + 1]) {
        result.ocNumber = lines[i + 1].trim();
        break;
      }
    }

    // ── Presupuesto de referencia y OC del cliente (sección COMENTARIO) ─────
    // IMPORTANTE: pdf-parse concatena los valores sin espacio separador.
    // Ejemplos reales:
    //   "ORDEN DE COMPRA4500038388"   (sin espacio)
    //   "FLETE:RETIRAN"
    //   "PRESUPUESTO18009"            (sin espacio)
    // La sección COMENTARIO puede aparecer antes o después de firma/forma de pago.
    // Buscamos todas las líneas del PDF completo, no solo las inmediatas al label.
    for (const line of lines) {
      if (!result.ocNumber) {
        // "ORDEN DE COMPRA4500038388" o "ORDEN DE COMPRA 4500038388"
        const ocM = line.match(/ORDEN\s+DE\s+COMPRA\s*([A-Z0-9]+)/i);
        if (ocM) result.ocNumber = ocM[1];
      }
      if (!result.presupuestoNP) {
        // "PRESUPUESTO18009" o "PRESUPUESTO 18009" o "PR-18009"
        const prM = line.match(/PRESUPUESTO\s*(\d+)/i)
          || line.match(/\bPR[-\s](\d+)\b/i);
        if (prM) {
          result.presupuestoRef = line;
          result.presupuestoNP  = `PR-${prM[1]}`;
        }
      }
      if (result.ocNumber && result.presupuestoNP) break;
    }

    // ── Fecha ─────────────────────────────────────────────────────────────────
    for (const line of lines) {
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) { result.date = line; break; }
    }

    // ── Vendedor ──────────────────────────────────────────────────────────────
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === 'Vendedor:') { result.seller = lines[i - 1]; break; }
    }

    // ── Total ─────────────────────────────────────────────────────────────────
    // El primer "U$S XXXX" suelto es el subtotal de ítems; el ÚLTIMO es el
    // gran total (ya incluye IVA + percepciones). Por eso recorremos todo el
    // array sin break para quedarnos con el último valor que coincida.
    for (const line of lines) {
      if (/^U\$S\s+[\d,.]+$/.test(line)) {
        const m = line.match(/U\$S\s+([\d,.]+)/);
        if (m) result.total = parseArFloat(m[1]); // sin break → prevalece el último
      }
    }

    // ── Ítems ─────────────────────────────────────────────────────────────────
    result.items = parseNotaPedidoItems(lines);

  } catch (err) {
    console.error('parseNotaPedidoPDF error:', err.message);
  }

  return result;
}

module.exports = { parseFlexxusPDF, isFlexxusPDF, isNotaPedidoPDF, parseNotaPedidoPDF, parseArFloat };
