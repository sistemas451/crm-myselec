# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cómo funciona Claude Code (para el desarrollador)

Claude Code es una CLI que corre **localmente** en tu máquina. Tiene acceso directo al sistema de archivos del proyecto:
- Lee y edita archivos directamente (no trabaja en memoria)
- Corre comandos de shell: `git`, `npm`, `npx`, etc.
- Hace `git commit` y `git push` al remoto desde tu máquina

El flujo de trabajo típico en cada sesión:
1. Abrís Claude Code en la carpeta del proyecto
2. Le pedís cambios — los hace directo en los archivos locales
3. Al terminar hace `git add + commit + push` al GitHub configurado

## Setup en PC nueva

### 1. Requisitos previos
- Node.js 18+
- Git configurado con tu usuario de GitHub
- Claude Code CLI: `npm install -g @anthropic-ai/claude-code`

### 2. Clonar el repo
```bash
git clone https://github.com/sistemas451/crm-myselec.git
cd crm-myselec
npm install
npx prisma generate
```

### 3. Variables de entorno
Crear archivo `.env` en la raíz del proyecto con:
```
DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require
JWT_SECRET=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
MAIL_USER=iamyselec@gmail.com
MAIL_PASSWORD=...
MAIL_HOST=imap.gmail.com
MAIL_PORT=993
MAIL_ENCRYPTION_KEY=...
```
(Los valores exactos están en Railway → Variables del proyecto `crm-myselec`)

### 4. Arrancar
```bash
npm run dev
# Servidor en http://localhost:3000
```

### 5. Abrir Claude Code
```bash
# Desde la carpeta del proyecto
claude
```
Claude Code lee el `CLAUDE.md` automáticamente al iniciar — ya tiene todo el contexto del proyecto.

### Remotes de Git configurados
- `origin` → `https://github.com/sistemas451/crm-myselec.git` (repo principal Myselec)
- Si necesitás sincronizar con el repo anterior: `git remote add old https://github.com/bruscofacundo1/crm-gerenciando-canales.git`



## Commands

```bash
# Start server (development)
npm run dev          # node src/server.js

# Database
npx prisma db push   # Apply schema changes to Neon (no migrations generated)
npx prisma generate  # Regenerate Prisma client after schema changes

# Health check (server must be running)
curl http://localhost:3000/api/health
```

No tests, linter, or build step. Frontend JSX is compiled in-browser via Babel Standalone.

## Architecture

### Backend — Node.js + Express + Prisma

`src/server.js` is the entry point. Routes mounted under `/api/*`:

| Route file | Prefix | Notes |
|---|---|---|
| `routes/auth.js` | `/api/auth` | Login, register, JWT, password reset, email domain validation |
| `routes/quotes.js` | `/api/quotes` | Cotizaciones CRUD, send-email, send-reminder, items, attachments |
| `routes/orders.js` | `/api/orders` | Órdenes de compra CRUD |
| `routes/clients.js` | `/api/clients` | Client CRUD, XLSX import, email matcheo, timeline |
| `routes/data.js` | `/api/data` | Dashboard KPIs, charts, activity feed, comparativa |
| `routes/mail.js` | `/api/mail` | IMAP accounts (ADMIN only), sync trigger (any role, 10min cooldown) |
| `routes/users.js` | `/api/users` | User management, approve/reject, resend welcome, avatar |
| `routes/notifications.js` | `/api/notifications` | Inbox alerts, mark-seen, dismiss, counts, cron triggers |
| `routes/settings.js` | `/api/settings` | AppSetting key-value store (ADMIN only) |
| `routes/articles.js` | `/api/articles` | Product catalog, XLSX import |
| `routes/exports.js` | `/api/exports` | PDF reports (cotizaciones, rechazos, ordenes) download + email |
| `routes/logs.js` | `/api/logs` | Login logs (ADMIN only) |

File upload endpoints for attachments live in `server.js` (multer). Flexxus PDF uploads auto-parse via `flexxusParser.js`.

### Bi-monetario (USD / ARS)

