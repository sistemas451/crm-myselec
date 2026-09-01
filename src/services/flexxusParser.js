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

// ─── Extracción de SKU (5 filtros en cascada) ────────────────────────────────
/**
 * Separa el código de producto (SKU) del texto concatenado por pdf-parse.
 * Cascada:
 *   1) Sufijo repetido (" - CODE" / ".CODE" / "CODE" duplicado)
 *   2) Código contenido como palabra suelta en la descripción
 *   3) Formato letras+dígitos-dígitos (EN6978-000) o dígitos-dígitos (1893710-000)
 *   4) Código numérico puro (4+ dígitos al final)
 *   5) Código alfanumérico pegado (SUBCU1X35)
 *
 * @param {string} text  Texto concatenado (descripción + código)
 * @returns {{ sku: string|null, description: string }}
 */
function extractSkuFromText(text, catalog) {
  let sku = null;
  let cleanDesc = text;
  let found = false;

  // 0) SKU al comienzo: "{SKU} - {descripción}" (sin espacios, con dígitos)
  // Ej: "102L048/S - CAPUCHON TERMOC. C/ADH. 1KV 75/32 MM..."
  if (!found) {
    const prefixM = text.match(/^([A-Z0-9][A-Z0-9\/\-\.\(\)]{2,24}) - (.+)$/i);
    if (prefixM && /\d/.test(prefixM[1]) && !/\s/.test(prefixM[1])) {
      sku = prefixM[1].trim();
      cleanDesc = prefixM[2].trim();
      found = true;
    }
  }

  // 1) Sufijo repetido (más largo gana)
  let bestSku = null, bestDesc = null;
  for (let len = 2; len <= Math.min(20, Math.floor(text.length / 2)); len++) {
    const candidate = text.slice(-len);
    const before = text.slice(0, -len);
    if (before.endsWith(' - ' + candidate)) {
      bestSku = candidate.trim();
      bestDesc = before.slice(0, -(3 + candidate.length)).trim();
    } else if (before.endsWith('.' + candidate)) {
      bestSku = candidate.trim();
      bestDesc = before.slice(0, -(1 + candidate.length)).trim();
    } else if (before.endsWith(candidate)) {
      bestSku = candidate.trim();
      bestDesc = before.slice(0, -candidate.length).trim();
    }
  }
  if (bestSku) {
    sku = bestSku;
    cleanDesc = bestDesc;
    found = true;
  }

  // 2) Código contenido como palabra suelta más atrás en la descripción
  // Requiere 2+ mayúsculas consecutivas (evita ratios "5/8" y specs de tamaño "1X35")
  if (!found) {
    for (let len = 3; len <= Math.min(18, text.length - 3); len++) {
      const candidate = text.slice(-len).trim();
      if (!candidate || candidate.length < 3) continue;
      if (!/[A-Z]{2}/.test(candidate)) continue;
      const before = text.slice(0, -len).trim();
      const re = new RegExp('(?:^|\\s)' + candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)');
      if (re.test(before)) {
        sku = candidate;
        cleanDesc = before;
        found = true;
      }
    }
  }

  // 3) Código con formato letras+dígitos-dígitos (ej: EN6978-000)
  if (!found) {
    const ldM = text.match(/^(.+?)([A-Z]{2,}\d{3,}-\d{2,})$/);
    if (ldM) {
      sku = ldM[2];
      cleanDesc = ldM[1].trim();
      found = true;
    }
  }
  // 3b) Código puramente dígitos-dígitos (ej: 1893710-000)
  if (!found) {
    const ddM = text.match(/^(.+\D)(\d{4,}-\d{2,})$/);
    if (ddM) {
      sku = ddM[2];
      cleanDesc = ddM[1].trim();
      found = true;
    }
  }
  // 3c) Dígitos-guión-dígito corto pegado a una letra (ej: "...ROJO69338-2")
  if (!found) {
    const dsM = text.match(/^(.+[A-Za-zÀ-ÿ])(\d{4,}-\d{1,3})$/);
    if (dsM) {
      sku = dsM[2];
      cleanDesc = dsM[1].trim();
      found = true;
    }
  }

  // 4) Código numérico puro (ej: 89032)
  if (!found) {
    const numM = text.match(/^(.+\D)(\d{4,})$/);
    if (numM) {
      sku = numM[2];
      cleanDesc = numM[1].trim();
      found = true;
    }
  }

  // 5) Lookup contra catálogo de artículos: la descripción del artículo es prefijo del texto.
  // Va antes de Strategy 5 (alfanumérico) porque es más preciso cuando hay catálogo disponible.
  if (!found && catalog && catalog.length > 0) {
    const textNorm = text.toUpperCase().replace(/\s+/g, ' ').trim();
    let bestCode = null, bestLen = 0;
    for (const art of catalog) {
      const descNorm = art.description.toUpperCase().replace(/\s+/g, ' ').trim();
      if (descNorm.length >= 8 && descNorm.length > bestLen && textNorm.startsWith(descNorm)) {
        const remainder = textNorm.slice(descNorm.length).trim();
        if (remainder.length > 0 && remainder.length <= 25 && !/^\d+$/.test(remainder)) {
          bestLen = descNorm.length;
          bestCode = { code: art.code, description: art.description };
        }
      }
    }
    if (bestCode) {
      sku = bestCode.code;
      cleanDesc = bestCode.description;
      found = true;
    }
  }

  // 5b) Código del catálogo pegado al FINAL del texto. Cubre los casos donde
  // la descripción del PDF viene truncada y el prefijo de 5) no matchea
  // (ej: "...LINEAET3499-000" → código "ET3499-000" del catálogo).
  // Gana el código más largo que coincida.
  if (!found && catalog && catalog.length > 0) {
    let best = null;
    for (const art of catalog) {
      const code = String(art.code || '').trim();
      if (code.length < 4) continue;
      if (text.endsWith(code) && text.length > code.length + 3) {
        if (!best || code.length > best.length) best = code;
      }
    }
    if (best) {
      sku = best;
      cleanDesc = text.slice(0, -best.length).trim();
      found = true;
    }
  }

  // 6) Código alfanumérico pegado al final
  if (!found) {
    const mixM = text.match(/^(.+[^A-Z])([A-Z][A-Z0-9]*\d[A-Z0-9/+\-]*)$/);
    if (mixM && mixM[2].length >= 5) {
      sku = mixM[2];
      cleanDesc = mixM[1].trim();
      found = true;
    }
  }

  // Validación final contra catálogo: si el SKU extraído no existe tal cual
  // pero TERMINA con un código real (una regex arrastró letras de la
  // descripción, ej: "LINEAET3499-000" → "ET3499-000"), corregirlo.
  if (sku && catalog && catalog.length > 0 && !catalog.some(a => String(a.code || '').trim() === sku)) {
    let best = null;
    for (const art of catalog) {
      const code = String(art.code || '').trim();
      if (code.length >= 4 && sku.endsWith(code) && sku.length > code.length) {
        if (!best || code.length > best.length) best = code;
      }
    }
    if (best) {
      cleanDesc = (cleanDesc + ' ' + sku.slice(0, -best.length)).trim();
      sku = best;
    }
  }

  if (sku) {
    cleanDesc = cleanDesc.replace(/[\s.\-\/]+$/, '').trim();
  }
  return { sku, description: cleanDesc };
}

