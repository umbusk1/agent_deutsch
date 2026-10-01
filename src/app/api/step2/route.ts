import { callTool } from "@/lib/anthropic";
import { explicacionPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { crearRespuestaSse } from "@/lib/sse-stream";
import type { Explicacion, Descartada, Problema } from "@/lib/types";

// 220s (subido de 120, 2026-09-30): dato real de /api/step-timings, un solo intento tardó 40,8s en un
// artículo largo (2245 palabras) — 82% del timeoutMs por defecto de callTool (50s). timeoutMs se sube acá a
// 90s (~2,2x ese dato real, margen para un artículo más largo todavía) y maxDuration tiene que cubrir el
// peor caso con el reintento por marcador mal formado ya incluido: 2×90s = 180s. 220s deja margen y queda
// bien por debajo de los 300s documentados en el plan Hobby con Fluid Compute.
export const maxDuration = 220;

// Streaming (Server-Sent Events) en vez de una sola respuesta al final: confirmado en producción con un
// artículo largo real (40,8s de duración real en /api/step-timings) — "Failed to fetch" / ERR_CONNECTION_CLOSED
// en el navegador con un 200 limpio en los logs de Vercel, el mismo síntoma ya resuelto en step1/step7. El
// heartbeat de crearRespuestaSse mantiene la conexión viva durante la llamada larga.
//
// TODA la lógica, incluida la validación de entrada, vive DENTRO del envoltorio — ver el mismo comentario en
// step1b/route.ts para el motivo (confirmado en producción con step6: una salida temprana por fuera de
// crearRespuestaSse rompe callApiStream del cliente con un error engañoso).
export async function POST(request: Request) {
  return crearRespuestaSse(request, "step2", async (enviar) => {
    const { texto, problemas } = (await request.json()) as { texto: string; problemas: Problema[] };
    if (!texto || !texto.trim()) {
      enviar({ error: "Falta el texto a analizar." });
      return;
    }
    if (!problemas?.length) {
      enviar({ error: "No hay problemas activos (¿se excluyeron todos en el paso anterior?)." });
      return;
    }

    const prompt = explicacionPrompt(texto, problemas);
    const result = await callTool<{
      candidatas: {
        problemaId: string;
        cita: string;
        resumen: string;
        mecanismoGeneral: string;
        puente: { laguna: boolean; justificacion: string };
        imagenCentral?: { presente: boolean; imagen: string | null; connotacionAñadida: string | null };
        premisaValorOculta?: { presente: boolean; justificacion: string | null };
      }[];
      descartadas: Descartada[];
    }>({ ...prompt, effort: "medium", timeoutMs: 90_000 });

    const explicaciones: Explicacion[] = asArray(result.candidatas)
      .filter(
        (c) =>
          c.cita?.trim() &&
          c.resumen?.trim() &&
          c.mecanismoGeneral?.trim() &&
          problemas.some((p) => p.id === c.problemaId)
      )
      .map((c, i) => ({
        id: `E${i + 1}`,
        problemaId: c.problemaId,
        cita: c.cita.trim(),
        resumen: c.resumen.trim(),
        mecanismoGeneral: c.mecanismoGeneral.trim(),
        puente: {
          laguna: Boolean(c.puente?.laguna),
          justificacion: c.puente?.justificacion?.trim() ?? "",
        },
        // Sin strict:true, "required" no se aplica de verdad — si el modelo omite el campo, asumimos
        // "no presente" en vez de dejarlo sin marcar.
        imagenCentral: {
          presente: Boolean(c.imagenCentral?.presente),
          imagen: c.imagenCentral?.presente ? (c.imagenCentral?.imagen?.trim() ?? null) : null,
          connotacionAñadida: c.imagenCentral?.presente ? (c.imagenCentral?.connotacionAñadida?.trim() ?? null) : null,
        },
        premisaValorOculta: {
          presente: Boolean(c.premisaValorOculta?.presente),
          justificacion: c.premisaValorOculta?.presente ? (c.premisaValorOculta?.justificacion?.trim() ?? null) : null,
        },
      }));

    const descartadas = asArray(result.descartadas).filter((d) => d.cita?.trim() && d.motivo?.trim());

    enviar({ explicaciones, descartadas });
  });
}
