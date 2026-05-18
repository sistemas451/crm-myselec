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
npx prisma generate   # importante después de cambios al schema
npm run dev
# Abre en http://localhost:3000
```

---

## Estructura de archivos clave

```
src/
  server.js              — Express + rutas registradas
  routes/
    auth.js              — Login (rememberMe), registro público, forgot/reset password
    quotes.js            — Cotizaciones (CRUD + stage changes + items)
    orders.js            — Órdenes de compra
    clients.js           — Clientes
    users.js             — Usuarios: CRUD, toggle, approve, reject, profile, avatar, password
    data.js              — Dashboard, charts, stages, alertas
    articles.js          — Maestro de artículos (CRUD + importador XLS + sync)
    mail.js              — Sync IMAP manual
    notifications.js     — Reglas de notificación
    settings.js          — AppSettings
  services/
    mailReader.js        — Procesamiento automático de mails IMAP
    mailer.js            — Envío SMTP con nodemailer
    notifier.js          — Check de idle + envío de notificaciones
  middleware/
    auth.js              — JWT authMiddleware (verifica passwordChangedAt para invalidar sesiones)

public/
  Logo.png               — Logo real de Myselec (M 3D azul/gris)
  crm-app.jsx            — App principal: routing, Login, ProfileModal, ImageCropper, Sidebar
  crm-views.jsx          — Vistas: Clients, Articles, Team, Config, MySalesView, LogisticsView
  crm-details.jsx        — Drawers de detalle: cotizaciones, OCs, ArticleSearchInput
  crm-interact.jsx       — Modales: nueva cotización, nueva OC, asignar, etc.
  crm-api.jsx            — API layer: CrmAuth, CrmApi, apiFetch, loadAllData
  crm-data.jsx           — Componentes base: Icon, Logo, Avatar (acepta src para foto), Badge, etc.

prisma/
  schema.prisma          — Modelos: User, Client, Quote, Order, Article, Activity, etc.

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
- `name`, `email`, `password` (bcrypt), `role`, `zone`
- `phone`, `dni`, `cuit` — datos personales del registro
- `avatar` — path relativo a la foto de perfil (`/uploads/avatars/...`)
- `passwordChangedAt` — fecha del último cambio de contraseña (invalida tokens viejos)
- `active` (Boolean) — usuario habilitado
- `pendingApproval` (Boolean) — esperando aprobación del admin

### Quote (Cotización — Fase 1)
- `stage`: recibida → asignada → armado → enviado → aceptada / rechazada
- `mailType`: SOLICITUD | PRESUPUESTO | OC | NOTA_PEDIDO
- `rejectReason`, `rejectNotes`
- `sellerId`, `items`: QuoteItem[]

### Order (Orden de Compra — Fase 2)
- Se crea desde una Quote aceptada
- `stage`: oc → armado → despachado → entregada

### Article
- Importado desde Flexxus XLS (~3834 artículos)
- `code` (único), `description`, `category`, `type`, `class`, `coefVar`, `active`

---

## Sistema de usuarios y acceso

### Flujo de registro
1. Login → "Registrate" → formulario: Nombre, Apellido, Email, Teléfono, DNI, CUIT (opcional), Contraseña
2. Contraseña: mínimo 8 caracteres, una mayúscula, un número — validador visual en tiempo real
3. Se crea con `active: false`, `pendingApproval: true` → mail a todos los admins activos
4. Admin aprueba desde Equipo → elige rol → mail al usuario
5. Usuario puede ingresar

### Login
- Checkbox "Recordarme por 7 días" → JWT de 7d en vez de 24h
- Mensaje claro si la cuenta está pendiente de aprobación

### Perfil de usuario (sidebar, pie izquierdo)
Click en el nombre/foto del sidebar abre el **ProfileModal** con dos tabs:

**Tab Datos:**
- Foto de perfil con cropper circular (drag para mover, slider para zoom) antes de subir
- Nombre y teléfono editables
- Email de solo lectura

