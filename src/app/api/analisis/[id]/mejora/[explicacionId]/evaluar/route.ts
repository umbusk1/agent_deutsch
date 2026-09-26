import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { obtenerMejoraSesion, guardarMejoraSesion } from "@/lib/mejora";
import { desbloquearTextoMejora, MEJORA_TEXTOS_LIMIT_SEMANAL } from "@/lib/usage";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { asArray } from "@/lib/safe-array";
import { step3IdentificarPrompt, step3VariantesPrompt, step4Prompt, mejoraNotaPrompt } from "@/lib/prompts";
import type {
  Explicacion,
  IdentificacionVariante,
  VarianteAceptada,
  ResultadoVariante,
  IntentoMejora,
  MejoraSesion,
} from "@/lib/types";

// 180s: hasta 4 llamadas SECUENCIALES por intento (step3Identificar → step3Variantes → step4 →
// mejoraNotaPrompt) — más que las 2 secuenciales de step7, así que el margen tiene que ser mayor. Streaming
// SSE con heartbeat por la misma razón que step1/step7: sin esto, el navegador puede pasar más de un minuto
// sin recibir ningún byte mientras corren las cuatro llamadas.
export const maxDuration = 180;

const MAX_INTENTOS = 5;

function comoResultadoParaNota(intento: {
  texto: string;
  veredicto: IntentoMejora["veredicto"];
  justificacion: string;
  variantes: VarianteAceptada[];
  resultadosVariantes: ResultadoVariante[];
}) {
  return {
    texto: intento.texto,
    veredicto: intento.veredicto,
    justificacion: intento.justificacion,
    resultadosVariantes: intento.resultadosVariantes.map((r) => ({
      descripcion: intento.variantes.find((v) => v.id === r.varianteId)?.descripcion ?? "",
      resultado: r.resultado,
      justificacion: r.justificacion,
    })),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; explicacionId: string }> }
) {
  const { id: analisisId, explicacionId } = await params;

  const rawUsername = request.headers.get("x-au-user");
  const username = rawUsername ? decodeURIComponent(rawUsername) : null;
  const user = username ? findUser(username) : undefined;
  if (!user) {
    return NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 });
  }

  const { texto: textoEditado } = (await request.json()) as { texto: string };
  if (!textoEditado || !textoEditado.trim()) {
    return NextResponse.json({ error: "Falta el fragmento editado." }, { status: 400 });
  }

  const analisis = await obtenerAnalisis(analisisId);
  if (!analisis || !analisis.texto || !analisis.explicaciones || !analisis.problemas || !analisis.veredictos) {
    return NextResponse.json(
      { error: "Este análisis no tiene los datos completos que Mejora necesita." },
      { status: 400 }
    );
  }

  const explicacionOriginal = analisis.explicaciones.find((e) => e.id === explicacionId);
  const veredictoOriginal = analisis.veredictos.find((v) => v.explicacionId === explicacionId);
  const problema = explicacionOriginal
    ? analisis.problemas.find((p) => p.id === explicacionOriginal.problemaId)
    : undefined;
  if (!explicacionOriginal || !veredictoOriginal || !problema) {
    return NextResponse.json({ error: "Explicación no encontrada en este análisis." }, { status: 404 });
  }
  if (veredictoOriginal.veredicto !== "FacilDeVariar") {
    return NextResponse.json(
      { error: "Mejora solo cubre explicaciones con resultado Frágil por ahora." },
      { status: 400 }
    );
  }

  const sesionExistente = await obtenerMejoraSesion(analisisId, explicacionId);
  if (sesionExistente && sesionExistente.intentos.length >= MAX_INTENTOS) {
    return NextResponse.json(
      { error: `Ya alcanzaste el máximo de ${MAX_INTENTOS} intentos para esta explicación.` },
      { status: 400 }
    );
  }

  // El cupo se gasta ACÁ — el primer clic real en "Evaluar" para este análisis — antes de gastar ninguna
  // llamada a Claude. Si el texto ya estaba desbloqueado esta semana, esto es un no-op (no vuelve a cobrar).
  // Mismo patrón que /api/comparacion/route.ts: los admin no tocan el cupo en absoluto, ni para chequearlo
  // ni para gastarlo (Mejora ilimitada para ellos, igual que Comparaciones).
  const isAdmin = user.role === "admin";
  const desbloqueado = isAdmin || (await desbloquearTextoMejora(user.username, analisisId));
  if (!desbloqueado) {
    return NextResponse.json(
      {
        error: `Alcanzaste tu cupo de ${MEJORA_TEXTOS_LIMIT_SEMANAL} textos por semana para Mejora. El cupo se reinicia el próximo lunes.`,
      },
      { status: 429 }
    );
  }

  const texto = analisis.texto;

  return crearRespuestaSse(request, "mejora-evaluar", async (enviar) => {
    // El fragmento editado juega el rol de "cita" y "resumen" a la vez: acá no hay una distinción entre cita
    // literal y aplicación específica parafraseada, es directamente el texto que el usuario está poniendo a
    // prueba. mecanismoGeneral se manda TAL CUAL vino del análisis original — nunca editable.
    const explicacionParaPrueba: Explicacion = {
      ...explicacionOriginal,
      cita: textoEditado,
      resumen: textoEditado,
    };

    const identificacionPrompt = step3IdentificarPrompt(texto, explicacionParaPrueba, problema);
    const identificacion = await callTool<IdentificacionVariante>(identificacionPrompt);

    const variantesPrompt = step3VariantesPrompt(texto, explicacionParaPrueba, problema, identificacion);
    const resultVariantes = await callTool<{
      candidatosBrutos: string[];
      variantesAceptadas: {
        descripcion: string;
        tipo?: "sustitucion_minima" | "conocimiento_nuevo";
        elementoFijoVerificado?: string;
      }[];
      variantesDescartadas: { descripcion: string; motivo: string }[];
    }>(variantesPrompt);

    let contador = 0;
    const variantes: VarianteAceptada[] = asArray(resultVariantes.variantesAceptadas)
      .filter((v) => v.descripcion?.trim())
      .map((v) => {
        contador += 1;
        return {
          id: `V${contador}`,
          explicacionId,
          descripcion: v.descripcion.trim(),
          tipo: v.tipo === "conocimiento_nuevo" ? ("conocimiento_nuevo" as const) : ("sustitucion_minima" as const),
          elementoFijoVerificado: v.elementoFijoVerificado?.trim() ?? "",
        };
      });

    let resultadosVariantes: ResultadoVariante[] = [];
    let veredicto: IntentoMejora["veredicto"];
    let justificacion: string;
    let resisteConocimientoNuevo: IntentoMejora["resisteConocimientoNuevo"] = null;

    if (variantes.length === 0) {
      // Mismo caso y mismo mensaje que step4/route.ts: no se pudo poner a prueba, no es evidencia de nada.
      veredicto = "SinSustitutoGenuino";
      justificacion =
        "Esta vez no se logró generar ninguna variante que compitiera genuinamente por resolver el mismo problema: cualquier cambio de detalles considerado terminaba resolviendo un problema distinto. Este intento no fue puesto a prueba.";
    } else {
      const veredictoPrompt = step4Prompt(texto, explicacionParaPrueba, problema, variantes);
      const resultVeredicto = await callTool<{
        resultadosVariantes: { varianteId: string; resultado: "rompe" | "sobrevive"; justificacion: string }[];
        veredicto: "DificilDeVariar" | "FacilDeVariar" | "Mixta";
        justificacion: string;
        resisteConocimientoNuevo?: { resultado: "rompe" | "sobrevive"; justificacion: string };
      }>(veredictoPrompt);

      resultadosVariantes = asArray(resultVeredicto.resultadosVariantes);
      veredicto = resultVeredicto.veredicto;
      justificacion = resultVeredicto.justificacion;
      resisteConocimientoNuevo = resultVeredicto.resisteConocimientoNuevo ?? null;
    }

    const numeroIntento = (sesionExistente?.intentos.length ?? 0) + 1;
    const intentoAnteriorRegistro = sesionExistente?.intentos[sesionExistente.intentos.length - 1] ?? null;

    const intentoActualParaNota = comoResultadoParaNota({
      texto: textoEditado,
      veredicto,
      justificacion,
      variantes,
      resultadosVariantes,
    });
    const intentoAnteriorParaNota = intentoAnteriorRegistro
      ? comoResultadoParaNota(intentoAnteriorRegistro)
      : null;

    const notaPrompt = mejoraNotaPrompt(
      explicacionOriginal.mecanismoGeneral,
      veredictoOriginal.justificacion,
      intentoActualParaNota,
      intentoAnteriorParaNota,
      numeroIntento
    );
    const resultNota = await callTool<{ notaMentor: string }>(notaPrompt);

    const nuevoIntento: IntentoMejora = {
      id: `I${numeroIntento}`,
      texto: textoEditado,
      creadoEn: new Date().toISOString(),
      identificacion,
      variantes,
      resultadosVariantes,
      veredicto,
      justificacion,
      resisteConocimientoNuevo,
      notaMentor: resultNota.notaMentor,
    };

    const ahora = new Date().toISOString();
    const sesion: MejoraSesion = sesionExistente
      ? { ...sesionExistente, intentos: [...sesionExistente.intentos, nuevoIntento], actualizadoEn: ahora }
      : {
          id: `${analisisId}:${explicacionId}`,
          analisisId,
          explicacionId,
          mecanismoGeneral: explicacionOriginal.mecanismoGeneral,
          razonFragil: veredictoOriginal.justificacion,
          intentos: [nuevoIntento],
          aplicadoIntentoId: null,
          usuario: user.username,
          creadoEn: ahora,
          actualizadoEn: ahora,
        };

    await guardarMejoraSesion(sesion);

    enviar({ sesion });
  });
}
