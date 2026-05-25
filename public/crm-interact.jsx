/* CRM Interactions: global store, toast system, modals, filters, search.
   Wraps the data arrays from crm-data.jsx with React state so mutations re-render.
   Exposes a <AppProvider> and useApp() hook. */

const { createContext, useContext, useReducer, useMemo, useCallback, useRef, useEffect: useEff, useState: useS } = React;

// ---------- Store ----------
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

const PROVINCES = [
  'Buenos Aires','CABA','Catamarca','Chaco','Chubut','Córdoba','Corrientes','Entre Ríos','Formosa',
  'Jujuy','La Pampa','La Rioja','Mendoza','Misiones','Neuquén','Río Negro','Salta','San Juan','San Luis',
  'Santa Cruz','Santa Fe','Santiago del Estero','Tierra del Fuego','Tucumán'
];
const ZONES = ['AMBA Norte','AMBA Sur','Interior Oeste','Interior Norte','Interior Este','Interior Sur','Cuyo','Patagonia'];
const ACTIVITIES = ['Constructora','Industrias','Contratista','Distribuidor Materiales','Casa de Electricidad/Ferretería','Fibra Óptica','Solar','Tableros eléctricos','Obras eléctricas','Distribución eléctrica','Cooperativa eléctrica'];
const ORIGINS = ['Mail','WhatsApp','Portal de licitación','Teléfono'];
const REJECT_REASONS = ['Precio','Plazo de entrega','Condición de pago','Competencia','Sin respuesta','Otro'];

function AppProvider({ children }) {
  const [quotes, setQuotes]   = useS(() => [...QUOTES]);
  const [orders, setOrders]   = useS(() => [...ORDERS]);
  const [clients, setClients] = useS(() => [...CLIENTS]);
  const [users, setUsers]     = useS(() => [...USERS]);
  const [activity, setActivity] = useS(() => [...ACTIVITY]);
  const [comments, setComments] = useS(() => ({...COMMENTS}));
  const [notifications, setNotifications] = useS([]);

  const NOTIF_STORAGE_KEY = 'crm_notif_read_ids';
  const getReadIds = () => {
    try { return new Set(JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || '[]')); }
    catch { return new Set(); }
  };
  const saveReadId = (id) => {
    const ids = getReadIds(); ids.add(id);
    // Guardar solo los últimos 500 para no inflar localStorage
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify([...ids].slice(-500)));
  };
  const saveAllReadIds = (ids) => {
    const existing = getReadIds();
    ids.forEach(id => existing.add(id));
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify([...existing].slice(-500)));
  };

  useEff(() => {
    CrmApi.getActivity(50).then(activities => {
      const readIds = getReadIds();
      const notifs = activities.map(a => {
        let kind = 'info';
        if (a.action === 'STAGE_CHANGE') {
          if (a.detail?.includes('rechazada')) kind = 'bad';
          else if (a.detail?.includes('aceptada')) kind = 'ok';
          else kind = 'info';
        } else if (a.action === 'CREATED') {
          kind = 'ok';
        } else if (a.action === 'NOTE_ADDED') {
          kind = 'info';
        } else if (a.action === 'ASSIGNED') {
          kind = 'info';
        }
        const ref = a.quoteCode
          ? { kind: 'quote', code: a.quoteCode }
          : a.orderCode
            ? { kind: 'order', code: a.orderCode }
            : null;
        // Marcar como leída si el ID ya estaba en localStorage
        return { id: a.id, kind, text: a.detail, at: a.createdAt, read: readIds.has(a.id), ref, userName: a.userName };
      });
      setNotifications(notifs);
    }).catch(() => setNotifications([]));
  }, []);

  // Quote-level filters (shared by board)
  const [quoteFilters, setQuoteFilters] = useS({ seller:'', client:'', period:'30d', zone:'', activity:'', min:'', max:'' });
  const [orderFilters, setOrderFilters] = useS({ seller:'', client:'', period:'30d', min:'', max:'' });

  // Logged-in user (for notes)
  const [currentUserId, setCurrentUserId] = useS('');
  // role view
  const [roleKey, setRoleKey] = useS('admin');

  // ---- Toasts ----
  const [toasts, setToasts] = useS([]);
  const toastIdRef = useRef(0);
  const pushToast = useCallback((text, tone='ok') => {
    const id = ++toastIdRef.current;
    setToasts(ts => [...ts, { id, text, tone }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3200);
  }, []);

  // ---- ID generators ----
  const nextQuoteCode = useCallback((qs) => {
    const nums = qs.map(q => parseInt(q.code.split('-').pop(),10)).filter(n => !isNaN(n));
    const next = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
    return `COT-${new Date().getFullYear()}-${next}`;
  }, []);
  const nextOrderCode = useCallback((os) => {
    const nums = os.map(o => parseInt(o.code.split('-').pop(),10)).filter(n => !isNaN(n));
    const next = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
    return `OC-${new Date().getFullYear()}-${next}`;
  }, []);
  const nextClientCode = useCallback((cs) => {
    const nums = cs.map(c => parseInt(c.code.split('-').pop(),10)).filter(n => !isNaN(n));
    const next = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
    return `CLI-${next}`;
  }, []);

  // ---- Mutators ----
  const addQuote = useCallback((partial) => {
    setQuotes(qs => {
      const code = nextQuoteCode(qs);
      const q = {
        code,
        client: partial.client,
        seller: partial.seller,
        stage: 'recibida',
        ingreso: partial.ingreso || new Date().toISOString().slice(0,10),
        dias: 0,
        monto: partial.monto || null,
        adj: partial.file ? 1 : 0,
        notas: 0,
        flexxus: '',
        origin: partial.origin,
        observaciones: partial.observaciones || '',
        fechaLimite: partial.fechaLimite,
      };
      pushToast(`Cotización ${code} creada correctamente`);
      return [q, ...qs];
    });
  }, [nextQuoteCode, pushToast]);

  const addOrder = useCallback((partial) => {
    setOrders(os => {
      const code = nextOrderCode(os);
      const o = {
        code,
        client: partial.client,
        seller: partial.seller,
        stage: 'oc',
        fromQuote: partial.fromQuote,
        flexxus: partial.flexxus || '—',
        fecha: partial.fecha || new Date().toISOString().slice(0,10),
        ocCliente: partial.ocCliente,
      };
      pushToast(`Orden de compra ${code} creada`);
      return [o, ...os];
    });
  }, [nextOrderCode, pushToast]);

  const addClient = useCallback((partial) => {
    setClients(cs => {
      const code = nextClientCode(cs);
      const c = { code, ...partial };
      pushToast(`Cliente ${partial.name} registrado`);
      return [c, ...cs];
    });
  }, [nextClientCode, pushToast]);

  const updateQuote = useCallback((code, patch) => {
    setQuotes(qs => qs.map(q => q.code === code ? { ...q, ...patch } : q));
  }, []);
  const updateOrder = useCallback((code, patch) => {
    setOrders(os => os.map(o => o.code === code ? { ...o, ...patch } : o));
  }, []);

  const moveQuoteStage = useCallback(async (code, stageId) => {
    const stg = STAGES_F1.find(s => s.id === stageId);
    const quote = quotes.find(q => q.code === code);
    if (!quote) return;
    const prevStage = quote.stage;
    // Optimistic update
    setQuotes(qs => qs.map(q => q.code === code ? { ...q, stage: stageId } : q));
    try {
      await CrmApi.changeQuoteStage(quote.id, stageId);
      pushToast(`Etapa actualizada a ${stg?.label}`);
      if (stageId === 'aceptada') {
        const freshOrders = await CrmApi.getOrders();
        setOrders(freshOrders);
      }
    } catch (err) {
      setQuotes(qs => qs.map(q => q.code === code ? { ...q, stage: prevStage } : q));
      pushToast(err.message || 'Error al actualizar etapa', 'bad');
    }
  }, [quotes, pushToast]);

  const moveOrderStage = useCallback(async (code, stageId) => {
    const stg = STAGES_F2.find(s => s.id === stageId);
    const order = orders.find(o => o.code === code);
    if (!order) return;
    const prevStage = order.stage;
    // Optimistic update
    setOrders(os => os.map(o => o.code === code ? { ...o, stage: stageId } : o));
    try {
      await CrmApi.changeOrderStage(order.id, stageId);
      pushToast(`Etapa actualizada a ${stg?.label}`);
    } catch (err) {
      setOrders(os => os.map(o => o.code === code ? { ...o, stage: prevStage } : o));
      pushToast(err.message || 'Error al actualizar etapa', 'bad');
    }
  }, [orders, pushToast]);

  const addComment = useCallback((code, text) => {
    setComments(cs => {
      const prev = cs[code] || [];
      return { ...cs, [code]: [...prev, { by: currentUserId, at: new Date().toISOString(), text }] };
    });
    // bump note count on quote
    setQuotes(qs => qs.map(q => q.code === code ? { ...q, notas: (q.notas||0)+1 } : q));
    pushToast('Nota agregada');
  }, [currentUserId, pushToast]);

  const inviteUser = useCallback((partial) => {
    setUsers(us => [...us, { id: `u-${Date.now().toString(36)}`, ...partial }]);
    pushToast(`Invitación enviada a ${partial.email}`);
  }, [pushToast]);

  const markNotificationRead = useCallback((id) => {
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, read:true } : n));
    saveReadId(id);
  }, []);
  const markAllNotificationsRead = useCallback(() => {
    setNotifications(ns => {
      saveAllReadIds(ns.map(n => n.id));
      return ns.map(n => ({ ...n, read:true }));
    });
  }, []);

  // ---- Modals stack ----
  const [modals, setModals] = useS([]); // array of { kind, props }
  const openModal = useCallback((kind, props={}) => setModals(m => [...m, { kind, props }]), []);
  const closeModal = useCallback(() => setModals(m => m.slice(0, -1)), []);
  const closeAllModals = useCallback(() => setModals([]), []);

  const value = {
    quotes, setQuotes, orders, setOrders, clients, setClients, users, activity, comments, notifications,
    quoteFilters, setQuoteFilters, orderFilters, setOrderFilters,
    currentUserId, setCurrentUserId, roleKey, setRoleKey,
    addQuote, addOrder, addClient, updateQuote, updateOrder,
    moveQuoteStage, moveOrderStage, addComment, inviteUser,
    markNotificationRead, markAllNotificationsRead,
    pushToast, toasts,
    openModal, closeModal, closeAllModals, modals,
  };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <ModalHost/>
      <ToastHost/>
    </AppCtx.Provider>
  );
}

