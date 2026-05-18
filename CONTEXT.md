# CRM Myselec — Contexto del proyecto
> Actualizado: 2026-05-18

## Qué es esto
CRM comercial interno para **Myselec SRL** — empresa distribuidora de materiales eléctricos.
Gestiona cotizaciones (Fase 1) y órdenes de compra (Fase 2), con ingreso automático de pedidos por mail.

---

## Stack técnico
- **Backend**: Node.js + Express + Prisma ORM
- **DB**: PostgreSQL en Neon (cloud) — la conexión está en `.env`
- **Frontend**: React (sin bundler, cargado via CDN + Babel Standalone), Tailwind CSS, Recharts
- **Mail**: IMAP con node-imap + mailparser, SMTP con nodemailer
- **PDF**: pdf-parse para extraer artículos de PDFs de Flexxus
- **Auth**: JWT con localStorage (`crm_token`, `crm_user`)

## Correr el proyecto
```bash
npm install
npx prisma generate   # importante después de cambios al schema
npm run dev
# Abre en http://localhost:3000
```

---

## Estructura de archivos clave

```
src/
  server.js              — Express + rutas + upload de adjuntos (quotes y orders)
  routes/
    auth.js              — Login (rememberMe), registro público, forgot/reset password
    quotes.js            — Cotizaciones (CRUD + stage + items + notes + attachments + detail)
    orders.js            — Órdenes de compra (CRUD + stage + detail + notes + attachments + patch)
    clients.js           — Clientes + emails (ClientEmail)
    users.js             — Usuarios: CRUD, toggle, approve, reject, profile, avatar, password
    data.js              — Dashboard, charts, stages, alertas, activity
    articles.js          — Maestro de artículos (CRUD + importador XLS + sync)
    mail.js              — Sync IMAP manual
    notifications.js     — Reglas de notificación por mail
    settings.js          — AppSettings globales
  services/
    mailReader.js        — Procesamiento automático de mails IMAP
    mailer.js            — Envío SMTP con nodemailer
    notifier.js          — Check de idle + envío de notificaciones
    flexxusParser.js     — Extrae ítems de PDFs Flexxus
  middleware/
    auth.js              — JWT authMiddleware (verifica passwordChangedAt para invalidar sesiones)

public/
  Logo.png               — Logo real de Myselec (M 3D azul/gris)
  crm-app.jsx            — App shell: routing, Login, Sidebar, Topbar, ProfileModal, Dashboard
  crm-views.jsx          — Vistas: Clients, Articles, Team, Config, MySalesView, LogisticsView
  crm-details.jsx        — Drawers de detalle: QuoteDetail, OrderDetail, OCItemsTab
  crm-interact.jsx       — Modales: nueva cotización, nueva OC, asignar vendedor, etc.
  crm-kanban.jsx         — Tableros Kanban fase 1 y fase 2
  crm-api.jsx            — API layer: CrmAuth, CrmApi, apiFetch, loadAllData
  crm-data.jsx           — Componentes base: Icon, Logo, Avatar, Badge, helpers

prisma/
  schema.prisma          — Modelos completos (ver sección Modelos)

scripts/
  import-articles.js     — Importar XLS de Flexxus (node scripts/import-articles.js)
  seedAdmin.js           — Crear usuario maestro admin (node scripts/seedAdmin.js)

uploads/
  attachments/           — Adjuntos de cotizaciones/OCs
  avatars/               — Fotos de perfil de usuarios
```

---

## Modelos principales (Prisma)

### User
- `name`, `email`, `password` (bcrypt), `role` (ADMIN|VENDEDOR|LOGISTICA), `zone`
- `phone`, `dni`, `cuit`
- `avatar` — path `/uploads/avatars/...`
- `passwordChangedAt` — invalida tokens viejos
- `active`, `pendingApproval`

