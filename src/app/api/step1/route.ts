import { NextResponse } from "next/server";
import { callFreeform, callTool } from "@/lib/anthropic";
import { problemaRazonamientoPrompt, problemaEstructuraPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { findUser } from "@/lib/users";
import { peekUsage, incrementUsage } from "@/lib/usage";
import type { Problema } from "@/lib/types";

export const maxDuration = 90;

export async function POST(request: Request) {
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }

    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    const limited = Boolean(user && !user.unlimited && user.limit);

    if (user && limited) {
      try {
        const used = await peekUsage(user.username);
        if (used >= user.limit!) {
          return NextResponse.json(
            {
              error: `Alcanzaste tu límite de ${user.limit} análisis esta semana. El cupo se reinicia el próximo lunes.`,
            },
            { status: 429 }
          );
        }
      } catch (usageError) {
        console.error("Fallo al consultar la cuota de uso, se permite el análisis sin contar:", usageError);
      }
    }

    // Dos llamadas: primero razonamiento libre (sin tool_choice forzado, para que el modelo piense de verdad en
    // vez de tomar el atajo de relleno bajo presión de schema), luego una llamada corta que solo estructura lo
    // que el razonamiento ya aceptó.
    const razonamientoPrompt = problemaRazonamientoPrompt(texto);
    const razonamiento = await callFreeform({
      ...razonamientoPrompt,
      effort: "medium",
      timeoutMs: 40_000,
    });

    const estructuraPrompt = problemaEstructuraPrompt(razonamiento);
    const result = await callTool<{
      problemas: { tipo: "maestro" | "local"; enunciado: string }[];
    }>({ ...estructuraPrompt, effort: "medium", strict: true, timeoutMs: 40_000 });

    // A lo sumo un problema maestro: si el modelo devolvió más de uno, el primero se queda como
    // maestro y el resto baja a local, para no romper el chequeo de puente del paso siguiente
    // (que asume un único maestro de referencia).
    let maestroAsignado = false;
    const problemas: Problema[] = asArray(result.problemas)
      .filter((p) => p.enunciado?.trim() && (p.tipo === "maestro" || p.tipo === "local"))
      .map((p, i) => {
        const esMaestro = p.tipo === "maestro" && !maestroAsignado;
        if (esMaestro) maestroAsignado = true;
        return {
          id: `PR${i + 1}`,
          tipo: esMaestro ? "maestro" : "local",
          enunciado: p.enunciado.trim(),
        };
      });

    // La llamada ya se hizo (costo real) independientemente de si se encontró algún problema, así
    // que el cupo se consume igual — el paso 2 (o el rechazo) decide qué pasa después con esto.
    if (user && limited) {
      try {
        await incrementUsage(user.username);
      } catch (usageError) {
        console.error("Fallo al registrar el consumo de cuota:", usageError);
      }
    }

    return NextResponse.json({ problemas, _debugRazonamiento: razonamiento });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
