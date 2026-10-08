// Tope de versiones por texto (la versión 1 cuenta). Separado de versiones.ts a propósito, igual que
// mejora-limites.ts: ese módulo importa el cliente de Redis y las páginas de cliente necesitan este número
// sin arrastrar ese import a su bundle. Única fuente de verdad para servidor y cliente.
export const MAX_VERSIONES = 5;
