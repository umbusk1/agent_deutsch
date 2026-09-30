import { NextResponse, after } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step1BPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { calcularMecanismo, oracionesReconstruyenTexto, type EntradaAnalisisPorOracion } from "@/lib/despojo";
import { registrarDuracion } from "@/lib/step-timings";
import type { PasajePersuasivo } from "@/lib/types";

// 150s: una sola llamada para TODO el artículo (a diferencia de Mejora-pasaje, que aísla un fragmento por
// llamada) — cada pasaje ahora trae su propio desglose oración por oración, lo que aumenta el volumen de
// salida frente a la versión anterior (mecanismo autoreportado, sin desglose): más pasajes o pasajes más
// largos ya no son solo 4 campos por uno, son 4 campos + un array de oraciones por uno. callTool ya reintenta
// internamente una vez si detecta un marcador de tool-call mal formado (ver anthropic.ts); esta ruta agrega
// su PROPIO reintento (una sola vez, de la llamada completa) si el desglose de algún pasaje no reconstruye su
// propia cita — y si tras ese reintento algún pasaje SIGUE sin reconstruir, se excluye solo ese pasaje (con
// log) en vez de perder el paso entero: ver separarPasajesValidos.
export const maxDuration = 150;

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

export async function POST(request: Request) {
  const inicio = Date.now();
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
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

    return NextResponse.json({ pasajesPersuasivos, pasajesDescartados });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  } finally {
    // after() (no `void registrarDuracion(...)` fire-and-forget, como estaba antes — eso perdía escrituras
    // porque nada garantizaba que el runtime siguiera vivo hasta que la promesa terminara) extiende la vida
    // de la invocación vía waitUntil hasta que esto se resuelva, aunque la respuesta ya se haya mandado.
    after(() => registrarDuracion("step1b", Date.now() - inicio));
  }
}
