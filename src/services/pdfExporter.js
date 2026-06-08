/**
 * pdfExporter.js — Reportes PDF con identidad visual Myselec
 * Dos estilos: 'modern' (landscape) y 'executive' (portrait)
 */
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

// ─── Brand colors (manual de identidad 2022) ─────────────────────────────────
const C = {
  brand:      '#20759E',
  brandDark:  '#004669',
  black:      '#231F20',
  grayDark:   '#939598',
  grayMid:    '#BCBEC0',
  grayLight:  '#E8E9EA',
  grayBg:     '#F5F6F7',
  white:      '#FFFFFF',
  danger:     '#C0392B',
  success:    '#1A7A4C',
};

const LOGO_PATH = path.join(__dirname, '../../public/Logo.png');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n, cur) {
  if (n == null) return '—';
  return (cur === 'ARS' ? 'AR$ ' : 'U$S ') + Number(n).toLocaleString('es-AR');
}

function fmtDate(d) {
  if (!d) return '—';
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateShort(d) {
  if (!d) return '—';
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '');
}

function truncate(s, max) {
  if (!s) return '—';
  return s.length > max ? s.substring(0, max - 1) + '…' : s;
}

function nowStr() {
  return new Date().toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}


// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  PLAN A — "Modern" (Landscape)                                              ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

const LA = { width: 842, height: 595, margin: 40 };
const LA_CW = LA.width - LA.margin * 2;

function laFooter(doc, pg, total) {
  const y = LA.height - 28;
  doc.moveTo(LA.margin, y).lineTo(LA.width - LA.margin, y).lineWidth(0.5).strokeColor(C.grayMid).stroke();
  doc.font('Helvetica').fontSize(7).fillColor(C.grayDark)
    .text('Myselec SRL · Reporte generado desde CRM', LA.margin, y + 6, { width: LA_CW / 2 });
  doc.font('Helvetica').fontSize(7).fillColor(C.grayDark)
    .text(`Página ${pg} de ${total}`, LA.margin + LA_CW / 2, y + 6, { width: LA_CW / 2, align: 'right' });
}

function laHeader(doc, title, subtitle, filters) {
  const m = LA.margin;
  doc.rect(0, 0, LA.width, 4).fill(C.brand);
  doc.rect(0, 4, LA.width, 62).fill(C.brandDark);
  if (fs.existsSync(LOGO_PATH)) { try { doc.image(LOGO_PATH, m, 14, { height: 42 }); } catch (_) {} }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.white)
    .text(title, LA.width - m - 350, 16, { width: 350, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(C.grayMid)
    .text(subtitle, LA.width - m - 350, 36, { width: 350, align: 'right' });
  doc.font('Helvetica').fontSize(7).fillColor(C.grayMid)
    .text(nowStr(), LA.width - m - 350, 50, { width: 350, align: 'right' });

  let y = 78;
  if (filters && (filters.seller || filters.from || filters.to)) {
    const parts = [];
    if (filters.seller) parts.push(filters.seller);
    if (filters.from)   parts.push(`Desde ${fmtDate(filters.from)}`);
    if (filters.to)     parts.push(`Hasta ${fmtDate(filters.to)}`);
    let cx = m;
    parts.forEach(label => {
      const w = doc.font('Helvetica').fontSize(7.5).widthOfString(label) + 16;
      doc.roundedRect(cx, y, w, 18, 9).fill(C.grayBg);
      doc.font('Helvetica').fontSize(7.5).fillColor(C.brandDark).text(label, cx + 8, y + 4, { width: w - 16 });
      cx += w + 6;
    });
    y += 28;
  }
  return y;
}

function laKPIs(doc, y, kpis) {
  const gap = 10;
  const cardW = (LA_CW - (kpis.length - 1) * gap) / kpis.length;
  const cardH = 48;
  kpis.forEach((kpi, i) => {
    const x = LA.margin + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, cardH, 4).fill(C.white);
    doc.roundedRect(x, y, cardW, cardH, 4).lineWidth(0.5).strokeColor(C.grayLight).stroke();
    doc.rect(x, y + 4, 3, cardH - 8).fill(kpi.accent || C.brand);
    doc.font('Helvetica').fontSize(7).fillColor(C.grayDark).text(kpi.label.toUpperCase(), x + 12, y + 8, { width: cardW - 20 });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.black).text(kpi.value, x + 12, y + 22, { width: cardW - 20 });
  });
  return y + cardH + 14;
}