### Quote (Cotización — Fase 1)
- `stage`: recibida → asignada → armado → proveedor → oferta → enviado → aceptada / rechazada
- `source`: MANUAL | EMAIL | WHATSAPP
- `mailType`: SOLICITUD | PRESUPUESTO | OC (emails entran con este campo)
- `rejectReason`, `rejectNotes`, `followUpDate`
- `linkedQuoteId` — vínculo SOLICITUD ↔ PRESUPUESTO ↔ OC email
- `isDraft` — ingresadas desde mail sin procesar
- `items`: QuoteItem[] — ítems parseados del PDF Flexxus
- `notes`: Note[], `attachments`: Attachment[], `activities`: Activity[]

### Order (Orden de Compra — Fase 2)
- Se crea automáticamente cuando una Quote pasa a `aceptada`
- También puede ser Quote con `mailType: 'OC'` (_source: 'QUOTE' en el frontend)
- `stage`: oc → np → stock → proveedor → armado → facturada → transito → entregada
- `flexxusCode`, `carrier`, `trackingNumber`, `clientOCCode`
- `invoiceIssued`, `waybillReceived`
- `notes`: Note[], `attachments`: Attachment[], `activities`: Activity[]

### Article
- Importado desde Flexxus XLS (~3834 artículos)
- `code`, `description`, `category`, `type`, `class`, `coefVar`, `active`

### StageDefinition
- Etapas configurables desde Config → Etapas del proceso
- `phase`: COTIZACION | ORDEN_COMPRA
- `mandatory`, `maxHours`, `order`, `active`

---

## Sistema de usuarios y acceso

### Flujo de registro
1. Login → "Registrate" → formulario: Nombre, Apellido, Email, Teléfono, DNI, CUIT, Contraseña
2. Contraseña: mínimo 8 chars, 1 mayúscula, 1 número — validador visual en tiempo real
3. Se crea con `active: false, pendingApproval: true` → mail a todos los admins activos
4. Admin aprueba desde Equipo → elige rol → mail al usuario

### Login
- Checkbox "Recordarme por 7 días" → JWT de 7d vs 24h
- Mensaje claro si cuenta pendiente de aprobación

### Perfil de usuario
Click en nombre/foto del sidebar → ProfileModal con dos tabs:
- **Datos**: foto con cropper circular (drag + zoom), nombre, teléfono, email (readonly)
- **Seguridad**: fecha último cambio, contraseña actual requerida, validador visual, checkbox "cerrar sesión en todos los dispositivos"

### Invalidación de sesiones
- `authMiddleware` verifica que el token fue emitido después de `passwordChangedAt`
- Si falla la consulta a DB → deja pasar (resiliente)

### Roles
- `ADMIN` → todo: dashboard, config, equipo, artículos, clientes, aprobación
- `VENDEDOR` → mis cotizaciones, mis OCs, clientes (lectura), artículos
- `LOGISTICA` → operaciones (OCs en curso)
- El rol viene del JWT — **no hay selector de rol en la UI** (se eliminó)

### Usuario maestro
- **Facundo Brusco** — bruscofacundo1@gmail.com — ADMIN
- `node scripts/seedAdmin.js`

---

## Endpoints API

### Auth
- `POST /api/auth/login` — JWT, acepta `rememberMe`
- `POST /api/auth/register` — registro público
- `POST /api/auth/forgot-password` / `reset-password`

### Users
- `GET  /api/users` — lista activos
- `GET  /api/users/pending` — pendientes (admin)
- `POST /api/users` — crear (admin)
- `PUT  /api/users/:id` — editar (admin)
- `PATCH /api/users/:id/toggle` — activar/desactivar
- `POST /api/users/:id/approve` / `reject`
- `PATCH /api/users/:id/profile` — nombre y teléfono
- `POST /api/users/:id/avatar` — foto de perfil
- `PATCH /api/users/:id/password` — con verificación actual

