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
            { k:`Ganadas (${new Date().toLocaleString('es-AR',{month:'long'})})`, v:ganadas, d:`tasa ${Math.round((ganadas/Math.max(myQuotes.length,1))*100)}%`, tone:'green', icon:'trophy' },
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
        actions={null}
      />

      <div className="p-6 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { k:'OCs en armado',      v:enArmado,   d:'en depósito', tone:'navy',   icon:'boxes' },
            { k:'Pendiente stock',    v:pendStock,  d:'o proveedor', tone:'orange', icon:'alert-triangle' },
            { k:'En tránsito',        v:enTransito, d:'con transportista', tone:'sky', icon:'truck' },
            { k:`Entregadas (${new Date().toLocaleString('es-AR',{month:'long'})})`, v:entregadas, d:'mes corriente', tone:'green', icon:'check-circle' },
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

// ---------- DeleteAllModal — confirmación con tipeo "ELIMINAR" ----------
function DeleteAllModal({ title, description, onClose, onConfirm }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const confirmed = input.trim() === 'ELIMINAR';

  const handleConfirm = async () => {
    if (!confirmed) return;
    setLoading(true); setError('');
    try {
      await onConfirm();
      onClose();
    } catch(e) {
      setError(e.message || 'Error al eliminar');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={!loading ? onClose : undefined}/>
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-md modal-enter">
        <div className="px-6 py-5">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4">
            <Icon name="trash-2" size={22} className="text-red-600"/>
          </div>
          <h3 className="text-base font-bold text-ink-900 mb-1">{title}</h3>
          <p className="text-[13px] text-ink-600 mb-5">{description}</p>
          <div className="mb-4">
            <label className="text-[12px] font-semibold text-ink-700 mb-1.5 block">
              Escribí <span className="font-mono bg-red-50 text-red-700 px-1.5 py-0.5 rounded">ELIMINAR</span> para confirmar
            </label>
            <input
              className="inp w-full font-mono"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="ELIMINAR"
              autoFocus
              disabled={loading}
            />
          </div>
          {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} disabled={loading} className="btn-ghost">Cancelar</button>
            <button
              onClick={handleConfirm}
              disabled={!confirmed || loading}
              className="btn-ghost border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
              <Icon name={loading ? 'loader' : 'trash-2'} size={13} className={loading ? 'animate-spin' : ''}/>
              {loading ? 'Eliminando…' : 'Eliminar todo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- ClientImportModal ----------
function ClientImportModal({ onClose, onDone }) {
  const STEP = { UPLOAD: 'upload', PREVIEW: 'preview', SYNCING: 'syncing', DONE: 'done' };
  const [step, setStep]           = useState(STEP.UPLOAD);
  const [dragging, setDragging]   = useState(false);
  const [file, setFile]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [preview, setPreview]     = useState(null);
  const [deleteSel, setDeleteSel] = useState({});
  const [result, setResult]       = useState(null);

  const pickFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xls','xlsx'].includes(ext)) { setError('Solo se aceptan archivos .xls o .xlsx'); return; }
    setFile(f); setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  const doPreview = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const data = await CrmApi.previewClientsXLS(file);
      setPreview(data);
      const sel = {};
      data.toRemove.forEach(c => { sel[c.code] = false; }); // por defecto NO eliminar
      setDeleteSel(sel);
      setStep(STEP.PREVIEW);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doSync = async () => {
    setStep(STEP.SYNCING);
    try {
      const deleteCodes = Object.entries(deleteSel).filter(([,v])=>v).map(([k])=>k);
      const res = await CrmApi.syncClients(preview.token, deleteCodes);
      setResult(res);
      setStep(STEP.DONE);
    } catch (e) {
      setError(e.message);
      setStep(STEP.PREVIEW);
    }
  };

  const toggleAll = (val) => {
    const sel = {};
    preview.toRemove.forEach(c => { sel[c.code] = val; });
    setDeleteSel(sel);
  };

  const selectedDeleteCount = Object.values(deleteSel).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={step !== STEP.SYNCING ? onClose : undefined}/>
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col modal-enter">

        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Clientes · Importación masiva</div>
            <h3 className="text-base font-bold text-ink-900">Actualizar base de clientes</h3>
          </div>
          {step !== STEP.SYNCING && (
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500">
              <Icon name="x" size={16}/>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-6">

          {/* ── Paso 1: Upload ── */}
          {step === STEP.UPLOAD && (
            <div className="space-y-4">
              <p className="text-[13px] text-ink-600">
                Subí el Excel de clientes. El sistema va a comparar con la base actual y mostrarte qué cambia antes de aplicar nada.
              </p>
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={handleDrop}
                className={cx(
                  'border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer',
                  dragging ? 'border-brand bg-brand/5' : 'border-line hover:border-ink-300 hover:bg-surface'
                )}
                onClick={()=>document.getElementById('cli-xls-input').click()}
              >
                <div className="w-12 h-12 rounded-xl bg-surface border border-line flex items-center justify-center">
                  <Icon name="upload-cloud" size={22} className="text-ink-400"/>
                </div>
                {file ? (
                  <div className="text-center">
                    <div className="font-semibold text-ink-900 text-[14px]">{file.name}</div>
                    <div className="text-[12px] text-ink-500 mt-0.5">{(file.size/1024).toFixed(0)} KB · listo para procesar</div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="font-medium text-ink-700 text-[13px]">Arrastrá el archivo acá o hacé click para seleccionarlo</div>
                    <div className="text-[12px] text-ink-400 mt-0.5">Formato: .xls o .xlsx (columnas: Código, Razón Social, CUIT, Dirección, Teléfono, Localidad, Provincia, Zona, Vendedor, Actividad, Mail, CP)</div>
                  </div>
                )}
                <input id="cli-xls-input" type="file" accept=".xls,.xlsx" className="hidden"
                  onChange={e=>pickFile(e.target.files[0])}/>
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}
            </div>
          )}

          {/* ── Paso 2: Preview ── */}
          {step === STEP.PREVIEW && preview && (
            <div className="space-y-5">
              {/* KPIs */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Nuevos',      value: preview.summary.toAdd,     color: 'bg-green-50 border-green-200 text-green-700' },
                  { label: 'Actualizados',value: preview.summary.toUpdate,  color: 'bg-blue-50 border-blue-200 text-blue-700' },
                  { label: 'Sin cambios', value: preview.summary.unchanged, color: 'bg-surface border-line text-ink-500' },
                  { label: 'A eliminar',  value: preview.summary.toRemove,  color: preview.summary.toRemove > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-surface border-line text-ink-500' },
                ].map(s => (
                  <div key={s.label} className={cx('border rounded-xl p-4 text-center', s.color)}>
                    <div className="text-2xl font-bold">{s.value.toLocaleString()}</div>
                    <div className="text-[11px] font-medium mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Aviso vendedores no mapeados */}
              {preview.unmatchedVendors?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[12px] text-amber-800">
                  <div className="font-semibold mb-1">⚠ Vendedores no reconocidos en el sistema</div>
                  <div className="text-amber-700">Los siguientes vendedores del Excel no coinciden con ningún usuario activo y quedarán sin asignar: <span className="font-medium">{preview.unmatchedVendors.join(', ')}</span></div>
                </div>
              )}

              {/* Nuevos */}
              {preview.toAdd.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>
                    Clientes nuevos {preview.summary.toAdd > 20 && <span className="font-normal text-ink-400">(mostrando primeros 20 de {preview.summary.toAdd})</span>}
                  </div>
                  <div className="border border-line rounded-xl overflow-hidden max-h-40 overflow-y-auto scroll-thin">
                    {preview.toAdd.map(c => (
                      <div key={c.code} className="px-3 py-2 border-b border-line last:border-0 flex gap-3 text-[12px]">
                        <span className="mono font-semibold text-blue-600 w-16 shrink-0">{c.code}</span>
                        <span className="text-ink-700 flex-1 truncate">{c.name}</span>
                        <span className="text-ink-400 shrink-0">{[c.city, c.province].filter(Boolean).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actualizados */}
              {preview.toUpdate.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block"/>
                    Clientes con cambios {preview.summary.toUpdate > 20 && <span className="font-normal text-ink-400">(mostrando primeros 20 de {preview.summary.toUpdate})</span>}
                  </div>
                  <div className="border border-line rounded-xl overflow-hidden max-h-40 overflow-y-auto scroll-thin">
                    {preview.toUpdate.map(c => (
                      <div key={c.code} className="px-3 py-2 border-b border-line last:border-0 flex gap-3 text-[12px]">
                        <span className="mono font-semibold text-blue-600 w-16 shrink-0">{c.code}</span>
                        <span className="text-ink-700 flex-1 truncate">{c.name}</span>
                        <span className="text-ink-400 shrink-0 text-[11px]">{c._old?.name !== c.name ? `era: ${c._old?.name}` : [c.city, c.province].filter(Boolean).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* A eliminar — con checkboxes */}
              {preview.toRemove.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-red-700 mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>
                      Clientes que ya no están en el XLS — elegí cuáles eliminar
                    </span>
                    <div className="flex gap-2">
                      <button onClick={()=>toggleAll(true)}  className="text-[11px] text-brand hover:underline">Todos</button>
                      <span className="text-ink-300">·</span>
                      <button onClick={()=>toggleAll(false)} className="text-[11px] text-ink-500 hover:underline">Ninguno</button>
                    </div>
                  </div>
                  <div className="border border-red-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto scroll-thin">
                    {preview.toRemove.map(c => (
                      <label key={c.code} className="px-3 py-2 border-b border-red-100 last:border-0 flex gap-3 text-[12px] cursor-pointer hover:bg-red-50 items-center">
                        <input type="checkbox" className="accent-red-500 shrink-0"
                          checked={!!deleteSel[c.code]}
                          onChange={e => setDeleteSel(s => ({...s, [c.code]: e.target.checked}))}/>
                        <span className="mono font-semibold text-red-600 w-16 shrink-0">{c.code}</span>
                        <span className="text-ink-700 flex-1 truncate">{c.name}</span>
                        <span className="text-ink-400 shrink-0">{c.city || ''}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 text-[12px] text-ink-500">
                    {selectedDeleteCount > 0
                      ? <span className="text-red-600 font-medium">⚠ Se van a eliminar {selectedDeleteCount} cliente{selectedDeleteCount !== 1 ? 's' : ''} sin cotizaciones ni OCs.</span>
                      : 'Los clientes con cotizaciones u OCs no pueden eliminarse aunque estén marcados.'}
                  </div>
                </div>
              )}

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}
            </div>
          )}

          {/* ── Paso 3: Procesando ── */}
          {step === STEP.SYNCING && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-4 border-brand border-t-transparent animate-spin"/>
              <div className="text-[14px] text-ink-600 font-medium">Importando clientes…</div>
              <div className="text-[12px] text-ink-400">Esto puede tardar unos segundos</div>
            </div>
          )}

          {/* ── Paso 4: Resultado ── */}
          {step === STEP.DONE && result && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <Icon name="check" size={20} className="text-green-600"/>
                </div>
                <div>
                  <div className="font-semibold text-green-800 text-[14px]">Base de clientes actualizada</div>
                  <div className="text-[13px] text-green-700 mt-0.5">
                    {result.upserted.toLocaleString()} clientes procesados
                    {result.deleted > 0 && ` · ${result.deleted} eliminado${result.deleted !== 1 ? 's' : ''}`}
                    {result.skipped > 0 && ` · ${result.skipped} no eliminado${result.skipped !== 1 ? 's' : ''} (tienen historial)`}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface border border-line rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-ink-900">{result.upserted.toLocaleString()}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Clientes sincronizados</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-red-600">{result.deleted}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Eliminados</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-amber-600">{result.skipped}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Omitidos (con historial)</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-3 bg-surface rounded-b-2xl">
          {step === STEP.UPLOAD && (
            <>
              <button onClick={onClose} className="btn-ghost">Cancelar</button>
              <button onClick={doPreview} disabled={!file || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Procesando…' : 'Analizar archivo'}
              </button>
            </>
          )}
          {step === STEP.PREVIEW && (
            <>
              <button onClick={()=>{setStep(STEP.UPLOAD);setPreview(null);}} className="btn-ghost">← Volver</button>
              <button onClick={doSync} className="btn-primary">
                Confirmar importación
                {selectedDeleteCount > 0 && ` (${selectedDeleteCount} eliminaciones)`}
              </button>
            </>
          )}
          {step === STEP.DONE && (
            <button onClick={() => { onDone(); onClose(); }} className="btn-primary">
              Cerrar y actualizar lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Clients ----------
function Clients({ readonly=false }) {
  const { openModal, clients, setClients, users, quotes, orders } = useApp();
  const [sel, setSel] = useState('');
  const [search, setSearch] = useState('');
  const [filterSeller, setFilterSeller] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterProv, setFilterProv] = useState('');
  const [cliEmails, setCliEmails] = useState([]);
  const [emailsExpanded, setEmailsExpanded] = useState(false);
  const [listWidth, setListWidth] = useState(320);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [listPage, setListPage] = useState(0);
  const LIST_PAGE_SIZE = 80;
  const isAdmin = CrmAuth.getUser()?.role === 'ADMIN';

  const reloadClients = async () => {
    try {
      const fresh = await CrmApi.getClients();
      const mapped = fresh.map(c => ({
        id: c.id, code: c.code, name: c.name,
        cuit: c.cuit || '', city: c.city || '', prov: c.province || '',
        zone: c.zone || '', activity: c.activity || '',
        seller: c.defaultSellerId || '', sellerName: c.defaultSeller?.name || '',
        email: c.emailPrimary || c.email || '', phone: c.phone || '', address: c.address || '',
      }));
      setClients(mapped);
    } catch(e) { /* silencioso */ }
  };

  const handleExport = async () => {
    setExporting(true);
    try { await CrmApi.exportClients(); }
    catch (e) { alert(e.message || 'Error al exportar'); }
    finally { setExporting(false); }
  };

  const startDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      setListWidth(Math.max(200, Math.min(560, startW + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const filteredClients = clients.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      c.name?.toLowerCase().includes(q) ||
      c.cuit?.includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.code?.toLowerCase().includes(q);
    const matchSeller = !filterSeller || c.seller === filterSeller;
    const matchZone = !filterZone || c.zone === filterZone;
    const matchProv = !filterProv || (c.prov || '').trim().toLowerCase() === filterProv.trim().toLowerCase();
    return matchSearch && matchSeller && matchZone && matchProv;
  });
  const hasFilters = !!(search || filterSeller || filterZone || filterProv);

  // Opciones dinámicas basadas en los datos reales
  const availableZones   = [...new Set(clients.map(c => c.zone).filter(Boolean))].sort();
  const availableProvs   = [...new Set(clients.map(c => c.prov).filter(Boolean))].sort();
  const availableSellers = users.filter(u => clients.some(c => c.seller === u.id));

  // Reset página cuando cambian filtros
  useEffect(() => { setListPage(0); setSel(''); }, [search, filterSeller, filterZone, filterProv]);

  const totalPages = Math.ceil(filteredClients.length / LIST_PAGE_SIZE);
  const pagedClients = filteredClients.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE);
  const activeSel = sel || pagedClients[0]?.code || '';
  const cli = clients.find(c => c.code === activeSel);
  const seller = users.find(u => u.id === cli?.seller);

  // Fetch multi-emails when selected client changes
  useEffect(() => {
    if (!cli?.id) { setCliEmails([]); setEmailsExpanded(false); return; }
    setCliEmails([]);
    setEmailsExpanded(false);
    CrmApi.getClientEmails(cli.id).then(setCliEmails).catch(() => setCliEmails([]));
  }, [cli?.id]);

  const cliQuotes = quotes.filter(q => q.client === cli?.code);
  const cliOrders = orders.filter(o => o.client === cli?.code);

  // Combined history sorted newest-first
  const cliHistory = [
    ...cliQuotes.map(q => ({ ...q, _kind: 'quote', _date: q.ingreso })),
    ...cliOrders.map(o => ({ ...o, _kind: 'order', _date: o.fecha })),
  ].sort((a, b) => new Date(b._date) - new Date(a._date));

  // Totals
  const montoGanado = cliQuotes
    .filter(q => q.stage === 'aceptada' && q.monto)
    .reduce((s, q) => s + q.monto, 0);
  const montoEnCurso = cliQuotes
    .filter(q => !['aceptada','rechazada'].includes(q.stage) && q.monto)
    .reduce((s, q) => s + q.monto, 0);

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
              {availableSellers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="inp text-xs py-1.5" value={filterZone} onChange={e=>setFilterZone(e.target.value)}>
              <option value="">Todas las zonas</option>
              {availableZones.map(z=><option key={z} value={z}>{z}</option>)}
            </select>
            <select className="inp text-xs py-1.5" value={filterProv} onChange={e=>setFilterProv(e.target.value)}>
              <option value="">Todas las provincias</option>
              {availableProvs.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            {hasFilters && (
              <button className="btn-ghost text-xs" onClick={()=>{setSearch('');setFilterSeller('');setFilterZone('');setFilterProv('');}}>
                <Icon name="x" size={12}/>Limpiar
              </button>
            )}
            {isAdmin && !readonly && (
              <>
                <button onClick={()=>setShowImport(true)} className="btn-ghost text-xs flex items-center gap-1.5">
                  <Icon name="upload" size={13}/>Importar XLS
                </button>
                <button onClick={()=>setShowDeleteAll(true)} className="btn-ghost text-xs flex items-center gap-1.5 text-red-500 hover:bg-red-50 hover:border-red-200">
                  <Icon name="trash-2" size={13}/>Eliminar todos
                </button>
              </>
            )}
            {!readonly && <button className="btn-primary" onClick={()=>openModal('newClient')}><Icon name="plus" size={14}/>Nuevo cliente</button>}
          </>
        }
      />
      <div className="flex h-[calc(100vh-136px)] overflow-hidden relative">
        {/* list panel */}
        <div
          className="shrink-0 bg-white overflow-hidden"
          style={{ width: listCollapsed ? 0 : listWidth, transition: 'width 0.18s ease', minWidth: 0 }}
        >
          <div className="h-full overflow-y-auto scroll-thin border-r border-line flex flex-col" style={{ width: listWidth, minWidth: 200 }}>
            <div className="flex-1">
              {pagedClients.map(c => {
                const s = users.find(u=>u.id===c.seller);
                const active = c.code === activeSel;
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
            {/* Paginación */}
            {totalPages > 1 && (
              <div className="shrink-0 border-t border-line px-3 py-2 flex items-center justify-between bg-surface">
                <button onClick={()=>setListPage(p=>Math.max(0,p-1))} disabled={listPage===0}
                  className="w-7 h-7 rounded flex items-center justify-center hover:bg-line disabled:opacity-30">
                  <Icon name="chevron-left" size={13}/>
                </button>
                <span className="text-[11px] text-ink-500">
                  {listPage+1} / {totalPages} <span className="text-ink-300">·</span> {filteredClients.length} clientes
                </span>
                <button onClick={()=>setListPage(p=>Math.min(totalPages-1,p+1))} disabled={listPage===totalPages-1}
                  className="w-7 h-7 rounded flex items-center justify-center hover:bg-line disabled:opacity-30">
                  <Icon name="chevron-right" size={13}/>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Resize + collapse handle */}
        <div className="relative shrink-0 z-20" style={{ width: 0 }}>
          {/* Drag strip — visible only when list is open */}
          {!listCollapsed && (
            <div
              className="absolute inset-y-0 cursor-col-resize hover:bg-brand/10 active:bg-brand/20"
              style={{ left: -3, width: 8 }}
              onMouseDown={startDrag}
            />
          )}
          {/* Collapse / expand button */}
          <button
            onClick={() => setListCollapsed(v => !v)}
            title={listCollapsed ? 'Mostrar lista de clientes' : 'Ocultar lista de clientes'}
            className="absolute top-1/2 -translate-y-1/2 bg-white border border-line hover:bg-brandSoft hover:border-brand/40 transition-colors flex items-center justify-center shadow-sm"
            style={{
              left: listCollapsed ? 4 : -10,
              width: 18,
              height: 44,
              borderRadius: listCollapsed ? '0 6px 6px 0' : '6px',
              transition: 'left 0.18s ease',
            }}
          >
            <Icon name={listCollapsed ? 'chevron-right' : 'chevron-left'} size={11} className="text-ink-500"/>
          </button>
        </div>

        {/* detail */}
        <div className="flex-1 min-w-0 overflow-y-auto scroll-thin p-6 space-y-5">
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
                <button className="btn-ghost" onClick={()=>openModal('clientDetail', { clientId: cli.id })}><Icon name="clock" size={13}/>Timeline</button>
                <button className="btn-ghost" onClick={()=>openModal('editClient', { clientId: cli.id })}><Icon name="pencil" size={13}/>Editar</button>
                {isAdmin && (
                  <button
                    disabled={deleting}
                    onClick={async () => {
                      if (!window.confirm(`¿Eliminar a ${cli.name}?\n\nSolo se puede eliminar si no tiene cotizaciones ni órdenes.`)) return;
                      setDeleting(true);
                      try {
                        await CrmApi.deleteClient(cli.id);
                        setClients(prev => prev.filter(c => c.id !== cli.id));
                        setSel('');
                      } catch(e) {
                        alert(e.message || 'Error al eliminar cliente');
                      } finally { setDeleting(false); }
                    }}
                    className="btn-ghost text-red-500 hover:bg-red-50 hover:border-red-200 disabled:opacity-50">
                    <Icon name={deleting ? 'loader' : 'trash-2'} size={13} className={deleting ? 'animate-spin' : ''}/>
                    Eliminar
                  </button>
                )}
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
            <Field label="Email">
              {cliEmails.length > 0 ? (
                <div>
                  {(emailsExpanded ? cliEmails : cliEmails.slice(0,1)).map(e => (
                    <div key={e.id} className="flex items-center gap-1.5 min-w-0">
                      {e.isPrimary && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" title="Principal"/>}
                      <a href={`mailto:${e.email}`} className="text-brand hover:underline text-[13px] truncate block" title={e.email}>{e.email}</a>
                    </div>
                  ))}
                  {cliEmails.length > 1 && (
                    <button onClick={() => setEmailsExpanded(v => !v)}
                      className="text-[11px] text-brand hover:underline mt-1 flex items-center gap-1">
                      <Icon name={emailsExpanded ? 'chevron-up' : 'chevron-down'} size={11}/>
                      {emailsExpanded ? 'Ver menos' : `+${cliEmails.length - 1} email${cliEmails.length - 1 > 1 ? 's' : ''} más`}
                    </button>
                  )}
                </div>
              ) : cli.email ? (
                <a href={`mailto:${cli.email}`} className="text-brand hover:underline text-[13px] truncate block" title={cli.email}>{cli.email}</a>
              ) : '—'}
            </Field>
            <Field label="Teléfono" mono value={cli.phone}/>
            <Field label="Dirección" value={cli.address}/>
            <Field label="Estado">
              <Badge tone="green" dot>Activo</Badge>
            </Field>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3">
            {[
              {
                k: 'Cotizaciones',
                v: cliQuotes.length,
                sub: `${cliQuotes.filter(q=>q.stage==='aceptada').length} ganadas · ${cliQuotes.filter(q=>q.stage==='rechazada').length} rechazadas`,
                tone: 'blue', icon: 'clipboard-list',
              },
              {
                k: 'OCs activas',
                v: cliOrders.filter(o=>o.stage!=='entregada').length,
                sub: `${cliOrders.length} órdenes en total`,
                tone: 'orange', icon: 'truck',
              },
              {
                k: 'OCs entregadas',
                v: cliOrders.filter(o=>o.stage==='entregada').length,
                sub: 'historial completo',
                tone: 'green', icon: 'check-circle',
              },
              {
                k: 'Monto ganado',
                v: fmtMoney(montoGanado),
                sub: montoEnCurso > 0 ? `+ ${fmtMoney(montoEnCurso)} en curso` : 'en cotizaciones aceptadas',
                tone: 'navy', icon: 'banknote',
              },
            ].map((k,i)=>(
              <div key={i} className="bg-white border border-line rounded-xl p-4 flex items-start gap-3">
                <div className={cx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  k.tone==='blue'?'bg-brandSoft text-brand':
                  k.tone==='green'?'bg-emerald-100 text-emerald-700':
                  k.tone==='orange'?'bg-orange-100 text-orange-700':'bg-navy-900 text-white')}>
                  <Icon name={k.icon} size={16}/>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{k.k}</div>
                  <div className="text-xl font-bold text-ink-900 mt-1">{k.v}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{k.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Historial comercial — clickeable */}
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-semibold">Historial comercial</div>
              <span className="text-[11px] text-ink-400">{cliHistory.length} registros · más reciente primero</span>
            </div>
            {cliHistory.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-ink-400">Sin cotizaciones ni OCs para este cliente.</div>
            ) : (
              <table className="tbl w-full">
                <thead><tr>
                  <th>Tipo</th><th>Código</th><th>Etapa</th><th>Vendedor</th><th>Fecha</th><th className="!text-right">Monto</th>
                </tr></thead>
                <tbody>
                  {cliHistory.map(row => {
                    const isQ = row._kind === 'quote';
                    const stg = isQ
                      ? STAGES_F1.find(s=>s.id===row.stage)
                      : STAGES_F2.find(s=>s.id===row.stage);
                    const s = users.find(u=>u.id===row.seller);
                    return (
                      <tr key={row.code} className="cursor-pointer hover:bg-brandSoft/30"
                        onClick={() => openModal(isQ ? 'quoteDetail' : 'orderDetail', { code: row.code })}>
                        <td>
                          <Badge tone={isQ ? 'slate' : 'navy'}>{isQ ? 'COT' : 'OC'}</Badge>
                        </td>
                        <td className="mono font-semibold text-[12px]">{row.code}</td>
                        <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : <span className="text-ink-400">{row.stage}</span>}</td>
                        <td className="text-[12px]">{s?.name?.split(' ')?.[0]||'—'}</td>
                        <td className="mono text-[12px]">{row._date ? fmtDate(row._date) : '—'}</td>
                        <td className="text-right mono text-[12px]">{isQ ? fmtMoney(row.monto) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          </>}
        </div>
      </div>

      {/* Import modal */}
      {showImport && (
        <ClientImportModal
          onClose={() => setShowImport(false)}
          onDone={reloadClients}
        />
      )}
      {/* Delete all modal */}
      {showDeleteAll && (
        <DeleteAllModal
          title="Eliminar todos los clientes"
          description={`Se van a eliminar todos los clientes sin historial (cotizaciones u órdenes). Los que tengan historial se conservan.`}
          onClose={() => setShowDeleteAll(false)}
          onConfirm={async () => {
            const res = await CrmApi.deleteAllClients();
            await reloadClients();
            setSel('');
          }}
        />
      )}
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
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [emailError, setEmailError] = useState('');
  const [allowedDomains, setAllowedDomains] = useState([]);
  const [allowedEmails, setAllowedEmails] = useState([]);
  const { pushToast } = useApp();

  // Cargar dominios y correos permitidos al montar
  useEffect(() => {
    fetch('/api/auth/config').then(r => r.json())
      .then(d => {
        setAllowedDomains(d.allowedDomains || []);
        setAllowedEmails((d.allowedEmails || []).map(e => e.toLowerCase()));
      })
      .catch(() => {});
  }, []);

  // Validar dominio del email en tiempo real
  useEffect(() => {
    if (!form.email || user || allowedDomains.length === 0) { setEmailError(''); return; }
    const normalized = form.email.toLowerCase().trim();
    // Si el correo completo está en la whitelist individual, permitir
    if (allowedEmails.includes(normalized)) { setEmailError(''); return; }
    const domain = normalized.split('@')[1];
    if (!domain) { setEmailError(''); return; }
    if (!allowedDomains.includes(domain)) {
      setEmailError(`Dominio @${domain} no permitido. Válidos: ${allowedDomains.join(', ')}. También podés agregar correos individuales en Config → Acceso.`);
    } else {
      setEmailError('');
    }
  }, [form.email, allowedDomains, allowedEmails, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.email) { setError('Nombre y email son requeridos'); return; }
    setLoading(true);
    try {
      const data = { name: form.name, email: form.email, role: form.role, zone: form.zone };
      if (user && form.password) data.password = form.password; // Solo al editar se puede cambiar password
      const saved = user
        ? await CrmApi.updateUser(user.id, data)
        : await CrmApi.createUser(data);
      onSave(saved);
      pushToast(
        user ? 'Usuario actualizado'
             : `Usuario creado — mail de bienvenida enviado a ${form.email}`,
        'ok'
      );
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
            <input className={cx('inp w-full', emailError && 'border-red-400 focus:ring-red-300')}
              type="email" placeholder="juan@myselec.com.ar" {...f('email')}
              readOnly={!!user}/>
            {emailError && (
              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-red-600">
                <Icon name="alert-circle" size={12}/>{emailError}
              </div>
            )}
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
          {/* Al crear: sin campo de contraseña (se genera automáticamente + link de reset) */}
          {!user && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Icon name="mail" size={14} className="text-blue-500 mt-0.5 shrink-0"/>
                <div>
                  <div className="text-[12px] font-medium text-blue-800">Contraseña por mail</div>
                  <div className="text-[11px] text-blue-600 mt-0.5 leading-relaxed">
                    Se enviará un mail de bienvenida con un link para que el usuario configure su propia contraseña. El link expira en 48 horas.
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* Al editar: campo opcional para cambiar contraseña con validación + visibilidad */}
          {user && (() => {
            const pw = form.password;
            const pwRules = pw ? [
              { label: 'Mínimo 8 caracteres',    ok: pw.length >= 8 },
              { label: 'Al menos una mayúscula', ok: /[A-Z]/.test(pw) },
              { label: 'Al menos un número',     ok: /[0-9]/.test(pw) },
            ] : [];
            const pwValid = !pw || pwRules.every(r => r.ok);
            return (
              <div>
                <label className="block text-xs font-medium text-ink-700 mb-1">
                  Nueva contraseña (dejar vacío para no cambiar)
                </label>
                <div className="relative">
                  <input
                    className={cx('inp w-full pr-10', pw && !pwValid && 'border-red-400')}
                    type={form._showPw ? 'text' : 'password'} placeholder="••••••••" {...f('password')}/>
                  <button type="button" onClick={() => setForm(v => ({...v, _showPw: !v._showPw}))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" tabIndex={-1}>
                    <Icon name={form._showPw ? 'eye-off' : 'eye'} size={15}/>
                  </button>
                </div>
                {pw && (
                  <div className="space-y-1 mt-2">
                    {pwRules.map(r => (
                      <div key={r.label} className={cx('flex items-center gap-2 text-[12px]', r.ok ? 'text-ok' : 'text-ink-400')}>
                        <Icon name={r.ok ? 'check-circle' : 'circle'} size={13} className={r.ok ? 'text-ok' : 'text-ink-300'}/>
                        {r.label}
                      </div>
                    ))}
                    <div className="text-[11px] text-ink-400 mt-1.5 leading-relaxed">
                      Se notificará al usuario por mail que su contraseña fue cambiada.
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="flex gap-2 pt-2">
            <button type="submit" className="btn-primary flex-1 justify-center"
              disabled={loading || (!user && !!emailError) || (user && form.password && (form.password.length < 8 || !/[A-Z]/.test(form.password) || !/[0-9]/.test(form.password)))}>
              {loading ? 'Guardando...' : (user ? 'Guardar cambios' : 'Crear usuario')}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApproveUserModal({ user, onClose, onApprove }) {
  const [role, setRole] = React.useState('VENDEDOR');
  const [loading, setLoading] = React.useState(false);

  const handleApprove = async () => {
    setLoading(true);
    await onApprove(user.id, role);
    setLoading(false);
  };

  const roleLabel = { ADMIN:'Administrador', VENDEDOR:'Vendedor', LOGISTICA:'Logística' };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="font-semibold">Aprobar usuario</div>
          <button onClick={onClose} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-surface">
            <Avatar name={user.name} size={36}/>
            <div>
              <div className="font-semibold text-[13px]">{user.name}</div>
              <div className="text-[12px] text-ink-500">{user.email}</div>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium text-ink-600 mb-1.5 block">Asignar rol</label>
            <div className="flex flex-col gap-2">
              {['VENDEDOR','LOGISTICA','ADMIN'].map(r => (
                <label key={r} className={cx('flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  role === r ? 'border-brand bg-blue-50' : 'border-line hover:bg-surface')}>
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="accent-brand"/>
                  <span className="text-[13px] font-medium">{roleLabel[r]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-line">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={handleApprove} disabled={loading} className="btn-primary">
            <Icon name="user-check" size={14}/>
            {loading ? 'Aprobando...' : 'Aprobar acceso'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Team() {
  const { quotes, orders, clients, pushToast } = useApp();
  const [users,    setUsers]    = useState(null);
  const [pending,  setPending]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null); // null | { mode:'create' } | { mode:'edit', user } | { mode:'approve', user }

  useEffect(() => {
    Promise.all([CrmApi.getUsersFull(), CrmApi.getPendingUsers()])
      .then(([data, pend]) => { setUsers(data); setPending(pend); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = (saved) => {
    setUsers(prev => {
      if (!prev) return [saved];
      const idx = prev.findIndex(u => u.id === saved.id);
      return idx >= 0 ? prev.map(u => u.id === saved.id ? {...u, ...saved} : u) : [...prev, saved];
    });
  };

  const handleToggle = async (u, force = false) => {
    try {
      const res = await fetch(`/api/users/${u.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify(force ? { forceDeactivate: true } : {}),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresConfirmation) {
        if (window.confirm(`${data.error}\n\n¿Desactivarlo igualmente?`)) {
          return handleToggle(u, true);
        }
        return;
      }
      if (!res.ok) { pushToast(data.error || 'Error', 'bad'); return; }
      setUsers(prev => prev.map(x => x.id === u.id ? {...x, active: data.active} : x));
      pushToast(`${u.name} ${data.active ? 'activado' : 'desactivado'}`);
    } catch (err) {
      pushToast(err.message || 'Error', 'bad');
    }
  };

  const handleApprove = async (userId, role) => {
    try {
      const approved = await CrmApi.approveUser(userId, role);
      setPending(prev => prev.filter(u => u.id !== userId));
      setUsers(prev => prev ? [...prev, { ...approved, cotiz:0, ganadas:0, ocs:0, clientes:0 }] : [approved]);
      setModal(null);
      pushToast(`Usuario aprobado como ${role}`);
    } catch (err) {
      pushToast(err.message || 'Error al aprobar', 'bad');
    }
  };

  const handleReject = async (userId, name) => {
    if (!confirm(`¿Rechazar la solicitud de ${name}? Se eliminará su registro.`)) return;
    try {
      await CrmApi.rejectUser(userId);
      setPending(prev => prev.filter(u => u.id !== userId));
      pushToast('Solicitud rechazada');
    } catch (err) {
      pushToast(err.message || 'Error al rechazar', 'bad');
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
            <Avatar name={u.name} size={32} src={u.avatar}/>
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
            {/* Toggle notificación mails sin cliente */}
            {(
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/users/${u.id}/notify-unassigned`, {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                    });
                    if (res.ok) {
                      const d = await res.json();
                      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, notifyUnassigned: d.notifyUnassigned } : x));
                      pushToast(d.notifyUnassigned ? 'Activadas alertas sin cliente' : 'Desactivadas alertas sin cliente', 'ok');
                    } else {
                      const d = await res.json().catch(() => ({}));
                      pushToast(d.error || 'Error al actualizar', 'bad');
                    }
                  } catch (e) { pushToast(e.message || 'Error al actualizar', 'bad'); }
                }}
                title={u.notifyUnassigned !== false ? 'Desactivar alertas de mails sin cliente' : 'Activar alertas de mails sin cliente'}
                className="btn-ghost p-1.5 relative group"
              >
                <Icon
                  name={u.notifyUnassigned !== false ? 'bell' : 'bell-off'}
                  size={13}
                  className={u.notifyUnassigned !== false ? 'text-brand' : 'text-ink-300'}
                />
                <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block bg-ink-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                  {u.notifyUnassigned !== false ? 'Recibe alertas sin cliente' : 'Sin alertas sin cliente'}
                </span>
              </button>
            )}
            <button
              onClick={async () => {
                try {
                  await CrmApi.resendWelcome(u.id);
                  pushToast(`Mail de bienvenida reenviado a ${u.email}`, 'ok');
                } catch (e) { pushToast(e.message || 'Error al reenviar', 'bad'); }
              }}
              className="btn-ghost p-1.5 relative group" title="Reenviar mail de bienvenida">
              <Icon name="mail" size={13} className="text-ink-400"/>
              <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block bg-ink-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                Reenviar bienvenida
              </span>
            </button>
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
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                <Icon name="clock" size={13}/>
                {pending.length} pendiente{pending.length > 1 ? 's' : ''} de aprobación
              </div>
            )}
            <button className="btn-primary" onClick={() => setModal({ mode:'create' })}>
              <Icon name="user-plus" size={14}/>Nuevo usuario
            </button>
          </div>
        }
      />

      {modal && modal.mode !== 'approve' && (
        <UserModal
          user={modal.mode === 'edit' ? modal.user : null}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {modal && modal.mode === 'approve' && (
        <ApproveUserModal
          user={modal.user}
          onClose={() => setModal(null)}
          onApprove={handleApprove}
        />
      )}

      <div className="p-6 space-y-5">
        {loading ? (
          <div className="text-center text-ink-400 py-10">Cargando usuarios…</div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="bg-white rounded-xl border border-amber-200 shadow-card overflow-hidden">
                <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
                  <Icon name="clock" size={15} className="text-amber-600"/>
                  <div className="text-sm font-semibold text-amber-800">Solicitudes pendientes de aprobación</div>
                  <div className="ml-auto text-xs text-amber-600">{pending.length} solicitud{pending.length > 1 ? 'es' : ''}</div>
                </div>
                <table className="tbl w-full">
                  <thead><tr>
                    <th>Usuario</th><th>Teléfono</th><th>DNI</th><th>CUIT</th><th>Fecha solicitud</th><th></th>
                  </tr></thead>
                  <tbody>
                    {pending.map(u => (
                      <tr key={u.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={u.name} size={32} src={u.avatar}/>
                            <div>
                              <div className="font-semibold text-[13px]">{u.name}</div>
                              <div className="text-[11px] text-ink-500">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-[13px]">{u.phone || '—'}</td>
                        <td className="text-[13px] mono">{u.dni || '—'}</td>
                        <td className="text-[13px] mono">{u.cuit || '—'}</td>
                        <td className="text-[12px] text-ink-500">{new Date(u.createdAt).toLocaleDateString('es-AR')}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setModal({ mode:'approve', user: u })}
                              className="btn-ghost p-1.5 text-ok" title="Aprobar">
                              <Icon name="user-check" size={14} className="text-ok"/>
                            </button>
                            <button onClick={() => handleReject(u.id, u.name)}
                              className="btn-ghost p-1.5" title="Rechazar">
                              <Icon name="user-x" size={14} className="text-red-400"/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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
  const { pushToast, users } = useApp();
  const [tab, setTab] = useState('stages');
  const [stagesData, setStagesData] = useState(null);
  const [stagesLoading, setStagesLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editTone, setEditTone] = useState('gray');
  const [newStage, setNewStage] = useState({ label: '', tone: 'gray', phase: null });
  const [dragOverId, setDragOverId] = useState(null);
  const dragItem = React.useRef(null);

  // Etapas de entrada por tipo de mail
  const [incomingStages, setIncomingStages] = useState({
    default_stage_solicitud:   'recibida',
    default_stage_presupuesto: 'enviado',
    default_stage_nota_pedido: 'np_enviada',
  });
  const [followUpDays, setFollowUpDays] = useState('4');
  const [allowedEmailDomains, setAllowedEmailDomains] = useState('myselec.com,myselec.com.ar,gmail.com');
  const [allowedEmails,       setAllowedEmails]       = useState('');
  const [savingDomains,       setSavingDomains]       = useState(false);
  const [savingEmails,        setSavingEmails]        = useState(false);
  // Alertas automáticas
  const [idleInboxDays,        setIdleInboxDays]        = useState('5');
  const [idleEmailDays,        setIdleEmailDays]        = useState('7');
  const [weeklyReportEnabled,  setWeeklyReportEnabled]  = useState('true');
  const [weeklyReportDay,      setWeeklyReportDay]      = useState('1');
  const [weeklyReportHour,     setWeeklyReportHour]     = useState('9');
  const [stageCooldownDays,    setStageCooldownDays]    = useState('3');
  const [unassignedMailFreq,   setUnassignedMailFreq]   = useState('daily');
  const [solSinPresDays,       setSolSinPresDays]       = useState('3');
  const [followUpUpcomingDays, setFollowUpUpcomingDays] = useState('1');
  const [noResponseDays,       setNoResponseDays]       = useState('4');
  const [showVars, setShowVars] = useState(false);

  // Email templates state
  const [emailTemplates, setEmailTemplates]   = useState([]);
  const [emailCCDefault, setEmailCCDefault]   = useState('');
  const [emailTplLoading, setEmailTplLoading] = useState(false);
  const [editingTpl, setEditingTpl]           = useState(null); // null | template-object
  const [tplSaving, setTplSaving]             = useState(false);

  // Notifications state
  const [notifRules, setNotifRules] = useState([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifModal, setNotifModal] = useState(null); // null | 'new' | rule-object

  // System notification toggles (mail)
  const [sysNotifMail, setSysNotifMail] = useState({
    notify_new_register:    'true',
    notify_stage_alert:     'true',
    notify_unassigned_mail: 'true',
  });
  // System notification toggles (in-app)
  const [sysNotifInapp, setSysNotifInapp] = useState({
    inapp_unassigned_quotes: 'true',
    inapp_pending_users:     'true',
    inapp_overdue_stages:    'true',
    inapp_idle_quotes:       'true',
    inapp_follow_up:             'true',
    inapp_unlinked_solicitudes:  'true',
    inapp_follow_up_upcoming:    'true',
    inapp_no_response:           'true',
  });

  // Mail state
  const [mailAccounts,  setMailAccounts]  = useState([]);
  const [mailSettings,  setMailSettings]  = useState({ mail_sync_interval_hours: '2', mail_lookback_days: '2', mail_sync_enabled: 'true' });
  const [mailLoading,   setMailLoading]   = useState(false);
  const [mailSyncing,    setMailSyncing]    = useState({}); // { [email]: true/false }
  const [mailSyncingAll, setMailSyncingAll] = useState(false);
  const [mailTesting,    setMailTesting]    = useState({}); // { [email]: true/false }
  const [mailTestResult, setMailTestResult] = useState({}); // { [email]: { ok, error, labels } }
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addAccountForm, setAddAccountForm] = useState({ user: '', password: '' });
  const [addAccountMode, setAddAccountMode] = useState('selector'); // 'selector' | 'manual'
  const [addAccountLoading, setAddAccountLoading] = useState(false);
  const [addAccountError, setAddAccountError] = useState('');

  useEffect(() => {
    CrmApi.getStagesFull()
      .then(data => { setStagesData(data.map(s => ({ ...s, _unit: 'días' }))); setStagesLoading(false); })
      .catch(() => setStagesLoading(false));
    // Cargar settings de etapas de entrada
    fetch('/api/settings', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } })
      .then(r => r.json())
      .then(s => {
        setIncomingStages(prev => ({ ...prev, ...s }));
        if (s.follow_up_days)           setFollowUpDays(s.follow_up_days);
        if (s.allowed_email_domains)    setAllowedEmailDomains(s.allowed_email_domains);
        if (s.allowed_emails !== undefined) setAllowedEmails(s.allowed_emails);
        if (s.idle_inbox_days)          setIdleInboxDays(s.idle_inbox_days);
        if (s.idle_email_days)          setIdleEmailDays(s.idle_email_days);
        if (s.weekly_report_enabled !== undefined) setWeeklyReportEnabled(s.weekly_report_enabled);
        if (s.weekly_report_day     !== undefined) setWeeklyReportDay(s.weekly_report_day);
        if (s.weekly_report_hour    !== undefined) setWeeklyReportHour(s.weekly_report_hour);
        // System notification toggles
        setSysNotifMail(prev => ({
          ...prev,
          notify_new_register:    s.notify_new_register    ?? 'true',
          notify_stage_alert:     s.notify_stage_alert     ?? 'true',
          notify_unassigned_mail: s.notify_unassigned_mail ?? 'true',
        }));
        setSysNotifInapp(prev => ({
          ...prev,
          inapp_unassigned_quotes:    s.inapp_unassigned_quotes    ?? 'true',
          inapp_pending_users:        s.inapp_pending_users        ?? 'true',
          inapp_overdue_stages:       s.inapp_overdue_stages       ?? 'true',
          inapp_idle_quotes:          s.inapp_idle_quotes          ?? 'true',
          inapp_follow_up:            s.inapp_follow_up            ?? 'true',
          inapp_unlinked_solicitudes: s.inapp_unlinked_solicitudes ?? 'true',
          inapp_follow_up_upcoming:   s.inapp_follow_up_upcoming   ?? 'true',
          inapp_no_response:          s.inapp_no_response          ?? 'true',
        }));
        if (s.stage_alert_cooldown_days) setStageCooldownDays(s.stage_alert_cooldown_days);
        if (s.unassigned_mail_frequency) setUnassignedMailFreq(s.unassigned_mail_frequency);
        if (s.solicitud_sin_pres_days)   setSolSinPresDays(s.solicitud_sin_pres_days);
        if (s.follow_up_upcoming_days)   setFollowUpUpcomingDays(s.follow_up_upcoming_days);
        if (s.no_response_days)          setNoResponseDays(s.no_response_days);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'notifs') return;
    setNotifLoading(true);
    CrmApi.getNotificationRules()
      .then(r => { setNotifRules(r); setNotifLoading(false); })
      .catch(() => setNotifLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'mail') return;
    setMailLoading(true);
    setEmailTplLoading(true);
    Promise.all([
      fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json()),
      fetch('/api/settings',      { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json()),
      CrmApi.getEmailTemplates(),
    ]).then(([accounts, settings, { templates, ccDefault }]) => {
      setMailAccounts(Array.isArray(accounts) ? accounts : []);
      setMailSettings(s => ({ ...s, ...settings }));
      setEmailTemplates(templates || []);
      setEmailCCDefault(ccDefault || '');
      setMailLoading(false);
      setEmailTplLoading(false);
    }).catch(() => { setMailLoading(false); setEmailTplLoading(false); });
  }, [tab]);

  const handleMailSettingSave = async () => {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      body: JSON.stringify(mailSettings),
    });
  };

  const handleSyncAll = async () => {
    setMailSyncingAll(true);
    try {
      const res = await fetch('/api/mail/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      const data = await res.json();
      if (data.synced > 0) {
        pushToast(`✅ ${data.synced} mail(s) procesado(s)`);
      } else {
        pushToast(`Sync completo · sin novedades`);
      }
      if (data.errors?.length) {
        setTimeout(() => pushToast(`⚠️ ${data.errors[0]}`, 'bad'), 600);
      }
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
      // Mostrar éxito aunque haya errores menores (etiqueta, etc.)
      if (data.synced > 0) {
        pushToast(`✅ ${data.synced} mail(s) procesado(s)`);
      } else {
        pushToast(`Sync completo · sin novedades`);
      }
      if (data.errors?.length) {
        setTimeout(() => pushToast(`⚠️ ${data.errors[0]}`, 'bad'), 600);
      }
      const accounts = await fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json());
      setMailAccounts(Array.isArray(accounts) ? accounts : []);
    } catch { pushToast('Error al sincronizar', 'bad'); }
    setMailSyncing(s => ({ ...s, [email]: false }));
  };

  const handleTestAccount = async (email) => {
    setMailTesting(s => ({ ...s, [email]: true }));
    setMailTestResult(s => ({ ...s, [email]: null }));
    try {
      const res = await fetch(`/api/mail/test/${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      const data = await res.json();
      setMailTestResult(s => ({ ...s, [email]: data }));
    } catch (e) {
      setMailTestResult(s => ({ ...s, [email]: { ok: false, error: e.message } }));
    }
    setMailTesting(s => ({ ...s, [email]: false }));
  };

  const reloadMailAccounts = async () => {
    const accounts = await fetch('/api/mail/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } }).then(r => r.json());
    setMailAccounts(Array.isArray(accounts) ? accounts : []);
  };

  const handleAddAccount = async (e) => {
    e.preventDefault();
    setAddAccountError('');
    if (!addAccountForm.user || !addAccountForm.password) { setAddAccountError('Completá email y contraseña'); return; }
    setAddAccountLoading(true);
    try {
      await CrmApi.addMailAccount(addAccountForm.user.trim(), addAccountForm.password.trim());
      await reloadMailAccounts();
      setAddAccountOpen(false);
      setAddAccountForm({ user: '', password: '' });
      setAddAccountMode('selector');
      pushToast('Cuenta agregada');
    } catch (err) {
      setAddAccountError(err.message || 'Error al agregar cuenta');
    } finally { setAddAccountLoading(false); }
  };

  const handleDeleteAccount = async (email) => {
    if (!confirm(`¿Eliminar la cuenta ${email}?`)) return;
    try {
      await CrmApi.deleteMailAccount(email);
      await reloadMailAccounts();
      pushToast('Cuenta eliminada');
    } catch (err) {
      pushToast(err.message || 'Error al eliminar', 'bad');
    }
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

  const UNIT_MULT = { horas: 1, días: 24, semanas: 168, meses: 720 };

  const handleUpdateMaxHours = async (stage, hours) => {
    if (hours === stage.maxHours) return;
    setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, maxHours: hours} : s));
    try {
      await CrmApi.updateStage(stage.id, { maxHours: hours });
      pushToast(`${stage.label} — tiempo máximo actualizado`);
    } catch (err) {
      pushToast(err.message || 'Error al actualizar', 'bad');
    }
  };

  const handleToggleEmailAlert = async (stage) => {
    if (!stage.maxHours) return; // solo cuando hay tiempo máximo configurado
    const next = !stage.emailAlert;
    setStagesData(sd => sd.map(s => s.id === stage.id ? {...s, emailAlert: next} : s));
    try {
      await CrmApi.updateStage(stage.id, { emailAlert: next });
      pushToast(`${stage.label} — alerta por mail ${next ? 'activada' : 'desactivada'}`);
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

  const saveEntryStage = async (key, value) => {
    setIncomingStages(s => ({ ...s, [key]: value }));
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify({ [key]: value }),
      });
      pushToast('Etapa de entrada guardada');
    } catch { pushToast('Error al guardar', 'bad'); }
  };

  const saveFollowUpDays = async (val) => {
    setFollowUpDays(val);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify({ follow_up_days: val }),
      });
      pushToast('Días de seguimiento guardados');
    } catch { pushToast('Error al guardar', 'bad'); }
  };

  const saveAutoAlertSetting = async (key, val, setter) => {
    setter(val);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
        body: JSON.stringify({ [key]: val }),
      });
      pushToast('Configuración guardada');
    } catch { pushToast('Error al guardar', 'bad'); }
  };

  const StageList = ({ stages, phase, title, entryKeys = [] }) => (
    <div className="bg-white border border-line rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {entryKeys.length > 0 && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {entryKeys.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="text-[11px] text-ink-500 font-medium">Entrada {label}:</span>
                  <select
                    value={incomingStages[key] || ''}
                    onChange={e => saveEntryStage(key, e.target.value)}
                    className="border border-line rounded-md px-1.5 py-0.5 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-brand/30 text-ink-700"
                  >
                    {stages.map(s => (
                      <option key={s.id} value={s.stageKey}>{s.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setNewStage({ label: '', tone: 'gray', phase })}
          className="btn-ghost text-[12px] flex items-center gap-1 text-brand shrink-0">
          <Icon name="plus" size={13}/> Agregar etapa
        </button>
      </div>
      {stagesLoading ? (
        <div className="text-[13px] text-ink-400 py-6 text-center">Cargando etapas…</div>
      ) : (<>
        {/* Header de columnas */}
        <div className="flex items-center gap-2 px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400 select-none">
          <div className="w-5 shrink-0"/>
          <div className="w-5 shrink-0"/>
          <div className="w-2.5 shrink-0"/>
          <div className="flex-1">Etapa</div>
          <div className="w-[102px] text-center">Obligatoria</div>
          <div className="w-[168px] text-center">Tiempo máx.</div>
          <div className="w-[52px]"/>
        </div>
        <ul className="space-y-1.5">
          {stages.map((s, i) => (
            <li key={s.id}
              draggable={editingId !== s.id}
              onDragStart={() => { dragItem.current = { id: s.id, phase }; }}
              onDragEnter={() => setDragOverId(s.id)}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const fromId = dragItem.current?.id;
                if (!fromId || fromId === s.id || dragItem.current?.phase !== phase) return;
                const list = [...stages];
                const fromIdx = list.findIndex(x => x.id === fromId);
                const toIdx   = list.findIndex(x => x.id === s.id);
                const [moved] = list.splice(fromIdx, 1);
                list.splice(toIdx, 0, moved);
                setStagesData(sd => [...sd.filter(x => x.phase !== phase), ...list]);
                setDragOverId(null);
                dragItem.current = null;
                CrmApi.reorderStages(list.map(x => x.id))
                  .then(() => pushToast('Orden actualizado'))
                  .catch(err => pushToast(err.message || 'Error al reordenar', 'bad'));
              }}
              onDragEnd={() => { dragItem.current = null; setDragOverId(null); }}
              className={cx('rounded-lg transition-all', dragOverId === s.id && dragItem.current?.id !== s.id && 'ring-2 ring-brand ring-offset-1')}
            >
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
                  {/* Handle de arrastre */}
                  <div className="w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-ink-300 hover:text-ink-500 shrink-0 select-none"
                    title="Arrastrar para reordenar">
                    <Icon name="grip-vertical" size={14}/>
                  </div>
                  <span className="w-5 text-right mono text-[11px] text-ink-400 font-semibold">{i+1}.</span>
                  <StageDot tone={s.tone}/>
                  <span className="flex-1 text-[13px] font-medium text-ink-900">{s.label}</span>
                  {/* Columna Obligatoria — solo el toggle, centrado */}
                  <div className="w-[102px] flex justify-center shrink-0">
                    <button onClick={() => handleToggleMandatory(s)}
                      title={s.mandatory ? 'Quitar obligatoria' : 'Marcar como obligatoria'}
                      className={cx('w-8 h-4 rounded-full relative transition-colors',
                        s.mandatory ? 'bg-brand' : 'bg-ink-300')}>
                      <div className={cx('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
                        s.mandatory ? 'left-[18px]' : 'left-0.5')}/>
                    </button>
                  </div>
                  {/* Zona de tiempo máximo — ancho fijo para que nada se mueva */}
                  <div className="flex items-center gap-1.5 shrink-0 w-[168px]">
                    <button
                      title={s.maxHours ? 'Desactivar tiempo máximo' : 'Activar tiempo máximo'}
                      onClick={() => {
                        if (s.maxHours) {
                          setStagesData(sd => sd.map(x => x.id === s.id ? {...x, maxHours: null} : x));
                          handleUpdateMaxHours(s, null);
                        } else {
                          const defaultHours = UNIT_MULT[s._unit || 'días'];
                          setStagesData(sd => sd.map(x => x.id === s.id ? {...x, maxHours: defaultHours} : x));
                          handleUpdateMaxHours({...s, maxHours: null}, defaultHours);
                        }
                      }}
                      className={cx('w-7 h-3.5 rounded-full relative transition-colors shrink-0',
                        s.maxHours ? 'bg-brand' : 'bg-ink-300')}>
                      <div className={cx('absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all',
                        s.maxHours ? 'left-[14px]' : 'left-0.5')}/>
                    </button>
                    <input type="number" min="1"
                      disabled={!s.maxHours}
                      value={s.maxHours && s._unit ? Math.round(s.maxHours / UNIT_MULT[s._unit]) : (s.maxHours || '')}
                      placeholder="∞"
                      onChange={e => {
                        const mult = UNIT_MULT[s._unit || 'días'];
                        setStagesData(sd => sd.map(x =>
                          x.id === s.id ? {...x, maxHours: e.target.value ? parseInt(e.target.value) * mult : null} : x
                        ));
                      }}
                      onBlur={e => {
                        const mult = UNIT_MULT[s._unit || 'días'];
                        const hours = e.target.value ? parseInt(e.target.value) * mult : null;
                        handleUpdateMaxHours(s, hours);
                      }}
                      className={cx('inp text-xs py-1 w-12 text-center transition-opacity', !s.maxHours && 'opacity-30 pointer-events-none')}
                    />
                    <select
                      disabled={!s.maxHours}
                      value={s._unit || 'días'}
                      onChange={e => setStagesData(sd => sd.map(x =>
                        x.id === s.id ? {...x, _unit: e.target.value} : x
                      ))}
                      className={cx('inp text-xs py-1 pl-2 pr-6 w-auto transition-opacity', !s.maxHours && 'opacity-30 pointer-events-none')}
                    >
                      <option value="horas">hs.</option>
                      <option value="días">días</option>
                      <option value="semanas">sem.</option>
                      <option value="meses">meses</option>
                    </select>
                  </div>
                  {/* Toggle alerta por mail — solo visible cuando hay tiempo máximo */}
                  <div className={cx('flex items-center gap-1.5 shrink-0 transition-opacity', !s.maxHours && 'opacity-30 pointer-events-none')}
                    title={s.maxHours ? (s.emailAlert ? 'Desactivar alerta por mail al vendedor' : 'Activar alerta por mail al vendedor cuando se supera el tiempo') : 'Configurá un tiempo máximo primero'}>
                    <Icon name="mail" size={12} className="text-ink-400"/>
                    <button
                      onClick={() => handleToggleEmailAlert(s)}
                      className={cx('w-7 h-3.5 rounded-full relative transition-colors shrink-0',
                        s.emailAlert && s.maxHours ? 'bg-brand' : 'bg-ink-300')}>
                      <div className={cx('absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all',
                        s.emailAlert && s.maxHours ? 'left-[14px]' : 'left-0.5')}/>
                    </button>
                  </div>
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
      </>)}
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
        { id:'stages',   label:'Etapas' },
        { id:'mail',     label:'Mail' },
        { id:'notifs',   label:'Notificaciones' },
        { id:'articles', label:'Artículos' },
        { id:'access',   label:'Acceso' },
        { id:'logs',     label:'Registros' },
      ]}/>

      {tab==='stages' && (
        <div className="p-6">
          <div className="grid grid-cols-2 gap-5">
            <StageList stages={f1} phase="COTIZACION"   title="Fase 1 · Cotizaciones"
              entryKeys={[
                { key: 'default_stage_solicitud',   label: 'Solicitud' },
                { key: 'default_stage_presupuesto', label: 'Presupuesto' },
              ]}
            />
            <StageList stages={f2} phase="ORDEN_COMPRA" title="Fase 2 · Órdenes de Compra"
              entryKeys={[
                { key: 'default_stage_nota_pedido', label: 'Nota de Pedido' },
              ]}
            />
          </div>

          {/* ── Seguimiento ─────────────────────────────────────────────────── */}
          <div className="mt-5 bg-white border border-line rounded-xl p-4 flex items-center gap-4">
            <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
              <Icon name="clock" size={15} className="text-orange-500"/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-ink-800">Alerta de seguimiento</div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">
                Días después de enviar un presupuesto hasta que aparece el banner naranja de seguimiento pendiente.
                Se limpia automáticamente cuando la cotización se acepta o rechaza.
              </div>
            </div>
            <select
              className="inp text-[13px] w-36 shrink-0"
              value={followUpDays}
              onChange={e => saveFollowUpDays(e.target.value)}
            >
              {[1,2,3,4,5,7,10,14,21,30].map(d => (
                <option key={d} value={String(d)}>{d} {d === 1 ? 'día' : 'días'}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {tab==='mail' && (
        <div className="p-6 space-y-5 max-w-3xl">

          {/* ── Sincronización ───────────────────────────────── */}
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-semibold">Sincronización</div>
              <button
                onClick={() => setMailSettings(s => ({ ...s, mail_sync_enabled: s.mail_sync_enabled === 'false' ? 'true' : 'false' }))}
                className="flex items-center gap-2 text-[12px] text-ink-600 select-none"
              >
                <span className={cx('text-[11px] font-medium', mailSettings.mail_sync_enabled === 'false' ? 'text-ink-400' : 'text-emerald-600')}>
                  {mailSettings.mail_sync_enabled === 'false' ? 'Desactivado' : 'Activado'}
                </span>
                <div className={cx('w-10 h-5 rounded-full relative transition-colors', mailSettings.mail_sync_enabled === 'false' ? 'bg-ink-300' : 'bg-emerald-500')}>
                  <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', mailSettings.mail_sync_enabled === 'false' ? 'left-0.5' : 'left-[22px]')}/>
                </div>
              </button>
            </div>
            <div className={cx('grid grid-cols-2 gap-4 transition-opacity', mailSettings.mail_sync_enabled === 'false' ? 'opacity-40 pointer-events-none' : '')}>
              <div>
                <label className="block text-[12px] text-ink-500 mb-1">Frecuencia automática</label>
                <select className="inp text-[13px] w-full" value={mailSettings.mail_sync_interval_hours}
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
                <select className="inp text-[13px] w-full" value={mailSettings.mail_lookback_days}
                  onChange={e => setMailSettings(s => ({ ...s, mail_lookback_days: e.target.value }))}>
                  <option value="1">1 día</option>
                  <option value="2">2 días</option>
                  <option value="7">7 días</option>
                  <option value="30">30 días</option>
                </select>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              <label className="block text-[12px] text-ink-500 mb-1">CC por defecto al enviar presupuesto</label>
              <input className="inp text-sm w-full" type="text"
                placeholder="ventas@myselec.com.ar, gerencia@myselec.com.ar"
                value={emailCCDefault}
                onChange={e => setEmailCCDefault(e.target.value)}/>
              <div className="text-[11px] text-ink-400 mt-1">Separar múltiples direcciones con comas.</div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <button onClick={async () => {
                try {
                  await Promise.all([
                    handleMailSettingSave(),
                    CrmApi.saveEmailTemplates({ ccDefault: emailCCDefault }),
                  ]);
                  pushToast('Configuración guardada');
                } catch { pushToast('Error al guardar', 'bad'); }
              }} className="btn-primary text-[12px]">
                Guardar
              </button>
              <button onClick={handleSyncAll} disabled={mailSyncingAll}
                className="btn-ghost text-[12px] flex items-center gap-1.5 disabled:opacity-60">
                <Icon name="refresh-cw" size={13} className={mailSyncingAll ? 'animate-spin' : ''}/>
                {mailSyncingAll ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
            </div>
          </div>

          {/* ── Cuentas de mail ───────────────────────────────── */}
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
              <div className="font-semibold text-[13px]">Cuentas configuradas</div>
              <button onClick={() => { setAddAccountOpen(o => !o); setAddAccountError(''); }}
                className="btn-ghost text-[12px] flex items-center gap-1.5">
                <Icon name="plus" size={13}/>Agregar cuenta
              </button>
            </div>

            {addAccountOpen && (
              <form onSubmit={handleAddAccount} className="px-5 py-4 border-b border-line bg-surface space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[12px] font-semibold text-ink-700">Nueva cuenta</div>
                  <div className="flex items-center gap-1 bg-line rounded-lg p-0.5">
                    <button type="button"
                      onClick={() => { setAddAccountMode('selector'); setAddAccountForm(f => ({...f, user: ''})); }}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${addAccountMode === 'selector' ? 'bg-white text-ink-800 shadow-sm font-medium' : 'text-ink-500 hover:text-ink-700'}`}>
                      Seleccionar vendedor
                    </button>
                    <button type="button"
                      onClick={() => { setAddAccountMode('manual'); setAddAccountForm(f => ({...f, user: ''})); }}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${addAccountMode === 'manual' ? 'bg-white text-ink-800 shadow-sm font-medium' : 'text-ink-500 hover:text-ink-700'}`}>
                      Manual
                    </button>
                  </div>
                </div>
                {addAccountError && <div className="text-red-600 text-[12px]">{addAccountError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-ink-500 mb-1 block">
                      {addAccountMode === 'selector' ? 'Vendedor' : 'Email (Gmail)'}
                    </label>
                    {addAccountMode === 'selector' ? (
                      <select className="inp w-full text-[13px]"
                        value={addAccountForm.user}
                        onChange={e => setAddAccountForm(f => ({...f, user: e.target.value}))}>
                        <option value="">— Seleccioná un vendedor —</option>
                        {(users || []).filter(u => u.email).map(u => (
                          <option key={u.id} value={u.email}>{u.name} — {u.email}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="inp w-full text-[13px]" type="email" placeholder="vendedor@gmail.com"
                        value={addAccountForm.user} onChange={e => setAddAccountForm(f => ({...f, user: e.target.value}))}/>
                    )}
                  </div>
                  <div>
                    <label className="text-[11px] text-ink-500 mb-1 block">Contraseña de aplicación</label>
                    <input className="inp w-full text-[13px]" type="password" placeholder="xxxx xxxx xxxx xxxx"
                      value={addAccountForm.password} onChange={e => setAddAccountForm(f => ({...f, password: e.target.value}))}/>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="submit" className="btn-primary text-[12px]" disabled={addAccountLoading}>
                    {addAccountLoading ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button type="button" className="btn-ghost text-[12px]"
                    onClick={() => { setAddAccountOpen(false); setAddAccountMode('selector'); setAddAccountForm({ user: '', password: '' }); }}>
                    Cancelar
                  </button>
                  <span className="text-[11px] text-ink-400 ml-1">
                    Usá una <a href="https://myaccount.google.com/apppasswords" target="_blank" className="text-brand underline">contraseña de aplicación</a> de Google.
                  </span>
                </div>
              </form>
            )}

            {mailLoading ? (
              <div className="py-10 text-center text-ink-400 text-[13px]">Cargando cuentas…</div>
            ) : mailAccounts.length === 0 ? (
              <div className="py-10 text-center text-ink-400 text-[13px]">
                No hay cuentas configuradas.<br/>
                <span className="text-[12px]">Hacé clic en "Agregar cuenta" para configurar la primera.</span>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {mailAccounts.map(acc => (
                  <div key={acc.user}>
                    <div className="px-5 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-mono font-medium text-ink-800">{acc.user}</div>
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          {acc.origin === 'db' ? 'Agregada manualmente' : 'Configurada en sistema'} ·{' '}
                          {acc.lastSyncAt
                            ? 'Último sync: ' + new Date(acc.lastSyncAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
                            : 'Sin sync'}
                        </div>
                      </div>
                      <Badge tone={acc.isActive ? 'green' : 'gray'} dot>{acc.isActive ? 'Activa' : 'Inactiva'}</Badge>
                      <button onClick={() => handleTestAccount(acc.user)} disabled={mailTesting[acc.user]}
                        className="btn-ghost text-[12px] flex items-center gap-1.5 disabled:opacity-60">
                        <Icon name="plug" size={12} className={mailTesting[acc.user] ? 'animate-pulse' : ''}/>
                        {mailTesting[acc.user] ? 'Probando…' : 'Test'}
                      </button>
                      <button onClick={() => handleSyncOne(acc.user)} disabled={mailSyncing[acc.user]}
                        className="btn-ghost text-[12px] flex items-center gap-1.5 disabled:opacity-60">
                        <Icon name="refresh-cw" size={12} className={mailSyncing[acc.user] ? 'animate-spin' : ''}/>
                        {mailSyncing[acc.user] ? 'Sync…' : 'Sincronizar'}
                      </button>
                      {acc.origin === 'db' && (
                        <button onClick={() => handleDeleteAccount(acc.user)} className="btn-ghost p-1.5" title="Eliminar">
                          <Icon name="trash-2" size={13} className="text-red-400"/>
                        </button>
                      )}
                    </div>
                    {/* Resultado del test de conexión */}
                    {mailTestResult[acc.user] && (
                      <div className={`mx-5 mb-3 rounded-lg px-3 py-2.5 text-[12px] ${mailTestResult[acc.user].ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                        {mailTestResult[acc.user].ok ? (
                          <>
                            <div className="font-semibold text-green-700 mb-1.5">✅ Conexión OK</div>
                            <div className="text-green-700 mb-1">Etiquetas/carpetas disponibles vía IMAP:</div>
                            <div className="flex flex-wrap gap-1">
                              {(mailTestResult[acc.user].labels || []).map(l => (
                                <span key={l} className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${l.toLowerCase() === 'crm' ? 'bg-green-200 text-green-800 font-bold' : 'bg-white border border-green-200 text-green-700'}`}>
                                  {l}
                                </span>
                              ))}
                            </div>
                            {!(mailTestResult[acc.user].labels || []).some(l => l.toLowerCase() === 'crm') && (
                              <div className="mt-2 text-amber-700 font-medium">⚠️ No se encontró la etiqueta "crm" — creala en Gmail y habilitala en IMAP</div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-red-700 mb-1">❌ Error de conexión</div>
                            <div className="text-red-600 font-mono">{mailTestResult[acc.user].error}</div>
                            {mailTestResult[acc.user].error?.includes('Invalid credentials') && (
                              <div className="mt-1.5 text-red-500">→ La contraseña de aplicación es incorrecta o IMAP no está habilitado en Gmail.</div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Plantillas de email ───────────────────────────── */}
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold">Plantillas de email</div>
                <button onClick={() => setShowVars(v => !v)}
                  className="text-[11px] text-brand hover:underline mt-0.5 flex items-center gap-1">
                  <Icon name={showVars ? 'chevron-up' : 'chevron-down'} size={11}/>
                  {showVars ? 'Ocultar variables' : 'Ver variables disponibles'}
                </button>
                {showVars && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {['{cliente}','{codigo}','{np_flexxus}','{vendedor}','{asunto_original}','{fecha}'].map(v => (
                      <code key={v} className="bg-surface border border-line px-1.5 py-0.5 rounded text-[11px] text-ink-700">{v}</code>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn-primary text-xs py-1.5 px-3 shrink-0 self-start"
                onClick={() => setEditingTpl({ id: `tpl-${Date.now()}`, name: '', subject: '', body: '', _isNew: true })}>
                <Icon name="plus" size={13}/>Nueva plantilla
              </button>
            </div>
            {emailTplLoading ? (
              <div className="py-6 text-center text-ink-400 text-sm">Cargando…</div>
            ) : (
              <div className="space-y-2">
                {emailTemplates.map(tpl => (
                  <div key={tpl.id} className="flex items-start gap-3 p-3 border border-line rounded-lg hover:bg-surface/50">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-ink-900">{tpl.name}</div>
                      <div className="text-[11.5px] text-ink-500 mt-0.5 truncate">Asunto: {tpl.subject}</div>
                      <div className="text-[11.5px] text-ink-400 mt-0.5 line-clamp-2 whitespace-pre-line">{tpl.body}</div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button className="btn-ghost text-xs py-1 px-2" onClick={() => setEditingTpl({ ...tpl })}>
                        <Icon name="pencil" size={12}/>Editar
                      </button>
                      <button className="btn-ghost text-xs py-1 px-2 text-bad border-red-200 hover:bg-red-50"
                        onClick={async () => {
                          if (!confirm(`¿Eliminar la plantilla "${tpl.name}"?`)) return;
                          const updated = emailTemplates.filter(t => t.id !== tpl.id);
                          setEmailTemplates(updated);
                          try { await CrmApi.saveEmailTemplates({ templates: updated }); pushToast('Plantilla eliminada'); }
                          catch (err) { pushToast(err.message || 'Error', 'bad'); }
                        }}>
                        <Icon name="trash-2" size={12}/>
                      </button>
                    </div>
                  </div>
                ))}
                {emailTemplates.length === 0 && (
                  <div className="py-6 text-center text-ink-400 text-sm">No hay plantillas. Creá una para empezar.</div>
                )}
              </div>
            )}
          </div>

          {/* ── Modal editar plantilla ───────────────────── */}
          {editingTpl && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]" onClick={() => setEditingTpl(null)}/>
              <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
                <div className="px-5 py-4 border-b border-line flex items-center justify-between">
                  <div className="text-[14px] font-bold text-ink-900">{editingTpl._isNew ? 'Nueva plantilla' : 'Editar plantilla'}</div>
                  <button onClick={() => setEditingTpl(null)} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500">
                    <Icon name="x" size={15}/>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Nombre</label>
                    <input className="inp w-full text-sm" placeholder="Ej: Presupuesto estándar"
                      value={editingTpl.name} onChange={e => setEditingTpl(t => ({ ...t, name: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Asunto</label>
                    <input className="inp w-full text-sm" placeholder="Presupuesto {codigo} - Myselec"
                      value={editingTpl.subject} onChange={e => setEditingTpl(t => ({ ...t, subject: e.target.value }))}/>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Cuerpo</label>
                    <textarea className="inp w-full text-sm resize-y" rows={8}
                      placeholder="Estimado/a {cliente},&#10;&#10;Adjunto el presupuesto {codigo}...&#10;&#10;Saludos,&#10;{vendedor}"
                      value={editingTpl.body} onChange={e => setEditingTpl(t => ({ ...t, body: e.target.value }))}/>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-line bg-surface flex justify-end gap-2">
                  <button className="btn-ghost" onClick={() => setEditingTpl(null)} disabled={tplSaving}>Cancelar</button>
                  <button className="btn-primary" disabled={tplSaving || !editingTpl.name || !editingTpl.subject || !editingTpl.body}
                    onClick={async () => {
                      setTplSaving(true);
                      try {
                        const { _isNew, ...tplData } = editingTpl;
                        const updated = _isNew ? [...emailTemplates, tplData] : emailTemplates.map(t => t.id === tplData.id ? tplData : t);
                        await CrmApi.saveEmailTemplates({ templates: updated });
                        setEmailTemplates(updated);
                        setEditingTpl(null);
                        pushToast(_isNew ? 'Plantilla creada' : 'Plantilla guardada');
                      } catch (err) { pushToast(err.message || 'Error', 'bad'); }
                      finally { setTplSaving(false); }
                    }}>
                    {tplSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab==='notifs' && (
        <div className="p-6 space-y-5">

          {/* ── Notificaciones del sistema ──────────────────────────────────────── */}
          {(() => {
            const toggleSys = async (key, current, setter) => {
              const next = current === 'true' ? 'false' : 'true';
              setter(prev => ({ ...prev, [key]: next }));
              try {
                await fetch('/api/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                  body: JSON.stringify({ [key]: next }),
                });
                pushToast(next === 'true' ? 'Notificación activada' : 'Notificación desactivada', next === 'true' ? 'ok' : 'warn');
              } catch { setter(prev => ({ ...prev, [key]: current })); pushToast('Error al guardar', 'bad'); }
            };
            const Toggle = ({ value, onClick }) => (
              <button onClick={onClick}
                className={cx('w-10 h-5 rounded-full relative transition-colors shrink-0', value === 'true' ? 'bg-brand' : 'bg-ink-300')}>
                <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', value === 'true' ? 'left-[22px]' : 'left-0.5')}/>
              </button>
            );
            const mailRows = [
              { key: 'notify_new_register',    icon: 'user-plus',    color: 'blue',   label: 'Nuevo registro pendiente',  desc: 'Mail a administradores cuando alguien solicita acceso al CRM.', role: 'Admin' },
              { key: 'notify_unassigned_mail', icon: 'mail-question', color: 'orange', label: 'Mail sin cliente asignado', desc: 'Mails que llegaron al CRM sin matchear ningún cliente.', role: 'Configurable', extra: 'unassignedFreq' },
              { key: 'notify_stage_alert',     icon: 'clock-alert',  color: 'red',    label: 'Tiempo de etapa excedido',  desc: 'Digest por vendedor cuando sus cotizaciones superan el tiempo máximo de etapa.', role: 'Vendedor', extra: 'stageCooldown' },
              { key: 'weekly_report_enabled',  icon: 'bar-chart-2',  color: 'purple', label: 'Resumen semanal por mail',  desc: 'Resumen con KPIs y ranking de vendedores. Se envía todos los lunes a las 9:00 hs a los administradores.', role: 'Admin', isWeekly: true },
            ];
            const inappRows = [
              { key: 'inapp_unassigned_quotes',    icon: 'user-x',         color: 'red',    label: 'Solicitudes sin asignar',          desc: 'Cotizaciones recibidas sin vendedor asignado.', role: 'Admin' },
              { key: 'inapp_pending_users',        icon: 'user-check',     color: 'purple', label: 'Usuarios pendientes de aprobación', desc: 'Usuarios registrados esperando que un admin les dé acceso.', role: 'Admin' },
              { key: 'inapp_unlinked_solicitudes', icon: 'file-question',  color: 'orange', label: 'Solicitudes sin presupuesto',       desc: 'Solicitudes sin presupuesto vinculado después de X días. Alerta accionable para no dejar caer leads.', role: 'Todos', extra: 'solSinPres' },
              { key: 'inapp_overdue_stages',       icon: 'clock-alert',    color: 'red',    label: 'Tiempo de etapa excedido',         desc: 'Ítems cuyo tiempo en la etapa actual superó el máximo. Muestra desglose por etapa. Descartable.', role: 'Todos' },
              { key: 'inapp_idle_quotes',          icon: 'clock',          color: 'gray',   label: 'Cotizaciones sin actividad',       desc: 'Cotizaciones sin movimiento en más de X días. Descartable por N días.', role: 'Todos', extra: 'idleInbox' },
              { key: 'inapp_follow_up',            icon: 'calendar-clock', color: 'blue',   label: 'Seguimientos vencidos',            desc: 'Cotizaciones con fecha de seguimiento ya vencida.', role: 'Vendedor' },
              { key: 'inapp_follow_up_upcoming',   icon: 'calendar',       color: 'blue',   label: 'Seguimientos próximos',            desc: 'Aviso anticipado antes de que venza un seguimiento. Permite prepararse antes de que sea urgente.', role: 'Vendedor', extra: 'followUpUpcoming' },
              { key: 'inapp_no_response',          icon: 'mail-question',  color: 'orange', label: 'Presupuestos sin respuesta',        desc: 'Presupuestos enviados sin respuesta del cliente después de X días. Incluye botón para enviar recordatorio.', role: 'Vendedor', extra: 'noResponse' },
            ];
            const iconColor = { blue:'text-blue-500 bg-blue-50', orange:'text-orange-500 bg-orange-50', red:'text-red-500 bg-red-50', purple:'text-purple-500 bg-purple-50', gray:'text-ink-400 bg-surface' };
            const RoleBadge = ({ r }) => {
              const c = r === 'Admin' ? 'bg-purple-50 text-purple-700' : r === 'Vendedor' ? 'bg-blue-50 text-blue-700' : r === 'Todos' ? 'bg-green-50 text-green-700' : 'bg-surface text-ink-500';
              return <span className={cx('px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0', c)}>{r}</span>;
            };
            return (
              <div className="bg-white border border-line rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-line">
                  <div className="font-semibold text-[13px]">Notificaciones del sistema</div>
                  <div className="text-[11.5px] text-ink-400 mt-0.5">
                    Activá o desactivá cada tipo de notificación a nivel global. Cada usuario puede además personalizar las suyas desde su perfil.
                  </div>
                </div>
                {/* Por mail */}
                <div className="px-5 pt-4 pb-1">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon name="mail" size={13} className="text-ink-400"/>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Por mail</span>
                  </div>
                  <div className="divide-y divide-line border border-line rounded-lg overflow-hidden">
                    {mailRows.map(row => (
                      <div key={row.key} className="flex items-center gap-3 px-4 py-3">
                        <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconColor[row.color] || iconColor.gray)}>
                          <Icon name={row.icon} size={14}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-ink-800">{row.label}</span>
                            <RoleBadge r={row.role}/>
                          </div>
                          <div className="text-[11.5px] text-ink-400 mt-0.5 leading-relaxed">{row.desc}</div>
                          {row.extra === 'unassignedFreq' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Frecuencia:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-36"
                                value={unassignedMailFreq}
                                onChange={e => saveAutoAlertSetting('unassigned_mail_frequency', e.target.value, setUnassignedMailFreq)}
                              >
                                <option value="immediate">Por mail (inmediato)</option>
                                <option value="daily">Resumen diario</option>
                                <option value="2days">Cada 2 días</option>
                                <option value="weekly">Semanal</option>
                              </select>
                            </div>
                          )}
                          {row.extra === 'stageCooldown' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Cooldown entre alertas:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-24"
                                value={stageCooldownDays}
                                onChange={e => saveAutoAlertSetting('stage_alert_cooldown_days', e.target.value, setStageCooldownDays)}
                              >
                                {[1,2,3,5,7].map(d => <option key={d} value={String(d)}>{d} día{d > 1 ? 's' : ''}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                        {row.isWeekly
                          ? <Toggle value={weeklyReportEnabled} onClick={() => {
                              const next = weeklyReportEnabled === 'true' ? 'false' : 'true';
                              setWeeklyReportEnabled(next);
                              saveAutoAlertSetting('weekly_report_enabled', next, () => {});
                              saveAutoAlertSetting('weekly_report_day',  '1', setWeeklyReportDay);
                              saveAutoAlertSetting('weekly_report_hour', '9', setWeeklyReportHour);
                            }}/>
                          : <Toggle value={sysNotifMail[row.key]} onClick={() => toggleSys(row.key, sysNotifMail[row.key], setSysNotifMail)}/>
                        }
                      </div>
                    ))}
                  </div>
                </div>
                {/* In-app */}
                <div className="px-5 pt-4 pb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon name="bell" size={13} className="text-ink-400"/>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">In-app (campanita)</span>
                  </div>
                  <div className="divide-y divide-line border border-line rounded-lg overflow-hidden">
                    {inappRows.map(row => (
                      <div key={row.key} className="flex items-center gap-3 px-4 py-3">
                        <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconColor[row.color] || iconColor.gray)}>
                          <Icon name={row.icon} size={14}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-ink-800">{row.label}</span>
                            <RoleBadge r={row.role}/>
                          </div>
                          <div className="text-[11.5px] text-ink-400 mt-0.5">{row.desc}</div>
                          {row.extra === 'idleInbox' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Días sin actividad:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-24"
                                value={idleInboxDays}
                                onChange={e => saveAutoAlertSetting('idle_inbox_days', e.target.value, setIdleInboxDays)}
                              >
                                {[2,3,4,5,7,10,14,21].map(d => <option key={d} value={String(d)}>{d} días</option>)}
                              </select>
                            </div>
                          )}
                          {row.extra === 'solSinPres' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Alertar después de:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-24"
                                value={solSinPresDays}
                                onChange={e => saveAutoAlertSetting('solicitud_sin_pres_days', e.target.value, setSolSinPresDays)}
                              >
                                {[1,2,3,5,7].map(d => <option key={d} value={String(d)}>{d} día{d > 1 ? 's' : ''}</option>)}
                              </select>
                            </div>
                          )}
                          {row.extra === 'followUpUpcoming' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Anticipación:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-28"
                                value={followUpUpcomingDays}
                                onChange={e => saveAutoAlertSetting('follow_up_upcoming_days', e.target.value, setFollowUpUpcomingDays)}
                              >
                                <option value="0">Solo hoy</option>
                                <option value="1">24 horas antes</option>
                                <option value="2">2 días antes</option>
                                <option value="3">3 días antes</option>
                              </select>
                            </div>
                          )}
                          {row.extra === 'noResponse' && (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11.5px] text-ink-400">Alertar después de:</span>
                              <select
                                className="inp text-[12px] py-0.5 w-24"
                                value={noResponseDays}
                                onChange={e => saveAutoAlertSetting('no_response_days', e.target.value, setNoResponseDays)}
                              >
                                {[2,3,4,5,7,10,14].map(d => <option key={d} value={String(d)}>{d} días</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                        <Toggle value={sysNotifInapp[row.key]} onClick={() => toggleSys(row.key, sysNotifInapp[row.key], setSysNotifInapp)}/>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}


        </div>
      )}

      {tab==='articles' && <Articles/>}

      {tab==='access' && (
        <div className="p-6 max-w-2xl space-y-5">
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="shield" size={15} className="text-brand"/>
              <span className="text-sm font-semibold">Dominios de email permitidos</span>
            </div>
            <p className="text-[12px] text-ink-500 mb-4">
              Solo se puede registrar o recuperar contraseña con emails de estos dominios.
              Separalos por coma, sin espacios. Ejemplo: <code className="bg-surface px-1 rounded">myselec.com,myselec.com.ar,gmail.com</code>
            </p>
            <label className="block text-[12px] font-medium text-ink-700 mb-1.5">Dominios permitidos</label>
            <input
              className="inp w-full font-mono text-[13px] mb-4"
              value={allowedEmailDomains}
              onChange={e => setAllowedEmailDomains(e.target.value)}
              placeholder="myselec.com,myselec.com.ar,gmail.com"
            />
            {/* Preview de los dominios parseados */}
            <div className="flex flex-wrap gap-2 mb-4">
              {allowedEmailDomains.split(',').map(d => d.trim()).filter(Boolean).map(d => (
                <span key={d} className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[12px] text-blue-700 font-medium">@{d}</span>
              ))}
            </div>
            <button
              className="btn-primary"
              disabled={savingDomains}
              onClick={async () => {
                setSavingDomains(true);
                try {
                  await fetch('/api/settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                    body: JSON.stringify({ allowed_email_domains: allowedEmailDomains }),
                  });
                  pushToast('Dominios guardados', 'success');
                } catch {
                  pushToast('Error al guardar', 'error');
                } finally {
                  setSavingDomains(false);
                }
              }}
            >
              {savingDomains ? 'Guardando...' : 'Guardar dominios'}
            </button>
          </div>

          {/* ── Correos individuales permitidos ──────────────────────────── */}
          <div className="bg-white border border-line rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="mail" size={15} className="text-brand"/>
              <span className="text-sm font-semibold">Correos individuales autorizados</span>
            </div>
            <p className="text-[12px] text-ink-500 mb-4">
              Correos específicos que pueden registrarse y recuperar contraseña <strong>aunque su dominio no esté en la lista de arriba</strong>.
              Útil para admins o devs con emails personales (ej: Gmail). Separalos por coma.
            </p>
            <label className="block text-[12px] font-medium text-ink-700 mb-1.5">Correos autorizados</label>
            <input
              className="inp w-full font-mono text-[13px] mb-4"
              value={allowedEmails}
              onChange={e => setAllowedEmails(e.target.value)}
              placeholder="dev@gmail.com,admin@hotmail.com"
            />
            {/* Preview de los correos parseados */}
            {allowedEmails.split(',').map(e => e.trim()).filter(Boolean).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {allowedEmails.split(',').map(e => e.trim()).filter(Boolean).map(e => (
                  <span key={e} className="px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-[12px] text-green-700 font-medium">{e}</span>
                ))}
              </div>
            )}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 mb-4">
              ⚠️ <strong>Importante:</strong> agregar un correo acá <strong>no crea la cuenta</strong> — solo le permite registrarse.
              El login de usuarios existentes nunca se bloquea por dominio o correo.
            </div>
            <button
              className="btn-primary"
              disabled={savingEmails}
              onClick={async () => {
                setSavingEmails(true);
                try {
                  await fetch('/api/settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                    body: JSON.stringify({ allowed_emails: allowedEmails }),
                  });
                  pushToast('Correos guardados', 'success');
                } catch {
                  pushToast('Error al guardar', 'error');
                } finally {
                  setSavingEmails(false);
                }
              }}
            >
              {savingEmails ? 'Guardando...' : 'Guardar correos'}
            </button>
          </div>
        </div>
      )}

      {tab==='logs' && <LoginLogs/>}

    </div>
  );
}

// ---------- LoginLogs — registros de ingreso ----------
function LoginLogs() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState({ email: '', result: '', from: '', to: '' });
  const [applied, setApplied] = useState({ email: '', result: '', from: '', to: '' });

  const load = async (p = 1, f = applied) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (f.email)  params.set('email',  f.email);
      if (f.result) params.set('result', f.result);
      if (f.from)   params.set('from',   f.from);
      if (f.to)     params.set('to',     f.to);
      const res = await fetch(`/api/logs/logins?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      setData(await res.json());
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setApplied(filters);
    setPage(1);
    load(1, filters);
  };

  const handleExport = async () => {
    try {
      const res = await fetch('/api/logs/logins/export', {
        headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `logins-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (_) {}
  };

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="bg-white border border-line rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-[13px]">Registros de ingreso</div>
            <div className="text-[11.5px] text-ink-400 mt-0.5">Historial de accesos al CRM (últimos 90 días)</div>
          </div>
          {data?.showExportAlert && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                <Icon name="alert-circle" size={12}/>
                {data.totalAll} registros — exportá para liberar espacio
              </div>
              <button onClick={handleExport} className="btn-primary text-[12px] py-1.5">
                <Icon name="download" size={13}/>Exportar CSV
              </button>
            </div>
          )}
          {!data?.showExportAlert && data && (
            <button onClick={handleExport} className="btn-ghost text-[12px]">
              <Icon name="download" size={13}/>Exportar CSV
            </button>
          )}
        </div>

        {/* Filtros */}
        <form onSubmit={handleSearch} className="px-5 py-3 border-b border-line flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-[10px] font-medium text-ink-500 mb-1">Email</label>
            <input className="inp text-[12px] w-44" placeholder="Buscar email..."
              value={filters.email} onChange={e => setFilters(f => ({...f, email: e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-ink-500 mb-1">Resultado</label>
            <select className="inp text-[12px] w-32"
              value={filters.result} onChange={e => setFilters(f => ({...f, result: e.target.value}))}>
              <option value="">Todos</option>
              <option value="ok">Exitosos</option>
              <option value="failed">Fallidos</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-ink-500 mb-1">Desde</label>
            <input type="date" className="inp text-[12px] w-36"
              value={filters.from} onChange={e => setFilters(f => ({...f, from: e.target.value}))}/>
          </div>
          <div>
            <label className="block text-[10px] font-medium text-ink-500 mb-1">Hasta</label>
            <input type="date" className="inp text-[12px] w-36"
              value={filters.to} onChange={e => setFilters(f => ({...f, to: e.target.value}))}/>
          </div>
          <button type="submit" className="btn-ghost text-[12px]"><Icon name="search" size={13}/>Filtrar</button>
        </form>

        {/* Tabla */}
        {loading ? (
          <div className="py-12 text-center text-ink-400 text-sm">Cargando...</div>
        ) : !data?.logs?.length ? (
          <div className="py-12 text-center text-ink-400 text-sm">Sin registros para los filtros aplicados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-surface border-b border-line text-left text-[11px] font-semibold text-ink-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5">Fecha y hora</th>
                  <th className="px-4 py-2.5">Usuario</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Resultado</th>
                  <th className="px-4 py-2.5">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.logs.map(l => (
                  <tr key={l.id} className="hover:bg-surface/50">
                    <td className="px-4 py-2.5 font-mono text-ink-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-ink-800">{l.user?.name || <span className="text-ink-300 italic">desconocido</span>}</td>
                    <td className="px-4 py-2.5 text-ink-600">{l.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={cx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                        l.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                        {l.success ? '✅ Exitoso' : '❌ Fallido'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-ink-400 text-[11px]">{l.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {data?.pages > 1 && (
          <div className="px-5 py-3 border-t border-line flex items-center justify-between text-[12px]">
            <span className="text-ink-400">{data.total} resultado{data.total !== 1 ? 's' : ''}</span>
            <div className="flex gap-1">
              <button onClick={() => { setPage(p => p-1); load(page-1); }} disabled={page <= 1}
                className="btn-ghost py-1 px-2 disabled:opacity-30">← Anterior</button>
              <span className="px-3 py-1 text-ink-500">{page} / {data.pages}</span>
              <button onClick={() => { setPage(p => p+1); load(page+1); }} disabled={page >= data.pages}
                className="btn-ghost py-1 px-2 disabled:opacity-30">Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- ArticleFormModal — crear o editar artículo ----------
function ArticleFormModal({ article = null, meta, onClose, onSaved }) {
  const editing = !!article;
  const [form, setForm] = useState({
    code:        article?.code        ?? '',
    description: article?.description ?? '',
    category:    article?.category    ?? '',
    type:        article?.type        ?? '',
    class:       article?.class       ?? '',
    coefVar:     article?.coefVar     ?? '',
    active:      article?.active      ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (editing) {
        const saved = await CrmApi.updateArticle(article.code, {
          description: form.description,
          category:    form.category  || null,
          type:        form.type      || null,
          class:       form.class     || null,
          coefVar:     form.coefVar   !== '' ? parseFloat(form.coefVar) : null,
          active:      form.active,
        });
        onSaved(saved);
      } else {
        const saved = await CrmApi.createArticle({
          code:        form.code,
          description: form.description,
          category:    form.category  || null,
          type:        form.type      || null,
          class:       form.class     || null,
          coefVar:     form.coefVar   !== '' ? parseFloat(form.coefVar) : null,
          active:      form.active,
        });
        onSaved(saved);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Input con datalist para campos con opciones existentes + texto libre
  const DatalistInput = ({ id, value, onChange, list, placeholder }) => (
    <div className="relative">
      <input
        id={id} list={`dl-${id}`}
        className="inp w-full text-sm"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <datalist id={`dl-${id}`}>
        {list.map(o => <option key={o} value={o}/>)}
      </datalist>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose}/>
      <form onSubmit={handleSubmit}
        className="relative bg-white rounded-2xl shadow-pop w-full max-w-lg flex flex-col modal-enter">

        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
              {editing ? 'Editar artículo' : 'Nuevo artículo'}
            </div>
            <h3 className="text-base font-bold text-ink-900">
              {editing ? article.code : 'Agregar al catálogo'}
            </h3>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500">
            <Icon name="x" size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto">

          {/* Código — solo en creación */}
          {!editing && (
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
                Código <span className="text-red-500">*</span>
              </label>
              <input
                className="inp w-full text-sm font-mono"
                placeholder="Ej: EK4118-000"
                value={form.code}
                onChange={e => set('code', e.target.value.toUpperCase())}
                required
              />
              <div className="text-[11px] text-ink-400 mt-1">Debe ser único. Se convertirá a mayúsculas.</div>
            </div>
          )}

          {/* Descripción */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
              Descripción <span className="text-red-500">*</span>
            </label>
            <input
              className="inp w-full text-sm"
              placeholder="Nombre completo del artículo"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              required
            />
          </div>

          {/* Rubro — datalist con opciones existentes + libre */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
              Rubro
            </label>
            <DatalistInput
              id="category"
              value={form.category}
              onChange={v => set('category', v)}
              list={meta.categories}
              placeholder="Ej: TERMOCONTRAIBLES Y CAPUCHONES"
            />
            <div className="text-[11px] text-ink-400 mt-1">
              Seleccioná uno existente o escribí uno nuevo — aparecerá en los filtros.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">Tipo</label>
              <DatalistInput
                id="type"
                value={form.type}
                onChange={v => set('type', v)}
                list={meta.types}
                placeholder="Ej: PARTE"
              />
            </div>

            {/* Clase */}
            <div>
              <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">Clase</label>
              <select className="inp w-full text-sm" value={form.class} onChange={e => set('class', e.target.value)}>
                <option value="">Sin clase</option>
                {(meta.classes.length ? meta.classes : ['A','B','C']).map(c =>
                  <option key={c} value={c}>Clase {c}</option>
                )}
              </select>
            </div>
          </div>

          {/* Coef. Var. */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">
              Coeficiente de variación
            </label>
            <input
              type="number" step="0.01"
              className="inp w-full text-sm"
              placeholder="Ej: 1"
              value={form.coefVar}
              onChange={e => set('coefVar', e.target.value)}
            />
          </div>

          {/* Activo */}
          <div className="flex items-center gap-3 p-3 bg-surface rounded-xl border border-line">
            <div className="flex-1">
              <div className="text-[13px] font-medium text-ink-800">Artículo activo</div>
              <div className="text-[11px] text-ink-500 mt-0.5">Los artículos inactivos no aparecen en búsquedas ni autocomplete</div>
            </div>
            <button
              type="button"
              onClick={() => set('active', !form.active)}
              className={cx(
                'w-10 h-6 rounded-full transition-colors relative shrink-0',
                form.active ? 'bg-brand' : 'bg-ink-300'
              )}
            >
              <span className={cx(
                'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all',
                form.active ? 'left-5' : 'left-1'
              )}/>
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-3 bg-surface rounded-b-2xl">
          <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
          <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
            {loading ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar artículo'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- ArticleImportModal ----------
function ArticleImportModal({ onClose, onDone }) {
  const STEP = { UPLOAD: 'upload', PREVIEW: 'preview', SYNCING: 'syncing', DONE: 'done' };
  const [step, setStep]           = useState(STEP.UPLOAD);
  const [dragging, setDragging]   = useState(false);
  const [file, setFile]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [preview, setPreview]     = useState(null);   // respuesta del /preview
  const [deleteSel, setDeleteSel] = useState({});     // { [code]: bool }
  const [result, setResult]       = useState(null);   // respuesta del /sync

  const pickFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['xls','xlsx'].includes(ext)) { setError('Solo se aceptan archivos .xls o .xlsx'); return; }
    setFile(f); setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  const doPreview = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const data = await CrmApi.previewArticleXLS(file);
      setPreview(data);
      // Por defecto seleccionar todos los que se van a eliminar
      const sel = {};
      data.toRemove.forEach(a => { sel[a.code] = true; });
      setDeleteSel(sel);
      setStep(STEP.PREVIEW);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doSync = async () => {
    setStep(STEP.SYNCING);
    try {
      const deleteCodes = Object.entries(deleteSel).filter(([,v])=>v).map(([k])=>k);
      const res = await CrmApi.syncArticles(preview.token, deleteCodes);
      setResult(res);
      setStep(STEP.DONE);
    } catch (e) {
      setError(e.message);
      setStep(STEP.PREVIEW);
    }
  };

  const toggleAll = (val) => {
    const sel = {};
    preview.toRemove.forEach(a => { sel[a.code] = val; });
    setDeleteSel(sel);
  };

  const selectedDeleteCount = Object.values(deleteSel).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={step !== STEP.SYNCING ? onClose : undefined}/>
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-2xl max-h-[90vh] flex flex-col modal-enter">

        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Catálogo · Flexxus</div>
            <h3 className="text-base font-bold text-ink-900">Actualizar catálogo de artículos</h3>
          </div>
          {step !== STEP.SYNCING && (
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500">
              <Icon name="x" size={16}/>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-6">

          {/* ── Paso 1: Upload ── */}
          {step === STEP.UPLOAD && (
            <div className="space-y-4">
              <p className="text-[13px] text-ink-600">
                Subí el archivo XLS exportado desde Flexxus. El sistema va a comparar con el catálogo actual y mostrarte qué cambia antes de aplicar nada.
              </p>

              {/* Drop zone */}
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={handleDrop}
                className={cx(
                  'border-2 border-dashed rounded-xl p-10 flex flex-col items-center gap-3 transition-colors cursor-pointer',
                  dragging ? 'border-brand bg-brand/5' : 'border-line hover:border-ink-300 hover:bg-surface'
                )}
                onClick={()=>document.getElementById('xls-input').click()}
              >
                <div className="w-12 h-12 rounded-xl bg-surface border border-line flex items-center justify-center">
                  <Icon name="upload-cloud" size={22} className="text-ink-400"/>
                </div>
                {file ? (
                  <div className="text-center">
                    <div className="font-semibold text-ink-900 text-[14px]">{file.name}</div>
                    <div className="text-[12px] text-ink-500 mt-0.5">{(file.size/1024).toFixed(0)} KB · listo para procesar</div>
                  </div>
                ) : (
                  <div className="text-center">
                    <div className="font-medium text-ink-700 text-[13px]">Arrastrá el archivo acá o hacé click para seleccionarlo</div>
                    <div className="text-[12px] text-ink-400 mt-0.5">Formato: .xls o .xlsx (exportado desde Flexxus)</div>
                  </div>
                )}
                <input id="xls-input" type="file" accept=".xls,.xlsx" className="hidden"
                  onChange={e=>pickFile(e.target.files[0])}/>
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}
            </div>
          )}

          {/* ── Paso 2: Preview ── */}
          {step === STEP.PREVIEW && preview && (
            <div className="space-y-5">
              {/* Resumen */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Nuevos',      value: preview.summary.toAdd,     color: 'bg-green-50 border-green-200 text-green-700' },
                  { label: 'Actualizados',value: preview.summary.toUpdate,  color: 'bg-blue-50 border-blue-200 text-blue-700' },
                  { label: 'Sin cambios', value: preview.summary.unchanged, color: 'bg-surface border-line text-ink-500' },
                  { label: 'A eliminar',  value: preview.summary.toRemove,  color: preview.summary.toRemove > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-surface border-line text-ink-500' },
                ].map(s => (
                  <div key={s.label} className={cx('border rounded-xl p-4 text-center', s.color)}>
                    <div className="text-2xl font-bold">{s.value.toLocaleString()}</div>
                    <div className="text-[11px] font-medium mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Nuevos (preview) */}
              {preview.toAdd.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-ink-700 mb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>
                    Artículos nuevos {preview.summary.toAdd > 20 && <span className="font-normal text-ink-400">(mostrando primeros 20 de {preview.summary.toAdd})</span>}
                  </div>
                  <div className="border border-line rounded-xl overflow-hidden max-h-40 overflow-y-auto scroll-thin">
                    {preview.toAdd.map(a => (
                      <div key={a.code} className="px-3 py-2 border-b border-line last:border-0 flex gap-3 text-[12px]">
                        <span className="mono font-semibold text-blue-600 w-32 shrink-0">{a.code}</span>
                        <span className="text-ink-700 truncate flex-1">{a.description}</span>
                        <span className="text-ink-400 shrink-0">{a.category || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* A eliminar — con checkboxes */}
              {preview.toRemove.length > 0 && (
                <div>
                  <div className="text-[12px] font-semibold text-red-700 mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>
                      Artículos que ya no están en el XLS — elegí cuáles eliminar
                    </span>
                    <div className="flex gap-2">
                      <button onClick={()=>toggleAll(true)}  className="text-[11px] text-brand hover:underline">Todos</button>
                      <span className="text-ink-300">·</span>
                      <button onClick={()=>toggleAll(false)} className="text-[11px] text-ink-500 hover:underline">Ninguno</button>
                    </div>
                  </div>
                  <div className="border border-red-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto scroll-thin">
                    {preview.toRemove.map(a => (
                      <label key={a.code} className="px-3 py-2 border-b border-red-100 last:border-0 flex gap-3 text-[12px] cursor-pointer hover:bg-red-50 items-center">
                        <input type="checkbox" className="accent-red-500 shrink-0"
                          checked={!!deleteSel[a.code]}
                          onChange={e => setDeleteSel(s => ({...s, [a.code]: e.target.checked}))}/>
                        <span className="mono font-semibold text-red-600 w-32 shrink-0">{a.code}</span>
                        <span className="text-ink-700 truncate flex-1">{a.description}</span>
                        <span className="text-ink-400 shrink-0">{a.category || ''}</span>
                      </label>
                    ))}
                  </div>
                  {selectedDeleteCount > 0 && (
                    <div className="mt-2 text-[12px] text-red-600 font-medium">
                      ⚠ Se van a eliminar {selectedDeleteCount} artículo{selectedDeleteCount !== 1 ? 's' : ''} de forma permanente.
                    </div>
                  )}
                </div>
              )}

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>}
            </div>
          )}

          {/* ── Paso 3: Sincronizando ── */}
          {step === STEP.SYNCING && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-4 border-brand border-t-transparent animate-spin"/>
              <div className="text-[14px] text-ink-600 font-medium">Actualizando catálogo…</div>
              <div className="text-[12px] text-ink-400">Esto puede tardar unos segundos</div>
            </div>
          )}

          {/* ── Paso 4: Resultado ── */}
          {step === STEP.DONE && result && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <Icon name="check" size={20} className="text-green-600"/>
                </div>
                <div>
                  <div className="font-semibold text-green-800 text-[14px]">Catálogo actualizado correctamente</div>
                  <div className="text-[13px] text-green-700 mt-0.5">
                    {result.upserted.toLocaleString()} artículos procesados
                    {result.deleted > 0 && ` · ${result.deleted} eliminado${result.deleted !== 1 ? 's' : ''}`}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface border border-line rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-ink-900">{result.upserted.toLocaleString()}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Artículos sincronizados</div>
                </div>
                <div className="bg-surface border border-line rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-red-600">{result.deleted}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">Artículos eliminados</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-3 bg-surface rounded-b-2xl">
          {step === STEP.UPLOAD && (
            <>
              <button onClick={onClose} className="btn-ghost">Cancelar</button>
              <button onClick={doPreview} disabled={!file || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? 'Procesando…' : 'Analizar archivo'}
              </button>
            </>
          )}
          {step === STEP.PREVIEW && (
            <>
              <button onClick={()=>{setStep(STEP.UPLOAD);setPreview(null);}} className="btn-ghost">← Volver</button>
              <button onClick={doSync} className="btn-primary">
                Confirmar importación
                {selectedDeleteCount > 0 && ` (${selectedDeleteCount} eliminaciones)`}
              </button>
            </>
          )}
          {step === STEP.DONE && (
            <button onClick={() => { onDone(); onClose(); }} className="btn-primary">
              Cerrar y actualizar lista
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Articles ----------
function Articles() {
  const [search, setSearch]           = useState('');
  const [filterCat, setFilterCat]     = useState('');
  const [filterType, setFilterType]   = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [meta, setMeta]               = useState({ categories: [], types: [], classes: [] });
  const [items, setItems]             = useState([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [offset, setOffset]           = useState(0);
  const [limit, setLimit]             = useState(100);
  const [sortBy, setSortBy]           = useState('code');
  const [sortDir, setSortDir]         = useState('asc');
  const [showImport, setShowImport]     = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [articleModal, setArticleModal] = useState(null); // null | { mode:'new' } | { mode:'edit', article }
  const [reloadKey, setReloadKey]       = useState(0);
  const isAdmin = CrmAuth.getUser()?.role === 'ADMIN';

  const reload = () => setReloadKey(k => k + 1);

  const handleDelete = async (a) => {
    if (!window.confirm(`¿Eliminár el artículo ${a.code}?\n"${a.description}"\n\nEsta acción no se puede deshacer.`)) return;
    try {
      await CrmApi.deleteArticle(a.code);
      reload();
    } catch (err) {
      alert(err.message || 'Error al eliminar');
    }
  };

  const handleSaved = (saved) => {
    // Si el rubro es nuevo, refrescar el meta también
    if (saved.category && !meta.categories.includes(saved.category)) {
      CrmApi.getArticleMeta().then(setMeta).catch(() => {});
    }
    reload();
  };

  // Cargar meta (rubros, tipos, clases) una vez
  useEffect(() => {
    CrmApi.getArticleMeta().then(setMeta).catch(() => {});
  }, []);

  // Cargar artículos cuando cambian filtros / orden / página
  useEffect(() => {
    setLoading(true);
    const params = { limit, offset, sortBy, sortDir };
    if (search)       params.q        = search;
    if (filterCat)    params.category = filterCat;
    if (filterType)   params.type     = filterType;
    if (filterClass)  params.class    = filterClass;
    if (!showInactive) params.active  = 'true';
    CrmApi.getArticles(params)
      .then(r => { setItems(r.items); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, filterCat, filterType, filterClass, showInactive, offset, limit, sortBy, sortDir, reloadKey]);

  // Reset página al cambiar filtros o limit
  useEffect(() => { setOffset(0); }, [search, filterCat, filterType, filterClass, showInactive, limit]);

  const hasFilters = !!(search || filterCat || filterType || filterClass || showInactive);
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <span className="text-ink-300 ml-1">↕</span>;
    return <span className="text-brand ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const CLASS_TONE = { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700', C: 'bg-ink-100 text-ink-600' };

  return (
    <div className="flex flex-col h-screen">
      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-line bg-white shrink-0">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <div className="text-[13px] uppercase tracking-wider font-semibold text-ink-500">Catálogo · Flexxus</div>
            <h2 className="text-xl font-bold text-ink-900 mt-0.5">Artículos</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[13px] text-ink-500">
              {loading ? 'Cargando…' : (
                hasFilters
                  ? <><span className="font-semibold text-ink-900">{total.toLocaleString()}</span> resultados</>
                  : <><span className="font-semibold text-ink-900">{total.toLocaleString()}</span> artículos en catálogo</>
              )}
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <button onClick={() => setShowDeleteAll(true)} className="btn-ghost text-xs flex items-center gap-1.5 text-red-500 hover:bg-red-50 hover:border-red-200">
                  <Icon name="trash-2" size={13}/> Eliminar todos
                </button>
                <button onClick={() => setShowImport(true)} className="btn-ghost text-xs flex items-center gap-1.5">
                  <Icon name="upload-cloud" size={13}/> Actualizar catálogo
                </button>
                <button onClick={() => setArticleModal({ mode: 'new' })} className="btn-primary text-xs flex items-center gap-1.5">
                  <Icon name="plus" size={13}/> Nuevo artículo
                </button>
              </div>
            )}
          </div>
        </div>

        {showDeleteAll && (
          <DeleteAllModal
            title="Eliminar todos los artículos"
            description="Se va a eliminar el catálogo completo de artículos. Esta acción no se puede deshacer."
            onClose={() => setShowDeleteAll(false)}
            onConfirm={async () => {
              await CrmApi.deleteAllArticles();
              reload();
            }}
          />
        )}
        {showImport && (
          <ArticleImportModal
            onClose={() => setShowImport(false)}
            onDone={() => { reload(); setShowImport(false); }}
          />
        )}
        {articleModal && (
          <ArticleFormModal
            article={articleModal.mode === 'edit' ? articleModal.article : null}
            meta={meta}
            onClose={() => setArticleModal(null)}
            onSaved={handleSaved}
          />
        )}

        {/* Barra de filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon name="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"/>
            <input
              className="inp pl-8 py-1.5 w-72 text-xs"
              placeholder="Buscar código o descripción…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select className="inp text-xs py-1.5 max-w-[200px]" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">Todos los rubros</option>
            {meta.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="inp text-xs py-1.5" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">Todos los tipos</option>
            {meta.types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select className="inp text-xs py-1.5" value={filterClass} onChange={e => setFilterClass(e.target.value)}>
            <option value="">Todas las clases</option>
            {meta.classes.map(c => <option key={c} value={c}>Clase {c}</option>)}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-ink-500 cursor-pointer select-none ml-1">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded accent-brand"/>
            Ver inactivos
          </label>

          {hasFilters && (
            <button className="btn-ghost text-xs" onClick={() => { setSearch(''); setFilterCat(''); setFilterType(''); setFilterClass(''); setShowInactive(false); }}>
              <Icon name="x" size={12}/> Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-sm border-collapse min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-surface border-b border-line">
            <tr>
              {[
                { key: 'code',        label: 'Código',      w: 'w-36' },
                { key: 'description', label: 'Descripción', w: 'w-auto' },
                { key: 'category',    label: 'Rubro',       w: 'w-52' },
                { key: 'type',        label: 'Tipo',        w: 'w-24' },
                { key: 'class',       label: 'Clase',       w: 'w-16' },
              ].map(col => (
                <th key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={cx('text-left px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-ink-500 cursor-pointer hover:text-ink-900 select-none whitespace-nowrap', col.w)}>
                  {col.label}<SortIcon col={col.key}/>
                </th>
              ))}
              <th className="text-center px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-16">Estado</th>
              {isAdmin && <th className="w-16"/>}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-line">
            {loading ? (
              <tr><td colSpan="6" className="text-center py-16 text-sm text-ink-400">Cargando…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan="6" className="text-center py-16 text-sm text-ink-400">Sin resultados para los filtros aplicados</td></tr>
            ) : items.map(a => (
              <tr key={a.code} className={cx('group hover:bg-surface/60 transition-colors', !a.active && 'opacity-45')}>
                <td className="px-3 py-2 font-mono text-[12px] font-semibold text-blue-700 whitespace-nowrap">{a.code}</td>
                <td className="px-3 py-2 text-[13px] text-ink-800">{a.description}</td>
                <td className="px-3 py-2 text-[12px] text-ink-500 truncate max-w-[200px]">{a.category || '—'}</td>
                <td className="px-3 py-2 text-[12px] text-ink-500 whitespace-nowrap">{a.type || '—'}</td>
                <td className="px-3 py-2 text-center">
                  {a.class
                    ? <span className={cx('text-[11px] font-bold px-1.5 py-0.5 rounded', CLASS_TONE[a.class] || 'bg-ink-100 text-ink-600')}>{a.class}</span>
                    : <span className="text-ink-300 text-[11px]">—</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={cx('inline-block w-2 h-2 rounded-full', a.active ? 'bg-green-400' : 'bg-ink-300')} title={a.active ? 'Activo' : 'Inactivo'}/>
                </td>
                {isAdmin && (
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="Editar"
                        onClick={() => setArticleModal({ mode: 'edit', article: a })}
                        className="w-7 h-7 rounded-lg hover:bg-blue-50 flex items-center justify-center text-ink-400 hover:text-blue-600 transition-colors">
                        <Icon name="pencil" size={13}/>
                      </button>
                      <button
                        title="Eliminar"
                        onClick={() => handleDelete(a)}
                        className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors">
                        <Icon name="trash-2" size={13}/>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Paginación ── */}
      <div className="shrink-0 border-t border-line bg-white px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">Filas por página:</span>
          {[50, 100, 200].map(n => (
            <button key={n} onClick={() => setLimit(n)}
              className={cx('text-xs px-2 py-1 rounded border transition-colors',
                limit === n ? 'bg-brand text-white border-brand' : 'border-line text-ink-500 hover:border-ink-400')}>
              {n}
            </button>
          ))}
        </div>

        <div className="text-[12px] text-ink-500">
          {offset + 1}–{Math.min(offset + limit, total)} de {total.toLocaleString()}
        </div>

        <div className="flex items-center gap-1">
          <button disabled={offset === 0}
            onClick={() => setOffset(0)}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">«</button>
          <button disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">← Anterior</button>
          <span className="text-xs text-ink-500 px-2">Pág. {currentPage} / {totalPages || 1}</span>
          <button disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">Siguiente →</button>
          <button disabled={offset + limit >= total}
            onClick={() => setOffset((totalPages - 1) * limit)}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">»</button>
        </div>
      </div>
    </div>
  );
}

// ─── Comparativa: Presupuesto vs Nota de Pedido ──────────────────────────────
function Comparativa() {
  const [filters, setFilters]   = useState({ clientId: '', sellerId: '', quoteId: '', npCode: '', from: '', to: '' });
  const [data, setData]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [users, setUsers]       = useState([]);
  const [clients, setClients]   = useState([]);
  const [expanded, setExpanded] = useState({}); // { [presId]: true }
  const [searched, setSearched] = useState(false);

  // Cargar vendedores y clientes para los filtros
  React.useEffect(() => {
    CrmApi.getUsers().then(setUsers).catch(() => {});
    CrmApi.getClients().then(setClients).catch(() => {});
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const params = {};
      if (filters.clientId) params.clientId = filters.clientId;
      if (filters.sellerId) params.sellerId = filters.sellerId;
      if (filters.quoteId)  params.quoteId  = filters.quoteId;
      if (filters.npCode)   params.npCode   = filters.npCode;
      if (filters.from)     params.from     = filters.from;
      if (filters.to)       params.to       = filters.to;
      const result = await CrmApi.getComparativa(params);
      setData(result);
      // Expandir el primero automáticamente si hay pocos resultados
      if (result.length === 1) setExpanded({ [result[0].presupuesto.id]: true });
    } catch (err) {
      alert(err.message || 'Error al cargar comparativa');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const ESTADO_CONFIG = {
    igual:            { label: 'Igual',            bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500'  },
    cantidad_distinta: { label: 'Cant. distinta',  bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500'  },
    no_compro:        { label: 'No compró',        bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500'    },
    agregado:         { label: 'Agregado en NP',   bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500'   },
  };

  const fmtUSD = (v) => v == null ? '—' : `U$S ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtQty = (v) => v == null ? '—' : Number(v).toLocaleString('es-AR');

  return (
    <div className="p-6 space-y-6">
      <PageHead title="Comparativa" subtitle="Presupuesto vs Nota de Pedido — diferencias por ítem" />

      {/* ── Filtros ── */}
      <div className="card p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="label-sm">Cliente</label>
            <select className="input-sm w-full" value={filters.clientId}
              onChange={e => setFilters(f => ({ ...f, clientId: e.target.value }))}>
              <option value="">Todos</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label-sm">Vendedor</label>
            <select className="input-sm w-full" value={filters.sellerId}
              onChange={e => setFilters(f => ({ ...f, sellerId: e.target.value }))}>
              <option value="">Todos</option>
              {users.filter(u => ['VENDEDOR','ADMIN'].includes(u.role)).map(u =>
                <option key={u.id} value={u.id}>{u.name}</option>
              )}
            </select>
          </div>
          <div>
            <label className="label-sm">Código presupuesto</label>
            <input className="input-sm w-full" placeholder="ej: COT-2026-041"
              value={filters.quoteId}
              onChange={e => setFilters(f => ({ ...f, quoteId: e.target.value }))} />
          </div>
          <div>
            <label className="label-sm">Nº Nota de Pedido</label>
            <input className="input-sm w-full" placeholder="ej: NP-20817"
              value={filters.npCode}
              onChange={e => setFilters(f => ({ ...f, npCode: e.target.value }))} />
          </div>
          <div>
            <label className="label-sm">Desde</label>
            <input type="date" className="input-sm w-full" value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="label-sm">Hasta</label>
            <input type="date" className="input-sm w-full" value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary text-sm px-4 py-1.5" onClick={handleSearch} disabled={loading}>
            {loading ? 'Buscando...' : '🔍 Buscar'}
          </button>
          <button className="btn-ghost text-sm px-3 py-1.5" onClick={() => {
            setFilters({ clientId: '', sellerId: '', quoteId: '', npCode: '', from: '', to: '' });
            setData([]); setSearched(false);
          }}>Limpiar</button>
        </div>
      </div>

      {/* ── Resultados ── */}
      {loading && (
        <div className="text-center py-12 text-ink-400">Cargando comparativa...</div>
      )}

      {!loading && searched && data.length === 0 && (
        <div className="card p-8 text-center text-ink-400">
          No hay presupuestos con Nota de Pedido vinculada para los filtros seleccionados.
        </div>
      )}

      {!loading && !searched && (
        <div className="card p-8 text-center text-ink-400">
          Aplicá filtros y presioná <strong>Buscar</strong> para ver la comparativa.
        </div>
      )}

      {!loading && data.map(row => {
        const { presupuesto: pres, notaPedido: np, resumen, items } = row;
        const isOpen = !!expanded[pres.id];

        return (
          <div key={pres.id} className="card overflow-hidden">
            {/* ── Header del par ── */}
            <button
              className="w-full text-left p-4 hover:bg-ink-50 transition-colors"
              onClick={() => toggleExpand(pres.id)}>
              <div className="flex items-start gap-4">
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {/* Presupuesto */}
                  <div>
                    <p className="text-xs text-ink-400 mb-0.5">Presupuesto</p>
                    <p className="font-semibold text-sm">{pres.code}</p>
                    {pres.flexxusCode && <p className="text-xs text-ink-400">{pres.flexxusCode}</p>}
                  </div>
                  {/* Nota de Pedido */}
                  <div>
                    <p className="text-xs text-ink-400 mb-0.5">Nota de Pedido</p>
                    {np ? (
                      <>
                        <p className="font-semibold text-sm">{np.flexxusCode || np.code}</p>
                        {np.ocNumber && <p className="text-xs text-ink-400">OC: {np.ocNumber}</p>}
                      </>
                    ) : <p className="text-sm text-ink-300">—</p>}
                  </div>
                  {/* Cliente / Vendedor */}
                  <div>
                    <p className="text-xs text-ink-400 mb-0.5">Cliente</p>
                    <p className="text-sm font-medium">{pres.client?.name || '—'}</p>
                    <p className="text-xs text-ink-400">{pres.seller?.name || '—'}</p>
                  </div>
                  {/* Resumen numérico */}
                  <div className="text-right">
                    <p className="text-xs text-ink-400 mb-1">Total pres. → NP</p>
                    <p className="text-sm font-semibold">{fmtUSD(resumen.totalPres)}</p>
                    <p className={`text-sm font-semibold ${resumen.totalNP >= resumen.totalPres ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtUSD(resumen.totalNP)}
                    </p>
                    {resumen.conversion != null &&
                      <p className="text-xs text-ink-400">{resumen.conversion}% conversión</p>}
                  </div>
                </div>
                {/* Badges de estado */}
                <div className="flex flex-col gap-1 items-end shrink-0">
                  {resumen.itemsIguales > 0 &&
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                      {resumen.itemsIguales} iguales
                    </span>}
                  {resumen.itemsCantDistinta > 0 &&
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      {resumen.itemsCantDistinta} cant. distintas
                    </span>}
                  {resumen.itemsNoCompro > 0 &&
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                      {resumen.itemsNoCompro} no compró
                    </span>}
                  {resumen.itemsAgregado > 0 &&
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {resumen.itemsAgregado} agregados
                    </span>}
                  <span className="text-ink-300 text-sm mt-1">{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>
            </button>

            {/* ── Tabla de ítems (desplegable) ── */}
            {isOpen && (
              <div className="border-t border-ink-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ink-50 text-ink-500 text-xs">
                      <th className="px-3 py-2 text-left w-4"></th>
                      <th className="px-3 py-2 text-left">Código</th>
                      <th className="px-3 py-2 text-left">Descripción</th>
                      <th className="px-3 py-2 text-right">Cant. Pres.</th>
                      <th className="px-3 py-2 text-right">P.U. Pres.</th>
                      <th className="px-3 py-2 text-right">Total Pres.</th>
                      <th className="px-3 py-2 text-right">Cant. NP</th>
                      <th className="px-3 py-2 text-right">P.U. NP</th>
                      <th className="px-3 py-2 text-right">Total NP</th>
                      <th className="px-3 py-2 text-right">Dif. $</th>
                      <th className="px-3 py-2 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {items.map((it, idx) => {
                      const cfg = ESTADO_CONFIG[it.estado] || ESTADO_CONFIG.igual;
                      return (
                        <tr key={idx} className={`${cfg.bg} hover:brightness-95 transition-all`}>
                          <td className="px-3 py-2">
                            <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot}`}></span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-500">{it.sku || '—'}</td>
                          <td className="px-3 py-2 max-w-xs truncate" title={it.description}>{it.description}</td>
                          <td className="px-3 py-2 text-right">{fmtQty(it.qtyPres)}</td>
                          <td className="px-3 py-2 text-right text-xs">{fmtUSD(it.unitPricePres)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtUSD(it.totalPres)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${it.estado === 'cantidad_distinta' ? cfg.text : ''}`}>
                            {fmtQty(it.qtyNP)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">{fmtUSD(it.unitPriceNP)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtUSD(it.totalNP)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${it.totalDiff == null ? '' : it.totalDiff < 0 ? 'text-red-600' : it.totalDiff > 0 ? 'text-green-600' : 'text-ink-400'}`}>
                            {it.totalDiff == null ? '—' : (it.totalDiff > 0 ? '+' : '') + fmtUSD(it.totalDiff)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.text} bg-white bg-opacity-60`}>
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Totales */}
                  <tfoot>
                    <tr className="bg-ink-100 font-semibold text-sm">
                      <td colSpan="5" className="px-3 py-2 text-right text-ink-500">TOTAL</td>
                      <td className="px-3 py-2 text-right">{fmtUSD(resumen.totalPres)}</td>
                      <td colSpan="2" className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right">{fmtUSD(resumen.totalNP)}</td>
                      <td className={`px-3 py-2 text-right ${resumen.diferencia < 0 ? 'text-red-600' : resumen.diferencia > 0 ? 'text-green-600' : ''}`}>
                        {(resumen.diferencia > 0 ? '+' : '') + fmtUSD(resumen.diferencia)}
                      </td>
                      <td className="px-3 py-2 text-center text-ink-400">
                        {resumen.conversion != null ? `${resumen.conversion}%` : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

Object.assign(window, { MySalesView, LogisticsView, Clients, Articles, Team, Config, PageHead, Comparativa, ArticleFormModal, ClientImportModal });
