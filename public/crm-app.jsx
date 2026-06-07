/* CRM MySelec — App shell: login, sidebar, topbar, role routing.
   Depends on: crm-data.jsx, crm-interact.jsx, crm-kanban.jsx, crm-details.jsx, crm-views.jsx */

const { useState, useEffect } = React;

function AppRoot() {
  const [logged, setLogged] = useState(CrmAuth.isLoggedIn());
  // Si hay token pero no crm_user guardado, reconstruirlo del JWT para que
  // el sidebar y topbar siempre tengan nombre y rol sin depender del fetch.
  if (CrmAuth.isLoggedIn() && !CrmAuth.getUser()) {
    const _jwt = decodeJwtPayload(CrmAuth.getToken());
    if (_jwt) CrmAuth.setUser({ id: _jwt.id, name: _jwt.name, email: _jwt.email, role: _jwt.role, zone: _jwt.zone });
  }
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  // On login or if already has token, load API data
  useEffect(() => {
    if (!logged) { setLoading(false); return; }
    setLoading(true);
    setLoadError(false);
    loadAllData().then(data => {
      if (data) {
        // Replace window globals with API data
        window.USERS = data.users;
        window.CLIENTS = data.clients;
        window.QUOTES = data.quotes;
        window.ORDERS = data.orders;
        window.STAGES_F1 = data.stagesF1;
        window.STAGES_F2 = data.stagesF2;
        window.ACTIVITY = data.activity;
        // Actualizar crm_user con el avatar real del API (el login no lo incluye en el JWT)
        const stored = CrmAuth.getUser();
        if (stored && data.users) {
          const me = data.users.find(u => u.id === stored.id);
          if (me?.avatar) CrmAuth.setUser({ ...stored, avatar: me.avatar });
        }
        setApiData(data);
        setLoading(false);
      } else {
        setLoadError(true);
        setLoading(false);
      }
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, [logged, retry]);

  if (!logged) return <Login onLogin={() => setLogged(true)} />;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950">
      <div className="flex flex-col items-center gap-6">
        <img src="/Logo.png" alt="MySelec" style={{ width: 'auto', height: 60, objectFit: 'contain', imageRendering: 'auto' }}/>
        <div className="flex flex-col items-center gap-1">
          <div className="text-white/60 text-sm">Cargando sistema…</div>
          <div className="text-white/30 text-xs">Conectando con la base de datos</div>
        </div>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950">
      <div className="text-center max-w-sm px-6">
        <Logo size={72} />
        <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mt-6">
          <Icon name="wifi-off" size={22} className="text-red-400"/>
        </div>
        <div className="text-white font-semibold mt-4">No se pudo conectar</div>
        <div className="text-white/50 text-sm mt-2 leading-relaxed">
          El servidor tardó demasiado en responder. Puede ser que la base de datos esté iniciando — suele tardar unos segundos.
        </div>
        <button
          onClick={() => setRetry(r => r + 1)}
          className="mt-6 btn-accent w-full justify-center"
        >
          <Icon name="refresh-cw" size={14}/>Reintentar
        </button>
        <button
          onClick={() => { CrmAuth.clearToken(); localStorage.removeItem('crm_user'); window.location.reload(); }}
          className="mt-2 w-full text-white/30 hover:text-white/60 text-sm py-2 transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <AppProvider key={apiData ? 'api' : 'static'}>
      <App/>
    </AppProvider>
  );
}

function App() {
  const { roleKey, setRoleKey, currentUserId, setCurrentUserId, users, openModal, closeAllModals } = useApp();
  const [screen, setScreen] = useState('dashboard');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('crm_sidebar_collapsed') === 'true'
  );
  const loggedUser = CrmAuth.getUser();

  const toggleSidebar = () => setSidebarCollapsed(v => {
    const next = !v;
    localStorage.setItem('crm_sidebar_collapsed', String(next));
    return next;
  });

  // Initialize role and user ID from token on mount
  useEffect(() => {
    if (!loggedUser) return;
    const roleMap = { DEVELOPER: 'admin', ADMIN: 'admin', VENDEDOR: 'seller', LOGISTICA: 'logistics' };
    setCurrentUserId(loggedUser.id);
    setRoleKey(roleMap[loggedUser.role] || 'admin');
  }, []);

  // Update screen (and keep currentUserId real) when role switches
  useEffect(() => {
    if (!loggedUser) return;
    setCurrentUserId(loggedUser.id);
    if (roleKey === 'admin')     setScreen('dashboard');
    if (roleKey === 'seller')    setScreen('my-quotes');
    if (roleKey === 'logistics') setScreen('ops');
  }, [roleKey]);

  // Badge: presupuestos sin vincular (solo admin)
  const [adminBadges, setAdminBadges] = useState({});
  useEffect(() => {
    if (roleKey !== 'admin') return;
    const fetchBadges = () => {
      fetch('/api/notifications/counts', { headers: { Authorization: `Bearer ${localStorage.getItem('crm_token')}` } })
        .then(r => r.ok ? r.json() : {})
        .then(d => setAdminBadges({ quotes: d.unlinkedPresupuestos > 0 ? d.unlinkedPresupuestos : 0 }))
        .catch(() => {});
    };
    fetchBadges();
    const iv = setInterval(fetchBadges, 5 * 60 * 1000); // cada 5 min
    return () => clearInterval(iv);
  }, [roleKey]);

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openModal('search');
      }
      if (e.key === 'Escape') { closeAllModals(); setProfileOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal, closeAllModals]);

  const user = users.find(u => u.id === currentUserId) || users[0];
  // Merge avatar desde profileUser si fue actualizado en esta sesión.
  // role siempre viene del JWT como fallback por si el contexto de users aún no cargó.
  const displayUser = {
    role: loggedUser?.role,
    ...(profileUser ? { ...user, ...profileUser } : user),
  };

  const openDetail = (code, kind='quote') => openModal(kind==='quote'?'quoteDetail':'orderDetail', { code });

  return (
    <div className="h-screen flex overflow-hidden bg-surface" data-screen-label={`${roleKey} · ${screen}`}>
      <Sidebar role={roleKey} screen={screen} setScreen={setScreen}
        user={displayUser} onProfileOpen={() => setProfileOpen(true)}
        collapsed={sidebarCollapsed} onToggle={toggleSidebar} badges={adminBadges}/>
      {profileOpen && (
        <ProfileModal
          user={displayUser}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updated) => {
            setProfileUser(updated);
            // Actualizar también el localStorage del CrmAuth
            const stored = CrmAuth.getUser();
            if (stored) CrmAuth.setUser({ ...stored, ...updated });
          }}
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Topbar user={displayUser} roleKey={roleKey} setRoleKey={setRoleKey} setScreen={setScreen}/>
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          {screen === 'dashboard'  && <Dashboard setScreen={setScreen}/>}
          {screen === 'quotes'     && <KanbanQuotes onOpen={(c)=>openDetail(c,'quote')}/>}
          {screen === 'orders'     && <KanbanOrders onOpen={(c,k)=>openDetail(c,k||'order')}/>}
          {screen === 'my-quotes'  && <MySalesView user={user} initialTab="quotes" onOpen={openDetail}/>}
          {screen === 'my-orders'  && <MySalesView user={user} initialTab="orders" onOpen={openDetail}/>}
          {screen === 'ops'        && <LogisticsView onOpen={(c)=>openDetail(c,'order')}/>}
          {screen === 'clients'    && <Clients readonly={roleKey!=='admin'}/>}
          {screen === 'articles'    && <Articles/>}
          {screen === 'comparativa' && <Comparativa/>}
          {screen === 'rechazos'   && <RejectionAnalysis/>}
          {screen === 'team'        && <Team/>}
          {screen === 'config'      && <Config/>}
          {screen === 'feedback'    && <FeedbackView/>}
        </main>
      </div>
    </div>
  );
}

