import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { step1Prompt } from "@/lib/prompts";
import { asArray } from "@/lib/safe-array";
import { findUser } from "@/lib/users";
import { peekUsage, incrementUsage } from "@/lib/usage";
import type { Explicacion, Descartada } from "@/lib/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { texto } = (await request.json()) as { texto: string };
    if (!texto || !texto.trim()) {
      return NextResponse.json({ error: "Falta el texto a analizar." }, { status: 400 });
    }

    const username = request.headers.get("x-au-user");
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

    const prompt = step1Prompt(texto);
    // TEMPORAL: revertido a "low" para una corrida de prueba aislada, para distinguir si subir a "medium"
    // (commit e8dca9c) fue lo que hizo que el Paso 3 dejara de encontrar sustitutos genuinos en "Así no,
    // Mister Trump" (6/6 en vez de 1/6). Revertir a "medium" (o decidir el valor final) una vez confirmado.
    const result = await callTool<{
      candidatas: { cita: string; resumen: string }[];
      descartadas: Descartada[];
    }>({ ...prompt, effort: "low" });

    const explicaciones: Explicacion[] = asArray(result.candidatas)
      .filter((c) => c.cita?.trim() && c.resumen?.trim())
      .map((c, i) => ({
        id: `E${i + 1}`,
        cita: c.cita.trim(),
        resumen: c.resumen.trim(),
      }));

    const descartadas = asArray(result.descartadas).filter((d) => d.cita?.trim() && d.motivo?.trim());

    if (user && limited) {
      try {
        await incrementUsage(user.username);
      } catch (usageError) {
        console.error("Fallo al registrar el consumo de cuota:", usageError);
      }
    }

    return NextResponse.json({ explicaciones, descartadas });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido." },
      { status: 500 }
    );
  }
}
