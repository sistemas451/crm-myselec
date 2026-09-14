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
// hidePeriod / hideSort: la vista detallada agrupa por antigüedad y ordena por
// su cuenta, así que esos dos controles ahí sobran y confundirían.
function QuoteFiltersBar({ hidePeriod, hideSort } = {}) {
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
      {!hidePeriod && <PopoverButton icon="calendar"
        label={periodOptions.find(p=>p.value===quoteFilters.period)?.label || 'Período'}
        value={quoteFilters.period}
        active={quoteFilters.period !== '30d'}
        onChange={(v)=>setQuoteFilters(s=>({...s, period:v}))}
        options={periodOptions}
      />}
      {!hideSort && <PopoverButton icon="arrow-down-wide-narrow"
        label={sortOptions.find(o=>o.value===(quoteFilters.sort||'recent'))?.label || 'Ordenar'}
        value={quoteFilters.sort || 'recent'}
        active={!!quoteFilters.sort && quoteFilters.sort !== 'recent'}
        onChange={(v)=>setQuoteFilters(s=>({...s, sort:v}))}
        onClear={()=>setQuoteFilters(s=>({...s, sort:'recent'}))}
        options={sortOptions}
      />}
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

// ---------- Vista detallada: una etapa a la vez, en lista ----------
// Secundaria al tablero, no lo reemplaza. Existe porque con 600+ tarjetas en
// "Presupuesto Enviado" la columna del tablero deja de servir para trabajar:
// acá se ve una etapa sola, un renglón por negocio, agrupada por antigüedad y
// con atajos para lo que hay que hacer hoy (seguimientos vencidos, etc.).
//
// Usa los mismos filtros que el tablero (vendedor, cliente, Más filtros) salvo
// el período: la agrupación por antigüedad ya cumple esa función, y con el
// período de 30 días del tablero quedarían afuera justo las que más atención
// necesitan.
const EDADES = [
  { id: '0-15',  label: 'Últimos 15 días', hasta: 15 },
  { id: '15-30', label: 'De 15 a 30 días', hasta: 30 },
  { id: '30-60', label: 'De 30 a 60 días', hasta: 60 },
  { id: '60+',   label: 'Más de 60 días',  hasta: Infinity },
];
const DIA_MS = 86400000;
const DETALLE_ETAPA_KEY = 'crm_vista_detallada_etapa';
const POR_GRUPO = 50;

// Un renglón por negocio, con la misma regla que el tablero: un documento del
// paquete se absorbe en el renglón del principal solo si está en su misma etapa.
function armarFilas(lista) {
  const principales = new Map();
  for (const q of lista) if (q.paquete && q.paquete.principal === q.id) principales.set(q.id, q);
  const miembros = new Map();
  const filas = [];
  for (const q of lista) {
    const p = q.paquete;
    const pr = p && p.principal !== q.id ? principales.get(p.principal) : null;
    if (pr && pr.stage === q.stage) {
      if (!miembros.has(pr.id)) miembros.set(pr.id, []);
      miembros.get(pr.id).push(q);
    } else {
      filas.push(q);
    }
  }
  const ahora = Date.now();
  return filas.map(q => {
    const docs = [q, ...(miembros.get(q.id) || [])];
    // Un miembro que quedó en otra etapa que su principal se muestra suelto,
    // igual que en el tablero: con su código y su monto, no los del paquete.
    const p = q.paquete && q.paquete.principal === q.id ? q.paquete : null;
    // Seguimiento: manda el del presupuesto; si no hay, el más próximo del grupo
    const pres = docs.find(d => d.mailType === 'PRESUPUESTO' && d.followUpDate);
    const fechas = docs.map(d => d.followUpDate).filter(Boolean).sort();
    const followUp = q.stage === 'enviado' ? (pres?.followUpDate || fechas[0] || null) : null;
    const seg = followUp ? Math.ceil((new Date(followUp) - ahora) / DIA_MS) : null;
    // Fecha límite de armado: misma condición que la tarjeta del tablero
    const sol = docs.find(d => d.mailType === 'SOLICITUD' && d.deadline && !d.linkedQuoteId
      && !['enviado', 'aceptada', 'rechazada'].includes(d.stage));
    const limite = sol ? Math.ceil((new Date(sol.deadline) - ahora) / DIA_MS) : null;
    // Monto: lo comprado si ya hay nota de pedido; si no, lo cotizado
    const nps = p?.notasPedido || [];
    let montos;
    if (nps.length && p.npTotales && Object.keys(p.npTotales).length) {
      montos = Object.entries(p.npTotales).map(([cur, v]) => ({ v, cur }));
    } else if (p?.presupuesto?.amount != null) {
      montos = [{ v: p.presupuesto.amount, cur: p.presupuesto.currency }];
    } else {
      montos = q.monto != null ? [{ v: q.monto, cur: q.currency || 'USD' }] : [];
    }
    const etiquetas = p
      ? [p.solicitud && { etq: 'SOL', code: p.solicitud.code },
         p.presupuesto && { etq: 'PRES', code: p.presupuesto.code },
         ...nps.map(n => ({ etq: 'NP', code: n.code }))].filter(Boolean)
      : [{ etq: { SOLICITUD: 'SOL', PRESUPUESTO: 'PRES', NOTA_PEDIDO: 'NP' }[q.mailType] || 'COT', code: q.code }];
    return {
      q, etiquetas, montos, followUp, seg, limite,
      edad: Math.max(0, Math.floor((ahora - new Date(q.ingreso)) / DIA_MS)),
      notas: docs.reduce((s, d) => s + (d.notas || 0), 0),
      adj:   docs.reduce((s, d) => s + (d.adj || 0), 0),
      sinPresupuesto: q.mailType === 'SOLICITUD' && !q.paquete?.presupuesto,
    };
  });
}

const ATAJOS = [
  { id: 'vencido',     label: 'Seguimiento vencido',       icon: 'alarm-clock',    test: f => f.seg != null && f.seg <= 0 },
  { id: 'semana',      label: 'Vence en 7 días',           icon: 'calendar-clock', test: f => f.seg != null && f.seg > 0 && f.seg <= 7 },
  { id: 'limite',      label: 'Fecha límite vencida',      icon: 'flag',           test: f => f.limite != null && f.limite <= 0 },
  { id: 'prioritaria', label: 'Prioritarias',              icon: 'star',           test: f => f.q.priority === 'alta' },
  { id: 'sinmarcar',   label: 'Sin semáforo',              icon: 'circle-dashed',  test: f => !f.q.priority },
  { id: 'sinpres',     label: 'Solicitud sin presupuesto', icon: 'file-question',  test: f => f.sinPresupuesto },
];

const ORDENES = [
  { value: 'seguimiento', label: 'Seguimiento más urgente', icon: 'alarm-clock' },
  { value: 'monto',       label: 'Mayor monto',             icon: 'arrow-down-wide-narrow' },
  { value: 'antiguas',    label: 'Más antiguas primero',    icon: 'history' },
  { value: 'recientes',   label: 'Más recientes primero',   icon: 'clock' },
];

function ordenarFilas(filas, orden) {
  const porEdad = (a, b) => b.edad - a.edad;
  const nulo = v => (v == null ? Infinity : v);
  const cmp = {
    // Sin fecha de seguimiento van al final; entre iguales, la más vieja primero
    seguimiento: (a, b) => (nulo(a.seg) - nulo(b.seg)) || (nulo(a.limite) - nulo(b.limite)) || porEdad(a, b),
    // Dólares y pesos no se comparan entre sí: primero dólares, después pesos
    monto: (a, b) => {
      const ma = a.montos[0], mb = b.montos[0];
      if (!ma || !mb) return ma ? -1 : mb ? 1 : porEdad(a, b);
      if ((ma.cur === 'ARS') !== (mb.cur === 'ARS')) return ma.cur === 'ARS' ? 1 : -1;
      return mb.v - ma.v;
    },
    antiguas:  porEdad,
    recientes: (a, b) => a.edad - b.edad,
  }[orden] || porEdad;
  // Infinity - Infinity da NaN: se normaliza a 0 para que el sort no se rompa
  return [...filas].sort((a, b) => cmp(a, b) || 0);
}

function totalesPorMoneda(filas) {
  const t = {};
  for (const f of filas) for (const m of f.montos) {
    const cur = m.cur || 'USD';
    t[cur] = (t[cur] || 0) + (m.v || 0);
  }
  return Object.entries(t).sort(([a], [b]) => (a === 'ARS') - (b === 'ARS'));
}

function CeldaSeguimiento({ f }) {
  const { q } = f;
  if (f.limite != null) {
    const vencida = f.limite <= 0;
    return (
      <span className={cx('inline-flex items-center gap-1 text-[11.5px] font-semibold', vencida ? 'text-red-700' : f.limite <= 1 ? 'text-amber-600' : 'text-ink-500')}
        title="Fecha límite para armar el presupuesto">
        <Icon name="flag" size={12}/>{vencida ? `Límite vencido hace ${-f.limite}d` : `Límite en ${f.limite}d`}
      </span>
    );
  }
  if (f.seg != null) {
    const vencido = f.seg <= 0;
    return (
      <span className={cx('inline-flex items-center gap-1 text-[11.5px] font-semibold', vencido ? 'text-amber-700' : f.seg <= 7 ? 'text-ink-700' : 'text-ink-400')}
        title={`Seguimiento: ${fmtDate(f.followUp)}`}>
        <Icon name="alarm-clock" size={12}/>
        {vencido ? (f.seg === 0 ? 'Vence hoy' : `Vencido hace ${-f.seg}d`) : `En ${f.seg}d`}
      </span>
    );
  }
  if (q.stage === 'aceptada' && q.mailType === 'PRESUPUESTO' && !(q.npFlexxus || q.npCode)) {
    return <span className="text-[11.5px] font-semibold text-amber-700">Sin nota de pedido</span>;
  }
  if (q.stage === 'rechazada' && q.rejectReason) {
    return <span className="text-[11.5px] text-bad truncate block max-w-[180px]" title={q.rejectReason}>{q.rejectReason}</span>;
  }
  return <span className="text-[11.5px] text-ink-300">—</span>;
}

function FilaNegocio({ f, onOpen }) {
  const { clients, allUsers } = useApp();
  const { q } = f;
  const cli = clients.find(c => c.code === q.client);
  const sel = allUsers.find(u => u.id === q.seller);
  const prio = prioridadDe(q.priority);
  const nombre = cli?.name || q.clientName || q.emailSubject || 'Sin cliente asignado';
  const lugar  = cli ? [cli.city, cli.prov].filter(Boolean).join(', ') : '';
  return (
    <tr onClick={() => onOpen(q.code)} className="cursor-pointer border-t border-line/70 hover:bg-brandSoft/30 transition-colors">
      <td className="pl-3 pr-3 py-2.5 align-top">
        <div className="flex gap-3">
          <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: prio ? prio.dot : 'transparent' }}
            title={prio ? prio.label : 'Sin semáforo'}/>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink-900 truncate max-w-[340px]" title={nombre}>{nombre}</div>
            <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
              {f.etiquetas.map(e => (
                <span key={e.code} className="inline-flex items-baseline gap-1">
                  <span className="text-[9.5px] font-semibold tracking-wide text-ink-400">{e.etq}</span>
                  <span className="mono text-[11px] text-ink-600">{e.code}</span>
                </span>
              ))}
              {q.revision?.nro > 1 && (
                <span className="text-[10px] font-semibold px-1.5 rounded-full bg-surface text-ink-600 border border-line">R{q.revision.nro}</span>
              )}
              {lugar && <span className="text-[11px] text-ink-400 truncate">· {lugar}</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap">
        {sel ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={sel.name} size={20}/>
            <span className="text-[12px] text-ink-700">{sel.name.split(' ')[0]}</span>
          </div>
        ) : <span className="text-[12px] text-ink-400">Sin asignar</span>}
      </td>
      <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
        {f.montos.length ? f.montos.map((m, i) => (
          <div key={m.cur} className={cx('mono', i === 0 ? 'text-[13px] font-bold text-ink-900' : 'text-[11px] font-semibold text-ink-600')}>
            {fmtMoney(m.v, m.cur)}
          </div>
        )) : <span className="text-[12px] text-ink-300">—</span>}
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap">
        <div className="text-[12px] font-semibold text-ink-700">{f.edad}d</div>
        <div className="text-[11px] text-ink-400">{fmtDate(q.ingreso)}</div>
      </td>
      <td className="px-3 py-2.5 align-top whitespace-nowrap"><CeldaSeguimiento f={f}/></td>
      <td className="pl-3 pr-4 py-2.5 align-top whitespace-nowrap text-[11px] text-ink-500">
        <div className="flex items-center justify-end gap-2">
          {f.adj > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="paperclip" size={11}/>{f.adj}</span>}
          {f.notas > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="message-square" size={11}/>{f.notas}</span>}
        </div>
      </td>
    </tr>
  );
}

