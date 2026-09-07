# Agente Deutsch

Herramienta que recibe un texto de opinión (artículo, ensayo) y produce un análisis crítico de la calidad de sus argumentos explicativos, guiando al usuario paso a paso por siete etapas de razonamiento.

## Stack

- Next.js 16 (App Router) + TypeScript, desplegado en Vercel
- API de Anthropic (Claude Sonnet 5) como motor de razonamiento
- Sin base de datos: el estado de un análisis vive en el navegador durante la sesión; al terminar se descargan `reporte.md` y `tripletas.txt`
- Protección de acceso mediante HTTP Basic Auth (una sola contraseña compartida, no hay sistema de usuarios)

## Variables de entorno

Copia `.env.local.example` a `.env.local` y complétalo:

```
ANTHROPIC_API_KEY=  # tu API key de Anthropic (configura un límite de gasto en la consola)
APP_PASSWORD=       # la contraseña única para acceder a la app (usuario vacío)
```

## Desarrollo local

```
npm install
npm run dev
```

Abre http://localhost:3000 — el navegador pedirá usuario/contraseña (deja el usuario vacío, usa `APP_PASSWORD`).

## Desplegar en Vercel

1. Importa el repositorio `agent_deutsch` en Vercel.
2. Define `ANTHROPIC_API_KEY` y `APP_PASSWORD` como variables de entorno del proyecto.
3. Despliega. Cada una de las 7 rutas de `/api/step*` ya declara `maxDuration` para evitar cortes por tiempo límite; si tu plan de Vercel permite un máximo distinto, ajústalo en cada `route.ts`.

## Notas para quien siga trabajando este código (o para un agente de IA)

Este proyecto usa **Next.js 16**, que renombró `middleware.ts` a `proxy.ts` (ver `src/proxy.ts`) y tiene otros cambios respecto a versiones anteriores. Antes de asumir convenciones de versiones previas de Next.js, revisa `node_modules/next/dist/docs/` o `AGENTS.md`.
