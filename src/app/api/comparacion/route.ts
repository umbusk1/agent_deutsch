import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { comparacionPrompt } from "@/lib/prompts";
import { obtenerAnalisis } from "@/lib/analisis";
import { guardarComparacion } from "@/lib/comparaciones";
import { findUser } from "@/lib/users";
import { currentWeekId, incrementUsage, peekUsage, COMPARACION_LIMIT_SEMANAL } from "@/lib/usage";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const rawUsername = request.headers.get("x-au-user");
    const username = rawUsername ? decodeURIComponent(rawUsername) : null;
    const user = username ? findUser(username) : undefined;
    if (!user) {
      return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
    }

    const isAdmin = user.role === "admin";
    if (!isAdmin) {
      const used = await peekUsage(user.username, currentWeekId(), "comparacion");
      if (used >= COMPARACION_LIMIT_SEMANAL) {
        return NextResponse.json(
          {
            error: `Alcanzaste tu límite de ${COMPARACION_LIMIT_SEMANAL} comparaciones esta semana. El cupo se reinicia el próximo lunes.`,
          },
          { status: 429 }
        );
      }
    }

    const { analisisAId, analisisBId } = (await request.json()) as {
      analisisAId?: string;
      analisisBId?: string;
    };
    if (!analisisAId || !analisisBId) {
      return NextResponse.json({ error: "Faltan los dos análisis a comparar." }, { status: 400 });
    }

    const [analisisA, analisisB] = await Promise.all([
      obtenerAnalisis(analisisAId),
      obtenerAnalisis(analisisBId),
    ]);
    if (!analisisA || !analisisB) {
      return NextResponse.json({ error: "Alguno de los análisis a comparar no existe." }, { status: 404 });
    }

    const prompt = comparacionPrompt(analisisA, analisisB);
    const result = await callTool<{
      analisisProblema: { mismoProblema: boolean; justificacion: string };
      firmezaPuenteA: { firme: boolean; justificacion: string };
      firmezaPuenteB: { firme: boolean; justificacion: string };
      sintesis: string;
    }>(prompt);

    const comparacion = await guardarComparacion({
      analisisAId,
      analisisBId,
      mismoProblema: result.analisisProblema.mismoProblema,
      justificacionProblema: result.analisisProblema.justificacion,
      firmezaPuenteA: result.firmezaPuenteA,
      firmezaPuenteB: result.firmezaPuenteB,
      sintesis: result.sintesis,
      creadoPor: user.username,
    });

    if (!isAdmin) {
      await incrementUsage(user.username, "comparacion");
    }

    return NextResponse.json({ id: comparacion.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al comparar." },
      { status: 500 }
    );
  }
}