### Quotes
- `GET  /api/quotes` — todas (admin) o propias (vendedor)
- `POST /api/quotes` — crear
- `GET  /api/quotes/:id/detail` — detalle completo: notes, attachments, activities, items, linkedQuote
- `PATCH /api/quotes/:id/stage` — con validación de etapas obligatorias
- `PATCH /api/quotes/:id/assign` — asignar vendedor
- `PATCH /api/quotes/:id/client` — asignar cliente
- `PATCH /api/quotes/:id/link` — vincular SOLICITUD ↔ PRESUPUESTO ↔ OC
- `POST /api/quotes/:id/notes` — agregar nota
- `POST /api/quotes/:id/attachments` — subir archivos (multer, max 10 archivos, 20MB)
- `DELETE /api/quotes/:id` — eliminar (admin)
- `POST /api/quotes/:id/reparse-items` — re-parsear PDF Flexxus
- `POST /api/quotes/:id/resync-email` — re-sincronizar desde IMAP
- `GET/POST/PATCH/DELETE /api/quotes/:id/items/:itemId` — ítems

### Orders
- `GET  /api/orders` — todas (admin) o propias + email-OCs mezclados
- `POST /api/orders` — crear manual desde cotización aceptada
- `GET  /api/orders/:id/detail` — detalle completo: notes, attachments, activities
- `PATCH /api/orders/:id/stage` — mover etapa (maneja Order y Quote-OC)
- `PATCH /api/orders/:id` — actualizar campos: carrier, trackingNumber, flexxusCode, etc.
- `POST /api/orders/:id/notes` — agregar nota
- `POST /api/orders/:id/attachments` — subir archivos (multer, mismo storage que quotes)

### Clients
- `GET  /api/clients` — lista
- `POST /api/clients` — crear
- `PUT  /api/clients/:id` — editar
- `GET  /api/clients/:id/emails` — lista emails (ClientEmail)
- `POST /api/clients/:id/emails` — agregar email
- `DELETE /api/clients/:id/emails/:emailId` — eliminar email

### Data / Dashboard
- `GET /api/data/dashboard` — KPIs con filtros (sellerId, from, to)
- `GET /api/data/charts/sellers|stages|monthly|funnel|rejections`
- `GET /api/data/alerts` — cotizaciones demoradas
- `GET /api/data/activity` — actividad reciente global
- `GET /api/data/stages` — etapas F1 y F2 (para frontend)
- `GET/POST/PATCH/DELETE /api/data/stages/:id` — CRUD de etapas

### Articles
- `GET /api/articles` — con paginación y filtros
- `GET /api/articles/search?q=` — búsqueda autocomplete
- `GET /api/articles/:code` — por código
- `POST /api/articles/preview` — preview XLS antes de importar
- `POST /api/articles/sync` — importar artículos del XLS

---

## Flujo de datos en el frontend

### Carga inicial (crm-api.jsx — loadAllData)
Al hacer login, `loadAllData()` llama en paralelo:
- `getQuotes()`, `getOrders()`, `getClients()`, `getUsers()`, `getStages()`, `getActivity()`

Reemplaza los arrays globales (`window.QUOTES`, `window.ORDERS`, etc.) y remonta `AppProvider` con `key={apiData ? 'api' : 'static'}`.

### Estado global (AppCtx en crm-interact.jsx)
- `quotes`, `orders`, `clients`, `users` — listas completas
- `moveQuoteStage(code, stage)` — cambia etapa localmente + llama API
- `moveOrderStage(code, stage)` — ídem para OC
- `setQuotes`, `setOrders` — para refrescar después de operaciones
- `pushToast(text, type)` — muestra toast global
- `openModal(type, props)` / `closeModal()` — sistema de modales

### Dual-source en Orders
Las OCs tienen dos orígenes:
- `_source: 'ORDER'` → registro en tabla `Order` → usa endpoints `/api/orders/:id/...`
- `_source: 'QUOTE'` → registro en tabla `Quote` con `mailType: 'OC'` → usa endpoints `/api/quotes/:id/...`

