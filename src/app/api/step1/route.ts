import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { problemaPrompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { findUser } from "@/lib/users";
import { peekUsage, incrementUsage } from "@/lib/usage";
import type { Problema } from "@/lib/types";

export const maxDuration = 60;

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

    const prompt = problemaPrompt(texto);
    const result = await callTool<{
      razonamientoDiagnostico: string;
      problemas: { tipo: "maestro" | "local"; enunciado: string }[];
    }>({ ...prompt, effort: "medium" });

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

    return NextResponse.json({ problemas, _debugRazonamiento: result.razonamientoDiagnostico });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
