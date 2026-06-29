---
name: project-overview
description: "Stack, deploy, arquitectura y roles del CRM MySelec"
metadata: 
  node_type: memory
  type: project
  originSessionId: 67fcea86-6567-4e8a-9e56-563865c95dac
---

## Stack
- Node.js + Express + Prisma + PostgreSQL (Neon)
- Frontend: React sin build, Babel Standalone en browser, archivos .jsx en /public
- No ES modules — los archivos se comunican via Object.assign(window, {...})
- Railway deploy, Neon DB producción

## Repos
- `myselec` (origin en myselec PC) → https://github.com/sistemas451/crm-myselec.git (repo principal)
- `origin` (en la PC del dev) → https://github.com/bruscofacundo1/crm-gerenciando-canales.git (repo personal backup/dev)
- Ambos están sincronizados al mismo estado

## Roles (4 roles, de mayor a menor)
1. **DEVELOPER** — por encima de ADMIN, puede desactivar al último admin
2. **ADMIN** — gestión completa
3. **VENDEDOR** — sus propias cotizaciones + OCs
4. **LOGISTICA** — solo vista del tablero de OCs (read-only mutación)

**Why:** La guardia de "último admin" fue corregida para contar ADMIN+DEVELOPER juntos, evitando que se bloquee la cuenta si hay un DEVELOPER activo. Commit 869fdd8.

## Deploy
- Railway (bloquea SMTP saliente) → usar Gmail API o Resend para emails
- Build script: `npx prisma generate && npx prisma db push --accept-data-loss`
- Región Railway: no hay Sao Paulo disponible — se mantiene la región actual
- Neon DB: Sao Paulo — se deja así (latencia aceptable)

## Flujo comercial
- **Fase 1** (cotizaciones): SOLICITUD → PRESUPUESTO → aceptada/rechazada
- **Fase 2** (órdenes): OC interna + OC del cliente, o NP (Nota de Pedido)
- **Nota de Pedido**: bridge entre F1 y F2. Puede venir por mail (Quote mailType='NOTA_PEDIDO') o crearse manual. Ambas muestran layout tipo Presupuesto con tabla de ítems parseados.

## Pattern F2
- Orders manuales (`_source: 'ORDER'`)
- Quote mailType='NOTA_PEDIDO' (`_source: 'QUOTE'`)
- GET /api/orders devuelve ambos mergeados con discriminador _source

## Sistema bimonetario
- Quote.currency: "USD" | "ARS" (default USD)
- Dashboard KPIs separados por moneda
- fmtMoney(n, cur, dec) en frontend — nunca strings hardcodeados de moneda
