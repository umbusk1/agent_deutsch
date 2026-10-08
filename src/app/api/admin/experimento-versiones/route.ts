import { callTool } from "@/lib/anthropic";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import {
  TIPOS_CAMBIO,
  verificarCitaConPartes,
  versionesPrompt,
  type TipoCambio,
} from "@/lib/experimento-versiones-prompts";

// Ruta temporal de diagnóstico (Prueba 2: comparación entre versiones) — NO forma parte del producto, sin
// link en ninguna navegación, sin persistencia en Redis ni en logs: el contenido de los textos no se guarda.
// Una sola llamada al modelo por request (una corrida de un control). La página lanza hasta 2 a la vez.
export const maxDuration = 300;

const CONTROLES = ["P1", "P2", "P3", "A1", "A2", "A3", "A4", "A5", "A6", "A7"];
const MAX_CARACTERES = 40000;

type RespuestaModelo = {
  tipoCambio: TipoCambio;
  citaV1: string;
  citaV2: string;
  comentario: string;
};

export async function POST(request: Request) {
  return crearRespuestaSse(request, "experimento-versiones", async (enviar) => {
    // 1. Admin primero, antes de cualquier otra cosa y antes de llamar al modelo.
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      enviar({ error: "No se pudo identificar al usuario." });
      return;
    }
    if (user.role !== "admin") {
      enviar({ error: "Solo un admin puede correr este experimento." });
      return;
    }

    // 2. Validación, sin llamar al modelo.
    const { controlId, corrida, textoV1, textoV2 } = (await request.json()) as {
      controlId: string;
      corrida: number;
      textoV1: string;
      textoV2: string;
    };
    if (!CONTROLES.includes(controlId)) {
      enviar({ error: "controlId inválido." });
      return;
    }
    if (!Number.isInteger(corrida) || corrida < 1 || corrida > 5) {
      enviar({ error: "corrida debe ser un entero de 1 a 5." });
      return;
    }
    if (
      typeof textoV1 !== "string" ||
      typeof textoV2 !== "string" ||
      !textoV1.trim() ||
      !textoV2.trim() ||
      textoV1.length > MAX_CARACTERES ||
      textoV2.length > MAX_CARACTERES
    ) {
      enviar({ error: `Cada texto debe ser no vacío y de ${MAX_CARACTERES} caracteres o menos.` });
      return;
    }

    // 3. Una llamada al modelo (sin strict:true, igual que el detector) y verificación de citas en código.
    const inicio = Date.now();
    try {
      const prompt = versionesPrompt(textoV1, textoV2);
      const result = await callTool<RespuestaModelo>(prompt);

      if (!TIPOS_CAMBIO.includes(result?.tipoCambio)) {
        throw new Error(`Respuesta fuera de esquema: tipoCambio = ${JSON.stringify(result?.tipoCambio)}`);
      }

      enviar({
        controlId,
        corrida,
        tipoCambio: result.tipoCambio,
        citaV1: verificarCitaConPartes(result.citaV1, textoV1),
        citaV2: verificarCitaConPartes(result.citaV2, textoV2),
        comentario: typeof result.comentario === "string" ? result.comentario : "",
        ms: Date.now() - inicio,
        error: null,
      });
    } catch (error) {
      // Sin reintentos automáticos: un error técnico cuenta como "no coincide".
      enviar({
        controlId,
        corrida,
        tipoCambio: null,
        citaV1: null,
        citaV2: null,
        comentario: null,
        ms: Date.now() - inicio,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
