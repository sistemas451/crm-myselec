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
    // Si es el endpoint de auth (login, forgot-password, etc.), NO recargar —
    // dejar que el formulario muestre el error inline.
    if (path.startsWith('/auth/')) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Credenciales inválidas');
    }
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
  login: (email, password, rememberMe = false) => apiFetch('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password, rememberMe })
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
  resendWelcome: (id) => apiFetch(`/users/${id}/resend-welcome`, { method: 'POST' }),
  approveUser: (id, role) => apiFetch(`/users/${id}/approve`, { method: 'POST', body: JSON.stringify({ role }) }),
  rejectUser: (id) => apiFetch(`/users/${id}/reject`, { method: 'POST' }),
  changeUserPassword: (id, password, currentPassword) => apiFetch(`/users/${id}/password`, {
    method: 'PATCH', body: JSON.stringify({ password, currentPassword })
  }),
  updateProfile: (id, data) => apiFetch(`/users/${id}/profile`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  deleteAvatar: (id) => apiFetch(`/users/${id}/avatar`, { method: 'DELETE' }),
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
  getQuotes: (p) => apiFetch(`/quotes${toQS(p)}`),
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
  getOrders: (p) => apiFetch(`/orders${toQS(p)}`),
  parseNP: (file) => {
    const token = CrmAuth.getToken();
    const fd = new FormData(); fd.append('file', file);
    return fetch(`${API_BASE}/orders/parse-np`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `Error ${r.status}`))));
  },
  createOrder: (data) => apiFetch('/orders', { method: 'POST', body: JSON.stringify(data) }),
  deleteOrder: (id) => apiFetch(`/orders/${id}`, { method: 'DELETE' }),
  changeOrderStage: (id, stage) => apiFetch(`/orders/${id}/stage`, {
    method: 'PATCH', body: JSON.stringify({ stage })
  }),
  getOrderDetail: (id) => apiFetch(`/orders/${id}/detail`),
  addOrderNote: (id, text) => apiFetch(`/orders/${id}/notes`, {
    method: 'POST', body: JSON.stringify({ text })
  }),
  updateOrder: (id, data) => apiFetch(`/orders/${id}`, {
    method: 'PATCH', body: JSON.stringify(data)
  }),
  uploadOrderAttachments: (orderId, files) => {
    const token = CrmAuth.getToken();
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    return fetch(`${API_BASE}/orders/${orderId}/attachments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `Error ${r.status}`))));
  },

  // Clients
  getClients: () => apiFetch('/clients'),
  createClient: (data) => apiFetch('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => apiFetch(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getClientEmails: (id) => apiFetch(`/clients/${id}/emails`),
  addClientEmail: (id, email) => apiFetch(`/clients/${id}/emails`, {
    method: 'POST', body: JSON.stringify({ email })
  }),
  removeClientEmail: (id, emailId) => apiFetch(`/clients/${id}/emails/${emailId}`, { method: 'DELETE' }),
  deleteClient: (id) => apiFetch(`/clients/${id}`, { method: 'DELETE' }),
  deleteAllClients: () => apiFetch('/clients/all', { method: 'DELETE' }),
  exportClients: () => {
    const token = CrmAuth.getToken();
    return fetch(`${API_BASE}/clients/export`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async r => {
      if (!r.ok) { const b = await r.json(); throw new Error(b.error || `Error ${r.status}`); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clientes-${new Date().toISOString().slice(0,10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  },
  previewClientsXLS: (file) => {
    const token = CrmAuth.getToken();
    const fd = new FormData(); fd.append('file', file);
    return fetch(`${API_BASE}/clients/preview`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    }).then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.error || `Error ${r.status}`))));
  },
  syncClients: (token, deleteCodes) => apiFetch('/clients/sync', {
    method: 'POST', body: JSON.stringify({ token, deleteCodes }),
  }),

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
  getComparativa:     (p) => apiFetch(`/data/comparativa${toQS(p)}`),

  // Mail
  syncMail: () => apiFetch('/mail/sync', { method: 'POST' }),
  getInbox: (limit = 20) => apiFetch(`/mail/inbox?limit=${limit}`),
  addMailAccount:    (user, password) => apiFetch('/mail/accounts', { method: 'POST', body: JSON.stringify({ user, password }) }),
  deleteMailAccount: (email) => apiFetch(`/mail/accounts/${encodeURIComponent(email)}`, { method: 'DELETE' }),

  // Notifications
  getNotificationRules: () => apiFetch('/notifications/rules'),
  createNotificationRule: (data) => apiFetch('/notifications/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateNotificationRule: (id, data) => apiFetch(`/notifications/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNotificationRule: (id) => apiFetch(`/notifications/rules/${id}`, { method: 'DELETE' }),
  getNotificationsInbox:  ()    => apiFetch('/notifications/inbox'),
  ackAssignedQuote: (quoteId)   => apiFetch('/notifications/ack-assigned', { method: 'POST', body: JSON.stringify({ quoteId }) }),

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
  deleteAllArticles: () => apiFetch('/articles/all', { method: 'DELETE' }),

  // Attachments
  deleteAttachment: (id) => apiFetch(`/attachments/${id}`, { method: 'DELETE' }),

  // Email sending accounts
  getSendAccounts:  ()  => apiFetch('/quotes/send-accounts'),

  // ── Feedback / Foro ────────────────────────────────────────────────────────
  getFeedbackMeta:    ()           => apiFetch('/feedback/meta'),
  getFeedbackPosts:   ()           => apiFetch('/feedback'),
  createFeedbackPost: (data)       => apiFetch('/feedback', { method: 'POST', body: JSON.stringify(data) }),
  respondFeedback:    (id, body, status) => apiFetch(`/feedback/${id}/respond`, { method: 'POST', body: JSON.stringify({ body, status }) }),
  setFeedbackStatus:  (id, status) => apiFetch(`/feedback/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  voteFeedback:         (id)           => apiFetch(`/feedback/${id}/vote`, { method: 'POST' }),

  // ── Developer settings ────────────────────────────────────────────────────
  getFeedbackNotifyUsers: ()      => apiFetch('/settings/feedback-notify-users'),
  saveFeedbackNotifyUsers: (ids)  => apiFetch('/settings/feedback-notify-users', { method: 'PUT', body: JSON.stringify({ ids }) }),
  setUserRole: (id, role)         => apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  getFeedbackPost:    (id)         => apiFetch(`/feedback/${id}`),

  uploadFeedbackImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    const token = localStorage.getItem('crm_token');
    return fetch('/api/feedback/upload-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.json());
  },

  // Email templates
  getEmailTemplates: () => apiFetch('/quotes/email-templates'),
  saveEmailTemplates: (data) => apiFetch('/quotes/email-templates', { method: 'PUT', body: JSON.stringify(data) }),
  sendQuoteEmail: (quoteId, data) => apiFetch(`/quotes/${quoteId}/send-email`, { method: 'POST', body: JSON.stringify(data) }),
  sendReminder: (quoteId, data) => apiFetch(`/quotes/${quoteId}/send-reminder`, { method: 'POST', body: JSON.stringify(data) }),

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
    // Cargar últimos 12 meses — reduce payload en DBs grandes
    const since = new Date(Date.now() - 365 * 86400 * 1000).toISOString().split('T')[0];
    const [quotes, orders, clients, users, stages, activity] = await Promise.all([
      CrmApi.getQuotes({ since }),
      CrmApi.getOrders({ since }),
      CrmApi.getClients(),
      CrmApi.getUsers(),
      CrmApi.getStages(),
      CrmApi.getActivity(),
    ]);

    // Map users to frontend format
    const roleMap = { DEVELOPER: 'Desarrollador', ADMIN: 'Administrador', VENDEDOR: 'Vendedor', LOGISTICA: 'Logística' };
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
      email: c.emailPrimary || c.email || '',
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
