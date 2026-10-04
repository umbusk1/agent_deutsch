import { callTool } from "@/lib/anthropic";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { detectorPrompt } from "@/lib/experimento-detector-prompts";

// Ruta temporal de diagnóstico (ver diagnostico/umbrales-detector.txt) — NO forma parte del producto, sin link
// en ninguna navegación, sin persistencia en Redis. Una sola llamada por corrida (más liviana que A/A+ del
// experimento de umbrales), así que N=5 corridas con concurrencia 3 corre cómodo muy por debajo del techo.
export const maxDuration = 300;

type ValorSenial = "si" | "no" | "indeterminado";
type Senial = { valor: ValorSenial; cita: string };

const CLAVES_SENIALES = [
  "s1FormulacionEnDisputa",
  "s2HechosYValores",
  "s3SinCriterioDeCierre",
  "s4MejorPeorNoVerdaderoFalso",
  "s5MarcosIncompatibles",
] as const;
type ClaveSenial = (typeof CLAVES_SENIALES)[number];

type SenialVerificada = {
  valorReportado: ValorSenial;
  cita: string;
  citaValida: boolean;
  valorFinal: ValorSenial;
};

// Sin distinguir mayúsculas, espacios extra, variantes Unicode de un mismo carácter (NFKC), comillas rectas
// vs. curvas, rayas (guion/en dash/em dash) ni puntos suspensivos sueltos vs. el carácter unicode "…" — todas
// formas en que una cita real puede diferir del texto por cómo la tipeó o la pegó el modelo, sin que eso
// signifique que la cita es inventada. Enmienda 2026-10-04 (ver diagnostico/umbrales-detector.txt).
function normalizar(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function verificarCita(texto: string, cita: string): boolean {
  if (!cita?.trim()) return false;
  return normalizar(texto).includes(normalizar(cita));
}

// Regla de decisión completa — la calcula el código, nunca el modelo (criterio, sección 4):
// "Primero se verifica que cada cita aparezca en el texto... Si no aparece, la señal vale 'no' y se anota.
// Veredicto 'perverso' si S1=si y S3=si y al menos una de S2,S4,S5=si. En otro caso, 'acotado'.
// 'Indeterminado' cuenta como 'no'."
function verificarSenial(texto: string, senial: Senial): SenialVerificada {
  const citaValida = verificarCita(texto, senial.cita);
  return {
    valorReportado: senial.valor,
    cita: senial.cita,
    citaValida,
    valorFinal: citaValida ? senial.valor : "no",
  };
}

function esSi(valorFinal: ValorSenial): boolean {
  return valorFinal === "si"; // "indeterminado" cuenta como "no" acá, no solo en la verificación de citas.
}

function calcularVeredicto(seniales: Record<ClaveSenial, SenialVerificada>): "perverso" | "acotado" {
  const s1 = esSi(seniales.s1FormulacionEnDisputa.valorFinal);
  const s3 = esSi(seniales.s3SinCriterioDeCierre.valorFinal);
  const algunaS2S4S5 =
    esSi(seniales.s2HechosYValores.valorFinal) ||
    esSi(seniales.s4MejorPeorNoVerdaderoFalso.valorFinal) ||
    esSi(seniales.s5MarcosIncompatibles.valorFinal);
  return s1 && s3 && algunaS2S4S5 ? "perverso" : "acotado";
}

// Límite de concurrencia simple (cola + contador) — mismo patrón que experimento-umbrales.
function crearLimitador(maxConcurrencia: number) {
  let enVuelo = 0;
  const cola: (() => void)[] = [];
  return async function limitar<T>(fn: () => Promise<T>): Promise<T> {
    if (enVuelo >= maxConcurrencia) {
      await new Promise<void>((resolve) => cola.push(resolve));
    }
    enVuelo++;
    try {
      return await fn();
    } finally {
      enVuelo--;
      cola.shift()?.();
    }
  };
}

async function corridaDetector(texto: string, enunciado: string) {
  const prompt = detectorPrompt(texto, enunciado);
  // Sin strict:true a propósito — el experimento de umbrales tampoco lo usa, y strict ya colgó el Paso 1 en
  // producción alguna vez. Sin eso, "required" del schema no se fuerza de verdad (ver el TODO de anthropic.ts),
  // así que la verificación de citas en código de abajo es la única garantía real de que cada señal vino con
  // una cita, no una excusa de más.
  const result = await callTool<Record<ClaveSenial, Senial> & { tipoFormulacion: "explicacion" | "meta" | "pronostico" }>(
    prompt
  );

  const seniales = {} as Record<ClaveSenial, SenialVerificada>;
  for (const clave of CLAVES_SENIALES) {
    seniales[clave] = verificarSenial(texto, result[clave]);
  }

  return {
    veredicto: calcularVeredicto(seniales),
    tipoFormulacion: result.tipoFormulacion,
    seniales,
  };
}

export async function POST(request: Request) {
  return crearRespuestaSse(request, "experimento-detector", async (enviar) => {
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

    const { controlId, texto, enunciado, corridas } = (await request.json()) as {
      controlId: string;
      texto: string;
      enunciado: string;
      corridas: number;
    };
    if (!controlId?.trim() || !texto?.trim() || !enunciado?.trim() || !corridas) {
      enviar({ error: "Faltan controlId, texto, enunciado o corridas." });
      return;
    }

    const limitar = crearLimitador(3);
    const tareas: Promise<void>[] = [];

    for (let corrida = 1; corrida <= corridas; corrida++) {
      tareas.push(
        limitar(async () => {
          const inicio = Date.now();
          try {
            const r = await corridaDetector(texto, enunciado);
            enviar({
              controlId,
              corrida,
              veredicto: r.veredicto,
              detalle: { tipoFormulacion: r.tipoFormulacion, seniales: r.seniales },
              ms: Date.now() - inicio,
            });
          } catch (error) {
            enviar({
              controlId,
              corrida,
              veredicto: null,
              detalle: null,
              ms: Date.now() - inicio,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );
    }

    await Promise.all(tareas);
  });
}