**Tab Seguridad:**
- Fecha y hora del último cambio de contraseña
- Contraseña actual requerida antes de cambiar
- No permite poner la misma contraseña
- Validador visual de requisitos en tiempo real
- Checkbox "Cerrar sesión en todos los dispositivos" — invalida todos los tokens al cambiar
- Mail automático al usuario cuando cambia la contraseña

### Invalidación de sesiones
- `authMiddleware` verifica que el token fue emitido después de `passwordChangedAt`
- Si no → 401 → el frontend redirige al login automáticamente
- Si la consulta a DB falla (Prisma desactualizado), deja pasar (resiliente)

### Protecciones
- No se puede quedar sin admins activos (toggle y cambio de rol)
- No podés desactivarte a vos mismo

### Usuario maestro
- **Facundo Brusco** — bruscofacundo1@gmail.com — rol ADMIN
- `node scripts/seedAdmin.js`

### Roles
- `ADMIN` → todo: dashboard, config, equipo, artículos, clientes, aprobación de usuarios
- `VENDEDOR` → mis cotizaciones, mis OCs, pipeline, clientes (lectura), artículos
- `LOGISTICA` → operaciones (OCs en curso)

---

## Endpoints API relevantes

### Auth
- `POST /api/auth/login` — login JWT, acepta `rememberMe` (7d)
- `POST /api/auth/register` — registro público sin token
- `POST /api/auth/forgot-password` — genera token y envía mail
- `POST /api/auth/reset-password` — cambia contraseña con token
- `GET  /api/auth/me` — datos del usuario logueado

### Users
- `GET  /api/users` — lista usuarios activos (excluye pendientes)
- `GET  /api/users/pending` — pendientes de aprobación (admin)
- `POST /api/users` — crear usuario (admin)
- `PUT  /api/users/:id` — editar usuario (admin)
- `PATCH /api/users/:id/toggle` — activar/desactivar (admin)
- `POST /api/users/:id/approve` — aprobar + rol + mail (admin)
- `POST /api/users/:id/reject` — rechazar + eliminar + mail (admin)
- `PATCH /api/users/:id/profile` — editar nombre y teléfono (propio o admin)
- `POST /api/users/:id/avatar` — subir foto de perfil con multer
- `PATCH /api/users/:id/password` — cambiar contraseña con verificación actual + mail

---

## Componentes frontend clave

### crm-app.jsx
- `ProfileModal` — modal con tabs Datos/Seguridad, maneja foto, nombre, teléfono, contraseña
- `ImageCropper` — cropper circular con canvas, drag + zoom slider
- `PasswordStrength` — indicadores visuales de requisitos en tiempo real
- `PasswordInput` — input de contraseña con ojito toggle
- `Login` — maneja screens: login, forgot, reset, register, registered
- `Sidebar` — muestra perfil del usuario al pie, clickeable para abrir ProfileModal

### crm-data.jsx
- `Avatar` — acepta prop `src` para mostrar foto real, sino iniciales con color

---

## Pendientes / Próximas features

1. **Google OAuth login** — cuando se habilite Google Cloud. El sistema de aprobación ya está listo.
2. **Preview PDF adjuntos** — ver PDFs inline sin descargar
3. **Nota de Pedido ↔ Presupuesto** — linkeo automático si Flexxus incluye número en campo COMENTARIO
4. **Limpiar datos hardcodeados** — quitar datos demo del código

---

## Notas importantes
- **Después de cambios al schema Prisma**: parar servidor → `npx prisma generate` → `npm run dev`
- La DB es Neon (free tier) — puede pausarse, reconecta al primer request
- El `.env` necesita: `DATABASE_URL`, `JWT_SECRET`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_HOST`, `APP_URL`
- `loadAllData()` en crm-api.jsx carga quotes, orders, clients, users, stages, activity al iniciar
- Los artículos se fetchean on-demand (no están en el contexto global)
- El importador XLS usa token en memoria (expira 30 min) entre preview y sync
- Fotos de perfil se sirven desde `/uploads/avatars/` (carpeta `uploads/` en raíz del proyecto)