// ─── Formato NUEVO (desde ~2026): código primero ─────────────────────────────
/**
 * Los presupuestos Flexxus recientes se extraen con pdf-parse en este orden:
 *   {código}{cant}U$S {total}U$S {unitario}{MARCA}{N°item}{DESCRIPCIÓN}
 * Ejemplos reales:
 *   "719782-124U$S 209,40U$S 8,73SIMEL1TERMINAL BIMETALICO 120-1/2 - XCX 120"
 *   "NC1U$S 0,00U$S 0,001ERA CALIDAD7NO COTIZA"           (marca arranca con dígito)
 *   "1320U$S 26765,74U$S 20,286Subterraneo MT 13,2KV..."  (ítem sin código ni marca)
 * La línea siguiente suele ser el plazo de entrega ("ENTREGA INMEDIATA", "7 DIAS", ...).
 */

/**
 * Separa {MARCA}{N°item}{DESCRIPCIÓN} usando el N° de ítem esperado (secuencial).
 * Pasada A: N° precedido por letra (fin de marca) y seguido por letra (inicio desc).
 * Pasada B: idem pero seguido por cualquier no-dígito.
 * Pasada C: N° seguido por dígito, solo si la descripción arranca con un código
 *           de producto tipo "{SKU} - ..." que valida el corte (caso PR-18272:
 *           "RAYCHEM1102L044/S - CAPUCHON..." → marca RAYCHEM, ítem 1, desc "102L044/S - ...").
 * Luego: N° al inicio (fila sin marca) y fallback genérico.
 */
function splitBrandNumDesc(tail, expectedNum) {
  const isLetter = c => !!c && /[A-Za-zÀ-ÿ]/.test(c);
  const numStr = String(expectedNum);

  for (const strict of [true, false]) {
    let idx = tail.indexOf(numStr);
    while (idx !== -1) {
      const prev = tail[idx - 1];
      const next = tail[idx + numStr.length];
      const nextOk = strict ? isLetter(next) : (next !== undefined && !/\d/.test(next));
      if (isLetter(prev) && nextOk) {
        return {
          brand:   tail.slice(0, idx).trim(),
          itemNum: expectedNum,
          desc:    tail.slice(idx + numStr.length).trim(),
        };
      }
      idx = tail.indexOf(numStr, idx + 1);
    }
  }

  // Pasada C: el N° va seguido de OTRO dígito porque la descripción empieza
  // con un código de producto ("102L044/S - CAPUCHON..."). Solo se acepta si
  // lo que queda matchea el patrón {SKU} - {texto} (Estrategia 0 del cascade).
  {
    let idx = tail.indexOf(numStr);
    while (idx !== -1) {
      const prev = tail[idx - 1];
      const desc = tail.slice(idx + numStr.length);
      if (isLetter(prev) && /^[A-Z0-9][A-Z0-9\/\-\.\(\)]{2,24} - .+/i.test(desc)) {
        return { brand: tail.slice(0, idx).trim(), itemNum: expectedNum, desc: desc.trim() };
      }
      idx = tail.indexOf(numStr, idx + 1);
    }
  }

  // N° de ítem al inicio → fila sin marca (ej: cable subterráneo sin código)
  if (tail.startsWith(numStr) && !/\d/.test(tail[numStr.length] || '')) {
    return { brand: null, itemNum: expectedNum, desc: tail.slice(numStr.length).trim() };
  }

  // Genérico (si el contador esperado se desincronizó): {letras}{1-3 dígitos}{letra}
  const g = tail.match(/^(.*?[A-Za-zÀ-ÿ])(\d{1,3})(?=[A-Za-zÀ-ÿ])/);
  if (g) {
    return {
      brand:   g[1].trim(),
      itemNum: parseInt(g[2], 10),
      desc:    tail.slice(g[1].length + g[2].length).trim(),
    };
  }
  return null;
}

