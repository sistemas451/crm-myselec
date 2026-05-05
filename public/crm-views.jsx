/* Views: per-role dashboards, clients, team, config */

// ---------- Page Head (reused) ----------
function PageHead({ subtitle, title, description, actions }) {
  return (
    <div className="px-6 pt-5 pb-4 flex items-end justify-between gap-4 border-b border-line bg-white">
      <div>
        <div className="text-[13px] uppercase tracking-wider font-semibold text-ink-500">{subtitle}</div>
        <h2 className="text-xl font-bold text-ink-900 mt-0.5">{title}</h2>
        {description && <div className="text-[13px] text-ink-500 mt-1">{description}</div>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

// ---------- Vendedor view ----------
function MySalesView({ user, initialTab='quotes', onOpen }) {
  const [tab, setTab] = useState(initialTab);
  const { quotes, orders, clients, openModal } = useApp();
  const myQuotes = quotes.filter(q => q.seller === user.id);
  const myOrders = orders.filter(o => o.seller === user.id);

  // personal KPIs
  const activas   = myQuotes.filter(q => !['aceptada','rechazada'].includes(q.stage)).length;
  const enviadas  = myQuotes.filter(q => q.stage === 'enviado').length;
  const ganadas   = myQuotes.filter(q => q.stage === 'aceptada').length;
  const monto     = myQuotes.filter(q => q.monto).reduce((a,b)=>a+b.monto,0);

  return (
    <div>
      <PageHead
        subtitle="Mi pipeline"
        title={`Hola, ${user.name.split(' ')[0]}. Este es tu tablero.`}
        description={`Zona asignada: ${user.zone}. Tenés ${activas} cotizaciones activas y ${myOrders.length} órdenes en curso.`}
        actions={
          <>
            <button className="btn-ghost"><Icon name="download" size={14}/>Exportar</button>
            <button className="btn-primary" onClick={() => openModal('newQuote')}><Icon name="plus" size={14}/>Nueva cotización</button>
          </>
        }
      />

      <div className="p-6 space-y-5">
        {/* personal KPIs */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { k:'Cotizaciones activas',  v:activas,   d:'mes corriente', tone:'blue', icon:'clipboard-list' },
            { k:'Presupuestos enviados', v:enviadas,  d:'esperando respuesta', tone:'orange', icon:'mail' },
            { k:'Ganadas (abril)',       v:ganadas,   d:`tasa ${Math.round((ganadas/Math.max(myQuotes.length,1))*100)}%`, tone:'green', icon:'trophy' },
            { k:'Monto cotizado',        v:fmtMoney(monto), d:'en presupuestos vigentes', tone:'navy', icon:'banknote' },
          ].map((k,i) => (
            <div key={i} className="bg-white rounded-xl border border-line p-4 shadow-card flex items-start gap-3">
              <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                k.tone==='blue'?'bg-brandSoft text-brand':
                k.tone==='green'?'bg-emerald-100 text-emerald-700':
                k.tone==='orange'?'bg-orange-100 text-orange-700':'bg-navy-900 text-white')}>
                <Icon name={k.icon} size={18}/>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{k.k}</div>
                <div className="text-xl font-bold text-ink-900 mt-1">{k.v}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{k.d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* tabs: my quotes / my orders */}
        <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-line">
            <div className="flex gap-1">
              {[
                {id:'quotes', label:'Mis cotizaciones', count:myQuotes.length},
                {id:'orders', label:'Mis OCs',           count:myOrders.length},
              ].map(t => (
                <button key={t.id} onClick={()=>setTab(t.id)} className={cx(
                  'px-3 py-2 text-[13px] font-medium rounded-lg border',
                  tab===t.id ? 'bg-surface border-line text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'
                )}>
                  {t.label} <span className="ml-1 text-[11px] text-ink-400">{t.count}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Icon name="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
                <input className="inp pl-8 text-xs py-1.5 w-48" placeholder="Buscar cliente…"/>
              </div>
            </div>
          </div>

          {tab==='quotes' && (
            <table className="tbl w-full">
              <thead><tr>
                <th>Código</th><th>Cliente</th><th>Etapa</th>
                <th>Ingreso</th><th className="!text-right">Días</th>
                <th className="!text-right">Monto</th>
                <th>NP Flexxus</th><th></th>
              </tr></thead>
              <tbody>
                {myQuotes.map(q => {
                  const cli = clients.find(c => c.code === q.client);
                  const stg = STAGES_F1.find(s => s.id === q.stage);
                  return (
                    <tr key={q.code} className="cursor-pointer" onClick={()=>onOpen(q.code,'quote')}>
                      <td className="mono text-[12px] font-semibold text-navy-900">{q.code}</td>
                      <td className="font-medium">{cli?.name || '—'}<div className="text-[11px] text-ink-500">{cli?.city || ''}</div></td>
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : q.stage}</td>
                      <td className="mono text-[12px]">{fmtDate(q.ingreso)}</td>
                      <td className="text-right mono">
                        <span className={q.dias>=5?'text-bad font-semibold':''}>{q.dias != null ? `${q.dias}d` : '—'}</span>
                      </td>
                      <td className="text-right mono">{q.monto != null ? fmtMoney(q.monto) : '—'}</td>
                      <td className="mono text-[11px]">{q.flexxus || '—'}</td>
                      <td className="text-right">
                        <button className="text-ink-400 hover:text-ink-900"><Icon name="chevron-right" size={14}/></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {tab==='orders' && (
            <table className="tbl w-full">
              <thead><tr>
                <th>OC</th><th>Cliente</th><th>Etapa</th><th>Entrega</th><th>Transporte</th><th>Desde cotización</th><th>Fecha</th><th></th>
              </tr></thead>
              <tbody>
                {myOrders.map(o => {
                  const cli = clients.find(c => c.code === o.client);
                  const stg = STAGES_F2.find(s => s.id === o.stage);
                  return (
                    <tr key={o.code} className="cursor-pointer" onClick={()=>onOpen(o.code,'order')}>
                      <td className="mono text-[12px] font-semibold text-navy-900">{o.code}</td>
                      <td className="font-medium">{cli?.name || '—'}</td>
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : o.stage}</td>
                      <td>{o.entrega ? <Badge tone={o.entrega==='AMBA'?'blue':'purple'}>{o.entrega}</Badge> : '—'}</td>
                      <td className="text-[12px]">{o.transp || '—'}</td>
                      <td className="mono text-[11px] text-ink-500">{o.fromQuote || '—'}</td>
                      <td className="mono text-[12px]">{fmtDate(o.fecha)}</td>
                      <td className="text-right">
                        <button className="text-ink-400 hover:text-ink-900"><Icon name="chevron-right" size={14}/></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Logística view ----------
function LogisticsView({ onOpen }) {
  // KPIs
  const byStage = (id) => ORDERS.filter(o => o.stage === id).length;
  const enTransito = byStage('transito');
  const enArmado   = byStage('armado') + byStage('facturada');
  const pendStock  = byStage('stock') + byStage('proveedor');
  const entregadas = byStage('entregada');

  const groups = [
    { id:'stock',     label:'Verificando stock',    tone:'amber' },
    { id:'proveedor', label:'Esperando proveedor',  tone:'orange'},
    { id:'armado',    label:'Armado de pedido',     tone:'navy'  },
    { id:'facturada', label:'Facturadas',           tone:'purple'},
    { id:'transito',  label:'En tránsito',          tone:'sky'   },
  ];

  return (
    <div>
      <PageHead
        subtitle="Operaciones · Fase 2"
        title="Tablero de Logística"
        description="Seguimiento de órdenes de compra en curso. Actualizá el estado cuando confirmes facturación, despacho o entrega."
        actions={
          <>
            <button className="btn-ghost"><Icon name="download" size={14}/>Exportar</button>
          </>
        }
      />

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { k:'OCs en armado',      v:enArmado,   d:'en depósito', tone:'navy',   icon:'boxes' },
            { k:'Pendiente stock',    v:pendStock,  d:'o proveedor', tone:'orange', icon:'alert-triangle' },
            { k:'En tránsito',        v:enTransito, d:'con transportista', tone:'sky', icon:'truck' },
            { k:'Entregadas (abril)', v:entregadas, d:'mes corriente', tone:'green', icon:'check-circle' },
          ].map((k,i) => (
            <div key={i} className="bg-white rounded-xl border border-line p-4 shadow-card flex items-start gap-3">
              <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                k.tone==='navy'?'bg-navy-900 text-white':
                k.tone==='orange'?'bg-orange-100 text-orange-700':
                k.tone==='sky'?'bg-sky-100 text-sky-700':'bg-emerald-100 text-emerald-700')}>
                <Icon name={k.icon} size={18}/>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{k.k}</div>
                <div className="text-xl font-bold text-ink-900 mt-1">{k.v}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{k.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {groups.map(g => {
            const list = ORDERS.filter(o => o.stage === g.id);
            return (
              <div key={g.id} className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-line flex items-center gap-2">
                  <StageDot tone={g.tone}/>
                  <div className="text-[13.5px] font-semibold text-ink-900">{g.label}</div>
                  <span className="text-[11px] text-ink-500 font-semibold bg-surface border border-line rounded-md px-1.5 py-0.5">{list.length}</span>
                  <div className="flex-1"/>
                  <button className="btn-ghost text-xs py-1.5"><Icon name="arrow-right" size={12}/>Avanzar todas</button>
                </div>
                {list.length === 0 ? (
                  <div className="p-6 text-center text-ink-400 text-[12px]">Sin OCs en esta etapa</div>
                ) : (
                  <table className="w-full tbl">
                    <thead><tr>
                      <th>OC</th><th>Cliente</th><th>Destino</th><th>Transporte</th>
                      <th>NP Flexxus</th><th>Vendedor</th><th>Fecha</th><th className="!text-right">Acción</th>
                    </tr></thead>
                    <tbody>
                      {list.map(o => {
                        const cli = CLIENTS.find(c=>c.code===o.client);
                        const sel = USERS.find(u=>u.id===o.seller);
                        return (
                          <tr key={o.code} className="cursor-pointer" onClick={()=>onOpen(o.code)}>
                            <td className="mono text-[12px] font-semibold text-navy-900">{o.code}</td>
                            <td className="font-medium">{cli.name}</td>
                            <td>
                              <div className="flex items-center gap-1.5">
                                <Badge tone={o.entrega==='AMBA'?'blue':'purple'}>{o.entrega}</Badge>
                                <span className="text-[11.5px] text-ink-500 truncate">{cli.city}</span>
                              </div>
                            </td>
                            <td className="text-[12px]">{o.transp}{o.guia && <span className="ml-1 mono text-[11px] text-ink-500">· {o.guia}</span>}</td>
                            <td className="mono text-[11px]">{o.flexxus}</td>
                            <td><div className="flex items-center gap-2"><Avatar name={sel.name} size={20}/>{sel.name.split(' ')[0]}</div></td>
                            <td className="mono text-[12px]">{fmtDate(o.fecha)}</td>
                            <td className="text-right">
                              <button onClick={(e)=>{e.stopPropagation();}} className="btn-ghost text-xs py-1 px-2">
                                <Icon name="arrow-right" size={11}/> Avanzar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Clients ----------
function Clients({ readonly=false }) {
  const { openModal, clients, users } = useApp();
  const [sel, setSel] = useState('');
  const [search, setSearch] = useState('');
  const [filterSeller, setFilterSeller] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterProv, setFilterProv] = useState('');

  const filteredClients = clients.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      c.name?.toLowerCase().includes(q) ||
      c.cuit?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q);
    const matchSeller = !filterSeller || c.seller === filterSeller;
    const matchZone = !filterZone || c.zone === filterZone;
    const matchProv = !filterProv || c.prov === filterProv;
    return matchSearch && matchSeller && matchZone && matchProv;
  });
  const hasFilters = !!(search || filterSeller || filterZone || filterProv);
  const activeSel = sel || filteredClients[0]?.code || '';
  const cli = clients.find(c => c.code === activeSel);
  const seller = users.find(u => u.id === cli?.seller);

  const cliQuotes = QUOTES.filter(q => q.client === cli?.code);
  const cliOrders = ORDERS.filter(o => o.client === cli?.code);

  return (
    <div>
      <PageHead
        subtitle={readonly ? 'Directorio · solo lectura' : 'Directorio de clientes'}
        title="Clientes"
        description={hasFilters ? `${filteredClients.length} de ${clients.length} clientes` : `${clients.length} clientes registrados`}
        actions={
          <>
            <div className="relative">
              <Icon name="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
              <input className="inp pl-8 py-1.5 w-56 text-xs" placeholder="Buscar razón social o CUIT…"
                value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <select className="inp text-xs py-1.5" value={filterSeller} onChange={e=>setFilterSeller(e.target.value)}>
              <option value="">Todos los vendedores</option>
              {users.filter(u=>u.role==='Vendedor'||u.role==='Administrador').map(u=>(
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select className="inp text-xs py-1.5" value={filterZone} onChange={e=>setFilterZone(e.target.value)}>
              <option value="">Todas las zonas</option>
              {ZONES.map(z=><option key={z} value={z}>{z}</option>)}
            </select>
            <select className="inp text-xs py-1.5" value={filterProv} onChange={e=>setFilterProv(e.target.value)}>
              <option value="">Todas las provincias</option>
              {PROVINCES.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            {hasFilters && (
              <button className="btn-ghost text-xs" onClick={()=>{setSearch('');setFilterSeller('');setFilterZone('');setFilterProv('');}}>
                <Icon name="x" size={12}/>Limpiar
              </button>
            )}
            {!readonly && <button className="btn-primary" onClick={()=>openModal('newClient')}><Icon name="plus" size={14}/>Nuevo cliente</button>}
          </>
        }
      />
      <div className="grid grid-cols-[340px_1fr] gap-0 h-[calc(100vh-136px)]">
        {/* list */}
        <div className="border-r border-line bg-white overflow-y-auto scroll-thin">
          {filteredClients.map(c => {
            const s = users.find(u=>u.id===c.seller);
            const active = c.code === sel;
            return (
              <button key={c.code}
                onClick={()=>setSel(c.code)}
                className={cx('w-full text-left px-4 py-3 border-b border-line flex gap-3 items-start transition-colors',
                  active ? 'bg-brandSoft/40' : 'hover:bg-surface')}>
                <div className="w-10 h-10 rounded-lg bg-navy-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {c.name.slice(0,2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink-900 truncate">{c.name}</div>
                  <div className="text-[11px] text-ink-500 truncate">{c.city}, {c.prov}</div>
                  <div className="text-[10.5px] text-ink-500 mt-1.5 flex items-center gap-1.5">
                    <Avatar name={s?.name||'?'} size={14}/><span>{s?.name?.split(' ')?.[0]||'—'}</span>
                    <span className="text-ink-300">·</span>
                    <span className="mono">{c.code}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* detail */}
        <div className="overflow-y-auto scroll-thin p-6 space-y-5">
          {!cli ? (
            <div className="flex items-center justify-center h-64 text-ink-400 text-[13px]">Sin resultados para los filtros aplicados.</div>
          ) : <>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-navy-900 text-white flex items-center justify-center text-lg font-bold shrink-0">
              {cli.name.slice(0,2)}
            </div>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mono">{cli.code}</div>
              <h3 className="text-lg font-bold text-ink-900 leading-tight">{cli.name}</h3>
              <div className="text-[13px] text-ink-500">{cli.activity} · {cli.city}, {cli.prov}</div>
            </div>
            {!readonly && (
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={()=>openModal('editClient', { clientId: cli.id })}><Icon name="pencil" size={13}/>Editar</button>
                <button className="btn-primary"><Icon name="file-plus" size={13}/>Nueva cotización</button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-4 bg-white border border-line rounded-xl p-5">
            <Field label="CUIT" mono value={cli.cuit}/>
            <Field label="Actividad" value={cli.activity}/>
            <Field label="Zona" value={cli.zone}/>
            <Field label="Vendedor asignado">
              <div className="flex items-center gap-2"><Avatar name={seller?.name||'?'} size={20}/>{seller?.name||'—'}</div>
            </Field>
            <Field label="Email" value={cli.email}/>
            <Field label="Teléfono" mono value={cli.phone}/>
            <Field label="Dirección" value={cli.address}/>
            <Field label="Estado">
              <Badge tone="green" dot>Activo</Badge>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { k:'Cotizaciones (6m)', v:cliQuotes.length, sub:`${cliQuotes.filter(q=>q.stage==='aceptada').length} ganadas` },
              { k:'OCs activas',       v:cliOrders.filter(o=>o.stage!=='entregada').length, sub:`${cliOrders.length} totales` },
              { k:'Facturación anual', v:'USD 148k', sub:'estimado' },
            ].map((k,i)=>(
              <div key={i} className="bg-white border border-line rounded-xl p-4">
                <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{k.k}</div>
                <div className="text-xl font-bold text-ink-900 mt-1">{k.v}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-semibold">Historial comercial</div>
              <div className="flex gap-1 text-[11px]">
                <span className="text-ink-500">Mostrando cotizaciones y OCs recientes</span>
              </div>
            </div>
            <table className="tbl w-full">
              <thead><tr>
                <th>Tipo</th><th>Código</th><th>Etapa</th><th>Vendedor</th><th>Fecha</th><th className="!text-right">Monto</th>
              </tr></thead>
              <tbody>
                {cliQuotes.map(q => {
                  const stg = STAGES_F1.find(s=>s.id===q.stage);
                  const s = users.find(u=>u.id===q.seller);
                  return (
                    <tr key={q.code}>
                      <td><Badge tone="slate">COT</Badge></td>
                      <td className="mono">{q.code}</td>
                      <td><Badge tone={stg.tone} dot>{stg.label}</Badge></td>
                      <td>{s?.name?.split(' ')?.[0]||'—'}</td>
                      <td className="mono text-[12px]">{fmtDate(q.ingreso)}</td>
                      <td className="text-right mono">{fmtMoney(q.monto)}</td>
                    </tr>
                  );
                })}
                {cliOrders.map(o => {
                  const stg = STAGES_F2.find(s=>s.id===o.stage);
                  const s = users.find(u=>u.id===o.seller);
                  return (
                    <tr key={o.code}>
                      <td><Badge tone="navy">OC</Badge></td>
                      <td className="mono">{o.code}</td>
                      <td><Badge tone={stg.tone} dot>{stg.label}</Badge></td>
                      <td>{s?.name?.split(' ')?.[0]||'—'}</td>
                      <td className="mono text-[12px]">{fmtDate(o.fecha)}</td>
                      <td className="text-right mono">—</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>}
        </div>
      </div>
    </div>
  );
}

// ---------- Team (admin) ----------
function Team() {
  const stats = USERS.filter(u=>u.role==='Vendedor').map(u => ({
    ...u,
    clientes: CLIENTS.filter(c=>c.seller===u.id).length,
    cotiz:    QUOTES.filter(q=>q.seller===u.id).length,
    ganadas:  QUOTES.filter(q=>q.seller===u.id && q.stage==='aceptada').length,
    activas:  QUOTES.filter(q=>q.seller===u.id && !['aceptada','rechazada'].includes(q.stage)).length,
    ocs:      ORDERS.filter(o=>o.seller===u.id).length,
  }));
  return (
    <div>
      <PageHead
        subtitle="Equipo comercial"
        title="Usuarios del sistema"
        description="Gestioná roles, zonas asignadas y accesos."
        actions={
          <>
            <button className="btn-ghost"><Icon name="shield" size={14}/>Permisos</button>
            <button className="btn-primary"><Icon name="user-plus" size={14}/>Invitar usuario</button>
          </>
        }
      />
      <div className="p-6 space-y-5">
        <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex items-center justify-between">
            <div className="text-sm font-semibold">Vendedores</div>
            <div className="text-xs text-ink-500">{stats.length} activos</div>
          </div>
          <table className="tbl w-full">
            <thead><tr>
              <th>Usuario</th><th>Zona</th>
              <th className="!text-right">Clientes</th>
              <th className="!text-right">Cotizaciones</th>
              <th className="!text-right">Ganadas</th>
              <th className="!text-right">Tasa</th>
              <th className="!text-right">OCs</th>
              <th></th>
            </tr></thead>
            <tbody>
              {stats.map(u => {
                const rate = u.cotiz ? Math.round(u.ganadas/u.cotiz*100) : 0;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size={32}/>
                        <div>
                          <div className="font-semibold text-[13px]">{u.name}</div>
                          <div className="text-[11px] text-ink-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone="slate">{u.zone}</Badge></td>
                    <td className="text-right mono">{u.clientes}</td>
                    <td className="text-right mono">{u.cotiz}</td>
                    <td className="text-right mono font-semibold text-ok">{u.ganadas}</td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                          <div className="h-full bg-brand" style={{ width: `${rate}%`}}/>
                        </div>
                        <span className="mono text-[11.5px] w-8 text-right">{rate}%</span>
                      </div>
                    </td>
                    <td className="text-right mono">{u.ocs}</td>
                    <td className="text-right">
                      <button className="text-ink-400 hover:text-ink-900"><Icon name="more-horizontal" size={14}/></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-line text-sm font-semibold">Administradores</div>
            <table className="tbl w-full">
              <tbody>
                {USERS.filter(u=>u.role==='Administrador').map(u=>(
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size={30}/>
                        <div>
                          <div className="font-semibold text-[13px]">{u.name}</div>
                          <div className="text-[11px] text-ink-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone="navy">Admin</Badge></td>
                    <td className="text-right"><button className="text-ink-400"><Icon name="more-horizontal" size={14}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-line text-sm font-semibold">Logística</div>
            <table className="tbl w-full">
              <tbody>
                {USERS.filter(u=>u.role==='Logística').map(u=>(
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size={30}/>
                        <div>
                          <div className="font-semibold text-[13px]">{u.name}</div>
                          <div className="text-[11px] text-ink-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone="amber">Depósito</Badge></td>
                    <td className="text-right"><button className="text-ink-400"><Icon name="more-horizontal" size={14}/></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Config ----------
function Config() {
  const { pushToast } = useApp();
  const [tab, setTab] = useState('stages');
  const [stagesData, setStagesData] = useState(null);
  const [stagesLoading, setStagesLoading] = useState(true);

  useEffect(() => {
    CrmApi.getStagesFull()
      .then(data => { setStagesData(data); setStagesLoading(false); })
      .catch(() => setStagesLoading(false));
  }, []);

  const handleToggleMandatory = async (stage) => {
    const newVal = !stage.mandatory;
    setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, mandatory: newVal} : s));
    try {
      await CrmApi.updateStage(stage.id, { mandatory: newVal });
      pushToast(`${stage.label} — ${newVal ? 'marcada obligatoria' : 'marcada opcional'}`);
    } catch (err) {
      setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, mandatory: !newVal} : s));
      pushToast(err.message || 'Error al actualizar', 'bad');
    }
  };

  const handleUpdateMaxHours = async (stage, value) => {
    const hours = value ? parseInt(value) : null;
    if (hours === stage.maxHours) return;
    setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, maxHours: hours} : s));
    try {
      await CrmApi.updateStage(stage.id, { maxHours: hours });
      pushToast(`${stage.label} — tiempo máximo actualizado`);
    } catch (err) {
      pushToast(err.message || 'Error al actualizar', 'bad');
    }
  };

  const f1 = stagesData?.filter(s => s.phase === 'COTIZACION') || [];
  const f2 = stagesData?.filter(s => s.phase === 'ORDEN_COMPRA') || [];

  const StageList = ({ stages, title }) => (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">{title}</div>
      </div>
      {stagesLoading ? (
        <div className="text-[13px] text-ink-400 py-6 text-center">Cargando etapas…</div>
      ) : (
        <ul className="space-y-1.5">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface">
              <Icon name="grip-vertical" size={14} className="text-ink-300"/>
              <span className="w-6 text-right mono text-[11px] text-ink-500 font-semibold">{i+1}.</span>
              <StageDot tone={s.tone}/>
              <span className="flex-1 text-[13px] font-medium text-ink-900">{s.label}</span>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-500 shrink-0">
                <span>Obligatoria</span>
                <button
                  onClick={() => handleToggleMandatory(s)}
                  className={cx('w-8 h-4 rounded-full relative transition-colors shrink-0',
                    s.mandatory ? 'bg-brand' : 'bg-ink-300')}>
                  <div className={cx('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
                    s.mandatory ? 'left-[18px]' : 'left-0.5')}/>
                </button>
              </div>
              <input
                type="number" min="1" placeholder="Sin límite"
                value={s.maxHours || ''}
                onChange={e => setStagesData(sd => sd.map(x =>
                  x.id === s.id ? {...x, maxHours: e.target.value ? parseInt(e.target.value) : null} : x
                ))}
                onBlur={e => handleUpdateMaxHours(s, e.target.value)}
                className="inp text-xs py-1 w-24 text-center"
              />
              <span className="text-[11px] text-ink-400">hs</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <PageHead
        subtitle="Preferencias del sistema"
        title="Configuración"
        description="Etapas del pipeline, integraciones y reglas de negocio."
      />

      <TabBar active={tab} onChange={setTab} tabs={[
        { id:'stages',    label:'Etapas' },
        { id:'flexxus',   label:'Integración Flexxus' },
        { id:'notifs',    label:'Notificaciones' },
        { id:'roles',     label:'Roles y permisos' },
      ]}/>

      {tab==='stages' && (
        <div className="p-6 grid grid-cols-2 gap-5">
          <StageList stages={f1} title="Fase 1 · Cotizaciones"/>
          <StageList stages={f2} title="Fase 2 · Órdenes de Compra"/>
        </div>
      )}

      {tab==='flexxus' && (
        <div className="p-6 grid grid-cols-3 gap-5">
          <div className="col-span-2 bg-white border border-line rounded-xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center"><Icon name="plug" size={18}/></div>
              <div>
                <div className="text-sm font-semibold">Flexxus ERP</div>
                <div className="text-[12px] text-ink-500">Conectado · último sync hace 4 minutos</div>
              </div>
              <div className="flex-1"/>
              <Badge tone="green" dot>Activa</Badge>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Field label="Endpoint" mono value="api.flexxus.com.ar/v2"/>
              <Field label="Base de datos" value="MYSELEC_PROD"/>
              <Field label="Usuario técnico" value="crm.integration"/>
              <Field label="Frecuencia de sync" value="5 minutos"/>
            </div>
            <div className="mt-4 pt-4 border-t border-line text-[12px] space-y-2">
              <div className="flex justify-between"><span className="text-ink-500">Notas de Pedido sincronizadas hoy</span><span className="mono font-semibold">34</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Errores en últimas 24h</span><span className="mono">0</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Próximo sync</span><span className="mono">14:28</span></div>
            </div>
          </div>
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-2">Mapeo de campos</div>
            <ul className="text-[12.5px] space-y-2">
              {[
                ['CRM.Cliente.CUIT', 'Flexxus.Cliente.CUIT'],
                ['CRM.Cotizacion.Total', 'Flexxus.NP.ImporteTotal'],
                ['CRM.OC.NP', 'Flexxus.NP.Numero'],
                ['CRM.Estado.Facturada', 'Flexxus.NP.Facturada=S'],
              ].map(([a,b])=>(
                <li key={a} className="flex items-center justify-between gap-2">
                  <span className="mono text-[11px] text-ink-700">{a}</span>
                  <Icon name="arrow-right" size={12} className="text-ink-400"/>
                  <span className="mono text-[11px] text-ink-700 flex-1 text-right">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tab==='notifs' && (
        <div className="p-6 grid grid-cols-2 gap-5">
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-3">Alertas automáticas</div>
            {[
              ['Cotización sin mover > 48h',   true,  'Email al vendedor'],
              ['Presupuesto enviado sin respuesta > 7d', true, 'Recordatorio al vendedor + copia admin'],
              ['OC sin avanzar > 72h',          true,  'Notificación a logística'],
              ['Stock insuficiente al crear OC', false, 'Aviso a compras'],
              ['Cotización rechazada por precio', true, 'Resumen semanal a gerencia'],
            ].map(([l,on,desc],i)=>(
              <label key={i} className="flex items-center gap-3 py-2.5 border-b border-line last:border-b-0">
                <div className={cx('w-9 h-5 rounded-full relative transition-colors', on?'bg-brand':'bg-ink-300')}>
                  <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on?'left-[18px]':'left-0.5')}/>
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{l}</div>
                  <div className="text-[11px] text-ink-500">{desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-3">Canales</div>
            <div className="space-y-3">
              {[
                ['mail', 'Email', 'victoria@myselec.com.ar', true],
                ['message-circle', 'WhatsApp Business', '+54 11 5432-1098', true],
                ['slack', 'Slack · #ventas', 'myselec.slack.com', false],
              ].map(([ic,label,addr,on])=>(
                <div key={label} className="flex items-center gap-3 p-3 border border-line rounded-lg">
                  <Icon name={ic} size={18} className="text-ink-500"/>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium">{label}</div>
                    <div className="text-[11px] text-ink-500">{addr}</div>
                  </div>
                  <Badge tone={on?'green':'gray'} dot>{on?'Activo':'Inactivo'}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab==='roles' && (
        <div className="p-6">
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <table className="tbl w-full">
              <thead><tr>
                <th>Acción</th>
                <th className="text-center">Admin</th>
                <th className="text-center">Vendedor</th>
                <th className="text-center">Logística</th>
              </tr></thead>
              <tbody>
                {[
                  ['Ver todas las cotizaciones',            true,  false, false],
                  ['Ver sólo las propias',                  false, true,  false],
                  ['Crear / editar cotización',             true,  true,  false],
                  ['Asignar cotización a vendedor',         true,  false, false],
                  ['Avanzar etapa Fase 1',                  true,  true,  false],
                  ['Avanzar etapa Fase 2 (logística)',      true,  false, true],
                  ['Cargar NP Flexxus',                     true,  true,  true],
                  ['Gestionar clientes',                    true,  false, false],
                  ['Ver clientes (solo lectura)',           true,  true,  false],
                  ['Configurar etapas e integraciones',     true,  false, false],
                ].map((row,i)=>(
                  <tr key={i}>
                    <td className="font-medium">{row[0]}</td>
                    {row.slice(1).map((v,j)=>(
                      <td key={j} className="text-center">
                        {v ? <Icon name="check" size={14} className="text-ok"/>
                           : <Icon name="minus" size={14} className="text-ink-300"/>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { MySalesView, LogisticsView, Clients, Team, Config, PageHead });
