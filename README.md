# Agente Deutsch

Herramienta que recibe un texto de opinión (artículo, ensayo) y produce un análisis crítico de la calidad de sus argumentos explicativos, guiando al usuario paso a paso por el pipeline.

## Pipeline

El orden es deliberado: primero se detecta el **problema** (el conflicto o tensión que plantea el texto), y solo después se busca si el texto ofrece una **explicación** genuina para ese problema — nunca al revés. Buscar explicaciones antes de tener un problema independiente pierde sistemáticamente dos cosas: el problema que organiza a los demás cuando viene planteado como principio metodológico en vez de mecanismo causal explícito, y los problemas que el propio autor deja sin explicar a propósito.

1. **Problema** (`/api/step1`) — detecta el problema maestro (si lo hay, a lo sumo uno) y los problemas locales del texto, sin mirar ninguna explicación todavía. Si no encuentra ningún conflicto genuino, el pipeline se detiene ahí (ver "Compuerta de rechazo" abajo).
2. **Explicación** (`/api/step2`) — busca, para cada problema activo, si el texto ofrece una explicación genuina. Incluye el **chequeo de puente**: si una explicación resuelve un problema local sin argumentar cómo se conecta con el problema maestro (lo asume, no lo explica), se marca como una laguna propia (`puente.laguna`), distinta de "fácil de variar" o "sin sustituto genuino".
3. **Persuasión** (`/api/step1b`) — rama independiente y paralela; nunca alimenta el veredicto, solo el reporte final.
4. **Variantes** (`/api/step3`) → **Veredictos** (`/api/step4`) → **Preguntas nuevas / Alcance** (`/api/step5`) → **Relaciones** (`/api/step6`) → **Reporte** (`/api/step7`) — sin cambios de fondo respecto al criterio "difícil de variar" ya existente.

Los problemas detectados en el Paso 1 que no llegan a tener ninguna explicación en el Paso 2 no se descartan: se mencionan en el reporte final como preguntas que el texto deja abiertas.

## Compuerta de rechazo temprano

Si el Paso 1 no encuentra ningún problema genuino, el análisis se detiene: no hay Paso 2, no hay reporte, no se guarda nada. Al usuario se le muestra un mensaje fijo con un campo de apelación ("¿Por qué crees que sí hay material analizable aquí?"). La llamada a Claude ya ocurrió (costo real), así que **el cupo semanal se consume igual que en un análisis completo**.

Al enviar la apelación (`/api/apelar`), se envía un correo (Resend) a `ADMIN_EMAIL` con el nombre de quien apela, su justificación, el texto completo rechazado (no se persiste en ningún otro lado), y un enlace de restauración firmado con HMAC (`RESTORE_LINK_SECRET`) que codifica usuario + semana exacta (no solo el nombre, porque el cupo expira por semana en Redis). Al hacer clic en ese enlace (`/api/restaurar`), se restaura 1 uso para esa persona/semana (protegido contra doble clic) y, si el usuario tiene `email` configurado en `APP_USERS`, se le notifica por correo que se le restauró.

## Stack

- Next.js 16 (App Router) + TypeScript, desplegado en Vercel
- API de Anthropic (Claude Sonnet 5) como motor de razonamiento
- Sin base de datos relacional: el estado de un análisis vive en el navegador durante la sesión; al terminar se descargan `reporte.md` y `tripletas.txt`. Solo el contador de cuota semanal por usuario se guarda en Redis (Upstash), porque es el único dato que debe sobrevivir entre sesiones.
- Protección de acceso mediante HTTP Basic Auth **por usuario** (usuario + contraseña definidos en `APP_USERS`), cada uno con su propio límite semanal de análisis (o sin límite).

## Variables de entorno

Copia `.env.local.example` a `.env.local` y complétalo:

