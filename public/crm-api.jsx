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
// Helper: convierte objeto de params a query string (?key=val&...)
const toQS = (params = {}) => {
  const entries = Object.entries(params || {}).filter(([, v]) => v != null && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

const CrmApi = {
  // Auth
  login: (email, password) => apiFetch('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password })
  }),
  forgotPassword: (email) => apiFetch('/auth/forgot-password', {
    method: 'POST', body: JSON.stringify({ email })
  }),
  resetPassword: (token, password) => apiFetch('/auth/reset-password', {
    method: 'POST', body: JSON.stringify({ token, password })
  }),
  register: (data) => apiFetch('/auth/register', {
    method: 'POST', body: JSON.stringify({
      name: data.name, lastName: data.lastName, email: data.email,
      password: data.pass, phone: data.phone, dni: data.dni, cuit: data.cuit || undefined,
    })
  }),

  // Users (admin)
  getUsersFull: () => apiFetch('/users'),
  getPendingUsers: () => apiFetch('/users/pending'),
  createUser: (data) => apiFetch('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggleUser: (id) => apiFetch(`/users/${id}/toggle`, { method: 'PATCH' }),
  approveUser: (id, role) => apiFetch(`/users/${id}/approve`, { method: 'POST', body: JSON.stringify({ role }) }),
  rejectUser: (id) => apiFetch(`/users/${id}/reject`, { method: 'POST' }),
  changeUserPassword: (id, password) => apiFetch(`/users/${id}/password`, {
    method: 'PATCH', body: JSON.stringify({ password })
  }),
  updateProfile: (id, data) => apiFetch(`/users/${id}/profile`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  uploadAvatar: async (id, file) => {
    const form = new FormData();
    form.append('avatar', file);
    const token = localStorage.getItem('crm_token');
    const res = await fetch(`/api/users/${id}/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Error al subir foto'); }
    return res.json();
  },

  // Quotes
  getQuotes: () => apiFetch('/quotes'),
  createQuote: (data) => apiFetch('/quotes', { method: 'POST', body: JSON.stringify(data) }),
  changeQuoteStage: (id, stage, extra = {}) => apiFetch(`/quotes/${id}/stage`, {
    method: 'PATCH', body: JSON.stringify({ stage, ...extra })
  }),
  assignQuote: (id, sellerId) => apiFetch(`/quotes/${id}/assign`, {
    method: 'PATCH', body: JSON.stringify({ sellerId })
  }),
  assignQuoteClient: (id, data) => apiFetch(`/quotes/${id}/client`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  getQuoteDetail: (id) => apiFetch(`/quotes/${id}/detail`),
  resyncQuoteEmail: (id) => apiFetch(`/quotes/${id}/resync-email`, { method: 'POST' }),
  reparseItems: (id) => apiFetch(`/quotes/${id}/reparse-items`, { method: 'POST' }),
  deleteQuote: (id) => apiFetch(`/quotes/${id}`, { method: 'DELETE' }),
  addQuoteNote: (id, text) => apiFetch(`/quotes/${id}/notes`, {
    method: 'POST', body: JSON.stringify({ text })
  }),
  updateQuoteItem: (quoteId, itemId, data) => apiFetch(`/quotes/${quoteId}/items/${itemId}`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  createQuoteItem: (quoteId, data) => apiFetch(`/quotes/${quoteId}/items`, {
    method: 'POST', body: JSON.stringify(data)
  }),
  deleteQuoteItem: (quoteId, itemId) => apiFetch(`/quotes/${quoteId}/items/${itemId}`, {
    method: 'DELETE'
  }),
  linkQuote: (id, linkedQuoteId) => apiFetch(`/quotes/${id}/link`, {
    method: 'PATCH', body: JSON.stringify({ linkedQuoteId })
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
  updateClient: (id, data) => apiFetch(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getClientEmails: (id) => apiFetch(`/clients/${id}/emails`),
  addClientEmail: (id, email) => apiFetch(`/clients/${id}/emails`, {
    method: 'POST', body: JSON.stringify({ email })
  }),
  removeClientEmail: (id, emailId) => apiFetch(`/clients/${id}/emails/${emailId}`, { method: 'DELETE' }),

  // Data
  getUsers: () => apiFetch('/data/users'),
  getStages: () => apiFetch('/data/stages'),
  getStagesFull: () => apiFetch('/data/stages/full'),
  updateStage: (id, data) => apiFetch(`/data/stages/${id}`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  createStage: (data) => apiFetch('/data/stages', {
    method: 'POST', body: JSON.stringify(data)
  }),
  deleteStage: (id) => apiFetch(`/data/stages/${id}`, { method: 'DELETE' }),
  reorderStages: (ids) => apiFetch('/data/stages-reorder', {
    method: 'PATCH', body: JSON.stringify({ ids })
  }),
  getActivity: (limit = 20) => apiFetch(`/data/activity?limit=${limit}`),
  getDashboard:    (p) => apiFetch(`/data/dashboard${toQS(p)}`),
  getRejectionReasons: () => apiFetch('/data/rejection-reasons'),
  getChartSellers:    (p) => apiFetch(`/data/charts/sellers${toQS(p)}`),
  getChartStages:     (p) => apiFetch(`/data/charts/stages${toQS(p)}`),
  getChartMonthly:    (p) => apiFetch(`/data/charts/monthly${toQS(p)}`),
  getChartFunnel:     (p) => apiFetch(`/data/charts/funnel${toQS(p)}`),
  getChartRejections: (p) => apiFetch(`/data/charts/rejections${toQS(p)}`),
  getAlerts:          (p) => apiFetch(`/data/alerts${toQS(p)}`),

  // Mail
  syncMail: () => apiFetch('/mail/sync', { method: 'POST' }),
  getInbox: (limit = 20) => apiFetch(`/mail/inbox?limit=${limit}`),

  // Notifications
  getNotificationRules: () => apiFetch('/notifications/rules'),
  createNotificationRule: (data) => apiFetch('/notifications/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateNotificationRule: (id, data) => apiFetch(`/notifications/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNotificationRule: (id) => apiFetch(`/notifications/rules/${id}`, { method: 'DELETE' }),

  // Articles
  getArticles:       (p) => apiFetch(`/articles${toQS(p)}`),
  searchArticles:    (q) => apiFetch(`/articles/search${toQS({ q })}`),
  getArticleByCode:  (code) => apiFetch(`/articles/${encodeURIComponent(code)}`),
  getArticleCategories: () => apiFetch('/articles/categories'),
  getArticleMeta:    () => apiFetch('/articles/meta'),
  createArticle:     (data) => apiFetch('/articles', { method: 'POST', body: JSON.stringify(data) }),
  updateArticle:     (code, data) => apiFetch(`/articles/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteArticle:     (code) => apiFetch(`/articles/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  previewArticleXLS: (file) => {
    const token = CrmAuth.getToken();
    const fd = new FormData(); fd.append('file', file);
    return fetch(`${API_BASE}/articles/preview`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `Error ${r.status}`))));
  },
  syncArticles: (token, deleteCodes) => apiFetch('/articles/sync', {
    method: 'POST', body: JSON.stringify({ token, deleteCodes }),
  }),

  // Upload attachments
  uploadAttachments: (quoteId, files) => {
    const token = CrmAuth.getToken();
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return fetch(`${API_BASE}/quotes/${quoteId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `Error ${r.status}`))));
  },
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
