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
  const { clients, allUsers } = useApp();
  const cli = clients.find(c=>c.code===q.client);
  const sel = allUsers.find(u=>u.id===q.seller);
  const overdue = q.dias >= 5 && !['aceptada','rechazada'].includes(q.stage);
  // Seguimiento vencido: está en "enviado" y el followUpDate ya pasó
  const followUpOverdue = q.stage === 'enviado' && q.followUpDate && new Date(q.followUpDate) <= new Date();
  const followUpDays = followUpOverdue
    ? Math.floor((Date.now() - new Date(q.followUpDate)) / (1000*60*60*24))
    : 0;
  // Fecha límite de armado vencida: solo aplica a Solicitudes sin presupuesto vinculado aún
  const deadlineOverdue = q.mailType === 'SOLICITUD' && q.deadline && !q.linkedQuoteId
    && !['enviado','aceptada','rechazada'].includes(q.stage) && new Date(q.deadline) <= new Date();
  const deadlineDaysOver = deadlineOverdue
    ? Math.floor((Date.now() - new Date(q.deadline)) / (1000*60*60*24))
    : 0;
  // Cuenta regresiva mientras todavía no se venció (mismo alcance que deadlineOverdue)
  const deadlinePending = q.mailType === 'SOLICITUD' && q.deadline && !q.linkedQuoteId
    && !['enviado','aceptada','rechazada'].includes(q.stage) && !deadlineOverdue;
  const deadlineDaysLeft = deadlinePending
    ? Math.max(1, Math.ceil((new Date(q.deadline) - Date.now()) / (1000*60*60*24)))
    : 0;
  const displayName = cli?.name || q.emailSubject || 'Sin cliente asignado';
  const displaySub  = cli ? `${cli.city || ''}${cli.city && cli.prov ? ', ' : ''}${cli.prov || ''}` : 'Cliente por asignar';
  // El semáforo pinta la tarjeta con una barra a la izquierda y un fondo suave.
  // El borde queda libre a propósito: ahí van las alertas automáticas (🚩 y ⏰),
  // que son otra cosa — si compartieran el mismo lugar no se distinguirían.
  const prio = prioridadDe(q.priority);
  return (
    <div
      onClick={onOpen}
      className={cx('kcard border rounded-xl p-3.5 cursor-pointer',
        !prio && 'bg-white',
        deadlineOverdue ? 'border-red-300 ring-1 ring-red-100' :
        followUpOverdue ? 'border-amber-300 ring-1 ring-amber-100' : 'border-line/80'
      )}
      style={prio ? { background: prio.wash, borderLeft: `4px solid ${prio.dot}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-[11px] font-semibold text-navy-900">{q.code}</div>
        <div className="flex items-center gap-1">
          {q.mailType === 'SOLICITUD'   && <Badge tone="sky">SOL</Badge>}
          {q.mailType === 'PRESUPUESTO' && <Badge tone="blue">PRES</Badge>}
          {q.mailType === 'NOTA_PEDIDO'  && <Badge tone="orange">NP</Badge>}
          {/* Sello de revisión: este presupuesto ya se recotizó al menos una vez.
              Chico a propósito — el detalle está en la ficha. */}
          {q.revision?.nro > 1 && (
            <span title={`Revisión ${q.revision.nro}${q.revisionDe ? ` — reemplaza a ${q.revisionDe}` : ''}`}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface text-ink-600 border border-line">
              R{q.revision.nro}
            </span>
          )}
          {q.mailType === 'OC'          && <Badge tone="purple">OC</Badge>}
          {q.flexxus && <Badge tone="slate">{q.flexxus}</Badge>}
          {deadlineOverdue && (
            <span title={`Fecha límite vencida hace ${deadlineDaysOver}d`}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300">
              🚩 {deadlineDaysOver}d
            </span>
          )}
          {!deadlineOverdue && followUpOverdue && (
            <span title={`Sin respuesta hace ${followUpDays}d`}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
              ⏰ {followUpDays}d
            </span>
          )}
          {!deadlineOverdue && !followUpOverdue && overdue && <Badge tone="red" dot>{q.dias}d</Badge>}
        </div>
      </div>
      <div className="text-[13px] font-semibold text-ink-900 mt-1 leading-snug truncate">{displayName}</div>
      <div className="text-[11px] text-ink-500 truncate">{displaySub}</div>

      {q.monto != null && (
        <div className="mt-2.5 mono text-[13px] font-bold text-ink-900">{fmtMoney(q.monto, q.currency)}</div>
      )}

      {/* Un presupuesto está en Aceptada porque entró la Nota de Pedido. Mostrarla
          hace que la columna diga lo que significa, y deja a la vista las pocas
          que se aceptaron a mano y todavía no tienen NP. */}
      {q.stage === 'aceptada' && q.mailType === 'PRESUPUESTO' && (
        (q.npFlexxus || q.npCode) ? (
          <div className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"
               title={`Nota de Pedido ${q.npCode || ''}`}>
            <Icon name="clipboard-list" size={10}/>{q.npFlexxus || q.npCode}
          </div>
        ) : (
          <div className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200"
               title="Se aceptó sin que entrara la Nota de Pedido">
            <Icon name="clipboard-list" size={10}/>Sin nota de pedido
          </div>
        )
      )}

      {!compact && sel && (
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar name={sel.name} size={22}/>
            <span className="text-[11.5px] text-ink-700">{sel.name.split(' ')[0]}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            {deadlinePending && (
              <span title={`Fecha límite en ${deadlineDaysLeft}d`}
                className={cx('inline-flex items-center gap-0.5 font-semibold', deadlineDaysLeft <= 1 ? 'text-amber-600' : 'text-ink-500')}>
                <Icon name="flag" size={11}/>{deadlineDaysLeft}d
              </span>
            )}
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
// Tarjeta de paquete: una sola tarjeta para Solicitud + Presupuesto + Nota de
// Pedido. Cada documento en su renglón, con el monto a la derecha. El renglón
// que falta no se dibuja, así el hueco también dice algo: se ve de un vistazo
// qué le falta al negocio.
//
// A propósito sin colores propios: el color de la tarjeta ya lo usa el semáforo
// de seguimiento, y meter un segundo código de color acá los haría competir.
function PaqueteCard({ q, paquete, onOpen }) {
  const { clients, allUsers } = useApp();
  const cli = clients.find(c => c.code === q.client);
  const sel = allUsers.find(u => u.id === q.seller);
  const prio = prioridadDe(q.priority);

  const displayName = cli?.name || q.clientName || q.emailSubject || 'Sin cliente asignado';
  const displaySub  = cli ? `${cli.city || ''}${cli.city && cli.prov ? ', ' : ''}${cli.prov || ''}` : '';

  // Un presupuesto puede tener varias notas de pedido (el cliente compra por
  // tandas). Cuando hay más de una, en vez de apilar renglones se muestra
  // cuántas son y la suma, que es el dato que importa: cuánto de lo cotizado
  // terminó comprando.
  const nps = paquete.notasPedido || [];
  const filas = [
    paquete.solicitud   && { etq: 'SOL',  code: paquete.solicitud.code },
    paquete.presupuesto && { etq: 'PRES', code: paquete.presupuesto.code, monto: paquete.presupuesto.amount, cur: paquete.presupuesto.currency },
    nps.length === 1 && { etq: 'NP',  code: nps[0].code, monto: nps[0].amount, cur: nps[0].currency, fuerte: true },
    // Con varias, el monto va por moneda: si el paquete mezcla pesos y dólares,
    // sumarlos en una sola cifra sería juntar peras con manzanas.
    nps.length > 1   && { etq: 'NP',  code: `${nps.length} notas de pedido`, fuerte: true,
                          montos: paquete.npTotales || {},
                          titulo: nps.map(n => n.code).join(' · ') },
  ].filter(Boolean);

  return (
    <div
      onClick={onOpen}
      className={cx('kcard border rounded-xl p-3.5 cursor-pointer border-line/80', !prio && 'bg-white')}
      style={prio ? { background: prio.wash, borderLeft: `4px solid ${prio.dot}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold text-ink-900 leading-snug truncate">{displayName}</div>
        <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-brandSoft text-brand border border-brand/25">
          <Icon name="link" size={9}/>{filas.length}
        </span>
      </div>
      {displaySub && <div className="text-[11px] text-ink-500 truncate">{displaySub}</div>}

      <div className="mt-2.5 pt-2 border-t border-line/70 space-y-1">
        {filas.map(f => (
          <div key={f.etq} className="flex items-baseline gap-2" title={f.titulo || ''}>
            <span className="w-8 shrink-0 text-[9.5px] font-semibold tracking-wide text-ink-400">{f.etq}</span>
            <span className={cx('text-[11px] truncate', nps.length > 1 && f.etq === 'NP' ? '' : 'mono', f.fuerte ? 'text-navy-900 font-semibold' : 'text-ink-600')}>{f.code}</span>
            {f.monto != null && (
              <span className={cx('ml-auto mono shrink-0', f.fuerte ? 'text-[12px] font-bold text-ink-900' : 'text-[11px] text-ink-600')}>
                {fmtMoney(f.monto, f.cur)}
              </span>
            )}
            {f.montos && Object.keys(f.montos).length > 0 && (
              <span className="ml-auto mono shrink-0 text-[12px] font-bold text-ink-900 text-right">
                {Object.entries(f.montos).map(([cur, monto], i) => (
                  <span key={cur} className={i > 0 ? 'block text-[11px] font-semibold text-ink-600' : ''}>
                    {fmtMoney(monto, cur)}
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>

      {sel && (
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Avatar name={sel.name} size={20}/>
            <span className="text-[11px] text-ink-600">{sel.name.split(' ')[0]}</span>
          </div>
          <span className="text-[11px] text-ink-400">{fmtDate(q.ingreso)}</span>
        </div>
      )}
    </div>
  );
}

function OrderCard({ o, onOpen, compact }) {
  const { clients, allUsers } = useApp();
  const cli = clients.find(c=>c.code===o.client);
  const sel = allUsers.find(u=>u.id===o.seller);
  const displayName = cli?.name || o.clientName || o.emailSubject || 'Sin cliente';
  return (
    <div onClick={onOpen} className="kcard bg-white border border-line/80 rounded-xl p-3.5 cursor-pointer">
      <div className="flex items-start justify-between gap-2">
        <div className="mono text-[11px] font-semibold text-navy-900">{o.code}</div>
        <div className="flex items-center gap-1">
          {o.entrega === 'EMAIL'  && <Badge tone="purple">EMAIL</Badge>}
          {o.entrega === 'UPLOAD' && <Badge tone="sky">MANUAL</Badge>}
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
  const { moveOrderStage, moveQuoteStage, pushToast, setQuotes } = useApp();

  /* ── Drag & drop state ── */
  const [dragCode,  setDragCode]  = useS(null);   // code of card being dragged
  const [overStage, setOverStage] = useS(null);   // stageId being hovered
  const [justDropped, setJustDropped] = useS(null); // code that just landed (for animation)
  const enterCounters = React.useRef({});          // counter per column to prevent flicker

  /* ── Reject modal (drag-to-rechazada) ── */
  const [pendingRejectCode, setPendingRejectCode] = useS(null);
  const [dragRejectReason, setDragRejectReason]   = useS('');
  const [dragRejectNotes,  setDragRejectNotes]    = useS('');
  const [dragRejectSaving, setDragRejectSaving]   = useS(false);

  const submitDragReject = async () => {
    if (!dragRejectReason || !pendingRejectCode) return;
    const item = items.find(i => i.code === pendingRejectCode);
    if (!item) return;
    setDragRejectSaving(true);
    try {
      await CrmApi.changeQuoteStage(item.id, 'rechazada', { rejectReason: dragRejectReason, rejectNotes: dragRejectNotes });
      const fresh = await CrmApi.getQuotes();
      if (fresh) setQuotes(fresh);
      pushToast('Cotización marcada como rechazada');
    } catch (err) {
      pushToast(err.message || 'Error al rechazar', 'bad');
    } finally {
      setDragRejectSaving(false);
      setPendingRejectCode(null);
      setDragRejectReason('');
      setDragRejectNotes('');
    }
  };

  const onCardDragStart = (e, item) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    // Build styled ghost
    const ghost = el.cloneNode(true);
    ghost.className = '';
    ghost.style.cssText = [
      'position:fixed;top:-9999px;left:-9999px',
      'width:' + el.offsetWidth + 'px',
      'transform:rotate(2deg) scale(1.04)',
      'box-shadow:0 16px 40px -12px rgba(0,70,105,.24),0 4px 12px -4px rgba(0,70,105,.08)',
      'border-radius:12px',
      'opacity:.88',
      'background:#fff',
      'border:1px solid rgba(32,117,158,.25)',
      'z-index:99999',
      'pointer-events:none',
    ].join(';');
    // Copy inner styles for children
    Array.from(el.children).forEach((child, i) => {
      if (ghost.children[i]) ghost.children[i].style.cssText = child.style?.cssText || '';
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-kanban', JSON.stringify({ code: item.code, kind }));
    setTimeout(() => ghost.remove(), 0);
    requestAnimationFrame(() => setDragCode(item.code));
  };

  const onCardDragEnd = () => {
    setDragCode(null);
    setOverStage(null);
    enterCounters.current = {};
  };

  const onColDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  const onColEnter = (e, stageId) => {
    e.preventDefault();
    enterCounters.current[stageId] = (enterCounters.current[stageId] || 0) + 1;
    setOverStage(stageId);
  };

  const onColLeave = (stageId) => {
    enterCounters.current[stageId] = (enterCounters.current[stageId] || 0) - 1;
    if (enterCounters.current[stageId] <= 0) {
      enterCounters.current[stageId] = 0;
      setOverStage(prev => prev === stageId ? null : prev);
    }
  };

  const onColDrop = (e, targetStageId) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/x-kanban'));
      if (data.kind !== kind) return;
      const item = items.find(i => i.code === data.code);
      if (item && item.stage !== targetStageId) {
        if (kind === 'quote' && targetStageId === 'rechazada') {
          // Mostrar picker de motivo antes de rechazar
          setPendingRejectCode(data.code);
          setDragRejectReason('');
          setDragRejectNotes('');
        } else {
          if (kind === 'quote') moveQuoteStage(data.code, targetStageId);
          else moveOrderStage(data.code, targetStageId);
          setJustDropped(data.code);
          setTimeout(() => setJustDropped(null), 400);
        }
      }
    } catch (ex) { /* ignore bad data */ }
    setDragCode(null);
    setOverStage(null);
    enterCounters.current = {};
  };

  const quickAdvance = (o) => {
    const idx = STAGES_F2.findIndex(s => s.id === o.stage);
    const next = STAGES_F2[idx+1];
    if (next) moveOrderStage(o.code, next.id);
    else pushToast('Ya está en la última etapa', 'warn');
  };

  // ── Paquetes ────────────────────────────────────────────────────────────────
  // Quién va con quién lo resuelve el backend (campo `paquete`), no el tablero:
  // el vínculo puede estar guardado de cualquiera de los dos lados y resolverlo
  // acá mal era lo que hacía aparecer y desaparecer tarjetas según el filtro.
  //
  // Un miembro se absorbe en la tarjeta del principal solo si está en la MISMA
  // etapa. Si quedó en otra (datos viejos, antes de que el paquete se moviera
  // junto), se dibuja igual por su cuenta: nunca escondemos una tarjeta que no
  // esté representada en otro lado.
  const ocultos = new Set();
  if (kind === 'quote') {
    const etapaDelPrincipal = new Map();
    for (const it of items) {
      if (it.paquete && it.paquete.principal === it.id) etapaDelPrincipal.set(it.id, it.stage);
    }
    for (const it of items) {
      const p = it.paquete;
      if (p && p.principal !== it.id && etapaDelPrincipal.get(p.principal) === it.stage) ocultos.add(it.id);
    }
  }

  // Helper: source column shouldn't highlight
  const dragItem = dragCode ? items.find(i => i.code === dragCode) : null;

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
            const list  = items.filter(i => i.stage === st.id && !ocultos.has(i.id));
            const totalUSD = list.filter(i => (i.currency||'USD') !== 'ARS').reduce((a,b) => a + (b.monto||0), 0);
            const totalARS = list.filter(i => i.currency === 'ARS').reduce((a,b) => a + (b.monto||0), 0);
            const isDropTarget = dragCode && overStage === st.id && (!dragItem || dragItem.stage !== st.id);
            return (
              <div key={st.id}
                onDragOver={onColDragOver}
                onDragEnter={(e) => onColEnter(e, st.id)}
                onDragLeave={() => onColLeave(st.id)}
                onDrop={(e) => onColDrop(e, st.id)}
                className={cx(
                  'w-[292px] shrink-0 flex flex-col rounded-xl border shadow-xs transition-all duration-200',
                  isDropTarget ? 'drag-over-col bg-white' : 'bg-white border-line'
                )}
              >
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
                        const enPaquete = it.paquete && it.paquete.principal === it.id;
                        return (
                          <div key={it.code} draggable
                            onDragStart={(e) => onCardDragStart(e, it)}
                            onDragEnd={onCardDragEnd}
                            className={cx(
                              dragCode === it.code && 'drag-source',
                              justDropped === it.code && 'card-drop-in'
                            )}>
                            {enPaquete
                              ? <PaqueteCard q={it} paquete={it.paquete} onOpen={() => onOpen(it.code)}/>
                              : <QuoteCard q={it} onOpen={() => onOpen(it.code)}/>
                            }
                          </div>
                        );
                      })
                    : list.map(it => (
                        <div key={it.code} draggable
                          onDragStart={(e) => onCardDragStart(e, it)}
                          onDragEnd={onCardDragEnd}
                          className={cx(
                            'space-y-1.5',
                            dragCode === it.code && 'drag-source',
                            justDropped === it.code && 'card-drop-in'
                          )}>
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

      {/* ── Modal de motivo de rechazo (drag-to-rechazada) ── */}
      {pendingRejectCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-ink-900/40" onClick={()=>{setPendingRejectCode(null);setDragRejectReason('');setDragRejectNotes('');}}/>
          <div className="relative bg-white rounded-xl shadow-pop p-5 w-[380px]">
            <div className="text-sm font-semibold mb-3">Motivo de rechazo</div>
            <select value={dragRejectReason} onChange={e=>setDragRejectReason(e.target.value)} className="inp w-full mb-3">
              <option value="">Seleccionar motivo…</option>
              {REJECT_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
            <textarea rows="3" value={dragRejectNotes} onChange={e=>setDragRejectNotes(e.target.value)}
              className="inp w-full resize-none mb-3" placeholder="Observaciones opcionales…"/>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={()=>{setPendingRejectCode(null);setDragRejectReason('');setDragRejectNotes('');}}>Cancelar</button>
              <button className="btn-ghost text-bad border-red-200 hover:bg-red-50"
                disabled={!dragRejectReason || dragRejectSaving} onClick={submitDragReject}
                style={!dragRejectReason?{opacity:.45,cursor:'not-allowed'}:{}}>
                {dragRejectSaving ? 'Guardando…' : 'Marcar rechazada'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Badge legend ----------
function BadgeLegendButton() {
  const [open, setOpen] = useS(false);
  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)} title="¿Qué significan los indicadores de las tarjetas?"
        className="w-7 h-7 rounded-lg border border-line flex items-center justify-center text-ink-400 hover:text-brand hover:border-brand/40 transition-colors shrink-0">
        <Icon name="help-circle" size={14}/>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={()=>setOpen(false)}/>
          <div className="absolute right-0 top-full mt-2 w-[290px] bg-white rounded-xl shadow-pop border border-line modal-enter z-40 overflow-hidden p-3.5">
            <div className="text-[11px] font-semibold text-ink-500 uppercase tracking-wide mb-2.5">Indicadores de la tarjeta</div>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300">🚩 Nd</span>
                <span className="text-[12px] text-ink-600 leading-snug">Se venció la <b>fecha límite de armado</b>: todavía no se envió el presupuesto y ya pasó el plazo interno objetivo.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">⏰ Nd</span>
                <span className="text-[12px] text-ink-600 leading-snug">Presupuesto <b>enviado</b> al cliente sin respuesta, pasó la fecha de seguimiento.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0"><Badge tone="red" dot>Nd</Badge></span>
                <span className="text-[12px] text-ink-600 leading-snug">Lleva <b>demasiado tiempo</b> en la etapa actual (más de lo esperado).</span>
              </div>
              {/* El semáforo es lo único que no calcula el sistema: lo marca el vendedor. */}
              <div className="pt-2.5 border-t border-line">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 flex items-center gap-0.5 pt-0.5">
                    {PRIORIDADES.map(p => <span key={p.id} className="w-1.5 h-4 rounded-sm" style={{ background:p.dot }}/>)}
                  </span>
                  <span className="text-[12px] text-ink-600 leading-snug">
                    <b>Semáforo de seguimiento</b>: pinta la tarjeta entera, con una barra del color sobre el borde izquierdo. Lo pone el vendedor a mano, no lo calcula el sistema:
                    {PRIORIDADES.map(p => (
                      <span key={p.id} className="block mt-1 rounded-md px-1.5 py-0.5"
                        style={{ background:p.wash, borderLeft:`3px solid ${p.dot}` }}>
                        <b>{p.label}</b> — {p.desc}.
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Quote filters toolbar ----------
function QuoteFiltersBar() {
  const { quoteFilters, setQuoteFilters, users, roleKey, currentUserId } = useApp();
  const [moreOpen, setMoreOpen] = useS(false);
  const active = countActiveFilters(quoteFilters);

  const sellerOptions = [
    { value:'', label:'Todos los vendedores', icon:'users' },
    { value:'UNASSIGNED', label:'Sin asignar', icon:'user-x' },
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
  const sortOptions = [
    { value:'recent',      label:'Más recientes', icon:'clock' },
    { value:'amount_desc', label:'Mayor monto',   icon:'arrow-down-wide-narrow' },
    { value:'amount_asc',  label:'Menor monto',   icon:'arrow-up-narrow-wide' },
  ];
  const activeSeller = users.find(u=>u.id===quoteFilters.seller);
  const me = users.find(u=>u.id===currentUserId);

  return (
    <>
      {roleKey === 'vendedor' ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium text-ink-700 bg-surface border border-line rounded-lg">
          <Icon name="user" size={13} className="text-ink-500"/>
          {me?.name?.split(' ')[0] || 'Mi vista'}
        </div>
      ) : (
        <PopoverButton icon="user"
          label={activeSeller ? activeSeller.name.split(' ')[0] : quoteFilters.seller === 'UNASSIGNED' ? 'Sin asignar' : 'Todos los vendedores'}
          value={quoteFilters.seller}
          active={!!quoteFilters.seller}
          onChange={(v)=>setQuoteFilters(s=>({...s, seller:v}))}
          onClear={()=>setQuoteFilters(s=>({...s, seller:''}))}
          options={sellerOptions}
        />
      )}
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
      <PopoverButton icon="arrow-down-wide-narrow"
        label={sortOptions.find(o=>o.value===(quoteFilters.sort||'recent'))?.label || 'Ordenar'}
        value={quoteFilters.sort || 'recent'}
        active={!!quoteFilters.sort && quoteFilters.sort !== 'recent'}
        onChange={(v)=>setQuoteFilters(s=>({...s, sort:v}))}
        onClear={()=>setQuoteFilters(s=>({...s, sort:'recent'}))}
        options={sortOptions}
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
      <BadgeLegendButton/>
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
  const filtered = sortQuotes(applyQuoteFilters(quotes, quoteFilters, clients), quoteFilters.sort);
  return (
    <KanbanBoard
      title="Cotizaciones"
      subtitle="De la solicitud a la nota de pedido"
      stages={STAGES_F1} items={filtered} kind="quote" onOpen={onOpen}
      actions={
        <>
          <QuoteFiltersBar/>
          <button className="btn-primary" onClick={()=>openModal('newQuote')}><Icon name="plus" size={14}/>Nuevo</button>
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
      title={logisticsMode ? 'Pedidos en operación' : 'Notas de Pedido'}
      subtitle="Fase 2 · de la nota de pedido al remito conformado"
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