```
ANTHROPIC_API_KEY=       # tu API key de Anthropic (configura un límite de gasto en la consola)
APP_USERS=               # JSON con la lista de usuarios, ver formato abajo
UPSTASH_REDIS_REST_URL=  # URL y token REST de Upstash (ver nota abajo sobre el nombre exacto)
UPSTASH_REDIS_REST_TOKEN=
RESEND_API_KEY=          # llave de Resend, permiso "Sending access" restringido al dominio verificado
ADMIN_EMAIL=              # opcional, default moises@umbusk.com — a dónde llegan las apelaciones
RESEND_FROM=              # opcional, default apelaciones@deutsch.umbusk.com — remitente verificado
RESTORE_LINK_SECRET=     # secreto para firmar los enlaces de restauración de cupo (openssl rand -hex 32)
```

**Nota sobre los nombres de Upstash:** la integración de Redis desde el Marketplace de Vercel no siempre crea variables llamadas exactamente `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` — a veces las prefija con el nombre que le diste al store (ej. `UPSTASH_REDIS_REST_KV_REST_API_URL` / `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`). Revisa cuáles aparecen realmente en Settings → Environment Variables de tu proyecto. El código (`src/lib/usage.ts`) acepta ambas variantes automáticamente — usa siempre el par `*_REST_API_URL` / `*_REST_API_TOKEN` (lectura y escritura), **no** el que dice `READ_ONLY_TOKEN`, y **no** las que terminan en `_URL` a secas o `_REDIS_URL` (esas son para conexión directa por TCP, no para la API REST que usa este proyecto).

`APP_USERS` es un array JSON en una sola línea:

```json
[
  { "username": "moises", "password": "...", "unlimited": true, "fullName": "Moisés Ramírez", "email": "moises@umbusk.com" },
  { "username": "amigo1", "password": "...", "limit": 2, "fullName": "Juan Smith" },
  { "username": "amigo2", "password": "...", "limit": 2, "fullName": "Diógenes Infante" }
]
```

- `unlimited: true` → sin restricción de cuota.
- `limit: N` → máximo N análisis por semana (semana de lunes a lunes, UTC). El cupo se consume al iniciar el Paso 1 (no al terminar el reporte), para reflejar el gasto real de API incluso si el análisis se abandona a mitad de camino (incluido el caso en que el Paso 1 rechaza el texto por no tener ningún problema — ver "Compuerta de rechazo" abajo).
- `fullName` → nombre y apellido completos; se usa para identificar a quien apela un rechazo en el correo que recibe el administrador.
- `email` → opcional; si está presente, se le notifica por correo cuando se le restaura una apelación aceptada. Si se omite, la restauración funciona igual, solo que sin ese aviso.

## Desarrollo local

```
npm install
npm run dev
```

Abre http://localhost:3000 — el navegador pedirá usuario/contraseña (usa cualquier par definido en `APP_USERS`).

## Desplegar en Vercel

1. Importa el repositorio `agent_deutsch` en Vercel.
2. En la pestaña **Storage** del proyecto, agrega una integración de Redis (Upstash) desde el Marketplace — esto define automáticamente las variables REST (ver nota arriba sobre el nombre exacto que puede tomar).
3. Define `ANTHROPIC_API_KEY`, `APP_USERS`, `RESEND_API_KEY` y `RESTORE_LINK_SECRET` como variables de entorno del proyecto (`ADMIN_EMAIL` y `RESEND_FROM` son opcionales, ver arriba).
4. Despliega. Cada una de las rutas de `/api/step*` ya declara `maxDuration` para evitar cortes por tiempo límite; si tu plan de Vercel permite un máximo distinto, ajústalo en cada `route.ts`.

## Modo "En construcción"

Para poner el sitio completo en pausa (sin borrar ni modificar ninguna ruta), define `MAINTENANCE_MODE=true` como variable de entorno del proyecto en Vercel y redepliega. `src/proxy.ts` intercepta entonces cualquier petición — páginas y `/api/step*` incluidos — y responde con una página estática "En construcción" (HTTP 503) antes de llegar al resto del código. Para reactivar el sitio, quita la variable (o ponla en cualquier valor distinto de `"true"`) y redespliega.

## Notas para quien siga trabajando este código (o para un agente de IA)

Este proyecto usa **Next.js 16**, que renombró `middleware.ts` a `proxy.ts` (ver `src/proxy.ts`) y tiene otros cambios respecto a versiones anteriores. Antes de asumir convenciones de versiones previas de Next.js, revisa `node_modules/next/dist/docs/` o `AGENTS.md`.