El componente `OrderDetail` detecta `o._source` y llama al endpoint correcto para notes, attachments y detail.

### Sin ES modules — orden de carga
Los scripts se cargan en este orden (index.html):
1. `crm-api.jsx` — CrmAuth, CrmApi, apiFetch, loadAllData
2. `crm-data.jsx` — helpers, Icon, Logo, Avatar, Badge, arrays vacíos
3. `crm-interact.jsx` — AppCtx, modales, ExportMenu eliminado
4. `crm-kanban.jsx` — STAGE_DOT, StageDot, KanbanQuotes, KanbanOrders
5. `crm-details.jsx` — QuoteDetail, OrderDetail, Drawer, Field, TabBar
6. `crm-views.jsx` — Clients, Articles, Team, Config, MySalesView, LogisticsView
7. `crm-app.jsx` — AppRoot, App, Topbar, Sidebar, Dashboard, ProfileModal

---

## Componentes frontend clave

### crm-app.jsx
- `AppRoot` — maneja loading/error de DB con pantalla de retry (para Neon pausado)
- `App` — routing por `screen` + sidebar colapsable (persiste en localStorage)
- `Sidebar` — colapsable a 60px (solo iconos) o 244px, con toggle; siempre fija (h-screen)
- `Topbar` — sin selector de rol; muestra logo / nombre del usuario / rol (del JWT)
- `Dashboard` — KPIs reales desde API, gráficos Recharts, alertas, filtros por vendedor/fecha
- `ProfileModal` — tabs Datos/Seguridad, foto con ImageCropper

### crm-views.jsx
- `Clients` — panel lista resizable (drag) + colapsable, panel detalle con:
  - 4 KPIs: Cotizaciones, OCs activas, OCs entregadas, **Monto ganado**
  - Historial comercial unificado (COT + OC), ordenado por fecha desc, filas clickeables
  - Multi-email expandible (ClientEmail), filtros por vendedor/zona/provincia
- `MySalesView` — vista vendedor: KPIs personales + bandeja sin asignar + tabs mis-cot/mis-oc
- `LogisticsView` — vista logística: KPIs OCs + tabla de órdenes en curso
- `Articles`, `Team`, `Config` — sin cambios significativos recientes

### crm-details.jsx
- `QuoteDetail` — drawer completo: tabs Resumen/Ítems/Mail/Notas/Adjuntos/Historial
  - Fetch real de `GET /api/quotes/:id/detail`
  - Notas, adjuntos, historial unificado (quote + linkedQuote)
  - Asignar cliente inline, vincular cotizaciones, mover etapa, rechazar con motivo
  - Preview PDF inline (modal fullscreen con iframe)
- `OrderDetail` — drawer completo: tabs Resumen/Historial/Notas/Adjuntos
  - Fetch real de `GET /api/orders/:id/detail` (o quote detail para email-OC)
  - Notas funcionales, adjuntos con preview PDF, confirmar entrega
  - Checklist de entrega dinámico (basado en stage + flags invoiceIssued/waybillReceived)
  - Dirección de entrega con datos reales del cliente (sin datos hardcodeados)

### crm-interact.jsx
- `NewQuoteModal` — crea cotización + **sube el archivo adjunto real** después de crear
- `NewOrderModal` — crea OC manual desde cotización aceptada
- `InviteUserModal` — invitar usuario con zona (default 'AMBA Norte' — pendiente)

---

## Todo lo que se hizo (historial de cambios)

