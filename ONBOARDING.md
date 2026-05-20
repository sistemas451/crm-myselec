# MySelec CRM — Contexto de desarrollo

## Qué es este proyecto

CRM comercial para MySelec. Gestiona el flujo completo desde solicitudes de cotización hasta entrega de órdenes. Stack: Node.js + Express + Prisma + PostgreSQL (Neon serverless) + React (CDN, sin build step) + Tailwind CSS.

**Repo:** https://github.com/bruscofacundo1/crm-gerenciando-canales  
**Usuario principal:** bruscofacundo1@gmail.com (ADMIN)

---

## Cómo levantar el proyecto

```bash
git clone https://github.com/bruscofacundo1/crm-gerenciando-canales.git myselec-crm
cd myselec-crm
npm install
# Crear .env con DATABASE_URL, JWT_SECRET, GMAIL_USER, GMAIL_PASS, etc.
node src/server.js
```

El frontend se sirve estático desde `public/`. No hay build — el navegador transpila JSX con Babel Standalone (CDN). Abrir `http://localhost:3000`.

---

## Estructura del proyecto

```
myselec-crm/
├── public/
│   ├── index.html          # Entry point, carga todos los JSX como scripts
│   ├── crm-api.jsx         # Capa de fetch: CrmApi.* y CrmAuth.*
│   ├── crm-views.jsx       # Vistas principales (Clientes, Artículos, Usuarios, Config)
│   ├── crm-kanban.jsx      # Tableros Kanban (Fase 1: cotizaciones, Fase 2: notas de pedido)
│   ├── crm-details.jsx     # Modales de detalle (QuoteDetail, OrderDetail)
│   ├── crm-interact.jsx    # Modales de acción (NewQuoteModal, NewOrderModal, etc.)
│   └── crm-search.jsx      # Búsqueda global Ctrl+K
├── src/
│   ├── server.js           # Express principal + rutas de adjuntos con auto-parse PDF
│   ├── db.js               # Singleton Prisma client
│   ├── middleware/auth.js  # JWT authMiddleware
│   ├── routes/
│   │   ├── quotes.js       # CRUD cotizaciones (Fase 1)
│   │   ├── orders.js       # CRUD notas de pedido (Fase 2)
│   │   ├── clients.js      # CRUD clientes + importación XLSX
│   │   ├── articles.js     # CRUD artículos + importación XLSX
│   │   └── users.js        # CRUD usuarios
│   └── services/
│       ├── flexxusParser.js    # Parser PDF Flexxus: presupuestos y notas de pedido
│       └── mailReader.js       # Lector IMAP Gmail — ingesta automática de mails
├── prisma/
│   └── schema.prisma       # Modelos: User, Client, Quote, Order, QuoteItem, etc.
└── scripts/
    └── clear-data.js       # Script para limpiar datos de prueba
```

---

## Flujo de negocio

### Fase 1 — Cotizaciones (tablero izquierdo)

| Stage | Descripción |
|-------|-------------|
| `recibida` | Solicitud nueva por mail (mailType=SOLICITUD) |
| `asignada` | Asignada a vendedor |
| `enviado` | Presupuesto Flexxus enviado al cliente (mailType=PRESUPUESTO) |
| `aceptado` | Cliente aceptó — se crea una Nota de Pedido en Fase 2 |
| `rechazado` | Cliente rechazó |

**Tipos de Quote por `mailType`:**
- `null` / `PRESUPUESTO` → presupuesto manual (creado desde UI) — aparece directo en "enviado"
- `SOLICITUD` → solicitud recibida por mail
- `PRESUPUESTO` → presupuesto recibido por mail
- `NOTA_PEDIDO` → NP recibida por mail → va directo a Fase 2 en stage `np_enviada`
- `OC` → ya no se usa

**Importante — bug histórico corregido:** Prisma NOT IN con null en PostgreSQL excluye registros donde el campo ES NULL. El WHERE de quotes usa:
```js
OR: [
  { mailType: null },
  { mailType: { notIn: ['OC', 'NOTA_PEDIDO'] } },
]
```

### Fase 2 — Notas de Pedido (tablero derecho)

| Stage | Descripción |
|-------|-------------|
| `np_enviada` | NP recibida, pendiente |
| `np_flexxus` | Ingresada en Flexxus |
| `stock` | En stock disponible |
| `proveedor` | A espera de proveedor |
| `armado` | En proceso de armado |
| `facturada` | Factura emitida |
| `transito` | En tránsito |
| `entregada` | Entregado |

La lista de Fase 2 mezcla dos fuentes via `_source`:
- `_source: 'ORDER'` → modelo `Order` (NP creadas manualmente desde UI)
- `_source: 'QUOTE'` → modelo `Quote` con `mailType: 'NOTA_PEDIDO'` (NP recibidas por mail)

---

## Auto-parse de PDFs Flexxus

