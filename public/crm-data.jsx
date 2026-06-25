/* Data, helpers, atoms. Exports to window for cross-script use. */

// ---------- helpers ----------
const cx = (...xs) => xs.filter(Boolean).join(' ');
const fmtMoney = (n, cur, dec) => n == null ? '—' : (cur === 'ARS' ? 'AR$ ' : 'U$S ') + n.toLocaleString('es-AR', dec != null ? { minimumFractionDigits: dec, maximumFractionDigits: dec } : undefined);
const fmtDate  = (d) => {
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }).replace('.','');
};
const fmtDateTime = (d) => {
  const o = typeof d === 'string' ? new Date(d) : d;
  return o.toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
};
const initialsOf = (name='') => name.split(' ').map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
const authUrl = (path) => { const t = localStorage.getItem('crm_token'); return t ? `${path}?token=${encodeURIComponent(t)}` : path; };

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
        background: '#004669',
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
  const palette = ['#004669','#156D98','#20759E','#16A76E','#7C5AC7','#E5930A','#0A5A82'];
  const idx = (name || '?').split('').reduce((a,c)=>a+c.charCodeAt(0),0) % palette.length;
  const bg = tone || palette[idx];
  if (src) {
    return (
      <img src={src} alt={name} title={name}
        className="rounded-full object-cover shrink-0"
        style={{ width:size, height:size, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.8), 0 0 0 2.5px rgba(0,70,105,0.08)' }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold leading-none shrink-0"
      style={{
        width:size, height:size, background:bg,
        fontSize: Math.max(10, size*0.40),
        letterSpacing: '0.02em',
        boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.12)',
      }}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------- Badge / Chip ----------
function Badge({ tone='gray', children, dot=false }) {
  const tones = {
    gray:   'bg-ink-300/30 text-ink-700',
    blue:   'badge-blue',
    navy:   'bg-navy-900 text-white',
    green:  'badge-green',
    amber:  'badge-amber',
    red:    'badge-red',
    purple: 'badge-purple',
    sky:    'bg-sky-50 text-sky-800',
    orange: 'bg-orange-50 text-orange-800',
    slate:  'badge-gray',
  };
  const dotColor = {
    gray:'#939598', blue:'#20759E', navy:'#004669', green:'#16A76E',
    amber:'#E5930A', red:'#D93636', purple:'#7C5AC7', sky:'#20759E', orange:'#E5760A', slate:'#939598'
  }[tone];
  return (
    <span className={cx('chip', tones[tone])}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{background:dotColor}}/>}
      {children}
    </span>
  );
}

// ---------- Domain data ----------
// Datos iniciales vacíos — se reemplazan con los datos reales de la API al iniciar sesión
const USERS   = [];
const CLIENTS = [];

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

const QUOTES   = [];
const ORDERS   = [];
const ACTIVITY = [];
const COMMENTS = {};

// Chart data — vacío hasta que la API responda
const CH_SELLERS    = [];
const CH_STAGE_DIST = [];
const CH_MONTHLY    = [];

// Expose to other scripts
Object.assign(window, {
  cx, fmtMoney, fmtDate, fmtDateTime, authUrl,
  Icon, Logo, Avatar, Badge,
  USERS, CLIENTS, QUOTES, ORDERS,
  STAGES_F1, STAGES_F2, ACTIVITY, COMMENTS,
  CH_SELLERS, CH_STAGE_DIST, CH_MONTHLY,
});