### Sesión anterior (antes del resumen)
1. ✅ Registro público funcional con validación y mail de notificación a admins
2. ✅ ProfileModal: foto con cropper, contraseña con validador visual, invalidación de tokens
3. ✅ Forgot/reset password por mail
4. ✅ Avatar real en sidebar y topbar (src para Avatar component)
5. ✅ Sidebar siempre fija (h-screen + overflow-hidden, scroll solo en main)
6. ✅ Sidebar colapsable a mini-iconos (60px) con toggle "Ocultar panel"
7. ✅ Panel de clientes resizable (drag) + colapsable
8. ✅ Filtros de clientes: búsqueda por nombre/CUIT/email/código, por vendedor/zona/provincia
9. ✅ Multi-email en clientes (ClientEmail 1:N), expandible si hay más de uno
10. ✅ Datos demo hardcodeados eliminados del frontend (arrays vacíos, IDs dinámicos)
11. ✅ Tab "Integración Flexxus" eliminada de Configuración
12. ✅ Tab "Roles y permisos" eliminada de Configuración
13. ✅ Pantalla de error/retry para Neon pausado (con botón Reintentar + Cerrar sesión)
14. ✅ Preview PDF inline en QuoteDetail (modal fullscreen con iframe)
15. ✅ Todos los registros de DB (quotes y orders) eliminados para empezar limpio

### Esta sesión
16. ✅ **OrderDetail completamente reescrito**:
    - Reemplaza array `history` hardcodeado con datos reales de la API
    - Tabs: Resumen / Historial / Notas / Adjuntos (igual que QuoteDetail)
    - Notas funcionales: carga, agrega, muestra con usuario y fecha
    - Adjuntos funcionales: carga, sube, preview PDF inline
    - "Confirmar entrega" funcional: pide confirmación, mueve a 'entregada', cierra drawer
    - Dirección de entrega con datos reales del cliente (eliminado "Juan M. Rivas", "L-V 08-17hs")
    - Null-safety en stg/sel/cli (no crashea si faltan datos)
    - Maneja dual-source: ORDER (endpoint orders) y QUOTE/email-OC (endpoint quotes)
17. ✅ **Backend: nuevos endpoints para órdenes**:
    - `GET  /api/orders/:id/detail` — detalle completo con notas, adjuntos, actividades
    - `POST /api/orders/:id/notes` — agregar nota
    - `PATCH /api/orders/:id` — actualizar campos (carrier, tracking, flexxusCode, etc.)
    - `POST /api/orders/:id/attachments` — subir archivos (en server.js)
18. ✅ **NewQuoteModal: upload de archivo arreglado**:
    - Antes: capturaba el nombre del archivo pero nunca lo subía
    - Ahora: guarda el File object en estado y llama `uploadAttachments(quoteId, [file])` tras crear la cotización
19. ✅ **Historial del cliente mejorado** (Clients):
    - 4to KPI: "Monto ganado" (suma de cotizaciones aceptadas con monto + subtítulo en curso)
    - Historial unificado COT + OC, ordenado por fecha descendente
    - Filas clickeables que abren el drawer correspondiente (quoteDetail u orderDetail)
    - Vacío elegante si no hay registros
20. ✅ **Selector de rol eliminado del topbar**:
    - Ya no hay botones Admin/Vendedor/Logística en el header
    - El rol viene del JWT y es fijo por sesión
    - Topbar muestra: logo / nombre del usuario logueado / rol
21. ✅ **Botones "Exportar" falsos eliminados**:
    - Dashboard: eliminado botón + estado exportOpen
    - MySalesView: eliminado botón
    - LogisticsView: eliminado botón
    - Componente `ExportMenu` eliminado completamente de crm-interact.jsx

---

## Pendientes (priorizados)

