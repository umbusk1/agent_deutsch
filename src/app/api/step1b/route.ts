import { callTool } from "@/lib/anthropic";
import { step1BPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { calcularMecanismo, oracionesReconstruyenTexto, type EntradaAnalisisPorOracion } from "@/lib/despojo";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { PasajePersuasivo } from "@/lib/types";

// 230s (subido de 150, 2026-09-30): dos llamadas completas posibles (el intento original y, si algún pasaje
// no reconstruye su cita, el reintento de la llamada entera), cada una con su propio reintento interno por
// marcador mal formado — peor caso (2×50s) + (2×50s) = 200s con el timeoutMs default de callTool, sin tocar.
// 230s deja margen y queda bien por debajo de los 300s documentados en el plan Hobby con Fluid Compute.
export const maxDuration = 230;

type PasajeBruto = {
  cita: string;
  analisisPorOracion: EntradaAnalisisPorOracion[];
  tecnicas: string[];
  justificacion: string;
};

/** Separa los pasajes cuyo desglose reconstruye su propia cita de los que no — estos últimos se descartan
 * (con log, nunca en silencio) en vez de tirar todo el paso: un pasaje real del artículo perdido es mejor que
 * los demás también desaparezcan por culpa de uno solo. El conteo de descartados viaja con el resultado para
 * que el checkpoint Test y el reporte final puedan decirlo en vez de callar que algo quedó sin revisar. */
function separarPasajesValidos(pasajesBrutos: PasajeBruto[]): { validos: PasajeBruto[]; descartados: number } {
  const validos: PasajeBruto[] = [];
  let descartados = 0;
  for (const p of pasajesBrutos) {
    if (oracionesReconstruyenTexto(asArray(p.analisisPorOracion), p.cita ?? "")) {
      validos.push(p);
    } else {
      descartados += 1;
      console.error(
        `[step1b] pasaje descartado (su desglose oración por oración no reconstruye su propia cita) — cita: "${(p.cita ?? "").slice(0, 80)}..."`
      );
    }
  }
  return { validos, descartados };
}

// Streaming (Server-Sent Events) en vez de una sola respuesta al final: un artículo largo puede dejar al
// navegador sin recibir ningún byte por 30-45s+ mientras Claude procesa todo el texto, y algún intermediario
// entre el cliente y Vercel corta la conexión por inactividad aunque la función termine bien (confirmado en
// producción: "Failed to fetch" / ERR_CONNECTION_CLOSED en el navegador con 200 limpio en los logs de Vercel
// — mismo síntoma ya resuelto en step1/step7). El heartbeat de crearRespuestaSse mantiene la conexión viva
// durante la llamada larga.
//
// TODA la lógica, incluida la validación de entrada, vive DENTRO del envoltorio — ninguna salida temprana de
// esta ruta devuelve una respuesta plana por fuera de crearRespuestaSse. Confirmado en producción
// (2026-10-01, step6): una salida temprana que bypasea el envoltorio SSE rompe callApiStream del cliente
// (espera framing `data: ...`, no JSON plano) con "La conexión se cerró antes de recibir el reporte
// completo." — un error engañoso que no describe lo que realmente pasó.
export async function POST(request: Request) {
  return crearRespuestaSse(request, "step1b", async (enviar) => {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      enviar({ error: "Falta el texto a analizar." });
      return;
    }

    const prompt = step1BPrompt(texto);
    // strict:true (con additionalProperties:false en cada nivel del schema, ver step1BPrompt en prompts.ts):
    // mismo shape que mejoraDespojoPasajePrompt, ya validado — analisisPorOracion es exactamente el campo que
    // necesita forzarse para que "required" se aplique de verdad. maxTokens explícito (el default de callTool
    // es 4096) por el mismo motivo del comentario de arriba: el desglose por oración de varios pasajes puede
    // superar el default en un artículo con varios pasajes largos.
    let result = await callTool<{ pasajes: PasajeBruto[] }>({ ...prompt, strict: true, maxTokens: 8192 });
    let { validos: pasajesBrutosValidos, descartados: pasajesDescartados } = separarPasajesValidos(
      asArray(result.pasajes)
    );

    if (pasajesDescartados > 0) {
      console.error(
        `[step1b] ${pasajesDescartados} pasaje(s) con desglose inválido en el primer intento — reintentando la llamada completa una vez.`
      );
      result = await callTool<{ pasajes: PasajeBruto[] }>({ ...prompt, strict: true, maxTokens: 8192 });
      ({ validos: pasajesBrutosValidos, descartados: pasajesDescartados } = separarPasajesValidos(
        asArray(result.pasajes)
      ));
      // Nota: pasajesDescartados acá refleja solo el segundo intento — si algo que falló en el primero se
      // corrigió solo, no cuenta; si algo distinto falla en el segundo, sí. Es el conteo final, no acumulado.
    }

    // El mecanismo NUNCA lo decide el modelo directamente — se calcula acá, a partir del desglose oración por
    // oración que sí tuvo que hacer (ver calcularMecanismo en despojo.ts, mismo helper que ya usa Mejora-pasaje).
    const pasajesPersuasivos: PasajePersuasivo[] = pasajesBrutosValidos
      .filter((p) => p.cita?.trim())
      .map((p, i) => {
        const analisisPorOracion = asArray(p.analisisPorOracion);
        return {
          id: `M${i + 1}`,
          cita: p.cita.trim(),
          mecanismo: calcularMecanismo(analisisPorOracion),
          analisisPorOracion,
          tecnicas: asArray(p.tecnicas).filter((t) => t?.trim()),
          justificacion: p.justificacion?.trim() ?? "",
        };
      });

    enviar({ pasajesPersuasivos, pasajesDescartados });
  });
}
