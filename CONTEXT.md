# CRM Myselec — Contexto del proyecto

## Qué es esto
CRM comercial interno para **Myselec SRL** — empresa distribuidora de materiales eléctricos.
Gestiona cotizaciones (Fase 1) y órdenes de compra (Fase 2), con ingreso automático de pedidos por mail.

---

## Stack técnico
- **Backend**: Node.js + Express + Prisma ORM
- **DB**: PostgreSQL en Neon (cloud) — la conexión está en `.env`
- **Frontend**: React (sin bundler, cargado via CDN), Tailwind CSS, Recharts
- **Mail**: IMAP con node-imap + mailparser, SMTP con nodemailer
- **PDF**: pdf-parse para extraer artículos de PDFs de Flexxus
- **Auth**: JWT con localStorage

## Correr el proyecto
```bash
npm install
npx prisma generate
npm run dev
# Abre en http://localhost:3000
```

---

## Estructura de archivos clave

```
src/
  server.js              — Express + rutas registradas
  routes/
    auth.js              — Login, registro público, forgot/reset password
    quotes.js            — Cotizaciones (CRUD + stage changes + items)
    orders.js            — Órdenes de compra
    clients.js           — Clientes
    users.js             — Usuarios (admin): CRUD, toggle, approve, reject
    data.js              — Dashboard, charts, stages, alertas
    articles.js          — Maestro de artículos (CRUD + importador XLS + sync)
    mail.js              — Sync IMAP manual
    notifications.js     — Reglas de notificación
    settings.js          — AppSettings
  services/
    mailReader.js        — Procesamiento automático de mails IMAP
    mailer.js            — Envío SMTP con nodemailer (sendMail, sendPasswordReset, sendNotification)
    notifier.js          — Check de idle + envío de notificaciones
  middleware/
    auth.js              — JWT authMiddleware

public/
  Logo.png               — Logo real de Myselec (M 3D azul/gris)
  crm-app.jsx            — App principal: routing, contexto global, Dashboard, Sidebar, Login
  crm-views.jsx          — Vistas: Clients, Articles, Team, Config, MySalesView, LogisticsView
  crm-details.jsx        — Drawers de detalle: cotizaciones, OCs, ArticleSearchInput
  crm-interact.jsx       — Modales: nueva cotización, nueva OC, asignar, etc.
  crm-api.jsx            — API layer: CrmAuth, CrmApi, apiFetch, loadAllData
  crm-data.jsx           — Componentes base: Icon, Logo, Avatar, Badge, etc.

prisma/
  schema.prisma          — Modelos: User, Client, Quote, Order, Article, Activity, etc.

scripts/
  import-articles.js     — Importar XLS de Flexxus a la DB (node scripts/import-articles.js)
  seedAdmin.js           — Crear usuario maestro admin si no existe (node scripts/seedAdmin.js)
```

---

## Modelos principales (Prisma)

### User
- `name`, `email`, `password` (bcrypt), `role`, `zone`
- `phone`, `dni`, `cuit` — datos personales del registro
- `active` (Boolean) — usuario habilitado o deshabilitado
- `pendingApproval` (Boolean) — recién registrado, esperando aprobación del admin
- Los usuarios con `pendingApproval: true` no pueden iniciar sesión hasta ser aprobados

### Quote (Cotización — Fase 1)
- `stage`: recibida → asignada → armado → enviado → aceptada / rechazada
- `mailType`: SOLICITUD | PRESUPUESTO | OC | NOTA_PEDIDO
- `rejectReason`, `rejectNotes`: motivo de rechazo
- `sellerId`: vendedor asignado
- `items`: QuoteItem[] con sku, description, quantity, unitPrice, total

### Order (Orden de Compra — Fase 2)
- Se crea desde una Quote aceptada
- `stage`: oc → armado → despachado → entregada
- Items heredados de la Quote

### Article (Maestro de artículos)
- Importado desde Flexxus XLS (~3834 artículos)
- Campos: code (único), description, category, type, class, coefVar, active
- Importador en `/api/articles/preview` + `/api/articles/sync`

### StageDefinition
- Etapas configurables para COTIZACION y ORDEN_COMPRA
- Cada una tiene: stageKey, label, tone, order, mandatory, maxHours

---

## Sistema de usuarios y acceso

### Flujo de registro
1. Usuario entra a la pantalla de login → clickea "Registrate"
2. Completa: Nombre, Apellido, Email, Teléfono, DNI, CUIT (opcional), Contraseña
3. Contraseña requiere: mínimo 8 caracteres, una mayúscula, un número
4. Se crea con `active: false`, `pendingApproval: true`
5. Se envía mail a todos los admins activos avisando del registro
6. El admin entra a Equipo → sección "Solicitudes pendientes" → elige rol → aprueba
7. Se envía mail al usuario confirmando que puede ingresar

### Protecciones
- No se puede quedar sin admins activos (protección en toggle y cambio de rol)
- Usuario pendiente que intenta login recibe mensaje claro de que está pendiente

