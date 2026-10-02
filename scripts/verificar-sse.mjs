#!/usr/bin/env node
/**
 * Verifica, SIN llamar a Claude, que las salidas tempranas de las seis rutas migradas a SSE (step1b a step6)
 * efectivamente mandan su resultado DENTRO del envoltorio crearRespuestaSse — es decir, que el Content-Type
 * es text/event-stream y el cuerpo viene con framing `data: ...`, no un JSON plano por fuera del stream (el
 * bug real de producción del 2026-10-01: step6 devolvía un JSON plano de 200 cuando había menos de dos
 * explicaciones, lo que rompía callApiStream en el cliente).
 *
 * Cada ruta se golpea con un cuerpo que dispara su primera validación de entrada (texto faltante, o menos de
 * dos explicaciones en step6) — ninguno de esos caminos llega a invocar a callTool/Claude, así que este
 * script no gasta ninguna llamada real y puede correr cuantas veces haga falta.
 *
 * Requiere un servidor local corriendo (`npx next dev`) y las credenciales de un usuario válido en
 * APP_USERS, pasadas por variables de entorno (nunca como argumento, para no dejarlas en el historial de la
 * shell ni en `ps`).
 *
 * Uso:
 *   AU_USER="Moisés Ramírez" AU_PASS="..." node scripts/verificar-sse.mjs [baseUrl]
 *
 * baseUrl por defecto: http://localhost:3000
 */

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const authUser = process.env.AU_USER;
const authPass = process.env.AU_PASS;

if (!authUser || !authPass) {
  console.error("Faltan credenciales: pasa AU_USER y AU_PASS como variables de entorno (ver comentario del archivo).");
  process.exit(1);
}

const authHeader = "Basic " + Buffer.from(`${authUser}:${authPass}`, "utf-8").toString("base64");

/** Cada caso dispara la primera validación de la ruta (texto faltante, o <2 explicaciones en step6) — ninguno
 * llega a invocar a Claude. */
const casos = [
  { ruta: "step1b", body: {}, esperado: { error: "Falta el texto a analizar." } },
  { ruta: "step2", body: { problemas: [] }, esperado: { error: "Falta el texto a analizar." } },
  { ruta: "step3", body: {}, esperado: { error: "Falta el texto original." } },
  { ruta: "step4", body: {}, esperado: { error: "Falta el texto original." } },
  { ruta: "step5", body: {}, esperado: { error: "Falta el texto original." } },
  { ruta: "step6", body: { explicaciones: [] }, esperado: { relaciones: [] } },
];

function primerDataLine(sseBody) {
  for (const rawEvent of sseBody.split("\n\n")) {
    const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
    if (dataLine) return dataLine.slice(5).trim();
  }
  return null;
}

async function verificarCaso({ ruta, body, esperado }) {
  const res = await fetch(`${baseUrl}/api/${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const texto = await res.text();

  const problemas = [];
  if (!contentType.startsWith("text/event-stream")) {
    problemas.push(`Content-Type esperado "text/event-stream", vino "${contentType}"`);
  }
  const dataLine = primerDataLine(texto);
  if (!dataLine) {
    problemas.push(`no se encontró ninguna línea "data: " en el cuerpo (¿JSON plano por fuera del stream?) — cuerpo crudo: ${texto.slice(0, 200)}`);
  } else {
    let payload;
    try {
      payload = JSON.parse(dataLine);
    } catch {
      problemas.push(`la línea "data: " no es JSON válido: ${dataLine.slice(0, 200)}`);
    }
    if (payload !== undefined) {
      const payloadStr = JSON.stringify(payload);
      const esperadoStr = JSON.stringify(esperado);
      if (payloadStr !== esperadoStr) {
        problemas.push(`payload esperado ${esperadoStr}, vino ${payloadStr}`);
      }
    }
  }

  return { ruta, status: res.status, ok: problemas.length === 0, problemas };
}

const resultados = [];
for (const caso of casos) {
  resultados.push(await verificarCaso(caso));
}

let huboFallas = false;
for (const r of resultados) {
  if (r.ok) {
    console.log(`OK   ${r.ruta} (HTTP ${r.status})`);
  } else {
    huboFallas = true;
    console.log(`FAIL ${r.ruta} (HTTP ${r.status}):`);
    for (const p of r.problemas) console.log(`     - ${p}`);
  }
}

process.exit(huboFallas ? 1 : 0);