### Alta prioridad — funcionalidad rota o faltante
- [ ] **Bandeja de entrada de mails (#8)**: los emails que llegan (SOLICITUD/PRESUPUESTO/OC) se mezclan en el kanban. Falta una vista tipo inbox donde el admin vea *solo* los mails entrantes sin procesar y pueda asignarles cliente + vendedor antes de que entren al flujo. Hoy está parcialmente en la vista de Vendedor (bloque amarillo) pero no hay una vista centralizada para el Admin.
- [ ] **Estado de OC visible desde la cotización**: si una cotización está en "Aceptada" y tiene OC vinculada, el drawer de QuoteDetail debería mostrar en qué etapa está esa OC sin tener que ir a buscarla al kanban.
- [ ] **Eliminar adjuntos**: se puede subir pero no borrar desde la UI. Falta botón eliminar en la lista de adjuntos de QuoteDetail y OrderDetail + endpoint `DELETE /api/quotes/:id/attachments/:attId`.

### Media prioridad — UX mejorable
- [ ] **Historial del cliente: monto total de OCs entregadas**: agregar suma del monto de las OCs entregadas en el KPI correspondiente (hoy muestra solo el conteo).
- [ ] **Notificaciones in-app (#11)**: el sistema de notificaciones por mail ya existe (reglas, SMTP). Falta una versión in-app — "chips" en el topbar con contexto dinámico según el rol: "3 alertas pendientes", "2 solicitudes sin asignar", etc.
- [ ] **Artículos en sidebar**: el catálogo de artículos es algo que se carga raramente. Debería estar dentro de Configuración en lugar de ser ítem principal del sidebar.
- [ ] **Kanban con demasiadas columnas**: 8 etapas en cada kanban (F1 y F2) hacen que sea muy angosto. Opción A: reducir a etapas agrupadas; Opción B: vista lista/tabla como alternativa al kanban.
- [ ] **"Nueva OC" manual confunde**: el 95% de las OC se crea automáticamente al aceptar una cotización. El botón manual podría estar en opciones avanzadas o quitarse.

### Baja prioridad — detalles
- [ ] **InviteUserModal default zona**: hardcodeado `'AMBA Norte'` (crm-interact.jsx ~línea 791). Cambiar a campo vacío.
- [ ] **Zona en ProfileModal**: el usuario no puede editar su propia zona desde el perfil. Solo el admin puede. Considerar agregar el campo o aclarar que lo gestiona el admin.
- [ ] **Dashboard alerta "1 día hábil"**: la lógica usa `q.dias >= 5` pero el label dice "1 día hábil". Revisar si el umbral correcto es 1 o 5.
- [ ] **Dashboard seller filter**: chequea `['VENDEDOR','ADMIN','Vendedor','Administrador']` — mezcla roles del backend (MAYÚSCULAS) con los del frontend (mapeados). Limpiar a un solo formato.
- [ ] **Versión en login**: hardcodeada como `v2026.04` en la pantalla de login. Menor.
- [ ] **Búsqueda Cmd+K**: implementada pero el usuario no sabe que existe. Agregar hint visible en el topbar o sidebar.

---

## Notas técnicas importantes

### Prisma
- Después de cambiar `schema.prisma`: parar servidor → `npx prisma generate` → `npm run dev`
- Si el servidor está corriendo y se hace `db push`, el archivo `.dll` de Prisma queda bloqueado
- Usar `npx prisma db push --skip-generate` cuando el server está corriendo, luego regenerar después

### Neon (DB cloud)
- Free tier — se pausa después de inactividad
- La pantalla de error/retry en AppRoot maneja este caso (muestra "Conectando…" con botón Reintentar)
- El primer request después de pausa puede tardar 2-5 segundos

### Entorno
- `.env` necesita: `DATABASE_URL`, `JWT_SECRET`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_HOST`, `MAIL_PORT`, `APP_URL`
- Archivos subidos en `uploads/attachments/` y `uploads/avatars/` — no están en git (.gitignore)
- `loadAllData()` tarda según Neon — si falla, AppRoot muestra pantalla de error

### Worktree de Claude
- Ediciones en branch: `claude/friendly-blackwell-7e1d36`
- Merge al main desde: `C:\Users\Facundo\Downloads\myselec-crm` (directorio padre)
- Nunca hacer merge desde dentro del worktree (conflicto de branch en uso)
