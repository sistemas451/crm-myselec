/* API Layer — JWT token management + fetch helpers.
   Loaded before crm-data.jsx */

const API_BASE = '/api';

// ─── Token Management ───
const CrmAuth = {
  getToken: () => localStorage.getItem('crm_token'),
  setToken: (t) => localStorage.setItem('crm_token', t),
  clearToken: () => localStorage.removeItem('crm_token'),
  getUser: () => {
    try { return JSON.parse(localStorage.getItem('crm_user')); } catch { return null; }
  },
  setUser: (u) => localStorage.setItem('crm_user', JSON.stringify(u)),
  isLoggedIn: () => !!localStorage.getItem('crm_token'),
};

// ─── Fetch with auth ───
async function apiFetch(path, options = {}) {
  const token = CrmAuth.getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    CrmAuth.clearToken();
    window.location.reload();
    throw new Error('Sesión expirada');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }

  return res.json();
}

// ─── API Methods ───
const CrmApi = {
  // Auth
  login: (email, password) => apiFetch('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password })
  }),

  // Quotes
  getQuotes: () => apiFetch('/quotes'),
  createQuote: (data) => apiFetch('/quotes', { method: 'POST', body: JSON.stringify(data) }),
  changeQuoteStage: (id, stage, extra = {}) => apiFetch(`/quotes/${id}/stage`, {
    method: 'PATCH', body: JSON.stringify({ stage, ...extra })
  }),
  assignQuote: (id, sellerId) => apiFetch(`/quotes/${id}/assign`, {
    method: 'PATCH', body: JSON.stringify({ sellerId })
  }),
  getQuoteDetail: (id) => apiFetch(`/quotes/${id}/detail`),
  deleteQuote: (id) => apiFetch(`/quotes/${id}`, { method: 'DELETE' }),
  addQuoteNote: (id, text) => apiFetch(`/quotes/${id}/notes`, {
    method: 'POST', body: JSON.stringify({ text })
  }),

  // Orders
  getOrders: () => apiFetch('/orders'),
  createOrder: (data) => apiFetch('/orders', { method: 'POST', body: JSON.stringify(data) }),
  changeOrderStage: (id, stage) => apiFetch(`/orders/${id}/stage`, {
    method: 'PATCH', body: JSON.stringify({ stage })
  }),

  // Clients
  getClients: () => apiFetch('/clients'),
  createClient: (data) => apiFetch('/clients', { method: 'POST', body: JSON.stringify(data) }),

  // Data
  getUsers: () => apiFetch('/data/users'),
  getStages: () => apiFetch('/data/stages'),
  getActivity: (limit = 20) => apiFetch(`/data/activity?limit=${limit}`),
  getDashboard: () => apiFetch('/data/dashboard'),
  getRejectionReasons: () => apiFetch('/data/rejection-reasons'),

  // Mail
  syncMail: () => apiFetch('/mail/sync', { method: 'POST' }),
  getInbox: (limit = 20) => apiFetch(`/mail/inbox?limit=${limit}`),
};

// ─── Load all data from API (replaces hardcoded data) ───
async function loadAllData() {
  try {
    const [quotes, orders, clients, users, stages, activity] = await Promise.all([
      CrmApi.getQuotes(),
      CrmApi.getOrders(),
      CrmApi.getClients(),
      CrmApi.getUsers(),
      CrmApi.getStages(),
      CrmApi.getActivity(),
    ]);

    // Map users to frontend format
    const roleMap = { ADMIN: 'Administrador', VENDEDOR: 'Vendedor', LOGISTICA: 'Logística' };
    const mappedUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: roleMap[u.role] || u.role,
      zone: u.zone || '—',
    }));

    // Map clients to frontend format
    const mappedClients = clients.map(c => ({
      id: c.id,
      code: c.code,
      name: c.name,
      cuit: c.cuit || '',
      city: c.city || '',
      prov: c.province || '',
      zone: c.zone || '',
      activity: c.activity || '',
      seller: c.defaultSellerId || '',
      sellerName: c.defaultSeller?.name || '',
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
    }));

    return {
      users: mappedUsers,
      clients: mappedClients,
      quotes,
      orders,
      stagesF1: stages.f1,
      stagesF2: stages.f2,
      activity,
    };
  } catch (err) {
    console.warn('⚠️ Could not load API data, using defaults:', err.message);
    return null;
  }
}

// Expose to other scripts
Object.assign(window, { CrmAuth, CrmApi, apiFetch, loadAllData });
