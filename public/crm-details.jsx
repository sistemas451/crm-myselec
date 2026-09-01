/* Detail drawers for quotes & orders */

function Drawer({ onClose, title, subtitle, headerExtras, children, footer, width=900 }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 modal-overlay" onClick={onClose}/>
      <div className="bg-white shadow-pop modal-enter flex flex-col" style={{ width }}>
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="page-head-sub">{subtitle}</div>
            <h3 className="text-[17px] font-bold text-ink-900 mt-0.5 truncate" style={{letterSpacing: '-0.015em'}}>{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {headerExtras}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors"><Icon name="x" size={16}/></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-6 py-3 border-t border-line bg-surface/80 flex items-center justify-end gap-2">{footer}</div>}
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
      <div className="text-[10.5px] uppercase tracking-wider font-semibold text-ink-500 flex items-center gap-0.5">{label}</div>
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

// ── Tab Ítems completo (PRESUPUESTO: vista, OC/NP: checklist editable) ──────
function OCItemsTab({ q, detailItems, setDetailItems }) {
  const { pushToast } = useApp();
  const isOC = q.mailType === 'OC' || q.mailType === 'NOTA_PEDIDO';

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
      // Revertir al valor original: si no hacemos esto, la fila queda mostrando
      // datos que el usuario cree guardados pero el servidor nunca persistió.
      setDetailItems(prev => prev.map(i => i.id === it.id ? it : i));
      pushToast(err.message || 'Error al guardar — se revirtió el cambio', 'bad');
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
            <th className="!text-right w-28">P. Unit. ({q.currency === 'ARS' ? 'AR$' : 'U$S'})</th>
            <th className="!text-right w-28">Total ({q.currency === 'ARS' ? 'AR$' : 'U$S'})</th>
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
                  {it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}
                </td>
                <td className={cx('mono text-right font-semibold', unchecked && 'line-through')}>
                  {it.total != null ? it.total.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}
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
              {fmtMoney(totalOC, q.currency, 2)}
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

// ─── Selector "Desde" reutilizable para recordatorios ─────────────────────────
function ReminderFromSelector({ quoteId }) {
  const [accounts, setAccounts] = React.useState([]);
  const [selected, setSelected] = React.useState('');
  React.useEffect(() => {
    CrmApi.getSendAccounts().then(data => {
      setAccounts(data.accounts || []);
      setSelected(data.defaultAccount || '');
    }).catch(() => {});
  }, []);
  if (!accounts.length) return null;
  return (
    <div>
      <label className="block text-[11px] font-medium text-ink-500 mb-1">Desde</label>
      <select id={'reminder-from-' + quoteId} className="inp w-full text-[13px]" value={selected} onChange={e => setSelected(e.target.value)}>
        {accounts.map(acc => <option key={acc} value={acc}>{acc}</option>)}
      </select>
    </div>
  );
}

// ─── Modal: Enviar presupuesto por email ─────────────────────────────────────
// Cómo entró el pedido, para mostrarlo en la ficha de los casos cargados a mano
const SOURCE_LABELS = { EMAIL: 'Mail', WHATSAPP: 'WhatsApp', PHONE: 'Teléfono', WEB: 'Portal de licitación', MANUAL: 'Carga manual' };

function SendEmailModal({ quote, attachments, onClose, onSent, isSolicitud }) {
  const { pushToast } = useApp();
  const [templates, setTemplates]       = React.useState([]);
  const [selTemplate, setSelTemplate]   = React.useState('');
  const [to, setTo]                     = React.useState('');
  const [cc, setCc]                     = React.useState('');
  const [subject, setSubject]           = React.useState('');
  const [body, setBody]                 = React.useState('');
  const [sending, setSending] = React.useState(false);
  // Solicitud: tras abrir Gmail, esperamos confirmación manual antes de registrar nada
  const [gmailOpened, setGmailOpened] = React.useState(false);
  const [confirming,  setConfirming]  = React.useState(false);

  const pdfAtt = (attachments || []).find(a => a.mimeType === 'application/pdf' || a.filename?.endsWith('.pdf'));

  // Cargar plantillas y CC default al abrir — solo las que aplican a este tipo de mail
  React.useEffect(() => {
    CrmApi.getEmailTemplates().then(({ templates: tpls, ccDefault }) => {
      const wanted = isSolicitud ? 'SOLICITUD' : 'PRESUPUESTO';
      const filtered = (tpls || []).filter(t => !t.appliesTo || t.appliesTo === wanted || t.appliesTo === 'ALL');
      setTemplates(filtered);
      setCc(ccDefault || '');
      if (filtered.length > 0) applyTpl(filtered[0], filtered);
    }).catch(() => {});
    // Pre-fill destinatario con email del cliente
    if (quote.clientEmail) setTo(quote.clientEmail);
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

  // Construye la URL de Gmail compose con todos los campos pre-cargados
  const buildGmailUrl = () => {
    const params = new URLSearchParams();
    if (to.trim())      params.set('to', to.trim());
    if (cc.trim())      params.set('cc', cc.trim());
    if (subject.trim()) params.set('su', subject.trim());
    if (body.trim())    params.set('body', body.trim());
    params.set('view', 'cm');
    params.set('fs', '1');
    return `https://mail.google.com/mail/?${params.toString()}`;
  };

  const handleOpenGmail = async () => {
    if (!to.trim())      { pushToast('El destinatario (Para) es requerido', 'bad'); return; }
    if (!subject.trim()) { pushToast('El asunto es requerido', 'bad'); return; }
    if (!body.trim())    { pushToast('El cuerpo es requerido', 'bad'); return; }

    // Abrir Gmail en nueva pestaña
    window.open(buildGmailUrl(), '_blank');

    if (isSolicitud) {
      // No sabemos si el vendedor va a mandar el mail o no — esperamos que lo confirme
      // a mano en vez de asumir que "abrir Gmail" significa "enviado".
      setGmailOpened(true);
      return;
    }

    // Presupuesto/OC: comportamiento sin cambios — registra y avanza etapa al toque
    setSending(true);
    try {
      const result = await CrmApi.sendQuoteEmail(quote.id, {
        to: to.trim(), cc: cc.trim(),
        subject: subject.trim(), body: body.trim(),
        _gmailOnly: true,
      });
      pushToast(`Gmail abierto${result.stageAdvanced ? ' · Etapa → Enviado' : ''}`, 'ok');
      onSent && onSent(result);
    } catch (_) {
      // No bloqueamos si falla el log — el mail ya se abrió
    } finally {
      setSending(false);
    }
    onClose();
  };

  // Solicitud: el vendedor confirma manualmente que ya mandó el mail desde Gmail
  const handleConfirmSent = async () => {
    setConfirming(true);
    try {
      const result = await CrmApi.sendQuoteEmail(quote.id, {
        to: to.trim(), cc: cc.trim(),
        subject: subject.trim(), body: body.trim(),
        _gmailOnly: true,
      });
      pushToast('Acuse de recibo confirmado', 'ok');
      onSent && onSent(result);
    } catch (err) {
      pushToast('No se pudo registrar la confirmación: ' + err.message, 'bad');
    } finally {
      setConfirming(false);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
              {isSolicitud ? 'Acuse de recibo' : 'Enviar presupuesto'}
            </div>
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

          {/* Adjunto que se enviará — no aplica a Solicitudes, ese flujo no lleva adjunto */}
          {!isSolicitud && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] ${pdfAtt ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              <Icon name={pdfAtt ? 'paperclip' : 'alert-circle'} size={13} className="shrink-0"/>
              {pdfAtt
                ? <span><strong>Adjunto:</strong> {pdfAtt.originalName || pdfAtt.filename.replace(/^[0-9a-f-]{36}-(\d{13}-)?/i, '')}</span>
                : <span>Sin adjunto PDF — el presupuesto no tiene ningún PDF adjunto</span>
              }
            </div>
          )}
          {/* Nota informativa */}
          <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[12px] text-blue-800">
            <Icon name="info" size={13} className="shrink-0 mt-0.5 text-blue-500"/>
            <div>
              {isSolicitud ? (
                <div><strong>Enviar</strong> todavía no está disponible para Solicitudes — se habilita cuando se configuren las cuentas de Ventas para envío directo. Por ahora usá <strong>Abrir en Gmail</strong>.</div>
              ) : (
                <div><strong>Enviar:</strong> manda el mail desde <strong>iamyselec@gmail.com</strong>{pdfAtt ? ' con el adjunto indicado arriba.' : ' sin adjunto.'}</div>
              )}
              <div className="mt-1"><strong>Abrir en Gmail:</strong> abre un borrador en tu Gmail personal con el asunto y cuerpo precargados. El adjunto hay que cargarlo a mano.</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {gmailOpened ? (
          <div className="px-5 py-3 border-t border-line bg-amber-50">
            <div className="text-[12px] text-amber-800 mb-2.5 flex items-center gap-1.5">
              <Icon name="mail" size={13} className="shrink-0"/>
              Se abrió Gmail con el mail armado. Una vez que lo hayas mandado, confirmá acá:
            </div>
            <div className="flex items-center justify-end gap-2">
              <button className="btn-ghost" onClick={onClose} disabled={confirming}>Todavía no</button>
              <button className="btn-primary" onClick={handleConfirmSent} disabled={confirming}>
                {confirming
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1.5"/>Confirmando...</>
                  : <><Icon name="check" size={13}/>Ya lo envié</>
                }
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-line bg-surface flex items-center justify-between gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={sending}>Cancelar</button>
            <div className="flex items-center gap-2">
              <button className={cx('btn-primary', isSolicitud && 'opacity-40 grayscale cursor-not-allowed hover:opacity-40')}
                title={isSolicitud ? 'Disponible cuando se configuren las cuentas de Ventas para envío directo' : undefined}
                onClick={async () => {
                if (!to.trim())      { pushToast('El destinatario (Para) es requerido', 'bad'); return; }
                if (!subject.trim()) { pushToast('El asunto es requerido', 'bad'); return; }
                if (!body.trim())    { pushToast('El cuerpo es requerido', 'bad'); return; }
                setSending(true);
                try {
                  const result = await CrmApi.sendQuoteEmail(quote.id, {
                    to: to.trim(), cc: cc.trim(),
                    subject: subject.trim(), body: body.trim(),
                    attachmentId: pdfAtt?.id || null,
                  });
                  pushToast(`Enviado correctamente${result.stageAdvanced ? ' · Etapa → Enviado' : ''}`, 'ok');
                  onSent && onSent(result);
                  onClose();
                } catch (err) {
                  pushToast('Error al enviar: ' + err.message, 'bad');
                } finally { setSending(false); }
              }} disabled={sending || isSolicitud}>
                {sending
                  ? <><span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1.5"/>Enviando...</>
                  : <><Icon name="send" size={13}/>Enviar</>
                }
              </button>
              <button className="btn-ghost border border-line" onClick={handleOpenGmail} disabled={sending}>
                <Icon name="external-link" size={13}/>Abrir en Gmail
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Popover para elegir a quién etiquetar con @ en una nota
function MentionPicker({ users, excludeId, onPick, onClose }) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = users.filter(u => u.id !== excludeId && (!q || u.name.toLowerCase().includes(q)));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose}/>
      <div className="absolute bottom-full left-0 mb-1 w-56 bg-white border border-line rounded-lg shadow-pop z-50 py-1">
        <input autoFocus value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Buscar persona…"
          className="w-full px-3 py-1.5 text-[12px] outline-none border-b border-line"/>
        <div className="max-h-56 overflow-y-auto scroll-thin">
          {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-ink-400">Sin resultados</div>}
          {filtered.map(u => (
            <button key={u.id} onClick={()=>onPick(u)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface text-[12.5px]">
              <Avatar name={u.name} size={20}/>
              <span className="truncate">{u.name}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------- Selector de cotización para vincular (MYS-0011) ----------
// Reemplaza el desplegable chico que solo mostraba código + cliente: cuando un
// cliente tiene varias solicitudes abiertas se veían todas iguales y no había
// forma de distinguirlas. Ahora cada candidata muestra fecha, asunto del mail,
// monto y vendedor, y el panel derecho permite confirmar cuál es antes de vincular.
// El cuerpo del mail se pide al SELECCIONAR (no al pasar el mouse) y queda
// cacheado, para no disparar una consulta por cada movimiento del cursor.
// Confirmacion de desvinculacion. Antes era un window.confirm generico
// ("¿Desvincular esta cotización?") que no decia QUE se desvinculaba ni que habia
// colgando, asi que se aceptaba en automatico y se cortaban cadenas enteras
// (Solicitud -> Presupuesto -> NP -> Orden) sin querer.
function ConfirmUnlinkModal({ ownCode, target, clientName, warnings = [], onClose, onConfirm }) {
  const [saving, setSaving] = useState(false);
  const confirmar = async () => {
    setSaving(true);
    try { await onConfirm(); } finally { setSaving(false); }
  };
  return (
    <Modal onClose={onClose} title="Desvincular" subtitle={ownCode} width={470}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-ghost text-bad border-red-200 hover:bg-red-50"
            disabled={saving} onClick={confirmar}>
            <Icon name="unlink" size={13}/>{saving ? 'Desvinculando…' : 'Desvincular'}
          </button>
        </>
      }>
      <div className="space-y-3">
        <div className="text-[13px] text-ink-700">
          Vas a cortar el vínculo entre <b className="mono">{ownCode}</b> y <b className="mono">{target.code}</b>
          {clientName ? <> — {clientName}</> : null}.
        </div>
        <div className="px-3 py-2.5 bg-surface border border-line rounded-xl">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="mono font-semibold text-ink-900">{target.code}</span>
            {target.mailType && <Badge tone={target.mailType === 'SOLICITUD' ? 'sky' : 'blue'}>{target.mailType}</Badge>}
          </div>
          {target.emailSubject && <div className="text-[11.5px] text-ink-500 mt-1 truncate">{target.emailSubject}</div>}
        </div>
        {warnings.length > 0 && (
          <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-[12px] font-semibold text-amber-800 mb-1">Ojo con esto:</div>
            <ul className="text-[11.5px] text-amber-900 space-y-0.5 list-disc pl-4">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <div className="text-[11.5px] text-ink-500">
          El historial de cada una se conserva, pero dejan de verse como un mismo caso.
          Se puede volver a vincular después.
        </div>
      </div>
    </Modal>
  );
}

function LinkQuotePicker({ onClose, candidates, title, subtitle, emptyText, confirmLabel = 'Vincular', onConfirm, saving, clientCode, clientName }) {
  // Arranca acotado al cliente de la ficha actual — que es el caso normal. Se puede
  // pasar a "Todos" para el resto (p. ej. si el cliente se detecto mal en el mail).
  const [onlyClient, setOnlyClient] = useState(!!clientCode);
  const [search, setSearch] = useState('');
  const [selId,  setSelId]  = useState(null);
  const [cache,  setCache]  = useState({});
  const [loadingDetail, setLoadingDetail] = useState(false);

  const sameClient = clientCode ? candidates.filter(x => x.client === clientCode) : [];
  const base = (clientCode && onlyClient) ? sameClient : candidates;
  const needle = search.trim().toLowerCase();
  const list = !needle ? base : base.filter(x =>
    (x.code || '').toLowerCase().includes(needle) ||
    (x.clientName || '').toLowerCase().includes(needle) ||
    (x.emailSubject || '').toLowerCase().includes(needle)
  );

  const selected = candidates.find(x => x.id === selId) || null;
  const detail   = selId ? cache[selId] : null;

  const pick = async (item) => {
    setSelId(item.id);
    if (cache[item.id]) return;
    setLoadingDetail(true);
    try {
      const d = await CrmApi.getQuoteDetail(item.id);
      setCache(c => ({ ...c, [item.id]: d }));
    } catch (_) {
      setCache(c => ({ ...c, [item.id]: { __error: true } }));
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <Modal onClose={onClose} title={title} subtitle={subtitle} width={880}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!selId || saving} onClick={() => onConfirm(selId)}>
            <Icon name="link" size={14}/>{saving ? 'Vinculando…' : confirmLabel}
          </button>
        </>
      }>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.05fr)', height: '56vh' }}>

        {/* Lista de candidatas */}
        <div className="flex flex-col min-h-0 border border-line rounded-xl overflow-hidden">
          <div className="p-2 border-b border-line bg-surface space-y-2">
            {clientCode && (
              <div className="flex items-center gap-1 p-0.5 bg-white border border-line rounded-lg">
                <button onClick={() => setOnlyClient(true)}
                  className={cx('flex-1 min-w-0 text-[11.5px] py-1 px-2 rounded-md font-medium truncate transition-colors',
                    onlyClient ? 'bg-brand text-white' : 'text-ink-600 hover:bg-surface')}>
                  Este cliente ({sameClient.length})
                </button>
                <button onClick={() => setOnlyClient(false)}
                  className={cx('flex-1 min-w-0 text-[11.5px] py-1 px-2 rounded-md font-medium truncate transition-colors',
                    !onlyClient ? 'bg-brand text-white' : 'text-ink-600 hover:bg-surface')}>
                  Todos ({candidates.length})
                </button>
              </div>
            )}
            <input autoFocus className="inp w-full text-xs" placeholder="Buscar por código, cliente o asunto…"
              value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
            {list.length === 0 && (
              <div className="px-3 py-8 text-[12px] text-ink-400 text-center">
                {needle
                  ? 'Sin resultados para esa búsqueda'
                  : (clientCode && onlyClient)
                    ? <>No hay nada sin vincular de<br/><span className="text-ink-600">{clientName || 'este cliente'}</span></>
                    : emptyText}
                {clientCode && onlyClient && (
                  <div className="mt-2">
                    <button className="text-[11.5px] text-brand font-semibold hover:underline"
                      onClick={() => setOnlyClient(false)}>
                      Buscar en todos ({candidates.length})
                    </button>
                  </div>
                )}
              </div>
            )}
            {list.map(x => (
              <button key={x.id} onClick={() => pick(x)}
                className={cx('w-full text-left px-3 py-2.5 border-b border-line last:border-b-0 transition-colors',
                  selId === x.id ? 'bg-brandSoft' : 'hover:bg-surface')}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[12px] font-semibold text-ink-900">{x.code}</span>
                  {x.flexxus && <span className="mono text-[10px] text-ink-500 truncate">{x.flexxus}</span>}
                  <span className="ml-auto text-[11px] text-ink-500 shrink-0">
                    {fmtDate(x.ingreso)}{x.dias != null ? ` · ${x.dias}d` : ''}
                  </span>
                </div>
                <div className="text-[12.5px] text-ink-800 truncate mt-0.5">{x.clientName || 'Sin cliente'}</div>
                {x.emailSubject && <div className="text-[11px] text-ink-500 truncate mt-0.5">{x.emailSubject}</div>}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-ink-500 truncate">{x.sellerName || 'Sin vendedor'}</span>
                  {x.monto != null && (
                    <span className="ml-auto text-[11.5px] font-semibold text-ink-700 shrink-0">{fmtMoney(x.monto, x.currency, 2)}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 border-t border-line bg-surface text-[11px] text-ink-500">
            {list.length} de {base.length} disponibles
          </div>
        </div>

        {/* Detalle de la seleccionada */}
        <div className="flex flex-col min-h-0 border border-line rounded-xl overflow-hidden bg-surface/30">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
              <Icon name="mouse-pointer-click" size={22} className="text-ink-300"/>
              <div className="text-[12px] text-ink-400">Elegí una de la lista para ver el detalle<br/>y confirmar que es la correcta</div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono text-[13px] font-bold text-ink-900">{selected.code}</span>
                {selected.mailType && <Badge tone={selected.mailType === 'SOLICITUD' ? 'sky' : 'blue'}>{selected.mailType}</Badge>}
              </div>
              <div className="text-[13px] font-semibold text-ink-900 mt-2">{selected.clientName || 'Sin cliente'}</div>
              {(selected.clientCity || selected.clientProvince) && (
                <div className="text-[11px] text-ink-500">{[selected.clientCity, selected.clientProvince].filter(Boolean).join(', ')}</div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
                <Field label="Ingreso"  value={fmtDateTime(selected.ingreso)}/>
                <Field label="Vendedor" value={selected.sellerName || 'Sin asignar'}/>
                <Field label="Monto"    value={selected.monto != null ? fmtMoney(selected.monto, selected.currency, 2) : '—'}/>
                <Field label="Adjuntos" value={`${selected.adj || 0} ${(selected.adj || 0) === 1 ? 'archivo' : 'archivos'}`}/>
              </div>
              <div className="mt-3 pt-3 border-t border-line">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1.5">Mail de origen</div>
                {selected.emailSubject
                  ? <div className="text-[12px] text-ink-800 font-medium">{selected.emailSubject}</div>
                  : <div className="text-[12px] text-ink-400">Sin asunto (carga manual)</div>}
                {selected.emailFrom && <div className="text-[11px] text-ink-500 mt-0.5">De: {selected.emailFrom}</div>}
                <div className="mt-2">
                  {loadingDetail && !detail && <div className="text-[11.5px] text-ink-400">Cargando el cuerpo del mail…</div>}
                  {detail && detail.__error && <div className="text-[11.5px] text-bad">No se pudo cargar el cuerpo del mail.</div>}
                  {detail && !detail.__error && (
                    detail.emailBody
                      ? <pre className="text-[11.5px] text-ink-700 whitespace-pre-wrap break-words bg-white border border-line rounded-lg p-2.5 max-h-52 overflow-y-auto scroll-thin" style={{ fontFamily: 'inherit' }}>{detail.emailBody}</pre>
                      : <div className="text-[11.5px] text-ink-400">Este registro no tiene cuerpo de mail guardado.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function QuoteDetail({ code, onClose, canReassign }) {
  const { quotes, clients, users, allUsers, moveQuoteStage, setQuotes, setOrders, pushToast, closeModal, openModal, updateQuote, currentUserId, roleKey } = useApp();
  const q = quotes.find(x => x.code === code);
  if (!q) return null;
  const cli = clients.find(c=>c.code===q.client);
  const sel = allUsers.find(u=>u.id===q.seller);
  const stg = STAGES_F1.find(s=>s.id===q.stage);
  const isSolicitud = q.mailType === 'SOLICITUD' || (q.source === 'EMAIL' && !q.mailType);
  const isOC = q.mailType === 'OC';
  const isManual = q.source !== 'EMAIL';
  // emailMessageId solo lo tienen las que entraron por correo. Las cargadas a
  // mano guardan el pedido del cliente en los mismos campos, pero se muestran
  // como "Pedido" y se pueden editar.
  const esDeMail  = !!q.emailMessageId;
  const defaultTab = isSolicitud ? 'mail' : isOC ? 'items' : 'resumen';
  const [tab, setTab] = useState(defaultTab);
  const [stageOpen, setStageOpen] = useState(false);
  const [rejectPending, setRejectPending] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [notes, setNotes] = useState([]);
  // Edición del pedido (solo solicitudes cargadas a mano)
  const [editPedido,   setEditPedido]   = useState(false);
  const [pedidoVal,    setPedidoVal]    = useState({ body:'', de:'', ref:'' });
  const [pedidoSaving, setPedidoSaving] = useState(false);
  const [notesLoading, setNotesLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [assigningClient, setAssigningClient] = useState(false);
  const [assignClientId, setAssignClientId] = useState('');
  const [assignSellerId, setAssignSellerId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientDropOpen, setClientDropOpen] = useState(false);
  const [assigningSeller, setAssigningSeller] = useState(false);
  const [assignSellerIdQuick, setAssignSellerIdQuick] = useState('');
  const [assignSellerSaving, setAssignSellerSaving] = useState(false);
  const [detailItems, setDetailItems] = useState([]);
  const [detailAttachments, setDetailAttachments] = useState([]);
  const [detailEmailBody, setDetailEmailBody] = useState('');
  const [priceBreakdown, setPriceBreakdown] = useState(null); // { subtotalNeto, ivaAmount, totalPercepciones, total }
  const [emailBodyOpen, setEmailBodyOpen] = useState(false);
  const [linkedQuotes, setLinkedQuotes] = useState({ linkedQuote: null, linkedBy: [] });
  const [linkedOrder, setLinkedOrder] = useState(null); // OC vinculada a este presupuesto
  const [linkDropOpen, setLinkDropOpen] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const noteInputRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { url, filename }
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderSubject, setReminderSubject] = useState('');
  const [reminderBody, setReminderBody] = useState('');
  const [reminderSending, setReminderSending] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupClientId, setDupClientId] = useState('');
  const [dupClientSearch, setDupClientSearch] = useState('');
  const [dupSaving, setDupSaving] = useState(false);
  const [editingMonto, setEditingMonto] = useState(false);
  const [montoVal, setMontoVal] = useState('');
  const [montoSaving, setMontoSaving] = useState(false);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineVal, setDeadlineVal] = useState('');
  const [deadlineSaving, setDeadlineSaving] = useState(false);
  // La fecha límite es un día del calendario: se fija al mediodía UTC para que no
  // se lea un día menos en Argentina (UTC-3). El backend hace lo mismo. MYS-0017.
  const deadlineIso = (dia) => dia ? new Date(dia + 'T12:00:00.000Z').toISOString() : null;
  const guardarDeadline = async (dia) => {
    setDeadlineSaving(true);
    try {
      await CrmApi.updateQuoteDeadline(q.id, dia);
      updateQuote(q.code, { deadline: deadlineIso(dia) });
      pushToast(dia ? 'Fecha límite actualizada' : 'Fecha límite quitada');
    } catch (err) {
      pushToast(err.message || 'Error al guardar', 'bad');
    } finally {
      setDeadlineSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!dupClientId) return;
    setDupSaving(true);
    try {
      const result = await CrmApi.duplicateQuote(q.id, { clientId: dupClientId });
      pushToast(`✅ Cotización duplicada como ${result.code} para ${result.clientName}`);
      setDupOpen(false);
      setDupClientId('');
      setDupClientSearch('');
      // Refrescar lista de cotizaciones
      if (setQuotes) {
        const fresh = await CrmApi.getQuotes();
        if (fresh) setQuotes(fresh);
      }
    } catch (err) {
      pushToast(err.message || 'Error al duplicar', 'bad');
    } finally {
      setDupSaving(false);
    }
  };

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
      pushToast('Cliente actualizado correctamente');
      setAssigningClient(false);
      setAssignClientId('');
      setAssignSellerId('');
    } catch (err) {
      pushToast(err.message || 'Error al asignar cliente', 'bad');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleAssignSellerQuick = async () => {
    if (!assignSellerIdQuick) return;
    setAssignSellerSaving(true);
    try {
      await CrmApi.assignQuote(q.id, assignSellerIdQuick);
      const freshQuotes = await CrmApi.getQuotes();
      setQuotes(freshQuotes);
      pushToast('Vendedor actualizado correctamente');
      setAssigningSeller(false);
      setAssignSellerIdQuick('');
    } catch (err) {
      pushToast(err.message || 'Error al actualizar vendedor', 'bad');
    } finally {
      setAssignSellerSaving(false);
    }
  };

  const handleSelfAssign = async () => {
    setAssignSellerSaving(true);
    try {
      await CrmApi.assignQuote(q.id, currentUserId);
      const freshQuotes = await CrmApi.getQuotes();
      setQuotes(freshQuotes);
      pushToast('Te asignaste esta cotización');
      setAssigningSeller(false);
    } catch (err) {
      pushToast(err.message || 'Error al asignarte la cotización', 'bad');
    } finally {
      setAssignSellerSaving(false);
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
        setLinkedOrder(detail.linkedOrder || null);
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
      const nota = await CrmApi.addQuoteNote(q.id, newNote.trim(), mentionedUsers.map(u=>u.id));
      setNotes(ns => [...ns, nota]);
      setNewNote('');
      setMentionedUsers([]);
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
      pushToast('Cotizaciones vinculadas');
    } catch (err) {
      pushToast(err.message || 'Error al vincular', 'bad');
    } finally {
      setLinkSaving(false);
    }
  };

  const [unlinkTarget, setUnlinkTarget] = useState(null);
  const handleUnlinkQuote = async () => {
    try {
      await CrmApi.linkQuote(q.id, null);
      const [freshQuotes, detail] = await Promise.all([CrmApi.getQuotes(), CrmApi.getQuoteDetail(q.id)]);
      setQuotes(freshQuotes);
      setLinkedQuotes({ linkedQuote: detail.linkedQuote || null, linkedBy: detail.linkedBy || [] });
      setUnlinkTarget(null);
      pushToast('Vínculo eliminado');
    } catch (err) {
      pushToast(err.message || 'Error', 'bad');
    }
  };

  const handleDelete = async () => {
    const warnings = [];
    if (linkedOrder) warnings.push(`La OC ${linkedOrder.code} perderá el vínculo con este presupuesto.`);
    const linked = linkedQuotes.linkedQuote || linkedQuotes.linkedBy?.[0];
    if (linked) warnings.push(`Se desvinculará de ${linked.code} (${linked.mailType || 'manual'}).`);
    const npLinked = (linkedQuotes.linkedBy || []).find(x => x.mailType === 'NOTA_PEDIDO');
    if (npLinked) warnings.push(`La NP ${npLinked.code} perderá su vínculo.`);
    const msg = `¿Eliminar la cotización ${q.code}? Esta acción no se puede deshacer.`
      + (warnings.length ? '\n\n' + warnings.join('\n') : '');
    if (!window.confirm(msg)) return;
    try {
      await CrmApi.deleteQuote(q.id);
      setQuotes(qs => qs.filter(x => x.id !== q.id));
      // Refrescar orders si había una OC vinculada (pierde su fromQuote)
      if (linkedOrder) {
        try { const fresh = await CrmApi.getOrders(); setOrders(fresh); } catch(e) {}
      }
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
          <Badge tone={stg?.tone || 'gray'} dot>{stg?.label || q.stage}</Badge>
          {q.mailType && (
            <Badge tone={q.mailType==='SOLICITUD'?'sky':q.mailType==='PRESUPUESTO'?'blue':'purple'}>
              {q.mailType}
            </Badge>
          )}
          {q.flexxus && (
            <Badge tone="slate"><span className="mono">{q.flexxus}</span></Badge>
          )}
          <button className="btn-ghost text-brand border-brand/30 hover:bg-brand/5"
            onClick={() => setEmailModalOpen(true)}>
            <Icon name="send" size={13}/>Enviar mail
          </button>
          {q.mailType === 'PRESUPUESTO' && q.stage === 'enviado' && cli?.email && (
            <button className="btn-ghost text-orange-600 border-orange-300 hover:bg-orange-50"
              onClick={() => setReminderOpen(true)}>
              <Icon name="mail" size={13}/>Recordatorio
            </button>
          )}
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
          {/* Duplicar — solo PRESUPUESTO */}
          {q.mailType === 'PRESUPUESTO' && <div className="relative">
            <button className="btn-ghost" onClick={() => setDupOpen(o => !o)}>
              <Icon name="copy" size={13}/>Duplicar
            </button>
            {dupOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => { setDupOpen(false); setDupClientSearch(''); setDupClientId(''); }}/>
                <div className="absolute left-0 bottom-full mb-1 w-72 bg-white rounded-xl shadow-pop border border-line z-20 overflow-hidden">
                  <div className="px-4 py-3 space-y-2">
                    <div className="text-[11px] text-ink-400">Se copian todos los ítems a una nueva cotización</div>
                    <input value={dupClientSearch} onChange={e => { setDupClientSearch(e.target.value); setDupClientId(''); }}
                      placeholder="Buscar cliente…"
                      className="inp w-full text-[13px]" autoFocus/>
                    {dupClientSearch.length >= 2 && !dupClientId && (
                      <div className="max-h-[140px] overflow-y-auto border border-line rounded-lg bg-white">
                        {clients.filter(c => {
                          const s = dupClientSearch.toLowerCase();
                          return (c.name?.toLowerCase().includes(s) || c.code?.toLowerCase().includes(s))
                            && c.code !== q.client;
                        }).slice(0, 6).map(c => (
                          <button key={c.id} onClick={() => { setDupClientId(c.id); setDupClientSearch(c.name); }}
                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface flex items-center gap-2 border-b border-line last:border-0">
                            <Icon name="building-2" size={13} className="text-ink-400"/>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{c.name}</div>
                              <div className="text-[11px] text-ink-400">{c.code}{c.city ? ` · ${c.city}` : ''}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {dupClientId && (
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-green-50 rounded-lg border border-green-200 text-[12px] text-green-800">
                        <Icon name="check-circle" size={14}/> {dupClientSearch}
                      </div>
                    )}
                    <button onClick={handleDuplicate} disabled={!dupClientId || dupSaving}
                      className="btn-primary w-full justify-center text-[13px]"
                      style={!dupClientId || dupSaving ? {opacity:.45, cursor:'not-allowed'} : {}}>
                      {dupSaving ? 'Duplicando…' : 'Duplicar'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>}
          {['ADMIN','DEVELOPER'].includes(CrmAuth.getUser()?.role) && (
            <button className="btn-ghost text-bad hover:bg-red-50 border-red-200" onClick={handleDelete}>
              <Icon name="trash-2" size={13}/>Eliminar
            </button>
          )}
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => handleUploadFiles(e.target.files)}/>
          <div className="flex-1"/>
          {q.mailType !== 'SOLICITUD' && (<>
            <button className="btn-ghost text-bad border-red-200 hover:bg-red-50" onClick={() => setRejectPending(true)}>
              Marcar rechazada
            </button>
            <button className="btn-accent" onClick={() => handleQuoteStage('aceptada')}>
              <Icon name="check" size={14}/>Marcar aceptada
            </button>
          </>)}
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

      {assigningClient && (() => {
        const selectedClientObj = clients.find(c => c.id === assignClientId);
        const searchTooShort = clientSearch.trim().length < 2;
        const filteredClients = searchTooShort ? [] : clients.filter(c =>
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
                        {searchTooShort ? (
                          <div className="px-3 py-3 text-[12.5px] text-ink-400 text-center">Escribí para buscar…</div>
                        ) : (
                          <>
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
                          </>
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

      {/* Panel cambio rápido de vendedor */}
      {assigningSeller && (
        <div className="mx-6 mt-3 px-4 py-3 bg-surface border border-line rounded-xl flex items-center gap-3">
          <Icon name="user" size={14} className="text-ink-400 shrink-0"/>
          {roleKey === 'seller' ? (
            <>
              <span className="text-xs text-ink-600 flex-1">¿Asignarte esta cotización?</span>
              <button className="btn-primary text-[11px] py-1 px-2.5 shrink-0"
                disabled={assignSellerSaving}
                style={assignSellerSaving ? {opacity:.45} : {}}
                onClick={handleSelfAssign}>
                {assignSellerSaving ? <Icon name="loader" size={12} className="animate-spin"/> : 'Asignarme esta cotización'}
              </button>
            </>
          ) : (
            <>
              <select className="inp text-xs flex-1" value={assignSellerIdQuick}
                onChange={e => setAssignSellerIdQuick(e.target.value)}
                autoFocus>
                <option value="">Seleccionar vendedor…</option>
                {users.filter(u => u.role === 'Vendedor' || u.role === 'Administrador')
                  .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn-primary text-[11px] py-1 px-2.5 shrink-0"
                disabled={!assignSellerIdQuick || assignSellerSaving}
                style={!assignSellerIdQuick || assignSellerSaving ? {opacity:.45} : {}}
                onClick={handleAssignSellerQuick}>
                {assignSellerSaving ? <Icon name="loader" size={12} className="animate-spin"/> : 'Guardar'}
              </button>
            </>
          )}
          <button className="text-ink-400 hover:text-ink-700 shrink-0"
            onClick={() => { setAssigningSeller(false); setAssignSellerIdQuick(''); }}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      )}

      {/* Pipeline strip */}
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F1} currentId={q.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label={
            <span className="flex items-center gap-1">
              Cliente
              <button title="Cambiar cliente"
                onClick={() => { setAssigningClient(true); setAssignClientId(cli?.id || ''); setAssignSellerId(''); setClientSearch(''); setClientDropOpen(false); }}
                className="text-ink-300 hover:text-brand transition-colors ml-0.5">
                <Icon name="pencil" size={10}/>
              </button>
            </span>
          } value={cli?.name || '—'}/>
          <Field label="CUIT" mono value={cli?.cuit || '—'}/>
          <Field label={
            <span className="flex items-center gap-1">
              Vendedor
              {(roleKey !== 'seller' || !sel) && (
                <button title={roleKey === 'seller' ? 'Asignarme' : 'Cambiar vendedor'}
                  onClick={() => { setAssigningSeller(true); setAssignSellerIdQuick(roleKey === 'seller' ? currentUserId : (q.seller || '')); }}
                  className="text-ink-300 hover:text-brand transition-colors ml-0.5">
                  <Icon name="pencil" size={10}/>
                </button>
              )}
            </span>
          }>
            {sel
              ? <div className="flex items-center gap-2">
                  <Avatar name={sel.name} size={20}/>{sel.name}
                  {sel.active === false && <span className="text-[11px] text-ink-400">(inactivo)</span>}
                </div>
              : <span className="text-ink-400">Sin asignar</span>}
          </Field>
          <Field label="Ingreso">
            <span className="mono">{fmtDate(q.ingreso)} <span className="text-ink-500">· hace {q.dias}d</span></span>
          </Field>
          {isSolicitud && !q.linkedQuoteId && (
            <Field label={
              <span className="flex items-center gap-1">
                Fecha límite
                {sel && (
                  <button title="Editar fecha límite"
                    onClick={() => { setDeadlineVal(q.deadline ? q.deadline.slice(0, 10) : ''); setEditingDeadline(true); }}
                    className="text-ink-300 hover:text-brand transition-colors ml-0.5">
                    <Icon name="pencil" size={10}/>
                  </button>
                )}
                {sel && q.deadline && !editingDeadline && (
                  <button title="Quitar fecha límite"
                    onClick={() => guardarDeadline(null)}
                    className="text-ink-300 hover:text-bad transition-colors">
                    <Icon name="x" size={10}/>
                  </button>
                )}
              </span>
            }>
              {editingDeadline ? (
                <span className="flex items-center gap-1.5">
                  <input autoFocus type="date"
                    className="text-[12.5px] border border-brand rounded-lg px-2 py-0.5 mono"
                    value={deadlineVal}
                    onChange={e => setDeadlineVal(e.target.value)}
                    onBlur={async () => {
                      // Salir con el casillero vacío NO borra la fecha: el campo de
                      // fecha queda vacío mientras esté incompleta, así que al tipearla
                      // a mano y hacer clic afuera se comía la que ya estaba (MYS-0017).
                      // Para quitarla a propósito está el botón "Quitar".
                      const oldVal = q.deadline ? q.deadline.slice(0, 10) : null;
                      if (deadlineVal && deadlineVal !== oldVal) {
                        await guardarDeadline(deadlineVal);
                      }
                      setEditingDeadline(false);
                    }}
                    onKeyDown={e => { if (e.key === 'Escape') setEditingDeadline(false); }}
                  />
                  {deadlineSaving && <span className="text-[11px] text-ink-400">Guardando…</span>}
                </span>
              ) : q.deadline ? (
                <span className={cx('mono', new Date(q.deadline) < new Date() && !['enviado','aceptada','rechazada'].includes(q.stage) ? 'text-bad font-semibold' : '')}>
                  {fmtDate(q.deadline)}
                </span>
              ) : sel ? (
                <span className="text-ink-400">—</span>
              ) : (
                <span className="text-ink-400 text-[12px]">Se completa al asignar vendedor</span>
              )}
            </Field>
          )}
          {isSolicitud && (
            <Field label="Acuse de recibo">
              {q.ackSentAt
                ? <span className="text-emerald-600 font-medium text-[12.5px]">✓ Enviado el {fmtDate(q.ackSentAt)}</span>
                : <span className="text-ink-400 text-[12.5px]">Pendiente</span>}
            </Field>
          )}
          {!isSolicitud && <Field label="Total con IVA" mono value={
            editingMonto ? (
              <span className="flex items-center gap-1.5">
                <input autoFocus type="number" step="0.01" min="0"
                  className="text-[12.5px] border border-brand rounded-lg px-2 py-0.5 w-36 mono"
                  value={montoVal}
                  onChange={e => setMontoVal(e.target.value)}
                  onBlur={async () => {
                    const v = parseFloat(montoVal);
                    if (!isNaN(v) && v !== q.monto) {
                      setMontoSaving(true);
                      try {
                        await CrmApi.updateQuoteAmount(q.id, v);
                        updateQuote(q.code, { monto: v });
                        pushToast('Monto actualizado');
                      } catch (err) { pushToast(err.message || 'Error al guardar', 'bad'); }
                      finally { setMontoSaving(false); }
                    }
                    setEditingMonto(false);
                  }}
                  onKeyDown={e => { if (e.key === 'Escape') setEditingMonto(false); }}
                />
                {montoSaving && <span className="text-[11px] text-ink-400">Guardando…</span>}
              </span>
            ) : (
              <span className="group flex items-center gap-1 cursor-pointer hover:text-brand"
                onClick={() => { setMontoVal(q.monto != null ? String(q.monto) : ''); setEditingMonto(true); }}
                title="Clic para editar">
                {q.monto != null ? fmtMoney(q.monto, q.currency) : '—'}
                <Icon name="pencil" size={11} className="text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity"/>
              </span>
            )
          }/>}
          {!isSolicitud && <Field label="Cod. Flexxus PR" mono value={q.flexxus || '—'}/>}
          {!isSolicitud && <Field label="Zona de entrega" value={cli?.zone || '—'}/>}
          {!esDeMail && isSolicitud && <Field label="Origen" value={SOURCE_LABELS[q.source] || 'Carga manual'}/>}
          <Field label="Contacto">
            {cli?.email
              ? <a href={`mailto:${cli.email}`} className="text-brand hover:underline text-[12.5px] truncate block">{cli.email}</a>
              : <span className="text-[12.5px]">—</span>}
          </Field>
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

      {unlinkTarget && (
        <ConfirmUnlinkModal
          ownCode={q.code}
          target={unlinkTarget}
          clientName={cli?.name || q.clientName}
          warnings={[
            ...(linkedOrder ? [`La orden ${linkedOrder.code} quedará sin su presupuesto de origen.`] : []),
            ...((linkedQuotes.linkedBy || []).filter(x => x.mailType === 'NOTA_PEDIDO').map(np => `La Nota de Pedido ${np.code} perderá la referencia.`)),
          ]}
          onClose={() => setUnlinkTarget(null)}
          onConfirm={handleUnlinkQuote}
        />
      )}

      {/* ── Vinculaciones: Solicitud / Presupuesto / OC / NP ── */}
      {(() => {
        const solicitud   = linkedQuotes.linkedQuote?.mailType === 'SOLICITUD'   ? linkedQuotes.linkedQuote : linkedQuotes.linkedBy?.find(x => x.mailType === 'SOLICITUD');
        const presupuesto = linkedQuotes.linkedQuote?.mailType === 'PRESUPUESTO' ? linkedQuotes.linkedQuote : linkedQuotes.linkedBy?.find(x => x.mailType === 'PRESUPUESTO');
        const npLink      = (linkedQuotes.linkedQuote?.mailType === 'NOTA_PEDIDO' ? linkedQuotes.linkedQuote : null)
                         || linkedQuotes.linkedBy?.find(x => x.mailType === 'NOTA_PEDIDO');

        // Cards: siempre muestran el vínculo primario (con botón vincular si falta),
        // OC y NP solo aparecen cuando existen
        const vcards = [];
        if (q.mailType === 'PRESUPUESTO') {
          vcards.push({ label:'Solicitud origen',      icon:'inbox',          bg:'bg-sky-50 text-sky-600',       data: solicitud   || null, modal:'quoteDetail', vincularTarget:'SOLICITUD'   });
        }
        if (q.mailType === 'SOLICITUD') {
          vcards.push({ label:'Presupuesto vinculado', icon:'file-text',      bg:'bg-blue-50 text-blue-600',     data: presupuesto || null, modal:'quoteDetail', vincularTarget:'PRESUPUESTO' });
        }
        if (linkedOrder) vcards.push({ label:'Orden de Compra',  icon:'package',        bg:'bg-purple-50 text-purple-600', data: { ...linkedOrder, mailType:'OC' }, modal:'orderDetail', vincularTarget: null });
        if (npLink)      vcards.push({ label:'Nota de Pedido',   icon:'clipboard-list', bg:'bg-orange-50 text-orange-600', data: npLink,                            modal:'orderDetail', vincularTarget: null });

        if (!vcards.length) return null;
        return (
          <div className="mx-6 mb-3 space-y-2">
            {vcards.map((vc, i) => {
              // Card sin vínculo: muestra botón Vincular
              if (!vc.data) return (
                <div key={i} className="px-4 py-3 bg-white border border-line rounded-xl flex items-center gap-3">
                  <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', vc.bg)}>
                    <Icon name={vc.icon} size={15}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">{vc.label}</div>
                    <div className="text-[12px] text-ink-400">Sin vincular</div>
                  </div>
                  <div className="shrink-0">
                    <button className="btn-ghost text-[12px] py-1 px-2.5" onClick={() => setLinkDropOpen(true)}>
                      <Icon name="link" size={13}/>Vincular
                    </button>
                    {linkDropOpen && (
                      <LinkQuotePicker
                        onClose={() => setLinkDropOpen(false)}
                        candidates={quotes
                          .filter(x => x.id !== q.id && x.mailType === vc.vincularTarget && !x.linkedQuoteId)
                          .sort((a, b) => {
                            // Las del mismo cliente primero — son las candidatas probables
                            const am = a.client && a.client === q.client ? 0 : 1;
                            const bm = b.client && b.client === q.client ? 0 : 1;
                            return am !== bm ? am - bm : new Date(b.ingreso) - new Date(a.ingreso);
                          })}
                        title={vc.vincularTarget === 'SOLICITUD' ? 'Vincular solicitud origen' : 'Vincular presupuesto'}
                        subtitle={`${q.code} · ${q.clientName || 'sin cliente'}`}
                        emptyText={vc.vincularTarget === 'SOLICITUD' ? 'No hay solicitudes sin vincular' : 'No hay presupuestos sin vincular'}
                        clientCode={q.client}
                        clientName={q.clientName}
                        onConfirm={handleLinkQuote}
                        saving={linkSaving}
                      />
                    )}
                  </div>
                </div>
              );

              // Card con vínculo
              const stages = vc.modal === 'orderDetail' ? STAGES_F2 : STAGES_F1;
              const stg = stages.find(s => s.id === vc.data.stage);
              return (
                <div key={i} className="px-4 py-3 bg-white border border-line rounded-xl flex items-center gap-3">
                  <div className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', vc.bg)}>
                    <Icon name={vc.icon} size={15}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">{vc.label}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="mono text-[13px] font-semibold text-ink-900">{vc.data.code}</span>
                      {vc.data.flexxusCode && <Badge tone="slate"><span className="mono">{vc.data.flexxusCode}</span></Badge>}
                      {stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : vc.data.stage ? <Badge tone="gray" dot>{vc.data.stage}</Badge> : null}
                      {vc.data.amount != null && <span className="text-[12px] mono text-ink-500">{fmtMoney(vc.data.amount, vc.data.currency||'USD', 2)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="btn-ghost text-[12px] py-1 px-2.5"
                      onClick={() => openModal(vc.modal, { code: vc.data.code })}>
                      Ver <Icon name="arrow-right" size={11}/>
                    </button>
                    {vc.vincularTarget && (
                      <button onClick={() => setUnlinkTarget(vc.data)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-ink-400 hover:text-bad flex items-center justify-center" title="Desvincular">
                        <Icon name="x" size={12}/>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

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


      {(() => {
        const nonImageAdj = detailAttachments.filter(a => !a.mimeType?.startsWith('image/'));
        const tabs = isSolicitud
          ? [
              { id:'mail',     label: esDeMail ? 'Mail' : 'Pedido' },
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
            {/* Mismo bloque para un mail real o para un pedido cargado a mano */}
            <div className="px-5 py-4 border-b border-line space-y-2.5">
              {editPedido ? (
                <>
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-20 shrink-0 pt-2">Referencia</span>
                    <input className="inp flex-1 text-[13px]" placeholder="Ej: Pedido cables 3x2.5"
                      value={pedidoVal.ref} onChange={e => setPedidoVal(v => ({...v, ref: e.target.value}))}/>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-20 shrink-0 pt-2">De</span>
                    <input className="inp flex-1 text-[13px]" placeholder="Ej: Juan Pérez · 351 555 1234"
                      value={pedidoVal.de} onChange={e => setPedidoVal(v => ({...v, de: e.target.value}))}/>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-20 shrink-0 pt-0.5">
                      {esDeMail ? 'Asunto' : 'Referencia'}
                    </span>
                    <span className="text-[14px] font-semibold text-ink-900 leading-snug flex-1">
                      {q.emailSubject || (esDeMail ? '(sin asunto)' : '—')}
                    </span>
                    {!esDeMail && isSolicitud && (
                      <button
                        onClick={() => { setPedidoVal({ body: detailEmailBody || '', de: q.emailFrom || '', ref: q.emailSubject || '' }); setEditPedido(true); }}
                        className="shrink-0 text-[12px] text-brand hover:underline flex items-center gap-1">
                        <Icon name="pencil" size={12}/>Editar
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-20 shrink-0">De</span>
                    <span className={cx('text-[13px] text-ink-700', esDeMail && 'mono')}>{q.emailFrom || '—'}</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-3">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 w-20 shrink-0">Ingreso</span>
                <span className="text-[13px] text-ink-500">{fmtDate(q.ingreso)} · hace {q.dias}d</span>
              </div>
            </div>
            {/* Cuerpo */}
            <div className="px-5 py-4">
              {editPedido ? (
                <div className="space-y-3">
                  <textarea rows="12" autoFocus
                    className="inp w-full resize-none text-[12.5px] leading-relaxed"
                    placeholder="Pegá acá lo que te escribió el cliente, o escribí lo que te pidió…"
                    value={pedidoVal.body} onChange={e => setPedidoVal(v => ({...v, body: e.target.value}))}/>
                  <div className="flex items-center justify-end gap-2">
                    <button className="btn-ghost text-[12px] py-1.5 px-3" disabled={pedidoSaving}
                      onClick={() => setEditPedido(false)}>Cancelar</button>
                    <button className="btn-primary text-[12px] py-1.5 px-3" disabled={pedidoSaving}
                      onClick={async () => {
                        if (!window.confirm('Se va a reemplazar el pedido guardado por este texto. ¿Confirmás?')) return;
                        setPedidoSaving(true);
                        try {
                          await CrmApi.updateQuotePedido(q.id, pedidoVal.body, pedidoVal.de, pedidoVal.ref);
                          setDetailEmailBody(pedidoVal.body);
                          updateQuote(q.code, { emailSubject: pedidoVal.ref || null, emailFrom: pedidoVal.de || null });
                          setEditPedido(false);
                          pushToast('Pedido actualizado');
                        } catch (err) {
                          pushToast(err.message || 'Error al guardar el pedido', 'bad');
                        } finally { setPedidoSaving(false); }
                      }}>
                      <Icon name={pedidoSaving ? 'loader' : 'check'} size={12} className={pedidoSaving ? 'animate-spin' : ''}/>
                      {pedidoSaving ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              ) : detailEmailBody ? (
                <pre className="text-[12.5px] text-ink-700 whitespace-pre-wrap font-sans leading-relaxed max-h-[480px] overflow-y-auto scroll-thin">
                  {detailEmailBody}
                </pre>
              ) : esDeMail ? (
                <div className="text-[13px] text-ink-400 py-8 text-center">Sin cuerpo de mail guardado</div>
              ) : (
                <div className="text-[13px] text-ink-400 py-8 text-center">
                  Todavía no cargaste el pedido del cliente.
                  {isSolicitud && (
                    <button className="block mx-auto mt-2 text-brand hover:underline text-[13px]"
                      onClick={() => { setPedidoVal({ body:'', de: q.emailFrom || '', ref: q.emailSubject || '' }); setEditPedido(true); }}>
                      Cargarlo ahora
                    </button>
                  )}
                </div>
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
                <div className="text-sm font-semibold mb-3 text-ink-900">{q.flexxus ? 'Presupuesto Flexxus' : 'Presupuesto'}</div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-left text-ink-500">
                    <th className="font-semibold pb-2">SKU</th>
                    <th className="font-semibold pb-2">Descripción</th>
                    <th className="font-semibold pb-2 text-right">Cant.</th>
                    <th className="font-semibold pb-2 text-right">P. Unit. ({q.currency === 'ARS' ? 'AR$' : 'U$S'})</th>
                    <th className="font-semibold pb-2 text-right">Total ({q.currency === 'ARS' ? 'AR$' : 'U$S'})</th>
                  </tr></thead>
                  <tbody>
                    {detailItems.filter(i => i.accepted).map((it, idx) => (
                      <tr key={it.id || idx} className="border-t border-line group">
                        <td className="py-2 mono text-ink-700">
                          <CatalogBadge sku={it.sku} description={it.description}/>
                        </td>
                        <td className="py-2">{it.description}</td>
                        <td className="py-2 mono text-right">{it.quantity}</td>
                        <td className="py-2 mono text-right">{it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                        <td className="py-2 mono text-right font-semibold">{it.total != null ? it.total.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {priceBreakdown?.subtotalNeto != null && (
                      <tr className="border-t border-line">
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Subtotal neto</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(priceBreakdown.subtotalNeto, q.currency, 2)}
                        </td>
                      </tr>
                    )}
                    {priceBreakdown?.ivaAmount != null && priceBreakdown.ivaAmount > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">IVA 21%</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(priceBreakdown.ivaAmount, q.currency, 2)}
                        </td>
                      </tr>
                    )}
                    {priceBreakdown?.totalPercepciones != null && priceBreakdown.totalPercepciones > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Percepciones</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(priceBreakdown.totalPercepciones, q.currency, 2)}
                        </td>
                      </tr>
                    )}
                    {(q.monto != null || priceBreakdown?.total != null) && (
                      <tr className="border-t-2 border-ink-900">
                        <td colSpan="4" className="text-right pt-3 font-bold">TOTAL</td>
                        <td className="text-right pt-3 mono font-bold text-base">
                          {fmtMoney(priceBreakdown?.total ?? q.monto, q.currency, 2)}
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
                    {q.flexxus && <li className="flex justify-between"><span className="text-ink-500">Pres. Flexxus</span><span className="mono">{q.flexxus}</span></li>}
                    {priceBreakdown?.subtotalNeto != null && (
                      <li className="flex justify-between"><span className="text-ink-500">Subtotal neto</span><span className="mono">{fmtMoney(priceBreakdown.subtotalNeto, q.currency, 2)}</span></li>
                    )}
                    {priceBreakdown?.ivaAmount != null && priceBreakdown.ivaAmount > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">IVA 21%</span><span className="mono">{fmtMoney(priceBreakdown.ivaAmount, q.currency, 2)}</span></li>
                    )}
                    {priceBreakdown?.totalPercepciones != null && priceBreakdown.totalPercepciones > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">Percepciones</span><span className="mono">{fmtMoney(priceBreakdown.totalPercepciones, q.currency, 2)}</span></li>
                    )}
                    {(q.monto != null || priceBreakdown?.total != null) && (
                      <li className="flex justify-between border-t border-line pt-1.5 mt-0.5">
                        <span className="font-semibold text-ink-800">Total</span>
                        <span className="mono font-semibold">{fmtMoney(priceBreakdown?.total ?? q.monto, q.currency)}</span>
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
                    <li className="flex justify-between"><span className="text-ink-500">Monto</span><span className="mono">{q.monto != null ? fmtMoney(q.monto, q.currency) : '—'}</span></li>
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
              const fileUrl = authUrl(`/uploads/attachments/${a.filename}`);
              const displayName = a.originalName || a.filename.replace(/^[0-9a-f-]{36}-(\d{13}-)?/i, '');
              return (
                <div key={a.id} className="bg-white border border-line rounded-xl p-3 flex items-center gap-3">
                  <div className={cx('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-[11px] shrink-0', extBg(ext))}>
                    {ext.toUpperCase().slice(0,4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink-900 truncate">{displayName}</div>
                    <div className="text-[11px] text-ink-500">
                      {fmtBytes(a.size)}{a.size ? ' · ' : ''}{fmtDate(a.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isPdf && (
                      <button
                        onClick={() => setPdfPreview({ url: fileUrl, filename: displayName })}
                        className="h-8 px-2.5 rounded-lg hover:bg-surface text-ink-500 text-[12px] font-medium flex items-center gap-1"
                        title="Ver PDF">
                        <Icon name="eye" size={13}/>Ver
                      </button>
                    )}
                    <a href={fileUrl} download={displayName}
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
      {pdfPreview && (() => {
        const pdfDisplayName = pdfPreview.filename || '';
        return (
          <div className="fixed inset-0 z-[200] flex flex-col bg-black/80" onClick={() => setPdfPreview(null)}>
            <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{background:'#004669'}} onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded bg-red-500 flex items-center justify-center text-white text-[10px] font-bold">PDF</div>
                <span className="text-white text-sm font-medium truncate max-w-[500px]">{pdfDisplayName}</span>
              </div>
              <div className="flex items-center gap-2">
                <a href={pdfPreview.url} download={pdfDisplayName}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-white text-[12px] font-medium hover:bg-white/10">
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
                title={pdfDisplayName}
              />
            </div>
          </div>
        );
      })()}

      {tab === 'historial' && (
        <div className="p-6">
          {history.length === 0 ? (
            <div className="text-[13px] text-ink-400 py-8 text-center">Sin actividad registrada</div>
          ) : (
            <div className="space-y-0">
              {history.map((a, i) => {
                const iconMap = {
                  CREATED:             { name:'plus-circle',    cls:'text-emerald-600 bg-emerald-50' },
                  STAGE_CHANGE:        { name:'arrow-right',    cls:'text-brand bg-brandSoft' },
                  NOTE_ADDED:          { name:'message-square', cls:'text-ink-500 bg-surface' },
                  ASSIGNED:            { name:'user',           cls:'text-orange-600 bg-orange-50' },
                  LINKED:              { name:'link',           cls:'text-violet-600 bg-violet-50' },
                  ATTACHMENT_UPLOADED: { name:'paperclip',      cls:'text-sky-600 bg-sky-50' },
                  REMINDER_SENT:       { name:'bell',           cls:'text-amber-600 bg-amber-50' },
                  PEDIDO_EDITED:       { name:'pencil',         cls:'text-ink-500 bg-surface' },
                  DUPLICATE_MERGED:    { name:'copy',           cls:'text-ink-500 bg-surface' },
                };
                const ic = iconMap[a.action] || { name:'activity', cls:'text-ink-500 bg-surface' };
                const isLast = i === history.length - 1;
                // ¿Este evento viene de la quote vinculada?
                const isFromLinked = a._fromCode && a._fromCode !== q.code;
                const linkedTypeTone = a._fromType === 'SOLICITUD' ? 'sky' : a._fromType === 'PRESUPUESTO' ? 'blue' : a._fromType === 'NOTA_PEDIDO' ? 'purple' : a._fromType === 'ORDER' ? 'amber' : 'gray';
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
            {mentionedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1.5">
                {mentionedUsers.map(u => (
                  <span key={u.id} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-brandSoft text-brand text-[11px] font-medium">
                    @{u.name.split(' ')[0]}
                    <button onClick={()=>setMentionedUsers(ms=>ms.filter(x=>x.id!==u.id))} className="hover:opacity-60"><Icon name="x" size={10}/></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <div className="flex gap-1.5 text-ink-500">
                <button className="w-7 h-7 rounded hover:bg-surface"><Icon name="paperclip" size={13}/></button>
                <div className="relative">
                  <button className="w-7 h-7 rounded hover:bg-surface" onClick={()=>setMentionPickerOpen(o=>!o)}><Icon name="at-sign" size={13}/></button>
                  {mentionPickerOpen && (
                    <MentionPicker users={users} excludeId={currentUserId}
                      onPick={(u)=>{
                        setMentionedUsers(ms => ms.some(x=>x.id===u.id) ? ms : [...ms, u]);
                        setNewNote(t => (t && !/\s$/.test(t) ? t+' ' : t) + `@${u.name} `);
                        setMentionPickerOpen(false);
                      }}
                      onClose={()=>setMentionPickerOpen(false)}/>
                  )}
                </div>
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
        isSolicitud={isSolicitud}
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
    {reminderOpen && (() => {
      const daysSent = Math.floor((Date.now() - new Date(q.createdAt).getTime()) / 86400000);
      const defSubject = reminderSubject || `Seguimiento presupuesto ${q.flexxus || q.code} — MySelec`;
      const defBody = reminderBody || `Hola ${cli?.name || ''},\n\nTe escribimos para hacer seguimiento del presupuesto ${q.flexxus || q.code} que te enviamos hace ${daysSent} días.\n\n¿Pudiste revisarlo? Quedamos a disposición para cualquier consulta.\n\nSaludos cordiales,\nEquipo MySelec`;
      const buildReminderGmailUrl = () => {
        const params = new URLSearchParams();
        if (cli?.email) params.set('to', cli.email);
        params.set('su', reminderSubject || defSubject);
        params.set('body', reminderBody || defBody);
        params.set('view', 'cm'); params.set('fs', '1');
        return 'https://mail.google.com/mail/?' + params.toString();
      };
      return (
        <>
          <div className="fixed inset-0 z-50 modal-overlay" onClick={() => setReminderOpen(false)}/>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setReminderOpen(false)}>
            <div className="bg-white rounded-2xl shadow-pop w-full max-w-lg border border-line modal-enter" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-line flex items-center justify-between">
                <div>
                  <div className="font-semibold text-ink-900 text-[14px]">Enviar recordatorio</div>
                  <div className="text-[11.5px] text-ink-400 mt-0.5">
                    {q.code} · {cli?.name || 'Sin cliente'} · {daysSent}d sin respuesta
                  </div>
                </div>
                <button onClick={() => setReminderOpen(false)} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-500 mb-1">Para</label>
                  <input className="inp w-full bg-surface text-ink-500 cursor-not-allowed text-[13px]" value={cli?.email || ''} readOnly/>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-500 mb-1">Asunto</label>
                  <input className="inp w-full text-[13px]" value={reminderSubject || defSubject}
                    onChange={e => setReminderSubject(e.target.value)}/>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-500 mb-1">Mensaje</label>
                  <textarea className="inp w-full text-[13px] min-h-[160px] leading-relaxed"
                    value={reminderBody || defBody}
                    onChange={e => setReminderBody(e.target.value)}/>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px] text-blue-700 space-y-1">
                  <div>Se envía desde <strong>iamyselec@gmail.com</strong>. Para enviar desde tu Gmail personal usá "Abrir en Gmail".</div>
                  <div>Al enviar, se registrará como actividad y se reprogramará el seguimiento automáticamente.</div>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-line flex items-center justify-between">
                <button onClick={() => setReminderOpen(false)} className="btn-ghost" disabled={reminderSending}>Cancelar</button>
                <div className="flex items-center gap-2">
                  <button className="btn-primary" disabled={reminderSending}
                    onClick={async () => {
                      setReminderSending(true);
                      try {
                          await CrmApi.sendReminder(q.id, {
                          subject: reminderSubject || defSubject,
                          body: reminderBody || defBody,
                        });
                        pushToast('Recordatorio enviado a ' + (cli?.email || ''), 'ok');
                        setReminderOpen(false);
                        const fresh = await CrmApi.getQuotes();
                        setQuotes(fresh);
                      } catch (err) {
                        pushToast(err.message || 'Error al enviar', 'bad');
                      } finally {
                        setReminderSending(false);
                      }
                    }}>
                    <Icon name="send" size={13}/>{reminderSending ? 'Enviando...' : 'Enviar recordatorio'}
                  </button>
                  <button className="btn-ghost border border-line" onClick={() => { window.open(buildReminderGmailUrl(), '_blank'); }}>
                    <Icon name="external-link" size={13}/>Abrir en Gmail
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    })()}
    </>
  );
}

function OrderDetail({ code, onClose, canReassign }) {
  const { orders, clients, users, allUsers, quotes, moveOrderStage, pushToast, openModal, setOrders, setQuotes, currentUserId } = useApp();
  const o = orders.find(x=>x.code===code);
  if (!o) return null;

  const cli  = clients.find(c=>c.code===o.client);
  const sel  = allUsers.find(u=>u.id===o.seller);
  const stg  = STAGES_F2.find(s=>s.id===o.stage);
  // For email-OC orders, the record lives in the Quote table → use quote endpoints
  const isQuoteSource = o._source === 'QUOTE';
  // NP = nota de pedido (by email OR manual upload) — shows presupuesto-style layout
  const isNP = isQuoteSource || (o.flexxus && o.flexxus.startsWith('NP-')) || (o.stage && o.stage.startsWith('np'));

  const [tab, setTab]             = useState('resumen');
  const [stageOpen, setStageOpen] = useState(false);
  const [notes, setNotes]         = useState([]);
  const [history, setHistory]     = useState([]);
  const [attachments, setAtts]    = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newNote, setNewNote]     = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null); // { url, filename }
  const [notaPedido, setNotaPedido]   = useState(null); // datos de la NP vinculada (para Order real)
  const [presItems, setPresItems]     = useState([]);   // ítems del presupuesto origen
  const [orderDetail, setOrderDetail] = useState(null); // detalle completo de la order
  const [npItems, setNpItems]         = useState([]);   // ítems de la NP (para quote-source)
  const [linkedPres, setLinkedPres]   = useState(null); // presupuesto vinculado (para quote-source)
  const [npBreakdown, setNpBreakdown] = useState(null); // { subtotalNeto, ivaAmount, totalPercepciones, total }
  const [npCurrency, setNpCurrency]   = useState('USD'); // moneda de la NP/presupuesto
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [editField, setEditField]   = useState(null);
  const [editVal, setEditVal]       = useState('');
  const [savingField, setSavingField] = useState(false);
  const [npAssigningClient, setNpAssigningClient] = useState(false);
  const [npAssignClientId, setNpAssignClientId]   = useState('');
  const [npClientSearch, setNpClientSearch]        = useState('');
  const [npClientDropOpen, setNpClientDropOpen]    = useState(false);
  const [npAssignSaving, setNpAssignSaving]        = useState(false);
  const [npAssigningSeller, setNpAssigningSeller]  = useState(false);
  const [npAssignSellerId, setNpAssignSellerId]    = useState('');
  const [npSellerSaving, setNpSellerSaving]        = useState(false);
  const [npLinkDropOpen, setNpLinkDropOpen]        = useState(false);
  const [npLinkSaving, setNpLinkSaving]            = useState(false);
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
        setHistory(detail.unifiedHistory || detail.activities || []);
        setAtts(detail.attachments || []);
        if (isQuoteSource) {
          // NP por mail: los ítems son de la quote misma, linkedQuote es el presupuesto
          setNpItems(detail.items || []);
          setLinkedPres(detail.linkedQuote || null);
          setNpCurrency(detail.currency || 'USD');
          // Breakdown de precios del NP (parseado del PDF Flexxus)
          if (detail.subtotalNeto != null || detail.ivaAmount != null || detail.amount != null) {
            setNpBreakdown({
              subtotalNeto:      detail.subtotalNeto      ?? null,
              ivaAmount:         detail.ivaAmount         ?? null,
              totalPercepciones: detail.totalPercepciones ?? null,
              total:             detail.amount            ?? null,
            });
          }
        } else {
          setOrderDetail(detail);
          setNotaPedido(detail.notaPedido || null);
          setNpCurrency(detail.notaPedido?.currency || detail.fromQuote?.currency || 'USD');
          setPresItems(detail.fromQuote?.items || []);
          setNpItems(detail.notaPedido?.items || []);
          const np = detail.notaPedido;
          if (np && (np.subtotalNeto != null || np.ivaAmount != null || np.amount != null)) {
            setNpBreakdown({
              subtotalNeto:      np.subtotalNeto      ?? null,
              ivaAmount:         np.ivaAmount         ?? null,
              totalPercepciones: np.totalPercepciones ?? null,
              total:             np.amount             ?? null,
            });
          }
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
      const nota = await fn(o.id, newNote.trim(), mentionedUsers.map(u=>u.id));
      setNotes(ns => [...ns, nota]);
      setNewNote('');
      setMentionedUsers([]);
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
      const result = await fn(o.id, Array.from(files));
      // Both endpoints return { attachments: [...], flexxusParsed/npParsed } — unwrap safely
      const newAtts = Array.isArray(result) ? result : (result.attachments || []);
      setAtts(prev => [...prev, ...newAtts]);
      pushToast(`${newAtts.length} archivo${newAtts.length > 1 ? 's' : ''} subido${newAtts.length > 1 ? 's' : ''}`);
      // Refrescar detalle para cargar NP parseada (si el PDF creó una Quote NOTA_PEDIDO)
      if (!isQuoteSource && isNP) {
        try {
          const detail = await CrmApi.getOrderDetail(o.id);
          setOrderDetail(detail);
          if (detail.notaPedido) {
            setNotaPedido(detail.notaPedido);
            setNpItems(detail.notaPedido.items || []);
            setNpCurrency(detail.notaPedido.currency || 'USD');
            const np = detail.notaPedido;
            if (np.subtotalNeto != null || np.ivaAmount != null || np.amount != null) {
              setNpBreakdown({
                subtotalNeto: np.subtotalNeto ?? null,
                ivaAmount: np.ivaAmount ?? null,
                totalPercepciones: np.totalPercepciones ?? null,
                total: np.amount ?? null,
              });
            }
          }
        } catch (_) {}
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
      setAtts(prev => prev.filter(a => a.id !== id));
      pushToast('Adjunto eliminado');
    } catch (err) {
      pushToast(err.message || 'Error al eliminar adjunto', 'bad');
    }
  };

  // ── NP: assign client ──
  const handleNpAssignClient = async () => {
    if (!npAssignClientId) return;
    setNpAssignSaving(true);
    try {
      if (isQuoteSource) {
        await CrmApi.assignQuoteClient(o.id, { clientId: npAssignClientId });
      } else {
        await CrmApi.updateOrder(o.id, { clientId: npAssignClientId });
      }
      const freshOrders = await CrmApi.getOrders();
      setOrders(freshOrders);
      pushToast('Cliente actualizado');
      setNpAssigningClient(false);
      setNpAssignClientId('');
    } catch (err) { pushToast(err.message || 'Error al asignar cliente', 'bad'); }
    finally { setNpAssignSaving(false); }
  };

  // ── NP: assign seller ──
  const handleNpAssignSeller = async () => {
    if (!npAssignSellerId) return;
    setNpSellerSaving(true);
    try {
      if (isQuoteSource) {
        await CrmApi.assignQuote(o.id, npAssignSellerId);
      } else {
        await CrmApi.updateOrder(o.id, { sellerId: npAssignSellerId });
      }
      const freshOrders = await CrmApi.getOrders();
      setOrders(freshOrders);
      pushToast('Vendedor actualizado');
      setNpAssigningSeller(false);
      setNpAssignSellerId('');
    } catch (err) { pushToast(err.message || 'Error al actualizar vendedor', 'bad'); }
    finally { setNpSellerSaving(false); }
  };

  // ── NP: link presupuesto ──
  const handleNpLinkPresupuesto = async (presId) => {
    if (!presId) return;
    setNpLinkSaving(true);
    try {
      if (isQuoteSource) {
        await CrmApi.linkQuote(o.id, presId);
        const detail = await CrmApi.getQuoteDetail(o.id);
        setLinkedPres(detail.linkedQuote || null);
      } else {
        await CrmApi.updateOrder(o.id, { fromQuoteId: presId });
        const detail = await CrmApi.getOrderDetail(o.id);
        setOrderDetail(detail);
      }
      const freshOrders = await CrmApi.getOrders();
      setOrders(freshOrders);
      setNpLinkDropOpen(false);
      pushToast('Presupuesto vinculado');
    } catch (err) { pushToast(err.message || 'Error al vincular', 'bad'); }
    finally { setNpLinkSaving(false); }
  };

  const handleNpUnlinkPresupuesto = async () => {
    if (!window.confirm('¿Desvincular el presupuesto de esta Nota de Pedido?')) return;
    try {
      if (isQuoteSource) {
        await CrmApi.linkQuote(o.id, null);
        setLinkedPres(null);
      } else {
        await CrmApi.updateOrder(o.id, { fromQuoteId: null });
        const detail = await CrmApi.getOrderDetail(o.id);
        setOrderDetail(detail);
      }
      const freshOrders = await CrmApi.getOrders();
      setOrders(freshOrders);
      pushToast('Vínculo eliminado');
    } catch (err) { pushToast(err.message || 'Error', 'bad'); }
  };

  // ── Confirm delivery ──
  const LAST_OC_STAGE = STAGES_F2[STAGES_F2.length - 1];
  const handleConfirmDelivery = () => {
    if (!window.confirm(`¿Confirmar la entrega de esta orden? Se moverá a "${LAST_OC_STAGE?.label || 'última etapa'}".`)) return;
    moveOrderStage(o.code, LAST_OC_STAGE?.id);
    onClose();
  };

  // ── Delete order / NP ──
  const [deleting, setDeleting] = useState(false);
  const handleDeleteOrder = async () => {
    const label = isNP ? 'Nota de Pedido' : 'Orden de Compra';
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

  // Checklist dinámico basado en posición de la etapa actual en STAGES_F2
  const currentStageIdx = STAGES_F2.findIndex(s => s.id === o.stage);
  const passedStage = (minIdx) => currentStageIdx >= minIdx;
  const checklistItems = STAGES_F2.map((stg, idx) => {
    if (idx === 0) return [stg.label, true]; // Primera etapa siempre completada
    return [stg.label, passedStage(idx)];
  });

  return (
    <>
    <Drawer onClose={onClose}
      subtitle={`Fase 2 · ${isNP ? 'Nota de Pedido' : 'Orden de Compra'} · ${stg?.label || o.stage}`}
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
          <button className="btn-ghost text-brand border-brand/30 hover:bg-brand/5"
            onClick={() => setEmailModalOpen(true)}>
            <Icon name="send" size={13}/>Enviar mail
          </button>
        </div>
      }
      footer={
        <>
          {['ADMIN','DEVELOPER'].includes(CrmAuth.getUser()?.role) && (
            <button className="btn-ghost text-bad hover:bg-red-50 border-red-200"
              onClick={handleDeleteOrder} disabled={deleting}>
              <Icon name="trash-2" size={13}/>{deleting ? 'Eliminando…' : 'Eliminar'}
            </button>
          )}
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => handleUploadFiles(e.target.files)}/>
          <div className="flex-1"/>
          {o.stage !== LAST_OC_STAGE?.id && (
            <button className="btn-accent" onClick={handleConfirmDelivery}>
              <Icon name="check" size={14}/>Confirmar entrega
            </button>
          )}
          {o.stage === LAST_OC_STAGE?.id && (
            <span className="flex items-center gap-1.5 text-[13px] text-emerald-700 font-medium">
              <Icon name="check-circle" size={15} className="text-emerald-500"/>{LAST_OC_STAGE?.label || 'Completada'}
            </span>
          )}
        </>
      }
    >
      {/* ── Pipeline ── */}
      <div className="px-6 pt-5 pb-4 bg-gradient-to-b from-surface to-white">
        <StagePipeline stages={STAGES_F2} currentId={o.stage}/>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <Field label={isNP ? (
            <span className="flex items-center gap-1">
              Cliente
              <button title="Cambiar cliente"
                onClick={() => { setNpAssigningClient(true); setNpAssignClientId(cli?.id || ''); setNpClientSearch(''); setNpClientDropOpen(false); }}
                className="text-ink-300 hover:text-brand transition-colors ml-0.5">
                <Icon name="pencil" size={10}/>
              </button>
            </span>
          ) : 'Cliente'} value={cli?.name || '—'}/>
          <Field label={isNP ? (
            <span className="flex items-center gap-1">
              Vendedor
              <button title="Cambiar vendedor"
                onClick={() => { setNpAssigningSeller(true); setNpAssignSellerId(sel?.id || ''); }}
                className="text-ink-300 hover:text-brand transition-colors ml-0.5">
                <Icon name="pencil" size={10}/>
              </button>
            </span>
          ) : 'Vendedor'}>
            {sel
              ? <div className="flex items-center gap-2">
                  <Avatar name={sel.name} size={20}/>{sel.name}
                  {sel.active === false && <span className="text-[11px] text-ink-400">(inactivo)</span>}
                </div>
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

      {/* ── NP: Client assignment panel ── */}
      {npAssigningClient && (() => {
        const selectedC = clients.find(c => c.id === npAssignClientId);
        const npSearchTooShort = npClientSearch.trim().length < 2;
        const filteredC = npSearchTooShort ? [] : clients.filter(c =>
          c.name.toLowerCase().includes(npClientSearch.toLowerCase()) ||
          (c.cuit || '').includes(npClientSearch) ||
          (c.email || '').toLowerCase().includes(npClientSearch.toLowerCase())
        );
        return (
          <div className="mx-6 mt-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-[13px] font-semibold text-amber-900 mb-2">Cambiar cliente</div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input className="inp w-full text-xs" placeholder="Buscar por nombre, CUIT o email…"
                  value={npClientDropOpen ? npClientSearch : (selectedC?.name || '')}
                  onFocus={() => { setNpClientDropOpen(true); setNpClientSearch(''); }}
                  onChange={e => { setNpClientSearch(e.target.value); setNpAssignClientId(''); }}/>
                {npClientDropOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setNpClientDropOpen(false)}/>
                    <div className="absolute z-20 mt-1 w-full bg-white border border-line rounded-xl shadow-pop max-h-48 overflow-y-auto scroll-thin">
                      {npSearchTooShort ? (
                        <div className="px-3 py-3 text-[12px] text-ink-400 text-center">Escribí para buscar…</div>
                      ) : (
                        <>
                          {filteredC.slice(0, 50).map(c => (
                            <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-surface border-b border-line last:border-b-0"
                              onClick={() => { setNpAssignClientId(c.id); setNpClientDropOpen(false); setNpClientSearch(''); }}>
                              <div className="text-[12px] font-medium text-ink-900">{c.name}</div>
                              {c.cuit && <div className="text-[11px] mono text-ink-500">{c.cuit}</div>}
                            </button>
                          ))}
                          {filteredC.length === 0 && <div className="px-3 py-3 text-[12px] text-ink-400 text-center">Sin resultados</div>}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button className="btn-primary text-[11px] py-1.5 px-3 shrink-0"
                disabled={!npAssignClientId || npAssignSaving}
                style={!npAssignClientId || npAssignSaving ? {opacity:.45} : {}}
                onClick={handleNpAssignClient}>
                {npAssignSaving ? 'Guardando…' : 'Confirmar'}
              </button>
              <button className="text-ink-400 hover:text-ink-700 shrink-0"
                onClick={() => { setNpAssigningClient(false); setNpAssignClientId(''); }}>
                <Icon name="x" size={14}/>
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── NP: Seller assignment panel ── */}
      {npAssigningSeller && (
        <div className="mx-6 mt-3 px-4 py-3 bg-surface border border-line rounded-xl flex items-center gap-3">
          <Icon name="user" size={14} className="text-ink-400 shrink-0"/>
          <select className="inp text-xs flex-1" value={npAssignSellerId}
            onChange={e => setNpAssignSellerId(e.target.value)} autoFocus>
            <option value="">Seleccionar vendedor…</option>
            {users.filter(u => u.role === 'Vendedor' || u.role === 'Administrador')
              .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-primary text-[11px] py-1 px-2.5 shrink-0"
            disabled={!npAssignSellerId || npSellerSaving}
            style={!npAssignSellerId || npSellerSaving ? {opacity:.45} : {}}
            onClick={handleNpAssignSeller}>
            {npSellerSaving ? <Icon name="loader" size={12} className="animate-spin"/> : 'Guardar'}
          </button>
          <button className="text-ink-400 hover:text-ink-700 shrink-0"
            onClick={() => { setNpAssigningSeller(false); setNpAssignSellerId(''); }}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      )}

      {/* ── Vincular presupuesto (NP sin presupuesto) ── */}
      {isNP && !(isQuoteSource ? linkedPres : orderDetail?.fromQuote) && (
        <div className="mx-6 mb-3 px-4 py-3 bg-white border border-line rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
            <Icon name="file-text" size={15}/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">Presupuesto vinculado</div>
            <div className="text-[12px] text-ink-400">Sin presupuesto vinculado</div>
          </div>
          <div className="shrink-0">
            <button className="btn-ghost text-[12px] py-1 px-2.5" onClick={() => setNpLinkDropOpen(true)}>
              <Icon name="link" size={13}/>Vincular
            </button>
            {npLinkDropOpen && (
              <LinkQuotePicker
                onClose={() => setNpLinkDropOpen(false)}
                candidates={quotes
                  .filter(x => x.mailType === 'PRESUPUESTO')
                  .sort((a, b) => {
                    // Los del mismo cliente primero — son los candidatos probables
                    const am = a.client && a.client === o.client ? 0 : 1;
                    const bm = b.client && b.client === o.client ? 0 : 1;
                    return am !== bm ? am - bm : new Date(b.ingreso) - new Date(a.ingreso);
                  })}
                title="Vincular presupuesto"
                subtitle={`${o.code} · ${o.clientName || cli?.name || 'sin cliente'}`}
                emptyText="No hay presupuestos disponibles"
                clientCode={o.client}
                clientName={o.clientName || cli?.name}
                onConfirm={handleNpLinkPresupuesto}
                saving={npLinkSaving}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Tarjeta de presupuesto vinculado (OC y NP) ── */}
      {(() => {
        const linked = isQuoteSource ? linkedPres : (orderDetail?.fromQuote || null);
        if (!linked) return null;
        const stg = STAGES_F1.find(s => s.id === linked.stage);
        return (
          <div className="mx-6 mb-3 px-4 py-3 bg-white border border-line rounded-xl flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
              <Icon name="file-text" size={15}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-0.5">Presupuesto vinculado</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="mono text-[13px] font-semibold text-ink-900">{linked.code}</span>
                {linked.flexxusCode && <Badge tone="slate"><span className="mono">{linked.flexxusCode}</span></Badge>}
                {stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : linked.stage ? <Badge tone="gray" dot>{linked.stage}</Badge> : null}
                {linked.amount != null && <span className="text-[12px] mono text-ink-500">{fmtMoney(linked.amount, linked.currency || npCurrency, 2)}</span>}
              </div>
            </div>
            <button className="btn-ghost text-[12px] py-1 px-2.5 shrink-0"
              onClick={() => openModal('quoteDetail', { code: linked.code })}>
              Ver <Icon name="arrow-right" size={11}/>
            </button>
          </div>
        );
      })()}

      {/* ── Tabs ── */}
      <TabBar
        tabs={[
          { id:'resumen',  label:'Resumen' },
          ...(npItems.length > 0 ? [{ id:'items-np', label:'Ítems', count: npItems.length }] : []),
          { id:'historial',label:'Historial', count: loading ? null : history.length },
          { id:'notas',    label:'Notas',     count: loading ? null : notes.length },
          { id:'adj',      label:'Adjuntos',  count: loading ? null : attachments.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ── Tab: Ítems NP (editable, reutiliza OCItemsTab) ── */}
      {tab === 'items-np' && (() => {
        const npQuoteId = isQuoteSource ? o.id : notaPedido?.id;
        if (!npQuoteId) return <div className="p-6 text-center text-ink-400">Sin ítems de NP</div>;
        return <OCItemsTab q={{ id: npQuoteId, mailType: 'NOTA_PEDIDO', currency: npCurrency }} detailItems={npItems} setDetailItems={setNpItems}/>;
      })()}

      {tab === 'resumen' && (() => {
        // NP (quote-source O order-source con NP) → layout tipo Presupuesto
        // OC real → KPIs + logística + documentación
        const npFlexxusCode = o.flexxus;
        const linkedPresupuesto = isQuoteSource ? linkedPres : (orderDetail?.fromQuote || null);
        const curSymbol = npCurrency === 'ARS' ? 'AR$' : 'U$S';

        if (isNP) return (
          <div className="p-6">
            <div className="grid grid-cols-3 gap-5">
              {/* Columna izquierda: tabla parseada */}
              <div className="col-span-2 bg-white border border-line rounded-xl p-5">
                <div className="text-sm font-semibold mb-3 text-ink-900">{npFlexxusCode ? 'Nota de Pedido Flexxus' : 'Nota de Pedido'}</div>
                <table className="w-full text-[12.5px]">
                  <thead><tr className="text-left text-ink-500">
                    <th className="font-semibold pb-2">SKU</th>
                    <th className="font-semibold pb-2">Descripción</th>
                    <th className="font-semibold pb-2 text-right">Cant.</th>
                    <th className="font-semibold pb-2 text-right">P. Unit. ({curSymbol})</th>
                    <th className="font-semibold pb-2 text-right">Total ({curSymbol})</th>
                  </tr></thead>
                  <tbody>
                    {npItems.filter(i => i.accepted !== false).map((it, idx) => (
                      <tr key={it.id || idx} className="border-t border-line group">
                        <td className="py-2 mono text-ink-700">
                          <CatalogBadge sku={it.sku} description={it.description}/>
                        </td>
                        <td className="py-2">{it.description}</td>
                        <td className="py-2 mono text-right">{it.quantity}</td>
                        <td className="py-2 mono text-right">{it.unitPrice != null ? it.unitPrice.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                        <td className="py-2 mono text-right font-semibold">{it.total != null ? it.total.toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {npBreakdown?.subtotalNeto != null && (
                      <tr className="border-t border-line">
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Subtotal neto</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(npBreakdown.subtotalNeto, npCurrency, 2)}
                        </td>
                      </tr>
                    )}
                    {npBreakdown?.ivaAmount != null && npBreakdown.ivaAmount > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">IVA 21%</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(npBreakdown.ivaAmount, npCurrency, 2)}
                        </td>
                      </tr>
                    )}
                    {npBreakdown?.totalPercepciones != null && npBreakdown.totalPercepciones > 0 && (
                      <tr>
                        <td colSpan="4" className="text-right py-1.5 text-[11px] text-ink-400">Percepciones</td>
                        <td className="text-right py-1.5 mono text-[12px] text-ink-500">
                          {fmtMoney(npBreakdown.totalPercepciones, npCurrency, 2)}
                        </td>
                      </tr>
                    )}
                    {(npBreakdown?.total != null) && (
                      <tr className="border-t-2 border-ink-900">
                        <td colSpan="4" className="text-right pt-3 font-bold">TOTAL</td>
                        <td className="text-right pt-3 mono font-bold text-base">
                          {fmtMoney(npBreakdown.total, npCurrency, 2)}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {/* Columna derecha: resumen + presupuesto vinculado */}
              <div className="space-y-4">
                <div className="bg-white border border-line rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Resumen</div>
                  <ul className="text-[12.5px] space-y-1.5">
                    <li className="flex justify-between"><span className="text-ink-500">Cliente</span><span className="font-medium">{cli?.name || '—'}</span></li>
                    {npFlexxusCode && <li className="flex justify-between"><span className="text-ink-500">NP Flexxus</span><span className="mono">{npFlexxusCode}</span></li>}
                    {!isQuoteSource && orderDetail?.clientOCCode && <li className="flex justify-between"><span className="text-ink-500">OC Cliente</span><span className="mono">{orderDetail.clientOCCode}</span></li>}
                    {npBreakdown?.subtotalNeto != null && (
                      <li className="flex justify-between"><span className="text-ink-500">Subtotal neto</span><span className="mono">{fmtMoney(npBreakdown.subtotalNeto, npCurrency, 2)}</span></li>
                    )}
                    {npBreakdown?.ivaAmount != null && npBreakdown.ivaAmount > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">IVA 21%</span><span className="mono">{fmtMoney(npBreakdown.ivaAmount, npCurrency, 2)}</span></li>
                    )}
                    {npBreakdown?.totalPercepciones != null && npBreakdown.totalPercepciones > 0 && (
                      <li className="flex justify-between"><span className="text-ink-500">Percepciones</span><span className="mono">{fmtMoney(npBreakdown.totalPercepciones, npCurrency, 2)}</span></li>
                    )}
                    {npBreakdown?.total != null && (
                      <li className="flex justify-between border-t border-line pt-1.5 mt-0.5">
                        <span className="font-semibold text-ink-800">Total</span>
                        <span className="mono font-semibold">{fmtMoney(npBreakdown.total, npCurrency)}</span>
                      </li>
                    )}
                    <li className="flex justify-between"><span className="text-ink-500">Ítems</span><span>{npItems.filter(i=>i.accepted!==false).length} registrados</span></li>
                  </ul>
                </div>

              </div>
            </div>
          </div>
        );

        // Sin NP → mostrar KPIs + Logística + Documentación (layout original)
        const monto = isQuoteSource
          ? (npBreakdown?.total ?? npItems.reduce((s,i)=>s+(i.total||0),0))
          : (orderDetail?.fromQuote?.amount || null);
        const cur = isQuoteSource ? npCurrency : (orderDetail?.fromQuote?.currency || 'USD');
        const createdDate = isQuoteSource ? new Date(o.fecha) : (orderDetail?.createdAt ? new Date(orderDetail.createdAt) : null);
        const stageDate = isQuoteSource ? null : (orderDetail?.stageChangedAt ? new Date(orderDetail.stageChangedAt) : null);
        const daysSince = (d) => d ? Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)) : null;
        const daysProcess = daysSince(createdDate);
        const daysStage = daysSince(stageDate);
        const estDate = !isQuoteSource && orderDetail?.estimatedDate ? new Date(orderDetail.estimatedDate) : null;
        const daysUntilEst = estDate ? Math.ceil((estDate.getTime() - Date.now()) / 86400000) : null;

        const od = orderDetail || {};
        const canEdit = !isQuoteSource;

        const startFieldEdit = (field, val) => { setEditField(field); setEditVal(val || ''); };
        const saveField = async (field, value) => {
          setSavingField(true);
          try {
            await CrmApi.updateOrder(o.id, { [field]: value || null });
            setOrderDetail(prev => prev ? { ...prev, [field]: value || null } : prev);
            const listMap = { trackingNumber: 'guia', carrier: 'transp', deliveryType: 'entrega' };
            if (listMap[field]) setOrders(prev => prev.map(x => x.id === o.id ? { ...x, [listMap[field]]: value || '' } : x));
          } catch (err) { pushToast(err.message || 'Error al guardar', 'bad'); }
          setSavingField(false);
          setEditField(null);
        };
        const toggleBool = async (field) => {
          const newVal = !od[field];
          const dateField = field === 'invoiceIssued' ? 'invoiceDate' : 'waybillDate';
          const dateVal = newVal ? new Date().toISOString() : null;
          try {
            await CrmApi.updateOrder(o.id, { [field]: newVal, [dateField]: dateVal });
            setOrderDetail(prev => prev ? { ...prev, [field]: newVal, [dateField]: dateVal } : prev);
          } catch (err) { pushToast(err.message || 'Error al guardar', 'bad'); }
        };

        const EditRow = ({ label, field, value, type }) => {
          if (!canEdit) return (
            <div className="flex justify-between items-center py-2 border-b border-ink-100 last:border-b-0">
              <span className="text-[12.5px] text-ink-500">{label}</span>
              <span className="text-[12.5px] font-medium mono">{value || '—'}</span>
            </div>
          );
          if (editField === field) return (
            <div className="flex justify-between items-center py-1.5 border-b border-ink-100 last:border-b-0 gap-2">
              <span className="text-[12.5px] text-ink-500 shrink-0">{label}</span>
              {type === 'select' ? (
                <select autoFocus className="text-[12.5px] border border-brand rounded-lg px-2 py-1 bg-white"
                  value={editVal} onChange={e => saveField(field, e.target.value)}>
                  <option value="AMBA">AMBA</option><option value="Interior">Interior</option>
                </select>
              ) : (
                <input autoFocus type={type || 'text'}
                  className="text-[12.5px] border border-brand rounded-lg px-2 py-1 w-40 text-right mono"
                  value={editVal} onChange={e => setEditVal(e.target.value)}
                  onBlur={() => saveField(field, editVal)}
                  onKeyDown={e => { if (e.key === 'Enter') saveField(field, editVal); if (e.key === 'Escape') setEditField(null); }}/>
              )}
            </div>
          );
          return (
            <div className="flex justify-between items-center py-2 border-b border-ink-100 last:border-b-0 group cursor-pointer hover:bg-surface/50 -mx-1 px-1 rounded"
              onClick={() => startFieldEdit(field, type === 'date' && value ? new Date(value).toISOString().slice(0,10) : (value || ''))}>
              <span className="text-[12.5px] text-ink-500">{label}</span>
              <span className="text-[12.5px] font-medium mono flex items-center gap-1.5">
                {type === 'date' && value ? fmtDate(value) : (value || '—')}
                <Icon name="pencil" size={11} className="text-ink-300 opacity-0 group-hover:opacity-100"/>
              </span>
            </div>
          );
        };

        const ToggleRow = ({ label, field, dateField }) => {
          const isOn = !!od[field];
          const dateVal = od[dateField];
          return (
            <div className="flex justify-between items-center py-2 border-b border-ink-100 last:border-b-0">
              <span className="text-[12.5px] text-ink-500">{label}</span>
              <div className="flex items-center gap-2">
                {isOn && dateVal && <span className="text-[11px] text-ink-400 mono">{fmtDate(dateVal)}</span>}
                {canEdit ? (
                  <button onClick={() => toggleBool(field)}
                    className={cx('w-9 h-5 rounded-full transition-colors relative', isOn ? 'bg-emerald-500' : 'bg-ink-200')}>
                    <span className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                      isOn ? 'translate-x-4' : 'translate-x-0.5')}/>
                  </button>
                ) : (
                  <span className={cx('text-[12px] font-semibold', isOn ? 'text-emerald-600' : 'text-ink-400')}>
                    {isOn ? 'Sí' : 'No'}
                  </span>
                )}
              </div>
            </div>
          );
        };

        return (
        <div className="p-6 space-y-5">
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border border-line rounded-xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1">Monto</div>
              <div className="text-lg font-bold text-ink-900 mono">{monto != null ? fmtMoney(monto, cur, 2) : '—'}</div>
            </div>
            <div className="bg-white border border-line rounded-xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1">Días en proceso</div>
              <div className={cx('text-lg font-bold mono', daysProcess > 14 ? 'text-amber-600' : 'text-ink-900')}>
                {daysProcess != null ? daysProcess : '—'}
              </div>
            </div>
            <div className="bg-white border border-line rounded-xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1">Días en etapa</div>
              <div className={cx('text-lg font-bold mono', daysStage > 7 ? 'text-amber-600' : 'text-ink-900')}>
                {daysStage != null ? daysStage : '—'}
              </div>
            </div>
            <div className="bg-white border border-line rounded-xl p-4 text-center">
              <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1">Entrega estimada</div>
              {estDate ? (
                <div className={cx('text-lg font-bold mono', daysUntilEst < 0 ? 'text-red-600' : daysUntilEst <= 3 ? 'text-amber-600' : 'text-emerald-700')}>
                  {daysUntilEst < 0 ? `${Math.abs(daysUntilEst)}d atrás` : daysUntilEst === 0 ? 'Hoy' : `${daysUntilEst}d`}
                </div>
              ) : <div className="text-lg font-bold text-ink-300">—</div>}
            </div>
          </div>

          {/* ── Logística + Documentación ── */}
          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-3 flex items-center gap-2">
                <Icon name="truck" size={14} className="text-ink-400"/>Logística
              </div>
              <EditRow label="Tipo entrega" field="deliveryType" value={od.deliveryType || o.entrega} type="select"/>
              <EditRow label="Transportista" field="carrier" value={od.carrier || ''}/>
              <EditRow label="Nº Guía / Tracking" field="trackingNumber" value={od.trackingNumber || ''}/>
              <EditRow label="Fecha estimada" field="estimatedDate" value={od.estimatedDate} type="date"/>
            </div>
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-3 flex items-center gap-2">
                <Icon name="file-text" size={14} className="text-ink-400"/>Documentación
              </div>
              <ToggleRow label="Factura emitida" field="invoiceIssued" dateField="invoiceDate"/>
              <ToggleRow label="Remito conformado" field="waybillReceived" dateField="waybillDate"/>
              <EditRow label="OC Cliente" field="clientOCCode" value={od.clientOCCode || ''}/>
              <div className="flex justify-between items-center py-2 border-b border-ink-100 last:border-b-0">
                <span className="text-[12.5px] text-ink-500">NP Flexxus</span>
                <span className="text-[12.5px] font-medium mono">{o.flexxus && o.flexxus !== '—' ? o.flexxus : '—'}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-[12.5px] text-ink-500">Presupuesto</span>
                {(() => {
                  const pCode = isQuoteSource ? linkedPres?.code : (orderDetail?.fromQuote?.code || o.fromQuote);
                  return pCode ? (
                    <button className="text-[12.5px] mono text-brand hover:underline font-semibold"
                      onClick={() => { onClose(); setTimeout(()=>openModal('quoteDetail',{code: pCode}),80); }}>{pCode}</button>
                  ) : <span className="text-[12.5px] text-ink-400">—</span>;
                })()}
              </div>
            </div>
          </div>

          {/* ── Dirección de entrega ── */}
          {cli && (
            <div className="bg-white border border-line rounded-xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-3 flex items-center gap-2">
                <Icon name="map-pin" size={14} className="text-ink-400"/>Dirección de entrega
              </div>
              <div className="grid grid-cols-3 gap-4 text-[12.5px]">
                <div>
                  <div className="text-ink-500 mb-0.5">Dirección</div>
                  <div className="text-ink-900 font-medium">{cli.address || '—'}</div>
                  <div className="text-ink-500 text-[11.5px] mt-0.5">{[cli.city, cli.prov].filter(Boolean).join(' — ') || '—'}</div>
                </div>
                <div>
                  <div className="text-ink-500 mb-0.5">Teléfono</div>
                  <div className="text-ink-900 mono">{cli.phone || '—'}</div>
                </div>
                <div>
                  <div className="text-ink-500 mb-0.5">Email</div>
                  <div className="text-ink-900 truncate">{cli.email || '—'}</div>
                  {cli.zone && (
                    <div className="text-ink-500 text-[11.5px] mt-1">Zona: <span className="text-ink-700">{cli.zone}</span></div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Tab: Historial ── */}
      {tab === 'historial' && (
        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Cargando historial…</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-ink-400 text-[13px]">Sin movimientos registrados</div>
          ) : (
            <div className="space-y-0">
              {history.map((a, i) => {
                const iconMap = {
                  CREATED:      { name:'plus-circle',    cls:'text-emerald-600 bg-emerald-50' },
                  STAGE_CHANGE: { name:'arrow-right',    cls:'text-brand bg-brandSoft' },
                  NOTE_ADDED:   { name:'message-square', cls:'text-ink-500 bg-surface' },
                  ASSIGNED:     { name:'user',           cls:'text-orange-600 bg-orange-50' },
                  LINKED:       { name:'link',           cls:'text-violet-600 bg-violet-50' },
                  REMINDER_SENT:{ name:'bell',           cls:'text-amber-600 bg-amber-50' },
                  EMAIL_SENT:   { name:'send',           cls:'text-blue-600 bg-blue-50' },
                };
                const ic = iconMap[a.action] || { name:'activity', cls:'text-ink-500 bg-surface' };
                const isLast = i === history.length - 1;
                const isFromLinked = a._fromCode && a._fromCode !== code;
                const linkedTypeTone = a._fromType === 'SOLICITUD' ? 'sky' : a._fromType === 'PRESUPUESTO' ? 'blue' : a._fromType === 'NOTA_PEDIDO' ? 'purple' : 'gray';
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
                          <span className="mono">{a.createdAt ? fmtDateTime(a.createdAt) : ''}</span>
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
          {mentionedUsers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {mentionedUsers.map(u => (
                <span key={u.id} className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-brandSoft text-brand text-[11px] font-medium">
                  @{u.name.split(' ')[0]}
                  <button onClick={()=>setMentionedUsers(ms=>ms.filter(x=>x.id!==u.id))} className="hover:opacity-60"><Icon name="x" size={10}/></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <div className="relative shrink-0 self-end">
              <button className="w-9 h-9 rounded-lg border border-line hover:bg-surface flex items-center justify-center text-ink-500"
                onClick={()=>setMentionPickerOpen(o=>!o)}>
                <Icon name="at-sign" size={14}/>
              </button>
              {mentionPickerOpen && (
                <MentionPicker users={users} excludeId={currentUserId}
                  onPick={(u)=>{
                    setMentionedUsers(ms => ms.some(x=>x.id===u.id) ? ms : [...ms, u]);
                    setNewNote(t => (t && !/\s$/.test(t) ? t+' ' : t) + `@${u.name} `);
                    setMentionPickerOpen(false);
                  }}
                  onClose={()=>setMentionPickerOpen(false)}/>
              )}
            </div>
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
                const fileUrl = authUrl(`/uploads/attachments/${a.filename}`);
                const displayName = a.originalName || a.filename.replace(/^[0-9a-f-]{36}-(\d{13}-)?/i, '');
                return (
                  <div key={a.id || i} className="flex items-center gap-3 p-3 border border-line rounded-xl hover:bg-surface">
                    <span className={cx('w-8 h-8 rounded-lg text-white text-[10px] font-bold inline-flex items-center justify-center uppercase shrink-0', extBg(ext))}>
                      {ext}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-ink-900 truncate">{displayName}</div>
                      <div className="text-[11px] text-ink-400">{fmtBytes(a.size)}{a.createdAt ? ` · ${fmtDate(a.createdAt)}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {ext === 'pdf' && (
                        <button className="btn-ghost text-xs py-1 px-2"
                          onClick={() => setPdfPreview({ url: fileUrl, filename: displayName })}>
                          <Icon name="eye" size={12}/>Ver
                        </button>
                      )}
                      <a href={fileUrl} download={displayName} className="btn-ghost text-xs py-1 px-2">
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
    {pdfPreview && (() => {
      const pdfDisplayName = pdfPreview.filename || '';
      return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{background:'rgba(0,0,0,0.85)'}}>
          <div className="flex items-center gap-3 px-4 py-3" style={{background:'#004669'}}>
            <button onClick={() => setPdfPreview(null)} className="text-white/70 hover:text-white">
              <Icon name="x" size={18}/>
            </button>
            <span className="text-white text-[13px] font-medium truncate flex-1">{pdfDisplayName}</span>
            <a href={pdfPreview.url} download={pdfDisplayName}
              className="text-white/70 hover:text-white flex items-center gap-1.5 text-[13px]">
              <Icon name="download" size={15}/>Descargar
            </a>
          </div>
          <div className="flex-1 min-h-0">
            <iframe src={pdfPreview.url} className="w-full h-full border-0" title={pdfDisplayName}/>
          </div>
        </div>
      );
    })()}
    {emailModalOpen && (
      <SendEmailModal
        quote={{
          ...o,
          clientName:  cli?.name  || o.clientName || '',
          clientEmail: cli?.email || '',
          sellerName:  sel?.name  || '',
          flexxus:     o.flexxus  || '',
          emailSubject: o.emailSubject || '',
        }}
        attachments={attachments}
        onClose={() => setEmailModalOpen(false)}
        onSent={() => {}}
      />
    )}
    </>
  );
}

Object.assign(window, { QuoteDetail, OrderDetail, Field, TabBar });
