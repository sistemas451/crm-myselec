/* Kanban boards: Fase 1 (Cotizaciones) + Fase 2 (OCs). */

const { useState: useS } = React;

const STAGE_DOT = {
  gray:'#939598', blue:'#20759E', navy:'#004669', amber:'#E5930A',
  sky:'#20759E', orange:'#E5760A', green:'#16A76E', red:'#D93636', purple:'#7C5AC7'
};
function StageDot({ tone }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_DOT[tone] || '#939598' }}/>;
}

function EmptyCol() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-line/70 rounded-xl">
      <div className="w-9 h-9 rounded-lg bg-surface flex items-center justify-center mb-2">
        <Icon name="inbox" size={16} className="text-ink-300"/>
      </div>
      <div className="text-[11.5px] text-ink-400">Sin tarjetas</div>
    </div>
  );
}

function QuoteCard({ q, onOpen, compact }) {
  const { clients, users } = useApp();
  const cli = clients.find(c=>c.code===q.client);
  const sel = users.find(u=>u.id===q.seller);
  const overdue = q.dias >= 5 && !['aceptada','rechazada'].includes(q.stage);
  // Seguimiento vencido: está en "enviado" y el followUpDate ya pasó
  const followUpOverdue = q.stage === 'enviado' && q.followUpDate && new Date(q.followUpDate) <= new Date();
  const followUpDays = followUpOverdue
    ? Math.floor((Date.now() - new Date(q.followUpDate)) / (1000*60*60*24))
    : 0;
  const displayName = cli?.name || q.emailSubject || 'Sin cliente asignado';
  const displaySub  = cli ? `${cli.city || ''}${cli.city && cli.prov ? ', ' : ''}${cli.prov || ''}` : 'Cliente por asignar';
  return (
    <div
      onClick={onOpen}
      className={cx('kcard bg-white border rounded-xl p-3.5 cursor-pointer',
        followUpOverdue ? 'border-amber-300 ring-1 ring-amber-100' : 'border-line/80'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-[11px] font-semibold text-navy-900">{q.code}</div>
        <div className="flex items-center gap-1">
          {q.mailType === 'SOLICITUD'   && <Badge tone="sky">SOL</Badge>}
          {q.mailType === 'PRESUPUESTO' && <Badge tone="blue">PRES</Badge>}
          {q.mailType === 'OC'          && <Badge tone="purple">OC</Badge>}
          {q.flexxus && <Badge tone="slate">{q.flexxus}</Badge>}
          {followUpOverdue && (
            <span title={`Sin respuesta hace ${followUpDays}d`}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
              ⏰ {followUpDays}d
            </span>
          )}
          {!followUpOverdue && overdue && <Badge tone="red" dot>{q.dias}d</Badge>}
        </div>
      </div>
      <div className="text-[13px] font-semibold text-ink-900 mt-1 leading-snug truncate">{displayName}</div>
      <div className="text-[11px] text-ink-500 truncate">{displaySub}</div>

      {q.monto != null && (
        <div className="mt-2.5 mono text-[13px] font-bold text-ink-900">{fmtMoney(q.monto, q.currency)}</div>
      )}

      {!compact && sel && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar name={sel.name} size={22}/>
            <span className="text-[11.5px] text-ink-700">{sel.name.split(' ')[0]}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            {q.adj > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="paperclip" size={11}/>{q.adj}</span>}
            {q.notas > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="message-square" size={11}/>{q.notas}</span>}
            <span className="inline-flex items-center gap-0.5"><Icon name="calendar" size={11}/>{fmtDate(q.ingreso)}</span>
          </div>
        </div>
      )}

      {q.stage === 'rechazada' && q.rejectReason && (
        <div className="mt-2 text-[11px] text-bad bg-red-50 rounded-md px-2 py-1 inline-flex items-center gap-1">
          <Icon name="x-circle" size={11}/> Motivo: {q.rejectReason}
        </div>
      )}
    </div>
  );
}

// Tarjeta combinada: PRESUPUESTO (arriba, grande) + SOLICITUD vinculada (abajo, chica)
function PairedQuoteCard({ pres, sol, onOpenPres, onOpenSol }) {
  const { clients, users } = useApp();
  const cli = clients.find(c => c.code === pres.client);
  const sel = users.find(u => u.id === pres.seller);
  const displayName = cli?.name || pres.emailSubject || 'Sin cliente asignado';
  const displaySub  = cli ? `${cli.city || ''}${cli.city && cli.prov ? ', ' : ''}${cli.prov || ''}` : '';
  return (
    <div className="rounded-xl border border-brand/30 overflow-hidden shadow-sm">
      {/* ── PRESUPUESTO (main) ── */}
      <div onClick={onOpenPres} className="kcard bg-white p-3 cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <div className="mono text-[11px] font-semibold text-navy-900">{pres.code}</div>
          <div className="flex items-center gap-1">
            <Badge tone="blue">PRES</Badge>
            {pres.flexxus && <Badge tone="slate">{pres.flexxus}</Badge>}
            {pres.rejectReason && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                {pres.rejectReason}
              </span>
            )}
          </div>
        </div>
        <div className="text-[13px] font-semibold text-ink-900 mt-1 leading-snug truncate">{displayName}</div>
        {displaySub && <div className="text-[11px] text-ink-500 truncate">{displaySub}</div>}
        {pres.monto != null && (
          <div className="mt-2 mono text-[13px] font-bold text-ink-900">{fmtMoney(pres.monto, pres.currency)}</div>
        )}
        {sel && (
          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Avatar name={sel.name} size={20}/>
              <span className="text-[11px] text-ink-600">{sel.name.split(' ')[0]}</span>
            </div>
            <span className="text-[11px] text-ink-400">{fmtDate(pres.ingreso)}</span>
          </div>
        )}
      </div>
      {/* ── Divisor con etiqueta ── */}
      <div className="flex items-center gap-2 px-3 py-1 bg-brand/5 border-y border-brand/20">
        <Icon name="link" size={10} className="text-brand/60 shrink-0"/>
        <span className="text-[10px] text-brand/70 font-medium">Solicitud vinculada</span>
      </div>
      {/* ── SOLICITUD (companion, más chica) ── */}
      <div onClick={onOpenSol} className="kcard bg-surface/60 px-3 py-2 cursor-pointer flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="mono text-[10.5px] font-semibold text-ink-600">{sol.code}</div>
          <div className="text-[11px] text-ink-500 truncate">{sol.emailSubject || 'Solicitud de cotización'}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge tone="sky">SOL</Badge>
          <span className="text-[10px] text-ink-400">{fmtDate(sol.ingreso)}</span>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ o, onOpen, compact }) {
  const { clients, users } = useApp();
  const cli = clients.find(c=>c.code===o.client);
  const sel = users.find(u=>u.id===o.seller);
  const isEmailOC = o._source === 'QUOTE';
  const displayName = cli?.name || o.clientName || o.emailSubject || 'Sin cliente';
  return (
    <div onClick={onOpen} className="kcard bg-white border border-line/80 rounded-xl p-3.5 cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-[11px] font-semibold text-navy-900">{o.code}</div>
        <div className="flex items-center gap-1">
          {isEmailOC && <Badge tone="purple">EMAIL</Badge>}
          {o.flexxus && <Badge tone="slate">{o.flexxus}</Badge>}
        </div>
      </div>
      <div className="text-[13px] font-semibold text-ink-900 mt-1 leading-snug truncate">{displayName}</div>
      <div className="mono text-[11px] text-ink-500 truncate">{o.fromQuote ? `← ${o.fromQuote}` : '— sin presupuesto vinculado'}</div>

      {!compact && sel && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar name={sel.name} size={22}/>
            <span className="text-[11.5px] text-ink-700">{sel.name.split(' ')[0]}</span>
          </div>
          <div className="text-[11px] text-ink-500 inline-flex items-center gap-1">
            <Icon name="calendar" size={11}/>{fmtDate(o.fecha)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Boards ----------
function KanbanBoard({ stages, items, kind, onOpen, title, subtitle, actions, logisticsActions }) {
  const { moveOrderStage, pushToast } = useApp();

  const quickAdvance = (o) => {
    const idx = STAGES_F2.findIndex(s => s.id === o.stage);
    const next = STAGES_F2[idx+1];
    if (next) moveOrderStage(o.code, next.id);
    else pushToast('Ya está en la última etapa', 'warn');
  };

  // ── Pares globales: PRESUPUESTO con SOLICITUD vinculada en cualquier columna ──
  // La SOLICITUD desaparece de su columna y se muestra pegada al PRESUPUESTO.
  const pairedSolIds  = new Set(); // IDs de SOLICITUDs ocultas de su columna
  const presToSolMap  = new Map(); // presupuestoId → solicitud item
  if (kind === 'quote') {
    for (const it of items) {
      if (it.mailType === 'PRESUPUESTO' && it.linkedQuoteId) {
        const sol = items.find(q => q.id === it.linkedQuoteId && q.mailType === 'SOLICITUD');
        if (sol) { pairedSolIds.add(sol.id); presToSolMap.set(it.id, sol); }
      }
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <div className="px-6 pt-5 pb-4 flex items-end justify-between gap-4 border-b border-line bg-white page-head">
        <div>
          <div className="page-head-sub">{subtitle}</div>
          <h2 className="page-head-title mt-0.5">{title}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-x-auto scroll-thin px-6 pb-6 pt-4 bg-surface">
        <div className="flex gap-3 h-full min-w-max">
          {stages.map(st => {
            // Filtrar SOLICITUDs que tienen par → no aparecen en su propia columna
            const list  = items.filter(i => i.stage === st.id && !pairedSolIds.has(i.id));
            const totalUSD = list.filter(i => (i.currency||'USD') !== 'ARS').reduce((a,b) => a + (b.monto||0), 0);
            const totalARS = list.filter(i => i.currency === 'ARS').reduce((a,b) => a + (b.monto||0), 0);
            return (
              <div key={st.id} className="w-[292px] shrink-0 flex flex-col bg-white rounded-xl border border-line shadow-xs">
                <div className="px-3.5 py-3 flex items-center justify-between border-b border-line">
                  <div className="flex items-center gap-2 min-w-0">
                    <StageDot tone={st.tone}/>
                    <span className="text-[12.5px] font-semibold text-ink-900 truncate" style={{letterSpacing: '-0.005em'}}>{st.label}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-ink-500 bg-surface border border-line rounded-md px-1.5 py-0.5">{list.length}</span>
                </div>
                <div className="kcol-body p-2.5 space-y-2 scroll-thin flex-1 bg-surface/40">
                  {list.length === 0 && <EmptyCol/>}
                  {kind === 'quote'
                    ? list.map(it => {
                        const sol = presToSolMap.get(it.id);
                        return sol
                          ? <PairedQuoteCard key={it.code} pres={it} sol={sol}
                              onOpenPres={() => onOpen(it.code)}
                              onOpenSol={() => onOpen(sol.code)}/>
                          : <QuoteCard key={it.code} q={it} onOpen={() => onOpen(it.code)}/>;
                      })
                    : list.map(it => (
                        <div key={it.code} className="space-y-1.5">
                          <OrderCard o={it} onOpen={() => onOpen(it.code)}/>
                          {logisticsActions && (
                            <button onClick={(e) => { e.stopPropagation(); quickAdvance(it); }}
                              className="w-full text-[11px] bg-brandSoft text-navy-900 hover:bg-brand hover:text-white transition-colors py-1.5 rounded-md font-medium flex items-center justify-center gap-1">
                              <Icon name="arrow-right" size={11}/> Avanzar etapa
                            </button>
                          )}
                        </div>
                      ))
                  }
                </div>
                {(totalUSD > 0 || totalARS > 0) && (
                  <div className="px-3.5 py-2 border-t border-line text-[11px] flex flex-col gap-0.5 text-ink-500">
                    {totalUSD > 0 && <div className="flex justify-between"><span>Total USD</span><span className="mono font-semibold text-ink-700">{fmtMoney(totalUSD, 'USD')}</span></div>}
                    {totalARS > 0 && <div className="flex justify-between"><span>Total ARS</span><span className="mono font-semibold text-ink-700">{fmtMoney(totalARS, 'ARS')}</span></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Quote filters toolbar ----------
function QuoteFiltersBar() {
  const { quoteFilters, setQuoteFilters, users } = useApp();
  const [moreOpen, setMoreOpen] = useS(false);
  const active = countActiveFilters(quoteFilters);

  const sellerOptions = [
    { value:'', label:'Todos los vendedores', icon:'users' },
    ...users.filter(u=>u.role==='Vendedor'||u.role==='Administrador')
      .map(u => ({ value:u.id, label:u.name, icon:'user' }))
  ];
  const periodOptions = [
    { value:'7d',  label:'Últimos 7 días' },
    { value:'30d', label:'Últimos 30 días' },
    { value:'month', label:'Este mes' },
    { value:'quarter', label:'Trimestre' },
    { value:'all', label:'Todo el histórico' },
  ];
  const activeSeller = users.find(u=>u.id===quoteFilters.seller);

  return (
    <>
      <PopoverButton icon="user"
        label={activeSeller ? activeSeller.name.split(' ')[0] : 'Todos los vendedores'}
        value={quoteFilters.seller}
        active={!!quoteFilters.seller}
        onChange={(v)=>setQuoteFilters(s=>({...s, seller:v}))}
        onClear={()=>setQuoteFilters(s=>({...s, seller:''}))}
        options={sellerOptions}
      />
      <div className="relative">
        <Icon name="building-2" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
        <input className="inp pl-8 py-1.5 text-xs w-44" placeholder="Cliente…"
          value={quoteFilters.client}
          onChange={e=>setQuoteFilters(s=>({...s, client:e.target.value}))}/>
      </div>
      <PopoverButton icon="calendar"
        label={periodOptions.find(p=>p.value===quoteFilters.period)?.label || 'Período'}
        value={quoteFilters.period}
        active={quoteFilters.period !== '30d'}
        onChange={(v)=>setQuoteFilters(s=>({...s, period:v}))}
        options={periodOptions}
      />
      <div className="w-px h-6 bg-line mx-1"/>
      <div className="relative">
        <button onClick={()=>setMoreOpen(o=>!o)}
          className={cx('btn-ghost', active>0 && 'border-brand/40 text-navy-900 bg-brandSoft/40')}>
          <Icon name="filter" size={14}/>Más filtros
          {active > 0 && <span className="ml-1 bg-brand text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{active}</span>}
        </button>
        {moreOpen && <MoreFiltersPopover onClose={()=>setMoreOpen(false)} which="quote"/>}
      </div>
    </>
  );
}

function OrderFiltersBar() {
  const { orderFilters, setOrderFilters } = useApp();
  const [moreOpen, setMoreOpen] = useS(false);
  const active = countActiveFilters(orderFilters);

  const periodOptions = [
    { value:'7d',  label:'Últimos 7 días' },
    { value:'30d', label:'Últimos 30 días' },
    { value:'month', label:'Este mes' },
    { value:'all', label:'Todo el histórico' },
  ];

  return (
    <>
      <div className="relative">
        <Icon name="building-2" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
        <input className="inp pl-8 py-1.5 text-xs w-40" placeholder="Cliente…"
          value={orderFilters.client}
          onChange={e=>setOrderFilters(s=>({...s, client:e.target.value}))}/>
      </div>
      <PopoverButton icon="calendar"
        label={periodOptions.find(p=>p.value===orderFilters.period)?.label || 'Período'}
        value={orderFilters.period}
        active={orderFilters.period !== '30d'}
        onChange={(v)=>setOrderFilters(s=>({...s, period:v}))}
        options={periodOptions}
      />
      <div className="w-px h-6 bg-line mx-1"/>
      <div className="relative">
        <button onClick={()=>setMoreOpen(o=>!o)}
          className={cx('btn-ghost', active>0 && 'border-brand/40 text-navy-900 bg-brandSoft/40')}>
          <Icon name="filter" size={14}/>Más filtros
          {active > 0 && <span className="ml-1 bg-brand text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{active}</span>}
        </button>
        {moreOpen && <MoreFiltersPopover onClose={()=>setMoreOpen(false)} which="order"/>}
      </div>
    </>
  );
}

function KanbanQuotes({ onOpen }) {
  const { quotes, clients, quoteFilters, openModal } = useApp();
  const filtered = applyQuoteFilters(quotes, quoteFilters, clients);
  return (
    <KanbanBoard
      title="Cotizaciones"
      subtitle="Fase 1 · del mail de solicitud al presupuesto enviado"
      stages={STAGES_F1} items={filtered} kind="quote" onOpen={onOpen}
      actions={
        <>
          <QuoteFiltersBar/>
          <button className="btn-primary" onClick={()=>openModal('newQuote')}><Icon name="plus" size={14}/>Nueva cotización</button>
        </>
      }
    />
  );
}

function KanbanOrders({ onOpen, logisticsMode }) {
  const { orders, clients, orderFilters, openModal } = useApp();
  const filtered = applyOrderFilters(orders, orderFilters, clients);
  // Siempre abrir OrderDetail — ya maneja internamente isQuoteSource para NPs por email
  const handleOpen = (code) => onOpen(code, 'order');
  return (
    <KanbanBoard
      title={logisticsMode ? 'Órdenes en operación' : 'Órdenes de Compra'}
      subtitle="Fase 2 · del OC recibido al remito conformado"
      stages={STAGES_F2} items={filtered} kind="order" onOpen={handleOpen}
      logisticsActions={logisticsMode}
      actions={
        <>
          <OrderFiltersBar/>
          {!logisticsMode && (
            <button className="btn-primary" onClick={()=>openModal('newOrder')}><Icon name="plus" size={14}/>Nueva Nota de Pedido</button>
          )}
        </>
      }
    />
  );
}

Object.assign(window, { KanbanQuotes, KanbanOrders, StageDot, STAGE_DOT });