// ---------- Toast Host ----------
function ToastHost() {
  const { toasts } = useApp();
  const iconFor = t => t==='ok'?'check-circle':t==='bad'?'alert-circle':t==='warn'?'alert-triangle':'info';
  const toneFor = t => t==='ok'?'bg-emerald-600':t==='bad'?'bg-red-600':t==='warn'?'bg-orange-500':'bg-navy-900';
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={cx('pointer-events-auto modal-enter text-white px-4 py-3 rounded-xl shadow-pop flex items-center gap-2.5 min-w-[280px] max-w-sm', toneFor(t.tone))}>
          <Icon name={iconFor(t.tone)} size={16}/>
          <div className="text-[13px] font-medium leading-snug flex-1">{t.text}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Modal primitive ----------
function Modal({ onClose, title, subtitle, width=560, children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-pop modal-enter flex flex-col max-h-[90vh]" style={{ width }}>
        <div className="px-6 py-4 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            {subtitle && <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{subtitle}</div>}
            <h3 className="text-lg font-bold text-ink-900 mt-0.5 truncate">{title}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-500 shrink-0"><Icon name="x" size={16}/></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-3 border-t border-line bg-surface flex items-center justify-end gap-2 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Form primitives ----------
function Label({ children, required }) {
  return <label className="block text-[11.5px] font-semibold text-ink-700 mb-1.5">{children}{required && <span className="text-bad ml-0.5">*</span>}</label>;
}
function FormGroup({ label, required, children, hint, error, cols=1 }) {
  return (
    <div className={cols===2 ? 'col-span-2' : ''}>
      {label && <Label required={required}>{label}</Label>}
      {children}
      {hint && <div className="text-[11px] text-ink-500 mt-1">{hint}</div>}
      {error && <div className="text-[11px] text-bad mt-1">{error}</div>}
    </div>
  );
}
function Select({ value, onChange, options, placeholder='Seleccionar…', className='' }) {
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} className={cx('inp w-full cursor-pointer', className)}>
      <option value="" disabled>{placeholder}</option>
      {options.map(o => (
        <option key={typeof o==='string'?o:o.value} value={typeof o==='string'?o:o.value}>
          {typeof o==='string'?o:o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Modal Host ----------
function ModalHost() {
  const { modals } = useApp();
  return (
    <>
      {modals.map((m, i) => {
        const K = MODAL_REGISTRY[m.kind];
        if (!K) return null;
        return <K key={i} {...m.props}/>;
      })}
    </>
  );
}

// ================================================================
// ----------- MODALS ---------------------------------------------
// ================================================================

// --- 1. Nueva Cotización ---
function NewQuoteModal({ defaultClient }) {
  const { closeModal, addQuote, clients, users, setQuotes, pushToast, currentUserId } = useApp();
  const [form, setForm] = useS({
    client: defaultClient || '',
    seller: currentUserId || '',
    ingreso: new Date().toISOString().slice(0,10),
    fechaLimite: '',
    monto: '',
    origin: 'Mail',
    observaciones: '',
    fileName: '',
    fileObj: null,
  });
  const [saving, setSaving] = useS(false);
  const set = (k,v) => setForm(f => ({...f, [k]: v}));
  const canSubmit = form.client && form.seller;

  const submit = async () => {
    const client = clients.find(c => c.code === form.client);
    const sourceMap = { 'Mail': 'EMAIL', 'WhatsApp': 'WHATSAPP' };
    const source = sourceMap[form.origin] || 'MANUAL';
    setSaving(true);
    try {
      const created = await CrmApi.createQuote({
        clientId: client?.id || null,
        sellerId: form.seller || null,
        amount: form.monto ? parseFloat(form.monto) : null,
        source,
        deadline: form.fechaLimite || null,
      });
      // Upload attachment if one was selected
      if (form.fileObj && created?.id) {
        try {
          await CrmApi.uploadAttachments(created.id, [form.fileObj]);
        } catch {
          pushToast('Cotización creada, pero falló la subida del archivo', 'bad');
        }
      }
      const freshQuotes = await CrmApi.getQuotes();
      setQuotes(freshQuotes);
      pushToast('Cotización creada correctamente');
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al crear cotización', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={closeModal} subtitle="Fase 1 · Solicitud Recibida" title="Nueva cotización" width={620}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal} disabled={saving}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit || saving} onClick={submit} style={(!canSubmit || saving)?{opacity:.45, cursor:'not-allowed'}:{}}>
            <Icon name={saving ? 'loader' : 'plus'} size={13}/>
            {saving ? 'Guardando…' : 'Crear cotización'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <FormGroup label="Cliente" required cols={2}>
          <Select value={form.client} onChange={v=>set('client',v)} placeholder="Buscar cliente…"
            options={clients.map(c => ({ value:c.code, label:`${c.name} — ${c.city}, ${c.prov}` }))}/>
        </FormGroup>
        <FormGroup label="Vendedor asignado" required>
          <Select value={form.seller} onChange={v=>set('seller',v)}
            options={users.filter(u=>u.role==='Vendedor'||u.role==='Administrador').map(u => ({ value:u.id, label:u.name }))}/>
        </FormGroup>
        <FormGroup label="Origen">
          <Select value={form.origin} onChange={v=>set('origin',v)} options={ORIGINS}/>
        </FormGroup>
        <FormGroup label="Fecha de ingreso">
          <input type="date" className="inp w-full" value={form.ingreso} onChange={e=>set('ingreso',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Fecha límite de armado">
          <input type="date" className="inp w-full" value={form.fechaLimite} onChange={e=>set('fechaLimite',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Monto estimado (ARS)" hint="Opcional — se completa al armar el presupuesto" cols={2}>
          <input type="number" className="inp w-full" placeholder="Ej: 45200" value={form.monto} onChange={e=>set('monto',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Observaciones" cols={2}>
          <textarea rows="3" className="inp w-full resize-none" placeholder="Contexto del pedido, urgencia, condiciones particulares…"
            value={form.observaciones} onChange={e=>set('observaciones',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Adjuntar archivo" cols={2}>
          <label className="flex items-center gap-3 px-3 py-2.5 border-2 border-dashed border-line rounded-lg cursor-pointer hover:bg-surface">
            <Icon name="paperclip" size={14} className="text-ink-500"/>
            <span className="text-[12.5px] text-ink-700 flex-1">
              {form.fileName || 'Seleccionar archivo (PDF, XLSX, imagen…)'}
            </span>
            <span className="btn-ghost text-xs py-1 px-2">Buscar</span>
            <input type="file" className="hidden" onChange={e => {
              const f = e.target.files[0];
              setForm(prev => ({...prev, fileName: f?.name || '', fileObj: f || null}));
            }}/>
          </label>
        </FormGroup>
      </div>
    </Modal>
  );
}

// --- 2. Nueva Nota de Pedido ---
function NewOrderModal() {
  const { closeModal, quotes, clients, users, setOrders, pushToast } = useApp();
  const presupuestos = quotes.filter(q => q.mailType === 'PRESUPUESTO' || (!q.mailType && q.stage !== 'rechazada'));
  const [form, setForm] = useS({
    fromQuote: '',
    clientId:  '',
    ocCliente: '',
    flexxus:   '',
    fecha:     new Date().toISOString().slice(0,10),
  });
  const [saving,   setSaving]   = useS(false);
  const [parsing,  setParsing]  = useS(false);
  const [npFile,   setNpFile]   = useS(null);   // File object
  const [npResult, setNpResult] = useS(null);   // parsed data from server
  const fileRef = React.useRef();
  const set = (k,v) => setForm(f => ({...f, [k]: v}));

  const q   = quotes.find(x => x.code === form.fromQuote);
  const cli = q ? clients.find(c => c.code === q.client)
                : clients.find(c => c.id === form.clientId);
  const canSubmit = (form.fromQuote || form.clientId) && form.ocCliente;

  // Cuando el usuario selecciona un PDF de NP
  const handleNpFile = async (file) => {
    if (!file) return;
    setNpFile(file);
    setParsing(true);
    try {
      const data = await CrmApi.parseNP(file);
      setNpResult(data);
      // Auto-completar campos
      if (data.ocNumber)  set('ocCliente', data.ocNumber);
      if (data.npCode)    set('flexxus',   data.npCode);
      if (data.presupuesto) set('fromQuote', quotes.find(x => x.id === data.presupuesto.id)?.code || '');
      if (data.client && !form.fromQuote) set('clientId', data.client.id);
      pushToast(`PDF parseado: ${data.npCode || '—'} · ${data.itemCount} ítem${data.itemCount !== 1 ? 's' : ''}`);
    } catch (err) {
      pushToast(err.message || 'No se pudo parsear el PDF', 'bad');
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        fromQuoteId:  q?.id || null,
        clientId:     form.clientId || null,
        clientOCCode: form.ocCliente,
        flexxusCode:  form.flexxus  || null,
        estimatedDate: form.fecha || null,
      };
      const order = await CrmApi.createOrder(payload);

      // Si hay PDF, subirlo como adjunto (el servidor lo re-parsea y vincula)
      if (npFile) {
        try { await CrmApi.uploadOrderAttachments(order.id, [npFile]); } catch (_) {}
      }

      const freshOrders = await CrmApi.getOrders();
      setOrders(freshOrders);
      pushToast('Nota de Pedido creada correctamente');
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al crear NP', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={closeModal} subtitle="Fase 2 · Nota de Pedido" title="Nueva Nota de Pedido" width={640}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal} disabled={saving}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit || saving || parsing} onClick={submit}
            style={!canSubmit || saving || parsing ? {opacity:.45, cursor:'not-allowed'} : {}}>
            <Icon name="plus" size={13}/>{saving ? 'Guardando...' : 'Crear NP'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">

        {/* Upload PDF */}
        <div className="col-span-2">
          <label className="block text-[11px] font-semibold text-ink-500 uppercase tracking-wide mb-1.5">
            PDF Nota de Pedido Flexxus <span className="font-normal text-ink-400 normal-case">(opcional — auto-completa los campos)</span>
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            className={cx(
              'flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
              npFile ? 'border-brand bg-brandSoft/20' : 'border-line hover:border-brand/50 hover:bg-surface'
            )}
          >
            <Icon name={parsing ? 'loader' : npFile ? 'file-check' : 'upload'} size={18}
              className={cx(parsing ? 'animate-spin text-brand' : npFile ? 'text-brand' : 'text-ink-400')}/>
            <div className="flex-1 min-w-0">
              {parsing ? (
                <span className="text-[13px] text-brand font-medium">Procesando PDF…</span>
              ) : npFile ? (
                <span className="text-[13px] text-ink-700 font-medium truncate">{npFile.name}</span>
              ) : (
                <span className="text-[13px] text-ink-400">Hacé clic para subir el PDF de la Nota de Pedido</span>
              )}
            </div>
            {npFile && !parsing && (
              <button onClick={e=>{e.stopPropagation();setNpFile(null);setNpResult(null);fileRef.current.value='';}}
                className="text-ink-400 hover:text-red-500 transition-colors">
                <Icon name="x" size={14}/>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={e => handleNpFile(e.target.files[0])}/>
        </div>

        {/* Info del NP parseado */}
        {npResult && (
          <div className="col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[12px] text-emerald-800 space-y-0.5">
            <div className="font-semibold flex items-center gap-1.5"><Icon name="check-circle" size={13}/>PDF procesado correctamente</div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-emerald-700">
              {npResult.npCode    && <span>NP: <b>{npResult.npCode}</b></span>}
              {npResult.ocNumber  && <span>OC cliente: <b>{npResult.ocNumber}</b></span>}
              {npResult.clientName && <span>Cliente: <b>{npResult.clientName}</b></span>}
              {npResult.presupuestoNP && <span>Pres. ref: <b>{npResult.presupuestoNP}</b>{npResult.presupuesto ? ` → ${npResult.presupuesto.code}` : ' (no encontrado en CRM)'}</span>}
              {npResult.itemCount > 0 && <span>{npResult.itemCount} ítems</span>}
            </div>
          </div>
        )}

        {/* Cotización vinculada (opcional) */}
        <FormGroup label="Presupuesto vinculado" cols={2}
          hint="Opcional. Si subiste el PDF, se detecta automáticamente.">
          <Select value={form.fromQuote} onChange={v=>{set('fromQuote',v);if(v)set('clientId','');}}
            placeholder="Seleccionar presupuesto (opcional)"
            options={presupuestos.map(a => {
              const c = clients.find(x => x.code === a.client);
              return { value: a.code, label: `${a.code}${a.flexxus ? ` (${a.flexxus})` : ''} — ${c?.name || a.clientName || '?'} · ${a.stage}` };
            })}/>
        </FormGroup>

        {/* Si no hay presupuesto, elegir cliente directo */}
        {!form.fromQuote && (
          <FormGroup label="Cliente" cols={2} hint="Requerido si no seleccionás un presupuesto.">
            <Select value={form.clientId} onChange={v=>set('clientId',v)}
              placeholder="Seleccionar cliente"
              options={clients.map(c => ({ value: c.id, label: `${c.name}${c.cuit ? ` · ${c.cuit}` : ''}` }))}/>
          </FormGroup>
        )}

        {cli && (
          <div className="col-span-2 bg-surface rounded-lg px-3 py-2 border border-line text-[12px] text-ink-600 flex items-center gap-2">
            <Icon name="info" size={13} className="text-brand"/>
            <span><b>{cli.name}</b>{q ? ` · ${fmtMoney(q.monto)} · ${q.stage}` : ''}</span>
          </div>
        )}

        <FormGroup label="Código OC del cliente" required>
          <input className="inp w-full" placeholder="Ej: 4500038388" value={form.ocCliente} onChange={e=>set('ocCliente',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Código NP Flexxus">
          <input className="inp w-full mono" placeholder="Ej: NP-20728" value={form.flexxus} onChange={e=>set('flexxus',e.target.value)}/>
        </FormGroup>

        <FormGroup label="Fecha estimada de entrega" cols={2}>
          <input type="date" className="inp w-full" value={form.fecha} onChange={e=>set('fecha',e.target.value)}/>
        </FormGroup>
      </div>
    </Modal>
  );
}

// --- 3. Nuevo Cliente ---
function NewClientModal() {
  const { closeModal, users, setClients, pushToast } = useApp();
  const [form, setForm] = useS({
    name:'', cuit:'', address:'', city:'', prov:'', zone:'', cp:'', activity:'', phone:'', email:'', seller:''
  });
  const [saving, setSaving] = useS(false);
  const set = (k,v) => setForm(f => ({...f, [k]:v}));
  const canSubmit = form.name;

  const submit = async () => {
    setSaving(true);
    try {
      await CrmApi.createClient({
        name: form.name,
        cuit: form.cuit || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        province: form.prov || null,
        zone: form.zone || null,
        activity: form.activity || null,
        defaultSellerId: form.seller || null,
      });
      const clients = await CrmApi.getClients();
      const mapped = clients.map(c => ({
        id: c.id, code: c.code, name: c.name, cuit: c.cuit || '',
        city: c.city || '', prov: c.province || '', zone: c.zone || '',
        activity: c.activity || '', seller: c.defaultSellerId || '',
        sellerName: c.defaultSeller?.name || '', email: c.email || '',
        phone: c.phone || '', address: c.address || '',
      }));
      setClients(mapped);
      pushToast('Cliente creado correctamente');
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al crear cliente', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={closeModal} subtitle="Directorio de clientes" title="Nuevo cliente" width={680}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal} disabled={saving}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit || saving} onClick={submit}
            style={!canSubmit || saving ? {opacity:.45, cursor:'not-allowed'} : {}}>
            <Icon name="check" size={13}/>{saving ? 'Guardando...' : 'Guardar cliente'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <FormGroup label="Razón social" required cols={2}>
          <input className="inp w-full" placeholder="Ej: ARGENCRAFT S.A." value={form.name} onChange={e=>set('name',e.target.value)}/>
        </FormGroup>
        <FormGroup label="CUIT" required>
          <input className="inp w-full mono" placeholder="30-12345678-9" value={form.cuit} onChange={e=>set('cuit',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Código postal">
          <input className="inp w-full mono" placeholder="1629" value={form.cp} onChange={e=>set('cp',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Dirección" cols={2}>
          <input className="inp w-full" placeholder="Calle, altura, piso" value={form.address} onChange={e=>set('address',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Localidad">
          <input className="inp w-full" placeholder="Ciudad / Partido" value={form.city} onChange={e=>set('city',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Provincia">
          <Select value={form.prov} onChange={v=>set('prov',v)} options={PROVINCES}/>
        </FormGroup>
        <FormGroup label="Zona comercial">
          <Select value={form.zone} onChange={v=>set('zone',v)} options={ZONES}/>
        </FormGroup>
        <FormGroup label="Tipo de actividad">
          <Select value={form.activity} onChange={v=>set('activity',v)} options={ACTIVITIES}/>
        </FormGroup>
        <FormGroup label="Teléfono">
          <input className="inp w-full mono" placeholder="+54 11 0000-0000" value={form.phone} onChange={e=>set('phone',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Email">
          <input className="inp w-full" placeholder="compras@empresa.com" value={form.email} onChange={e=>set('email',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Vendedor asignado" cols={2}>
          <Select value={form.seller} onChange={v=>set('seller',v)}
            options={users.filter(u=>u.role==='Vendedor'||u.role==='Administrador').map(u => ({ value:u.id, label:`${u.name} · ${u.zone}` }))}/>
        </FormGroup>
      </div>
    </Modal>
  );
}

// --- 4. Editar Cliente ---
function EditClientModal({ clientId }) {
  const { closeModal, clients, users, setClients, pushToast } = useApp();
  const source = clients.find(c => c.id === clientId);
  const [form, setForm] = useS({
    name: source?.name || '',
    cuit: source?.cuit || '',
    address: source?.address || '',
    city: source?.city || '',
    prov: source?.prov || '',
    zone: source?.zone || '',
    cp: '',
    activity: source?.activity || '',
    phone: source?.phone || '',
    email: source?.email || '',
    seller: source?.seller || '',
  });
  const [saving, setSaving] = useS(false);
  const set = (k, v) => setForm(f => ({...f, [k]: v}));
  const canSubmit = !!form.name;

  // ── Emails de matcheo ──
  const [clientEmails, setClientEmails] = useS([]);
  const [newEmail, setNewEmail] = useS('');
  const [emailSaving, setEmailSaving] = useS(false);

  React.useEffect(() => {
    if (!clientId) return;
    CrmApi.getClientEmails(clientId).then(setClientEmails).catch(() => {});
  }, [clientId]);

  const handleAddEmail = async () => {
    if (!newEmail.trim()) return;
    setEmailSaving(true);
    try {
      const record = await CrmApi.addClientEmail(clientId, newEmail.trim());
      setClientEmails(prev => [...prev, record]);
      setNewEmail('');
      pushToast('Email agregado');
    } catch (err) {
      pushToast(err.message || 'Error al agregar email', 'bad');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleRemoveEmail = async (emailId) => {
    try {
      await CrmApi.removeClientEmail(clientId, emailId);
      setClientEmails(prev => prev.filter(e => e.id !== emailId));
      pushToast('Email eliminado');
    } catch (err) {
      pushToast('Error al eliminar email', 'bad');
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      await CrmApi.updateClient(clientId, {
        name: form.name,
        cuit: form.cuit || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        province: form.prov || null,
        zone: form.zone || null,
        activity: form.activity || null,
        defaultSellerId: form.seller || null,
      });
      const updated = await CrmApi.getClients();
      const mapped = updated.map(c => ({
        id: c.id, code: c.code, name: c.name, cuit: c.cuit || '',
        city: c.city || '', prov: c.province || '', zone: c.zone || '',
        activity: c.activity || '', seller: c.defaultSellerId || '',
        sellerName: c.defaultSeller?.name || '', email: c.email || '',
        phone: c.phone || '', address: c.address || '',
      }));
      setClients(mapped);
      pushToast('Cliente actualizado correctamente');
      closeModal();
    } catch (err) {
      pushToast(err.message || 'Error al actualizar cliente', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={closeModal} subtitle="Directorio de clientes" title="Editar cliente" width={680}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal} disabled={saving}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit || saving} onClick={submit}
            style={!canSubmit || saving ? {opacity:.45, cursor:'not-allowed'} : {}}>
            <Icon name="check" size={13}/>{saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <FormGroup label="Razón social" required cols={2}>
          <input className="inp w-full" value={form.name} onChange={e=>set('name',e.target.value)}/>
        </FormGroup>
        <FormGroup label="CUIT">
          <input className="inp w-full mono" value={form.cuit} onChange={e=>set('cuit',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Código postal">
          <input className="inp w-full mono" value={form.cp} onChange={e=>set('cp',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Dirección" cols={2}>
          <input className="inp w-full" value={form.address} onChange={e=>set('address',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Localidad">
          <input className="inp w-full" value={form.city} onChange={e=>set('city',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Provincia">
          <Select value={form.prov} onChange={v=>set('prov',v)} options={PROVINCES}/>
        </FormGroup>
        <FormGroup label="Zona comercial">
          <Select value={form.zone} onChange={v=>set('zone',v)} options={ZONES}/>
        </FormGroup>
        <FormGroup label="Tipo de actividad">
          <Select value={form.activity} onChange={v=>set('activity',v)} options={ACTIVITIES}/>
        </FormGroup>
        <FormGroup label="Teléfono">
          <input className="inp w-full mono" value={form.phone} onChange={e=>set('phone',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Email principal">
          <input className="inp w-full" value={form.email} onChange={e=>set('email',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Vendedor asignado" cols={2}>
          <Select value={form.seller} onChange={v=>set('seller',v)}
            options={users.filter(u=>u.role==='Vendedor'||u.role==='Administrador').map(u => ({ value:u.id, label:`${u.name} · ${u.zone}` }))}/>
        </FormGroup>

        {/* ── Emails de matcheo automático ── */}
        <div className="col-span-2 pt-2 border-t border-line">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-2">
            Emails de matcheo automático
          </div>
          <div className="text-[11.5px] text-ink-400 mb-3">
            Cuando llegue un mail de alguno de estos remitentes, se vincula automáticamente a este cliente.
          </div>
          {/* Lista de emails registrados */}
          <div className="space-y-1.5 mb-3">
            {clientEmails.length === 0 && (
              <div className="text-[12px] text-ink-400 py-2">Sin emails adicionales registrados</div>
            )}
            {clientEmails.map(e => (
              <div key={e.id} className="flex items-center justify-between bg-surface border border-line rounded-lg px-3 py-2">
                <span className="text-[12.5px] text-ink-900 mono">{e.email}</span>
                <button onClick={() => handleRemoveEmail(e.id)}
                  className="w-6 h-6 rounded hover:bg-red-50 text-ink-400 hover:text-bad flex items-center justify-center">
                  <Icon name="x" size={12}/>
                </button>
              </div>
            ))}
          </div>
          {/* Agregar nuevo email */}
          <div className="flex gap-2">
            <input className="inp flex-1 text-xs mono" placeholder="nuevo@email.com"
              value={newEmail} onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddEmail()}/>
            <button className="btn-ghost text-xs" onClick={handleAddEmail}
              disabled={!newEmail.trim() || emailSaving}>
              <Icon name="plus" size={12}/>{emailSaving ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// --- 5. Invitar Usuario ---
function InviteUserModal() {
  const { closeModal, inviteUser } = useApp();
  const [form, setForm] = useS({ name:'', email:'', role:'Vendedor', zone:'AMBA Norte' });
  const set = (k,v) => setForm(f => ({...f,[k]:v}));
  const canSubmit = form.name && form.email;

  const submit = () => {
    inviteUser({
      name: form.name, email: form.email, role: form.role,
      zone: form.role === 'Vendedor' ? form.zone : '—',
    });
    closeModal();
  };

  return (
    <Modal onClose={closeModal} subtitle="Equipo comercial" title="Invitar usuario" width={520}
      footer={
        <>
          <button className="btn-ghost" onClick={closeModal}>Cancelar</button>
          <button className="btn-primary" disabled={!canSubmit} onClick={submit} style={!canSubmit?{opacity:.45, cursor:'not-allowed'}:{}}>
            <Icon name="send" size={13}/>Enviar invitación
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormGroup label="Nombre completo" required>
          <input className="inp w-full" placeholder="Ej: Camila Ferrari" value={form.name} onChange={e=>set('name',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Email corporativo" required>
          <input type="email" className="inp w-full" placeholder="nombre@myselec.com.ar" value={form.email} onChange={e=>set('email',e.target.value)}/>
        </FormGroup>
        <FormGroup label="Rol">
          <div className="grid grid-cols-3 gap-2">
            {['Administrador','Vendedor','Logística'].map(r => (
              <label key={r} className={cx('flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer',
                form.role===r ? 'border-brand bg-brandSoft/40' : 'border-line bg-white hover:bg-surface')}>
                <input type="radio" checked={form.role===r} onChange={()=>set('role',r)} className="accent-brand"/>
                <span className="text-[12.5px] font-medium">{r}</span>
              </label>
            ))}
          </div>
        </FormGroup>
        {form.role === 'Vendedor' && (
          <FormGroup label="Zona comercial asignada">
            <Select value={form.zone} onChange={v=>set('zone',v)} options={ZONES}/>
          </FormGroup>
        )}
        <div className="bg-brandSoft/40 border border-brand/20 rounded-lg px-3 py-2.5 text-[12px] text-navy-900">
          <Icon name="info" size={12} className="inline mr-1.5"/>
          Se enviará un mail a <b>{form.email || 'destinatario'}</b> con un enlace de activación válido por 48 hs.
        </div>
      </div>
    </Modal>
  );
}

// --- 5. Permisos (solo lectura estructurada) ---
function PermissionsModal() {
  const { closeModal } = useApp();
  const rows = [
    ['Dashboard',            {a:'Ver', v:'—', l:'—'}],
    ['Cotizaciones',         {a:'Ver + editar', v:'Propias', l:'—'}],
    ['Órdenes de Compra',    {a:'Ver + editar', v:'Propias', l:'Avanzar etapa'}],
    ['Clientes',             {a:'Gestionar', v:'Ver', l:'—'}],
    ['Equipo',               {a:'Gestionar', v:'—', l:'—'}],
    ['Configuración',        {a:'Gestionar', v:'—', l:'—'}],
    ['Reportes y Export',    {a:'Completo', v:'Propios', l:'Entregas'}],
    ['Integración Flexxus',  {a:'Configurar', v:'Consultar', l:'Sincronizar'}],
  ];
  const cell = (v) => {
    if (v === '—') return <span className="text-ink-300">—</span>;
    const tone = v.includes('Gestionar')||v.includes('Completo')||v.includes('Configurar')?'navy':v.includes('Propi')?'blue':v==='Ver'?'slate':'green';
    return <Badge tone={tone}>{v}</Badge>;
  };
  return (
    <Modal onClose={closeModal} subtitle="Equipo" title="Matriz de permisos por rol" width={720}
      footer={<button className="btn-ghost" onClick={closeModal}>Cerrar</button>}
    >
      <div className="bg-white border border-line rounded-xl overflow-hidden">
        <table className="tbl w-full">
          <thead><tr>
            <th>Módulo</th>
            <th className="!text-center">Admin</th>
            <th className="!text-center">Vendedor</th>
            <th className="!text-center">Logística</th>
          </tr></thead>
          <tbody>
            {rows.map(([label, {a,v,l}]) => (
              <tr key={label}>
                <td className="font-medium">{label}</td>
                <td className="!text-center">{cell(a)}</td>
                <td className="!text-center">{cell(v)}</td>
                <td className="!text-center">{cell(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-ink-500 mt-3">
        Los cambios en esta matriz requieren confirmación del administrador principal y se auditan en el historial del sistema.
      </div>
    </Modal>
  );
}

// --- 6. Búsqueda global ---
function SearchPaletteModal() {
  const { closeModal, quotes, orders, clients, openModal } = useApp();
  const [q, setQ] = useS('');
  const norm = (s='') => s.toLowerCase();
  const query = norm(q);

  const matchedQuotes = !query ? [] :
    quotes.filter(x => norm(x.code).includes(query)
      || norm(x.clientName||'').includes(query)
      || norm(x.flexxus||'').includes(query)
      || norm(x.emailSubject||'').includes(query)
    ).slice(0,6);
  const matchedClients = !query ? [] :
    clients.filter(c => norm(c.name).includes(query) || norm(c.cuit||'').includes(query)
      || norm(c.code||'').includes(query) || norm(c.email||'').includes(query)).slice(0,5);
  const matchedOrders = !query ? [] :
    orders.filter(o => norm(o.code).includes(query)
      || norm(o.clientName||clients.find(c=>c.code===o.client)?.name||'').includes(query)
      || norm(o.flexxus||'').includes(query)
    ).slice(0,5);

  const hasResults = matchedQuotes.length + matchedClients.length + matchedOrders.length > 0;

  const go = (ref) => {
    closeModal();
    openModal(ref.kind==='quote'?'quoteDetail':'orderDetail', { code: ref.code });
  };

  const goClient = (c) => {
    closeModal();
    setTimeout(() => openModal('editClient', { clientId: c.id }), 50);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-6">
      <div className="absolute inset-0 bg-ink-900/50 backdrop-blur-[2px]" onClick={closeModal}/>
      <div className="relative bg-white rounded-2xl shadow-pop modal-enter w-[640px] max-w-full overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line">
          <Icon name="search" size={18} className="text-ink-400"/>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Buscar cotizaciones, clientes, órdenes…"
            className="flex-1 outline-none bg-transparent text-[15px] placeholder:text-ink-400"/>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-line text-ink-500 bg-surface">ESC</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto scroll-thin">
          {matchedQuotes.length > 0 && (
            <div className="p-2">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-500">Cotizaciones</div>
              {matchedQuotes.map(x => {
                const c = clients.find(y=>y.code===x.client);
                const stg = STAGES_F1.find(s=>s.id===x.stage);
                return (
                  <button key={x.code} onClick={()=>go({kind:'quote', code:x.code})}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface text-left">
                    <Icon name="clipboard-list" size={15} className="text-ink-500"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate"><span className="mono text-navy-900">{x.code}</span> — {c?.name}</div>
                      <div className="text-[11px] text-ink-500">{c?.city}{c?.city&&x.monto?' · ':''}{x.monto?fmtMoney(x.monto):''}</div>
                    </div>
                    {stg && <Badge tone={stg.tone} dot>{stg.label}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
          {matchedClients.length > 0 && (
            <div className="p-2 border-t border-line">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-500">Clientes</div>
              {matchedClients.map(c => (
                <button key={c.code} onClick={() => goClient(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface text-left">
                  <Icon name="building-2" size={15} className="text-ink-500"/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{c.name}</div>
                    <div className="text-[11px] text-ink-500">{[c.city, c.prov].filter(Boolean).join(', ')}{c.cuit ? ` · ${c.cuit}` : ''}</div>
                  </div>
                  <span className="mono text-[11px] text-ink-400">{c.code}</span>
                </button>
              ))}
            </div>
          )}
          {matchedOrders.length > 0 && (
            <div className="p-2 border-t border-line">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-500">Órdenes</div>
              {matchedOrders.map(o => {
                const c = clients.find(y=>y.code===o.client);
                const stg = STAGES_F2.find(s=>s.id===o.stage);
                return (
                  <button key={o.code} onClick={()=>go({kind:'order', code:o.code})}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface text-left">
                    <Icon name="package" size={15} className="text-ink-500"/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate"><span className="mono text-navy-900">{o.code}</span> — {c?.name}</div>
                      <div className="text-[11px] text-ink-500">{o.flexxus && o.flexxus !== '—' ? o.flexxus : o.fromQuote ? `← ${o.fromQuote}` : ''}</div>
                    </div>
                    {stg && <Badge tone={stg.tone} dot>{stg.label}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
          {!query && (
            <div className="py-10 text-center space-y-1">
              <Icon name="search" size={22} className="text-ink-300 mx-auto"/>
              <div className="text-[13px] text-ink-400 mt-2">Buscá por código, cliente, NP o asunto</div>
              <div className="text-[11px] text-ink-300">Cotizaciones · Órdenes · Clientes</div>
            </div>
          )}
          {query && !hasResults && (
            <div className="py-12 text-center text-ink-500 text-[13px]">
              Sin resultados para "<b>{q}</b>"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Detail modal wrappers (route to existing drawers via registry) ---
function QuoteDetailWrapper({ code }) {
  const { closeModal, roleKey } = useApp();
  return <QuoteDetail code={code} onClose={closeModal} canReassign={roleKey==='admin'}/>;
}
function OrderDetailWrapper({ code }) {
  const { closeModal, roleKey } = useApp();
  return <OrderDetail code={code} onClose={closeModal} canReassign={roleKey==='admin'}/>;
}

const MODAL_REGISTRY = {
  newQuote: NewQuoteModal,
  newOrder: NewOrderModal,
  newClient: NewClientModal,
  editClient: EditClientModal,
  inviteUser: InviteUserModal,
  permissions: PermissionsModal,
  search: SearchPaletteModal,
  quoteDetail: QuoteDetailWrapper,
  orderDetail: OrderDetailWrapper,
};

// ---------- Notifications Popover ----------
function NotificationsPopover({ onClose }) {
  const { notifications, markNotificationRead, markAllNotificationsRead, openModal } = useApp();
  const toneClass = { ok:'bg-emerald-500', bad:'bg-red-500', warn:'bg-orange-500', info:'bg-brand' };
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose}/>
      <div className="absolute right-0 top-full mt-2 w-[360px] bg-white rounded-xl shadow-pop border border-line modal-enter z-40 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-semibold text-ink-900">Notificaciones</div>
          <button onClick={markAllNotificationsRead} className="text-[11px] text-brand hover:underline">Marcar todas como leídas</button>
        </div>
        <div className="max-h-[400px] overflow-y-auto scroll-thin">
          {notifications.length === 0 && (
            <div className="py-10 text-center text-ink-500 text-[12px]">Sin notificaciones</div>
          )}
          {notifications.map(n => (
            <button key={n.id}
              onClick={()=>{
                markNotificationRead(n.id);
                onClose();
                if (n.ref?.kind==='quote') openModal('quoteDetail', { code: n.ref.code });
                if (n.ref?.kind==='order') openModal('orderDetail', { code: n.ref.code });
              }}
              className={cx('w-full text-left px-4 py-3 border-b border-line flex gap-3 items-start hover:bg-surface transition-colors',
                !n.read && 'bg-brandSoft/30')}>
              <span className={cx('w-2 h-2 rounded-full mt-1.5 shrink-0', toneClass[n.kind])}/>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] leading-snug text-ink-900">{n.text}</div>
                <div className="text-[11px] text-ink-500 mt-0.5 mono">{fmtDateTime(n.at)}</div>
              </div>
              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2"/>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


// ---------- More Filters Popover (Quotes) ----------
function MoreFiltersPopover({ onClose, which='quote' }) {
  const { quoteFilters, setQuoteFilters, orderFilters, setOrderFilters } = useApp();
  const f = which==='quote' ? quoteFilters : orderFilters;
  const set = which==='quote' ? setQuoteFilters : setOrderFilters;
  const reset = () => set(s => ({ ...s, min:'', max:'', zone:'', activity:'' }));
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose}/>
      <div className="absolute right-0 top-full mt-2 w-[340px] bg-white rounded-xl shadow-pop border border-line modal-enter z-40 p-4">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-3">Filtros avanzados</div>
        <div className="space-y-3">
          <FormGroup label="Monto mínimo (ARS)">
            <input type="number" className="inp w-full" value={f.min||''} onChange={e=>set(s=>({...s, min:e.target.value}))} placeholder="0"/>
          </FormGroup>
          <FormGroup label="Monto máximo (ARS)">
            <input type="number" className="inp w-full" value={f.max||''} onChange={e=>set(s=>({...s, max:e.target.value}))} placeholder="Sin límite"/>
          </FormGroup>
          <FormGroup label="Zona">
            <Select value={f.zone||''} onChange={v=>set(s=>({...s, zone:v}))} options={['', ...ZONES].map(z => ({ value:z, label:z||'Todas las zonas' }))}/>
          </FormGroup>
          {which === 'quote' && (
            <FormGroup label="Tipo de actividad">
              <Select value={f.activity||''} onChange={v=>set(s=>({...s, activity:v}))} options={['', ...ACTIVITIES].map(z => ({ value:z, label:z||'Todas' }))}/>
            </FormGroup>
          )}
        </div>
        <div className="flex gap-2 pt-3 mt-3 border-t border-line">
          <button className="btn-ghost flex-1 justify-center" onClick={reset}>Restablecer</button>
          <button className="btn-primary flex-1 justify-center" onClick={onClose}>Aplicar</button>
        </div>
      </div>
    </>
  );
}

// ---------- Filter helpers ----------
function countActiveFilters(f) {
  let n = 0;
  if (f.seller) n++;
  if (f.client) n++;
  if (f.period && f.period !== '30d') n++;
  if (f.zone) n++;
  if (f.activity) n++;
  if (f.min) n++;
  if (f.max) n++;
  if (f.delivery) n++;
  if (f.transport) n++;
  return n;
}

function applyQuoteFilters(list, filters, clientsArr) {
  return list.filter(q => {
    if (filters.seller && q.seller !== filters.seller) return false;
    const cli = clientsArr.find(c => c.code === q.client);
    if (filters.client) {
      const needle = filters.client.toLowerCase();
      if (!cli || !cli.name.toLowerCase().includes(needle)) return false;
    }
    if (filters.zone && cli?.zone !== filters.zone) return false;
    if (filters.activity && cli?.activity !== filters.activity) return false;
    if (filters.min && (q.monto||0) < parseFloat(filters.min)) return false;
    if (filters.max && (q.monto||0) > parseFloat(filters.max)) return false;
    return true;
  });
}
function applyOrderFilters(list, filters, clientsArr) {
  return list.filter(o => {
    if (filters.seller && o.seller !== filters.seller) return false;
    const cli = clientsArr.find(c => c.code === o.client);
    if (filters.client) {
      const needle = filters.client.toLowerCase();
      if (!cli || !cli.name.toLowerCase().includes(needle)) return false;
    }
    if (filters.delivery && o.entrega !== filters.delivery) return false;
    if (filters.transport && !(o.transp||'').toLowerCase().includes(filters.transport.toLowerCase())) return false;
    if (filters.zone && cli?.zone !== filters.zone) return false;
    return true;
  });
}

// ---------- Popover button wrapper ----------
function PopoverButton({ icon, label, value, onClear, options, onChange, active }) {
  const [open, setOpen] = useS(false);
  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)} className={cx(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border',
        active ? 'bg-brandSoft text-navy-900 border-brand/40' : 'bg-white text-ink-700 border-line hover:bg-surface'
      )}>
        {icon && <Icon name={icon} size={13}/>}
        {label}
        <Icon name="chevron-down" size={11} className="opacity-60"/>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={()=>setOpen(false)}/>
          <div className="absolute left-0 top-full mt-2 w-[240px] bg-white rounded-xl shadow-pop border border-line modal-enter z-40 overflow-hidden">
            {active && onClear && (
              <button onClick={()=>{ onClear(); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-[12px] text-bad hover:bg-red-50 border-b border-line flex items-center gap-2">
                <Icon name="x" size={12}/> Limpiar filtro
              </button>
            )}
            {options.map(opt => (
              <button key={opt.value||'all'} onClick={()=>{ onChange(opt.value); setOpen(false); }}
                className={cx('w-full text-left px-3 py-2 text-[13px] hover:bg-surface flex items-center gap-2',
                  value === opt.value && 'bg-brandSoft/40 font-medium')}>
                {opt.icon && <Icon name={opt.icon} size={12} className="text-ink-500"/>}
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, {
  AppProvider, useApp, Modal, FormGroup, Select, Label,
  ZONES, ACTIVITIES, PROVINCES, ORIGINS, REJECT_REASONS,
  NotificationsPopover, ExportMenu, MoreFiltersPopover, PopoverButton,
  applyQuoteFilters, applyOrderFilters, countActiveFilters,
});
