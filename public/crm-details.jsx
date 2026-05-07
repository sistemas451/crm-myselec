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

// ── Tab Ítems completo (PRESUPUESTO: vista, OC: checklist editable) ──────
function OCItemsTab({ q, detailItems, setDetailItems }) {
  const { pushToast } = useApp();
  const isOC = q.mailType === 'OC';

  // Estado para fila de edición inline
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState({});

  // Estado para nueva fila
  const [addingNew, setAddingNew] = useState(false);
  const [newItem, setNewItem] = useState({ sku: '', description: '', quantity: 1, unitPrice: '' });

  const toggleChecked = async (it) => {
    const newVal = !it.checked;
    setDetailItems(prev => prev.map(i => i.id === it.id ? {...i, checked: newVal} : i));
    try {
      await CrmApi.updateQuoteItem(q.id, it.id, { checked: newVal });
    } catch {
      setDetailItems(prev => prev.map(i => i.id === it.id ? {...i, checked: !newVal} : i));
    }
  };

  const startEdit = (it) => {
    setEditingId(it.id);
    setEditVal({ sku: it.sku || '', description: it.description, quantity: it.quantity, unitPrice: it.unitPrice ?? '' });
  };

  const saveEdit = async (it) => {
    const data = {
      sku:         editVal.sku || null,
      description: editVal.description || it.description,
      quantity:    parseFloat(editVal.quantity) || 1,
      unitPrice:   editVal.unitPrice !== '' ? parseFloat(editVal.unitPrice) : null,
    };
    const total = data.unitPrice != null ? data.unitPrice * data.quantity : it.total;
    setDetailItems(prev => prev.map(i => i.id === it.id ? {...i, ...data, total} : i));
    setEditingId(null);
    try {
      await CrmApi.updateQuoteItem(q.id, it.id, data);
    } catch (err) {
      pushToast(err.message || 'Error al guardar', 'bad');
    }
  };

  const deleteItem = async (it) => {
    if (!window.confirm(`¿Eliminar "${it.description}"? Esta acción no se puede deshacer.`)) return;
    setDetailItems(prev => prev.filter(i => i.id !== it.id));
    try {
      await CrmApi.deleteQuoteItem(q.id, it.id);
    } catch (err) {
      pushToast(err.message || 'Error al eliminar', 'bad');
    }
  };

  const addItem = async () => {
    if (!newItem.description.trim()) return;
    try {
      const created = await CrmApi.createQuoteItem(q.id, {
        description: newItem.description.trim(),
        sku:         newItem.sku.trim() || null,
        quantity:    parseFloat(newItem.quantity) || 1,
        unitPrice:   newItem.unitPrice !== '' ? parseFloat(newItem.unitPrice) : null,
      });
      setDetailItems(prev => [...prev, created]);
      setNewItem({ sku: '', description: '', quantity: 1, unitPrice: '' });
      setAddingNew(false);
    } catch (err) {
      pushToast(err.message || 'Error al agregar ítem', 'bad');
    }
  };

  if (detailItems.length === 0 && !addingNew) {
    return (
      <div className="p-6 flex flex-col items-center gap-3 py-12">
        <div className="text-[13px] text-ink-400">Sin ítems registrados</div>
        {isOC && (
          <button onClick={() => setAddingNew(true)} className="btn-ghost text-[12px] text-brand flex items-center gap-1">
            <Icon name="plus" size={13}/> Agregar ítem
          </button>
        )}
      </div>
    );
  }

  // Total de la OC = ítems checked
  const totalOC = isOC
    ? detailItems.filter(i => i.checked).reduce((s, i) => s + (i.total || 0), 0)
    : detailItems.filter(i => i.accepted !== false).reduce((s, i) => s + (i.total || 0), 0);

  return (
    <div className="p-6">
      {isOC && detailItems.length > 0 && (
        <div className="text-[12px] text-ink-500 mb-3 flex items-center gap-2">
          <Icon name="check-square" size={13}/>
          Chequeá los ítems que el cliente confirmó en esta OC. Podés editar cantidades y precios.
        </div>
      )}
      <table className="tbl w-full bg-white border border-line rounded-xl overflow-hidden">
        <thead>
          <tr>
            {isOC && <th className="w-8 !px-2"></th>}
            <th className="w-24">SKU</th>
            <th>Descripción</th>
            <th className="!text-right w-20">Cant.</th>
            <th className="!text-right w-28">P. Unit.</th>
            <th className="!text-right w-28">Total</th>
            {isOC && <th className="w-16"></th>}
          </tr>
        </thead>
        <tbody>
          {detailItems.map((it) => {
            const unchecked = isOC && !it.checked;
            const ncItem    = !isOC && it.accepted === false;
            if (editingId === it.id) {
              return (
                <tr key={it.id} className="bg-sky-50">
                  {isOC && <td className="!px-2"><input type="checkbox" checked={it.checked} readOnly className="opacity-40"/></td>}
                  <td><input className="inp text-xs py-0.5 w-full" value={editVal.sku}
                    onChange={e => setEditVal(v => ({...v, sku: e.target.value}))}/></td>
                  <td><input className="inp text-xs py-0.5 w-full" value={editVal.description}
                    onChange={e => setEditVal(v => ({...v, description: e.target.value}))}/></td>
                  <td><input type="number" className="inp text-xs py-0.5 w-full text-right" value={editVal.quantity}
                    onChange={e => setEditVal(v => ({...v, quantity: e.target.value}))}/></td>
                  <td><input type="number" className="inp text-xs py-0.5 w-full text-right" value={editVal.unitPrice} placeholder="—"
                    onChange={e => setEditVal(v => ({...v, unitPrice: e.target.value}))}/></td>
                  <td className="mono text-right text-ink-400 text-xs">
                    {editVal.unitPrice !== '' && editVal.quantity
                      ? (parseFloat(editVal.unitPrice) * parseFloat(editVal.quantity)).toLocaleString('es-AR')
                      : '—'}
                  </td>
                  {isOC && (
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => saveEdit(it)} className="btn-primary text-[11px] py-0.5 px-1.5">OK</button>
                        <button onClick={() => setEditingId(null)} className="btn-ghost text-[11px] py-0.5 px-1.5">✕</button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            }
            return (
              <tr key={it.id} className={cx(
                'group',
                unchecked && 'opacity-50',
                ncItem    && 'opacity-40 bg-ink-50'
              )}>
                {isOC && (
                  <td className="!px-2">
                    <input type="checkbox" checked={!!it.checked} className="cursor-pointer accent-brand"
                      onChange={() => toggleChecked(it)}/>
                  </td>
                )}
                <td className={cx('mono text-[12px]', unchecked && 'line-through')}>{it.sku || '—'}</td>
                <td className={cx(unchecked && 'line-through')}>
                  {ncItem && <span className="text-[10px] font-bold text-red-500 mr-1.5 bg-red-50 border border-red-200 px-1 rounded">NC</span>}
                  {it.description}
                </td>
                <td className={cx('mono text-right', unchecked && 'line-through')}>{it.quantity}</td>
                <td className={cx('mono text-right', unchecked && 'line-through')}>
                  {it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR') : '—'}
                </td>
                <td className={cx('mono text-right font-semibold', unchecked && 'line-through')}>
                  {it.total != null ? it.total.toLocaleString('es-AR') : '—'}
                </td>
                {isOC && (
                  <td>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(it)} className="btn-ghost p-1" title="Editar">
                        <Icon name="pencil" size={12} className="text-ink-500"/>
                      </button>
                      <button onClick={() => deleteItem(it)} className="btn-ghost p-1" title="Eliminar">
                        <Icon name="trash-2" size={12} className="text-red-400"/>
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}

          {/* Fila para agregar nuevo ítem */}
          {isOC && addingNew && (
            <tr className="bg-surface border-t border-dashed border-line">
              <td className="!px-2"><Icon name="plus" size={12} className="text-ink-400"/></td>
              <td><input autoFocus className="inp text-xs py-0.5 w-full" placeholder="SKU"
                value={newItem.sku} onChange={e => setNewItem(n => ({...n, sku: e.target.value}))}/></td>
              <td><input className="inp text-xs py-0.5 w-full" placeholder="Descripción *"
                value={newItem.description} onChange={e => setNewItem(n => ({...n, description: e.target.value}))}/></td>
              <td><input type="number" className="inp text-xs py-0.5 w-full text-right" placeholder="1"
                value={newItem.quantity} onChange={e => setNewItem(n => ({...n, quantity: e.target.value}))}/></td>
              <td><input type="number" className="inp text-xs py-0.5 w-full text-right" placeholder="—"
                value={newItem.unitPrice} onChange={e => setNewItem(n => ({...n, unitPrice: e.target.value}))}/></td>
              <td className="mono text-right text-ink-400 text-xs">
                {newItem.unitPrice !== '' && newItem.quantity
                  ? (parseFloat(newItem.unitPrice) * parseFloat(newItem.quantity)).toLocaleString('es-AR') : '—'}
              </td>
              <td>
                <div className="flex gap-1">
                  <button onClick={addItem} className="btn-primary text-[11px] py-0.5 px-1.5">Agregar</button>
                  <button onClick={() => setAddingNew(false)} className="btn-ghost text-[11px] py-0.5 px-1.5">✕</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface">
            {isOC && <td/>}
            <td colSpan={isOC ? 4 : 4} className="text-right text-[12px] text-ink-500 font-semibold py-2 pr-2">
              {isOC ? 'Total OC (confirmado)' : 'Total presupuesto'}
            </td>
            <td className="mono text-right font-bold text-[13px] pr-3 py-2">
              U$S {totalOC.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
            {isOC && (
              <td className="!px-2">
                <button onClick={() => setAddingNew(true)}
                  className="btn-ghost p-1 text-brand" title="Agregar ítem">
                  <Icon name="plus" size={14}/>
                </button>
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function QuoteDetail({ code, onClose, canReassign }) {
  const { quotes, clients, users, moveQuoteStage, setQuotes, pushToast, closeModal, openModal } = useApp();
  const q = quotes.find(x => x.code === code);
  if (!q) return null;
  const cli = clients.find(c=>c.code===q.client);
  const sel = users.find(u=>u.id===q.seller);
  const stg = STAGES_F1.find(s=>s.id===q.stage);
  const isSolicitud = q.mailType === 'SOLICITUD' || (q.source === 'EMAIL' && !q.mailType);
  const isOC = q.mailType === 'OC';
  const defaultTab = isSolicitud ? 'mail' : (isOC ? 'items' : 'resumen');
  const [tab, setTab] = useState(defaultTab);
  const [stageOpen, setStageOpen] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [history, setHistory] = useState([]);
  const [assigningClient, setAssigningClient] = useState(false);
  const [assignClientId, setAssignClientId] = useState('');
  const [assignSellerId, setAssignSellerId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropOpen, setClientDropOpen] = useState(false);
  const [detailItems, setDetailItems] = useState([]);
  const [detailAttachments, setDetailAttachments] = useState([]);
  const [detailEmailBody, setDetailEmailBody] = useState('');
  const [emailBodyOpen, setEmailBodyOpen] = useState(false);
  const [linkedQuotes, setLinkedQuotes] = useState({ linkedQuote: null, linkedBy: [] });
  const [linkSearch, setLinkSearch] = useState('');
  const [linkDropOpen, setLinkDropOpen] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const noteInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const created = await CrmApi.uploadAttachments(q.id, Array.from(files));
      setDetailAttachments(prev => [...prev, ...created]);
      pushToast(`${created.length} archivo${created.length > 1 ? 's' : ''} subido${created.length > 1 ? 's' : ''}`);
    } catch (err) {
      pushToast(err.message || 'Error al subir archivo', 'bad');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAssignClient = async () => {
    if (!assignClientId) return;
    setAssignSaving(true);
    try {
      await CrmApi.assignQuoteClient(q.id, {
        clientId: assignClientId,
        sellerId: assignSellerId || null,
      });
      const freshQuotes = await CrmApi.getQuotes();
      setQuotes(freshQuotes);
      pushToast('Cliente asignado correctamente');
      setAssigningClient(false);
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al asignar cliente', 'bad');
    } finally {
      setAssignSaving(false);
    }
  };

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
      .then(detail => {
        setNotes(detail.notes || []);
        setHistory(detail.unifiedHistory || detail.activities || []);
        setDetailItems(detail.items || []);
        setDetailAttachments(detail.attachments || []);
        setDetailEmailBody(detail.emailBody || '');
        setLinkedQuotes({ linkedQuote: detail.linkedQuote || null, linkedBy: detail.linkedBy || [] });
        setNotesLoading(false);
      })
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

  const handleLinkQuote = async (targetId) => {
    if (!targetId) return;
    setLinkSaving(true);
    try {
      await CrmApi.linkQuote(q.id, targetId);
      const [freshQuotes, detail] = await Promise.all([CrmApi.getQuotes(), CrmApi.getQuoteDetail(q.id)]);
      setQuotes(freshQuotes);
      setLinkedQuotes({ linkedQuote: detail.linkedQuote || null, linkedBy: detail.linkedBy || [] });
      setHistory(detail.activities || []);
      setLinkDropOpen(false);
      setLinkSearch('');
      pushToast('Cotizaciones vinculadas');
    } catch (err) {
      pushToast(err.message || 'Error al vincular', 'bad');
    } finally {
      setLinkSaving(false);
    }
  };

  const handleUnlinkQuote = async () => {
    if (!window.confirm('¿Desvincular esta cotización?')) return;
    try {
      await CrmApi.linkQuote(q.id, null);
      const [freshQuotes, detail] = await Promise.all([CrmApi.getQuotes(), CrmApi.getQuoteDetail(q.id)]);
      setQuotes(freshQuotes);
      setLinkedQuotes({ linkedQuote: detail.linkedQuote || null, linkedBy: detail.linkedBy || [] });
      pushToast('Vínculo eliminado');
    } catch (err) {
      pushToast(err.message || 'Error', 'bad');
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

  const fmtBytes = (b) => {
    if (!b) return '';
    return b >= 1024*1024 ? `${(b/(1024*1024)).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;
  };
  const extOf = (filename, mimeType) => {
    if (filename && filename.includes('.')) return filename.split('.').pop().toLowerCase();
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'xlsx';
    if (mimeType?.includes('wordprocessing') || mimeType?.includes('word')) return 'docx';
    return 'file';
  };
  const extBg = (ext) => {
    if (ext === 'pdf') return 'bg-red-500';
    if (['xlsx','xls','csv'].includes(ext)) return 'bg-emerald-600';
    if (['docx','doc'].includes(ext)) return 'bg-blue-500';
    return 'bg-slate-500';
  };

  return (
    <>
    <Drawer onClose={onClose}
      subtitle={`Fase 1 · Cotización · ${stg?.label || q.stage}`}
      title={`${code}${cli ? ` — ${cli.name}` : ''}`}
      width={960}
      headerExtras={
        <div className="flex items-center gap-2">
          {CrmAuth.getUser()?.role === 'ADMIN' && (
            <button className="btn-ghost text-bad border-red-200 hover:bg-red-50" onClick={handleDelete}>
              <Icon name="trash-2" size={13}/>Eliminar
            </button>
          )}
          <Badge tone={stg?.tone || 'gray'} dot>{stg?.label || q.stage}</Badge>
          {q.mailType && (
            <Badge tone={q.mailType==='SOLICITUD'?'sky':q.mailType==='PRESUPUESTO'?'blue':'purple'}>
              {q.mailType}
            </Badge>
          )}
          {q.flexxus && (
            <Badge tone="slate"><span className="mono">{q.flexxus}</span></Badge>
          )}
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
          <button className="btn-ghost" onClick={() => { setTab('notas'); setTimeout(() => noteInputRef.current?.focus(), 80); }}>
            <Icon name="message-square" size={13}/>Agregar nota
          </button>
          <button className="btn-ghost" onClick={() => { setTab('adj'); setTimeout(() => fileInputRef.current?.click(), 80); }}>
            <Icon name="paperclip" size={13}/>Adjuntar
          </button>
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => handleUploadFiles(e.target.files)}/>
          {/* ── Vincular ─────────────────────────────────────── */}
          {(() => {
            const linked = linkedQuotes.linkedQuote || linkedQuotes.linkedBy?.[0];
            if (linked) return (
              <div className="flex items-center gap-1.5 text-[12px] text-ink-600 border border-line rounded-lg px-2.5 py-1.5">
                <Icon name="link" size={12} className="text-brand shrink-0"/>
                <span className="font-medium mono">{linked.code}</span>
                <Badge tone={linked.mailType==='SOLICITUD'?'sky':linked.mailType==='PRESUPUESTO'?'blue':'gray'} className="text-[10px]">
                  {linked.mailType||'—'}
                </Badge>
                <button onClick={handleUnlinkQuote} className="ml-1 text-ink-400 hover:text-bad" title="Desvincular">
                  <Icon name="x" size={11}/>
                </button>
              </div>
            );
            return (
              <div className="relative">
                <button className="btn-ghost text-[12px]" onClick={() => setLinkDropOpen(o=>!o)}>
                  <Icon name="link" size={13}/>Vincular cotización
                </button>
                {linkDropOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setLinkDropOpen(false)}/>
                    <div className="absolute bottom-full mb-1 left-0 z-20 w-72 bg-white border border-line rounded-xl shadow-pop overflow-hidden">
                      <div className="p-2 border-b border-line">
                        <input autoFocus className="inp w-full text-xs" placeholder="Buscar por código…"
                          value={linkSearch} onChange={e => setLinkSearch(e.target.value)}/>
                      </div>
                      <div className="max-h-48 overflow-y-auto scroll-thin">
                        {quotes.filter(x =>
                          x.id !== q.id &&
                          !x.linkedQuoteId &&
                          (!linkSearch || x.code.toLowerCase().includes(linkSearch.toLowerCase()) || (x.clientName||'').toLowerCase().includes(linkSearch.toLowerCase()))
                        ).slice(0,15).map(x => (
                          <button key={x.id} disabled={linkSaving}
                            className="w-full text-left px-3 py-2 hover:bg-surface border-b border-line last:border-b-0 flex items-center gap-2"
                            onClick={() => handleLinkQuote(x.id)}>
                            <span className="mono text-[12px] font-semibold text-ink-900">{x.code}</span>
                            <Badge tone={x.mailType==='SOLICITUD'?'sky':x.mailType==='PRESUPUESTO'?'blue':'gray'} className="text-[10px]">
                              {x.mailType||'MANUAL'}
                            </Badge>
                            <span className="text-[11px] text-ink-500 truncate">{x.clientName||'sin cliente'}</span>
                          </button>
                        ))}
                        {quotes.filter(x => x.id !== q.id && !x.linkedQuoteId && (!linkSearch || x.code.toLowerCase().includes(linkSearch.toLowerCase()) || (x.clientName||'').toLowerCase().includes(linkSearch.toLowerCase()))).length === 0 && (
                          <div className="px-3 py-3 text-[12px] text-ink-400 text-center">Sin resultados</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          <div className="flex-1"/>
          <button className="btn-ghost text-bad border-red-200 hover:bg-red-50" onClick={() => setRejectPending(true)}>
            Marcar rechazada
          </button>
          <button className="btn-accent" onClick={() => handleQuoteStage('enviado')}>
            <Icon name="check" size={14}/>Marcar aceptada
          </button>
        </>
      }
    >
      {!cli && !assigningClient && (
        <div className="mx-6 mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon name="alert-triangle" size={16} className="text-amber-500 shrink-0"/>
            <div>
              <div className="text-[13px] font-semibold text-amber-900">Cliente pendiente de asignar</div>
              <div className="text-[12px] text-amber-700">
                {q.emailSubject || 'Cotización ingresada sin cliente'}
                {q.emailFrom && ` · De: ${q.emailFrom}`}
              </div>
            </div>
          </div>
          <button className="btn-primary text-xs py-1.5 px-3 shrink-0"
            onClick={() => setAssigningClient(true)}>
            <Icon name="user-plus" size={13}/>Asignar cliente
          </button>
        </div>
      )}

      {!cli && assigningClient && (() => {
        const selectedClientObj = clients.find(c => c.id === assignClientId);
        const filteredClients = clients.filter(c =>
          !clientSearch ||
          c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          (c.cuit || '').includes(clientSearch) ||
          (c.email || '').toLowerCase().includes(clientSearch.toLowerCase())
        );
        return (
          <div className="mx-6 mt-4 px-4 py-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-[13px] font-semibold text-amber-900 mb-3">Asignar cliente a esta cotización</div>
            <div className="grid grid-cols-2 gap-3">

              {/* ── Buscador de cliente ── */}
              <div>
                <label className="text-[11px] font-medium text-ink-700 mb-1 block">Cliente *</label>
                <div className="relative">
                  <input
                    className="inp w-full text-xs"
                    placeholder="Buscar por nombre, CUIT o email…"
                    value={clientDropOpen ? clientSearch : (selectedClientObj?.name || '')}
                    onFocus={() => { setClientDropOpen(true); setClientSearch(''); }}
                    onChange={e => { setClientSearch(e.target.value); setAssignClientId(''); }}
                  />
                  {selectedClientObj && !clientDropOpen && (
                    <button
                      title="Editar cliente"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-brand"
                      onClick={() => openModal('editClient', { clientId: assignClientId })}>
                      <Icon name="pencil" size={12}/>
                    </button>
                  )}
                  {clientDropOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setClientDropOpen(false)}/>
                      <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-xl shadow-pop max-h-56 overflow-y-auto scroll-thin">
                        {filteredClients.slice(0, 80).map(c => (
                          <button key={c.id}
                            className="w-full text-left px-3 py-2 hover:bg-surface border-b border-line last:border-b-0"
                            onClick={() => { setAssignClientId(c.id); setClientDropOpen(false); setClientSearch(''); }}>
                            <div className="text-[12.5px] font-medium text-ink-900">{c.name}</div>
                          </button>
                        ))}
                        {filteredClients.length === 0 && (
                          <div className="px-3 py-3 text-[12.5px] text-ink-400 text-center">Sin resultados</div>
                        )}
                        {/* Opción nuevo cliente */}
                        <button
                          className="w-full text-left px-3 py-2.5 text-[12.5px] text-brand font-medium hover:bg-brandSoft border-t border-line flex items-center gap-2"
                          onClick={() => { setClientDropOpen(false); setAssigningClient(false); openModal('newClient'); }}>
                          <Icon name="plus" size={12}/>Nuevo cliente
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {/* Info + botón editar del cliente seleccionado */}
                {selectedClientObj && (
                  <div className="mt-1.5 flex items-center justify-between bg-white border border-line rounded-lg px-2.5 py-1.5 text-[11.5px]">
                    <span className="text-ink-700 truncate">
                      {selectedClientObj.email || selectedClientObj.city || 'Sin email registrado'}
                    </span>
                    <button className="ml-2 flex items-center gap-1 text-brand hover:underline shrink-0"
                      onClick={() => openModal('editClient', { clientId: assignClientId })}>
                      <Icon name="pencil" size={11}/>Editar
                    </button>
                  </div>
                )}
              </div>

              {/* ── Selector de vendedor ── */}
              <div>
                <label className="text-[11px] font-medium text-ink-700 mb-1 block">Vendedor (opcional — se usa el del cliente)</label>
                <select className="inp w-full text-xs" value={assignSellerId}
                  onChange={e => setAssignSellerId(e.target.value)}>
                  <option value="">Vendedor por defecto del cliente</option>
                  {users.filter(u => u.role==='Vendedor'||u.role==='Administrador')
                    .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-3 justify-end">
              <button className="btn-ghost text-xs" onClick={() => { setAssigningClient(false); setClientDropOpen(false); }}
                disabled={assignSaving}>Cancelar</button>
              <button className="btn-primary text-xs"
                disabled={!assignClientId || assignSaving}
                onClick={handleAssignClient}
                style={!assignClientId || assignSaving ? {opacity:.45,cursor:'not-allowed'} : {}}>
                <Icon name={assignSaving ? 'loader' : 'check'} size={13}/>
                {assignSaving ? 'Guardando...' : 'Confirmar asignación'}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Pipeline strip */}
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F1} currentId={q.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label="Cliente" value={cli?.name || '—'}/>
          <Field label="CUIT" mono value={cli?.cuit || '—'}/>
          <Field label="Vendedor">
            {sel
              ? <div className="flex items-center gap-2"><Avatar name={sel.name} size={20}/>{sel.name}</div>
              : <span className="text-ink-400">Sin asignar</span>}
          </Field>
          <Field label="Ingreso">
            <span className="mono">{fmtDate(q.ingreso)} <span className="text-ink-500">· hace {q.dias}d</span></span>
          </Field>
          <Field label="Monto cotizado" mono value={q.monto != null ? fmtMoney(q.monto) : '—'}/>
          <Field label="Cod. Flexxus NP" mono value={q.flexxus || '—'}/>
          <Field label="Zona de entrega" value={cli?.zone || '—'}/>
          <Field label="Contacto"><div className="text-[12.5px]">{cli?.email || '—'}</div></Field>
        </div>
      </div>

      {q.followUpDate && new Date(q.followUpDate) < new Date() && q.stage === 'enviado' && (
        <div className="mx-6 mb-3 px-4 py-2.5 bg-orange-50 border border-orange-200 rounded-xl flex items-center gap-3">
          <Icon name="clock" size={15} className="text-orange-500 shrink-0"/>
          <span className="text-[12.5px] text-orange-900">
            <span className="font-semibold">Seguimiento pendiente</span>
            {' · Alerta desde '}{fmtDate(q.followUpDate)}
          </span>
        </div>
      )}

      {q.source === 'EMAIL' && q.emailSubject && !isSolicitud && (
        <div className="mx-6 mb-4">
          <div className="px-4 py-3 bg-surface border border-line rounded-xl flex items-start gap-3">
            <Icon name="mail" size={15} className="mt-0.5 text-ink-500 shrink-0"/>
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold text-ink-700 mb-0.5">Solicitud recibida por mail</div>
              <div className="text-[12.5px] text-ink-900 truncate"><span className="text-ink-500">Asunto:</span> {q.emailSubject}</div>
              <div className="text-[12px] text-ink-500 mt-0.5"><span>De:</span> {q.emailFrom}</div>
              {detailEmailBody && (
                <button onClick={() => setEmailBodyOpen(o => !o)}
                  className="mt-2 text-[11.5px] text-brand hover:underline flex items-center gap-1">
                  <Icon name={emailBodyOpen ? 'chevron-up' : 'chevron-down'} size={11}/>
                  {emailBodyOpen ? 'Ocultar cuerpo del mail' : 'Ver cuerpo del mail'}
                </button>
              )}
            </div>
          </div>
          {emailBodyOpen && detailEmailBody && (
            <div className="mt-1 p-3 bg-surface border border-line rounded-b-xl text-[11.5px] text-ink-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto scroll-thin">
              {detailEmailBody}
            </div>
          )}
        </div>
      )}

      {/* ── Bloque de vinculación SOLICITUD ↔ PRESUPUESTO ── */}
      {(() => {
        const linked = linkedQuotes.linkedQuote || linkedQuotes.linkedBy?.[0];
        if (!linked) return null;
        const isSol  = linked.mailType === 'SOLICITUD' || !linked.mailType;
        const isPres = linked.mailType === 'PRESUPUESTO';
        return (
          <div className="mx-6 mb-4 px-4 py-3 bg-white border border-line rounded-xl flex items-center gap-3">
            <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', isSol ? 'bg-sky-50 text-sky-600' : 'bg-blue-50 text-blue-600')}>
              <Icon name={isSol ? 'inbox' : 'file-text'} size={15}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">
                {isSol ? 'Solicitud origen' : 'Presupuesto vinculado'}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono text-[13px] font-semibold text-ink-900">{linked.code}</span>
                <Badge tone={isSol ? 'sky' : 'blue'}>{linked.mailType || 'MANUAL'}</Badge>
                {linked.flexxusCode && <Badge tone="slate"><span className="mono">{linked.flexxusCode}</span></Badge>}
                {linked.stage && <StageDot tone={STAGES_F1.find(s=>s.id===linked.stage)?.tone||'gray'}/>}
                <span className="text-[11.5px] text-ink-500">{linked.stage}</span>
              </div>
            </div>
            <button className="btn-ghost text-[12px] py-1 px-2.5 shrink-0"
              onClick={() => openModal('quoteDetail', { code: linked.code })}>
              Ver <Icon name="arrow-right" size={11}/>
            </button>
          </div>
        );
      })()}

      {(() => {
        const nonImageAdj = detailAttachments.filter(a => !a.mimeType?.startsWith('image/'));
        const tabs = isSolicitud
          ? [
              { id:'mail',     label:'Mail' },
              { id:'adj',      label:'Adjuntos', count: nonImageAdj.length > 0 ? nonImageAdj.length : null },
              { id:'historial',label:'Historial' },
              { id:'notas',    label:'Notas', count: notes.length > 0 ? notes.length : null },
            ]
          : isOC
          ? [
              { id:'items',    label:'Ítems', count: detailItems.length > 0 ? detailItems.length : null },
              { id:'mail',     label:'Mail' },
              { id:'adj',      label:'Adjuntos', count: nonImageAdj.length > 0 ? nonImageAdj.length : null },
              { id:'historial',label:'Historial' },
              { id:'notas',    label:'Notas', count: notes.length > 0 ? notes.length : null },
            ]
          : [
              { id:'resumen',  label:'Resumen' },
              { id:'items',    label:'Ítems', count: detailItems.length > 0 ? detailItems.length : null },
              { id:'adj',      label:'Adjuntos', count: nonImageAdj.length > 0 ? nonImageAdj.length : null },
              { id:'historial',label:'Historial' },
              { id:'notas',    label:'Notas', count: notes.length > 0 ? notes.length : null },
            ];
        return <TabBar active={tab} onChange={setTab} tabs={tabs}/>;
      })()}

      {tab === 'mail' && (
        <div className="p-6">
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            {/* Header del mail */}
            <div className="px-5 py-4 border-b border-line space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-16 shrink-0 pt-0.5">Asunto</span>
                <span className="text-[14px] font-semibold text-ink-900 leading-snug">{q.emailSubject || '(sin asunto)'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-16 shrink-0">De</span>
                <span className="text-[13px] text-ink-700 mono">{q.emailFrom || '—'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-16 shrink-0">Ingreso</span>
                <span className="text-[13px] text-ink-500">{fmtDate(q.ingreso)} · hace {q.dias}d</span>
              </div>
            </div>
            {/* Cuerpo */}
            <div className="px-5 py-4">
              {detailEmailBody ? (
                <pre className="text-[12.5px] text-ink-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[480px] overflow-y-auto scroll-thin">
                  {detailEmailBody}
                </pre>
              ) : (
                <div className="text-[13px] text-ink-400 py-8 text-center">Sin cuerpo de mail guardado</div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'resumen' && !isSolicitud && (
        <div className="p-6">
          {detailItems.length > 0 ? (
            <div className="grid grid-cols-3 gap-5">
              <div className="col-span-2 bg-white border border-line rounded-xl p-5">
                <div className="text-sm font-semibold mb-3 text-ink-900">Presupuesto Flexxus</div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-left text-ink-500">
                    <th className="font-semibold pb-2">SKU</th>
                    <th className="font-semibold pb-2">Descripción</th>
                    <th className="font-semibold pb-2 text-right">Cant.</th>
                    <th className="font-semibold pb-2 text-right">P. Unit.</th>
                    <th className="font-semibold pb-2 text-right">Total</th>
                  </tr></thead>
                  <tbody>
                    {detailItems.filter(i => i.accepted).map((it, idx) => (
                      <tr key={it.id || idx} className="border-t border-line">
                        <td className="py-2 mono text-ink-700">{it.sku || '—'}</td>
                        <td className="py-2">{it.description}</td>
                        <td className="py-2 mono text-right">{it.quantity}</td>
                        <td className="py-2 mono text-right">{it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR') : '—'}</td>
                        <td className="py-2 mono text-right font-semibold">{it.total != null ? it.total.toLocaleString('es-AR') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {q.monto != null && (
                    <tfoot>
                      <tr className="border-t-2 border-ink-900">
                        <td colSpan="4" className="text-right pt-3 font-bold">TOTAL</td>
                        <td className="text-right pt-3 mono font-bold text-base">{q.monto.toLocaleString('es-AR')}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                {detailItems.filter(i => !i.accepted).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-line">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-2">No Cotiza</div>
                    <div className="space-y-1">
                      {detailItems.filter(i => !i.accepted).map((it, idx) => (
                        <div key={it.id || idx} className="flex items-center gap-3 text-[12px] text-ink-400 line-through">
                          <span className="mono">{it.sku || '—'}</span>
                          <span>{it.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="bg-white border border-line rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Resumen</div>
                  <ul className="text-[12.5px] space-y-1.5">
                    <li className="flex justify-between"><span className="text-ink-500">Cliente</span><span className="font-medium">{cli?.name || '—'}</span></li>
                    {q.flexxus && <li className="flex justify-between"><span className="text-ink-500">NP Flexxus</span><span className="mono">{q.flexxus}</span></li>}
                    {q.monto != null && <li className="flex justify-between"><span className="text-ink-500">Total</span><span className="mono font-semibold">{fmtMoney(q.monto)}</span></li>}
                    <li className="flex justify-between"><span className="text-ink-500">Ítems</span><span>{detailItems.filter(i=>i.accepted).length} cotizados{detailItems.filter(i=>!i.accepted).length > 0 ? `, ${detailItems.filter(i=>!i.accepted).length} NC` : ''}</span></li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              <div className="col-span-2 bg-white border border-line rounded-xl p-5">
                <div className="text-sm font-semibold mb-2 text-ink-900">Presupuesto</div>
                <div className="text-[13px] text-ink-400 py-6 text-center">Sin ítems de presupuesto todavía</div>
              </div>
              <div className="space-y-4">
                <div className="bg-white border border-line rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Resumen</div>
                  <ul className="text-[12.5px] space-y-1.5">
                    <li className="flex justify-between"><span className="text-ink-500">Cliente</span><span className="font-medium">{cli?.name || '—'}</span></li>
                    <li className="flex justify-between"><span className="text-ink-500">Monto</span><span className="mono">{q.monto != null ? fmtMoney(q.monto) : '—'}</span></li>
                    <li className="flex justify-between"><span className="text-ink-500">Ingreso</span><span className="mono">{fmtDate(q.ingreso)}</span></li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'items' && !isSolicitud && (
        <OCItemsTab q={q} detailItems={detailItems} setDetailItems={setDetailItems}/>
      )}

      {tab === 'adj' && (
        <div className="p-6 grid grid-cols-2 gap-3">
          {(() => {
            const visibleAdj = detailAttachments.filter(a => !a.mimeType?.startsWith('image/'));
            if (visibleAdj.length === 0) return (
              <div className="col-span-2 text-[13px] text-ink-400 py-6 text-center">Sin adjuntos</div>
            );
            return visibleAdj.map(a => {
              const ext = extOf(a.filename, a.mimeType);
              return (
                <div key={a.id} className="bg-white border border-line rounded-xl p-3 flex items-center gap-3">
                  <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[11px] shrink-0', extBg(ext))}>
                    {ext.toUpperCase().slice(0,4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink-900 truncate">{a.filename}</div>
                    <div className="text-[11px] text-ink-500">
                      {fmtBytes(a.size)}{a.size ? ' · ' : ''}{fmtDate(a.createdAt)}
                    </div>
                  </div>
                  <a href={`/uploads/attachments/${a.filename}`} target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-lg hover:bg-surface text-ink-500 flex items-center justify-center">
                    <Icon name="download" size={14}/>
                  </a>
                </div>
              );
            });
          })()}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="col-span-2 py-6 border-2 border-dashed border-line rounded-xl text-ink-500 hover:bg-surface disabled:opacity-50">
            {uploading
              ? <><Icon name="loader" size={14} className="inline mr-1 animate-spin"/> Subiendo…</>
              : <><Icon name="plus" size={14} className="inline mr-1"/> Subir adjunto</>}
          </button>
        </div>
      )}

      {tab === 'historial' && (
        <div className="p-6">
          {history.length === 0 ? (
            <div className="text-[13px] text-ink-400 py-8 text-center">Sin actividad registrada</div>
          ) : (
            <div className="space-y-0">
              {history.map((a, i) => {
                const iconMap = {
                  CREATED:      { name:'plus-circle',    cls:'text-emerald-600 bg-emerald-50' },
                  STAGE_CHANGE: { name:'arrow-right',    cls:'text-brand bg-brandSoft' },
                  NOTE_ADDED:   { name:'message-square', cls:'text-ink-500 bg-surface' },
                  ASSIGNED:     { name:'user',           cls:'text-orange-600 bg-orange-50' },
                  LINKED:       { name:'link',           cls:'text-violet-600 bg-violet-50' },
                };
                const ic = iconMap[a.action] || { name:'activity', cls:'text-ink-500 bg-surface' };
                const isLast = i === history.length - 1;
                // ¿Este evento viene de la quote vinculada?
                const isFromLinked = a._fromCode && a._fromCode !== q.code;
                const linkedTypeTone = a._fromType === 'SOLICITUD' ? 'sky' : a._fromType === 'PRESUPUESTO' ? 'blue' : 'gray';
                return (
                  <div key={`${a.id||i}-${a._fromCode||''}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cx('w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                        isFromLinked ? 'ring-2 ring-offset-1 ring-violet-200 ' + ic.cls : ic.cls)}>
                        <Icon name={ic.name} size={14}/>
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-line mt-1 mb-1"/>}
                    </div>
                    <div className={cx('flex-1', isLast ? 'pb-0' : 'pb-4')}>
                      <div className={cx('border rounded-xl px-4 py-3', isFromLinked ? 'bg-violet-50/40 border-violet-100' : 'bg-white border-line')}>
                        {isFromLinked && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Icon name="link" size={11} className="text-violet-400"/>
                            <span className="text-[10.5px] font-semibold text-violet-500 mono">{a._fromCode}</span>
                            <Badge tone={linkedTypeTone} className="text-[9px]">{a._fromType}</Badge>
                          </div>
                        )}
                        <p className="text-[13px] text-ink-900 leading-snug">{a.detail}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-500">
                          <span className="font-medium">{a.user?.name || 'Sistema'}</span>
                          <span>·</span>
                          <span className="mono">{fmtDateTime(a.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
            <textarea ref={noteInputRef} rows="3" value={newNote} onChange={e=>setNewNote(e.target.value)}
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
