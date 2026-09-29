// Constantes de tope de intentos para Mejora — separadas de mejora.ts a propósito: ese módulo importa el
// cliente de Redis, y mejora/page.tsx (cliente) necesita estos números sin arrastrar ese import a un bundle de
// cliente. Única fuente de verdad para ambos lados (servidor y cliente) — no duplicar este valor en ningún
// otro archivo.
export const MAX_INTENTOS_EXPLICACION = 5;
export const MAX_INTENTOS_PASAJE = 3;
