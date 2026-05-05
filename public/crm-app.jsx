/* CRM MySelec — App shell: login, sidebar, topbar, role routing.
   Depends on: crm-data.jsx, crm-interact.jsx, crm-kanban.jsx, crm-details.jsx, crm-views.jsx */

const { useState, useEffect } = React;

function AppRoot() {
  const [logged, setLogged] = useState(CrmAuth.isLoggedIn());
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(true);

  // On login or if already has token, load API data
  useEffect(() => {
    if (!logged) { setLoading(false); return; }
    setLoading(true);
    loadAllData().then(data => {
      if (data) {
        // Replace window globals with API data
        window.USERS = data.users;
        window.CLIENTS = data.clients;
        window.QUOTES = data.quotes;
        window.ORDERS = data.orders;
        window.STAGES_F1 = data.stagesF1;
        window.STAGES_F2 = data.stagesF2;
        window.ACTIVITY = data.activity;
        setApiData(data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [logged]);

  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950">
      <div className="text-center">
        <Logo size={48} />
        <div className="text-white/60 mt-4 text-sm">Cargando sistema...</div>
      </div>
    </div>
  );

  return (
    <AppProvider key={apiData ? 'api' : 'static'}>
      <App/>
    </AppProvider>
  );
}

function App() {
  const { roleKey, setRoleKey, currentUserId, setCurrentUserId, users, openModal, closeAllModals } = useApp();
  const [screen, setScreen] = useState('dashboard');
  const loggedUser = CrmAuth.getUser();

  // Initialize role and user ID from token on mount
  useEffect(() => {
    if (!loggedUser) return;
    const roleMap = { ADMIN: 'admin', VENDEDOR: 'seller', LOGISTICA: 'logistics' };
    setCurrentUserId(loggedUser.id);
    setRoleKey(roleMap[loggedUser.role] || 'admin');
  }, []);

  // Update screen (and keep currentUserId real) when role switches
  useEffect(() => {
    if (!loggedUser) return;
    setCurrentUserId(loggedUser.id);
    if (roleKey === 'admin')     setScreen('dashboard');
    if (roleKey === 'seller')    setScreen('my-quotes');
    if (roleKey === 'logistics') setScreen('ops');
  }, [roleKey]);

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openModal('search');
      }
      if (e.key === 'Escape') closeAllModals();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal, closeAllModals]);

  const user = users.find(u => u.id === currentUserId) || users[0];

  const openDetail = (code, kind='quote') => openModal(kind==='quote'?'quoteDetail':'orderDetail', { code });

  return (
    <div className="min-h-screen flex bg-surface" data-screen-label={`${roleKey} · ${screen}`}>
      <Sidebar role={roleKey} screen={screen} setScreen={setScreen}/>
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar user={user} roleKey={roleKey} setRoleKey={setRoleKey}/>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {screen === 'dashboard'  && <Dashboard/>}
          {screen === 'quotes'     && <KanbanQuotes onOpen={(c)=>openDetail(c,'quote')}/>}
          {screen === 'orders'     && <KanbanOrders onOpen={(c)=>openDetail(c,'order')}/>}
          {screen === 'my-quotes'  && <MySalesView user={user} initialTab="quotes" onOpen={openDetail}/>}
          {screen === 'my-orders'  && <MySalesView user={user} initialTab="orders" onOpen={openDetail}/>}
          {screen === 'ops'        && <LogisticsView onOpen={(c)=>openDetail(c,'order')}/>}
          {screen === 'clients'    && <Clients readonly={roleKey!=='admin'}/>}
          {screen === 'team'       && <Team/>}
          {screen === 'config'     && <Config/>}
        </main>
      </div>
    </div>
  );
}

// ---------- Login ----------
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await CrmApi.login(email, pass);
      CrmAuth.setToken(result.token);
      CrmAuth.setUser(result.user);
      onLogin();
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.08]" style={{
        backgroundImage:'radial-gradient(circle at 20% 30%, #3B82F6 0, transparent 40%), radial-gradient(circle at 80% 70%, #3B82F6 0, transparent 35%)'
      }}/>
      <div className="absolute inset-0" style={{
        backgroundImage:'linear-gradient(#ffffff09 1px, transparent 1px), linear-gradient(90deg, #ffffff09 1px, transparent 1px)',
        backgroundSize:'40px 40px'
      }}/>

      <div className="relative flex items-center justify-center p-8">
        <form onSubmit={handleSubmit}
              className="w-full max-w-sm bg-white rounded-2xl shadow-pop p-8 border border-line">
          <div className="flex items-center gap-2 mb-6">
            <Logo size={28} tone="dark"/>
            <div className="font-bold tracking-wider">MYSELEC</div>
          </div>
          <h2 className="text-xl font-bold text-ink-900">Iniciar sesión</h2>
          <p className="text-sm text-ink-500 mb-6">Ingresá con tu cuenta corporativa.</p>
          {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
          <label className="block text-xs font-medium text-ink-700 mb-1.5">Email</label>
          <input className="inp w-full mb-4" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@myselec.com.ar" />
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-ink-700">Contraseña</label>
          </div>
          <input type="password" className="inp w-full mb-6" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" />
          <button className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? 'Ingresando...' : 'Iniciar sesión'}
          </button>
          <div className="mt-6 pt-5 border-t border-line text-center">
            <div className="text-[11px] uppercase tracking-wider text-ink-400">Sistema de Gestión Comercial</div>
            <div className="text-xs text-ink-500 mt-0.5">MySelec · v2026.04</div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- Sidebar ----------
