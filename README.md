# Agente Deutsch

Herramienta que recibe un texto de opinión (artículo, ensayo) y produce un análisis crítico de la calidad de sus argumentos explicativos, guiando al usuario paso a paso por siete etapas de razonamiento.

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
```

**Nota sobre los nombres de Upstash:** la integración de Redis desde el Marketplace de Vercel no siempre crea variables llamadas exactamente `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` — a veces las prefija con el nombre que le diste al store (ej. `UPSTASH_REDIS_REST_KV_REST_API_URL` / `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`). Revisa cuáles aparecen realmente en Settings → Environment Variables de tu proyecto. El código (`src/lib/usage.ts`) acepta ambas variantes automáticamente — usa siempre el par `*_REST_API_URL` / `*_REST_API_TOKEN` (lectura y escritura), **no** el que dice `READ_ONLY_TOKEN`, y **no** las que terminan en `_URL` a secas o `_REDIS_URL` (esas son para conexión directa por TCP, no para la API REST que usa este proyecto).

`APP_USERS` es un array JSON en una sola línea:

```json
[
  { "username": "moises", "password": "...", "unlimited": true },
  { "username": "amigo1", "password": "...", "limit": 2 },
  { "username": "amigo2", "password": "...", "limit": 2 }
]
```

- `unlimited: true` → sin restricción de cuota.
- `limit: N` → máximo N análisis por semana (semana de lunes a lunes, UTC). El cupo se consume al iniciar el Paso 1 (no al terminar el reporte), para reflejar el gasto real de API incluso si el análisis se abandona a mitad de camino.

## Desarrollo local

```
npm install
npm run dev
```

Abre http://localhost:3000 — el navegador pedirá usuario/contraseña (usa cualquier par definido en `APP_USERS`).

## Desplegar en Vercel

1. Importa el repositorio `agent_deutsch` en Vercel.
2. En la pestaña **Storage** del proyecto, agrega una integración de Redis (Upstash) desde el Marketplace — esto define automáticamente las variables REST (ver nota arriba sobre el nombre exacto que puede tomar).
3. Define `ANTHROPIC_API_KEY` y `APP_USERS` como variables de entorno del proyecto.
4. Despliega. Cada una de las 7 rutas de `/api/step*` ya declara `maxDuration` para evitar cortes por tiempo límite; si tu plan de Vercel permite un máximo distinto, ajústalo en cada `route.ts`.

## Modo "En construcción"

Para poner el sitio completo en pausa (sin borrar ni modificar ninguna ruta), define `MAINTENANCE_MODE=true` como variable de entorno del proyecto en Vercel y redepliega. `src/proxy.ts` intercepta entonces cualquier petición — páginas y `/api/step*` incluidos — y responde con una página estática "En construcción" (HTTP 503) antes de llegar al resto del código. Para reactivar el sitio, quita la variable (o ponla en cualquier valor distinto de `"true"`) y redespliega.

## Notas para quien siga trabajando este código (o para un agente de IA)

Este proyecto usa **Next.js 16**, que renombró `middleware.ts` a `proxy.ts` (ver `src/proxy.ts`) y tiene otros cambios respecto a versiones anteriores. Antes de asumir convenciones de versiones previas de Next.js, revisa `node_modules/next/dist/docs/` o `AGENTS.md`.
