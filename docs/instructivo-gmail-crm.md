# Configurar Gmail para el CRM MySelec

## Guia para vendedores

Este documento explica como configurar tu cuenta de Gmail para que el CRM MySelec pueda leer automaticamente tus solicitudes, presupuestos y notas de pedido.

---

## Como funciona

El CRM lee unicamente los mails que tengan la etiqueta **crm** en tu Gmail. Si un mail no tiene esa etiqueta, el CRM no lo ve.

Hay dos formas de que un mail tenga la etiqueta:
1. **Automatica** — con un filtro de Gmail (recomendado)
2. **Manual** — poniendo `[CRM]` en el asunto al reenviar

---

## Paso 1: Crear la etiqueta "crm"

1. Abri Gmail en el navegador
2. En la barra lateral izquierda, baja hasta el final y hace click en **"+ Crear etiqueta nueva"**
3. Escribi `crm` (todo en minuscula) y click en **Crear**

Ya tenes la etiqueta. Ahora hay que hacer que se aplique automaticamente.

---

## Paso 2: Crear filtros automaticos

Los filtros hacen que Gmail aplique la etiqueta `crm` automaticamente a los mails relevantes.

### Filtro 1 — Mails de clientes conocidos

Este filtro captura solicitudes de clientes cuyo dominio ya conoces.

1. En Gmail, click en el icono de configuracion (engranaje) → **Ver todos los ajustes**
2. Ir a la pestana **"Filtros y direcciones bloqueadas"**
3. Click en **"Crear un filtro nuevo"**
4. En el campo **"De"** poner los dominios de tus clientes separados por `OR`:
   ```
   @cliente1.com.ar OR @cliente2.com OR @cliente3.com.ar
   ```
5. Click en **"Crear filtro"**
6. Marcar: **"Aplicar la etiqueta"** → seleccionar `crm`
7. (Opcional) Marcar **"Aplicar filtro tambien a las conversaciones que coincidan"** para los mails que ya estan
8. Click en **"Crear filtro"**

### Filtro 2 — Mails con asunto [CRM]

Este filtro captura mails que vos u otros reenvian con el prefijo `[CRM]` en el asunto.

1. Crear un filtro nuevo
2. En **"Asunto"** poner: `[CRM]`
3. Crear filtro → **"Aplicar la etiqueta"** → `crm`

### Filtro 3 — Mails con PDF adjunto (opcional)

Si queres que cualquier mail con PDF adjunto entre al CRM:

1. Crear un filtro nuevo
2. En **"Contiene las palabras"** poner: `has:attachment filename:pdf`
3. Crear filtro → **"Aplicar la etiqueta"** → `crm`

> **Nota:** Este filtro es mas amplio y puede capturar PDFs que no son de clientes (facturas, publicidad, etc.). Usalo solo si la mayoria de tus PDFs son de trabajo.

---

## Paso 3: Crear la etiqueta "crm-procesado" (opcional)

El CRM marca automaticamente los mails que ya proceso con la etiqueta `crm-procesado`. Si la etiqueta no existe, la crea solo. No tenes que hacer nada, pero si queres mantener tu Gmail ordenado:

1. Crear la etiqueta `crm-procesado`
2. En la configuracion de la etiqueta, elegir **"Ocultar"** en la lista de etiquetas (asi no te molesta en la sidebar)

---

## Uso diario

### Cuando un cliente te manda un mail

Si el mail viene de un dominio que esta en tu filtro (Filtro 1), se etiqueta automaticamente. **No tenes que hacer nada.**

Si viene de un dominio nuevo que no esta en el filtro, tenes dos opciones:

- **Rapida**: Abri el mail → click derecho en la etiqueta → aplicar `crm` manualmente
- **Permanente**: Agregar el dominio al Filtro 1 para que los proximos se capturen solos

### Cuando reenviás un mail al CRM

Si te llega un mail que queres que entre al CRM pero no tiene la etiqueta automatica:

1. Reenviar el mail
2. En el asunto agregar el prefijo `[CRM]` al principio:
   ```
   [CRM] Solicitud de presupuesto - Cliente X
   ```
3. El Filtro 2 lo captura automaticamente

### Cuando enviás un presupuesto

Los mails que **vos enviás** se leen automaticamente de la carpeta Enviados. No necesitan la etiqueta `crm`. El CRM detecta el PDF de Flexxus adjunto y lo clasifica como PRESUPUESTO.

---

## Resumen

| Situacion | Que hacer |
|---|---|
| Mail de cliente conocido (filtro activo) | Nada, es automatico |
| Mail de cliente nuevo | Aplicar etiqueta `crm` manualmente, agregar dominio al filtro |
| Reenvio al CRM | Poner `[CRM]` en el asunto |
| Presupuesto que envias vos | Nada, se lee de Enviados |

---

## Problemas comunes

**El mail no aparece en el CRM**
- Verifica que tenga la etiqueta `crm` en Gmail
- Espera a la proxima sincronizacion (se ejecuta cada X horas segun la configuracion)
- Pedile al administrador que haga un sync manual desde Config → Correo

**Aparecen mails que no deberian**
- Revisa tus filtros, puede que sean demasiado amplios
- El administrador puede eliminar la cotizacion creada por error desde el CRM

**No puedo crear la etiqueta**
- Asegurate de estar en Gmail web (no en la app de celular)
- Si usas Google Workspace y no tenes permiso, pedile al administrador de IT
