/* Data, helpers, atoms. Exports to window for cross-script use. */

// ---------- helpers ----------
const cx = (...xs) => xs.filter(Boolean).join(' ');
const fmtMoney = (n) => n == null ? '—' : '$ ' + n.toLocaleString('es-AR');
const fmtDate  = (d) => {
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }).replace('.','');
};
const fmtDateTime = (d) => {
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
};
const initialsOf = (name='') => name.split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();

// ---------- Lucide icon wrapper ----------
function Icon({ name, size = 16, className = '', strokeWidth = 2 }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!ref.current || !window.lucide) return;
    ref.current.innerHTML = '';
    const svg = window.lucide.createElement(window.lucide.icons[toPascal(name)] || window.lucide.icons.Circle);
    svg.setAttribute('width',  size);
    svg.setAttribute('height', size);
    svg.setAttribute('stroke-width', strokeWidth);
    ref.current.appendChild(svg);
  }, [name, size, strokeWidth]);
  return <span ref={ref} className={cx('inline-flex shrink-0', className)} aria-hidden="true" />;
}
function toPascal(k) {
  return k.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
}

// ---------- Logo ----------
function Logo({ size=28, tone='light' }) {
  // En fondo claro (login) envolvemos la imagen en un contenedor oscuro
  if (tone === 'dark') {
    return (
      <div style={{
        width: size, height: size,
        background: '#1B2A4A',
        borderRadius: Math.round(size * 0.22),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <img src="/Logo.png" alt="MySelec" style={{ width: size * 0.85, height: size * 0.85, objectFit: 'contain' }}/>
      </div>
    );
  }
  return (
    <img src="/Logo.png" alt="MySelec"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

// ---------- Avatar ----------
function Avatar({ name, size=24, tone, src }) {
  const palette = ['#1B2A4A','#2D4A6F','#3B82F6','#0EA5E9','#8B5CF6','#10B981','#F59E0B'];
  const idx = (name || '?').split('').reduce((a,c)=>a+c.charCodeAt(0),0) % palette.length;
  const bg = tone || palette[idx];
  if (src) {
    return (
      <img src={src} alt={name} title={name}
        className="rounded-full object-cover shrink-0"
        style={{ width:size, height:size }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold leading-none shrink-0"
      style={{ width:size, height:size, background:bg, fontSize: Math.max(10, size*0.42) }}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------- Badge / Chip ----------
function Badge({ tone='gray', children, dot=false }) {
  const tones = {
    gray:   'bg-ink-300/40 text-ink-700',
    blue:   'bg-brandSoft text-navy-900',
    navy:   'bg-navy-900 text-white',
    green:  'bg-emerald-100 text-emerald-800',
    amber:  'bg-amber-100 text-amber-800',
    red:    'bg-red-100 text-red-700',
    purple: 'bg-violet-100 text-violet-800',
    sky:    'bg-sky-100 text-sky-800',
    orange: 'bg-orange-100 text-orange-800',
    slate:  'bg-slate-200 text-slate-700',
  };
  const dotColor = {
    gray:'#94A3B8', blue:'#3B82F6', navy:'#1B2A4A', green:'#10B981',
    amber:'#F59E0B', red:'#EF4444', purple:'#8B5CF6', sky:'#0EA5E9', orange:'#F97316', slate:'#64748B'
  }[tone];
  return (
    <span className={cx('chip', tones[tone])}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{background:dotColor}}/>}
      {children}
    </span>
  );
}

// ---------- Domain data ----------
const USERS = [
  { id:'u-vl', name:'Victoria López',  role:'Administrador', email:'victoria@myselec.com.ar', zone:'—' },
  { id:'u-dg', name:'Diego Gómez',     role:'Administrador', email:'diego@myselec.com.ar',    zone:'—' },
  { id:'u-lp', name:'Luciano Pérez',   role:'Vendedor',      email:'luciano@myselec.com.ar',  zone:'AMBA Sur' },
  { id:'u-sr', name:'Santiago Ruiz',   role:'Vendedor',      email:'santiago@myselec.com.ar', zone:'Interior Oeste' },
  { id:'u-fm', name:'Felipe Morales',  role:'Vendedor',      email:'felipe@myselec.com.ar',   zone:'AMBA Norte' },
  { id:'u-lg', name:'Mariela Ibarra',  role:'Logística',     email:'depo1@myselec.com.ar',    zone:'Depósito Central' },
];

const CLIENTS = [
  { code:'CLI-001', name:'ARGENCRAFT S.A.',           cuit:'30-71045888-3', city:'Pilar',          prov:'Buenos Aires', zone:'AMBA Norte',  activity:'Tableros eléctricos',   seller:'u-lp', email:'compras@argencraft.com.ar', phone:'+54 11 4123-0912', address:'Panamericana Km 48, Pilar' },
  { code:'CLI-002', name:'ALPRE S.A.',                cuit:'30-69772311-5', city:'Córdoba',        prov:'Córdoba',      zone:'Interior Oeste', activity:'Obras eléctricas',    seller:'u-sr', email:'info@alpre.com',            phone:'+54 351 456-9210', address:'Av. Colón 2033, Córdoba' },
  { code:'CLI-003', name:'ANCIEN POSTE SA',           cuit:'33-71022199-9', city:'Rosario',        prov:'Santa Fe',     zone:'Interior Este',  activity:'Distribución eléctrica', seller:'u-fm', email:'ventas@ancienposte.com',    phone:'+54 341 533-0011', address:'Pellegrini 1433, Rosario' },
  { code:'CLI-004', name:'ARMAFERRO SA',              cuit:'30-50401922-8', city:'Avellaneda',     prov:'Buenos Aires', zone:'AMBA Sur',    activity:'Estructuras metálicas', seller:'u-lp', email:'admin@armaferro.com',       phone:'+54 11 4201-8833', address:'Av. Mitre 2100, Avellaneda' },
  { code:'CLI-005', name:'AMANECER DEL SUDESTE S.R.L.',cuit:'33-71188200-9', city:'Mar del Plata',  prov:'Buenos Aires', zone:'Interior Sur',   activity:'Energías renovables',   seller:'u-vl', email:'contacto@amanecer-se.com',  phone:'+54 223 455-6611', address:'Av. Constitución 5600, MDP' },
  { code:'CLI-006', name:'ACCIONAR RASA S.A.',        cuit:'30-70988765-2', city:'La Plata',       prov:'Buenos Aires', zone:'AMBA Sur',    activity:'Obras civiles',        seller:'u-sr', email:'contacto@accionar-rasa.com', phone:'+54 221 425-1220', address:'Calle 50 nro 900, La Plata' },
  { code:'CLI-007', name:'ELECTROSUR CUYO S.A.',      cuit:'30-71199421-7', city:'Mendoza',        prov:'Mendoza',      zone:'Interior Oeste', activity:'Distribución eléctrica', seller:'u-sr', email:'info@electrosurcuyo.com',   phone:'+54 261 422-9101', address:'San Martín 1200, Mendoza' },
  { code:'CLI-008', name:'INDUSTRIAS DEL NORTE SRL',  cuit:'30-68993400-1', city:'Salta',          prov:'Salta',        zone:'Interior Norte', activity:'Industria pesada',     seller:'u-fm', email:'compras@indnorte.com.ar',   phone:'+54 387 421-3301', address:'Ruta 9 Km 1612, Salta' },
  { code:'CLI-009', name:'COOPERATIVA LUZ Y FUERZA',  cuit:'30-52001122-4', city:'Trelew',         prov:'Chubut',       zone:'Patagonia',     activity:'Cooperativa eléctrica', seller:'u-vl', email:'administracion@lyftrelew.coop', phone:'+54 280 442-1122', address:'Av. Fontana 550, Trelew' },
  { code:'CLI-010', name:'CONSTRUCTORA DEL PLATA',    cuit:'30-70844332-0', city:'CABA',           prov:'CABA',         zone:'AMBA Norte',  activity:'Construcción',         seller:'u-lp', email:'info@delplata.com.ar',      phone:'+54 11 4815-3400', address:'Av. del Libertador 2300, CABA' },
  { code:'CLI-011', name:'METALÚRGICA SAN LUIS',      cuit:'30-71055601-9', city:'San Luis',       prov:'San Luis',     zone:'Interior Oeste', activity:'Metalúrgica',          seller:'u-sr', email:'compras@metsl.com',         phone:'+54 266 445-0120', address:'Parque Industrial, San Luis' },
  { code:'CLI-012', name:'OBRAS ELECTRICAS DEL LITORAL',cuit:'33-70012277-3', city:'Paraná',       prov:'Entre Ríos',   zone:'Interior Este',  activity:'Obras eléctricas',    seller:'u-fm', email:'obras@oelitoral.com.ar',    phone:'+54 343 430-9911', address:'Urquiza 1010, Paraná' },
  { code:'CLI-013', name:'AGROINDUSTRIA PAMPEANA',    cuit:'30-71388200-4', city:'Santa Rosa',     prov:'La Pampa',     zone:'Patagonia',     activity:'Agroindustria',        seller:'u-vl', email:'servicios@agropampeana.com', phone:'+54 2954 422-1000', address:'Av. San Martín 900, Santa Rosa' },
  { code:'CLI-014', name:'TRANSPORTADORA ENERGÉTICA', cuit:'30-50998101-6', city:'Neuquén',        prov:'Neuquén',      zone:'Patagonia',     activity:'Transporte de energía', seller:'u-sr', email:'contacto@transen.com.ar',   phone:'+54 299 448-7700', address:'Alderete 270, Neuquén' },
  { code:'CLI-015', name:'ILUMINACIÓN URBANA SA',     cuit:'30-71155477-8', city:'Bahía Blanca',   prov:'Buenos Aires', zone:'Interior Sur',   activity:'Alumbrado público',     seller:'u-lp', email:'licitaciones@ilumurba.com', phone:'+54 291 455-6601', address:'Av. Alem 800, Bahía Blanca' },
];

// ---------- Cotizaciones ----------
const STAGES_F1 = [
  { id:'recibida',    label:'Solicitud Recibida',  tone:'gray'   },
  { id:'asignada',    label:'Asignada',            tone:'blue'   },
  { id:'armado',      label:'En Armado',           tone:'navy'   },
  { id:'proveedor',   label:'Esperando Proveedor', tone:'amber'  },
  { id:'oferta',      label:'Oferta Técnica',      tone:'sky'    },
  { id:'enviado',     label:'Presupuesto Enviado', tone:'orange' },
  { id:'aceptada',    label:'Aceptada',            tone:'green'  },
  { id:'rechazada',   label:'Rechazada',           tone:'red'    },
];

const STAGES_F2 = [
  { id:'oc',          label:'OC Recibida',         tone:'gray'   },
  { id:'np',          label:'NP en Flexxus',       tone:'blue'   },
  { id:'stock',       label:'Verificando Stock',   tone:'amber'  },
  { id:'proveedor',   label:'Esperando Proveedor', tone:'orange' },
  { id:'armado',      label:'Armado de Pedido',    tone:'navy'   },
  { id:'facturada',   label:'Facturada',           tone:'purple' },
  { id:'transito',    label:'En Tránsito',         tone:'sky'    },
  { id:'entregada',   label:'Entregada',           tone:'green'  },
];

const QUOTES = [
  { code:'COT-2026-041', client:'CLI-001', seller:'u-lp', stage:'enviado',   ingreso:'2026-04-20', dias:3, monto:45200, adj:3, notas:4, flexxus:'PR-88120' },
  { code:'COT-2026-042', client:'CLI-002', seller:'u-sr', stage:'armado',    ingreso:'2026-04-23', dias:0, monto:null,  adj:1, notas:1, flexxus:'' },
  { code:'COT-2026-043', client:'CLI-003', seller:'u-fm', stage:'recibida',  ingreso:'2026-04-22', dias:1, monto:null,  adj:2, notas:0, flexxus:'' },
  { code:'COT-2026-038', client:'CLI-004', seller:'u-lp', stage:'aceptada',  ingreso:'2026-04-18', dias:5, monto:12800, adj:5, notas:6, flexxus:'PR-88092' },
  { code:'COT-2026-035', client:'CLI-006', seller:'u-sr', stage:'rechazada', ingreso:'2026-04-15', dias:8, monto:67500, adj:4, notas:3, flexxus:'PR-88044', rejectReason:'Precio' },
  { code:'COT-2026-044', client:'CLI-005', seller:'u-vl', stage:'proveedor', ingreso:'2026-04-21', dias:2, monto:null,  adj:2, notas:2, flexxus:'PR-88144' },
  { code:'COT-2026-039', client:'CLI-002', seller:'u-fm', stage:'oferta',    ingreso:'2026-04-22', dias:1, monto:23100, adj:3, notas:1, flexxus:'PR-88133' },
  { code:'COT-2026-040', client:'CLI-001', seller:'u-lp', stage:'asignada',  ingreso:'2026-04-23', dias:0, monto:null,  adj:1, notas:0, flexxus:'' },
  { code:'COT-2026-037', client:'CLI-010', seller:'u-lp', stage:'enviado',   ingreso:'2026-04-17', dias:6, monto:18900, adj:2, notas:2, flexxus:'PR-88066' },
  { code:'COT-2026-036', client:'CLI-012', seller:'u-fm', stage:'armado',    ingreso:'2026-04-19', dias:4, monto:null,  adj:1, notas:0, flexxus:'' },
  { code:'COT-2026-034', client:'CLI-009', seller:'u-vl', stage:'aceptada',  ingreso:'2026-04-12', dias:11,monto:31400, adj:4, notas:5, flexxus:'PR-87998' },
  { code:'COT-2026-033', client:'CLI-014', seller:'u-sr', stage:'proveedor', ingreso:'2026-04-14', dias:9, monto:null,  adj:2, notas:2, flexxus:'PR-87988' },
];

const ORDERS = [
  { code:'OC-2026-018', client:'CLI-001', seller:'u-lp', stage:'armado',    fromQuote:'COT-2026-038', entrega:'AMBA',     transp:'—',                        flexxus:'PR-88092', fecha:'2026-04-19' },
  { code:'OC-2026-016', client:'CLI-002', seller:'u-sr', stage:'transito',  fromQuote:'COT-2026-032', entrega:'Interior', transp:'Cruz del Sur',             flexxus:'PR-87890', fecha:'2026-04-12', guia:'CDS-884012' },
  { code:'OC-2026-019', client:'CLI-006', seller:'u-sr', stage:'stock',     fromQuote:'COT-2026-035', entrega:'AMBA',     transp:'—',                        flexxus:'PR-88044', fecha:'2026-04-22' },
  { code:'OC-2026-015', client:'CLI-004', seller:'u-lp', stage:'entregada', fromQuote:'COT-2026-029', entrega:'AMBA',     transp:'Propio',                   flexxus:'PR-87801', fecha:'2026-04-08' },
  { code:'OC-2026-017', client:'CLI-009', seller:'u-vl', stage:'facturada', fromQuote:'COT-2026-031', entrega:'Interior', transp:'Andesmar Cargas',          flexxus:'PR-87855', fecha:'2026-04-16' },
  { code:'OC-2026-020', client:'CLI-010', seller:'u-lp', stage:'oc',        fromQuote:'COT-2026-037', entrega:'AMBA',     transp:'—',                        flexxus:'PR-88066', fecha:'2026-04-23' },
  { code:'OC-2026-014', client:'CLI-012', seller:'u-fm', stage:'np',        fromQuote:'COT-2026-027', entrega:'Interior', transp:'—',                        flexxus:'—',        fecha:'2026-04-21' },
  { code:'OC-2026-013', client:'CLI-015', seller:'u-lp', stage:'proveedor', fromQuote:'COT-2026-025', entrega:'Interior', transp:'—',                        flexxus:'PR-87700', fecha:'2026-04-14' },
];

// ---------- Timeline activity ----------
const ACTIVITY = [
  { at:'2026-04-23T11:42:00', by:'u-vl', text:'Victoria asignó COT-2026-041 a Luciano' },
  { at:'2026-04-23T10:18:00', by:'u-sr', text:'Santiago movió COT-2026-038 a Presupuesto Enviado' },
  { at:'2026-04-23T09:55:00', by:'u-lp', text:'Luciano adjuntó “lista-precios-prov-abril.pdf” a COT-2026-041' },
  { at:'2026-04-22T17:30:00', by:'u-fm', text:'Felipe creó COT-2026-043 para ANCIEN POSTE SA' },
  { at:'2026-04-22T16:01:00', by:'u-lg', text:'Logística marcó OC-2026-018 como Armado de Pedido' },
  { at:'2026-04-22T14:22:00', by:'u-vl', text:'Victoria registró rechazo de COT-2026-035 — motivo: Precio' },
  { at:'2026-04-22T11:05:00', by:'u-lp', text:'Luciano agregó nota en COT-2026-040' },
];

// ---------- Bulk notes / comments (for detail screen) ----------
const COMMENTS = {
  'COT-2026-041': [
    { by:'u-vl', at:'2026-04-20T10:12:00', text:'Cliente prioritario, Argencraft confirmó que comparan 3 ofertas. Plazo de respuesta: viernes 26.' },
    { by:'u-lp', at:'2026-04-20T15:40:00', text:'Pedí cotización a Prysmian y Trefilcon. Espero respuesta de ambos.' },
    { by:'u-lp', at:'2026-04-21T09:28:00', text:'Trefilcon respondió, precio 6% arriba de lo esperado. Ajusto margen.' },
    { by:'u-lp', at:'2026-04-22T14:02:00', text:'Presupuesto enviado por mail. Total $ 45.200 + IVA.' },
  ]
};

// ---------- Chart data ----------
const CH_SELLERS = [
  { name:'Luciano',  cotiz: 14, ganadas: 8 },
  { name:'Santiago', cotiz: 11, ganadas: 5 },
  { name:'Felipe',   cotiz: 9,  ganadas: 4 },
  { name:'Victoria', cotiz: 6,  ganadas: 3 },
];
const CH_STAGE_DIST = [
  { name:'Recibida',  value: 3,  color:'#94A3B8' },
  { name:'Asignada',  value: 4,  color:'#3B82F6' },
  { name:'Armado',    value: 6,  color:'#1B2A4A' },
  { name:'Proveedor', value: 5,  color:'#F59E0B' },
  { name:'Oferta',    value: 3,  color:'#0EA5E9' },
  { name:'Enviado',   value: 8,  color:'#F97316' },
  { name:'Aceptada',  value: 11, color:'#10B981' },
  { name:'Rechazada', value: 4,  color:'#EF4444' },
];
const CH_MONTHLY = [
  { month:'Nov', recibidas: 28, ganadas: 14 },
  { month:'Dic', recibidas: 34, ganadas: 19 },
  { month:'Ene', recibidas: 41, ganadas: 22 },
  { month:'Feb', recibidas: 38, ganadas: 20 },
  { month:'Mar', recibidas: 44, ganadas: 26 },
  { month:'Abr', recibidas: 40, ganadas: 23 },
];

// Expose to other scripts
Object.assign(window, {
  cx, fmtMoney, fmtDate, fmtDateTime, initialsOf,
  Icon, Logo, Avatar, Badge,
  USERS, CLIENTS, QUOTES, ORDERS,
  STAGES_F1, STAGES_F2, ACTIVITY, COMMENTS,
  CH_SELLERS, CH_STAGE_DIST, CH_MONTHLY,
});