### Usuario maestro
- **Facundo Brusco** — bruscofacundo1@gmail.com — rol ADMIN
- Creado con `node scripts/seedAdmin.js`
- Es el único admin inicial; los demás se registran y esperan aprobación

### Roles
- `ADMIN` → todo: dashboard, config, equipo, artículos, clientes, aprobación de usuarios
- `VENDEDOR` → mis cotizaciones, mis OCs, pipeline, clientes (solo lectura), artículos
- `LOGISTICA` → operaciones (OCs en curso)

Los roles en el frontend llegan traducidos: `'Administrador'`, `'Vendedor'`, `'Logística'`

---

## Funcionalidades implementadas

### Login
- Pantalla de inicio de sesión con ojito para mostrar/ocultar contraseña
- Recuperación de contraseña por mail (forgot/reset)
- Link "Registrate" para auto-registro
- Pantalla de confirmación post-registro

### Dashboard (admin)
- Filtros: vendedor + rango de fechas
- KPIs: cotizaciones activas, presupuestos enviados, OC en curso, entregas, monto cotizado, monto confirmado, tasa de conversión
- Carga en 2 pasadas: KPIs + alertas primero, gráficos después
- Alertas: presupuestos en etapa "enviado" sin movimiento por 3+ días
- Gráficos: vendedores (bar), etapas (pie), mensual (area), embudo de conversión, motivos de rechazo

### Procesamiento de mail (IMAP)
- Lee cuentas configuradas en EmailIntegration
- Procesa: SOLICITUD (mail de cliente), PRESUPUESTO (PDF Flexxus PR-), NOTA_PEDIDO (PDF Flexxus NP-)
- Auto-asigna vendedor por email de la cuenta IMAP
- Respuestas del cliente → crea Activity tipo NOTE en la cotización
- Ignora auto-replies (header Auto-Submitted)
- Aplica label `crm-procesado` en Gmail después de procesar
- Guarda lastSyncAt por cuenta en EmailIntegration

### Artículos
- Sección en el nav (admin + vendedor)
- Tabla tipo Excel full-width: búsqueda, filtros por rubro/tipo/clase, ordenamiento por columna, paginación
- Importador XLS: preview diff (nuevos/actualizados/sin cambios/a eliminar) → confirmación → sync
- CRUD manual: crear, editar, eliminar con confirmación
- Autocomplete en SKU de ítems de cotización/OC
- Verificación: ✓ verde si el SKU existe en catálogo, ? ámbar si no

### Equipo (admin)
- Tabla de vendedores con stats (clientes, cotizaciones, ganadas, tasa, OCs)
- Tabla de admins y logística
- Sección de "Solicitudes pendientes" con badge amarillo cuando hay registros esperando
- Modal de aprobación: ver datos del usuario + elegir rol → aprueba o rechaza
- Al aprobar: mail al usuario; al rechazar: mail al usuario + se elimina el registro

---

## Endpoints API relevantes

### Auth
- `POST /api/auth/login` — login con JWT
- `POST /api/auth/register` — registro público (sin token)
- `POST /api/auth/forgot-password` — genera token y envía mail
- `POST /api/auth/reset-password` — cambia contraseña con token
- `GET  /api/auth/me` — datos del usuario logueado

### Users (admin only salvo /me)
- `GET  /api/users` — lista usuarios activos (excluye pendientes)
- `GET  /api/users/pending` — lista usuarios pendientes de aprobación
- `POST /api/users` — crear usuario manualmente
- `PUT  /api/users/:id` — editar usuario
- `PATCH /api/users/:id/toggle` — activar/desactivar
- `POST /api/users/:id/approve` — aprobar registro + asignar rol + mail
- `POST /api/users/:id/reject` — rechazar + eliminar + mail

---

## Pendientes / Próximas features

1. **Google OAuth login** — en futuro, cuando se habilite la facturación de Google Cloud. El flujo de aprobación manual ya está listo para recibirlo como método adicional de autenticación.
2. **Preview PDF adjuntos** — ver PDFs inline sin descargar
3. **Nota de Pedido ↔ Presupuesto** — confirmar con Diego si Flexxus puede incluir número de presupuesto en el campo COMENTARIO para linkear automáticamente
4. **Limpiar datos hardcodeados** — quitar datos demo del código

---

## Notas importantes
- La DB es Neon (free tier) — puede pausarse. El servidor reconecta solo al primer request.
- El `.env` tiene DATABASE_URL, JWT_SECRET y las credenciales IMAP/SMTP (MAIL_USER, MAIL_PASSWORD, MAIL_HOST)
- `loadAllData()` en crm-api.jsx carga quotes, orders, clients, users, stages, activity al iniciar
- Los artículos NO se cargan en el contexto global — se fetchean on-demand desde la sección Artículos
- `buildBaseFilter()` en data.js convierte sellerId/from/to a cláusulas Prisma para el dashboard
- El importador XLS usa un token en memoria (expira 30 min) entre preview y sync
- El Logo se sirve desde `public/Logo.png` — componente Logo en crm-data.jsx