function Sidebar({ role, screen, setScreen }) {
  const navAdmin = [
    { id:'dashboard', label:'Dashboard',             icon:'layout-dashboard' },
    { id:'quotes',    label:'Cotizaciones',          icon:'clipboard-list', sub:'Fase 1' },
    { id:'orders',    label:'Órdenes de Compra',     icon:'package',        sub:'Fase 2' },
    { id:'clients',   label:'Clientes',              icon:'building-2' },
    { id:'team',      label:'Equipo',                icon:'users' },
    { id:'config',    label:'Configuración',         icon:'settings' },
  ];
  const navSeller = [
    { id:'my-quotes', label:'Mis Cotizaciones',      icon:'clipboard-list' },
    { id:'my-orders', label:'Mis Órdenes de Compra', icon:'package' },
    { id:'quotes',    label:'Pipeline Cotizaciones', icon:'layout',     sub:'Kanban Fase 1' },
    { id:'orders',    label:'Pipeline OCs',          icon:'columns',    sub:'Kanban Fase 2' },
    { id:'clients',   label:'Clientes',              icon:'building-2', sub:'solo lectura' },
  ];
  const navLog = [
    { id:'ops',       label:'Operaciones',           icon:'truck', sub:'Fase 2' },
  ];
  const nav = role === 'admin' ? navAdmin : role === 'seller' ? navSeller : navLog;

  return (
    <aside className="w-[244px] shrink-0 bg-navy-900 text-white flex flex-col min-h-screen">
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5 border-b border-white/5">
        <Logo size={32}/>
        <div>
          <div className="font-bold tracking-wider text-[15px]">MYSELEC</div>
          <div className="text-[10px] uppercase tracking-[.18em] text-white/45">CRM Comercial</div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5">
        <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-white/35 font-semibold">
          {role==='admin' ? 'Gestión' : role==='seller' ? 'Mi pipeline' : 'Operaciones'}
        </div>
        {nav.map(n => (
          <button key={n.id} onClick={()=>setScreen(n.id)}
            className={cx(
              'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-left transition-colors',
              screen === n.id
                ? 'bg-brand text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                : 'text-white/75 hover:bg-white/5 hover:text-white'
            )}
          >
            <Icon name={n.icon} size={17}/>
            <span className="flex-1 leading-tight">
              {n.label}
              {n.sub && <span className="block text-[10px] uppercase tracking-wider opacity-60 font-medium">{n.sub}</span>}
            </span>
          </button>
        ))}
      </nav>

      <div className="mx-3 mb-3 rounded-xl bg-white/5 border border-white/10 p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon name="sparkles" size={14} className="text-brand"/>
          <span className="text-[11px] uppercase tracking-wider text-white/60 font-semibold">Novedades</span>
        </div>
        <p className="text-[12px] text-white/75 leading-snug">
          Nueva integración con Flexxus. El código NP se sincroniza automáticamente al cargar una OC.
        </p>
      </div>

      <div className="px-4 py-3 border-t border-white/5 text-[11px] text-white/40 font-mono">
        v2026.04 · conectado
      </div>
    </aside>
  );
}