/**
 * Separa {código}{cantidad} concatenados usando total/unitario para inferir la cantidad.
 * "719782-124" con total 209,40 y unit 8,73 → qty 24, código "719782-1".
 * "1320" (solo cantidad, sin código) → qty 1320, código null.
 * "NC1" (unit = 0) → código "NC", qty 1.
 */
function splitCodeQty(pre, total, unitPrice) {
  if (unitPrice > 0) {
    const ratio = total / unitPrice;
    const qtyCand = Math.round(ratio);
    // Tolerancia relativa: Flexxus muestra el unitario redondeado a 2 decimales,
    // el total real puede desviarse levemente (ej: qty 1320 → ratio 1319,81)
    if (qtyCand > 0 && Math.abs(ratio - qtyCand) <= Math.max(0.02, qtyCand * 0.003)) {
      const qs = String(qtyCand);
      if (pre.endsWith(qs)) {
        const code = pre.slice(0, -qs.length).replace(/[\s]+$/, '');
        return { sku: code || null, qty: qtyCand };
      }
    }
    // Fallback: dígitos al final como cantidad, validados contra los precios.
    // Se prueban todos los largos, del más largo al más corto: con un solo
    // intento sobre el máximo de dígitos no alcanza. En "ROJO69338-21260" los
    // dígitos finales son "21260", que no valida contra los precios, y la
    // cantidad real es "1260" — sin reintentar quedaba la del cociente (1259
    // por redondeo) y el código con la cantidad pegada.
    const dig = pre.match(/(\d+)$/);
    if (dig) {
      const cola = dig[1];
      for (let len = Math.min(6, cola.length); len >= 1; len--) {
        const cand = cola.slice(-len);
        // "0200" vale 200 igual que "200", pero se comeria un digito del
        // codigo: en "ZCC 10200" dejaria "ZCC 1" en vez de "ZCC 10".
        if (len > 1 && cand.startsWith('0')) continue;
        const q = parseInt(cand, 10);
        if (!(q > 0)) continue;
        if (Math.abs(q * unitPrice - total) <= Math.max(0.05, total * 0.02)) {
          return { sku: pre.slice(0, pre.length - len).trim() || null, qty: q };
        }
      }
    }
    return { sku: pre || null, qty: qtyCand > 0 ? qtyCand : 1 };
  }

  // Precio 0 (NO COTIZA): dígitos finales = cantidad
  const m = pre.match(/^(.*?)(\d{1,6})$/);
  if (m) return { sku: m[1].trim() || null, qty: parseInt(m[2], 10) };
  return { sku: pre || null, qty: 1 };
}

/**
 * Intenta parsear una línea con el formato NUEVO. Retorna null si la línea
 * no coincide (y se debe intentar con el formato viejo).
 */
function tryParseNewFormatItem(line, expectedNum) {
  const m = line.match(/^(.*?)(?:U\$S|\$)\s*([\d.]+,\d{2})\s*(?:U\$S|\$)\s*([\d.]+,\d{2})(.+)$/);
  if (!m) return null;

  const pre = m[1].trim();
  // En el formato viejo lo que precede al primer precio es la descripción larga;
  // en el nuevo es {código}{cant} (corto). Umbral conservador.
  if (pre.length > 24) return null;

  const total     = parseArFloat(m[2]);
  const unitPrice = parseArFloat(m[3]);
  const tail      = m[4];

  const bnd = splitBrandNumDesc(tail, expectedNum);
  if (!bnd || !bnd.desc || bnd.desc.length < 3) return null;

  const cq = splitCodeQty(pre, total, unitPrice);
  // La leyenda puede caer en la descripcion o del lado del codigo, segun como
  // pdf-parse corte la linea. Mirando solo la descripcion quedaban items con
  // sku "NO COTIZANC" contados como cotizados.
  const isNC = /NO\s*COTIZA/i.test(bnd.desc) || /NO\s*COTIZA/i.test(pre) || /NO\s*COTIZA/i.test(cq.sku || '');

  // Idem formato viejo: sin precio no esta cotizado
  const sinPrecio = !isNC && !unitPrice && !total;

  return {
    sku:         isNC ? null : (cq.sku || null),
    description: isNC ? 'NO COTIZA' : bnd.desc,
    quantity:    cq.qty,
    unit:        null,
    unitPrice:   (isNC || sinPrecio) ? null : unitPrice,
    total:       (isNC || sinPrecio) ? null : total,
    accepted:    !isNC && !sinPrecio,
    sortOrder:   bnd.itemNum - 1,
    brand:       bnd.brand || null,
  };
}