function QuotesByStage({ onOpen }) {
  const { quotes, clients, quoteFilters, openModal } = useApp();
  const [etapa, setEtapaRaw] = useS(() => { try { return localStorage.getItem(DETALLE_ETAPA_KEY) || 'enviado'; } catch { return 'enviado'; } });
  const [atajo, setAtajo]   = useS('');
  const [orden, setOrden]   = useS('seguimiento');
  const [plegados, setPlegados]   = useS({});
  const [completos, setCompletos] = useS({});
  const setEtapa = (id) => {
    setEtapaRaw(id); setAtajo(''); setCompletos({});
    try { localStorage.setItem(DETALLE_ETAPA_KEY, id); } catch {}
  };

  const filas = React.useMemo(
    () => armarFilas(applyQuoteFilters(quotes, { ...quoteFilters, period: '' }, clients)),
    [quotes, quoteFilters, clients]
  );
  const porEtapa = {};
  for (const f of filas) (porEtapa[f.q.stage] = porEtapa[f.q.stage] || []).push(f);

  const etapas = STAGES_F1;
  const actual = etapas.find(s => s.id === etapa) || etapas[0];
  const deEtapa = porEtapa[actual?.id] || [];
  const atajos = ATAJOS.map(a => ({ ...a, n: deEtapa.filter(a.test).length })).filter(a => a.n > 0 || a.id === atajo);
  const def = ATAJOS.find(a => a.id === atajo);
  const visibles = ordenarFilas(def ? deEtapa.filter(def.test) : deEtapa, orden);
  const grupos = EDADES.map((g, i) => ({
    ...g, filas: visibles.filter(f => f.edad >= (i ? EDADES[i - 1].hasta : 0) && f.edad < g.hasta),
  }));
  const totales = totalesPorMoneda(visibles);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <div className="px-6 pt-5 pb-4 flex items-end justify-between gap-4 flex-wrap border-b border-line bg-white page-head">
        <div>
          <div className="page-head-sub">Cotizaciones · una etapa a la vez, todas las fechas</div>
          <h2 className="page-head-title mt-0.5">Vista detallada</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <QuoteFiltersBar hidePeriod hideSort/>
          <button className="btn-primary" onClick={() => openModal('newQuote')}><Icon name="plus" size={14}/>Nuevo</button>
        </div>
      </div>

      {/* Etapas */}
      <div className="bg-white border-b border-line px-6 overflow-x-auto scroll-thin">
        <div className="flex gap-1 min-w-max">
          {etapas.map(st => {
            const n = (porEtapa[st.id] || []).length;
            const on = st.id === actual?.id;
            return (
              <button key={st.id} onClick={() => setEtapa(st.id)}
                className={cx('flex items-center gap-2 px-3 py-2.5 text-[12.5px] border-b-2 -mb-px transition-colors whitespace-nowrap',
                  on ? 'border-brand text-navy-900 font-semibold' : 'border-transparent text-ink-500 hover:text-ink-900')}>
                <StageDot tone={st.tone}/>{st.label}
                <span className={cx('text-[11px] font-semibold rounded-md px-1.5 py-0.5 border',
                  on ? 'bg-brandSoft text-brand border-brand/25' : 'bg-surface text-ink-500 border-line')}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin bg-surface px-6 py-4">
        {/* Atajos + orden */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {atajos.map(a => (
            <button key={a.id} onClick={() => setAtajo(atajo === a.id ? '' : a.id)}
              className={cx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] border transition-colors',
                atajo === a.id ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-ink-700 border-line hover:border-brand/40')}>
              <Icon name={a.icon} size={12}/>{a.label}
              <span className={cx('text-[11px] font-semibold', atajo === a.id ? 'text-white/80' : 'text-ink-400')}>{a.n}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <span className="text-[12px] text-ink-500">
              {visibles.length} {visibles.length === 1 ? 'negocio' : 'negocios'}
              {totales.map(([cur, v]) => <span key={cur} className="mono font-semibold text-ink-700"> · {fmtMoney(v, cur)}</span>)}
            </span>
            <PopoverButton icon="arrow-down-wide-narrow"
              label={ORDENES.find(o => o.value === orden)?.label}
              value={orden} active={orden !== 'seguimiento'}
              onChange={setOrden} onClear={() => setOrden('seguimiento')}
              options={ORDENES}/>
          </div>
        </div>

        {visibles.length === 0 ? (
          <div className="bg-white border border-line rounded-xl p-2"><EmptyCol/></div>
        ) : grupos.filter(g => g.filas.length).map(g => {
          const plegado = !!plegados[g.id];
          const mostradas = completos[g.id] ? g.filas : g.filas.slice(0, POR_GRUPO);
          return (
            <div key={g.id} className="bg-white border border-line rounded-xl shadow-xs mb-3 overflow-hidden">
              <button onClick={() => setPlegados(s => ({ ...s, [g.id]: !plegado }))}
                className="w-full flex items-center gap-2 flex-wrap px-4 py-2.5 text-left hover:bg-surface/60">
                <Icon name={plegado ? 'chevron-right' : 'chevron-down'} size={14} className="text-ink-400"/>
                <span className="text-[12.5px] font-semibold text-ink-900">{g.label}</span>
                <span className="text-[11px] font-semibold text-ink-500 bg-surface border border-line rounded-md px-1.5 py-0.5">{g.filas.length}</span>
                <span className="ml-auto text-[11.5px] text-ink-500">
                  {totalesPorMoneda(g.filas).map(([cur, v], i) => <span key={cur} className="mono">{i ? ' · ' : ''}{fmtMoney(v, cur)}</span>)}
                </span>
              </button>
              {!plegado && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr className="text-[10.5px] uppercase tracking-wide text-ink-400 text-left">
                        <th className="pl-7 pr-3 py-1.5 font-semibold">Cliente y documentos</th>
                        <th className="px-3 py-1.5 font-semibold">Vendedor</th>
                        <th className="px-3 py-1.5 font-semibold text-right">Monto</th>
                        <th className="px-3 py-1.5 font-semibold">Antigüedad</th>
                        <th className="px-3 py-1.5 font-semibold">Seguimiento</th>
                        <th className="pl-3 pr-4 py-1.5"/>
                      </tr>
                    </thead>
                    <tbody>
                      {mostradas.map(f => <FilaNegocio key={f.q.id} f={f} onOpen={onOpen}/>)}
                    </tbody>
                  </table>
                  {g.filas.length > mostradas.length && (
                    <button onClick={() => setCompletos(s => ({ ...s, [g.id]: true }))}
                      className="w-full py-2 text-[12px] font-semibold text-brand border-t border-line hover:bg-brandSoft/30">
                      Mostrar {g.filas.length - mostradas.length} más
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

Object.assign(window, { KanbanQuotes, QuotesByStage, KanbanOrders, StageDot, STAGE_DOT });