Each quote has a `currency` field (`"USD"` | `"ARS"`, default `"USD"`). Flexxus-imported quotes are always USD. Manual quotes allow selecting currency.

- **Backend**: `Quote.currency` column. Dashboard KPIs split into USD/ARS aggregates (`montoTotalUSD`, `montoTotalARS`, etc.). All endpoints that return amounts also return `currency`.
- **Frontend**: `fmtMoney(n, cur, dec)` renders `U$S` or `AR$` prefix — no hardcoded currency strings anywhere. Kanban stage totals, client detail, seller KPIs, performance view, rejection analysis all display both currencies when present.
- **NewQuoteModal**: currency selector defaults to `'USD'`, sent to API on create.

### PDF Export System

`src/services/pdfExporter.js` generates 3 A4 landscape PDF reports using pdfkit:
- **Cotizaciones** — quote listing with KPI cards, paginated table, currency-separated totals
- **Rechazos** — rejection analysis report
- **Órdenes** — orders/logistics report

`routes/exports.js` exposes:
- `GET /api/exports/cotizaciones` — download PDF
- `GET /api/exports/rechazos` — download PDF
- `GET /api/exports/ordenes` — download PDF
- `POST /api/exports/send` — email any report (body: `{ type, to, cc?, subject?, body?, filters? }`)

Frontend: `ExportModal` component registered as `exportPdf` in modal registry. Supports download and email-send modes with date/seller filters.

### Branded Email Template System

**All** outgoing emails use a shared branded HTML wrapper from `src/services/emailTemplate.js`. Based on the Myselec 2022 brand identity manual.

**Brand colors** (from `BRAND_COLORS` / `C` constant):
- `#004669` (brandDark) — header background, headings
- `#20759E` (brand) — accent line, CTA buttons, links
- `#231F20` (black) — body text
- `#939598` (grayDark) — secondary text
- `#BCBEC0` (grayMid) — tertiary text
- `#E8E9EA` (grayLight) — borders
- `#F5F6F7` (bg) — background fills, info boxes