// ---------- Topbar ----------
function Topbar({ user, roleKey, setRoleKey }) {
  const { notifications, openModal, pushToast } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const loggedUser = CrmAuth.getUser();
  const isAdmin = loggedUser?.role === 'ADMIN';
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await CrmApi.syncMail();
      if (result.synced > 0) {
        pushToast(`${result.synced} cotización(es) ingresada(s) desde mail`, 'ok');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        pushToast('No hay mails nuevos', 'info');
      }
    } catch (err) {
      pushToast('Error al sincronizar: ' + err.message, 'bad');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    CrmAuth.clearToken();
    localStorage.removeItem('crm_user');
    window.location.reload();
  };

  const title = {
    admin: 'Vista Administrador', seller: 'Vista Vendedor', logistics: 'Vista Logística'
  }[roleKey];
  return (
    <header className="h-[62px] bg-white border-b border-line flex items-center gap-4 px-6 shrink-0 relative">
      <div className="flex items-center gap-2 text-sm flex-1">
        <Icon name="home" size={13} className="text-ink-400"/>
        <span className="text-ink-500">MySelec CRM</span>
        <Icon name="chevron-right" size={12} className="text-ink-300"/>
        <span className="font-semibold text-ink-900">{title}</span>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-1.5 bg-surface rounded-lg p-1 border border-line">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 px-2">Vista</span>
          {[
            {k:'admin',     l:'Admin'},
            {k:'seller',    l:'Vendedor'},
            {k:'logistics', l:'Logística'},
          ].map(o => (
            <button key={o.k} onClick={()=>setRoleKey(o.k)}
              className={cx(
                'text-xs font-medium px-2.5 py-1 rounded-md transition-colors',
                roleKey === o.k ? 'bg-white text-navy-900 shadow-sm border border-line' : 'text-ink-500 hover:text-ink-900'
              )}
            >{o.l}</button>
          ))}
        </div>
      )}

      <button onClick={()=>openModal('search')}
        className="relative hidden md:inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-surface hover:bg-white hover:border-line border border-transparent text-ink-500 text-xs">
        <Icon name="search" size={14}/>
        <span>Buscar…</span>
        <kbd className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border border-line bg-white text-ink-500">⌘K</kbd>
      </button>

      {roleKey === 'admin' && (
        <button onClick={handleSync} disabled={syncing}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-brand/10 hover:bg-brand/20 text-brand text-xs font-medium border border-brand/20 transition-colors">
          <Icon name="mail" size={14}/>
          {syncing ? 'Sincronizando...' : 'Sincronizar Mail'}
        </button>
      )}

      <div className="relative">
        <button onClick={()=>setNotifOpen(o=>!o)}
          className="relative w-9 h-9 rounded-lg hover:bg-surface flex items-center justify-center text-ink-700">
          <Icon name="bell" size={17}/>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span>
          )}
        </button>
        {notifOpen && <NotificationsPopover onClose={()=>setNotifOpen(false)}/>}
      </div>

      <div className="flex items-center gap-2.5 pl-3 border-l border-line">
        <Avatar name={user.name} size={32}/>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink-900">{user.name}</div>
          <div className="text-[11px] text-ink-500">{user.role} · {user.zone || '—'}</div>
        </div>
        <button onClick={handleLogout} title="Cerrar sesión" className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-400 hover:text-bad">
          <Icon name="log-out" size={15}/>
        </button>
      </div>
    </header>
  );
}