### Al subir adjunto a una cotización (`POST /api/quotes/:id/attachments`):
- Detecta si el archivo es presupuesto Flexxus por nombre de archivo (`isFlexxusPDF`)
- Llama a `parseFlexxusPDF(buffer)` → extrae: `npCode`, `cuit`, `items[]`, `subtotalNeto`, `ivaAmount`, `totalPercepciones`, `total`
- Guarda en la Quote: `flexxusCode`, `amount`, `subtotalNeto`, `ivaAmount`, `totalPercepciones`, `clientId` (match por CUIT), `sellerId`
- Reemplaza los QuoteItems con los del PDF
- Responde `{ attachments, flexxusParsed }` — el frontend muestra toast con los datos

### Al subir adjunto a una NP (`POST /api/orders/:id/attachments`):
- Detecta si es NP Flexxus (`isNotaPedidoPDF`)
- Llama a `parseNotaPedidoPDF(buffer)` → extrae: `npCode`, `cuit`, `ocNumber`, `presupuestoNP` (código PR), `items[]`, `total`
- Guarda en la Order: `flexxusCode`, `clientOCCode`, `clientId`, `fromQuoteId` (busca quote por presupuestoNP)
- Responde `{ attachments, npParsed }`

### Endpoint `POST /api/orders/parse-np`:
- Parsea un PDF de NP sin crear nada — solo devuelve los datos extraídos
- Lo usa el modal "Nueva Nota de Pedido" para pre-llenar el formulario

---

## Detalles de QuoteDetail

La vista de detalle de una cotización tiene tabs que varían según el tipo:

| Tipo | Tabs |
|------|------|
| SOLICITUD (por mail) | Mail → Adj → Historial → Notas |
| OC (por mail, legacy) | Ítems → Adj → Historial → Notas |
| PRESUPUESTO manual (`isManual = source !== 'EMAIL'`) | **Resumen** → Ítems → Adj → Historial → Notas |
| PRESUPUESTO por mail | **Resumen** → Ítems → Adj → Historial → Notas |

El tab Resumen muestra: tabla de ítems (izquierda) + sidebar RESUMEN con precios (derecha). El sidebar usa `priceBreakdown` (subtotalNeto, ivaAmount, totalPercepciones, total) que se carga del campo `detail.subtotalNeto` etc. de la DB.

---

## OrderDetail

Cuando la NP viene de un Quote (`_source: 'QUOTE'`), el detalle se carga con `getQuoteDetail` en vez de `getOrderDetail`. Los campos `npItems` y `linkedPres` se populan desde el Quote. El botón "De cotización" abre el QuoteDetail del presupuesto vinculado via `openModal('quoteDetail', { code })`.

---

## Ingesta de mails (IMAP)

`src/services/mailReader.js` — conecta a Gmail via IMAP, procesa mails nuevos cada N minutos.

Detecta tipo de mail por asunto/remitente:
- Mails con adjunto PDF Flexxus → crea Quote con `mailType: 'PRESUPUESTO'`
- Mails con NP → crea Quote con `mailType: 'NOTA_PEDIDO'`, `stage: 'np_enviada'`
- Mails genéricos → crea Quote con `mailType: 'SOLICITUD'`, `stage: 'recibida'`

Matchea cliente por: dominio de email → ClientEmail → Client.emailDomain → Client.email → CUIT en PDF.

---

## Variables de entorno (.env)

```
DATABASE_URL=postgresql://...@neon.tech/...
JWT_SECRET=...
GMAIL_USER=...@gmail.com
GMAIL_PASS=...           # App password de Google
EMAIL_FROM=...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
NODE_ENV=production
```

---

## Patrones importantes de código

### Autenticación
```js
// Middleware: src/middleware/auth.js
// Header: Authorization: Bearer <jwt>
// req.user = { id, email, role, name }
// Roles: ADMIN, VENDEDOR, LOGISTICA
```

### Frontend: no hay build
- Todos los archivos JSX en `public/` se cargan como `<script type="text/babel">` en `index.html`
- Estado global via React Context (`CrmContext`)
- Tailwind via CDN play
- Íconos via Heroicons (CDN)

### Importación XLSX
- Clients y Articles soportan importación masiva por Excel
- Flujo: `POST /api/clients/import/preview` → devuelve token + preview → `POST /api/clients/import/confirm?token=...` → aplica
- Token TTL: 30 minutos, guardado en `AppSetting` DB

### Códigos secuenciales
```js
// Pattern usado en quotes.js, orders.js
async function nextCode(model, prefix) {
  const last = await model.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const num = last ? (parseInt(last.code.split('-').pop()) || 0) : 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}
// Ejemplos: COT-2026-001, OC-2026-018
```

### Express: orden de rutas estáticas antes que dinámicas
```js
// IMPORTANTE: /parse-np debe ir ANTES de /:id
router.post('/parse-np', ...)   // ✓ primero
router.post('/',         ...)
router.get('/:id/detail',...)
```

---

## Estado actual del proyecto (mayo 2026)

- Flujo completo funcionando: solicitud → asignación → presupuesto Flexxus → aceptación → NP → entrega
- Auto-parse PDF al subir adjunto (presupuestos y notas de pedido)
- Ingesta IMAP Gmail activa
- Un solo usuario activo: Facundo Brusco (ADMIN)
- Base de datos: Neon PostgreSQL serverless
- Sin deploy en servidor externo — corre en local (Windows)
