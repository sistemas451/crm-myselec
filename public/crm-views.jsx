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
  const [tab,    setTab]    = useState(initialTab);
  const [search, setSearch] = useState('');
  const { quotes, orders, clients, openModal } = useApp();

  // mis cotizaciones = asignadas a mí
  const myQuotes    = quotes.filter(q => q.seller === user.id);
  // sin asignar = stage recibida + sin seller (el backend ya las filtra para VENDEDOR)
  const unassigned  = quotes.filter(q => !q.seller && q.stage === 'recibida');
  const myOrders    = orders.filter(o => o.seller === user.id);

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

        {/* Bandeja sin asignar — solo si hay */}
        {unassigned.length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 shadow-card overflow-hidden">
            <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="inbox" size={15} className="text-amber-600"/>
                <div className="text-sm font-semibold text-amber-800">Bandeja sin asignar</div>
              </div>
              <Badge tone="amber" dot>{unassigned.length} nueva{unassigned.length !== 1 ? 's' : ''}</Badge>
            </div>
            <table className="tbl w-full">
              <thead><tr>
                <th>Código</th><th>Remitente</th><th>Asunto</th><th>Tipo</th><th>Ingreso</th><th></th>
              </tr></thead>
              <tbody>
                {unassigned.map(q => (
                  <tr key={q.code} className="cursor-pointer" onClick={()=>onOpen(q.code,'quote')}>
                    <td className="mono text-[12px] font-semibold text-navy-900">{q.code}</td>
                    <td className="text-[12px] text-ink-600">{q.emailFrom || '—'}</td>
                    <td className="text-[12px]">{q.emailSubject || '—'}</td>
                    <td>{q.mailType ? <Badge tone={q.mailType==='SOLICITUD'?'sky':q.mailType==='PRESUPUESTO'?'blue':'purple'}>{q.mailType}</Badge> : '—'}</td>
                    <td className="mono text-[12px]">{fmtDate(q.ingreso)}</td>
                    <td className="text-right"><Icon name="chevron-right" size={14} className="text-ink-400"/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
            <div className="relative">
              <Icon name="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
              <input className="inp pl-8 text-xs py-1.5 w-48" placeholder="Buscar cliente…"
                value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
          </div>

          {tab==='quotes' && (() => {
            const filtered = myQuotes.filter(q => {
              if (!search) return true;
              const s = search.toLowerCase();
              return (q.clientName||'').toLowerCase().includes(s)
                  || (q.code||'').toLowerCase().includes(s)
                  || (q.flexxus||'').toLowerCase().includes(s);
            });
            return (
              <table className="tbl w-full">
                <thead><tr>
                  <th>Código</th><th>Cliente</th><th>Tipo</th><th>Etapa</th>
                  <th>Ingreso</th><th className="!text-right">Días</th>
                  <th className="!text-right">Monto</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan="8" className="text-center text-ink-400 py-6">Sin cotizaciones</td></tr>
                  )}
                  {filtered.map(q => {
                    const cli = clients.find(c => c.code === q.client);
                    const stg = STAGES_F1.find(s => s.id === q.stage);
                    return (
                      <tr key={q.code} className="cursor-pointer" onClick={()=>onOpen(q.code,'quote')}>
                        <td className="mono text-[12px] font-semibold text-navy-900">{q.code}</td>
                        <td className="font-medium">{q.clientName || cli?.name || '—'}
                          <div className="text-[11px] text-ink-500">{cli?.city || ''}</div></td>
                        <td>{q.mailType ? <Badge tone={q.mailType==='SOLICITUD'?'sky':q.mailType==='PRESUPUESTO'?'blue':'purple'} dot>{q.mailType}</Badge> : '—'}</td>
                        <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : q.stage}</td>
                        <td className="mono text-[12px]">{fmtDate(q.ingreso)}</td>
                        <td className="text-right mono">
                          <span className={q.dias>=5?'text-bad font-semibold':''}>{q.dias != null ? `${q.dias}d` : '—'}</span>
                        </td>
                        <td className="text-right mono">{q.monto != null ? fmtMoney(q.monto) : '—'}</td>
                        <td className="text-right"><Icon name="chevron-right" size={14} className="text-ink-400"/></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}

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
  const { orders: ORDERS, clients: CLIENTS, users: USERS } = useApp();
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
                            <td className="font-medium">{cli?.name||'—'}</td>
                            <td>
                              <div className="flex items-center gap-1.5">
                                {o.entrega && <Badge tone={o.entrega==='AMBA'?'blue':'purple'}>{o.entrega}</Badge>}
                                <span className="text-[11.5px] text-ink-500 truncate">{cli?.city}</span>
                              </div>
                            </td>
                            <td className="text-[12px]">{o.transp}{o.guia && <span className="ml-1 mono text-[11px] text-ink-500">· {o.guia}</span>}</td>
                            <td className="mono text-[11px]">{o.flexxus}</td>
                            <td><div className="flex items-center gap-2">{sel && <Avatar name={sel.name} size={20}/>}{sel?.name?.split(' ')?.[0]||'—'}</div></td>
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
  const { openModal, clients, users, quotes, orders } = useApp();
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

  const cliQuotes = quotes.filter(q => q.client === cli?.code);
  const cliOrders = orders.filter(o => o.client === cli?.code);

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
                <button className="btn-primary" onClick={()=>openModal('newQuote', { defaultClient: cli.code })}><Icon name="file-plus" size={13}/>Nueva cotización</button>
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
              { k:'Facturación anual', v:'$ 148k', sub:'estimado' },
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
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : <span className="text-ink-400">{q.stage}</span>}</td>
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
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : <span className="text-ink-400">{o.stage}</span>}</td>
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
// ---------- UserModal — crear/editar usuario ----------
function UserModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({
    name:     user?.name     || '',
    email:    user?.email    || '',
    role:     user?.role     || 'VENDEDOR',
    zone:     user?.zone     || '',
    password: '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { pushToast } = useApp();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email) { setError('Nombre y email son requeridos'); return; }
    if (!user && !form.password)   { setError('Contraseña requerida al crear usuario'); return; }
    setLoading(true);
    try {
      const data = { name: form.name, email: form.email, role: form.role, zone: form.zone };
      if (form.password) data.password = form.password;
      const saved = user
        ? await CrmApi.updateUser(user.id, data)
        : await CrmApi.createUser(data);
      onSave(saved);
      pushToast(user ? 'Usuario actualizado' : 'Usuario creado');
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const f = (k) => ({ value: form[k], onChange: e => setForm(v => ({...v, [k]: e.target.value})) });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-pop w-full max-w-md p-6 border border-line">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink-900">{user ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <button onClick={onClose} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
        </div>
        {error && <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">Nombre completo</label>
            <input className="inp w-full" placeholder="Juan Pérez" {...f('name')}/>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">Email</label>
            <input className="inp w-full" type="email" placeholder="juan@myselec.com.ar" {...f('email')}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">Rol</label>
              <select className="inp w-full" value={form.role} onChange={e=>setForm(v=>({...v, role: e.target.value}))}>
                <option value="VENDEDOR">Vendedor</option>
                <option value="ADMIN">Administrador</option>
                <option value="LOGISTICA">Logística</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">Zona</label>
              <input className="inp w-full" placeholder="AMBA Norte…" {...f('zone')}/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">
              {user ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
            </label>
            <input className="inp w-full" type="password" placeholder="••••••••" {...f('password')}/>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? 'Guardando...' : (user ? 'Guardar cambios' : 'Crear usuario')}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Team() {
  const { quotes, orders, clients, pushToast } = useApp();
  const [users,    setUsers]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // null | { mode:'create' } | { mode:'edit', user }

  useEffect(() => {
    CrmApi.getUsersFull()
      .then(data => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = (saved) => {
    setUsers(prev => {
      if (!prev) return [saved];
      const idx = prev.findIndex(u => u.id === saved.id);
      return idx >= 0 ? prev.map(u => u.id === saved.id ? {...u, ...saved} : u) : [...prev, saved];
    });
  };

  const handleToggle = async (u) => {
    try {
      const updated = await CrmApi.toggleUser(u.id);
      setUsers(prev => prev.map(x => x.id === u.id ? {...x, active: updated.active} : x));
      pushToast(`${u.name} ${updated.active ? 'activado' : 'desactivado'}`);
    } catch (err) {
      pushToast(err.message || 'Error', 'bad');
    }
  };

  const roleLabel = { ADMIN:'Administrador', VENDEDOR:'Vendedor', LOGISTICA:'Logística' };
  const roleTone  = { ADMIN:'navy', VENDEDOR:'blue', LOGISTICA:'amber' };

  const sellers = (users || []).filter(u => u.role === 'VENDEDOR');
  const others  = (users || []).filter(u => u.role !== 'VENDEDOR');

  const UserRow = ({ u, showStats }) => {
    const rate = u.cotiz ? Math.round(u.ganadas/u.cotiz*100) : 0;
    return (
      <tr className={cx(!u.active && 'opacity-40')}>
        <td>
          <div className="flex items-center gap-2.5">
            <Avatar name={u.name} size={32}/>
            <div>
              <div className="font-semibold text-[13px]">{u.name}</div>
              <div className="text-[11px] text-ink-500">{u.email}</div>
            </div>
          </div>
        </td>
        <td><Badge tone={roleTone[u.role]}>{roleLabel[u.role]}</Badge></td>
        <td><Badge tone="slate">{u.zone || '—'}</Badge></td>
        {showStats && <>
          <td className="text-right mono text-[13px]">{u.clientes ?? '—'}</td>
          <td className="text-right mono text-[13px]">{u.cotiz ?? '—'}</td>
          <td className="text-right mono text-[13px] font-semibold text-ok">{u.ganadas ?? '—'}</td>
          <td className="text-right">
            {u.cotiz > 0 ? (
              <div className="inline-flex items-center gap-2">
                <div className="w-16 h-1.5 bg-surface rounded-full overflow-hidden">
                  <div className="h-full bg-brand" style={{width:`${rate}%`}}/>
                </div>
                <span className="mono text-[11.5px] w-8 text-right">{rate}%</span>
              </div>
            ) : <span className="text-ink-300 text-xs">—</span>}
          </td>
          <td className="text-right mono text-[13px]">{u.ocs ?? '—'}</td>
        </>}
        <td className="text-right">
          <div className="flex items-center justify-end gap-1">
            {!u.active && <Badge tone="gray" dot>Inactivo</Badge>}
            <button onClick={() => setModal({ mode:'edit', user: u })}
              className="btn-ghost p-1.5" title="Editar">
              <Icon name="pencil" size={13} className="text-ink-500"/>
            </button>
            <button onClick={() => handleToggle(u)}
              className="btn-ghost p-1.5" title={u.active ? 'Desactivar' : 'Activar'}>
              <Icon name={u.active ? 'user-minus' : 'user-check'} size={13}
                className={u.active ? 'text-red-400' : 'text-ok'}/>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <PageHead
        subtitle="Equipo comercial"
        title="Usuarios del sistema"
        description="Gestioná roles, zonas asignadas y accesos."
        actions={
          <button className="btn-primary" onClick={() => setModal({ mode:'create' })}>
            <Icon name="user-plus" size={14}/>Nuevo usuario
          </button>
        }
      />

      {modal && (
        <UserModal
          user={modal.mode === 'edit' ? modal.user : null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      <div className="p-6 space-y-5">
        {loading ? (
          <div className="text-center text-ink-400 py-10">Cargando usuarios…</div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                <div className="text-sm font-semibold">Vendedores</div>
                <div className="text-xs text-ink-500">{sellers.filter(u=>u.active).length} activos</div>
              </div>
              <table className="tbl w-full">
                <thead><tr>
                  <th>Usuario</th><th>Rol</th><th>Zona</th>
                  <th className="!text-right">Clientes</th>
                  <th className="!text-right">Cotiz.</th>
                  <th className="!text-right">Ganadas</th>
                  <th className="!text-right">Tasa</th>
                  <th className="!text-right">OCs</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {sellers.length === 0 && (
                    <tr><td colSpan="9" className="text-center text-ink-400 py-6">Sin vendedores</td></tr>
                  )}
                  {sellers.map(u => <UserRow key={u.id} u={u} showStats={true}/>)}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-xl border border-line shadow-card overflow-hidden">
              <div className="px-5 py-3 border-b border-line text-sm font-semibold">Administradores y Logística</div>
              <table className="tbl w-full">
                <thead><tr>
                  <th>Usuario</th><th>Rol</th><th>Zona</th><th></th>
                </tr></thead>
                <tbody>
                  {others.length === 0 && (
                    <tr><td colSpan="4" className="text-center text-ink-400 py-6">Sin usuarios</td></tr>
                  )}
                  {others.map(u => <UserRow key={u.id} u={u} showStats={false}/>)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Config ----------
const STAGE_TONES = ['gray','sky','blue','purple','amber','orange','green','red'];

const NOTIF_TRIGGERS = [
  { value: 'STAGE_CHANGE', label: 'Cambio de etapa' },
  { value: 'IDLE_HOURS',   label: 'Sin movimiento (horas)' },
  { value: 'FOLLOW_UP',    label: 'Seguimiento periódico' },
];
const NOTIF_SENDTO = [
  { value: 'SELLER', label: 'Vendedor asignado' },
  { value: 'ADMIN',  label: 'Administradores' },
  { value: 'BOTH',   label: 'Ambos' },
];
const NOTIF_VARS = ['{{quote.code}}','{{quote.stage}}','{{client.name}}','{{seller.name}}','{{days}}','{{hours}}'];

function NotifModal({ rule, stages, onSave, onClose }) {
  const [form, setForm] = React.useState(rule || {
    name: '', trigger: 'STAGE_CHANGE', stageFrom: '', stageTo: '',
    idleHours: 24, subject: '', body: '', sendTo: 'SELLER', active: true,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !rule?.id;

  const handleSave = () => {
    if (!form.name.trim()) return alert('El nombre es obligatorio');
    if (!form.subject.trim()) return alert('El asunto es obligatorio');
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="font-semibold">{isNew ? 'Nueva regla' : 'Editar regla'}</div>
          <button onClick={onClose} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1 block">Nombre</label>
            <input className="inp w-full" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Alerta cotización inactiva"/>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1 block">Disparador</label>
            <select className="inp w-full" value={form.trigger} onChange={e => set('trigger', e.target.value)}>
              {NOTIF_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {form.trigger === 'STAGE_CHANGE' && (
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                const seen = new Set();
                const uniq = stages.filter(s => { if (seen.has(s.stageKey)) return false; seen.add(s.stageKey); return true; });
                return (
                  <>
                    <div>
                      <label className="text-[12px] font-medium text-ink-600 mb-1 block">Desde etapa</label>
                      <select className="inp w-full" value={form.stageFrom||''} onChange={e => set('stageFrom', e.target.value)}>
                        <option value="">Cualquiera</option>
                        {uniq.map(s => <option key={s.id} value={s.stageKey}>{s.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-ink-600 mb-1 block">Hacia etapa</label>
                      <select className="inp w-full" value={form.stageTo||''} onChange={e => set('stageTo', e.target.value)}>
                        <option value="">Cualquiera</option>
                        {uniq.map(s => <option key={s.id} value={s.stageKey}>{s.label}</option>)}
                      </select>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
          {(form.trigger === 'IDLE_HOURS' || form.trigger === 'FOLLOW_UP') && (
            <div>
              <label className="text-[12px] font-medium text-ink-600 mb-1 block">Horas sin movimiento</label>
              <input type="number" min="1" className="inp w-32" value={form.idleHours||24}
                onChange={e => set('idleHours', parseInt(e.target.value)||24)}/>
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1 block">Enviar a</label>
            <select className="inp w-full" value={form.sendTo} onChange={e => set('sendTo', e.target.value)}>
              {NOTIF_SENDTO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1 block">Asunto del email</label>
            <input className="inp w-full" value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="Ej: Cotización {{quote.code}} sin movimiento"/>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1 block">Cuerpo del mensaje</label>
            <textarea className="inp w-full font-mono text-[12px]" rows={5} value={form.body}
              onChange={e => set('body', e.target.value)}
              placeholder="Hola {{seller.name}},&#10;&#10;La cotización {{quote.code}} del cliente {{client.name}} lleva {{hours}}h sin avanzar."/>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {NOTIF_VARS.map(v => (
                <button key={v} onClick={() => set('body', (form.body||'') + v)}
                  className="text-[11px] mono px-1.5 py-0.5 rounded bg-surface border border-line hover:border-brand text-ink-600">
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => set('active', !form.active)}
              className={cx('w-9 h-5 rounded-full relative transition-colors', form.active ? 'bg-brand' : 'bg-ink-300')}>
              <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', form.active ? 'left-[18px]' : 'left-0.5')}/>
            </button>
            <span className="text-[13px] text-ink-600">{form.active ? 'Regla activa' : 'Regla inactiva'}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-line">
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={handleSave} className="btn-primary">Guardar regla</button>
        </div>
      </div>
    </div>
  );
}

function Config() {
  const { pushToast } = useApp();
  const [tab, setTab] = useState('stages');
  const [stagesData, setStagesData] = useState(null);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTone, setEditTone] = useState('gray');
  const [newStage, setNewStage] = useState({ label: '', tone: 'gray', phase: null });

  // Notifications state
  const [notifRules, setNotifRules] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifModal, setNotifModal] = useState(null); // null | 'new' | rule-object

  // Mail state
  const [mailAccounts,  setMailAccounts]  = useState([]);
  const [mailSettings,  setMailSettings]  = useState({ mail_sync_interval_hours: '2', mail_lookback_days: '2' });
  const [mailLoading,   setMailLoading]   = useState(false);
  const [mailSyncing,   setMailSyncing]   = useState({}); // { [email]: true/false }
  const [mailSyncingAll, setMailSyncingAll] = useState(false);

  useEffect(() => {
    CrmApi.getStagesFull()
      .then(data => { setStagesData(data); setStagesLoading(false); })
      .catch(() => setStagesLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== 'notifs') return;
    setNotifLoading(true);
    CrmApi.getNotificationRules()
      .then(r => { setNotifRules(r); setNotifLoading(false); })
      .catch(() => setNotifLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'mails') return;
    setMailLoading(true);
    Promise.all([
      fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json()),
      fetch('/api/settings',      { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json()),
    ]).then(([accounts, settings]) => {
      setMailAccounts(Array.isArray(accounts) ? accounts : []);
      setMailSettings(s => ({ ...s, ...settings }));
      setMailLoading(false);
    }).catch(() => setMailLoading(false));
  }, [tab]);

  const handleMailSettingSave = async () => {
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify(mailSettings),
      });
      pushToast('Configuración guardada');
    } catch { pushToast('Error al guardar', 'bad'); }
  };

  const handleSyncAll = async () => {
    setMailSyncingAll(true);
    try {
      const res = await fetch('/api/mail/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      const data = await res.json();
      pushToast(`Sync completo · ${data.synced} nuevo(s)`);
      // Refrescar estados
      const accounts = await fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json());
      setMailAccounts(Array.isArray(accounts) ? accounts : []);
    } catch { pushToast('Error al sincronizar', 'bad'); }
    setMailSyncingAll(false);
  };

  const handleSyncOne = async (email) => {
    setMailSyncing(s => ({ ...s, [email]: true }));
    try {
      const res = await fetch(`/api/mail/sync/${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      const data = await res.json();
      pushToast(`${email} · ${data.synced} nuevo(s)`);
      const accounts = await fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json());
      setMailAccounts(Array.isArray(accounts) ? accounts : []);
    } catch { pushToast('Error al sincronizar', 'bad'); }
    setMailSyncing(s => ({ ...s, [email]: false }));
  };

  const handleToggleMandatory = async (stage) => {
    const newVal = !stage.mandatory;
    setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, mandatory: newVal} : s));
    try {
      await CrmApi.updateStage(stage.id, { mandatory: newVal });
      pushToast(`${stage.label} — ${newVal ? 'obligatoria' : 'opcional'}`);
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

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditLabel(s.label);
    setEditTone(s.tone);
  };

  const saveEdit = async (s) => {
    if (!editLabel.trim()) { setEditingId(null); return; }
    const label = editLabel.trim();
    const tone  = editTone;
    setStagesData(sd => sd.map(x => x.id === s.id ? {...x, label, tone} : x));
    setEditingId(null);
    try {
      await CrmApi.updateStage(s.id, { label, tone });
      pushToast(`Etapa "${label}" actualizada`);
    } catch (err) {
      pushToast(err.message || 'Error al guardar', 'bad');
    }
  };

  const handleMove = async (stage, dir, phases) => {
    const list = [...phases];
    const idx = list.findIndex(s => s.id === stage.id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
    setStagesData(sd => {
      const others = sd.filter(s => s.phase !== stage.phase);
      return [...others, ...list];
    });
    try {
      await CrmApi.reorderStages(list.map(s => s.id));
      pushToast('Orden actualizado');
    } catch (err) {
      pushToast(err.message || 'Error al reordenar', 'bad');
    }
  };

  const handleDelete = async (stage) => {
    if (!window.confirm(`¿Eliminar la etapa "${stage.label}"? Esta acción no se puede deshacer.`)) return;
    try {
      await CrmApi.deleteStage(stage.id);
      setStagesData(sd => sd.filter(s => s.id !== stage.id));
      pushToast(`Etapa "${stage.label}" eliminada`);
    } catch (err) {
      pushToast(err.message || 'Error al eliminar', 'bad');
    }
  };

  const handleAddStage = async (phase) => {
    const label = newStage.label.trim();
    if (!label) return;
    try {
      const created = await CrmApi.createStage({ label, phase, tone: newStage.tone });
      setStagesData(sd => [...sd, created]);
      setNewStage({ label: '', tone: 'gray', phase: null });
      pushToast(`Etapa "${label}" creada`);
    } catch (err) {
      pushToast(err.message || 'Error al crear etapa', 'bad');
    }
  };

  const f1 = stagesData?.filter(s => s.phase === 'COTIZACION') || [];
  const f2 = stagesData?.filter(s => s.phase === 'ORDEN_COMPRA') || [];

  const TonePicker = ({ value, onChange }) => (
    <div className="flex items-center gap-1">
      {STAGE_TONES.map(t => (
        <button key={t} onClick={() => onChange(t)}
          className={cx('w-5 h-5 rounded-full border-2 transition-all',
            value === t ? 'border-ink-900 scale-125' : 'border-transparent')}
          style={{ background: STAGE_DOT[t] || '#94A3B8' }}
        />
      ))}
    </div>
  );

  const StageList = ({ stages, phase, title }) => (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">{title}</div>
        <button onClick={() => setNewStage({ label: '', tone: 'gray', phase })}
          className="btn-ghost text-[12px] flex items-center gap-1 text-brand">
          <Icon name="plus" size={13}/> Agregar etapa
        </button>
      </div>
      {stagesLoading ? (
        <div className="text-[13px] text-ink-400 py-6 text-center">Cargando etapas…</div>
      ) : (
        <ul className="space-y-1.5">
          {stages.map((s, i) => (
            <li key={s.id}>
              {editingId === s.id ? (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-line">
                  <StageDot tone={editTone}/>
                  <input autoFocus className="inp text-[13px] py-1 flex-1"
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(s); if (e.key === 'Escape') setEditingId(null); }}
                  />
                  <TonePicker value={editTone} onChange={setEditTone}/>
                  <button onClick={() => saveEdit(s)} className="btn-primary text-[12px] py-1 px-2">Guardar</button>
                  <button onClick={() => setEditingId(null)} className="btn-ghost text-[12px] py-1 px-2">Cancelar</button>
                </div>
              ) : (
                <div className="group flex items-center gap-2 p-2.5 rounded-lg hover:bg-surface">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => handleMove(s, -1, stages)}
                      disabled={i === 0}
                      className="text-ink-300 hover:text-ink-700 disabled:opacity-20 leading-none">
                      <Icon name="chevron-up" size={12}/>
                    </button>
                    <button onClick={() => handleMove(s, 1, stages)}
                      disabled={i === stages.length - 1}
                      className="text-ink-300 hover:text-ink-700 disabled:opacity-20 leading-none">
                      <Icon name="chevron-down" size={12}/>
                    </button>
                  </div>
                  <span className="w-5 text-right mono text-[11px] text-ink-400 font-semibold">{i+1}.</span>
                  <StageDot tone={s.tone}/>
                  <span className="flex-1 text-[13px] font-medium text-ink-900">{s.label}</span>
                  {s.mandatory && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">OBLIG.</span>}
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-500 shrink-0">
                    <span>Obligatoria</span>
                    <button onClick={() => handleToggleMandatory(s)}
                      className={cx('w-8 h-4 rounded-full relative transition-colors shrink-0',
                        s.mandatory ? 'bg-brand' : 'bg-ink-300')}>
                      <div className={cx('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
                        s.mandatory ? 'left-[18px]' : 'left-0.5')}/>
                    </button>
                  </div>
                  <input type="number" min="1" placeholder="∞"
                    value={s.maxHours || ''}
                    onChange={e => setStagesData(sd => sd.map(x =>
                      x.id === s.id ? {...x, maxHours: e.target.value ? parseInt(e.target.value) : null} : x
                    ))}
                    onBlur={e => handleUpdateMaxHours(s, e.target.value)}
                    className="inp text-xs py-1 w-16 text-center"
                  />
                  <span className="text-[11px] text-ink-400">hs</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(s)} className="btn-ghost p-1" title="Editar">
                      <Icon name="pencil" size={13} className="text-ink-500"/>
                    </button>
                    <button onClick={() => handleDelete(s)} className="btn-ghost p-1" title="Eliminar">
                      <Icon name="trash-2" size={13} className="text-red-400"/>
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {newStage.phase === phase && (
            <li className="flex items-center gap-2 p-2.5 rounded-lg bg-surface border border-line border-dashed mt-2">
              <StageDot tone={newStage.tone}/>
              <input autoFocus className="inp text-[13px] py-1 flex-1" placeholder="Nombre de la etapa…"
                value={newStage.label}
                onChange={e => setNewStage(n => ({...n, label: e.target.value}))}
                onKeyDown={e => { if (e.key === 'Enter') handleAddStage(phase); if (e.key === 'Escape') setNewStage({label:'',tone:'gray',phase:null}); }}
              />
              <TonePicker value={newStage.tone} onChange={t => setNewStage(n => ({...n, tone: t}))}/>
              <button onClick={() => handleAddStage(phase)} className="btn-primary text-[12px] py-1 px-2">Crear</button>
              <button onClick={() => setNewStage({label:'',tone:'gray',phase:null})} className="btn-ghost text-[12px] py-1 px-2">Cancelar</button>
            </li>
          )}
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
        { id:'mails',     label:'Cuentas de mail' },
        { id:'notifs',    label:'Notificaciones' },
        { id:'roles',     label:'Roles y permisos' },
      ]}/>

      {tab==='stages' && (
        <div className="p-6 grid grid-cols-2 gap-5">
          <StageList stages={f1} phase="COTIZACION"   title="Fase 1 · Cotizaciones"/>
          <StageList stages={f2} phase="ORDEN_COMPRA" title="Fase 2 · Órdenes de Compra"/>
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

      {tab==='mails' && (
        <div className="p-6 space-y-5">

          {/* ── Configuración de sync ─────────────────────────── */}
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-4">Configuración de sincronización</div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[12px] text-ink-500 mb-1">Frecuencia automática</label>
                <select className="inp text-[13px]" value={mailSettings.mail_sync_interval_hours}
                  onChange={e => setMailSettings(s => ({ ...s, mail_sync_interval_hours: e.target.value }))}>
                  <option value="1">Cada 1 hora</option>
                  <option value="2">Cada 2 horas</option>
                  <option value="4">Cada 4 horas</option>
                  <option value="8">Cada 8 horas</option>
                  <option value="24">Una vez al día</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] text-ink-500 mb-1">Buscar mails de los últimos</label>
                <select className="inp text-[13px]" value={mailSettings.mail_lookback_days}
                  onChange={e => setMailSettings(s => ({ ...s, mail_lookback_days: e.target.value }))}>
                  <option value="1">1 día</option>
                  <option value="2">2 días</option>
                  <option value="7">7 días</option>
                  <option value="30">30 días</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleMailSettingSave} className="btn-primary text-[12px]">
                Guardar configuración
              </button>
            </div>
          </div>

          {/* ── Cuentas de mail ───────────────────────────────── */}
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
              <div className="font-semibold text-[13px]">Cuentas configuradas</div>
              <button onClick={handleSyncAll} disabled={mailSyncingAll}
                className="btn-primary text-[12px] flex items-center gap-1.5 disabled:opacity-60">
                <Icon name="refresh-cw" size={13} className={mailSyncingAll ? 'animate-spin' : ''}/>
                {mailSyncingAll ? 'Sincronizando…' : 'Sincronizar todas'}
              </button>
            </div>

            {mailLoading ? (
              <div className="py-10 text-center text-ink-400 text-[13px]">Cargando cuentas…</div>
            ) : mailAccounts.length === 0 ? (
              <div className="py-10 text-center text-ink-400 text-[13px]">
                No hay cuentas configuradas.<br/>
                <span className="text-[12px]">Agrega <code className="mono bg-surface px-1 rounded">MAIL_ACCOUNTS</code> en Railway.</span>
              </div>
            ) : (
              <table className="tbl w-full">
                <thead><tr>
                  <th>Cuenta</th>
                  <th>Último sync</th>
                  <th>Estado</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {mailAccounts.map(acc => (
                    <tr key={acc.user}>
                      <td className="mono text-[12px]">{acc.user}</td>
                      <td className="text-[12px] text-ink-500">
                        {acc.lastSyncAt
                          ? new Date(acc.lastSyncAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                          : <span className="text-ink-400">Nunca</span>}
                      </td>
                      <td>
                        <Badge tone={acc.isActive ? 'green' : 'gray'} dot>
                          {acc.isActive ? 'Activa' : 'Inactiva'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <button onClick={() => handleSyncOne(acc.user)}
                          disabled={mailSyncing[acc.user]}
                          className="btn-ghost text-[12px] flex items-center gap-1.5 ml-auto disabled:opacity-60">
                          <Icon name="refresh-cw" size={12} className={mailSyncing[acc.user] ? 'animate-spin' : ''}/>
                          {mailSyncing[acc.user] ? 'Sync…' : 'Sincronizar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab==='notifs' && (
        <div className="p-6">
          {notifModal !== null && (
            <NotifModal
              rule={notifModal === 'new' ? null : notifModal}
              stages={stagesData || []}
              onClose={() => setNotifModal(null)}
              onSave={async (form) => {
                try {
                  if (form.id) {
                    const updated = await CrmApi.updateNotificationRule(form.id, form);
                    setNotifRules(r => r.map(x => x.id === form.id ? updated : x));
                    pushToast('Regla actualizada');
                  } else {
                    const created = await CrmApi.createNotificationRule(form);
                    setNotifRules(r => [...r, created]);
                    pushToast('Regla creada');
                  }
                  setNotifModal(null);
                } catch (err) {
                  pushToast(err.message || 'Error al guardar', 'bad');
                }
              }}
            />
          )}
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
              <div className="font-semibold text-[13px]">Reglas de notificación</div>
              <button onClick={() => setNotifModal('new')} className="btn-primary text-[12px] flex items-center gap-1.5">
                <Icon name="plus" size={13}/> Nueva regla
              </button>
            </div>
            {notifLoading ? (
              <div className="py-12 text-center text-ink-400 text-[13px]">Cargando reglas…</div>
            ) : notifRules.length === 0 ? (
              <div className="py-12 text-center text-ink-400 text-[13px]">
                No hay reglas configuradas. Crea la primera para empezar a recibir notificaciones.
              </div>
            ) : (
              <table className="tbl w-full">
                <thead><tr>
                  <th>Nombre</th>
                  <th>Disparador</th>
                  <th>Enviar a</th>
                  <th>Estado</th>
                  <th></th>
                </tr></thead>
                <tbody>
                  {notifRules.map(rule => {
                    const trig = NOTIF_TRIGGERS.find(t => t.value === rule.trigger);
                    const sendTo = NOTIF_SENDTO.find(t => t.value === rule.sendTo);
                    let trigDetail = '';
                    if (rule.trigger === 'STAGE_CHANGE') {
                      trigDetail = [rule.stageFrom, rule.stageTo].filter(Boolean).join(' → ') || 'Cualquier cambio';
                    } else if (rule.idleHours) {
                      trigDetail = `${rule.idleHours}h sin movimiento`;
                    }
                    return (
                      <tr key={rule.id}>
                        <td>
                          <div className="font-medium text-[13px]">{rule.name}</div>
                          <div className="text-[11px] text-ink-500 mono truncate max-w-[220px]">{rule.subject}</div>
                        </td>
                        <td>
                          <div className="text-[12px]">{trig?.label || rule.trigger}</div>
                          {trigDetail && <div className="text-[11px] text-ink-500">{trigDetail}</div>}
                        </td>
                        <td className="text-[12px]">{sendTo?.label || rule.sendTo}</td>
                        <td>
                          <button onClick={async () => {
                            try {
                              const updated = await CrmApi.updateNotificationRule(rule.id, { active: !rule.active });
                              setNotifRules(r => r.map(x => x.id === rule.id ? updated : x));
                            } catch (err) {
                              pushToast(err.message || 'Error', 'bad');
                            }
                          }} className={cx('w-9 h-5 rounded-full relative transition-colors', rule.active ? 'bg-brand' : 'bg-ink-300')}>
                            <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', rule.active ? 'left-[18px]' : 'left-0.5')}/>
                          </button>
                        </td>
                        <td>
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => setNotifModal(rule)} className="btn-ghost p-1.5 text-ink-500 hover:text-brand">
                              <Icon name="pencil" size={13}/>
                            </button>
                            <button onClick={async () => {
                              if (!window.confirm(`¿Eliminar la regla "${rule.name}"?`)) return;
                              try {
                                await CrmApi.deleteNotificationRule(rule.id);
                                setNotifRules(r => r.filter(x => x.id !== rule.id));
                                pushToast('Regla eliminada');
                              } catch (err) {
                                pushToast(err.message || 'Error', 'bad');
                              }
                            }} className="btn-ghost p-1.5 text-ink-500 hover:text-bad">
                              <Icon name="trash-2" size={13}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
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
