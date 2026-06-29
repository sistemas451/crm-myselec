---
name: feedback-preferences
description: Preferencias de trabajo y correcciones del usuario
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 67fcea86-6567-4e8a-9e56-563865c95dac
---

## No hacer cambios sin confirmar primero en temas de deploy/DB
No aplicar cambios a producción (Railway, Neon) sin que el usuario diga explícitamente "hacelo". Siempre armar el plan y esperar confirmación.

**Why:** El usuario dijo "no hagas nada decime si me entendiste" antes de sincronizar repos — quiere entender el plan antes de que se ejecute algo.

**How to apply:** Antes de cualquier push, migración de DB, o cambio en Railway, presentar el plan y esperar "sí" explícito.

## Commits solo a bruscofacundo1 para el contexto personal
La memoria y archivos de contexto van al repo de bruscofacundo1 (origin), no al de sistemas451 (myselec).

**Why:** El repo de sistemas451 es el repo de la empresa. El de bruscofacundo1 es el personal/dev donde el usuario lleva el contexto de trabajo con Claude.

## Respuestas concisas y directas
El usuario no necesita que se expliquen pasos obvios. Ir al grano.

## Español rioplatense en todo momento
Siempre responder en español argentino. Usar "vos", "dale", "andá", etc.
