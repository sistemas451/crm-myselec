/* CRM MySelec — App shell: login, sidebar, topbar, role routing.
   Depends on: crm-data.jsx, crm-interact.jsx, crm-kanban.jsx, crm-details.jsx, crm-views.jsx */

const { useState, useEffect } = React;

function AppRoot() {
  const [logged, setLogged] = useState(CrmAuth.isLoggedIn());
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(true);

  // On login or if already has token, load API data
  useEffect(() => {
    if (!logged) { setLoading(false); return; }
    setLoading(true);
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
        setApiData(data);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [logged]);

  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-navy-950">
      <div className="text-center">
        <Logo size={72} />
        <div className="text-white/60 mt-4 text-sm">Cargando sistema...</div>
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
  const loggedUser = CrmAuth.getUser();

  // Initialize role and user ID from token on mount
  useEffect(() => {
    if (!loggedUser) return;
    const roleMap = { ADMIN: 'admin', VENDEDOR: 'seller', LOGISTICA: 'logistics' };
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
  // Merge avatar desde profileUser si fue actualizado en esta sesión
  const displayUser = profileUser ? { ...user, ...profileUser } : user;

  const openDetail = (code, kind='quote') => openModal(kind==='quote'?'quoteDetail':'orderDetail', { code });

  return (
    <div className="min-h-screen flex bg-surface" data-screen-label={`${roleKey} · ${screen}`}>
      <Sidebar role={roleKey} screen={screen} setScreen={setScreen}
        user={displayUser} onProfileOpen={() => setProfileOpen(true)}/>
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
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar user={displayUser} roleKey={roleKey} setRoleKey={setRoleKey}/>
        <main className="flex-1 min-w-0 overflow-x-hidden">
          {screen === 'dashboard'  && <Dashboard/>}
          {screen === 'quotes'     && <KanbanQuotes onOpen={(c)=>openDetail(c,'quote')}/>}
          {screen === 'orders'     && <KanbanOrders onOpen={(c)=>openDetail(c,'order')}/>}
          {screen === 'my-quotes'  && <MySalesView user={user} initialTab="quotes" onOpen={openDetail}/>}
          {screen === 'my-orders'  && <MySalesView user={user} initialTab="orders" onOpen={openDetail}/>}
          {screen === 'ops'        && <LogisticsView onOpen={(c)=>openDetail(c,'order')}/>}
          {screen === 'clients'    && <Clients readonly={roleKey!=='admin'}/>}
          {screen === 'articles'   && <Articles/>}
          {screen === 'team'       && <Team/>}
          {screen === 'config'     && <Config/>}
        </main>
      </div>
    </div>
  );
}

// ---------- ProfileModal ----------
function ProfileModal({ user, onClose, onUpdated }) {
  const [name,      setName]      = useState(user?.name || '');
  const [currentPass, setCurrentPass] = useState('');
  const [pass,      setPass]      = useState('');
  const [pass2,     setPass2]     = useState('');
  const [preview,   setPreview]   = useState(user?.avatar || null);
  const [avatarFile,setAvatarFile]= useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [info,      setInfo]      = useState('');
  const fileRef = React.useRef();

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setLoading(true);
    try {
      let updated = { ...user };

      // Actualizar nombre si cambió
      if (name.trim() && name.trim() !== user?.name) {
        const res = await CrmApi.updateProfile(user.id, { name: name.trim() });
        updated = { ...updated, ...res };
      }

      // Subir avatar si eligió uno
      if (avatarFile) {
        const res = await CrmApi.uploadAvatar(user.id, avatarFile);
        updated = { ...updated, ...res };
      }

      // Cambiar contraseña si completó los campos
      if (pass) {
        const pwErr = validatePassword(pass);
        if (pwErr) { setError(pwErr); setLoading(false); return; }
        if (pass !== pass2) { setError('Las contraseñas no coinciden'); setLoading(false); return; }
        await CrmApi.changeUserPassword(user.id, pass, currentPass);
      }

      onUpdated(updated);
      setInfo('Perfil actualizado correctamente');
      setPass(''); setPass2(''); setCurrentPass(''); setAvatarFile(null);
    } catch (err) {
      setError(err.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    CrmAuth.clearToken();
    localStorage.removeItem('crm_user');
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-start p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm ml-2"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="font-semibold text-ink-900">Mi perfil</div>
          <button onClick={onClose} className="btn-ghost p-1"><Icon name="x" size={16}/></button>
        </div>

        <form onSubmit={handleSave}>
          <div className="p-6 space-y-5">
            {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
            {info  && <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">{info}</div>}

            {/* Foto de perfil */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative cursor-pointer group" onClick={() => fileRef.current?.click()}>
                {preview
                  ? <img src={preview} alt="avatar" className="w-20 h-20 rounded-full object-cover border-2 border-line"/>
                  : <Avatar name={user?.name} size={80}/>
                }
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Icon name="camera" size={20} className="text-white"/>
                </div>
              </div>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="text-xs text-brand hover:underline">
                {preview ? 'Cambiar foto' : 'Subir foto'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange}/>
            </div>

            {/* Nombre */}
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1 block">Nombre completo</label>
              <input className="inp w-full" value={name} onChange={e=>setName(e.target.value)} placeholder="Tu nombre"/>
            </div>

            {/* Email (solo lectura) */}
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1 block">Email</label>
              <input className="inp w-full bg-surface text-ink-500 cursor-not-allowed" value={user?.email || ''} readOnly/>
            </div>

            {/* Cambiar contraseña */}
            <div className="border-t border-line pt-4">
              <div className="text-xs font-semibold text-ink-700 mb-3">Cambiar contraseña <span className="text-ink-400 font-normal">(opcional)</span></div>
              <div className="space-y-3">
                <PasswordInput value={currentPass} onChange={e=>setCurrentPass(e.target.value)} placeholder="Contraseña actual" autoComplete="current-password"/>
                <PasswordInput value={pass} onChange={e=>setPass(e.target.value)} placeholder="Nueva contraseña" autoComplete="new-password"/>
                {pass && <PasswordStrength password={pass}/>}
                <PasswordInput value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="Confirmar nueva contraseña" autoComplete="new-password"/>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-line">
            <button type="button" onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-bad hover:text-red-700 font-medium">
              <Icon name="log-out" size={14}/>Cerrar sesión
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
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

  // Registro
  const [reg, setReg] = useState({ name:'', lastName:'', email:'', phone:'', dni:'', cuit:'', pass:'', pass2:'' });
  const setRegF = (k, v) => setReg(r => ({ ...r, [k]: v }));

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
    setError(''); setLoading(true);
    try {
      await CrmApi.forgotPassword(email);
      setInfo('Si el email existe, recibirás un link para restablecer tu contraseña.');
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
    if (!reg.name.trim() || !reg.lastName.trim() || !reg.email.trim() || !reg.phone.trim() || !reg.dni.trim()) {
      setError('Completá todos los campos obligatorios'); return;
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
          <div className="flex items-center mb-6">
            <Logo size={52} tone="dark"/>
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
              <label className="block text-xs font-medium text-ink-700 mb-1">Teléfono *</label>
              <input className="inp w-full mb-3" value={reg.phone} onChange={e=>setRegF('phone',e.target.value)} placeholder="11 1234-5678"/>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">DNI *</label>
                  <input className="inp w-full" value={reg.dni} onChange={e=>setRegF('dni',e.target.value)} placeholder="12345678"/>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-700 mb-1">CUIT <span className="text-ink-400 font-normal">(opcional)</span></label>
                  <input className="inp w-full" value={reg.cuit} onChange={e=>setRegF('cuit',e.target.value)} placeholder="20-12345678-9"/>
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

// ---------- Sidebar ----------
function Sidebar({ role, screen, setScreen, user, onProfileOpen }) {
  const navAdmin = [
    { id:'dashboard', label:'Dashboard',             icon:'layout-dashboard' },
    { id:'quotes',    label:'Cotizaciones',          icon:'clipboard-list', sub:'Fase 1' },
    { id:'orders',    label:'Órdenes de Compra',     icon:'package',        sub:'Fase 2' },
    { id:'clients',   label:'Clientes',              icon:'building-2' },
    { id:'articles',  label:'Artículos',             icon:'box',        sub:'Catálogo' },
    { id:'team',      label:'Equipo',                icon:'users' },
    { id:'config',    label:'Configuración',         icon:'settings' },
  ];
  const navSeller = [
    { id:'my-quotes', label:'Mis Cotizaciones',      icon:'clipboard-list' },
    { id:'my-orders', label:'Mis Órdenes de Compra', icon:'package' },
    { id:'quotes',    label:'Pipeline Cotizaciones', icon:'layout',     sub:'Kanban Fase 1' },
    { id:'orders',    label:'Pipeline OCs',          icon:'columns',    sub:'Kanban Fase 2' },
    { id:'clients',   label:'Clientes',              icon:'building-2', sub:'solo lectura' },
    { id:'articles',  label:'Artículos',             icon:'box',        sub:'Catálogo' },
  ];
  const navLog = [
    { id:'ops', label:'Operaciones', icon:'truck', sub:'Fase 2' },
  ];
  const nav = role === 'admin' ? navAdmin : role === 'seller' ? navSeller : navLog;
  const roleLabel = { ADMIN:'Administrador', VENDEDOR:'Vendedor', LOGISTICA:'Logística' };

  return (
    <aside className="w-[244px] shrink-0 bg-navy-900 text-white flex flex-col min-h-screen">
      <div className="px-5 pt-5 pb-4 flex items-center justify-center border-b border-white/5">
        <Logo size={56}/>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5">
        <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-white/35 font-semibold">
          {role==='admin' ? 'Gestión' : role==='seller' ? 'Mi pipeline' : 'Operaciones'}
        </div>
        {nav.map(n => (
          <button key={n.id} onClick={()=>setScreen(n.id)}
            className={cx(
              'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-left transition-colors',
              screen === n.id
                ? 'bg-brand text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                : 'text-white/75 hover:bg-white/5 hover:text-white'
            )}
          >
            <Icon name={n.icon} size={17}/>
            <span className="flex-1 leading-tight">
              {n.label}
              {n.sub && <span className="block text-[10px] uppercase tracking-wider opacity-60 font-medium">{n.sub}</span>}
            </span>
          </button>
        ))}
      </nav>

      {/* Perfil al pie del sidebar */}
      <div className="px-3 pb-3 border-t border-white/5 pt-3">
        <button onClick={onProfileOpen}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/8 transition-colors text-left group">
          <Avatar name={user?.name} size={34} src={user?.avatar}/>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-white truncate">{user?.name || '—'}</div>
            <div className="text-[11px] text-white/45">{roleLabel[user?.role] || '—'}</div>
          </div>
          <Icon name="settings" size={14} className="text-white/30 group-hover:text-white/60 shrink-0"/>
        </button>
      </div>
    </aside>
  );
}

// ---------- Topbar ----------
function Topbar({ user, roleKey, setRoleKey }) {
  const { notifications, openModal, pushToast } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const loggedUser = CrmAuth.getUser();
  const isAdmin = loggedUser?.role === 'ADMIN';
  const unreadCount = notifications.filter(n => !n.read).length;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await CrmApi.syncMail();
      if (result.synced > 0) {
        pushToast(`${result.synced} cotización(es) ingresada(s) desde mail`, 'ok');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        pushToast('No hay mails nuevos', 'info');
      }
    } catch (err) {
      pushToast('Error al sincronizar: ' + err.message, 'bad');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    CrmAuth.clearToken();
    localStorage.removeItem('crm_user');
    window.location.reload();
  };

  const title = {
    admin: 'Vista Administrador', seller: 'Vista Vendedor', logistics: 'Vista Logística'
  }[roleKey];
  return (
    <header className="h-[62px] bg-white border-b border-line flex items-center gap-4 px-6 shrink-0 relative">
      <div className="flex items-center gap-2 text-sm flex-1">
        <Icon name="home" size={13} className="text-ink-400"/>
        <span className="text-ink-500">MySelec CRM</span>
        <Icon name="chevron-right" size={12} className="text-ink-300"/>
        <span className="font-semibold text-ink-900">{title}</span>
      </div>

      {isAdmin && (
        <div className="flex items-center gap-1.5 bg-surface rounded-lg p-1 border border-line">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 px-2">Vista</span>
          {[
            {k:'admin',     l:'Admin'},
            {k:'seller',    l:'Vendedor'},
            {k:'logistics', l:'Logística'},
          ].map(o => (
            <button key={o.k} onClick={()=>setRoleKey(o.k)}
              className={cx(
                'text-xs font-medium px-2.5 py-1 rounded-md transition-colors',
                roleKey === o.k ? 'bg-white text-navy-900 shadow-sm border border-line' : 'text-ink-500 hover:text-ink-900'
              )}
            >{o.l}</button>
          ))}
        </div>
      )}

      <button onClick={()=>openModal('search')}
        className="relative hidden md:inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-surface hover:bg-white hover:border-line border border-transparent text-ink-500 text-xs">
        <Icon name="search" size={14}/>
        <span>Buscar…</span>
        <kbd className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded border border-line bg-white text-ink-500">⌘K</kbd>
      </button>

      {roleKey === 'admin' && (
        <button onClick={handleSync} disabled={syncing}
          className="inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-brand/10 hover:bg-brand/20 text-brand text-xs font-medium border border-brand/20 transition-colors">
          <Icon name="mail" size={14}/>
          {syncing ? 'Sincronizando...' : 'Sincronizar Mail'}
        </button>
      )}

      <div className="relative">
        <button onClick={()=>setNotifOpen(o=>!o)}
          className="relative w-9 h-9 rounded-lg hover:bg-surface flex items-center justify-center text-ink-700">
          <Icon name="bell" size={17}/>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">{unreadCount}</span>
          )}
        </button>
        {notifOpen && <NotificationsPopover onClose={()=>setNotifOpen(false)}/>}
      </div>

      <button onClick={handleLogout} title="Cerrar sesión"
        className="w-9 h-9 rounded-lg hover:bg-surface flex items-center justify-center text-ink-400 hover:text-bad border border-transparent hover:border-line transition-colors">
        <Icon name="log-out" size={15}/>
      </button>
    </header>
  );
}

// ---------- Dashboard ----------
function Dashboard() {
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
          PieChart, Pie, Cell, AreaChart, Area } = window.Recharts;
  const { quotes, users, clients, activity, openModal } = useApp();
  const [exportOpen, setExportOpen] = useState(false);
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

  const kpis = [
    { label: 'Cotizaciones activas',  value: kv(kpisData?.cotizacionesActivas) },
    { label: 'Presupuestos enviados', value: kv(kpisData?.presupuestosEnviados) },
    { label: 'OC en curso',           value: kv(kpisData?.ocEnCurso) },
    { label: 'Entregas este mes',     value: kv(kpisData?.entregasEsteMes) },
    { label: 'Monto cotizado',        value: kMoney(kpisData?.montoTotal), sub: 'presupuestos' },
    { label: 'Monto confirmado',      value: kMoney(kpisData?.montoConfirmado), sub: 'notas de pedido', highlight: true },
    { label: 'Tasa de conversión',    value: kpisLoading ? '...' : (kpisData?.tasaConversion != null ? `${Number(kpisData.tasaConversion).toFixed(0)}%` : '—') },
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
        actions={
          <>
            <div className="relative">
              <button onClick={()=>setExportOpen(o=>!o)} className="btn-ghost"><Icon name="download" size={14}/>Exportar<Icon name="chevron-down" size={11}/></button>
              {exportOpen && <ExportMenu onClose={()=>setExportOpen(false)}/>}
            </div>
          </>
        }
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
            <div key={i} className={`bg-white rounded-xl border p-4 shadow-card ${k.highlight ? 'border-blue-200 bg-blue-50' : 'border-line'}`}>
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold leading-tight">{k.label}</div>
              <div className={`text-2xl font-bold mt-2 ${k.highlight ? 'text-blue-700' : 'text-ink-900'}`}>{k.value}</div>
              {k.sub && <div className="text-[10px] text-ink-400 mt-0.5">{k.sub}</div>}
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
            <div className="mb-3">
              <div className="text-sm font-semibold text-ink-900">Motivos de rechazo</div>
              <div className="text-xs text-ink-500">
                Por qué se perdieron cotizaciones en el período
                {filters.sellerId ? ` · ${sellerUsers.find(u=>u.id===filters.sellerId)?.name?.split(' ')[0] || ''}` : ''}
              </div>
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
                <div className="text-xs text-ink-500">Pasaron el tiempo límite de armado (1 día hábil)</div>
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