// ---------- ImageCropper ----------
function ImageCropper({ src, onConfirm, onCancel }) {
  const [zoom,   setZoom]   = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag,   setDrag]   = useState(null);
  const imgRef   = React.useRef();
  const SIZE     = 200;

  const onMouseDown = (e) => {
    e.preventDefault();
    setDrag({ sx: e.clientX - offset.x, sy: e.clientY - offset.y });
  };
  const onMouseMove = (e) => {
    if (!drag) return;
    setOffset({ x: e.clientX - drag.sx, y: e.clientY - drag.sy });
  };
  const onMouseUp = () => setDrag(null);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    setDrag({ sx: t.clientX - offset.x, sy: t.clientY - offset.y });
  };
  const onTouchMove = (e) => {
    if (!drag) return;
    const t = e.touches[0];
    setOffset({ x: t.clientX - drag.sx, y: t.clientY - drag.sy });
  };

  const handleConfirm = () => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(SIZE/2, SIZE/2, SIZE/2, 0, Math.PI*2);
    ctx.clip();
    const img = imgRef.current;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const base = Math.min(naturalW, naturalH);
    const scaledW = (naturalW / base) * SIZE * zoom;
    const scaledH = (naturalH / base) * SIZE * zoom;
    const dx = (SIZE - scaledW) / 2 + offset.x;
    const dy = (SIZE - scaledH) / 2 + offset.y;
    ctx.drawImage(img, dx, dy, scaledW, scaledH);
    canvas.toBlob(blob => onConfirm(blob), 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
        <div className="font-semibold text-ink-900 mb-4 text-center">Ajustar foto</div>

        {/* Área de crop */}
        <div className="flex justify-center mb-4">
          <div style={{ width: SIZE, height: SIZE, borderRadius: '50%', overflow: 'hidden', cursor: drag ? 'grabbing' : 'grab', border: '3px solid #3B82F6', background: '#f1f5f9' }}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onMouseUp}>
            <img ref={imgRef} src={src} alt="crop" draggable={false}
              style={{
                width: '100%', height: '100%', objectFit: 'contain',
                transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
                transformOrigin: 'center', userSelect: 'none', pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-3 mb-5">
          <Icon name="image" size={13} className="text-ink-400"/>
          <input type="range" min="0.5" max="3" step="0.05" value={zoom}
            onChange={e => setZoom(parseFloat(e.target.value))}
            className="flex-1 accent-brand"/>
          <Icon name="zoom-in" size={15} className="text-ink-400"/>
        </div>
        <p className="text-[11px] text-ink-400 text-center mb-4">Arrastrá para mover · Deslizá para hacer zoom</p>

        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1">Cancelar</button>
          <button type="button" onClick={handleConfirm} className="btn-primary flex-1">Confirmar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- ProfileModal ----------
function ProfileModal({ user, onClose, onUpdated }) {
  const [tab,         setTab]         = useState('datos');
  const [name,        setName]        = useState(user?.name || '');
  const [phone,       setPhone]       = useState(user?.phone || '');
  const [currentPass, setCurrentPass] = useState('');
  const [pass,        setPass]        = useState('');
  const [pass2,       setPass2]       = useState('');
  const [logoutAll,   setLogoutAll]   = useState(false);
  const [preview,     setPreview]     = useState(user?.avatar || CrmAuth.getUser()?.avatar || null);
  const [avatarFile,  setAvatarFile]  = useState(null);
  // Preferencias de notificación personales
  const [notifPrefs,  setNotifPrefs]  = useState(() => {
    const p = user?.notificationPrefs;
    return (p && typeof p === 'object') ? p : { email: {}, inapp: {} };
  });
  const [notifSaving, setNotifSaving] = useState(false);
  const [removeAvatar,setRemoveAvatar]= useState(false);
  const [cropSrc,     setCropSrc]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [info,        setInfo]        = useState('');
  const [pwChangedAt, setPwChangedAt] = useState(user?.passwordChangedAt || null);
  const fileRef = React.useRef();

  const clearMessages = () => { setError(''); setInfo(''); };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleCropConfirm = (blob) => {
    const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    setAvatarFile(file);
    setPreview(URL.createObjectURL(blob));
    setCropSrc(null);
  };

  const handleSaveDatos = async (e) => {
    e.preventDefault();
    clearMessages(); setLoading(true);
    try {
      let updated = { ...user };
      if (name.trim() !== (user?.name || '') || phone.trim() !== (user?.phone || '')) {
        const res = await CrmApi.updateProfile(user.id, { name: name.trim(), phone: phone.trim() });
        updated = { ...updated, ...res };
      }
      if (removeAvatar) {
        const res = await CrmApi.deleteAvatar(user.id);
        updated = { ...updated, ...res, avatar: null };
      } else if (avatarFile) {
        const res = await CrmApi.uploadAvatar(user.id, avatarFile);
        updated = { ...updated, ...res };
      }
      onUpdated(updated);
      setAvatarFile(null);
      setRemoveAvatar(false);
      setInfo('Datos actualizados');
    } catch (err) {
      setError(err.message || 'Error al guardar');
    } finally { setLoading(false); }
  };

  const handleSaveSeguridad = async (e) => {
    e.preventDefault();
    clearMessages();
    if (!pass) { setError('Ingresá la nueva contraseña'); return; }
    const pwErr = validatePassword(pass);
    if (pwErr) { setError(pwErr); return; }
    if (pass !== pass2) { setError('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      const res = await CrmApi.changeUserPassword(user.id, pass, currentPass);
      setPwChangedAt(res.passwordChangedAt);
      onUpdated({ ...user, passwordChangedAt: res.passwordChangedAt });
      setPass(''); setPass2(''); setCurrentPass('');
      setInfo('Contraseña actualizada. Te enviamos un mail de confirmación.');
      if (logoutAll) {
        setTimeout(() => { CrmAuth.clearToken(); localStorage.removeItem('crm_user'); window.location.reload(); }, 1800);
      }
    } catch (err) {
      setError(err.message || 'Error al cambiar contraseña');
    } finally { setLoading(false); }
  };

  const handleLogout = () => {
    CrmAuth.clearToken();
    localStorage.removeItem('crm_user');
    window.location.reload();
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Nunca';

  return (
    <>
      {cropSrc && <ImageCropper src={cropSrc} onConfirm={handleCropConfirm} onCancel={() => setCropSrc(null)}/>}

      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-start p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm ml-2 flex flex-col max-h-[90vh]"
             onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
            <div className="font-semibold text-ink-900">Mi perfil</div>
            <button onClick={onClose} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-line shrink-0">
            {[{k:'datos',label:'Datos',icon:'user'},{k:'seguridad',label:'Seguridad',icon:'shield'},{k:'notifs',label:'Notificaciones',icon:'bell'}].map(t => (
              <button key={t.k} onClick={() => { setTab(t.k); clearMessages(); }}
                className={cx('flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium transition-colors border-b-2',
                  tab === t.k ? 'border-brand text-brand' : 'border-transparent text-ink-500 hover:text-ink-800')}>
                <Icon name={t.icon} size={13}/>{t.label}
              </button>
            ))}
          </div>

          {/* Contenido scrollable */}
          <div className="overflow-y-auto flex-1">

            {/* ── TAB DATOS ── */}
            {tab === 'datos' && (
              <form onSubmit={handleSaveDatos}>
                <div className="p-6 space-y-4">
                  {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
                  {info  && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{info}</div>}

                  {/* Foto */}
                  <div className="flex flex-col items-center gap-2">
                    <div className="relative cursor-pointer group" onClick={() => fileRef.current?.click()}>
                      {preview
                        ? <img src={preview} alt="avatar" className="w-20 h-20 rounded-full object-cover border-2 border-line"/>
                        : <Avatar name={user?.name} size={80}/>
                      }
                      <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Icon name="camera" size={20} className="text-white"/>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => fileRef.current?.click()}
                        className="text-xs text-brand hover:underline">{preview ? 'Cambiar foto' : 'Subir foto'}</button>
                      {preview && (
                        <button type="button"
                          onClick={() => { setPreview(null); setAvatarFile(null); setRemoveAvatar(true); }}
                          className="text-xs text-red-500 hover:underline">Eliminar foto</button>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect}/>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1 block">Nombre completo</label>
                    <input className="inp w-full" value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1 block">Teléfono</label>
                    <input className="inp w-full" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="11 1234-5678"/>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1 block">Email</label>
                    <input className="inp w-full bg-surface text-ink-500 cursor-not-allowed" value={user?.email || ''} readOnly/>
                  </div>
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t border-line">
                  <button type="button" onClick={handleLogout}
                    className="flex items-center gap-1.5 text-xs text-bad hover:text-red-700 font-medium">
                    <Icon name="log-out" size={14}/>Cerrar sesión
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary">
                    {loading ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}

            {/* ── TAB SEGURIDAD ── */}
            {/* ── TAB NOTIFICACIONES ── */}
            {tab === 'notifs' && (() => {
              const role = user?.role || CrmAuth.getUser()?.role;
              const isAdmin = ['ADMIN','DEVELOPER'].includes(role);
              const isSeller = role === 'VENDEDOR';

              const togglePref = async (section, key) => {
                const current = (notifPrefs[section]?.[key]) !== false;
                const next = !current;
                const updated = { ...notifPrefs, [section]: { ...notifPrefs[section], [key]: next } };
                setNotifPrefs(updated);
                setNotifSaving(true);
                try {
                  await fetch(`/api/users/${user.id}/notification-prefs`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm_token')}` },
                    body: JSON.stringify({ prefs: updated }),
                  });
                } catch {
                  setNotifPrefs(prev => ({ ...prev, [section]: { ...prev[section], [key]: current } }));
                } finally { setNotifSaving(false); }
              };

              const getPref = (section, key) => (notifPrefs[section]?.[key]) !== false;

              const Toggle = ({ on, onClick }) => (
                <button type="button" onClick={onClick} disabled={notifSaving}
                  className={cx('w-9 h-5 rounded-full relative transition-colors shrink-0', on ? 'bg-brand' : 'bg-ink-300', notifSaving && 'opacity-50')}>
                  <div className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')}/>
                </button>
              );

              const PrefRow = ({ section, key: k, label, desc }) => (
                <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink-800">{label}</div>
                    {desc && <div className="text-[11.5px] text-ink-400 mt-0.5">{desc}</div>}
                  </div>
                  <Toggle on={getPref(section, k)} onClick={() => togglePref(section, k)}/>
                </div>
              );

              const isLogistics = role === 'LOGISTICA';

              return (
                <div className="p-6 space-y-5">
                  <p className="text-[12px] text-ink-400">Elegí qué notificaciones querés recibir. Los administradores pueden activar o desactivar tipos globalmente desde Configuración.</p>

                  {/* Por mail */}
                  <div className="bg-white border border-line rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                      <Icon name="mail" size={13} className="text-ink-400"/>
                      <span className="text-[12px] font-bold uppercase tracking-wider text-ink-500">Por mail</span>
                    </div>
                    <div className="px-4">
                      {isAdmin && <PrefRow section="email" k="new_register" label="Nuevo registro pendiente" desc="Cuando alguien solicita acceso al CRM."/>}
                      {isAdmin && <PrefRow section="email" k="weekly_report" label="Resumen semanal" desc="Estadísticas semanales del pipeline."/>}
                      {!isLogistics && <PrefRow section="email" k="unassigned_mail" label="Mail sin cliente asignado" desc="Cuando llega un email que no matchea ningún cliente."/>}
                      {isSeller && <PrefRow section="email" k="stage_alert" label="Tiempo de etapa excedido" desc="Recordatorio cuando tu cotización supera el plazo de una etapa."/>}
                      {isSeller && <PrefRow section="email" k="idle_reminder" label="Recordatorio de inactividad" desc="Aviso cuando tus cotizaciones llevan varios días sin movimiento."/>}
                      {isLogistics && <PrefRow section="email" k="order_new" label="Nueva OC asignada" desc="Cuando se crea una nueva orden de compra para gestionar."/>}
                      {isLogistics && <PrefRow section="email" k="order_overdue" label="Entrega vencida" desc="Cuando una OC supera su fecha estimada de entrega."/>}
                    </div>
                  </div>

                  {/* In-app */}
                  <div className="bg-white border border-line rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                      <Icon name="bell" size={13} className="text-ink-400"/>
                      <span className="text-[12px] font-bold uppercase tracking-wider text-ink-500">En el panel (campanita)</span>
                    </div>
                    <div className="px-4">
                      {isAdmin && <PrefRow section="inapp" k="unassigned_quotes" label="Solicitudes sin asignar" desc="Cotizaciones sin vendedor."/>}
                      {isAdmin && <PrefRow section="inapp" k="unlinked_presupuestos" label="Presupuestos sin vincular" desc="Presupuestos de mail sin solicitud asociada."/>}
                      {isAdmin && <PrefRow section="inapp" k="pending_users" label="Usuarios pendientes" desc="Solicitudes de acceso esperando aprobación."/>}
                      {!isLogistics && <PrefRow section="inapp" k="unlinked_solicitudes" label="Solicitudes sin presupuesto" desc="Solicitudes sin presupuesto vinculado después de X días."/>}
                      {!isLogistics && <PrefRow section="inapp" k="overdue_stages" label="Tiempo de etapa excedido" desc="Cotizaciones que superaron el plazo en su etapa actual."/>}
                      {!isLogistics && <PrefRow section="inapp" k="idle_quotes" label="Cotizaciones sin actividad" desc="Sin movimiento en más de X días."/>}
                      {isSeller && <PrefRow section="inapp" k="follow_up" label="Seguimientos vencidos" desc="Cotizaciones con fecha de seguimiento vencida."/>}
                      {isSeller && <PrefRow section="inapp" k="follow_up_upcoming" label="Seguimientos próximos" desc="Aviso anticipado antes de que venza un seguimiento."/>}
                      {isSeller && <PrefRow section="inapp" k="no_response" label="Presupuestos sin respuesta" desc="Presupuestos enviados sin respuesta del cliente, con botón para enviar recordatorio."/>}
                      {isLogistics && <PrefRow section="inapp" k="order_new_pending" label="Nuevas OCs por procesar" desc="Órdenes recién creadas esperando gestión logística."/>}
                      {isLogistics && <PrefRow section="inapp" k="order_stuck" label="OCs estancadas" desc="Órdenes con muchos días en la misma etapa sin avanzar."/>}
                      {isLogistics && <PrefRow section="inapp" k="order_delivery_today" label="Entregas del día" desc="Órdenes con fecha estimada de entrega = hoy."/>}
                      {isLogistics && <PrefRow section="inapp" k="order_overdue" label="Entregas vencidas" desc="Órdenes que superaron su fecha estimada sin ser entregadas."/>}
                    </div>
                  </div>
                </div>
              );
            })()}

            {tab === 'seguridad' && (
              <form onSubmit={handleSaveSeguridad}>
                <div className="p-6 space-y-4">
                  {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
                  {info  && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{info}</div>}

                  {/* Último cambio */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-line">
                    <Icon name="clock" size={15} className="text-ink-400 shrink-0"/>
                    <div>
                      <div className="text-[11px] text-ink-500 uppercase tracking-wider font-medium">Último cambio de contraseña</div>
                      <div className="text-[13px] font-semibold text-ink-800">{fmtDate(pwChangedAt)}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-medium text-ink-700 mb-1 block">Contraseña actual</label>
                      <PasswordInput value={currentPass} onChange={e=>setCurrentPass(e.target.value)} placeholder="Tu contraseña actual" autoComplete="current-password"/>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-ink-700 mb-1 block">Nueva contraseña</label>
                      <PasswordInput value={pass} onChange={e=>setPass(e.target.value)} placeholder="Nueva contraseña" autoComplete="new-password"/>
                      <PasswordStrength password={pass}/>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-ink-700 mb-1 block">Confirmar nueva contraseña</label>
                      <PasswordInput value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="Repetí la nueva contraseña" autoComplete="new-password"/>
                    </div>
                  </div>

                  {/* Cerrar todas las sesiones */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border border-line hover:bg-surface cursor-pointer">
                    <input type="checkbox" checked={logoutAll} onChange={e=>setLogoutAll(e.target.checked)}
                      className="mt-0.5 accent-brand w-4 h-4 shrink-0"/>
                    <div>
                      <div className="text-[13px] font-medium text-ink-800">Cerrar sesión en todos los dispositivos</div>
                      <div className="text-[11px] text-ink-400 mt-0.5">Invalidará todos los tokens activos, incluido este.</div>
                    </div>
                  </label>
                </div>

                <div className="flex justify-end gap-2 px-6 py-4 border-t border-line">
                  <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
                  <button type="submit" disabled={loading} className="btn-primary">
                    <Icon name="shield-check" size={14}/>
                    {loading ? 'Guardando...' : 'Cambiar contraseña'}
                  </button>
                </div>
              </form>
            )}

          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Login ----------
// ---------- PasswordStrength ----------
function PasswordStrength({ password }) {
  if (!password) return null;
  const rules = [
    { label: 'Mínimo 8 caracteres',     ok: password.length >= 8 },
    { label: 'Al menos una mayúscula',  ok: /[A-Z]/.test(password) },
    { label: 'Al menos un número',      ok: /[0-9]/.test(password) },
  ];
  return (
    <div className="space-y-1 mt-2">
      {rules.map(r => (
        <div key={r.label} className={cx('flex items-center gap-2 text-[12px] transition-colors', r.ok ? 'text-ok' : 'text-ink-400')}>
          <Icon name={r.ok ? 'check-circle' : 'circle'} size={13} className={r.ok ? 'text-ok' : 'text-ink-300'}/>
          {r.label}
        </div>
      ))}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, autoComplete, className }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className={cx('inp w-full pr-10', className)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
        tabIndex={-1}
      >
        <Icon name={show ? 'eye-off' : 'eye'} size={15}/>
      </button>
    </div>
  );
}

function validatePassword(pass) {
  if (pass.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(pass)) return 'Debe incluir al menos una mayúscula';
  if (!/[0-9]/.test(pass)) return 'Debe incluir al menos un número';
  return null;
}

function Login({ onLogin }) {
  const urlParams  = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('reset');

  const [screen,  setScreen]  = useState(resetToken ? 'reset' : 'login');
  const [email,   setEmail]   = useState('');
  const [pass,    setPass]    = useState('');
  const [pass2,   setPass2]   = useState('');
  const [error,      setError]      = useState('');
  const [info,       setInfo]       = useState('');
  const [loading,    setLoading]    = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState(['myselec.com', 'myselec.com.ar', 'gmail.com']);
  const [allowedEmails,  setAllowedEmails]  = useState([]);

  // Registro
  const [reg, setReg] = useState({ name:'', lastName:'', email:'', phone:'', dni:'', pass:'', pass2:'' });
  const setRegF = (k, v) => setReg(r => ({ ...r, [k]: v }));

  // Cargar dominios y correos permitidos al montar
  React.useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.allowedDomains?.length) setAllowedDomains(d.allowedDomains);
        if (d?.allowedEmails?.length)  setAllowedEmails(d.allowedEmails.map(e => e.toLowerCase()));
      })
      .catch(() => {});
  }, []);

  const isEmailAllowed = (emailVal) => {
    const normalized = (emailVal || '').toLowerCase().trim();
    if (allowedEmails.includes(normalized)) return true;
    const domain = normalized.split('@')[1];
    return domain && allowedDomains.includes(domain);
  };

  const domainHint = () => {
    const corp = allowedDomains.filter(d => d !== 'gmail.com');
    const parts = corp.map(d => `@${d}`).join(', ');
    return `Solo se aceptan correos de ${parts ? parts + ', ' : ''}Gmail (únicamente autorizados por el administrador).`;
  };

  const bgStyle = {
    background: '#0F1B2D',
    backgroundImage: 'radial-gradient(circle at 20% 30%, #3B82F620 0, transparent 40%), radial-gradient(circle at 80% 70%, #3B82F610 0, transparent 35%), linear-gradient(#ffffff09 1px, transparent 1px), linear-gradient(90deg, #ffffff09 1px, transparent 1px)',
    backgroundSize: 'auto, auto, 40px 40px, 40px 40px',
  };

  const goTo = (s) => { setScreen(s); setError(''); setInfo(''); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const result = await CrmApi.login(email, pass, rememberMe);
      CrmAuth.setToken(result.token);
      CrmAuth.setUser(result.user);
      onLogin();
    } catch (err) {
      setError(err.message || 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await CrmApi.forgotPassword(email);
      setInfo('¡Link enviado! Revisá tu casilla de correo.');
    } catch (err) {
      setError(err.message || 'Error al enviar mail');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    const pwErr = validatePassword(pass);
    if (pwErr) { setError(pwErr); return; }
    if (pass !== pass2) { setError('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      await CrmApi.resetPassword(resetToken, pass);
      window.history.replaceState({}, '', '/');
      setInfo('Contraseña restablecida. Podés iniciar sesión.');
      goTo('login');
    } catch (err) {
      setError(err.message || 'Token inválido o expirado');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!reg.name.trim() || !reg.lastName.trim() || !reg.email.trim()) {
      setError('Completá nombre, apellido y email'); return;
    }
    if (!isEmailAllowed(reg.email)) {
      setError(domainHint()); return;
    }
    const pwErr = validatePassword(reg.pass);
    if (pwErr) { setError(pwErr); return; }
    if (reg.pass !== reg.pass2) { setError('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      await CrmApi.register(reg);
      goTo('registered');
    } catch (err) {
      setError(err.message || 'Error al registrarse');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={bgStyle}>
      <div className="relative flex items-center justify-center p-8 w-full">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.4)] p-8 border border-line">
          <div className="flex flex-col items-center mb-8">
            <div style={{
              background: 'linear-gradient(135deg, #1B2A4A 0%, #2D4A6F 100%)',
              borderRadius: 20,
              padding: '18px 28px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(27,42,74,0.35)',
              marginBottom: 0,
            }}>
              <img src="/Logo.png" alt="MySelec" style={{ height: 48, width: 'auto', objectFit: 'contain', display: 'block' }}/>
            </div>
          </div>

          {screen === 'login' && (
            <form onSubmit={handleLogin}>
              <h2 className="text-xl font-bold text-ink-900">Iniciar sesión</h2>
              <p className="text-sm text-ink-500 mb-6">Ingresá con tu cuenta corporativa.</p>
              {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
              {info  && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{info}</div>}
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Email</label>
              <input className="inp w-full mb-4" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@myselec.com.ar" autoComplete="email"/>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-ink-700">Contraseña</label>
                <button type="button" onClick={()=>goTo('forgot')}
                  className="text-[11px] text-brand hover:underline">¿Olvidaste tu contraseña?</button>
              </div>
              <PasswordInput value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" className="mb-4"/>
              <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
                <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded accent-brand cursor-pointer"/>
                <span className="text-xs text-ink-600">Recordarme por 7 días</span>
              </label>
              <button className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? 'Ingresando...' : 'Iniciar sesión'}
              </button>
              <div className="mt-4 text-center text-xs text-ink-500">
                ¿No tenés cuenta?{' '}
                <button type="button" onClick={()=>goTo('register')} className="text-brand hover:underline font-medium">
                  Registrate
                </button>
              </div>
            </form>
          )}

          {screen === 'forgot' && (
            <form onSubmit={handleForgot}>
              <button type="button" onClick={()=>goTo('login')}
                className="flex items-center gap-1 text-ink-400 hover:text-ink-700 text-xs mb-4">
                <Icon name="arrow-left" size={13}/> Volver
              </button>
              <h2 className="text-xl font-bold text-ink-900">Recuperar contraseña</h2>
              <p className="text-sm text-ink-500 mb-6">Te enviaremos un link para restablecer tu contraseña.</p>
              {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
              {info  && <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{info}</div>}
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Email</label>
              <input className="inp w-full mb-6" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@myselec.com.ar" autoComplete="email"/>
              <button className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar link de recuperación'}
              </button>
            </form>
          )}

          {screen === 'reset' && (
            <form onSubmit={handleReset}>
              <h2 className="text-xl font-bold text-ink-900">Nueva contraseña</h2>
              <p className="text-sm text-ink-500 mb-4">Elegí una contraseña segura.</p>
              {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Nueva contraseña</label>
              <PasswordInput value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" autoComplete="new-password"/>
              <PasswordStrength password={pass}/>
              <div className="mb-4"/>
              <label className="block text-xs font-medium text-ink-700 mb-1.5">Confirmar contraseña</label>
              <PasswordInput value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="••••••••" autoComplete="new-password" className="mb-6"/>
              <button className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? 'Guardando...' : 'Establecer nueva contraseña'}
              </button>
            </form>
          )}

          {screen === 'register' && (
            <form onSubmit={handleRegister}>
              <button type="button" onClick={()=>goTo('login')}
                className="flex items-center gap-1 text-ink-400 hover:text-ink-700 text-xs mb-4">
                <Icon name="arrow-left" size={13}/> Volver
              </button>
              <h2 className="text-xl font-bold text-ink-900">Crear cuenta</h2>
              <p className="text-sm text-ink-500 mb-5">Un administrador revisará tu solicitud y te avisará por mail.</p>
              {error && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">Nombre *</label>
                  <input className="inp w-full" value={reg.name} onChange={e=>setRegF('name',e.target.value)} placeholder="Juan"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">Apellido *</label>
                  <input className="inp w-full" value={reg.lastName} onChange={e=>setRegF('lastName',e.target.value)} placeholder="García"/>
                </div>
              </div>
              <label className="block text-xs font-medium text-ink-700 mb-1">Email *</label>
              <input className="inp w-full mb-3" value={reg.email} onChange={e=>setRegF('email',e.target.value)} placeholder="tu@email.com" autoComplete="email"/>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">Teléfono <span className="text-ink-400 font-normal">(opcional)</span></label>
                  <input className="inp w-full" value={reg.phone} onChange={e=>setRegF('phone',e.target.value)} placeholder="11 1234-5678"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">DNI <span className="text-ink-400 font-normal">(opcional)</span></label>
                  <input className="inp w-full" value={reg.dni} onChange={e=>setRegF('dni',e.target.value)} placeholder="12345678"/>
                </div>
              </div>
              <label className="block text-xs font-medium text-ink-700 mb-1">Contraseña *</label>
              <PasswordInput value={reg.pass} onChange={e=>setRegF('pass',e.target.value)} placeholder="••••••••" autoComplete="new-password"/>
              <PasswordStrength password={reg.pass}/>
              <label className="block text-xs font-medium text-ink-700 mb-1 mt-3">Confirmar contraseña *</label>
              <PasswordInput value={reg.pass2} onChange={e=>setRegF('pass2',e.target.value)} placeholder="••••••••" autoComplete="new-password" className="mb-5"/>
              <button className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? 'Enviando solicitud...' : 'Solicitar acceso'}
              </button>
            </form>
          )}

          {screen === 'registered' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Icon name="check" size={28} className="text-emerald-600"/>
              </div>
              <h2 className="text-xl font-bold text-ink-900 mb-2">¡Solicitud enviada!</h2>
              <p className="text-sm text-ink-500 mb-6">
                Tu cuenta está siendo revisada por un administrador. Te enviaremos un mail cuando esté lista para usar.
              </p>
              <button className="btn-secondary w-full justify-center" onClick={()=>goTo('login')}>
                Volver al inicio de sesión
              </button>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-line text-center">
            <div className="text-[11px] uppercase tracking-wider text-ink-400">Sistema de Gestión Comercial</div>
            <div className="text-xs text-ink-500 mt-0.5">MySelec · v2026.04</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Decodifica el payload del JWT sin verificación (solo para display)
function decodeJwtPayload(token) {
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
}

// ---------- Sidebar ----------
function Sidebar({ role, screen, setScreen, user, onProfileOpen, collapsed, onToggle, badges = {} }) {
  // Mismo patrón que Topbar: JWT como fallback confiable
  const _authUser = CrmAuth.getUser();
  const _jwt = decodeJwtPayload(CrmAuth.getToken());
  const resolvedUser = _authUser || _jwt;
  const effectiveRole = resolvedUser?.role;
  const effectiveName = user?.name || resolvedUser?.name;
  const navAdmin = [
    { id:'dashboard', label:'Dashboard',             icon:'layout-dashboard' },
    { id:'quotes',    label:'Cotizaciones',          icon:'clipboard-list', sub:'Fase 1' },
    { id:'orders',    label:'Órdenes de Compra',     icon:'package',        sub:'Fase 2' },
    { id:'clients',   label:'Clientes',              icon:'building-2' },
    { id:'comparativa', label:'Comparativa',           icon:'git-compare', sub:'Pres. vs NP' },
    { id:'team',        label:'Equipo',                icon:'users' },
    { id:'config',      label:'Configuración',         icon:'settings' },
    { id:'feedback',    label:'Foro',                  icon:'message-circle', sub:'Soporte interno' },
  ];
  const navSeller = [
    { id:'my-quotes',   label:'Mis Cotizaciones',      icon:'clipboard-list' },
    { id:'my-orders',   label:'Mis Órdenes de Compra', icon:'package' },
    { id:'quotes',      label:'Pipeline Cotizaciones', icon:'layout',     sub:'Kanban Fase 1' },
    { id:'orders',      label:'Pipeline OCs',          icon:'columns',    sub:'Kanban Fase 2' },
    { id:'clients',     label:'Clientes',              icon:'building-2', sub:'solo lectura' },
    { id:'comparativa', label:'Comparativa',           icon:'git-compare', sub:'Pres. vs NP' },
    { id:'feedback',    label:'Foro',                  icon:'message-circle', sub:'Soporte interno' },
  ];
  const navLog = [
    { id:'ops',      label:'Operaciones', icon:'truck',        sub:'Centro de logística' },
    { id:'clients',  label:'Clientes',    icon:'building-2',   sub:'Direcciones y datos' },
    { id:'feedback', label:'Foro',        icon:'message-circle', sub:'Soporte interno' },
  ];
  const nav = role === 'admin' ? navAdmin : role === 'seller' ? navSeller : navLog;
  const roleLabel = { DEVELOPER:'Desarrollador', ADMIN:'Administrador', VENDEDOR:'Vendedor', LOGISTICA:'Logística' };

  return (
    <aside
      className="shrink-0 bg-navy-900 text-white flex flex-col h-screen overflow-hidden"
      style={{ width: collapsed ? 60 : 244, transition: 'width 0.2s ease' }}
    >
      {/* Logo — click vuelve al inicio */}
      {collapsed ? (
        <div className="flex items-center justify-center border-b border-white/5 py-4 cursor-pointer" style={{height:64}}
          onClick={() => setScreen(nav[0]?.id || 'dashboard')} title="Ir al inicio">
          <Logo size={32}/>
        </div>
      ) : (
        <div className="flex items-center justify-center border-b border-white/5 px-5 cursor-pointer" style={{height:72}}
          onClick={() => setScreen(nav[0]?.id || 'dashboard')} title="Ir al inicio">
          <img
            src="/Logo.png"
            alt="MySelec"
            style={{ maxWidth: 130, maxHeight: 36, width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 space-y-0.5 overflow-hidden" style={{ padding: collapsed ? '16px 8px' : '16px 10px' }}>
        {!collapsed && (
          <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-white/35 font-semibold">
            {role==='admin' ? 'Gestión' : role==='seller' ? 'Mi pipeline' : 'Operaciones'}
          </div>
        )}
        {nav.map(n => {
          const badge = badges[n.id] || 0;
          return (
            <button key={n.id} onClick={()=>setScreen(n.id)}
              title={collapsed ? n.label : undefined}
              className={cx(
                'w-full flex items-center rounded-lg py-2.5 text-[13.5px] transition-colors',
                collapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left',
                screen === n.id
                  ? 'bg-brand text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                  : 'text-white/75 hover:bg-white/5 hover:text-white'
              )}
            >
              <div className="relative shrink-0">
                <Icon name={n.icon} size={17}/>
                {badge > 0 && collapsed && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-orange-400 text-[8px] font-bold text-white flex items-center justify-center leading-none">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              {!collapsed && (
                <span className="flex-1 leading-tight whitespace-nowrap overflow-hidden">
                  {n.label}
                  {n.sub && <span className="block text-[10px] uppercase tracking-wider opacity-60 font-medium">{n.sub}</span>}
                </span>
              )}
              {!collapsed && badge > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-400 text-[10px] font-bold text-white flex items-center justify-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5" style={{ padding: collapsed ? '12px 8px' : '12px 10px' }}>
        {/* Toggle button */}
        <button
          onClick={onToggle}
          title={collapsed ? 'Expandir panel' : 'Colapsar panel'}
          className={cx(
            'w-full flex items-center rounded-lg py-2 mb-2 hover:bg-white/8 transition-colors text-white/40 hover:text-white/70',
            collapsed ? 'justify-center' : 'gap-2 px-3'
          )}
        >
          <Icon name={collapsed ? 'panel-left-open' : 'panel-left-close'} size={15}/>
          {!collapsed && <span className="text-[11.5px] whitespace-nowrap overflow-hidden">Ocultar panel</span>}
        </button>

        {/* Perfil */}
        <button onClick={onProfileOpen}
          title={collapsed ? (user?.name || '') : undefined}
          className={cx(
            'w-full flex items-center rounded-xl py-2.5 hover:bg-white/8 transition-colors group',
            collapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left'
          )}
        >
          <Avatar name={effectiveName} size={34} src={user?.avatar || resolvedUser?.avatar}/>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="text-[13px] font-semibold text-white truncate">{effectiveName || '—'}</div>
                <div className="text-[12px] text-white/75">{roleLabel[effectiveRole] || '—'}</div>
              </div>
              <Icon name="settings" size={14} className="text-white/30 group-hover:text-white/60 shrink-0"/>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

// ---------- SyncResultModal ----------
function SyncResultModal({ result, onClose }) {
  const typeLabel = { PRESUPUESTO:'Presupuesto', SOLICITUD:'Solicitud', NOTA_PEDIDO:'Nota de Pedido', OC:'OC Email' };
  const typeColor = { PRESUPUESTO:'bg-blue-100 text-blue-700', SOLICITUD:'bg-sky-100 text-sky-700', NOTA_PEDIDO:'bg-indigo-100 text-indigo-700', OC:'bg-amber-100 text-amber-700' };
  const mails = result.mails || [];
  const errors = result.errors || [];
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}/>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-pop w-full max-w-md pointer-events-auto" onClick={e=>e.stopPropagation()}>
          {/* Header */}
          <div className="px-6 py-4 border-b border-line flex items-center gap-3">
            <div className={cx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', result.synced > 0 ? 'bg-emerald-100' : 'bg-ink-100')}>
              <Icon name={result.synced > 0 ? 'mail-check' : 'mail'} size={18} className={result.synced > 0 ? 'text-emerald-600' : 'text-ink-400'}/>
            </div>
            <div>
              <div className="font-semibold text-ink-900 text-sm">Sincronización completada</div>
              <div className="text-[12px] text-ink-500">
                {result.synced > 0 ? `${result.synced} mail${result.synced > 1 ? 's' : ''} procesado${result.synced > 1 ? 's' : ''}` : 'No hay mails nuevos'}
              </div>
            </div>
            <button onClick={onClose} className="ml-auto w-8 h-8 rounded-lg hover:bg-surface flex items-center justify-center text-ink-400">
              <Icon name="x" size={15}/>
            </button>
          </div>
          {/* Mail list */}
          {mails.length > 0 && (
            <div className="max-h-72 overflow-y-auto scroll-thin divide-y divide-line">
              {mails.map((m, i) => (
                <div key={i} className="px-5 py-3 flex items-start gap-3">
                  <span className={cx('chip shrink-0 mt-0.5', typeColor[m.mailType] || 'bg-ink-100 text-ink-600')}>
                    {typeLabel[m.mailType] || m.mailType}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-ink-900 truncate">{m.clientName || m.subject || '(sin asunto)'}</div>
                    <div className="text-[11px] text-ink-400 mt-0.5 flex gap-2 flex-wrap">
                      {m.flexxusCode && <span className="mono">{m.flexxusCode}</span>}
                      {m.sellerName  && <span>· {m.sellerName}</span>}
                      {m.itemCount > 0 && <span>· {m.itemCount} ítem{m.itemCount > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {mails.length === 0 && (
            <div className="px-6 py-8 text-center text-[13px] text-ink-400">
              Todos los mensajes ya estaban procesados.
            </div>
          )}
          {/* Errors */}
          {errors.length > 0 && (
            <div className="px-5 py-3 bg-red-50 border-t border-red-100">
              <div className="text-[11px] font-semibold text-red-600 mb-1">⚠ {errors.length} error{errors.length > 1 ? 'es' : ''}</div>
              {errors.slice(0,3).map((e,i) => <div key={i} className="text-[11px] text-red-500 truncate">{e}</div>)}
            </div>
          )}
          {/* Footer */}
          <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
            {result.synced > 0 && (
              <button className="btn-ghost text-sm" onClick={() => window.location.reload()}>
                <Icon name="refresh-cw" size={13}/>Recargar
              </button>
            )}
            <button className="btn-primary text-sm" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Topbar ----------
function Topbar({ user, roleKey, setRoleKey, setScreen }) {
  const { notifications, inboxAlerts, openModal, pushToast } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const _authUser = CrmAuth.getUser();
  const _jwt = decodeJwtPayload(CrmAuth.getToken());
  const loggedUser = _authUser || _jwt; // JWT como fallback si crm_user no está guardado
  const isAdmin = ['ADMIN','DEVELOPER'].includes(loggedUser?.role);
  // Badge: solo cantidad de alertas pendientes (tab "Pendiente"), sin contar actividad
  const unreadCount = (inboxAlerts || []).length;

  const handleLogout = () => {
    CrmAuth.clearToken();
    localStorage.removeItem('crm_user');
    window.location.reload();
  };

  return (
    <header className="h-[62px] bg-white border-b border-line flex items-center gap-4 px-6 shrink-0 relative">
      <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
        <img src="/Logo-M.png" alt="MySelec" style={{height:26, width:'auto', objectFit:'contain', flexShrink:0, cursor: setScreen ? 'pointer' : 'default'}}
          onClick={() => setScreen && setScreen(roleKey==='admin' ? 'dashboard' : roleKey==='seller' ? 'my-quotes' : 'ops')}
          title="Ir al inicio"/>
        <span className="text-ink-300">/</span>
        <span className="font-semibold text-ink-900 truncate">
          {(user?.name || loggedUser?.name)?.split(' ')?.[0] || 'MySelec CRM'}
        </span>
        {loggedUser?.role && (
          <span className="text-[11px] text-ink-400 font-medium hidden sm:inline">
            · {{DEVELOPER:'Desarrollador', ADMIN:'Administrador', VENDEDOR:'Vendedor', LOGISTICA:'Logística'}[loggedUser.role] || ''}
          </span>
        )}
      </div>

      {/* El rol se asigna desde el JWT — no hay selector manual en producción */}

      <button onClick={()=>openModal('search')}
        className="relative hidden md:inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-surface hover:bg-white hover:border-line border border-transparent text-ink-500 text-xs">
        <Icon name="search" size={14}/>
        <span>Buscar…</span>
        <kbd className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border border-line bg-white text-ink-500">⌘K</kbd>
      </button>

      <div className="relative">
        <button onClick={()=>setNotifOpen(o=>!o)}
          className="relative w-9 h-9 rounded-lg hover:bg-surface flex items-center justify-center text-ink-700">
          <Icon name="bell" size={17}/>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span>
          )}
        </button>
        {notifOpen && <NotificationsPopover onClose={()=>setNotifOpen(false)} setScreen={setScreen}/>}
      </div>

      <button onClick={handleLogout} title="Cerrar sesión"
        className="w-9 h-9 rounded-lg hover:bg-surface flex items-center justify-center text-ink-400 hover:text-bad border border-transparent hover:border-line transition-colors">
        <Icon name="log-out" size={15}/>
      </button>

    </header>
  );
}

// ---------- Dashboard ----------
function Dashboard({ setScreen }) {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
          PieChart, Pie, Cell, AreaChart, Area } = window.Recharts;
  const { quotes, users, clients, activity, openModal } = useApp();
  const [kpisData, setKpisData] = useState(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [chartSellers, setChartSellers] = useState(null);
  const [chartStages, setChartStages] = useState(null);
  const [chartMonthly, setChartMonthly] = useState(null);
  const [chartFunnel, setChartFunnel] = useState(null);
  const [chartRejections, setChartRejections] = useState(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  // ── Filtros del dashboard ───────────────────────────────────────────────────
  const [filters, setFilters] = useState({ sellerId: '', from: '', to: '' });
  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }));
  const resetFilters = () => setFilters({ sellerId: '', from: '', to: '' });
  const hasFilters = filters.sellerId || filters.from || filters.to;

  useEffect(() => {
    setKpisLoading(true);
    setAlertsLoading(true);
    setChartsLoading(true);

    // Pasada 1: KPIs + Alertas (prioritarios — aparecen primero)
    Promise.all([
      CrmApi.getDashboard(filters),
      CrmApi.getAlerts({ sellerId: filters.sellerId }),
    ]).then(([dash, alertsData]) => {
      setKpisData(dash);
      setAlerts(alertsData || []);
      setKpisLoading(false);
      setAlertsLoading(false);
    }).catch(() => { setKpisLoading(false); setAlertsLoading(false); });

    // Pasada 2: Gráficos (se cargan solos con su loading state)
    Promise.all([
      CrmApi.getChartSellers(filters),
      CrmApi.getChartStages(filters),
      CrmApi.getChartMonthly({ sellerId: filters.sellerId }),
      CrmApi.getChartFunnel(filters),
      CrmApi.getChartRejections(filters),
    ]).then(([sellers, stages, monthly, funnel, rejections]) => {
      setChartSellers(sellers);
      setChartStages(stages);
      setChartMonthly(monthly);
      setChartFunnel(funnel || []);
      setChartRejections(rejections || []);
      setChartsLoading(false);
    }).catch(() => setChartsLoading(false));
  }, [filters.sellerId, filters.from, filters.to]);

  const kv  = (val) => kpisLoading ? '...' : (val ?? '—');
  const kMoney = (val) => kpisLoading ? '...' : (val ? `$ ${(val / 1000).toFixed(0)}k` : '—');

  const fmtHours = (h) => {
    if (h == null) return '—';
    if (h < 1) return '<1h';
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    const rem = h % 24;
    return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
  };

  const kpis = [
    { label: 'Cotizaciones activas',  value: kv(kpisData?.cotizacionesActivas) },
    { label: 'Presupuestos enviados', value: kv(kpisData?.presupuestosEnviados) },
    { label: 'OC en curso',           value: kv(kpisData?.ocEnCurso) },
    { label: 'Entregas este mes',     value: kv(kpisData?.entregasEsteMes) },
    { label: 'Monto cotizado',        value: kMoney(kpisData?.montoTotal), sub: 'presupuestos' },
    { label: 'Monto confirmado',      value: kMoney(kpisData?.montoConfirmado), sub: 'notas de pedido', highlight: true },
    { label: 'Tasa de conversión',    value: kpisLoading ? '...' : (kpisData?.tasaConversion != null ? `${Number(kpisData.tasaConversion).toFixed(0)}%` : '—') },
    { label: 'Tiempo de respuesta',   value: kpisLoading ? '...' : fmtHours(kpisData?.avgResponseHours), sub: 'promedio recibida → acción', icon: 'clock' },
    { label: 'Pendientes +24h',       value: kv(kpisData?.pendingAttention), sub: 'sin atender', icon: 'alert-triangle',
      warn: !kpisLoading && kpisData?.pendingAttention > 0 },
  ];

  // ── Vendedores disponibles para el filtro ───────────────────────────────────
  const sellerUsers = users.filter(u => ['VENDEDOR', 'ADMIN', 'Vendedor', 'Administrador'].includes(u.role));

  const loggedUser = CrmAuth.getUser();
  const firstName = loggedUser?.name?.split(' ')[0] || 'Usuario';
  const hour = new Date().getHours();
  const greeting = hour >= 6 && hour < 12 ? 'Buenos días' : hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const overdueQuotes = quotes.filter(q => q.dias >= 5 && !['aceptada','rechazada'].includes(q.stage));

  return (
    <div>
      <PageHead
        subtitle="Vista general · Administrador"
        title={`${greeting}, ${firstName}.`}
        description={`Resumen comercial al ${new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' })}.`}
        actions={null}
      />
      <div className="p-6 space-y-5 max-w-[1600px] mx-auto">

        {/* ── Filter bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filters.sellerId}
            onChange={e => setFilter('sellerId', e.target.value)}
            className="h-8 rounded-lg border border-line bg-white px-3 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="">Todos los vendedores</option>
            {sellerUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500 font-medium">Desde</span>
            <input
              type="date"
              value={filters.from}
              onChange={e => setFilter('from', e.target.value)}
              className="h-8 rounded-lg border border-line bg-white px-2 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-500 font-medium">Hasta</span>
            <input
              type="date"
              value={filters.to}
              onChange={e => setFilter('to', e.target.value)}
              className="h-8 rounded-lg border border-line bg-white px-2 text-sm text-ink-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Chips de mes rápido — últimos 6 meses */}
          {(() => {
            const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            const now = new Date();
            return Array.from({ length: 6 }, (_, i) => {
              const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
              const from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
              const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
              const to   = `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;
              const label = MES[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ` '${String(d.getFullYear()).slice(2)}` : '');
              const active = filters.from === from && filters.to === to;
              return (
                <button key={from}
                  onClick={() => setFilters(f => ({ ...f, from, to }))}
                  className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors ${active ? 'bg-navy-900 text-white border-navy-900' : 'bg-white text-ink-600 border-line hover:border-navy-900 hover:text-navy-900'}`}>
                  {label}
                </button>
              );
            });
          })()}

          {hasFilters && (
            <button
              onClick={resetFilters}
              className="h-8 px-3 rounded-lg border border-line bg-white text-xs text-ink-500 hover:text-red-500 hover:border-red-200 transition-colors flex items-center gap-1"
            >
              <span>✕</span> Limpiar filtros
            </button>
          )}

          {kpisLoading && (
            <span className="text-xs text-ink-400 italic ml-auto">Actualizando...</span>
          )}
        </div>

        {/* ── KPI cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {kpis.map((k,i) => (
            <div key={i} className={`bg-white rounded-xl border p-4 shadow-card ${
              k.warn ? 'border-amber-300 bg-amber-50' :
              k.highlight ? 'border-blue-200 bg-blue-50' : 'border-line'
            }`}>
              <div className={`text-[11px] uppercase tracking-wider font-semibold leading-tight ${k.warn ? 'text-amber-700' : 'text-ink-500'}`}>{k.label}</div>
              <div className={`text-2xl font-bold mt-2 ${
                k.warn ? 'text-amber-700' :
                k.highlight ? 'text-blue-700' : 'text-ink-900'
              }`}>{k.value}</div>
              {k.sub && <div className={`text-[10px] mt-0.5 ${k.warn ? 'text-amber-600' : 'text-ink-400'}`}>{k.sub}</div>}
            </div>
          ))}
        </div>

        {/* ── Alertas: presupuestos enviados sin respuesta ───────────────── */}
        {(alertsLoading || alerts.length > 0) && (
          <div className="bg-white rounded-xl border border-amber-200 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-100 bg-amber-50">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              <div className="text-sm font-semibold text-amber-800">Presupuestos enviados sin respuesta</div>
              {!alertsLoading && (
                <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">
                  {alerts.length} {alerts.length === 1 ? 'cotización' : 'cotizaciones'}
                </span>
              )}
            </div>
            {alertsLoading ? (
              <div className="px-5 py-4 text-sm text-ink-400">Cargando...</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-ink-400 border-b border-line bg-surface">
                    <th className="text-left px-4 py-2 font-medium">Código</th>
                    <th className="text-left px-4 py-2 font-medium">Cliente</th>
                    <th className="text-left px-4 py-2 font-medium">Vendedor</th>
                    <th className="text-right px-4 py-2 font-medium">Monto</th>
                    <th className="text-right px-4 py-2 font-medium">Sin respuesta</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(a => (
                    <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface cursor-pointer transition-colors"
                        onClick={() => openModal('quoteDetail', { code: a.code })}>
                      <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-blue-600">{a.code}</td>
                      <td className="px-4 py-2.5 text-ink-800 font-medium">{a.clientName}</td>
                      <td className="px-4 py-2.5 text-ink-500">{a.sellerName}</td>
                      <td className="px-4 py-2.5 text-right text-ink-700 font-mono text-[13px]">
                        {a.amount ? `$ ${(a.amount / 1000).toFixed(0)}k` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${a.daysWaiting >= 7 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                          {a.daysWaiting}d
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Cotizaciones por vendedor</div>
              <div className="text-xs text-ink-500">
                {filters.from || filters.to
                  ? `${filters.from || '—'} → ${filters.to || 'hoy'} · cotizadas vs. ganadas`
                  : 'Período seleccionado · cotizadas vs. ganadas'}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartSellers ?? CH_SELLERS} barCategoryGap={18}>
                <CartesianGrid stroke="#F1F5F9" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:12, fill:'#64748B'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{fill:'#F1F5F9'}} contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
                <Legend iconType="circle" wrapperStyle={{fontSize:12, paddingTop:4}}/>
                <Bar dataKey="cotiz"   name="Cotizadas" fill="#1B2A4A" radius={[4,4,0,0]}/>
                <Bar dataKey="ganadas" name="Ganadas"   fill="#3B82F6" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="col-span-3 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Distribución por etapa</div>
              <div className="text-xs text-ink-500">
                {chartStages?.total ?? '...'} cotizaciones
                {filters.sellerId ? ` · ${sellerUsers.find(u=>u.id===filters.sellerId)?.name || ''}` : ''}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={chartStages?.stages ?? CH_STAGE_DIST} dataKey="value" nameKey="name"
                     innerRadius={48} outerRadius={78} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                  {(chartStages?.stages ?? CH_STAGE_DIST).map((e,i)=><Cell key={i} fill={e.color}/>)}
                </Pie>
                <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
              {(chartStages?.stages ?? CH_STAGE_DIST).map(e=>(
                <div key={e.name} className="flex items-center gap-1.5 text-[11px] text-ink-700">
                  <span className="w-2 h-2 rounded-sm" style={{background:e.color}}/>
                  <span className="truncate flex-1">{e.name}</span>
                  <span className="font-semibold">{e.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-4 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-ink-900">Evolución mensual</div>
              <div className="text-xs text-ink-500">
                Últimos 6 meses · recibidas vs. ganadas
                {filters.sellerId ? ` · ${sellerUsers.find(u=>u.id===filters.sellerId)?.name?.split(' ')[0] || ''}` : ''}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartMonthly ?? CH_MONTHLY}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35}/>
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.35}/>
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#F1F5F9" vertical={false}/>
                <XAxis dataKey="month" tick={{fontSize:12, fill:'#64748B'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}}/>
                <Legend iconType="circle" wrapperStyle={{fontSize:12, paddingTop:4}}/>
                <Area type="monotone" dataKey="recibidas" name="Recibidas" stroke="#3B82F6" strokeWidth={2} fill="url(#g1)"/>
                <Area type="monotone" dataKey="ganadas"   name="Ganadas"   stroke="#10B981" strokeWidth={2} fill="url(#g2)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Embudo + Motivos de rechazo ────────────────────────────────── */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-6 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink-900">Embudo de conversión</div>
              <div className="text-xs text-ink-500">
                Del total recibido, cuántas llegaron a cada etapa
                {filters.sellerId ? ` · ${sellerUsers.find(u=>u.id===filters.sellerId)?.name?.split(' ')[0] || ''}` : ''}
              </div>
            </div>
            {chartsLoading ? (
              <div className="h-[180px] flex items-center justify-center text-xs text-ink-400">Cargando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartFunnel ?? []} layout="vertical" margin={{ left: 10, right: 40, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke="#F1F5F9" horizontal={false}/>
                  <XAxis type="number" tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="label" tick={{fontSize:12, fill:'#64748B'}} axisLine={false} tickLine={false} width={80}/>
                  <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}} formatter={(v) => [v, 'Cotizaciones']}/>
                  <Bar dataKey="value" radius={[0,4,4,0]}>
                    {(chartFunnel ?? []).map((e,i) => <Cell key={i} fill={e.color}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="col-span-6 bg-white rounded-xl border border-line shadow-card p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-ink-900">Motivos de rechazo</div>
                <div className="text-xs text-ink-500">
                  Por qué se perdieron cotizaciones en el período
                  {filters.sellerId ? ` · ${sellerUsers.find(u=>u.id===filters.sellerId)?.name?.split(' ')[0] || ''}` : ''}
                </div>
              </div>
              <button onClick={() => setScreen('rechazos')}
                className="text-xs text-brand hover:underline whitespace-nowrap flex items-center gap-1">
                Ver detalle <Icon name="arrow-right" size={12}/>
              </button>
            </div>
            {chartsLoading ? (
              <div className="h-[180px] flex items-center justify-center text-xs text-ink-400">Cargando...</div>
            ) : !chartRejections?.length ? (
              <div className="h-[180px] flex items-center justify-center flex-col gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span className="text-xs text-ink-400">Sin rechazos en el período</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartRejections} layout="vertical" margin={{ left: 10, right: 40, top: 4, bottom: 4 }}>
                  <CartesianGrid stroke="#F1F5F9" horizontal={false}/>
                  <XAxis type="number" tick={{fontSize:11, fill:'#94A3B8'}} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="name" tick={{fontSize:11, fill:'#64748B'}} axisLine={false} tickLine={false} width={100}/>
                  <Tooltip contentStyle={{border:'1px solid #E2E8F0', borderRadius:8, fontSize:12}} formatter={(v) => [v, 'Cotizaciones']}/>
                  <Bar dataKey="value" fill="#EF4444" radius={[0,4,4,0]}/>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-7 bg-white rounded-xl border border-line shadow-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <div>
                <div className="text-sm font-semibold text-ink-900">Cotizaciones próximas a vencer</div>
                <div className="text-xs text-ink-500">Pasaron más de 5 días sin resolución</div>
              </div>
              {overdueQuotes.length > 0 && <Badge tone="red" dot>{overdueQuotes.length} vencidas</Badge>}
            </div>
            <table className="w-full tbl">
              <thead>
                <tr>
                  <th>Código</th><th>Cliente</th><th>Vendedor</th><th>Etapa</th>
                  <th className="!text-right">Días</th><th className="!text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {overdueQuotes.slice(0,5).map(q => {
                  const stg = STAGES_F1.find(x=>x.id===q.stage);
                  const sellerName = q.sellerName || users.find(u=>u.id===q.seller)?.name || '—';
                  return (
                    <tr key={q.code} className="cursor-pointer" onClick={()=>openModal('quoteDetail', { code:q.code })}>
                      <td className="mono text-[12px] font-semibold text-navy-900">{q.code}</td>
                      <td className="font-medium">{q.clientName || clients.find(c=>c.code===q.client)?.name || '—'}</td>
                      <td><div className="flex items-center gap-2"><Avatar name={sellerName} size={22}/>{sellerName.split(' ')[0]}</div></td>
                      <td>{stg ? <Badge tone={stg.tone} dot>{stg.label}</Badge> : q.stage}</td>
                      <td className="text-right"><span className="mono text-bad font-semibold">{q.dias}d</span></td>
                      <td className="text-right mono">{q.monto != null ? fmtMoney(q.monto) : '—'}</td>
                    </tr>
                  );
                })}
                {overdueQuotes.length === 0 && (
                  <tr><td colSpan="6" className="text-center text-ink-400 text-[13px] py-6">Sin cotizaciones vencidas</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="col-span-5 bg-white rounded-xl border border-line shadow-card">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <div className="text-sm font-semibold text-ink-900">Últimas actividades</div>
              <button className="text-xs text-brand hover:underline">Ver todo</button>
            </div>
            <ul className="p-2 max-h-[360px] overflow-y-auto scroll-thin">
              {activity.map((a,i) => {
                const u = users.find(x=>x.id===a.by);
                return (
                  <li key={i} className="flex gap-3 px-3 py-2.5 rounded-lg hover:bg-surface">
                    <Avatar name={u?.name || '?'} size={28}/>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-ink-900 leading-snug">{a.text}</div>
                      <div className="text-[11px] text-ink-500 mt-0.5 mono">{fmtDateTime(a.at)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Mount ----------
ReactDOM.createRoot(document.getElementById('root')).render(<AppRoot/>);