**Exported helpers:**
- `brandedEmail({ title, preheader, content, showLogo })` — full HTML email with dark header (#004669) + Logo-M.png, accent line (#20759E, 3px), white body, gray footer with "Ir al CRM" button
- `emailButton(href, label)` — centered CTA button in brand blue
- `emailInfoBox(lines[])` — gray rounded box with data rows
- `emailWarning(title, text)` — amber warning box
- `emailParagraph(text)` — styled paragraph
- `quoteBodyToHtml(body)` — converts plain text to HTML paragraphs (escapes HTML, splits on newlines)

**Email sends using branded template** (16+ locations):
- `mailer.js` — password reset, generic notification
- `mailSender.js` — quote/presupuesto send
- `users.js` — welcome, admin confirmation, resend welcome, password changed, approve, reject
- `auth.js` — new registration admin notification
- `quotes.js` — send-email, send-reminder
- `feedback.js` — new post notification, response notification
- `notifier.js` — stage alert digest, weekly report
- `notifications.js` — weekly report test endpoint
- `mailReader.js` — unassigned mail digest

**Preview page:** `public/email-preview.html` — static HTML page with 7 tabs showing how each email type renders. Uses Logo-M.png, client-side JS to replicate `brandedEmail` layout.

### Two-table "F2" pattern

The order board merges:
- **`Order` model** — manually created OCs (`_source: 'ORDER'`)
- **`Quote` with `mailType: 'NOTA_PEDIDO'`** — email-ingested orders (`_source: 'QUOTE'`)

`GET /api/orders` returns both merged with a `_source` discriminator. `OrderDetail` routes API calls to `/quotes/:id` or `/orders/:id` via `isQuoteSource`.

### F1 mailType values

`SOLICITUD` · `PRESUPUESTO` · `OC` (legacy) · `NOTA_PEDIDO` (→ F2) · `null` (manual)

F1 board excludes `mailType IN ('OC', 'NOTA_PEDIDO')`.

### Auth + RBAC

JWT issued at login, validated in `src/middleware/auth.js`. Checks `passwordChangedAt` to reject tokens issued before a password reset.

- **ADMIN** — full access
- **VENDEDOR** — own quotes + unassigned `recibida` (can self-assign an unassigned quote to themselves via `PATCH /quotes/:id/assign`, but not reassign quotes owned by someone else); own orders only
- **LOGISTICA** — read-only order board

Ownership pattern on mutating endpoints: fetch record first → 404 if missing → 403 if `sellerId !== req.user.id` for VENDEDORs.

**Important**: GET detail endpoints (`/quotes/:id/detail`, `/orders/:id/detail`) currently don't enforce ownership — known issue (A-1 in audit backlog).

### User registration flows

1. **Public register** → `pendingApproval: true` → admin approves (sends styled welcome email) or rejects
2. **Admin creates manually** → random temp password (never shown) → `PasswordResetToken` (48h) → welcome email with "Configure my password" link
3. **Resend welcome** → `POST /users/:id/resend-welcome` → invalidates old tokens, sends new link

When admin changes a user's password via `PUT /users/:id`, `passwordChangedAt` is set (invalidates prior JWTs) and a notification email is sent to the user.

### Notification system

**In-app alerts** (`GET /api/notifications/inbox`): 9 types returned per role:
- ADMIN: unassigned quotes, pending users, overdue stages (grouped by stage), idle quotes, unlinked solicitudes
- VENDEDOR: follow-up due, follow-up upcoming, overdue stages, idle quotes, unlinked solicitudes, no-response presupuestos

Alerts support: `newCount` (new since last bell open), `dismissable` (server-side snooze 3/7/30 days), `items[]` (mini-list of top items).

`POST /notifications/mark-seen` — updates `notificationPrefs.lastInboxCheck`.
`POST /notifications/dismiss { key, days }` — stores expiry in `notificationPrefs.dismissed`.

**Email notifications** (`src/services/notifier.js`):
- `runStageAlerts()` — digest per vendor with cooldown (`stage_alert_cooldown_days`)
- `runWeeklyReport()` — Monday 9am to admins
- Unassigned mail digest — configurable frequency (`unassigned_mail_frequency`: immediate/daily/2days/weekly)

**Cron endpoint** `POST /notifications/cron/stage-alerts` requires `x-cron-secret` header matching `CRON_SECRET` env var. Fails closed if `CRON_SECRET` is not set.

### Quote reminder flow

`POST /api/quotes/:id/send-reminder { subject, body }` — sends follow-up email to client, records `REMINDER_SENT` activity, pushes `followUpDate` by `reminder_followup_push_days`. Available as:
- Button in quote detail header (PRESUPUESTO in `enviado` stage with client email)
- "Recordar" button in NO_RESPONSE bell alert mini-list

### Mail ingestion

`src/services/mailReader.js` connects via IMAP. On sync:
1. Fetches from CRM label + All Mail (by subject prefix) + Sent folder
2. Detects type by PDF: `isFlexxusPDF` → PRESUPUESTO, `isNotaPedidoPDF` → NOTA_PEDIDO
3. Matches client by CUIT (from PDF) → email → domain
4. Creates Quote, auto-links SOLICITUD↔PRESUPUESTO by thread (In-Reply-To) or client match
5. Dedup via `emailMessageId` (index, not unique — known issue M-9)
6. Unassigned digest: accumulates `unassigned: true` results, sends grouped mail per frequency setting

Multi-account: `MAIL_ACCOUNTS` env var (JSON array) or `AppSetting key='mail_accounts'`.

### Settings (AppSetting key-value store)

Key settings used across the app:
- `mail_sync_interval_hours`, `mail_lookback_days`, `mail_sync_enabled`
- `mail_sync_window_enabled`, `mail_sync_window_days` (comma-separated `0`=domingo…`6`=sábado), `mail_sync_window_start_hour`, `mail_sync_window_end_hour` — restricts the background auto-sync timer to a configurable day/hour window (default Lun-Vie 8-20hs). Does not affect the login-triggered sync, which always runs regardless of time.
- `follow_up_days`, `idle_inbox_days`, `idle_email_days`
- `stage_alert_cooldown_days`, `unassigned_mail_frequency`
- `solicitud_sin_pres_days`, `no_response_days`, `follow_up_upcoming_days`
- `reminder_followup_push_days`, `reminder_subject`, `reminder_body`
- `allowed_email_domains`, `allowed_emails`
- `inapp_*` toggles (one per alert type), `notify_*` toggles (mail)
- `weekly_report_enabled/day/hour`

`emailAllowed()` and `getAllowedDomains()` are exported from `routes/auth.js` for reuse in `routes/users.js`.

### Login logs

`LoginLog` model records every login attempt (success + failure) with email, userId, IP, user-agent. Auto-cleanup: deletes records older than 90 days on each login. Visible in Config → Registros (ADMIN only). Export via `GET /api/logs/logins/export` (CSV with BOM).

### Frontend — no-build React

`public/index.html` loads in order:
1. `crm-api.jsx` — `CrmAuth` + `CrmApi` (all fetch wrappers)
2. `crm-data.jsx` — shared helpers (`cx`, `fmtMoney`, `fmtDate`), `Icon`, static arrays
3. `crm-interact.jsx` — `AppProvider` + `useApp()` — global state, modals registry, NotificationsPopover, ReminderModal, ClientDetailModal
4. `crm-kanban.jsx` — `KanbanQuotes`, `KanbanOrders`
5. `crm-details.jsx` — `QuoteDetail`, `OrderDetail`, `SendEmailModal`
6. `crm-views.jsx` — `Clients`, `Team`, `Config` (tabs: Etapas/Mail/Notificaciones/Artículos/Acceso/Registros), `MySalesView`, `Comparativa`, `LoginLogs`
7. `crm-app.jsx` — `AppRoot`, login/register, sidebar, topbar, dashboard, user profile modal

**No ES modules** — files communicate via `Object.assign(window, {...})`. Import/export syntax breaks the app. Only export symbols that are used by other files — internal-only components stay local.

**Modal registry** in `crm-interact.jsx`: `newQuote`, `newOrder`, `newClient`, `editClient`, `clientDetail`, `inviteUser`, `permissions`, `search`, `quoteDetail`, `orderDetail`, `exportPdf`.

### Scripts

Only two utility scripts remain in `scripts/`:
- `seedAdmin.js` — create initial admin user (setup)
- `import-articles.js` — import article catalog from XLSX (recurrent use)

### Database (Neon PostgreSQL)

Schema pushed with `prisma db push` — no migration files. Key models:
- `Quote` ↔ `Quote` via `linkedQuoteId` (SOLICITUD↔PRESUPUESTO)
- `Order.fromQuoteId` → `Quote`
- `StageDefinition` — configurable stages per phase with `maxHours`
- `AppSetting` — key-value config store
- `LoginLog` — login audit trail
- `PasswordResetToken` — used for both forgot-password and welcome-email flows
- `notificationPrefs Json?` on User — stores `lastInboxCheck`, `dismissed{}`, `inapp{}`, `email{}` per-user prefs

### Email system (dual provider)

Two email services coexist:

1. **`mailer.js`** — System emails (welcome, password reset, notifications). Uses Gmail OAuth2 API as primary method. Falls back to **Resend API** (HTTP-based, works on Railway which blocks SMTP) if Gmail fails. Throws error if both methods fail.
   - Env vars: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (Gmail API) + `RESEND_API_KEY` (fallback)
   - Gmail OAuth tokens expire every 7 days if the Google Cloud app is in "Testing" mode. Publishing the app makes tokens permanent.
   - `verifySmtp()` tests both providers and reports status.

2. **`mailSender.js`** — Quote/presupuesto emails. Uses Nodemailer SMTP with auto-detect by domain. Supports multiple accounts (`MAIL_ACCOUNTS` env JSON array or `mail_accounts` AppSetting). Template system with `{cliente}`, `{codigo}`, `{vendedor}`, etc. On send: logs activity, advances stage to `enviado`, sets `followUpDate` +4 days.

### Build & Deploy (Railway)

- Build script: `npx prisma generate && npx prisma db push --accept-data-loss`
- `prisma db push` must run on deploy to apply schema changes to production Neon DB
- Railway blocks outbound SMTP — use API-based email providers only (Gmail API, Resend)
- `.claude/launch.json` is untracked — do NOT commit

### Nota de Pedido — Reestructuración (junio 2026)

**Problema:** La vista de Nota de Pedido (NP) en OrderDetail mostraba el layout de OC (KPIs + Logística + Documentación) en lugar del layout tipo Presupuesto con la tabla parseada, breakdown de precios y card de resumen. Además, al subir un PDF de NP manualmente, la Quote NOTA_PEDIDO (que almacena los ítems parseados) nunca se creaba.

**Causa raíz:** `server.js` (upload handler de orders) intentaba guardar `amount` en el modelo Order, que no tiene ese campo. Prisma lanzaba un error silencioso que abortaba toda la creación de la Quote NOTA_PEDIDO y sus ítems.

**Solución (5 commits en `main`):**

1. **`flexxusParser.js`** — Extraer `extractSkuFromText()` como función compartida entre `parseItems()` (presupuesto) y `parseNotaPedidoItems()` (NP). La NP ahora usa el cascade de 5 filtros SKU como fallback.

2. **`mailReader.js`** — Fix bug `sku: null` → `item.sku || null` (línea 730). Los SKUs extraídos por el parser ahora se guardan para NPs ingresadas por email.

3. **`server.js`** — Eliminar `updateData.amount = data.total` del upload handler de orders. El total se guarda en la Quote NOTA_PEDIDO, no en la Order.

4. **`crm-details.jsx`** — Nuevo flag `isNP` que detecta NPs tanto por email (`_source === 'QUOTE'`) como manuales (stage empieza con `np` o flexxusCode empieza con `NP-`). El tab Resumen muestra layout tipo Presupuesto para todas las NPs. Después de subir archivos a una NP, refresca el detalle para cargar la notaPedido recién creada.

**Flujo actual de parseo NP (idéntico para mail y manual):**
- Parser: `parseNotaPedidoPDF()` → extrae npCode, cuit, clientName, ocNumber, presupuestoNP, breakdown, ítems
- SKU: `parseNotaPedidoItems()` intenta patrones NP propios, luego fallback a `extractSkuFromText()` (5 filtros compartidos con presupuesto)
- Resultado: Quote `mailType: 'NOTA_PEDIDO'` con ítems, montos y vinculación bidireccional al presupuesto

### Sesión Foro + resumen semanal + fecha límite de armado (julio 2026)

**Consultas del equipo que originaron esta sesión (Foro):**
- **Victoria (MYS-0004):** confundida sobre si hace falta ponerle la etiqueta "crm" a las Notas de Pedido que envía desde su propia casilla (`victorias@myselec.com.ar`, distinta de Ventas) para que el sistema las lea. La respuesta original de Facundo decía que sí hacía falta — no es así. Aclarado: la etiqueta "crm" solo aplica a **Fuente 1** (mail recibido). **Fuente 2** (carpeta Enviados) se lee completa sin filtrar por etiqueta ni asunto — solo detecta si el mail enviado trae un PDF de Presupuesto o de NP adjunto, sea cual sea la casilla (mientras esa casilla esté agregada y sincronizando en Configuración → Mail).
- **Diego:** reportó que no podía responder en el hilo de su propia publicación del Foro después de que Facundo (dev) ya había contestado. Causa: `POST /:id/respond` estaba duro a `role === 'DEVELOPER'` — nadie más podía sumar mensajes al hilo, ni el autor de la publicación. No tenía que ver con la etapa del caso.

**Fix — hilo del Foro abierto a todos (`src/routes/feedback.js`)**
- Nuevo `POST /:id/comment`, sin restricción de rol (cualquier usuario autenticado). Si alguien que no es developer comenta un caso ya "Respondido"/"Resuelto", se reabre a "Abierto" automáticamente para que no quede enterrado. Notifica por mail al autor si responde el dev, o a los developers si responde cualquier otro (misma lista que `getFeedbackNotifyEmails()`).
- `POST /:id/respond` (con plantillas + cambio de estado) sigue siendo exclusivo de DEVELOPER — es el flujo "oficial" de cierre de casos.
- Frontend (`crm-views.jsx`, `FeedbackDetailView`): caja "Agregar comentario" visible para todos debajo de las respuestas; badge "Dev" solo en los mensajes de developers, el resto muestra la inicial del nombre.

**Fix — el resumen semanal nunca se estaba enviando (`src/services/notifier.js`, `src/server.js`)**
- Causa raíz: `runWeeklyReport()` solo corría desde un `setInterval` de **60 minutos contado desde el arranque del proceso**, no alineado al reloj. Como cada deploy reinicia el server (varias veces por semana con este ritmo de trabajo), ese timer se reseteaba todo el tiempo y casi nunca coincidía con la ventana configurada (lunes 9am ARG por defecto) — podían pasar semanas sin un envío real, sin ningún error visible.
- Fix: intervalo bajado a **5 minutos**. El chequeo es liviano cuando no coincide (solo lee 3 `AppSetting`), así que correrlo seguido no tiene costo real, y prácticamente garantiza que algún tick caiga dentro de la hora correcta.
- Se agregó `POST /notifications/cron/weekly-report`, protegido por header `x-cron-secret` (mismo patrón que `/cron/stage-alerts`), pensado para un cron externo si algún día se configura uno en Railway. **Hoy no está en uso** — no hay `CRON_SECRET` seteado en las variables de Railway ni ningún cron externo apuntándole. El fix real y activo es el intervalo de 5 min.
- Se agregó botón **"Probar"** en `Configuración → Alertas → Resumen semanal`, visible y funcional solo para rol DEVELOPER (chequeado en frontend y backend), que dispara `POST /notifications/weekly-report/test` — manda el resumen real (mismas queries y diseño que el automático) solo al mail de quien lo aprieta, sin esperar al lunes y sin tocar el dedup (`weekly_report_last_sent`) del envío real.
- El resumen semanal se manda **solo a usuarios ADMIN o DEVELOPER** activos (y que no hayan desactivado individualmente la preferencia `weekly_report` en su perfil) — VENDEDOR y LOGISTICA nunca lo reciben, sea cual sea la configuración general.

**MYS-0002 — Fecha límite de armado (✅ en producción)**
- Idea (pedido de Diego, ya se le mostró y le gustó): que el vendedor tenga una fecha límite interna para tener el presupuesto armado, no solo para el seguimiento post-envío.
- Diseño acordado: la fecha límite (`Quote.deadline`, campo que ya existía en el schema) se calcula automático = hoy + `deadline_days` (nuevo `AppSetting`, default 3, configurable en Config → Automatización) en el momento en que una Solicitud queda con vendedor asignado — sea al ingresar ya asignada (mail) o al asignarla manualmente después. Si ingresa sin vendedor, no se pone nada hasta que se asigne.
- Aplica **únicamente a Solicitudes** (`mailType: 'SOLICITUD'`) que todavía no tienen un Presupuesto vinculado — el campo y la alerta se ocultan apenas: (a) hay un `linkedQuoteId` seteado (ya existe un presupuesto armado, sea que se envió o no), o (b) la propia Solicitud pasa a etapa `enviado`/`aceptada`/`rechazada`. La lógica vive tanto en el badge del Kanban (`crm-kanban.jsx`) como en el campo de la ficha (`crm-details.jsx`) — ambos comparten la misma condición.
- Kanban: bandera 🚩 roja (con días de atraso) cuando se pasó la fecha y el presupuesto todavía no se mandó — tiene prioridad visual sobre el ⏰ de seguimiento vencido y el punto rojo genérico de etapa vencida. Mientras todavía no venció, cuenta regresiva "🚩Xd" a la izquierda del clip de adjuntos (ámbar si queda 1 día o menos, gris si queda más). Ícono "?" al lado de los filtros de Fase 1 con la leyenda de los 3 tipos de badge.
- El modal "Nueva cotización" (creación manual) siempre crea el registro como Presupuesto ya en etapa `enviado` — se confirmó con el usuario que ese botón es específicamente para cargar presupuestos que un vendedor ya armó y mandó por otro medio (WhatsApp, teléfono), no solicitudes nuevas a trabajar. Por eso no tiene (ni necesita) fecha límite — se le sacó el campo "Fecha límite de armado" del formulario y se corrigió el copy que decía "monto estimado, se completa al armar el presupuesto" (ya está armado al cargarlo).
- Backend: `POST /quotes` (creación manual) ya no calcula `deadline`. `PATCH /quotes/:id/assign` solo la setea si `mailType === 'SOLICITUD'`. Nuevo `PATCH /quotes/:id/deadline` para edición manual, también restringido a Solicitudes.
- Complementos agregados después de mostrárselo a Diego: alerta in-app "Fecha límite de armado vencida" en la campanita (mismo patrón ADMIN-ve-todo/VENDEDOR-ve-lo-suyo que el resto de las alertas, toggle en Config → Alertas), y auto-avance de etapa: al asignar vendedor por primera vez a una Solicitud que está en la etapa de entrada "sin vendedor", pasa sola a la etapa "con vendedor" (settings `default_stage_solicitud`/`default_stage_solicitud_con_vendedor`, las mismas que usa `mailReader.js`). Reasignar más adelante en el pipeline no mueve la etapa.

### Sesión menciones + filtros + auto-asignación + sync de mail (julio 2026)

**Filtros del Kanban (`crm-kanban.jsx`, `crm-interact.jsx`)**
- Nuevo valor sentinel `seller: 'UNASSIGNED'` en el filtro de Vendedor (Cotizaciones) — muestra solo cotizaciones con `sellerId` nulo.
- "Más filtros" (Cotizaciones y Órdenes): se sacaron los filtros de Zona y Tipo de actividad (poco usados, hardcodeados) y se agregó "Solo con notas" (`hasNotes`, solo Cotizaciones — filtra `notas > 0`).

**Menciones @ en notas** (`src/services/mentions.js`, `routes/quotes.js`, `routes/orders.js`, `routes/notifications.js`, `crm-details.jsx`, `crm-interact.jsx`, `crm-views.jsx`)
- `Note.mentionedUserIds String[]` — cualquier usuario activo puede ser mencionado (no solo admin), vía el botón "@" en el composer de notas (antes decorativo, sin funcionalidad) de `QuoteDetail` y `OrderDetail`. El picker inserta `@Nombre` en el texto y trackea los IDs por separado (no se parsea el texto).
- `POST /quotes/:id/notes` y `POST /orders/:id/notes` aceptan `mentionedUserIds[]` → `notifyMentions()` (mentions.js) agrega un `pendingMentions[]` al `notificationPrefs` del mencionado y le manda mail (branded template) si `notify_mentions` (AppSetting) está activo.
- `POST /notifications/ack-mention { noteId }` saca la mención de `pendingMentions` — se llama automáticamente al hacer click en "Ver" desde la campanita (mismo patrón que `ack-assigned`/`pendingAssigned` para cotizaciones recién asignadas).
- Alerta `MENTIONS` en `GET /notifications/inbox`, aplica a **cualquier rol** (no solo admin/vendedor), gateada por `inapp_mentions`.
- Toggle propio en Config → Alertas: `inapp_mentions` (campanita) + `notify_mentions` (mail).

**Preferencias de mail del Foro** (`src/routes/feedback.js`, `crm-app.jsx`)
- Antes, los 3 puntos donde `feedback.js` manda mail (nuevo post, respuesta, comentario) no respetaban ninguna preferencia individual. Ahora: `foro_response` (todos los roles — "me respondieron/comentaron mi post") y `foro_activity` (solo Admin/Developer — "hay actividad nueva para revisar", filtra `getFeedbackNotifyEmails()`), ambas en `notificationPrefs.email` del perfil de cada usuario (Mi perfil → Notificaciones → Por mail).
- **2 bugs preexistentes encontrados y corregidos en `ProfileModal` (`crm-app.jsx`) al implementar esto** (afectaban a todo el modal, no solo lo nuevo):
  - `displayUser` (en `App()`) pisaba el rol crudo del JWT (`'DEVELOPER'`) con la etiqueta en español del listado de usuarios (`'Desarrollador'`, viene de `mapUsersArr` en `crm-interact.jsx`) por el orden del spread — `isAdmin`/`isSeller`/`isLogistics` dentro de `ProfileModal` daban siempre `false`, ocultando todas las filas de preferencias admin-only. Fix: el rol del JWT va al final del spread.
  - `PrefRow` desestructuraba una prop llamada `key` (`{ section, key: k, ... }`) — React nunca pasa `key` como prop real a un componente (la intercepta el reconciler), así que `k` siempre daba `undefined`. Los call sites pasaban `k="..."` (prop distinta), nunca leída. Resultado: **todos** los toggles individuales de notificaciones (no solo los nuevos) leían/escribían la misma clave compartida `notificationPrefs.email.undefined` — activar cualquiera afectaba a todos por igual. Fix: `{ section, k, ... }`.

**Auto-asignación de vendedor** (`routes/quotes.js`, `crm-details.jsx`)
- `PATCH /quotes/:id/assign` ya no bloquea de plano a VENDEDOR — le permite asignarse a sí mismo (`sellerId === req.user.id`) únicamente si la cotización está sin vendedor; 403 si ya tiene dueño o si intenta asignarle a otro.
- En `QuoteDetail`, el lápiz "Cambiar vendedor" se reemplaza por un botón "Asignarme esta cotización" (sin dropdown) cuando el usuario es VENDEDOR y la cotización está libre; no se muestra nada si ya tiene dueño.

**Sync de mail — disparo al abrir el CRM + ventana laboral** (`server.js`, `routes/mail.js`, `crm-interact.jsx`, `crm-app.jsx`, `crm-views.jsx`)
- Motivación: el timer automático corría fijo cada 1-2h las 24hs/7 días (sin importar uso real), gastando cuota de cómputo de Neon (plan Free, 100 CU-hora/mes) de noche y fin de semana sin beneficio.
- `POST /api/mail/sync` dejó de ser admin-only — cualquier rol autenticado puede dispararlo (no expone cuentas ni credenciales IMAP, solo corre el sync). Cooldown compartido de 10 min (`lastTriggeredSyncAt`, en memoria) entre **todos** los disparadores — evita relanzar el sync completo de más.
- Disparador principal: `crm-interact.jsx` (`AppProvider`) llama `CrmApi.syncMail()` en segundo plano al montar la app si hay un token válido — cubre tanto login fresco como reabrir la pestaña con sesión recordada (7 días). No bloquea el login.
- Botón manual "Sincronizar" en el topbar (`crm-app.jsx`, `Topbar`), visible para todos los roles.
- El timer automático de fondo (`scheduleMailSync()` en `server.js`) sigue siendo la red de respaldo, pero ahora respeta una ventana configurable de días + horario (`mail_sync_window_*`, ver Settings arriba) — fuera de la ventana no corre. Toggle para desactivar la restricción y volver al comportamiento de siempre (correr sin importar hora/día).
- Sync siempre procesa **todas** las cuentas configuradas — no existe el concepto de "cuenta propia" por vendedor, las casillas son compartidas por la empresa.

### Known issues / audit backlog

- **A-1** (ALTO): GET detail endpoints don't enforce ownership for VENDEDORs
- **A-2** (ALTO): `nextCode()` has race condition under concurrency — needs retry on P2002
- **M-1** (MEDIO): `POST /clients` uses `...req.body` (mass assignment)
- **M-2** (MEDIO): TLS uses `rejectUnauthorized: false` everywhere
- **M-3** (MEDIO): Mail account passwords stored in plaintext in AppSetting
- **M-6** (MEDIO): Missing ownership checks on some order endpoints (notes, stage OC path)
- **M-9** (MEDIO): `emailMessageId` has index but not unique constraint
