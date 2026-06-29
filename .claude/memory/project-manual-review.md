---
name: project-manual-review
description: Revisión de los 4 manuales PDF en D:\crm-documentacion — gaps encontrados por manual
metadata: 
  node_type: memory
  type: project
  originSessionId: 67fcea86-6567-4e8a-9e56-563865c95dac
---

Revisión realizada el 2026-06-29. Los PDFs están en D:\crm-documentacion\.

**Why:** El usuario quiere que quienes lean los manuales entiendan el CRM completamente.

## Manual 01 — Primeros Pasos
- **CRÍTICO**: Placeholder `[LINK DEL DRIVE]` nunca fue reemplazado con el link real de Google Drive
- No menciona el rol DEVELOPER (el sistema tiene 4 roles)
- El "Manual de Configuración de Gmail" referenciado no está en la carpeta

## Manual 02 — Administrador (35 páginas)
Gaps detectados:
- Rol DEVELOPER no aparece en sección 8.4 (solo 3 roles documentados)
- Sistema bimonetario USD/ARS no explicado en ninguna parte
- Exportación PDF (ExportModal) no documentada
- Vistas "Mis Ventas" y "Comparativa" no documentadas
- Tab "Registros" (login logs) en Config: aparece en el índice (9.7) pero sin contenido
- Tab "Acceso" en Config solo mencionado en Apéndice E.4, no en sección 9
- "Draft/Borrador" en glosario pero no explicado en el cuerpo del manual
- Foro/feedback: no documentado (si es visible en el sidebar del admin)
- Apéndice E.1 lista campos DNI/CUIT en el registro — verificar si realmente están en el formulario

## Manual 03 — Vendedor (19 páginas)
Gaps detectados:
- Selector de moneda (USD/ARS) al crear nueva cotización no mencionado
- Botón "Enviar email" desde detalle de cotización no documentado
- Botón "Recordar" (send-reminder) no documentado
- Vista "Mis Ventas" no mencionada

## Manual 04 — Logística (14 páginas)
- Casi completo para su alcance
- Falta explicar CÓMO se ingresa la fecha estimada de entrega (referenciada en KPIs pero sin instrucción)
- Doble indicador naranja (días en etapa vs. sin guía) podría ser más explícito
- Sección 1.3 no menciona cierre de sesión en otros dispositivos al cambiar contraseña

## How to apply
Cuando el usuario pregunte sobre los manuales, recordar estos gaps. Si pide actualizar algún manual, priorizar: link de Drive, bimonetario, botón enviar email, botón recordar, tab Registros.
