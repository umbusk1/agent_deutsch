# Agente Deutsch

Herramienta que recibe un texto de opinión (artículo, ensayo) y produce un análisis crítico de la calidad de sus argumentos explicativos, guiando al usuario paso a paso por siete etapas de razonamiento.

## Estado

En diseño / construcción inicial.

## Stack

- Next.js (App Router) + TypeScript, desplegado en Vercel
- API de Anthropic (Claude Sonnet 5) como motor de razonamiento
- Sin base de datos: el estado de un análisis vive en el navegador durante la sesión
- Protección de acceso mediante HTTP Basic Auth