// ─── Parsear ítems ────────────────────────────────────────────────────────────
/**
 * Soporta dos layouts de Flexxus:
 *   NUEVO (desde ~2026): {código}{cant}U$S {total}U$S {unitario}{MARCA}{N°item}{DESCRIPCIÓN}
 *   VIEJO:               {descripción}{código}{cant}U$S {total}U$S {unitario}{marca}{N°item}
 * Por cada línea con 2+ "U$S" se intenta primero el formato nuevo; si no
 * matchea se cae a la lógica vieja (compatibilidad con PDFs anteriores).
 */
function parseItems(lines, catalog) {
  const items = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Flexxus emite casi siempre en dolares, pero cuando factura en pesos usa
    // "$". Buscando solo "U$S" el presupuesto entero quedaba sin items
    // (COT-2026-090). El parser de notas de pedido ya aceptaba las dos.
    if ((line.match(/(?:U\$S|\$)\s*[\d.]+,\d{2}/g) || []).length < 2) continue;

    // ── 1) Formato NUEVO (código primero) ──────────────────────────────────
    const newItem = tryParseNewFormatItem(line, items.length + 1);
    if (newItem) {
      // Plazo de entrega: línea siguiente sin precios con keywords de plazo
      const next = lines[li + 1];
      if (next && !next.includes('U$S') && next.length <= 90 &&
          /(DIAS|INMEDIAT|SALVO VENTA|ENTREGA|STOCK|SEMANA|CONSULTAR|IMPORTA|DESDE OC)/i.test(next)) {
        newItem.deliveryNote = next.trim();
      }
      items.push(newItem);
      continue;
    }

    // ── 2) Formato VIEJO (descripción primero) ─────────────────────────────
    // pdf-parse extrae cada fila como:
    //   {desc}{code}{qty}U$S {total}U$S {unitPrice}{brand}{itemNum}
    // Usamos [\d.]+,\d{2} para precios (evita capturar dígitos de la marca)
    const m = line.match(
      /^(.+?)(?:U\$S|\$)\s*([\d.]+,\d{2})\s*(?:U\$S|\$)\s*([\d.]+,\d{2})(.+?)(\d+)$/
    );
    if (!m) continue;

    const rawDesc  = m[1].trim();
    const total    = parseArFloat(m[2]);
    const unitPrice= parseArFloat(m[3]);
    const brand    = m[4].trim();
    const sortOrder= parseInt(m[5], 10) - 1;

    const isNC = /NO\s*COTIZA/i.test(rawDesc);

    // rawDesc = "{descripción}{código}{cantidad}" concatenado sin separadores.
    // Estrategia: calcular qty por ratio de precios, stripear del final,
    // luego extraer el código.
    // Antes esto usaba extractQty(), que exigia que total/unitario diera un
    // entero con 0,01 de tolerancia y, si no, devolvia 1 en silencio. Flexxus
    // redondea el unitario a 2 decimales, asi que con cantidades grandes el
    // cociente nunca daba justo: 8276,80 / 22,99 = 360,017 quedaba en qty=1 y
    // ademas el "360" se pegaba al codigo (44865-000360). splitCodeQty ya
    // resuelve lo mismo con tolerancia relativa y validando los digitos
    // finales contra los precios — se usa la misma en los dos formatos.
    let qty  = extractQty(rawDesc, total, unitPrice);
    let text = rawDesc;

    // extractQty exige que total/unitario de un entero con 0,01 de tolerancia y,
    // si no, devuelve 1 en silencio. Flexxus redondea el unitario a 2 decimales,
    // asi que con cantidades grandes nunca da justo: 8276,80 / 22,99 = 360,017
    // quedaba en cantidad 1 y el "360" pegado al codigo (44865-000360).
    // splitCodeQty resuelve lo mismo con tolerancia relativa, pero recorta el
    // texto de otra forma y eso descolocaba la extraccion del codigo en los
    // casos que ya funcionaban. Por eso solo se usa cuando el metodo viejo se
    // rindio: cantidad 1 con un total que no coincide con el unitario.
    const seRindio = qty === 1 && unitPrice > 0 &&
                     Math.abs(total - unitPrice) > Math.max(0.05, total * 0.02);
    if (seRindio) {
      const cq = splitCodeQty(rawDesc, total, unitPrice);
      const cuadra = cq.qty > 1 &&
                     Math.abs(cq.qty * unitPrice - total) <= Math.max(0.05, total * 0.02);
      if (cuadra) {
        qty  = cq.qty;
        text = cq.sku || rawDesc;
      }
    }

    // Si no intervino splitCodeQty, se saca la cantidad del final como antes
    if (text === rawDesc && qty > 0 && text.endsWith(String(qty))) {
      text = text.slice(0, -String(qty).length);
    }

    let sku = null;
    let cleanDesc = text;

    if (text.endsWith('DETALLE')) {
      cleanDesc = text.slice(0, -7).trim();
    } else if (isNC) {
      cleanDesc = 'NO COTIZA';
    } else {
      const extracted = extractSkuFromText(text, catalog);
      sku = extracted.sku;
      cleanDesc = extracted.description;
    }

    // Flexxus lista en 0,00 lo que no cotiza aunque no escriba la leyenda. Si se
    // deja como aceptado, la ficha lo muestra entre los items cotizados con el
    // precio vacio y no se entiende por que (MYS-0019).
    const sinPrecio = !isNC && !unitPrice && !total;

    items.push({
      sku,
      description: cleanDesc,
      quantity:    qty,
      unit:        null,
      unitPrice:   (isNC || sinPrecio) ? null : unitPrice,
      total:       (isNC || sinPrecio) ? null : total,
      accepted:    !isNC && !sinPrecio,
      sortOrder,
      brand:       brand || null,
    });
  }

  // Ordenar por N° de ítem del PDF (mailReader persiste con el índice del array)
  items.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
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

