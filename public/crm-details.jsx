/* Detail drawers for quotes & orders */

function Drawer({ onClose, title, subtitle, headerExtras, children, footer, width=900 }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-ink-900/40 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="bg-white shadow-pop modal-enter flex flex-col" style={{ width }}>
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{subtitle}</div>
            <h3 className="text-lg font-bold text-ink-900 mt-0.5 truncate">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {headerExtras}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500"><Icon name="x" size={16}/></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-6 py-3 border-t border-line bg-surface flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

function StagePipeline({ stages, currentId }) {
  const currentIdx = stages.findIndex(s => s.id === currentId);
  return (
    <div className="flex items-stretch w-full rounded-lg overflow-hidden border border-line">
      {stages.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const tone = s.tone;
        return (
          <div key={s.id} className={cx(
            'flex-1 px-3 py-2 flex items-center gap-2 border-r border-line last:border-r-0 text-[11.5px]',
            active ? 'bg-white' : done ? 'bg-surface' : 'bg-white/60'
          )}>
            <span className={cx('w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold',
              active ? 'text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-300/40 text-ink-500'
            )} style={active ? {background: STAGE_DOT[tone]} : undefined}>
              {done ? '✓' : i+1}
            </span>
            <span className={cx('font-medium truncate', active ? 'text-ink-900' : done ? 'text-ink-700' : 'text-ink-500')}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value, mono=false, children }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-500">{label}</div>
      <div className={cx('text-[13px] text-ink-900 mt-1', mono && 'mono')}>{children || value || '—'}</div>
    </div>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-line px-6">
      {tabs.map(t => (
        <button key={t.id} onClick={()=>onChange(t.id)} className={cx(
          'px-3 py-2.5 text-[13px] font-medium border-b-2 -mb-px',
          active===t.id ? 'border-brand text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900'
        )}>
          {t.label} {t.count != null && <span className="ml-1 text-[11px] text-ink-400 font-semibold">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function QuoteDetail({ code, onClose, canReassign }) {
  const { quotes, clients, users, moveQuoteStage, setQuotes, pushToast, closeModal } = useApp();
  const q = quotes.find(x => x.code === code);
  if (!q) return null;
  const cli = clients.find(c=>c.code===q.client);
  const sel = users.find(u=>u.id===q.seller);
  const stg = STAGES_F1.find(s=>s.id===q.stage);
  const [tab, setTab] = useState('resumen');
  const [stageOpen, setStageOpen] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const handleQuoteStage = (stageId) => {
    setStageOpen(false);
    if (stageId === 'rechazada') {
      setRejectPending(true);
    } else {
      moveQuoteStage(q.code, stageId);
    }
  };

  const submitReject = async () => {
    if (!rejectReason) return;
    try {
      await CrmApi.changeQuoteStage(q.id, 'rechazada', { rejectReason, rejectNotes });
      const fresh = await CrmApi.getQuotes();
      setQuotes(fresh);
      pushToast('Cotización marcada como rechazada');
      setRejectPending(false);
      setRejectReason('');
      setRejectNotes('');
    } catch (err) {
      pushToast(err.message || 'Error al rechazar', 'bad');
    }
  };

  useEffect(() => {
    setNotesLoading(true);
    CrmApi.getQuoteDetail(q.id)
      .then(detail => { setNotes(detail.notes || []); setNotesLoading(false); })
      .catch(() => setNotesLoading(false));
  }, [q.id]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const nota = await CrmApi.addQuoteNote(q.id, newNote.trim());
      setNotes(ns => [...ns, nota]);
      setNewNote('');
      setQuotes(qs => qs.map(x => x.id === q.id ? {...x, notas: (x.notas||0)+1} : x));
    } catch (err) {
      pushToast(err.message || 'Error al guardar nota', 'bad');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`¿Eliminar la cotización ${q.code}? Esta acción no se puede deshacer.`)) return;
    try {
      await CrmApi.deleteQuote(q.id);
      setQuotes(qs => qs.filter(x => x.id !== q.id));
      pushToast('Cotización eliminada');
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al eliminar', 'bad');
    }
  };

  const items = [
    { sku:'LME-25/4',    desc:'Cable subterráneo Synthenax 4x25 mm² — bobina 100m', qty:3, pu:980,  pt:2940 },
    { sku:'TAB-PV400',   desc:'Tablero de transferencia automática PV-400 3F+N',    qty:1, pu:8900, pt:8900 },
    { sku:'IEC-C16',     desc:'Interruptor termomagnético IEC C16 3P',               qty:12,pu:64,   pt:768 },
    { sku:'MED-TRF-50',  desc:'Medidor trifásico clase 0.5S — 50/5A',                qty:4, pu:1320, pt:5280 },
    { sku:'BR-CU16',     desc:'Barra de cobre 16mm² — m',                            qty:80,pu:11,   pt:880 },
  ];
  const subtotal = items.reduce((a,b)=>a+b.pt,0);
  const iva = Math.round(subtotal*0.21);
  const total = subtotal + iva;

  const attachments = [
    { name:'solicitud-cliente-argencraft.pdf',  kind:'pdf',   size:'412 KB', by:'Luciano', at:'2026-04-20' },
    { name:'planilla-tecnica-v2.xlsx',          kind:'xlsx',  size:'86 KB',  by:'Luciano', at:'2026-04-21' },
    { name:'presupuesto-COT-2026-041.pdf',      kind:'pdf',   size:'221 KB', by:'Luciano', at:'2026-04-22' },
    { name:'lista-precios-prov-abril.pdf',      kind:'pdf',   size:'1.1 MB', by:'Luciano', at:'2026-04-21' },
  ];
  const history = [
    { stage:'recibida',  at:'2026-04-20 09:12', by:'Sistema',  note:'Mail de solicitud ingresado desde ventas@myselec.com.ar' },
    { stage:'asignada',  at:'2026-04-20 10:15', by:'Victoria', note:'Asignada a Luciano · zona AMBA Norte' },
    { stage:'armado',    at:'2026-04-20 11:02', by:'Luciano',  note:'Tomé el pedido, analizando lista de materiales' },
    { stage:'proveedor', at:'2026-04-20 15:40', by:'Luciano',  note:'Pedido precios a Prysmian y Trefilcon' },
    { stage:'oferta',    at:'2026-04-21 14:55', by:'Luciano',  note:'Oferta técnica definida, ajustando margen' },
    { stage:'enviado',   at:'2026-04-22 16:18', by:'Luciano',  note:'Presupuesto enviado por mail al cliente' },
  ];

  return (
    <>
    <Drawer onClose={onClose}
      subtitle={`Fase 1 · Cotización · ${stg.label}`}
      title={`${code} — ${cli.name}`}
      width={960}
      headerExtras={
        <div className="flex items-center gap-2">
          {CrmAuth.getUser()?.role === 'ADMIN' && (
            <button className="btn-ghost text-bad border-red-200 hover:bg-red-50" onClick={handleDelete}>
              <Icon name="trash-2" size={13}/>Eliminar
            </button>
          )}
          <Badge tone={stg.tone} dot>{stg.label}</Badge>
          <button className="btn-ghost"><Icon name="download" size={13}/>PDF</button>
          {canReassign && (
            <div className="relative">
              <button className="btn-primary" onClick={()=>setStageOpen(o=>!o)}>
                <Icon name="arrow-right" size={13}/>Mover etapa
              </button>
              {stageOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={()=>setStageOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-pop border border-line z-20 overflow-hidden">
                    {STAGES_F1.filter(s=>s.id!==q.stage).map(s=>(
                      <button key={s.id} onClick={()=>handleQuoteStage(s.id)}
                        className="w-full text-left px-3 py-2.5 text-[13px] hover:bg-surface flex items-center gap-2 border-b border-line last:border-b-0">
                        <StageDot tone={s.tone}/>{s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      }
      footer={
        <>
          <button className="btn-ghost"><Icon name="message-square" size={13}/>Agregar nota</button>
          <button className="btn-ghost"><Icon name="paperclip" size={13}/>Adjuntar</button>
          <div className="flex-1"/>
          <button className="btn-ghost text-bad border-red-200 hover:bg-red-50">Marcar rechazada</button>
          <button className="btn-accent"><Icon name="check" size={14}/>Marcar aceptada</button>
        </>
      }
    >
      {/* Pipeline strip */}
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F1} currentId={q.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label="Cliente" value={cli.name}/>
          <Field label="CUIT" mono value={cli.cuit}/>
          <Field label="Vendedor">
            <div className="flex items-center gap-2"><Avatar name={sel.name} size={20}/>{sel.name}</div>
          </Field>
          <Field label="Ingreso">
            <span className="mono">{fmtDate(q.ingreso)} <span className="text-ink-500">· hace {q.dias}d</span></span>
          </Field>
          <Field label="Monto cotizado" mono value={fmtMoney(q.monto)}/>
          <Field label="Cod. Flexxus NP" mono value={q.flexxus || '—'}/>
          <Field label="Zona de entrega" value={cli.zone}/>
          <Field label="Contacto"><div className="text-[12.5px]">{cli.email}</div></Field>
        </div>
      </div>

      {q.source === 'EMAIL' && q.emailSubject && (
        <div className="mx-6 mb-4 px-4 py-3 bg-surface border border-line rounded-xl flex items-start gap-3">
          <Icon name="mail" size={15} className="mt-0.5 text-ink-500 shrink-0"/>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold text-ink-700 mb-0.5">Solicitud recibida por mail</div>
            <div className="text-[12.5px] text-ink-900 truncate"><span className="text-ink-500">Asunto:</span> {q.emailSubject}</div>
            <div className="text-[12px] text-ink-500 truncate"><span>De:</span> {q.emailFrom}</div>
          </div>
        </div>
      )}

      <TabBar active={tab} onChange={setTab} tabs={[
        { id:'resumen',  label:'Resumen' },
        { id:'items',    label:'Ítems', count: items.length },
        { id:'adj',      label:'Adjuntos', count: attachments.length },
        { id:'historial',label:'Historial' },
        { id:'notas',    label:'Notas', count: notes.length },
      ]}/>

      {tab === 'resumen' && (
        <div className="p-6 grid grid-cols-3 gap-5">
          <div className="col-span-2 bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-3 text-ink-900">Presupuesto</div>
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-ink-500">
                <th className="font-semibold pb-2">SKU</th><th className="font-semibold pb-2">Descripción</th>
                <th className="font-semibold pb-2 text-right">Cant.</th>
                <th className="font-semibold pb-2 text-right">P. Unit.</th>
                <th className="font-semibold pb-2 text-right">Total</th>
              </tr></thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.sku} className="border-t border-line">
                    <td className="py-2 mono text-ink-700">{it.sku}</td>
                    <td className="py-2">{it.desc}</td>
                    <td className="py-2 mono text-right">{it.qty}</td>
                    <td className="py-2 mono text-right">{it.pu.toLocaleString('es-AR')}</td>
                    <td className="py-2 mono text-right font-semibold">{it.pt.toLocaleString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-900"><td colSpan="4" className="text-right pt-3 text-ink-500">Subtotal</td><td className="text-right pt-3 mono font-semibold">{subtotal.toLocaleString('es-AR')}</td></tr>
                <tr><td colSpan="4" className="text-right pt-1 text-ink-500">IVA 21%</td><td className="text-right pt-1 mono">{iva.toLocaleString('es-AR')}</td></tr>
                <tr><td colSpan="4" className="text-right pt-1 font-bold">TOTAL (USD)</td><td className="text-right pt-1 mono font-bold text-base">{total.toLocaleString('es-AR')}</td></tr>
              </tfoot>
            </table>
          </div>

          <div className="space-y-4">
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Próxima acción</div>
              <div className="text-sm text-ink-900 leading-snug">Esperar confirmación del cliente — seguimiento pactado viernes 26.</div>
              <div className="mt-3 flex gap-2">
                <button className="btn-ghost text-xs"><Icon name="phone" size={12}/>Llamar</button>
                <button className="btn-ghost text-xs"><Icon name="mail" size={12}/>Email</button>
              </div>
            </div>
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Plazos</div>
              <ul className="text-[12.5px] space-y-1.5">
                <li className="flex justify-between"><span className="text-ink-500">Validez oferta</span><span className="mono">15 días</span></li>
                <li className="flex justify-between"><span className="text-ink-500">Forma de pago</span><span>30 días FF</span></li>
                <li className="flex justify-between"><span className="text-ink-500">Entrega</span><span>15-20 días</span></li>
                <li className="flex justify-between"><span className="text-ink-500">Incoterm</span><span>DDP AMBA</span></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === 'items' && (
        <div className="p-6">
          <table className="tbl w-full bg-white border border-line rounded-xl overflow-hidden">
            <thead><tr>
              <th>SKU</th><th>Descripción</th><th className="!text-right">Cant.</th><th className="!text-right">P. Unit.</th><th className="!text-right">Total</th>
            </tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.sku}>
                  <td className="mono">{it.sku}</td><td>{it.desc}</td>
                  <td className="mono text-right">{it.qty}</td>
                  <td className="mono text-right">{it.pu.toLocaleString('es-AR')}</td>
                  <td className="mono text-right font-semibold">{it.pt.toLocaleString('es-AR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'adj' && (
        <div className="p-6 grid grid-cols-2 gap-3">
          {attachments.map(a => (
            <div key={a.name} className="bg-white border border-line rounded-xl p-3 flex items-center gap-3">
              <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[11px]',
                a.kind==='pdf' ? 'bg-red-500' : 'bg-emerald-600')}>{a.kind.toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink-900 truncate">{a.name}</div>
                <div className="text-[11px] text-ink-500">{a.size} · subido por {a.by} · {fmtDate(a.at)}</div>
              </div>
              <button className="w-8 h-8 rounded-lg hover:bg-surface text-ink-500"><Icon name="download" size={14}/></button>
            </div>
          ))}
          <button className="col-span-2 py-6 border-2 border-dashed border-line rounded-xl text-ink-500 hover:bg-surface">
            <Icon name="plus" size={14} className="inline mr-1"/> Subir adjunto
          </button>
        </div>
      )}

      {tab === 'historial' && (
        <div className="p-6">
          <div className="space-y-3">
            {history.map((h, i) => {
              const st = STAGES_F1.find(s=>s.id===h.stage);
              return (
                <div key={i} className="relative pl-8 stepline">
                  <span className="absolute left-1 top-1 w-4 h-4 rounded-full border-2 bg-white" style={{borderColor: STAGE_DOT[st.tone]}}/>
                  <div className="bg-white border border-line rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={st.tone} dot>{st.label}</Badge>
                      <span className="text-[11px] text-ink-500 mono">{h.at}</span>
                      <span className="text-[11px] text-ink-500">· por {h.by}</span>
                    </div>
                    <div className="text-[13px] text-ink-700 mt-1.5">{h.note}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'notas' && (
        <div className="p-6 space-y-3">
          {notesLoading ? (
            <div className="text-[13px] text-ink-400 py-4 text-center">Cargando notas…</div>
          ) : notes.map((n, i) => (
            <div key={n.id || i} className="bg-white border border-line rounded-xl p-3 flex gap-3">
              <Avatar name={n.user?.name || '?'} size={32}/>
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-[13px] text-ink-900">{n.user?.name}</span>
                  <span className="text-[11px] text-ink-500 mono">{fmtDateTime(n.createdAt)}</span>
                </div>
                <p className="text-[13px] text-ink-700 mt-1 leading-snug">{n.text}</p>
              </div>
            </div>
          ))}
          <div className="bg-white border border-line rounded-xl p-3">
            <textarea rows="3" value={newNote} onChange={e=>setNewNote(e.target.value)}
              className="w-full outline-none text-[13px] placeholder:text-ink-400 resize-none" placeholder="Escribir una nota para el equipo…"/>
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <div className="flex gap-1.5 text-ink-500">
                <button className="w-7 h-7 rounded hover:bg-surface"><Icon name="paperclip" size={13}/></button>
                <button className="w-7 h-7 rounded hover:bg-surface"><Icon name="at-sign" size={13}/></button>
              </div>
              <button className="btn-primary text-xs py-1.5" onClick={handleAddNote}
                disabled={savingNote || !newNote.trim()}
                style={savingNote || !newNote.trim() ? {opacity:.45,cursor:'not-allowed'} : {}}>
                {savingNote ? 'Guardando…' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
    {rejectPending && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-ink-900/40" onClick={()=>setRejectPending(false)}/>
        <div className="relative bg-white rounded-xl shadow-pop p-5 w-[380px]">
          <div className="text-sm font-semibold mb-3">Motivo de rechazo</div>
          <select value={rejectReason} onChange={e=>setRejectReason(e.target.value)} className="inp w-full mb-3">
            <option value="">Seleccionar motivo…</option>
            {REJECT_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
          <textarea rows="3" value={rejectNotes} onChange={e=>setRejectNotes(e.target.value)}
            className="inp w-full resize-none mb-3" placeholder="Observaciones opcionales…"/>
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost" onClick={()=>setRejectPending(false)}>Cancelar</button>
            <button className="btn-ghost text-bad border-red-200 hover:bg-red-50"
              disabled={!rejectReason} onClick={submitReject}
              style={!rejectReason?{opacity:.45,cursor:'not-allowed'}:{}}>
              Marcar rechazada
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function OrderDetail({ code, onClose, canReassign }) {
  const { orders, clients, users, moveOrderStage } = useApp();
  const o = orders.find(x=>x.code===code);
  if (!o) return null;
  const cli = clients.find(c=>c.code===o.client);
  const sel = users.find(u=>u.id===o.seller);
  const stg = STAGES_F2.find(s=>s.id===o.stage);
  const [stageOpen, setStageOpen] = useState(false);

  const history = [
    { stage:'oc',        at:'2026-04-19 11:20', by:'Luciano',  note:'OC del cliente recibida por mail — PDF adjunto' },
    { stage:'np',        at:'2026-04-19 14:02', by:'Luciano',  note:`Nota de Pedido ${o.flexxus} cargada en Flexxus` },
    { stage:'stock',     at:'2026-04-20 09:30', by:'Mariela',  note:'Verificación de stock: 80% disponible en depósito central' },
    { stage:'proveedor', at:'2026-04-20 11:15', by:'Mariela',  note:'Pedido de reposición enviado a Prysmian — ETA 4 días' },
    { stage:'armado',    at:'2026-04-22 15:40', by:'Mariela',  note:'Pedido armado y verificado. Listo para facturación' },
  ];

  return (
    <Drawer onClose={onClose}
      subtitle={`Fase 2 · Orden de Compra · ${stg.label}`}
      title={`${code} — ${cli.name}`}
      width={960}
      headerExtras={
        <div className="flex items-center gap-2">
          <Badge tone={stg.tone} dot>{stg.label}</Badge>
          <button className="btn-ghost"><Icon name="file-text" size={13}/>Remito</button>
          {canReassign && (
            <div className="relative">
              <button className="btn-primary" onClick={()=>setStageOpen(o=>!o)}>
                <Icon name="arrow-right" size={13}/>Mover etapa
              </button>
              {stageOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={()=>setStageOpen(false)}/>
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-pop border border-line z-20 overflow-hidden">
                    {STAGES_F2.filter(s=>s.id!==o.stage).map(s=>(
                      <button key={s.id} onClick={()=>{ moveOrderStage(o.code, s.id); setStageOpen(false); }}
                        className="w-full text-left px-3 py-2.5 text-[13px] hover:bg-surface flex items-center gap-2 border-b border-line last:border-b-0">
                        <StageDot tone={s.tone}/>{s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      }
      footer={
        <>
          <button className="btn-ghost"><Icon name="message-square" size={13}/>Nota</button>
          <button className="btn-ghost"><Icon name="paperclip" size={13}/>Adjuntar</button>
          <div className="flex-1"/>
          <button className="btn-accent"><Icon name="check" size={14}/>Confirmar entrega</button>
        </>
      }
    >
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F2} currentId={o.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label="Cliente" value={cli.name}/>
          <Field label="Vendedor">
            <div className="flex items-center gap-2"><Avatar name={sel.name} size={20}/>{sel.name}</div>
          </Field>
          <Field label="Nota Pedido" mono value={o.flexxus}/>
          <Field label="De cotización" mono value={o.fromQuote}/>
          <Field label="Zona entrega" value={o.entrega}/>
          <Field label="Transportista" value={o.transp}/>
          <Field label="Guía / Remito" mono value={o.guia || '—'}/>
          <Field label="Fecha OC" mono value={fmtDate(o.fecha)}/>
        </div>
      </div>

      <div className="p-6 grid grid-cols-5 gap-4">
        <div className="col-span-3 bg-white border border-line rounded-xl p-5">
          <div className="text-sm font-semibold mb-3">Historial de estado</div>
          <div className="space-y-3">
            {history.map((h, i) => {
              const st = STAGES_F2.find(s=>s.id===h.stage);
              return (
                <div key={i} className="relative pl-8 stepline">
                  <span className="absolute left-1 top-1 w-4 h-4 rounded-full border-2 bg-white" style={{borderColor: STAGE_DOT[st.tone]}}/>
                  <div className="flex items-center gap-2">
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                    <span className="text-[11px] text-ink-500 mono">{h.at}</span>
                    <span className="text-[11px] text-ink-500">· {h.by}</span>
                  </div>
                  <div className="text-[13px] text-ink-700 mt-1">{h.note}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="col-span-2 space-y-4">
          <div className="bg-white border border-line rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Checklist de entrega</div>
            <ul className="text-[12.5px] space-y-1.5">
              {[
                ['OC del cliente recibida', true],
                ['NP cargada en Flexxus',  true],
                ['Stock verificado',        true],
                ['Factura emitida',         o.stage==='facturada'||o.stage==='transito'||o.stage==='entregada'],
                ['Remito conformado',       o.stage==='entregada'],
              ].map(([l,done])=>(
                <li key={l} className="flex items-center gap-2">
                  <span className={cx('w-4 h-4 rounded-full inline-flex items-center justify-center',
                    done ? 'bg-emerald-500 text-white' : 'bg-ink-300/50')}>
                    {done && <Icon name="check" size={10}/>}
                  </span>
                  <span className={done ? 'text-ink-900' : 'text-ink-500'}>{l}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white border border-line rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Dirección de entrega</div>
            <div className="text-[13px] text-ink-900">{cli.address}</div>
            <div className="text-[12px] text-ink-500 mt-0.5">{cli.city} — {cli.prov}</div>
            <div className="mt-3 pt-3 border-t border-line text-[12px] space-y-1">
              <div className="flex justify-between"><span className="text-ink-500">Contacto</span><span>Juan M. Rivas</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Tel.</span><span className="mono">{cli.phone}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Horario</span><span>L-V 08-17hs</span></div>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

Object.assign(window, { QuoteDetail, OrderDetail, Drawer, Field, StagePipeline, TabBar });