function laTable(doc, startY, columns, rows) {
  const m = LA.margin; const rowH = 20; const headerH = 24;
  const totalFlex = columns.reduce((s, c) => s + (c.flex || 1), 0);
  const colWidths = columns.map(c => (c.flex || 1) / totalFlex * LA_CW);
  let y = startY;

  function hdr(yy) {
    doc.rect(m, yy, LA_CW, headerH).fill(C.brandDark);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white);
    let x = m;
    columns.forEach((col, i) => {
      doc.text(col.header.toUpperCase(), x + 6, yy + 7, { width: colWidths[i] - 12, align: col.align || 'left', lineBreak: false });
      x += colWidths[i];
    });
    return yy + headerH;
  }
  y = hdr(y);

  rows.forEach((row, ri) => {
    if (y + rowH > LA.height - 45) {
      doc.addPage({ size: [LA.width, LA.height], margin: m });
      y = m; y = hdr(y);
    }
    if (ri % 2 === 0) doc.rect(m, y, LA_CW, rowH).fill(C.grayBg);
    let x = m;
    columns.forEach((col, i) => {
      const val = col.key ? (typeof col.key === 'function' ? col.key(row) : row[col.key]) : '';
      const text = val != null ? String(val) : '—';
      let color = C.black; if (col.color) color = col.color(row) || C.black;
      doc.font(col.bold ? 'Helvetica-Bold' : col.mono ? 'Courier' : 'Helvetica')
        .fontSize(7.5).fillColor(color)
        .text(text, x + 6, y + 6, { width: colWidths[i] - 12, align: col.align || 'left', lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
    doc.moveTo(m, y).lineTo(m + LA_CW, y).lineWidth(0.3).strokeColor(C.grayLight).stroke();
  });
  return y;
}

function laSummary(doc, y, items) {
  if (y + 34 > LA.height - 45) return y;
  y += 8;
  doc.roundedRect(LA.margin, y, LA_CW, 30, 4).fill(C.brandDark);
  const segW = LA_CW / items.length;
  items.forEach((item, i) => {
    const x = LA.margin + i * segW;
    doc.font('Helvetica').fontSize(7).fillColor(C.grayMid).text(item.label.toUpperCase(), x + 12, y + 4, { width: segW - 24, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white).text(item.value, x + 12, y + 14, { width: segW - 24, align: 'center' });
  });
  return y + 38;
}

function laFinalize(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); laFooter(doc, i + 1, range.count); }
}


// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║  PLAN B — "Executive" (Portrait)                                            ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

const PO = { width: 595, height: 842, margin: 36 };
const PO_CW = PO.width - PO.margin * 2;

function poFooter(doc, pg, total) {
  const y = PO.height - 26;
  doc.rect(0, y - 4, PO.width, 30).fill(C.brandDark);
  doc.font('Helvetica').fontSize(6.5).fillColor(C.grayMid)
    .text('Myselec SRL', PO.margin, y + 2, { width: PO_CW / 3 });
  doc.font('Helvetica').fontSize(6.5).fillColor(C.grayMid)
    .text(nowStr(), PO.margin + PO_CW / 3, y + 2, { width: PO_CW / 3, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor(C.grayMid)
    .text(`${pg} / ${total}`, PO.margin + (PO_CW / 3) * 2, y + 2, { width: PO_CW / 3, align: 'right' });
}

function poHeader(doc, title, subtitle, filters) {
  const m = PO.margin;

  // Clean white header with bottom brand line
  if (fs.existsSync(LOGO_PATH)) { try { doc.image(LOGO_PATH, m, m, { height: 32 }); } catch (_) {} }

  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.brandDark)
    .text(title, m, m + 42);

  doc.font('Helvetica').fontSize(9).fillColor(C.grayDark)
    .text(subtitle, m, m + 64);

  // Brand line
  let y = m + 82;
  doc.rect(m, y, PO_CW, 2.5).fill(C.brand);
  y += 10;

  // Filters inline
  if (filters && (filters.seller || filters.from || filters.to)) {
    const parts = [];
    if (filters.seller) parts.push(`Vendedor: ${filters.seller}`);
    if (filters.from)   parts.push(`Desde: ${fmtDate(filters.from)}`);
    if (filters.to)     parts.push(`Hasta: ${fmtDate(filters.to)}`);
    doc.font('Helvetica').fontSize(7.5).fillColor(C.grayDark).text(parts.join('  ·  '), m, y);
    y += 16;
  }
  return y;
}

function poKPIs(doc, y, kpis) {
  const m = PO.margin;
  const cols = Math.min(kpis.length, 3);
  const rows = Math.ceil(kpis.length / cols);
  const gap = 8;
  const cardW = (PO_CW - (cols - 1) * gap) / cols;
  const cardH = 52;

  kpis.forEach((kpi, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = m + col * (cardW + gap);
    const cy = y + row * (cardH + gap);

    doc.roundedRect(x, cy, cardW, cardH, 5).fill(C.grayBg);
    doc.rect(x, cy + 6, 3, cardH - 12).fill(kpi.accent || C.brand);

    doc.font('Helvetica').fontSize(7.5).fillColor(C.grayDark)
      .text(kpi.label.toUpperCase(), x + 14, cy + 10, { width: cardW - 24 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.brandDark)
      .text(kpi.value, x + 14, cy + 26, { width: cardW - 24 });
  });

  return y + rows * (cardH + gap) + 6;
}

function poTable(doc, startY, columns, rows) {
  const m = PO.margin; const rowH = 18; const headerH = 22;
  const totalFlex = columns.reduce((s, c) => s + (c.flex || 1), 0);
  const colWidths = columns.map(c => (c.flex || 1) / totalFlex * PO_CW);
  let y = startY;

  function hdr(yy) {
    doc.rect(m, yy, PO_CW, headerH).fill(C.brand);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white);
    let x = m;
    columns.forEach((col, i) => {
      doc.text(col.header.toUpperCase(), x + 4, yy + 6, { width: colWidths[i] - 8, align: col.align || 'left', lineBreak: false });
      x += colWidths[i];
    });
    return yy + headerH;
  }
  y = hdr(y);

  rows.forEach((row, ri) => {
    if (y + rowH > PO.height - 42) {
      doc.addPage({ size: [PO.width, PO.height], margin: m });
      y = m; y = hdr(y);
    }
    if (ri % 2 === 1) doc.rect(m, y, PO_CW, rowH).fill(C.grayBg);

    let x = m;
    columns.forEach((col, i) => {
      const val = col.key ? (typeof col.key === 'function' ? col.key(row) : row[col.key]) : '';
      const text = val != null ? String(val) : '—';
      let color = C.black; if (col.color) color = col.color(row) || C.black;
      doc.font(col.bold ? 'Helvetica-Bold' : col.mono ? 'Courier' : 'Helvetica')
        .fontSize(7).fillColor(color)
        .text(text, x + 4, y + 5, { width: colWidths[i] - 8, align: col.align || 'left', lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
    if (ri % 2 === 0) doc.moveTo(m, y).lineTo(m + PO_CW, y).lineWidth(0.2).strokeColor(C.grayLight).stroke();
  });
  return y;
}

function poSummary(doc, y, items) {
  if (y + 28 > PO.height - 42) return y;
  y += 6;
  doc.rect(PO.margin, y, PO_CW, 2).fill(C.brand);
  y += 8;
  const segW = PO_CW / items.length;
  items.forEach((item, i) => {
    const x = PO.margin + i * segW;
    doc.font('Helvetica').fontSize(7).fillColor(C.grayDark).text(item.label.toUpperCase(), x, y, { width: segW, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.brandDark).text(item.value, x, y + 10, { width: segW, align: 'center' });
  });
  return y + 30;
}

function poFinalize(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); poFooter(doc, i + 1, range.count); }
}


// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE 1: Cotizaciones
// ═══════════════════════════════════════════════════════════════════════════════

async function generateCotizaciones(quotes, { filters, stages, style } = {}) {
  const exec = style === 'executive';
  const pg = exec ? PO : LA;
  const doc = new PDFDocument({ size: [pg.width, pg.height], margin: pg.margin, autoFirstPage: true, bufferPages: true });
  const buffers = []; doc.on('data', b => buffers.push(b));

  let y = (exec ? poHeader : laHeader)(doc, 'Reporte de Cotizaciones', `${quotes.length} cotizaciones`, filters);

  const totalUSD = quotes.filter(q => (q.currency || 'USD') !== 'ARS').reduce((s, q) => s + (q.amount || 0), 0);
  const totalARS = quotes.filter(q => q.currency === 'ARS').reduce((s, q) => s + (q.amount || 0), 0);
  const enviados = quotes.filter(q => q.stage === 'enviado').length;
  const aceptadas = quotes.filter(q => q.stage === 'aceptada').length;

  y = (exec ? poKPIs : laKPIs)(doc, y, [
    { label: 'Total cotizaciones', value: String(quotes.length) },
    { label: 'Enviados', value: String(enviados) },
    { label: 'Aceptadas', value: String(aceptadas) },
    { label: 'Monto USD', value: totalUSD > 0 ? fmtMoney(Math.round(totalUSD), 'USD') : '—', accent: '#1e40af' },
    { label: 'Monto ARS', value: totalARS > 0 ? fmtMoney(Math.round(totalARS), 'ARS') : '—', accent: C.success },
  ]);

  const stageMap = {};
  if (stages) stages.forEach(s => { stageMap[s.stageKey] = s.label; });

  const trun = exec ? 20 : 28;
  const columns = [
    { header: 'Código',   key: 'code',       flex: 1.2, mono: true, bold: true },
    { header: 'Cliente',  key: r => truncate(r.clientName, trun), flex: 2.5 },
    { header: 'Vendedor', key: r => truncate(r.sellerName, exec ? 12 : 16), flex: 1.4 },
    { header: 'Etapa',    key: r => stageMap[r.stage] || r.stage, flex: 1.3 },
    ...(!exec ? [{ header: 'Tipo', key: r => r.mailType || 'MANUAL', flex: 1 }] : []),
    { header: 'Mon.',     key: r => r.currency || 'USD', flex: 0.6 },
    { header: 'Monto',    key: r => r.amount != null ? fmtMoney(r.amount, r.currency) : '—', flex: 1.5, align: 'right', bold: true },
    { header: 'Días',     key: r => r.dias != null ? `${r.dias}d` : '—', flex: 0.5, align: 'right',
      color: r => r.dias >= 5 ? C.danger : C.black },
    { header: 'Ingreso',  key: r => fmtDateShort(r.createdAt), flex: 0.9, align: 'right' },
  ];

  const rows = quotes.map(q => ({
    code: q.code, clientName: q.client?.name || '—', sellerName: q.seller?.name || '—',
    stage: q.stage, mailType: q.mailType, currency: q.currency || 'USD', amount: q.amount,
    dias: Math.floor((Date.now() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    createdAt: q.createdAt,
  }));

  y = (exec ? poTable : laTable)(doc, y, columns, rows);

  const summary = [];
  if (totalUSD > 0) summary.push({ label: 'Total USD', value: fmtMoney(Math.round(totalUSD), 'USD') });
  if (totalARS > 0) summary.push({ label: 'Total ARS', value: fmtMoney(Math.round(totalARS), 'ARS') });
  summary.push({ label: 'Registros', value: String(quotes.length) });
  (exec ? poSummary : laSummary)(doc, y, summary);

  (exec ? poFinalize : laFinalize)(doc);
  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
}


// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE 2: Rechazos
// ═══════════════════════════════════════════════════════════════════════════════

async function generateRechazos(quotes, { filters, style } = {}) {
  const exec = style === 'executive';
  const pg = exec ? PO : LA;
  const doc = new PDFDocument({ size: [pg.width, pg.height], margin: pg.margin, autoFirstPage: true, bufferPages: true });
  const buffers = []; doc.on('data', b => buffers.push(b));

  let y = (exec ? poHeader : laHeader)(doc, 'Análisis de Rechazos', `${quotes.length} oportunidades perdidas`, filters);

  const totalUSD = quotes.filter(q => (q.currency || 'USD') !== 'ARS').reduce((s, q) => s + (q.amount || 0), 0);
  const totalARS = quotes.filter(q => q.currency === 'ARS').reduce((s, q) => s + (q.amount || 0), 0);
  const avgDias = quotes.length
    ? Math.round(quotes.reduce((s, q) => s + Math.floor((new Date(q.updatedAt).getTime() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60 * 24)), 0) / quotes.length)
    : 0;

  const reasonCounts = {};
  quotes.forEach(q => { const r = q.rejectReason || 'Sin especificar'; reasonCounts[r] = (reasonCounts[r] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  y = (exec ? poKPIs : laKPIs)(doc, y, [
    { label: 'Total rechazos', value: String(quotes.length), accent: C.danger },
    { label: 'Perdido USD', value: totalUSD > 0 ? fmtMoney(Math.round(totalUSD), 'USD') : '—', accent: C.danger },
    { label: 'Perdido ARS', value: totalARS > 0 ? fmtMoney(Math.round(totalARS), 'ARS') : '—', accent: C.danger },
    { label: 'Días prom.', value: `${avgDias}d` },
    { label: 'Motivo principal', value: topReason ? truncate(topReason[0], 18) : '—' },
  ]);

  const trun = exec ? 18 : 25;
  const columns = [
    { header: 'Código',   key: 'code', flex: 1.1, mono: true, bold: true },
    { header: 'Cliente',  key: r => truncate(r.clientName, trun), flex: 2.2 },
    { header: 'Vendedor', key: r => truncate(r.sellerName, exec ? 10 : 14), flex: 1.2 },
    { header: 'Motivo',   key: r => truncate(r.rejectReason, exec ? 16 : 22), flex: 2, bold: true, color: () => C.danger },
    { header: 'Mon.',     key: r => r.currency || 'USD', flex: 0.5 },
    { header: 'Monto',    key: r => r.amount != null ? fmtMoney(r.amount, r.currency) : '—', flex: 1.3, align: 'right', bold: true },
    { header: 'Días',     key: r => `${r.diasHastaRechazo}d`, flex: 0.5, align: 'right' },
    { header: 'Rechazo',  key: r => fmtDateShort(r.updatedAt), flex: 0.9, align: 'right' },
  ];

  const rows = quotes.map(q => ({
    code: q.code, clientName: q.client?.name || '—', sellerName: q.seller?.name || '—',
    rejectReason: q.rejectReason || 'Sin especificar', currency: q.currency || 'USD',
    amount: q.amount,
    diasHastaRechazo: Math.floor((new Date(q.updatedAt).getTime() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    updatedAt: q.updatedAt,
  }));

  y = (exec ? poTable : laTable)(doc, y, columns, rows);

  const summary = [];
  if (totalUSD > 0) summary.push({ label: 'Perdido USD', value: fmtMoney(Math.round(totalUSD), 'USD') });
  if (totalARS > 0) summary.push({ label: 'Perdido ARS', value: fmtMoney(Math.round(totalARS), 'ARS') });
  summary.push({ label: 'Total rechazos', value: String(quotes.length) });
  (exec ? poSummary : laSummary)(doc, y, summary);

  (exec ? poFinalize : laFinalize)(doc);
  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
}


// ═══════════════════════════════════════════════════════════════════════════════
// REPORTE 3: Órdenes de Compra
// ═══════════════════════════════════════════════════════════════════════════════

async function generateOrdenes(orders, { filters, stages, style } = {}) {
  const exec = style === 'executive';
  const pg = exec ? PO : LA;
  const doc = new PDFDocument({ size: [pg.width, pg.height], margin: pg.margin, autoFirstPage: true, bufferPages: true });
  const buffers = []; doc.on('data', b => buffers.push(b));

  let y = (exec ? poHeader : laHeader)(doc, 'Reporte de Órdenes de Compra', `${orders.length} órdenes`, filters);

  const stageMap = {};
  if (stages) stages.forEach(s => { stageMap[s.stageKey] = s.label; });
  const lastStage = stages?.[stages.length - 1]?.stageKey;
  const entregadas = orders.filter(o => o.stage === lastStage).length;
  const enCurso = orders.filter(o => o.stage !== lastStage).length;
  const conTracking = orders.filter(o => o.trackingNumber).length;

  y = (exec ? poKPIs : laKPIs)(doc, y, [
    { label: 'Total órdenes', value: String(orders.length) },
    { label: 'En curso', value: String(enCurso), accent: '#D4A017' },
    { label: 'Entregadas', value: String(entregadas), accent: C.success },
    { label: 'Con tracking', value: String(conTracking) },
  ]);

  const trun = exec ? 18 : 25;
  const columns = [
    { header: 'Código OC', key: 'code', flex: 1.1, mono: true, bold: true },
    { header: 'Cliente',   key: r => truncate(r.clientName, trun), flex: 2.2 },
    { header: 'Vendedor',  key: r => truncate(r.sellerName, exec ? 10 : 14), flex: 1.2 },
    { header: 'Etapa',     key: r => stageMap[r.stage] || r.stage, flex: 1.3 },
    { header: 'OC Cliente',key: r => r.clientOCCode || '—', flex: 1, mono: true },
    ...(!exec ? [{ header: 'NP Flexxus', key: r => r.flexxusCode || '—', flex: 1, mono: true }] : []),
    { header: 'Transporte',key: r => truncate(r.carrier, exec ? 12 : 16), flex: 1.1 },
    { header: 'Tracking',  key: r => r.trackingNumber || '—', flex: 1.1, mono: true },
    { header: 'Creada',    key: r => fmtDateShort(r.createdAt), flex: 0.8, align: 'right' },
  ];

  const rows = orders.map(o => ({
    code: o.code, clientName: o.client?.name || '—', sellerName: o.seller?.name || '—',
    stage: o.stage, clientOCCode: o.clientOCCode, flexxusCode: o.flexxusCode,
    carrier: o.carrier, trackingNumber: o.trackingNumber, createdAt: o.createdAt,
  }));

  y = (exec ? poTable : laTable)(doc, y, columns, rows);

  (exec ? poSummary : laSummary)(doc, y, [
    { label: 'Total', value: String(orders.length) },
    { label: 'En curso', value: String(enCurso) },
    { label: 'Entregadas', value: String(entregadas) },
  ]);

  (exec ? poFinalize : laFinalize)(doc);
  doc.end();
  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
}


module.exports = { generateCotizaciones, generateRechazos, generateOrdenes };