/**
 * Busca un valor "U$S XXXX,XX" en la línea idx-1, idx+1 o idx misma.
 * Necesario porque pdf-parse puede poner la etiqueta antes O después del valor
 * dependiendo del orden de los objetos de texto en el PDF.
 */
function getAdjacentUsd(lines, idx) {
  for (const i of [idx - 1, idx + 1, idx]) {
    if (i < 0 || i >= lines.length) continue;
    const m = lines[i].match(/U\$S\s*([\d,.]+)/);
    if (m) return parseArFloat(m[1]);
  }
  return null;
}

/**
 * Igual que getAdjacentUsd pero acepta "U$S" o "$" (las NP de compras
 * Mercado Libre vienen en pesos).
 */
function getAdjacentMoney(lines, idx) {
  for (const i of [idx - 1, idx + 1, idx]) {
    if (i < 0 || i >= lines.length) continue;
    const m = lines[i].match(/(?:U\$S|\$)\s*([\d,.]+)/);
    if (m) return parseArFloat(m[1]);
  }
  return null;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Parsea un buffer de PDF Flexxus.
 * Retorna:
 *   { npCode, cuit, clientName, date, seller, total, items }
 * Todos los campos pueden ser null si no se encontraron.
 */
async function parseFlexxusPDF(buffer, opts) {
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
    result.items = parseItems(lines, opts && opts.catalog);

    // ── Breakdown de precios ──────────────────────────────────────────────────
    // IMPORTANTE: pdf-parse puede entregar la etiqueta y el valor en líneas
    // adyacentes en cualquier orden (valor antes o después de la etiqueta).
    // Usamos getAdjacentUsd() para buscar en línea anterior, posterior y misma.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;

      // Subtotal neto
      if (!result.subtotalNeto && /Subtotal[\s.]+Neto/i.test(line))
        result.subtotalNeto = getAdjacentUsd(lines, i);

      // Descuento: "Desc.0,00 %:" o "Desc. 0,00 % :"
      if (result.discountAmt == null && /Desc\./i.test(line) && /%/.test(line)) {
        const pctM = line.match(/([\d,.]+)\s*%/);
        if (pctM) result.discountPct = parseArFloat(pctM[1]);
        result.discountAmt = getAdjacentUsd(lines, i) ?? 0;
      }

      // Total percepciones
      if (!result.totalPercepciones && /Total\s+Perc/i.test(line))
        result.totalPercepciones = getAdjacentUsd(lines, i);

      // Grand total — inline "Total: U$S 6071,04" o etiqueta sola "Total:"
      if (!result.total) {
        if ((m = line.match(/^Total\s*:\s*U\$S\s*([\d,.]+)$/)))
          result.total = parseArFloat(m[1]);
        else if (/^Total\s*:?\s*$/.test(line))
          result.total = getAdjacentUsd(lines, i);
      }
    }

    // Calcular IVA si no fue parseado directamente.
    // En los PDFs Flexxus verificados (ej: PR-18363 con percepciones ARBA), el Total
    // NO incluye percepciones: Total = (SubtotalNeto - Desc) + IVA.
    // Por robustez ante variantes, se calculan ambos candidatos (con y sin
    // percepciones restadas) y se elige el que mejor coincide con la alícuota.
    if (result.total != null && result.subtotalNeto != null && result.ivaAmount === null) {
      const disc = result.discountAmt || 0;
      const perc = result.totalPercepciones || 0;
      const neto = result.subtotalNeto - disc;

      // Alícuota impresa en el PDF ("21 %:"); default 21%
      let ivaRate = 0.21;
      for (const l of lines) {
        const rm = l.match(/^([\d,.]+)\s*%\s*:?$/);
        if (rm) { ivaRate = parseArFloat(rm[1]) / 100; break; }
      }

      const sinPerc = result.total - result.subtotalNeto + disc;        // Total excluye perc
      const conPerc = sinPerc - perc;                                    // Total incluye perc
      const expected = neto * ivaRate;
      const best = Math.abs(sinPerc - expected) <= Math.abs(conPerc - expected) ? sinPerc : conPerc;
      result.ivaAmount = parseFloat(best.toFixed(2));
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
 *
 * Al guardar el adjunto en disco los espacios del nombre original se
 * sanitizan a "_" (ej: "Nota de Pedido...pdf" → "Nota_de_Pedido...pdf").
 * Esta función se usa tanto contra el nombre recién llegado (mail/upload,
 * con espacios) como contra el nombre YA sanitizado guardado en la DB
 * (ej: al reparsear) — normalizar "_" a " " antes de comparar cubre ambos.
 */
function isNotaPedidoPDF(att) {
  if (!att || !att.filename) return false;
  const name = att.filename.toLowerCase().replace(/_/g, ' ');
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
function parseNotaPedidoItems(lines, catalog) {
  // Precio con decimales ANCLADOS a 2 dígitos — evita que dígitos posteriores
  // (ej: columna "Pendiente" pegada al unitario: "U$S 2,9210001") contaminen
  // el precio. Acepta "U$S" (dólares) o "$" (pesos — NPs de Mercado Libre).
  const PRICE_PAIR_RE = /(?:U\$S|\$)\s*([\d.]+,\d{2})\s*(?:U\$S|\$)\s*([\d.]+,\d{2})/;

  // Líneas candidatas a ser descripciones puras (sin precios, con texto)
  const descCandidates = lines.filter(l =>
    !/(?:U\$S|\$)\s*[\d.]+,\d{2}/.test(l) && l.length > 8 && /[A-Za-z]/.test(l) &&
    !/^(NOTA|DATOS|DETALLE|MYSELEC|ROWING|COMENTARIO|TRABAJO|Forma|Anticipo|Firma|FLETE|ORDEN|PRESUP|Responsable|Vendedor|Fecha|Operaci|Transpor|Dep|Localidad|Direcci|Telef|E-mail|C\.U\.I|Barrio|Provin|Condic|R\. Social)/i.test(l)
  );

  // Saca "{cantidad}{remitida}" concatenados del final del texto usando la
  // cantidad inferida por total/unitario (remitida casi siempre "0" al emitir
  // la NP). Devuelve el resto (el SKU limpio) o null si no pudo.
  // Ej: "739007-1500" con qty 50 → "739007-1" · "99612060" con qty 6 → "996120"
  function stripQtyRem(text, qty) {
    if (!(qty > 0)) return null;
    const qs = String(qty);
    for (const suffix of [qs + '0', qs + qs, qs]) {
      if (text.endsWith(suffix) && text.length > suffix.length) {
        return text.slice(0, -suffix.length).replace(/[\s,.]+$/, '');
      }
    }
    return null;
  }

  // Si el SKU extraído arrastra letras de una descripción truncada por el PDF
  // (ej: "LINEAET3499-000") y no existe tal cual en el catálogo, buscar un
  // código real del catálogo que sea sufijo exacto. Devuelve { sku, leftover }.
  function refineSkuWithCatalog(sku) {
    if (!sku || !catalog || catalog.length === 0) return { sku, leftover: '' };
    if (catalog.some(a => String(a.code || '').trim() === sku)) return { sku, leftover: '' };
    let best = null;
    for (const art of catalog) {
      const code = String(art.code || '').trim();
      if (code.length >= 4 && sku.endsWith(code) && sku.length > code.length) {
        if (!best || code.length > best.length) best = code;
      }
    }
    if (best) return { sku: best, leftover: sku.slice(0, -best.length).trim() };
    return { sku, leftover: '' };
  }

  // En las NP sin valorizar no hay precios contra los que deducir la cantidad,
  // asi que queda pegada al codigo ("EN9518-00060"). El catalogo permite
  // separarlos sin adivinar: se busca el codigo real como prefijo y lo que
  // sobra es "{cantidad}{remitida}". Verificado sobre 20 lineas de NP
  // valorizadas: en las 20 el PDF escribe la remitida como un 0 al final.
  function separarCodigoYCantidad(texto) {
    if (!texto || !catalog || !catalog.length) return null;
    let mejor = null;
    for (const art of catalog) {
      const code = String(art.code || '').trim();
      if (code.length < 4) continue;
      if (texto.startsWith(code) && texto.length > code.length) {
        if (!mejor || code.length > mejor.length) mejor = code;
      }
    }
    if (!mejor) return null;
    const sobra = texto.slice(mejor.length);
    if (!/^\d{2,}$/.test(sobra) || !sobra.endsWith('0')) return null;
    const cant = parseInt(sobra.slice(0, -1), 10);
    if (!(cant > 0)) return null;
    return { sku: mejor, qty: cant };
  }

  const items = [];
  for (const line of lines) {
    const priceM = line.match(PRICE_PAIR_RE);
    if (!priceM) continue;

    const beforePrices = line.slice(0, line.indexOf(priceM[0])).trim();
    if (!beforePrices) continue; // línea de totales (arranca con el precio)

    const total     = parseArFloat(priceM[1]); // primero = total
    const unitPrice = parseArFloat(priceM[2]); // segundo = unitario
    let   qty       = (unitPrice > 0 && total > 0) ? Math.round(total / unitPrice) : 0;

    // Hay notas de pedido internas que salen sin valorizar, con todos los
    // precios en 0,00. Antes se descartaba la linea entera y la NP quedaba sin
    // ningun articulo (MYS-0019). El pedido existe igual: se guarda con la
    // descripcion y el codigo, y el precio en blanco.
    const sinValorizar = total === 0 && unitPrice === 0;

    let sku         = null;
    let description = beforePrices;

    // Buscar descripción limpia que sea prefijo de la línea completa
    const matchDesc = descCandidates.find(d => beforePrices.startsWith(d) && beforePrices.length > d.length);
    if (matchDesc) {
      description = matchDesc.trim();
      const afterDesc = beforePrices.slice(matchDesc.length);

      // 1) Sacar {qty}{remitida} del final → lo que queda es el SKU exacto.
      //    (antes se adivinaba con regex \d{6}-\d{3} y mutilaba códigos como
      //    "739007-1" qty 50 → sku erróneo "739007-150")
      const stripped = stripQtyRem(afterDesc, qty);
      if (stripped !== null) {
        sku = stripped.length > 1 ? stripped : null;
        if (sku) {
          const refined = refineSkuWithCatalog(sku);
          if (refined.leftover) description = (description + ' ' + refined.leftover).trim();
          sku = refined.sku;
        }
      } else {
        // 2) Legacy (layout viejo): regex de SKU numérico + extensión con
        //    dígitos finales de la descripción
        const skuM = afterDesc.match(/^\d{0,2}?(\d{6}-\d{3})/);
        if (skuM) {
          sku = skuM[1].toUpperCase();
          const trailingDigits = description.match(/(\d+)$/)?.[1] || '';
          if (trailingDigits) {
            const extended = trailingDigits + sku;
            if (/^\d{4,}-\d{2,}$/.test(extended)) {
              sku = extended;
              description = description.slice(0, -trailingDigits.length).replace(/[\s.\-\/]+$/, '').trim();
            }
          }
        } else if (afterDesc.length > 2 && /[A-Za-z]/.test(afterDesc)) {
          // Código alfanumérico — quitar qty+remitida del final
          let code = afterDesc;
          if (qty > 0) {
            const re = new RegExp(String(qty).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d{0,2}$');
            code = code.replace(re, '');
          }
          code = code.replace(/[,.\s]+$/, '').trim();
          if (code.length > 1 && /[A-Za-z]/.test(code)) sku = code;
        }
      }
    } else {
      // Sin línea de descripción limpia: sacar {qty}{remitida} del final y
      // buscar el SKU numérico estándar de Flexxus (6 dígitos - sufijo)
      // anclado al final. Ej: "...XCX 150719783-1150" qty 15 →
      // strip "150" → "...XCX 150719783-1" → sku "719783-1", desc "...XCX 150"
      const strippedBP = stripQtyRem(beforePrices, qty);
      if (strippedBP !== null) {
        const tailSku = strippedBP.match(/^(.*?)(\d{6}-\d{1,3})$/);
        if (tailSku && tailSku[1].trim()) {
          sku = tailSku[2].toUpperCase();
          description = tailSku[1].trim();
        }
      }
      if (!sku) {
        const allSkuM = [...beforePrices.matchAll(/(\d{6}-\d{3})/g)];
        const lastSkuM = allSkuM[allSkuM.length - 1];
        if (lastSkuM) {
          sku = lastSkuM[1].toUpperCase();
          description = beforePrices.slice(0, lastSkuM.index).trim() || beforePrices;
        }
      }
    }

    // Fallback cuando no hubo matchDesc: stripear qty+remitida, luego fuzzy + cascada
    if (!sku && !matchDesc) {
      // Stripear qty+remitida del final: primero exacto (stripQtyRem), si no
      // el legacy con regex
      let textStripped = stripQtyRem(beforePrices, qty);
      if (textStripped === null) {
        textStripped = beforePrices;
        if (qty > 0) {
          const reQty = new RegExp(String(qty).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\d{0,2}$');
          textStripped = textStripped.replace(reQty, '').replace(/[,.\s]+$/, '').trim();
        }
      }
      const textForCascade = textStripped || beforePrices;

      // Fuzzy match: candidato con mayor prefijo común (>50%) como ancla de descripción
      let fuzzyFound = false;
      if (descCandidates.length > 0) {
        let bestCand = null, bestPLen = 0;
        for (const d of descCandidates) {
          let p = 0;
          while (p < d.length && p < textForCascade.length && d[p] === textForCascade[p]) p++;
          if (p > bestPLen) { bestPLen = p; bestCand = d; }
        }
        if (bestCand && bestPLen > bestCand.length * 0.5) {
          const lastWord = bestCand.match(/\S+$/)?.[0];
          if (lastWord) {
            const searchFrom = Math.max(0, bestPLen - lastWord.length);
            const pos = textForCascade.indexOf(lastWord, searchFrom);
            if (pos >= 0) {
              const descEnd = pos + lastWord.length;
              const codeCandidate = textForCascade.substring(descEnd).trim();
              if (codeCandidate) {
                description = textForCascade.substring(0, descEnd).trim();
                const refined = refineSkuWithCatalog(codeCandidate);
                if (refined.leftover) description = (description + ' ' + refined.leftover).trim();
                sku = refined.sku;
                fuzzyFound = true;
              }
            }
          }
        }
      }

      // Cascada de 5 filtros como último recurso
      if (!fuzzyFound) {
        const extracted = extractSkuFromText(textForCascade, catalog);
        if (extracted.sku) {
          sku = extracted.sku;
          description = extracted.description;
        } else {
          // Sin SKU detectable: al menos limpiar los dígitos de qty/remitida
          // que quedaron pegados a la descripción
          description = textForCascade;
        }
      }
    }

    // NP sin valorizar: recuperar la cantidad que quedo pegada al codigo
    if (sinValorizar && sku) {
      const sep = separarCodigoYCantidad(sku);
      if (sep) { sku = sep.sku; qty = sep.qty; }
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
async function parseNotaPedidoPDF(buffer, opts) {
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
    subtotalNeto:      null,   // subtotal neto
    ivaAmount:         null,   // monto IVA
    totalPercepciones: null,   // total percepciones
    total:         null,
    currency:      'USD', // "USD" | "ARS" — las NP de compras Mercado Libre vienen en pesos
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

    // ── Moneda: si ningún precio dice "U$S" pero hay montos en "$" → pesos ───
    const hasUsd = lines.some(l => /U\$S\s*[\d.]+,\d{2}/.test(l));
    if (!hasUsd && lines.some(l => /\$\s*[\d.]+,\d{2}/.test(l))) {
      result.currency = 'ARS';
    }

    // ── Número de OC del cliente (línea después de "Nº OC:") ─────────────────
    // Si la línea siguiente es otra etiqueta (ej: "Presupuesto:"), el campo
    // vino vacío en el PDF — no tomar la etiqueta como valor.
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'Nº OC:' && lines[i + 1] && !/:\s*$/.test(lines[i + 1])) {
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
        // "Presupuesto: 18111" (header) o "PRESUPUESTO18009" (comentario viejo)
        // "PR Nº: 000000018111" (comentario nuevo) o "PR-18009"
        const prM = line.match(/PRESUPUESTO\s*:?\s*(\d+)/i)
          || line.match(/\bPR\s*N[°º]?\s*:?\s*0*(\d+)/i)
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

    // ── Breakdown de precios + Total ──────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;

      // Subtotal neto (el layout nuevo de NP ya no lo imprime — ver fallback abajo)
      if (!result.subtotalNeto && /Subtotal[\s.]+Neto/i.test(line))
        result.subtotalNeto = getAdjacentMoney(lines, i);

      // Total percepciones — el layout nuevo usa la etiqueta "Percepciones:"
      if (result.totalPercepciones == null && /Total\s+Perc|^Percepciones\s*:/i.test(line))
        result.totalPercepciones = getAdjacentMoney(lines, i);

      // Grand total (acepta U$S o $)
      if (!result.total) {
        if ((m = line.match(/^Total\s*:\s*(?:U\$S|\$)\s*([\d,.]+)$/)))
          result.total = parseArFloat(m[1]);
        else if (/^Total\s*:?\s*$/.test(line))
          result.total = getAdjacentMoney(lines, i);
      }
    }

    // ── Ítems ─────────────────────────────────────────────────────────────────
    result.items = parseNotaPedidoItems(lines, opts && opts.catalog);

    // Layout nuevo: el PDF no imprime "Subtotal. Neto:" — derivarlo de los ítems
    if (result.subtotalNeto === null && result.items.length > 0) {
      const sum = result.items.reduce((s, it) => s + (it.total || 0), 0);
      result.subtotalNeto = parseFloat(sum.toFixed(2));
    }

    // Calcular IVA: Total = SubtotalNeto + IVA + Percepciones
    if (result.total != null && result.subtotalNeto != null && result.ivaAmount === null) {
      const perc = result.totalPercepciones || 0;
      result.ivaAmount = parseFloat((result.total - result.subtotalNeto - perc).toFixed(2));
    }

  } catch (err) {
    console.error('parseNotaPedidoPDF error:', err.message);
  }

  return result;
}

module.exports = { parseFlexxusPDF, isFlexxusPDF, isNotaPedidoPDF, parseNotaPedidoPDF, parseArFloat, extractSkuFromText };
