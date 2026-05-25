# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start server (development)
npm run dev          # node src/server.js

# Database
npx prisma db push   # Apply schema changes to Neon (no migrations generated)
npx prisma generate  # Regenerate Prisma client after schema changes
npm run seed         # Load initial users, stages, and clients from XLSX

# Health check (server must be running)
curl http://localhost:3000/api/health
```

There are no tests, linter, or build steps. The frontend requires no compilation — JSX files are loaded via Babel Standalone in the browser.

## Architecture

### Backend — Node.js + Express + Prisma

`src/server.js` is the entry point. Routes are mounted under `/api/*`:

| Route file | Prefix | Notes |
|---|---|---|
| `routes/auth.js` | `/api/auth` | Login, JWT issue, password reset |
| `routes/quotes.js` | `/api/quotes` | Full CRUD for F1 (cotizaciones) |
| `routes/orders.js` | `/api/orders` | Full CRUD for F2 (órdenes de compra) |
| `routes/clients.js` | `/api/clients` | Client CRUD + XLSX import |
| `routes/data.js` | `/api/data` | Users, stages, activity feed, dashboard KPIs, comparativa |
| `routes/mail.js` | `/api/mail` | Trigger IMAP sync manually |
| `routes/users.js` | `/api/users` | User management (admin only) |
| `routes/notifications.js` | `/api/notifications` | Notification rules CRUD |

File upload endpoints for quote and order attachments live directly in `server.js` (not in route files) because they use `multer`. When a Flexxus PDF is uploaded, `flexxusParser.js` auto-parses it and patches the quote/order with extracted data (client by CUIT, items, flexxusCode, amount).

### Two-table "F2" pattern

The order board (Fase 2) merges two data sources:
- **`Order` model** — manually created OCs (`_source: 'ORDER'`)
- **`Quote` model with `mailType: 'NOTA_PEDIDO'`** — email-ingested orders (`_source: 'QUOTE'`)

Frontend `GET /api/orders` returns both merged with a `_source` discriminator. `OrderDetail` uses `isQuoteSource = o._source === 'QUOTE'` to route API calls to `/api/quotes/:id` or `/api/orders/:id` accordingly.

### F1 (Cotizaciones) mailType values

Quotes in the F1 board (`GET /api/quotes`) exclude `mailType IN ('OC', 'NOTA_PEDIDO')` — those belong to F2. The `mailType` values are:
- `null` — manually created
- `SOLICITUD` — email request from client
- `PRESUPUESTO` — Flexxus presupuesto PDF received by email
- `OC` — order confirmation from client (legacy, superseded by NOTA_PEDIDO)
- `NOTA_PEDIDO` — Flexxus nota de pedido PDF received by email (goes to F2)

### Gmail-only email flow

`POST /api/quotes/:id/send-email` with `_gmailOnly: true` skips SMTP, logs an `EMAIL_SENT` activity, and advances the quote stage to `'enviado'` if current stage is in `STAGES_TO_ADVANCE`. The frontend opens a Gmail compose tab. This endpoint requires ownership: VENDEDORs can only act on their own quotes.

### Auth + RBAC

`src/middleware/auth.js` decodes JWT and validates the token is not pre-password-change. Three roles:
- **ADMIN** — full access to all quotes, orders, clients, users
- **VENDEDOR** — sees own quotes + unassigned `recibida` quotes; own orders only
- **LOGISTICA** — read-only order board view

Ownership checks on mutating endpoints: always fetch the record first, return 404 if missing, 403 if `sellerId !== req.user.id` for VENDEDORs.

### Frontend — no-build React

`public/index.html` loads scripts in dependency order:
1. `crm-api.jsx` — `CrmAuth` (localStorage JWT) + `CrmApi` (all fetch calls) + `apiFetch`
2. `crm-data.jsx` — shared helpers (`cx`, `fmtMoney`, `fmtDate`), `Icon` (Lucide), static fallback arrays (`QUOTES`, `ORDERS`, etc. as empty arrays until API loads)
3. `crm-interact.jsx` — `AppProvider` + `useApp()` hook — global React state for quotes/orders/clients/users/filters
4. `crm-kanban.jsx` — `KanbanQuotes`, `KanbanOrders` board components
5. `crm-details.jsx` — `QuoteDetail`, `OrderDetail`, `SendEmailModal` drawer components
6. `crm-views.jsx` — `LogisticsView`, `MySalesView`, `Clients`, `Team`, `Config`, `Comparativa`
7. `crm-app.jsx` — `AppRoot` (login + routing + sidebar), mounted via `ReactDOM.render`

**Window globals**: `AppRoot` on login populates `window.QUOTES`, `window.ORDERS`, `window.CLIENTS`, etc. from the API. `AppProvider` (`crm-interact.jsx`) initialises its state from these globals and owns all mutations.

**No ES modules**: files communicate via `window.*` assignments (e.g. `Object.assign(window, { QuoteDetail, OrderDetail, ... })`). Import/export syntax will break the app.

### Database

PostgreSQL on Neon (serverless). Schema is pushed directly with `prisma db push` — no migration files. Key relationships:

- `Quote` ↔ `Quote` via `linkedQuoteId` (SOLICITUD linked to its PRESUPUESTO)
- `Order.fromQuoteId` → `Quote` (OC originated from a quote)
- `Client.emailDomain` — used by `mailReader.js` to auto-match incoming emails to clients
- `StageDefinition` — configurable stages per phase (COTIZACION / ORDEN_COMPRA), loaded at startup

### Mail ingestion

`src/services/mailReader.js` connects via IMAP to Gmail. On sync it:
1. Fetches unseen messages from inbox (filtered by `[crm]` subject prefix or CRM label)
2. Also scans Sent folder for outbound presupuestos/NPs
3. Detects mail type by PDF attachment filenames (`isFlexxusPDF`, `isNotaPedidoPDF`)
4. Matches sender/recipient to a `Client` by `emailDomain` or `ClientEmail` records
5. Creates a `Quote` record with the appropriate `mailType`
6. Deduplicates via `emailMessageId` (`@@index([emailMessageId])` on Quote)

Auto-sync runs on a configurable interval stored in `AppSetting` key `mail_sync_interval_hours` (default 2h).

### Notification system

`src/services/notifier.js` sends emails via `mailer.js` based on `NotificationRule` records. Triggers: `STAGE_CHANGE` (on every `PATCH /stage`), `IDLE_HOURS` (hourly cron), `FOLLOW_UP` (quotes with `followUpDate <= now`). Templates support `{{quote.code}}`, `{{client.name}}`, `{{seller.email}}` placeholders.

### Code generation

Quote codes: `COT-2026-NNN`. Order codes: `OC-2026-NNN`. Generated by `nextCode()` helper using `findFirst + orderBy: code desc` — not a DB sequence. The `@unique` constraint on `code` catches collisions.
