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

// ── Autocomplete de artículos por código/descripción ─────────────────────
function ArticleSearchInput({ value, onChange, onSelect, placeholder = 'SKU', autoFocus = false }) {
  const [results, setResults] = useState([]);
  const [open, setOpen]       = useState(false);
  const debounceRef           = useRef(null);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounceRef.current);
    if (val.length >= 2) {
      debounceRef.current = setTimeout(() => {
        CrmApi.searchArticles(val)
          .then(r => { setResults(r); setOpen(r.length > 0); })
          .catch(() => {});
      }, 200);
    } else {
      setResults([]); setOpen(false);
    }
  };

  const pick = (a) => {
    onSelect(a);
    setResults([]); setOpen(false);
  };

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        className="inp text-xs py-0.5 w-full"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-[400px] bg-white border border-line rounded-xl shadow-pop max-h-56 overflow-y-auto scroll-thin">
          {results.map(a => (
            <button
              key={a.code}
              type="button"
              onMouseDown={() => pick(a)}
              className="w-full text-left px-3 py-2 hover:bg-surface border-b border-line last:border-0 flex flex-col"
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] mono font-semibold text-blue-600">{a.code}</span>
                {a.category && <span className="text-[10px] text-ink-400 truncate">{a.category}</span>}
              </div>
              <div className="text-[12px] text-ink-700 leading-snug line-clamp-1">{a.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Badge de catálogo — verifica SKU y permite agregar/quitar del catálogo ──
function CatalogBadge({ sku, description }) {
  const { pushToast } = useApp();
  const [status, setStatus]       = useState('loading'); // 'loading' | 'found' | 'missing'
  const [showModal, setShowModal] = useState(false);
  const [meta, setMeta]           = useState({ categories: [], types: [], classes: [] });

  useEffect(() => {
    if (!sku) { setStatus('none'); return; }
    CrmApi.getArticleByCode(sku)
      .then(() => setStatus('found'))
      .catch(() => setStatus('missing'));
  }, [sku]);

  const handleAdd = () => {
    CrmApi.getArticleMeta().then(setMeta).catch(() => {});
    setShowModal(true);
  };

  const handleSaved = (saved) => {
    setShowModal(false);
    setStatus('found');
    pushToast(`${saved.code} agregado al catálogo`, 'ok');
  };

  const handleRemove = async () => {
    if (!window.confirm(`¿Quitar ${sku} del catálogo?\n\nNo afecta los ítems de esta cotización.`)) return;
    try {
      await CrmApi.deleteArticle(sku);
      setStatus('missing');
      pushToast(`${sku} eliminado del catálogo`, 'ok');
    } catch (err) {
      pushToast(err.message || 'Error', 'bad');
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span>{sku || '—'}</span>
      {sku && status === 'found' && (
        <>
          <span title="En catálogo" className="text-green-500 text-[10px]">✓</span>
          <button onClick={handleRemove}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-red-400 hover:text-red-600 ml-0.5">
            ×cat
          </button>
        </>
      )}
      {sku && status === 'missing' && (
        <>
          <span title="No en catálogo" className="text-amber-400 text-[10px]">?</span>
          <button onClick={handleAdd}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[9px] text-brand font-semibold hover:text-brand-dark ml-0.5">
            +cat
          </button>
        </>
      )}
      {showModal && (
        <ArticleFormModal
          article={{ code: sku, description: description || '' }}
          meta={meta}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
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

  // (La verificación de catálogo se maneja individualmente en cada <CatalogBadge/>)

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
                  <td>
                    <ArticleSearchInput
                      value={editVal.sku}
                      onChange={val => setEditVal(v => ({...v, sku: val}))}
                      onSelect={a => setEditVal(v => ({...v, sku: a.code, description: a.description}))}
                    />
                  </td>
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
                <td className={cx('mono text-[12px]', unchecked && 'line-through')}>
                  <CatalogBadge sku={it.sku} description={it.description}/>
                </td>
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
              <td>
                <ArticleSearchInput
                  autoFocus
                  value={newItem.sku}
                  placeholder="SKU"
                  onChange={val => setNewItem(n => ({...n, sku: val}))}
                  onSelect={a => setNewItem(n => ({...n, sku: a.code, description: a.description}))}
                />
              </td>
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
              $ {totalOC.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

// ─── Modal: Enviar presupuesto por email ─────────────────────────────────────
function SendEmailModal({ quote, attachments, onClose, onSent }) {
  const { pushToast } = useApp();
  const [templates, setTemplates]       = React.useState([]);
  const [selTemplate, setSelTemplate]   = React.useState('');
  const [to, setTo]                     = React.useState('');
  const [cc, setCc]                     = React.useState('');
  const [subject, setSubject]           = React.useState('');
  const [body, setBody]                 = React.useState('');
  const [attachmentId, setAttachmentId] = React.useState('');
  const [sending, setSending]           = React.useState(false);

  // Cargar plantillas y CC default al abrir
  React.useEffect(() => {
    CrmApi.getEmailTemplates().then(({ templates: tpls, ccDefault }) => {
      setTemplates(tpls || []);
      setCc(ccDefault || '');
      if (tpls && tpls.length > 0) applyTpl(tpls[0], tpls);
    }).catch(() => {});
    // Pre-fill destinatario con email del cliente
    if (quote.clientEmail) setTo(quote.clientEmail);
    // Pre-seleccionar primer PDF adjunto si hay
    const pdfAtt = (attachments || []).find(a => (a.filename||'').toLowerCase().endsWith('.pdf') || a.mimeType === 'application/pdf');
    if (pdfAtt) setAttachmentId(pdfAtt.id);
  }, []);

  const buildVars = (tpls) => {
    const today = new Date();
    const fecha = today.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
    return {
      cliente:         quote.clientName || quote.client || '',
      codigo:          quote.code || '',
      np_flexxus:      quote.flexxus || '',
      vendedor:        quote.sellerName || quote.seller || '',
      asunto_original: quote.emailSubject || '',
      fecha,
    };
  };

  const applyTpl = (tpl, tpls) => {
    const vars = buildVars(tpls);
    const subst = (t) => t
      .replace(/\{cliente\}/g,         vars.cliente)
      .replace(/\{codigo\}/g,          vars.codigo)
      .replace(/\{np_flexxus\}/g,      vars.np_flexxus)
      .replace(/\{np_line\}/g,         vars.np_flexxus ? ` (NP Flexxus: ${vars.np_flexxus})` : '')
      .replace(/\{vendedor\}/g,        vars.vendedor)
      .replace(/\{asunto_original\}/g, vars.asunto_original)
      .replace(/\{fecha\}/g,           vars.fecha);
    setSelTemplate(tpl.id);
    setSubject(subst(tpl.subject));
    setBody(subst(tpl.body));
  };

  const handleSelectTemplate = (id) => {
    const tpl = templates.find(t => t.id === id);
    if (tpl) applyTpl(tpl, templates);
  };

  const handleSend = async () => {
    if (!to.trim())      { pushToast('El destinatario (Para) es requerido', 'bad'); return; }
    if (!subject.trim()) { pushToast('El asunto es requerido', 'bad'); return; }
    if (!body.trim())    { pushToast('El cuerpo del email es requerido', 'bad'); return; }
    setSending(true);
    try {
      const result = await CrmApi.sendQuoteEmail(quote.id, {
        to: to.trim(),
        cc: cc.trim(),
        subject: subject.trim(),
        body: body.trim(),
        attachmentId: attachmentId || undefined,
      });
      pushToast(`✅ Email enviado${result.stageAdvanced ? ' · Etapa → Enviado' : ''}`, 'ok');
      onSent && onSent(result);
      onClose();
    } catch (err) {
      pushToast(err.message || 'Error al enviar email', 'bad');
    } finally {
      setSending(false);
    }
  };

  const pdfAttachments = (attachments || []).filter(a =>
    (a.filename||'').toLowerCase().endsWith('.pdf') || a.mimeType === 'application/pdf'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Enviar presupuesto</div>
            <h3 className="text-[15px] font-bold text-ink-900 mt-0.5">{quote.code}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500">
            <Icon name="x" size={16}/>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-3">
          {/* Template selector */}
          {templates.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Plantilla</label>
              <select className="inp w-full text-sm" value={selTemplate} onChange={e => handleSelectTemplate(e.target.value)}>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Para */}
          <div>
            <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Para *</label>
            <input className="inp w-full text-sm" type="email" placeholder="cliente@empresa.com"
              value={to} onChange={e => setTo(e.target.value)}/>
          </div>

          {/* CC */}
          <div>
            <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">CC</label>
            <input className="inp w-full text-sm" type="text" placeholder="ventas@myselec.com.ar, ..."
              value={cc} onChange={e => setCc(e.target.value)}/>
          </div>

          {/* Asunto */}
          <div>
            <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Asunto *</label>
            <input className="inp w-full text-sm" type="text" placeholder="Asunto del email"
              value={subject} onChange={e => setSubject(e.target.value)}/>
          </div>

          {/* Cuerpo */}
          <div>
            <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Cuerpo *</label>
            <textarea className="inp w-full text-sm resize-y" rows={8} placeholder="Escribí el cuerpo del email..."
              value={body} onChange={e => setBody(e.target.value)}/>
          </div>

          {/* Adjunto PDF */}
          <div>
            <label className="text-[11px] font-semibold text-ink-600 uppercase tracking-wide mb-1 block">Adjuntar PDF</label>
            {pdfAttachments.length === 0 ? (
              <div className="text-[12px] text-ink-400 px-3 py-2 border border-dashed border-line rounded-lg">
                No hay PDFs adjuntos en esta cotización. Subí uno desde la pestaña Adjuntos.
              </div>
            ) : (
              <select className="inp w-full text-sm" value={attachmentId} onChange={e => setAttachmentId(e.target.value)}>
                <option value="">— Sin adjunto —</option>
                {pdfAttachments.map(a => (
                  <option key={a.id} value={a.id}>{a.filename}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line bg-surface flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={sending}>Cancelar</button>
          <button className="btn-primary" onClick={handleSend} disabled={sending}>
            {sending ? (
              <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1.5"/>Enviando...</>
            ) : (
              <><Icon name="send" size={13}/>Enviar email</>
            )}
          </button>
        </div>
      </div>
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
  const isManual = q.source !== 'EMAIL';
  const defaultTab = isSolicitud ? 'mail' : isOC ? 'items' : 'resumen';
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
  const [priceBreakdown, setPriceBreakdown] = useState(null); // { subtotalNeto, ivaAmount, totalPercepciones, total }
  const [emailBodyOpen, setEmailBodyOpen] = useState(false);
  const [linkedQuotes, setLinkedQuotes] = useState({ linkedQuote: null, linkedBy: [] });
  const [linkSearch, setLinkSearch] = useState('');
  const [linkDropOpen, setLinkDropOpen] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const noteInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { url, filename }
  const [emailModalOpen, setEmailModalOpen] = useState(false);

  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const result = await CrmApi.uploadAttachments(q.id, Array.from(files));
      // El response puede ser array (legacy) o { attachments, flexxusParsed }
      const created = Array.isArray(result) ? result : (result.attachments || []);
      const parsed  = Array.isArray(result) ? null : result.flexxusParsed;
      setDetailAttachments(prev => [...prev, ...created]);
      if (parsed) {
        // PDF de Flexxus detectado y parseado — recargar detalle completo
        pushToast(`✅ PDF Flexxus parseado: ${parsed.npCode || ''} — ${parsed.itemCount} ítem${parsed.itemCount !== 1 ? 's' : ''}`, 'ok');
        const fresh = await CrmApi.getQuoteDetail(q.id);
        if (fresh && setQuotes) setQuotes(prev => prev.map(x => x.id === fresh.id ? { ...x, ...fresh } : x));
      } else {
        pushToast(`${created.length} archivo${created.length > 1 ? 's' : ''} subido${created.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      pushToast(err.message || 'Error al subir archivo', 'bad');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (id) => {
    if (!window.confirm('¿Eliminar este adjunto? Esta acción no se puede deshacer.')) return;
    try {
      await CrmApi.deleteAttachment(id);
      setDetailAttachments(prev => prev.filter(a => a.id !== id));
      pushToast('Adjunto eliminado');
    } catch (err) {
      pushToast(err.message || 'Error al eliminar adjunto', 'bad');
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
        // Breakdown de precios (solo presupuestos Flexxus con datos parseados)
        if (detail.subtotalNeto != null || detail.ivaAmount != null) {
          setPriceBreakdown({
            subtotalNeto:      detail.subtotalNeto,
            ivaAmount:         detail.ivaAmount,
            totalPercepciones: detail.totalPercepciones,
            total:             detail.amount,  // amount = grand total (con IVA)
          });
        } else {
          setPriceBreakdown(null);
        }
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
          <button className="btn-ghost text-brand border-brand/30 hover:bg-brand/5"
            onClick={() => setEmailModalOpen(true)}>
            <Icon name="send" size={13}/>Enviar
          </button>
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
          <Field label="Total con IVA" mono value={q.monto != null ? fmtMoney(q.monto) : '—'}/>
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
          : isManual
          ? [
              { id:'resumen',  label:'Resumen' },
              { id:'items',    label:'Ítems', count: detailItems.length > 0 ? detailItems.length : null },
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
                      <tr key={it.id || idx} className="border-t border-line group">
                        <td className="py-2 mono text-ink-700">
                          <CatalogBadge sku={it.sku} description={it.description}/>
                        </td>
                        <td className="py-2">{it.description}</td>
                        <td className="py-2 mono text-right">{it.quantity}</td>
                        <td className="py-2 mono text-right">{it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR') : '—'}</td>
                        <td className="py-2 mono text-right font-semibold">{it.total != null ? it.total.toLocaleString('es-AR') : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {priceBreakdown?.subtotalNeto != null && (
                      <tr className="border-t border-line">
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Subtotal neto</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {priceBreakdown.subtotalNeto.toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                      </tr>
                    )}
                    {priceBreakdown?.ivaAmount != null && priceBreakdown.ivaAmount > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">IVA 21%</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {priceBreakdown.ivaAmount.toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                      </tr>
                    )}
                    {priceBreakdown?.totalPercepciones != null && priceBreakdown.totalPercepciones > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Percepciones</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {priceBreakdown.totalPercepciones.toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                      </tr>
                    )}
                    {(q.monto != null || priceBreakdown?.total != null) && (
                      <tr className="border-t-2 border-ink-900">
                        <td colSpan="4" className="text-right pt-3 font-bold">TOTAL</td>
                        <td className="text-right pt-3 mono font-bold text-base">
                          {(priceBreakdown?.total ?? q.monto).toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                      </tr>
                    )}
                  </tfoot>
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
                    {priceBreakdown?.subtotalNeto != null && (
                      <li className="flex justify-between"><span className="text-ink-500">Subtotal neto</span><span className="mono">U$S {priceBreakdown.subtotalNeto.toLocaleString('es-AR',{minimumFractionDigits:2})}</span></li>
                    )}
                    {priceBreakdown?.ivaAmount != null && priceBreakdown.ivaAmount > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">IVA 21%</span><span className="mono">U$S {priceBreakdown.ivaAmount.toLocaleString('es-AR',{minimumFractionDigits:2})}</span></li>
                    )}
                    {priceBreakdown?.totalPercepciones != null && priceBreakdown.totalPercepciones > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">Percepciones</span><span className="mono">U$S {priceBreakdown.totalPercepciones.toLocaleString('es-AR',{minimumFractionDigits:2})}</span></li>
                    )}
                    {(q.monto != null || priceBreakdown?.total != null) && (
                      <li className="flex justify-between border-t border-line pt-1.5 mt-0.5">
                        <span className="font-semibold text-ink-800">Total</span>
                        <span className="mono font-semibold">{fmtMoney(priceBreakdown?.total ?? q.monto)}</span>
                      </li>
                    )}
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
              const isPdf = ext === 'pdf';
              const fileUrl = `/uploads/attachments/${a.filename}`;
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
                  <div className="flex items-center gap-1 shrink-0">
                    {isPdf && (
                      <button
                        onClick={() => setPdfPreview({ url: fileUrl, filename: a.filename })}
                        className="h-8 px-2.5 rounded-lg hover:bg-brandSoft text-brand text-[12px] font-medium flex items-center gap-1"
                        title="Ver PDF">
                        <Icon name="eye" size={13}/>Ver
                      </button>
                    )}
                    <a href={fileUrl} download={a.filename}
                      className="w-8 h-8 rounded-lg hover:bg-surface text-ink-500 flex items-center justify-center"
                      title="Descargar">
                      <Icon name="download" size={14}/>
                    </a>
                    <button
                      onClick={() => handleDeleteAttachment(a.id)}
                      className="w-8 h-8 rounded-lg hover:bg-red-50 text-ink-400 hover:text-red-500 flex items-center justify-center"
                      title="Eliminar adjunto">
                      <Icon name="trash-2" size={13}/>
                    </button>
                  </div>
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

      {/* Modal preview PDF */}
      {pdfPreview && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-black/80" onClick={() => setPdfPreview(null)}>
          <div className="flex items-center justify-between px-5 py-3 bg-navy-950 shrink-0" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded bg-red-500 flex items-center justify-center text-white text-[10px] font-bold">PDF</div>
              <span className="text-white text-sm font-medium truncate max-w-[500px]">{pdfPreview.filename}</span>
            </div>
            <div className="flex items-center gap-2">
              <a href={pdfPreview.url} download={pdfPreview.filename}
                className="btn-ghost text-xs text-white border-white/20 hover:bg-white/10">
                <Icon name="download" size={13}/>Descargar
              </a>
              <button onClick={() => setPdfPreview(null)}
                className="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white">
                <Icon name="x" size={16}/>
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <iframe
              src={pdfPreview.url}
              className="w-full h-full rounded-lg bg-white"
              title={pdfPreview.filename}
            />
          </div>
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
    {emailModalOpen && (
      <SendEmailModal
        quote={{
          ...q,
          clientName:  cli?.name  || q.clientName || '',
          clientEmail: cli?.email || '',
          sellerName:  sel?.name  || '',
          flexxus:     q.flexxus  || '',
        }}
        attachments={detailAttachments}
        onClose={() => setEmailModalOpen(false)}
        onSent={async () => {
          // Refrescar quote para actualizar etapa si avanzó
          try {
            const fresh = await CrmApi.getQuotes();
            setQuotes(fresh);
          } catch (_) {}
        }}
      />
    )}
    </>
  );
}

function OrderDetail({ code, onClose, canReassign }) {
  const { orders, clients, users, moveOrderStage, pushToast, openModal, setOrders, setQuotes } = useApp();
  const o = orders.find(x=>x.code===code);
  if (!o) return null;

  const cli  = clients.find(c=>c.code===o.client);
  const sel  = users.find(u=>u.id===o.seller);
  const stg  = STAGES_F2.find(s=>s.id===o.stage);
  // For email-OC orders, the record lives in the Quote table → use quote endpoints
  const isQuoteSource = o._source === 'QUOTE';

  const [tab, setTab]             = useState('resumen');
  const [stageOpen, setStageOpen] = useState(false);
  const [notes, setNotes]         = useState([]);
  const [history, setHistory]     = useState([]);
  const [attachments, setAtts]    = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newNote, setNewNote]     = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { url, filename }
  const [notaPedido, setNotaPedido]   = useState(null); // datos de la NP vinculada (para Order real)
  const [presItems, setPresItems]     = useState([]);   // ítems del presupuesto origen
  const [orderDetail, setOrderDetail] = useState(null); // detalle completo de la order
  const [npItems, setNpItems]         = useState([]);   // ítems de la NP (para quote-source)
  const [linkedPres, setLinkedPres]   = useState(null); // presupuesto vinculado (para quote-source)
  const noteInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  // ── Fetch full detail ──
  useEffect(() => {
    setLoading(true);
    const req = isQuoteSource
      ? CrmApi.getQuoteDetail(o.id)
      : CrmApi.getOrderDetail(o.id);
    req
      .then(detail => {
        setNotes(detail.notes || []);
        setHistory(isQuoteSource
          ? (detail.unifiedHistory || detail.activities || [])
          : (detail.activities || []));
        setAtts(detail.attachments || []);
        if (isQuoteSource) {
          // NP por mail: los ítems son de la quote misma, linkedQuote es el presupuesto
          setNpItems(detail.items || []);
          setLinkedPres(detail.linkedQuote || null);
        } else {
          setOrderDetail(detail);
          setNotaPedido(detail.notaPedido || null);
          setPresItems(detail.fromQuote?.items || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [o.id]);

  // ── Add note ──
  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const fn = isQuoteSource ? CrmApi.addQuoteNote : CrmApi.addOrderNote;
      const nota = await fn(o.id, newNote.trim());
      setNotes(ns => [...ns, nota]);
      setNewNote('');
    } catch (err) {
      pushToast(err.message || 'Error al guardar nota', 'bad');
    } finally {
      setSavingNote(false);
    }
  };

  // ── Upload files ──
  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fn = isQuoteSource ? CrmApi.uploadAttachments : CrmApi.uploadOrderAttachments;
      const created = await fn(o.id, Array.from(files));
      setAtts(prev => [...prev, ...created]);
      pushToast(`${created.length} archivo${created.length > 1 ? 's' : ''} subido${created.length > 1 ? 's' : ''}`);
    } catch (err) {
      pushToast(err.message || 'Error al subir archivo', 'bad');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (id) => {
    if (!window.confirm('¿Eliminar este adjunto? Esta acción no se puede deshacer.')) return;
    try {
      await CrmApi.deleteAttachment(id);
      setAtts(prev => prev.filter(a => a.id !== id));
      pushToast('Adjunto eliminado');
    } catch (err) {
      pushToast(err.message || 'Error al eliminar adjunto', 'bad');
    }
  };

  // ── Confirm delivery ──
  const handleConfirmDelivery = () => {
    if (!window.confirm('¿Confirmar la entrega de esta orden? Se moverá a "Entregada".')) return;
    moveOrderStage(o.code, 'entregada');
    onClose();
  };

  // ── Delete order / NP ──
  const [deleting, setDeleting] = useState(false);
  const handleDeleteOrder = async () => {
    const label = isQuoteSource ? 'Nota de Pedido' : 'Orden de Compra';
    const extra = (o.fromQuote || linkedPres?.code)
      ? `\n\nEl presupuesto ${o.fromQuote || linkedPres?.code} volverá a etapa "Enviado".`
      : '';
    if (!window.confirm(`¿Eliminar ${label} ${code}? Esta acción no se puede deshacer.${extra}`)) return;
    setDeleting(true);
    try {
      await CrmApi.deleteOrder(o.id);
      // Remove from orders list
      setOrders(prev => prev.filter(x => x.id !== o.id));
      // If linked to a quote, restore its stage to 'enviado'
      const linkedCode = o.fromQuote || linkedPres?.code;
      if (linkedCode && setQuotes) {
        setQuotes(prev => prev.map(q => q.code === linkedCode ? { ...q, stage: 'enviado' } : q));
      }
      pushToast(`${label} ${code} eliminada`);
      onClose();
    } catch (err) {
      pushToast(err.message || 'Error al eliminar', 'bad');
      setDeleting(false);
    }
  };

  // ── File helpers ──
  const fmtBytes = (b) => {
    if (!b) return '';
    return b >= 1024*1024 ? `${(b/(1024*1024)).toFixed(1)} MB` : `${Math.round(b/1024)} KB`;
  };
  const extOf = (filename) => {
    if (filename && filename.includes('.')) return filename.split('.').pop().toLowerCase();
    return 'file';
  };
  const extBg = (ext) => {
    if (ext === 'pdf') return 'bg-red-500';
    if (['xlsx','xls','csv'].includes(ext)) return 'bg-emerald-600';
    if (['docx','doc'].includes(ext)) return 'bg-blue-500';
    return 'bg-slate-500';
  };

  const checklistItems = [
    ['OC del cliente recibida', true],
    ['NP cargada en Flexxus',   !!o.flexxus],
    ['Stock verificado',         ['stock','proveedor','armado','facturada','transito','entregada'].includes(o.stage)],
    ['Factura emitida',          o.invoiceIssued || ['facturada','transito','entregada'].includes(o.stage)],
    ['Remito conformado',        o.waybillReceived || o.stage === 'entregada'],
  ];

  return (
    <>
    <Drawer onClose={onClose}
      subtitle={`Fase 2 · Orden de Compra · ${stg?.label || o.stage}`}
      title={`${code}${cli ? ` — ${cli.name}` : ''}`}
      width={960}
      headerExtras={
        <div className="flex items-center gap-2">
          <Badge tone={stg?.tone || 'gray'} dot>{stg?.label || o.stage}</Badge>
          {canReassign && (
            <div className="relative">
              <button className="btn-primary" onClick={()=>setStageOpen(v=>!v)}>
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
          {CrmAuth.getUser()?.role === 'ADMIN' && (
            <button className="btn-ghost text-red-500 hover:bg-red-50 border-red-200"
              onClick={handleDeleteOrder} disabled={deleting}>
              <Icon name="trash-2" size={13}/>{deleting ? 'Eliminando…' : 'Eliminar'}
            </button>
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
          <div className="flex-1"/>
          {o.stage !== 'entregada' && (
            <button className="btn-accent" onClick={handleConfirmDelivery}>
              <Icon name="check" size={14}/>Confirmar entrega
            </button>
          )}
          {o.stage === 'entregada' && (
            <span className="flex items-center gap-1.5 text-[13px] text-emerald-700 font-medium">
              <Icon name="check-circle" size={15} className="text-emerald-500"/>Entregada
            </span>
          )}
        </>
      }
    >
      {/* ── Pipeline ── */}
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F2} currentId={o.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label="Cliente" value={cli?.name || '—'}/>
          <Field label="Vendedor">
            {sel
              ? <div className="flex items-center gap-2"><Avatar name={sel.name} size={20}/>{sel.name}</div>
              : <span className="text-ink-400">Sin asignar</span>
            }
          </Field>
          <Field label="Nota Pedido" mono value={o.flexxus && o.flexxus !== '—' ? o.flexxus : '—'}/>
          <Field label="De cotización">
            {(o.fromQuote || linkedPres?.code) ? (
              <button onClick={()=>{ onClose(); setTimeout(()=>openModal('quoteDetail',{code: o.fromQuote || linkedPres.code}),80); }}
                className="mono text-brand hover:underline text-[13px] font-semibold">
                {o.fromQuote || linkedPres?.code}
              </button>
            ) : <span className="text-ink-400">—</span>}
          </Field>
          <Field label="Guía / Remito" mono value={o.guia || '—'}/>
          <Field label="Fecha" mono value={o.fecha ? fmtDate(o.fecha) : '—'}/>
        </div>
      </div>

      {/* ── Tabs ── */}
      <TabBar
        tabs={[
          { id:'resumen',  label:'Resumen' },
          // Para NP por mail: tab con sus propios ítems
          ...(isQuoteSource && npItems.length > 0 ? [{ id:'items-np', label:'Ítems NP', count: npItems.length }] : []),
          // Para Order real: tab de NP vinculada
          ...(!isQuoteSource ? [{ id:'np', label: notaPedido ? `NP Enviada ✓` : 'Nota de Pedido', count: notaPedido?.items?.length || null }] : []),
          { id:'historial',label:'Historial', count: loading ? null : history.length },
          { id:'notas',    label:'Notas',     count: loading ? null : notes.length },
          { id:'adj',      label:'Adjuntos',  count: loading ? null : attachments.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ── Tab: Ítems NP (para NP por mail / quote-source) ── */}
      {tab === 'items-np' && isQuoteSource && (
        <div className="p-6 space-y-4">
          <div className="bg-white border border-line rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <span className="text-sm font-semibold text-ink-900">Ítems de la Nota de Pedido</span>
              <span className="ml-2 text-xs text-ink-400">{npItems.length} ítems</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-ink-50 text-ink-500 text-xs">
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Descripción</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-right">P. Unit.</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {npItems.map((it, i) => (
                    <tr key={it.id || i} className="hover:bg-surface/50">
                      <td className="px-3 py-2 mono text-ink-600 text-[11px]">{it.sku || '—'}</td>
                      <td className="px-3 py-2 text-ink-800 max-w-xs truncate" title={it.description}>{it.description}</td>
                      <td className="px-3 py-2 text-right mono">{it.quantity ?? '—'}</td>
                      <td className="px-3 py-2 text-right mono">{it.unitPrice != null ? `U$S ${it.unitPrice.toLocaleString('es-AR',{minimumFractionDigits:2})}` : '—'}</td>
                      <td className="px-3 py-2 text-right mono font-semibold">{it.total != null ? `U$S ${it.total.toLocaleString('es-AR',{minimumFractionDigits:2})}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {npItems.length > 0 && (
                  <tfoot>
                    <tr className="bg-indigo-50 font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-right text-indigo-700">Total NP</td>
                      <td className="px-3 py-2 text-right mono text-indigo-800">
                        U$S {npItems.reduce((s,i) => s + (i.total||0), 0).toLocaleString('es-AR',{minimumFractionDigits:2})}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Nota de Pedido ── */}
      {tab === 'np' && !isQuoteSource && (
        <div className="p-6 space-y-5">
          {notaPedido ? (
            <>
              {/* Cabecera NP */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-indigo-500 font-semibold mb-1">NP Flexxus</p>
                  <p className="font-mono font-semibold text-indigo-800">{notaPedido.flexxusCode || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-indigo-500 font-semibold mb-1">Nº OC Cliente</p>
                  <p className="font-mono font-semibold text-indigo-800">{orderDetail?.clientOCCode || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-indigo-500 font-semibold mb-1">Fecha</p>
                  <p className="text-sm text-indigo-800">{notaPedido.createdAt ? fmtDate(notaPedido.createdAt) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-indigo-500 font-semibold mb-1">Monto NP</p>
                  <p className="font-mono font-semibold text-indigo-800">
                    {notaPedido.amount != null ? `U$S ${notaPedido.amount.toLocaleString('es-AR', {minimumFractionDigits:2})}` : '—'}
                  </p>
                </div>
              </div>

              {/* Tabla comparativa Presupuesto vs NP */}
              <div className="bg-white border border-line rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-900">Ítems — Presupuesto vs Nota de Pedido</span>
                  <span className="text-xs text-ink-400">{notaPedido.items?.length || 0} ítems en NP · {presItems.filter(i=>i.accepted).length} en presupuesto</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="bg-ink-50 text-ink-500 text-xs">
                        <th className="px-3 py-2 text-left w-5"></th>
                        <th className="px-3 py-2 text-left">Código</th>
                        <th className="px-3 py-2 text-left">Descripción</th>
                        <th className="px-3 py-2 text-right">Cant. Pres.</th>
                        <th className="px-3 py-2 text-right">Total Pres.</th>
                        <th className="px-3 py-2 text-right">Cant. NP</th>
                        <th className="px-3 py-2 text-right">P.U. NP</th>
                        <th className="px-3 py-2 text-right">Total NP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {(() => {
                        // Construir mapa de ítems NP por SKU y descripción
                        const npBySku  = {};
                        const npByDesc = {};
                        for (const it of (notaPedido.items || [])) {
                          if (it.sku) npBySku[it.sku.toUpperCase()] = it;
                          npByDesc[it.description.toLowerCase().substring(0,40)] = it;
                        }
                        const npUsed = new Set();
                        const rows = [];

                        // Ítems del presupuesto
                        for (const pi of presItems.filter(i => i.accepted !== false)) {
                          const key = pi.sku?.toUpperCase();
                          const dk  = pi.description.toLowerCase().substring(0,40);
                          const ni  = (key && npBySku[key]) || npByDesc[dk] || null;
                          if (ni) npUsed.add(ni.id);

                          const estado = !ni ? 'no_compro' : pi.quantity === ni.quantity ? 'igual' : 'cant_dist';
                          const cfg = { igual:'bg-green-50 text-green-600', cant_dist:'bg-amber-50 text-amber-600', no_compro:'bg-red-50 text-red-500' }[estado];
                          const dot = { igual:'bg-green-500', cant_dist:'bg-amber-500', no_compro:'bg-red-400' }[estado];

                          rows.push(
                            <tr key={pi.id} className={cfg.split(' ')[0]}>
                              <td className="px-3 py-2"><span className={`inline-block w-2 h-2 rounded-full ${dot}`}></span></td>
                              <td className="px-3 py-2"><CatalogBadge sku={pi.sku} description={pi.description}/></td>
                              <td className="px-3 py-2 max-w-xs truncate" title={pi.description}>{pi.description}</td>
                              <td className="px-3 py-2 text-right font-mono">{pi.quantity ?? '—'}</td>
                              <td className="px-3 py-2 text-right font-mono">{pi.total != null ? pi.total.toLocaleString('es-AR') : '—'}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold ${cfg.split(' ')[1]}`}>{ni ? ni.quantity : '—'}</td>
                              <td className="px-3 py-2 text-right font-mono text-ink-500">{ni?.unitPrice != null ? ni.unitPrice.toLocaleString('es-AR') : '—'}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold ${cfg.split(' ')[1]}`}>{ni?.total != null ? ni.total.toLocaleString('es-AR') : '—'}</td>
                            </tr>
                          );
                        }

                        // Ítems en NP que no estaban en presupuesto
                        for (const ni of (notaPedido.items || [])) {
                          if (npUsed.has(ni.id)) continue;
                          rows.push(
                            <tr key={ni.id} className="bg-blue-50">
                              <td className="px-3 py-2"><span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span></td>
                              <td className="px-3 py-2"><CatalogBadge sku={ni.sku} description={ni.description}/></td>
                              <td className="px-3 py-2 max-w-xs truncate" title={ni.description}>{ni.description}</td>
                              <td className="px-3 py-2 text-right text-ink-300">—</td>
                              <td className="px-3 py-2 text-right text-ink-300">—</td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">{ni.quantity}</td>
                              <td className="px-3 py-2 text-right font-mono text-ink-500">{ni.unitPrice != null ? ni.unitPrice.toLocaleString('es-AR') : '—'}</td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">{ni.total != null ? ni.total.toLocaleString('es-AR') : '—'}</td>
                            </tr>
                          );
                        }
                        return rows;
                      })()}
                    </tbody>
                    <tfoot>
                      <tr className="bg-ink-100 font-semibold text-sm border-t border-ink-200">
                        <td colSpan="3" className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-right text-ink-500 text-xs">TOTAL PRES.</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {presItems.filter(i=>i.accepted!==false).reduce((s,i)=>s+(i.total||0),0).toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                        <td colSpan="2" className="px-3 py-2 text-right text-ink-500 text-xs">TOTAL NP</td>
                        <td className="px-3 py-2 text-right font-mono text-indigo-700">
                          {(notaPedido.items||[]).reduce((s,i)=>s+(i.total||0),0).toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {/* Leyenda */}
                <div className="px-4 py-2 border-t border-line flex gap-4 text-[11px] text-ink-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>Igual</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>Cantidad distinta</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>No compró</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>Agregado en NP</span>
                </div>
              </div>
            </>
          ) : (
            <div className="card p-10 text-center space-y-2">
              <Icon name="file-text" size={32} className="text-ink-200 mx-auto"/>
              <p className="text-ink-500 text-sm font-medium">Sin Nota de Pedido vinculada</p>
              <p className="text-ink-400 text-xs">Se cargará automáticamente cuando el vendedor envíe la NP al cliente desde Flexxus.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'resumen' && (
        <div className="p-6 grid grid-cols-5 gap-4">
          {/* Checklist */}
          <div className="col-span-3 bg-white border border-line rounded-xl p-5">
            <div className="text-sm font-semibold mb-3">Checklist de entrega</div>
            <ul className="text-[13px] space-y-2">
              {checklistItems.map(([label, done]) => (
                <li key={label} className="flex items-center gap-2.5">
                  <span className={cx('w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0',
                    done ? 'bg-emerald-500 text-white' : 'bg-ink-200')}>
                    {done && <Icon name="check" size={11}/>}
                  </span>
                  <span className={done ? 'text-ink-900' : 'text-ink-400'}>{label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Dirección */}
          <div className="col-span-2 bg-white border border-line rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Dirección de entrega</div>
            {cli ? (
              <>
                <div className="text-[13px] text-ink-900">{cli.address || '—'}</div>
                <div className="text-[12px] text-ink-500 mt-0.5">
                  {[cli.city, cli.prov].filter(Boolean).join(' — ') || '—'}
                </div>
                <div className="mt-3 pt-3 border-t border-line text-[12px] space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-500">Teléfono</span>
                    <span className="mono">{cli.phone || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-500">Email</span>
                    <span className="truncate max-w-[140px]">{cli.email || '—'}</span>
                  </div>
                  {cli.zone && (
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-500">Zona</span>
                      <span>{cli.zone}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-[13px] text-ink-400">Sin datos de cliente</div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Historial ── */}
      {tab === 'historial' && (
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Cargando historial…</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Sin movimientos registrados</div>
          ) : (
            <div className="space-y-3">
              {history.map((h, i) => {
                const st = STAGES_F2.find(s=>s.id===h.detail?.match(/→\s*(\S+)/)?.[1]) || null;
                const dotColor = st ? (STAGE_DOT[st.tone] || '#94A3B8') : '#94A3B8';
                return (
                  <div key={h.id || i} className="relative pl-8 stepline">
                    <span className="absolute left-1 top-1 w-4 h-4 rounded-full border-2 bg-white"
                      style={{borderColor: dotColor}}/>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-ink-800">{h.action}</span>
                      {h.user?.name && <span className="text-[11px] text-ink-500">· {h.user.name}</span>}
                      <span className="text-[11px] text-ink-400 mono ml-auto">
                        {h.createdAt ? fmtDateTime(h.createdAt) : ''}
                      </span>
                    </div>
                    <div className="text-[13px] text-ink-700 mt-0.5">{h.detail}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Notas ── */}
      {tab === 'notas' && (
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Cargando notas…</div>
          ) : (
            <div className="space-y-3 mb-4">
              {notes.length === 0 && (
                <div className="text-center py-6 text-ink-400 text-[13px]">Sin notas aún</div>
              )}
              {notes.map((n, i) => (
                <div key={n.id || i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Avatar name={n.user?.name || '?'} size={20}/>
                    <span className="text-[12px] font-semibold text-ink-800">{n.user?.name || '—'}</span>
                    <span className="text-[11px] text-ink-400 mono ml-auto">
                      {n.createdAt ? fmtDateTime(n.createdAt) : ''}
                    </span>
                  </div>
                  <div className="text-[13px] text-ink-800 whitespace-pre-wrap">{n.text}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <textarea
              ref={noteInputRef}
              className="inp flex-1 resize-none text-[13px]"
              rows={2}
              placeholder="Escribir nota…"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddNote(); }}
            />
            <button className="btn-primary self-end" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
              {savingNote ? '…' : <Icon name="send" size={14}/>}
            </button>
          </div>
          <div className="text-[11px] text-ink-400 mt-1">Ctrl+Enter para enviar</div>
        </div>
      )}

      {/* ── Tab: Adjuntos ── */}
      {tab === 'adj' && (
        <div className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-ink-800">
              {attachments.length} adjunto{attachments.length !== 1 ? 's' : ''}
            </div>
            <button className="btn-ghost text-xs" disabled={uploading}
              onClick={() => fileInputRef.current?.click()}>
              {uploading
                ? <><Icon name="loader" size={13} className="animate-spin"/>Subiendo…</>
                : <><Icon name="upload" size={13}/>Subir archivo</>}
            </button>
          </div>
          {loading ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Cargando adjuntos…</div>
          ) : attachments.length === 0 ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Sin archivos adjuntos</div>
          ) : (
            <div className="space-y-2">
              {attachments.map((a, i) => {
                const ext = extOf(a.filename);
                const fileUrl = `/uploads/attachments/${a.filename}`;
                return (
                  <div key={a.id || i} className="flex items-center gap-3 p-3 border border-line rounded-xl hover:bg-surface">
                    <span className={cx('w-8 h-8 rounded-lg text-white text-[10px] font-bold inline-flex items-center justify-center uppercase shrink-0', extBg(ext))}>
                      {ext}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{a.filename}</div>
                      <div className="text-[11px] text-ink-400">{fmtBytes(a.size)}{a.createdAt ? ` · ${fmtDate(a.createdAt)}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ext === 'pdf' && (
                        <button className="btn-ghost text-xs py-1 px-2"
                          onClick={() => setPdfPreview({ url: fileUrl, filename: a.filename })}>
                          <Icon name="eye" size={12}/>Ver
                        </button>
                      )}
                      <a href={fileUrl} download={a.filename} className="btn-ghost text-xs py-1 px-2">
                        <Icon name="download" size={12}/>Descargar
                      </a>
                      <button
                        onClick={() => handleDeleteAttachment(a.id)}
                        className="w-7 h-7 rounded-lg hover:bg-red-50 text-ink-400 hover:text-red-500 flex items-center justify-center"
                        title="Eliminar adjunto">
                        <Icon name="trash-2" size={13}/>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Drawer>

    {/* ── PDF Preview modal ── */}
    {pdfPreview && (
      <div className="fixed inset-0 z-50 flex flex-col" style={{background:'rgba(0,0,0,0.85)'}}>
        <div className="flex items-center gap-3 px-4 py-3" style={{background:'#1B2A4A'}}>
          <button onClick={() => setPdfPreview(null)} className="text-white/70 hover:text-white">
            <Icon name="x" size={18}/>
          </button>
          <span className="text-white text-[13px] font-medium truncate flex-1">{pdfPreview.filename}</span>
          <a href={pdfPreview.url} download={pdfPreview.filename}
            className="text-white/70 hover:text-white flex items-center gap-1.5 text-[13px]">
            <Icon name="download" size={15}/>Descargar
          </a>
        </div>
        <div className="flex-1 min-h-0">
          <iframe src={pdfPreview.url} className="w-full h-full border-0" title={pdfPreview.filename}/>
        </div>
      </div>
    )}
    </>
  );
}

Object.assign(window, { QuoteDetail, OrderDetail, Drawer, Field, StagePipeline, TabBar });