// ---------- Dashboard ----------
function Dashboard() {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
          PieChart, Pie, Cell, AreaChart, Area } = window.Recharts;
  const { quotes, users, clients, activity, openModal } = useApp();
  const [exportOpen, setExportOpen] = useState(false);
  const [kpisData, setKpisData] = useState(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [chartSellers, setChartSellers] = useState(null);
  const [chartStages, setChartStages] = useState(null);
  const [chartMonthly, setChartMonthly] = useState(null);

  useEffect(() => {
    Promise.all([
      CrmApi.getDashboard(),
      CrmApi.getChartSellers(),
      CrmApi.getChartStages(),
      CrmApi.getChartMonthly(),
    ]).then(([dash, sellers, stages, monthly]) => {
      setKpisData(dash);
      setChartSellers(sellers);
      setChartStages(stages);
      setChartMonthly(monthly);
      setKpisLoading(false);
    }).catch(() => setKpisLoading(false));
  }, []);

  const kv = (val) => kpisLoading ? '...' : (val ?? '—');

  const kpis = [
    { label:'Cotizaciones activas',  value: kv(kpisData?.cotizacionesActivas) },
    { label:'Presupuestos enviados', value: kv(kpisData?.presupuestosEnviados) },
    { label:'OC en curso',           value: kv(kpisData?.ocEnCurso) },
    { label:'Entregas este mes',     value: kv(kpisData?.entregasEsteMes) },
    { label:'Monto total cotizado',  value: kpisLoading ? '...' : (kpisData?.montoTotal ? `USD ${(kpisData.montoTotal/1000).toFixed(0)}k` : '—') },
    { label:'Tasa de conversión',    value: kpisLoading ? '...' : (kpisData?.tasaConversion != null ? `${Number(kpisData.tasaConversion).toFixed(0)}%` : '—') },
  ];

  const loggedUser = CrmAuth.getUser();
  const firstName = loggedUser?.name?.split(' ')[0] || 'Usuario';
  const hour = new Date().getHours();
  const greeting = hour >= 6 && hour < 12 ? 'Buenos días' : hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const overdueQuotes = quotes.filter(q => q.dias >= 5 && !['aceptada','rechazada'].includes(q.stage));

  return (
    <div>
      <PageHead
        subtitle="Vista general · Administrador"
        title={`${greeting}, ${firstName}.`}
        description={`Resumen comercial al ${new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' })}.`}
        actions={
          <>
            <div className="relative">
              <button onClick={()=>setExportOpen(o=>!o)} className="btn-ghost"><Icon name="download" size={14}/>Exportar<Icon name="chevron-down" size={11}/></button>
              {exportOpen && <ExportMenu onClose={()=>setExportOpen(false)}/>}
            </div>
          </>
        }
      />
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
        <div className="grid grid-cols-6 gap-3">
          {kpis.map((k,i) => (
            <div key={i} className="bg-white rounded-xl border border-line p-4 shadow-card">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{k.label}</div>
              <div className="text-2xl font-bold text-ink-900 mt-2">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Cotizaciones por vendedor</div>
              <div className="text-xs text-ink-500">Mes corriente · cotizadas vs. ganadas</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartSellers ?? CH_SELLERS} barCategoryGap={18}>
                <CartesianGrid stroke="#F1F5F9" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:12, fill:'#64748B'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{fill:'#F1F5F9'}} contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
                <Legend iconType="circle" wrapperStyle={{fontSize:12, paddingTop:4}}/>
                <Bar dataKey="cotiz"   name="Cotizadas" fill="#1B2A4A" radius={[4,4,0,0]}/>
                <Bar dataKey="ganadas" name="Ganadas"   fill="#3B82F6" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="col-span-3 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Distribución por etapa</div>
              <div className="text-xs text-ink-500">{chartStages?.total ?? '...'} cotizaciones activas</div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={chartStages?.stages ?? CH_STAGE_DIST} dataKey="value" nameKey="name"
                     innerRadius={48} outerRadius={78} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                  {(chartStages?.stages ?? CH_STAGE_DIST).map((e,i)=><Cell key={i} fill={e.color}/>)}
                </Pie>
                <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
              {(chartStages?.stages ?? CH_STAGE_DIST).map(e=>(
                <div key={e.name} className="flex items-center gap-1.5 text-[11px] text-ink-700">
                  <span className="w-2 h-2 rounded-sm" style={{background:e.color}}/>
                  <span className="truncate flex-1">{e.name}</span>
                  <span className="font-semibold">{e.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-4 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Evolución mensual</div>
              <div className="text-xs text-ink-500">Últimos 6 meses · recibidas vs. ganadas</div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartMonthly ?? CH_MONTHLY}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35}/>
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.35}/>
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#F1F5F9" vertical={false}/>
                <XAxis dataKey="month" tick={{fontSize:12, fill:'#64748B'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
                <Legend iconType="circle" wrapperStyle={{fontSize:12, paddingTop:4}}/>
                <Area type="monotone" dataKey="recibidas" name="Recibidas" stroke="#3B82F6" strokeWidth={2} fill="url(#g1)"/>
                <Area type="monotone" dataKey="ganadas"   name="Ganadas"   stroke="#10B981" strokeWidth={2} fill="url(#g2)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7 bg-white rounded-xl border border-line shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <div>
                <div className="text-sm font-semibold text-ink-900">Cotizaciones próximas a vencer</div>
                <div className="text-xs text-ink-500">Pasaron el tiempo límite de armado (1 día hábil)</div>
              </div>
              {overdueQuotes.length > 0 && <Badge tone="red" dot>{overdueQuotes.length} vencidas</Badge>}
            </div>
            <table className="w-full tbl">
              <thead>
                <tr>
                  <th>Código</th><th>Cliente</th><th>Vendedor</th><th>Etapa</th>
                  <th className="!text-right">Días</th><th className="!text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {overdueQuotes.slice(0,5).map(q => {
                  const stg = STAGES_F1.find(x=>x.id===q.stage);
                  const sellerName = q.sellerName || users.find(u=>u.id===q.seller)?.name || '—';
                  return (
                    <tr key={q.code} className="cursor-pointer" onClick={()=>openModal('quoteDetail', { code:q.code })}>
                      <td className="mono text-[12px] font-semibold text-navy-900">{q.code}</td>
                      <td className="font-medium">{q.clientName || clients.find(c=>c.code===q.client)?.name || '—'}</td>
                      <td><div className="flex items-center gap-2"><Avatar name={sellerName} size={22}/>{sellerName.split(' ')[0]}</div></td>
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : q.stage}</td>
                      <td className="text-right"><span className="mono text-bad font-semibold">{q.dias}d</span></td>
                      <td className="text-right mono">{q.monto != null ? fmtMoney(q.monto) : '—'}</td>
                    </tr>
                  );
                })}
                {overdueQuotes.length === 0 && (
                  <tr><td colSpan="6" className="text-center text-ink-400 text-[13px] py-6">Sin cotizaciones vencidas</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="col-span-5 bg-white rounded-xl border border-line shadow-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <div className="text-sm font-semibold text-ink-900">Últimas actividades</div>
              <button className="text-xs text-brand hover:underline">Ver todo</button>
            </div>
            <ul className="p-2 max-h-[360px] overflow-y-auto scroll-thin">
              {activity.map((a,i) => {
                const u = users.find(x=>x.id===a.by);
                return (
                  <li key={i} className="flex gap-3 px-3 py-2.5 rounded-lg hover:bg-surface">
                    <Avatar name={u?.name || '?'} size={28}/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink-900 leading-snug">{a.text}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5 mono">{fmtDateTime(a.at)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Mount ----------
ReactDOM.createRoot(document.getElementById('root')).render(<AppRoot/>);
