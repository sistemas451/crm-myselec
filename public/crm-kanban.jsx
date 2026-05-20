/* Kanban boards: Fase 1 (Cotizaciones) + Fase 2 (OCs). */

const { useState: useS } = React;

const STAGE_DOT = {
  gray:'#94A3B8', blue:'#3B82F6', navy:'#1B2A4A', amber:'#F59E0B',
  sky:'#0EA5E9', orange:'#F97316', green:'#10B981', red:'#EF4444', purple:'#8B5CF6'
};
function StageDot({ tone }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STAGE_DOT[tone] || '#94A3B8' }}/>;
}

function EmptyCol() {
  return (
    <div className="text-[11.5px] text-ink-400 py-10 text-center border border-dashed border-line rounded-lg">
      Sin tarjetas en esta etapa
    </div>
  );
}

function QuoteCard({ q, onOpen, compact }) {
  const { clients, users } = useApp();
  const cli = clients.find(c=>c.code===q.client);
  const sel = users.find(u=>u.id===q.seller);
  const overdue = q.dias >= 5 && !['aceptada','rechazada'].includes(q.stage);
  const displayName = cli?.name || q.emailSubject || 'Sin cliente asignado';
  const displaySub  = cli ? `${cli.city || ''}${cli.city && cli.prov ? ', ' : ''}${cli.prov || ''}` : 'Cliente por asignar';
  return (
    <div
      onClick={onOpen}
      className="kcard bg-white border border-line rounded-lg p-3 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-[11px] font-semibold text-navy-900">{q.code}</div>
        <div className="flex items-center gap-1">
          {q.mailType === 'SOLICITUD'   && <Badge tone="sky">SOL</Badge>}
          {q.mailType === 'PRESUPUESTO' && <Badge tone="blue">PRES</Badge>}
          {q.mailType === 'OC'          && <Badge tone="purple">OC</Badge>}
          {q.flexxus && <Badge tone="slate">{q.flexxus}</Badge>}
          {overdue && <Badge tone="red" dot>{q.dias}d</Badge>}
        </div>
      </div>
      <div className="text-[13px] font-semibold text-ink-900 mt-1 leading-snug truncate">{displayName}</div>
      <div className="text-[11px] text-ink-500 truncate">{displaySub}</div>

      {q.monto != null && (
        <div className="mt-2.5 mono text-[13px] font-bold text-ink-900">{fmtMoney(q.monto)}</div>
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

function OrderCard({ o, onOpen, compact }) {
  const { clients, users } = useApp();
  const cli = clients.find(c=>c.code===o.client);
  const sel = users.find(u=>u.id===o.seller);
  const isEmailOC = o._source === 'QUOTE';
  const displayName = cli?.name || o.clientName || o.emailSubject || 'Sin cliente';
  return (
    <div onClick={onOpen} className="kcard bg-white border border-line rounded-lg p-3 cursor-pointer">
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

  return (
    <div className="flex flex-col h-[calc(100vh-62px)]">
      <div className="px-6 pt-5 pb-4 flex items-end justify-between gap-4 border-b border-line bg-white">
        <div>
          <div className="text-[13px] uppercase tracking-wider font-semibold text-ink-500">{subtitle}</div>
          <h2 className="text-xl font-bold text-ink-900 mt-0.5">{title}</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-x-auto scroll-thin px-6 pb-6 pt-4 bg-surface">
        <div className="flex gap-3 h-full min-w-max">
          {stages.map(st => {
            const list = items.filter(i => i.stage === st.id);
            const total = list.reduce((a,b)=>a+(b.monto||0),0);
            return (
              <div key={st.id} className="w-[292px] shrink-0 flex flex-col bg-white rounded-xl border border-line">
                <div className="px-3.5 py-3 flex items-center justify-between border-b border-line">
                  <div className="flex items-center gap-2 min-w-0">
                    <StageDot tone={st.tone}/>
                    <span className="text-[12.5px] font-semibold text-ink-900 truncate">{st.label}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-ink-500 bg-surface border border-line rounded-md px-1.5 py-0.5">{list.length}</span>
                </div>
                <div className="kcol-body p-2.5 space-y-2 scroll-thin flex-1 bg-surface/50">
                  {list.length === 0 && <EmptyCol/>}
                  {list.map(it => (
                    <div key={it.code} className="space-y-1.5">
                      {kind === 'quote'
                        ? <QuoteCard q={it} onOpen={()=>onOpen(it.code)}/>
                        : <OrderCard o={it} onOpen={()=>onOpen(it.code)}/>}
                      {logisticsActions && kind === 'order' && (
                        <button onClick={(e)=>{ e.stopPropagation(); quickAdvance(it); }}
                          className="w-full text-[11px] bg-brandSoft text-navy-900 hover:bg-brand hover:text-white transition-colors py-1.5 rounded-md font-medium flex items-center justify-center gap-1">
                          <Icon name="arrow-right" size={11}/> Avanzar etapa
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {total > 0 && (
                  <div className="px-3.5 py-2 border-t border-line text-[11px] flex justify-between text-ink-500">
                    <span>Total etapa</span><span className="mono font-semibold text-ink-700">{fmtMoney(total)}</span>
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
  // Abrir detail correcto: Quote-OC de email → quoteDetail, OC manual → orderDetail
  const handleOpen = (code) => {
    const item = filtered.find(i => i.code === code);
    onOpen(code, item?._source === 'QUOTE' ? 'quote' : 'order');
  };
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

Object.assign(window, { KanbanQuotes, KanbanOrders, QuoteCard, OrderCard, StageDot, STAGE_DOT });
