# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
| `routes/mail.js` | `/api/mail` | IMAP accounts, manual sync trigger |
| `routes/users.js` | `/api/users` | User management, approve/reject, resend welcome, avatar |
| `routes/notifications.js` | `/api/notifications` | Inbox alerts, mark-seen, dismiss, counts, cron triggers |
| `routes/settings.js` | `/api/settings` | AppSetting key-value store (ADMIN only) |
| `routes/articles.js` | `/api/articles` | Product catalog, XLSX import |
| `routes/logs.js` | `/api/logs` | Login logs (ADMIN only) |

File upload endpoints for attachments live in `server.js` (multer). Flexxus PDF uploads auto-parse via `flexxusParser.js`.

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
- **VENDEDOR** — own quotes + unassigned `recibida`; own orders only
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

**No ES modules** — files communicate via `Object.assign(window, {...})`. Import/export syntax breaks the app.

**Modal registry** in `crm-interact.jsx`: `newQuote`, `newOrder`, `newClient`, `editClient`, `clientDetail`, `inviteUser`, `permissions`, `search`, `quoteDetail`, `orderDetail`.

### Database (Neon PostgreSQL)

Schema pushed with `prisma db push` — no migration files. Key models:
- `Quote` ↔ `Quote` via `linkedQuoteId` (SOLICITUD↔PRESUPUESTO)
- `Order.fromQuoteId` → `Quote`
- `StageDefinition` — configurable stages per phase with `maxHours`
- `AppSetting` — key-value config store
- `LoginLog` — login audit trail
- `PasswordResetToken` — used for both forgot-password and welcome-email flows
- `notificationPrefs Json?` on User — stores `lastInboxCheck`, `dismissed{}`, `inapp{}`, `email{}` per-user prefs

### Known issues / audit backlog

- **A-1** (ALTO): GET detail endpoints don't enforce ownership for VENDEDORs
- **A-2** (ALTO): `nextCode()` has race condition under concurrency — needs retry on P2002
- **M-1** (MEDIO): `POST /clients` uses `...req.body` (mass assignment)
- **M-2** (MEDIO): TLS uses `rejectUnauthorized: false` everywhere
- **M-3** (MEDIO): Mail account passwords stored in plaintext in AppSetting
- **M-6** (MEDIO): Missing ownership checks on some order endpoints (notes, stage OC path)
- **M-9** (MEDIO): `emailMessageId` has index but not unique constraint
