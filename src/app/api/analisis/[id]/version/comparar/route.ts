import { NextResponse } from "next/server";
import { callTool } from "@/lib/anthropic";
import { obtenerAnalisis } from "@/lib/analisis";
import { findUser } from "@/lib/users";
import { crearRespuestaSse } from "@/lib/sse-stream";
import { cambiosPrompt, parejasPrompt } from "@/lib/prompts-versiones";
import { calcularTransiciones, validarCambios, validarParejas } from "@/lib/versiones-comparar";
import { guardarComparacionVersiones, obtenerComparacionVersiones } from "@/lib/versiones";
import type { ComparacionVersiones } from "@/lib/types";

// Dos llamadas al modelo EN PARALELO (la lista de cambios y el emparejamiento no dependen una de la otra), cada
// una con el timeout por defecto de callTool (50s) y a lo sumo un reintento por marcador mal formado: peor caso
// real ~100s. 300s es el techo del plan, igual que en las otras rutas largas de Mejora.
export const maxDuration = 300;

type CambiosCrudos = { cambios: unknown };
type ParejasCrudas = { parejas: unknown };

async function cargarYAutorizar(request: Request, id: string) {
  const rawUsername = request.headers.get("x-au-user");
  const username = rawUsername ? decodeURIComponent(rawUsername) : null;
  const user = username ? findUser(username) : undefined;
  if (!user) {
    return { error: NextResponse.json({ error: "No se pudo identificar al usuario." }, { status: 401 }) };
  }
  const nuevo = await obtenerAnalisis(id);
  if (!nuevo) {
    return { error: NextResponse.json({ error: "Análisis no encontrado." }, { status: 404 }) };
  }
  // Igual que la Mejora actual: restringido al autor, SIN excepción para admin.
  if (nuevo.usuario !== user.username) {
    return {
      error: NextResponse.json({ error: "Las versiones están restringidas al autor del análisis." }, { status: 403 }),
    };
  }
  if (!nuevo.versionAnteriorId) {
    return {
      error: NextResponse.json({ error: "Este análisis no es una versión de otro análisis." }, { status: 400 }),
    };
  }
  const anterior = await obtenerAnalisis(nuevo.versionAnteriorId);
  if (!anterior) {
    return { error: NextResponse.json({ error: "La versión anterior ya no existe." }, { status: 404 }) };
  }
  return { user, nuevo, anterior };
}

// Devuelve la comparación guardada (si existe) sin gastar ninguna llamada.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cargado = await cargarYAutorizar(request, id);
    if ("error" in cargado) return cargado.error;
    const comparacion = await obtenerComparacionVersiones(id);
    if (!comparacion) {
      return NextResponse.json({ error: "Esta versión todavía no se ha comparado." }, { status: 404 });
    }
    return NextResponse.json(comparacion);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error desconocido al leer la comparación." },
      { status: 500 }
    );
  }
}

// Corre la comparación (las dos llamadas) y la guarda. Si ya existe, la devuelve tal cual: no se vuelve a
// gastar nada por hacer clic dos veces.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cargado = await cargarYAutorizar(request, id);
  if ("error" in cargado) return cargado.error;
  const { user, nuevo, anterior } = cargado;

  if (
    !anterior.texto ||
    !nuevo.texto ||
    !anterior.explicaciones ||
    !nuevo.explicaciones ||
    !anterior.problemas ||
    !nuevo.problemas ||
    !anterior.veredictos ||
    !nuevo.veredictos
  ) {
    return NextResponse.json(
      { error: "Alguna de las dos versiones no tiene los datos completos que la comparación necesita." },
      { status: 400 }
    );
  }
  const textoAnterior = anterior.texto;
  const textoNuevo = nuevo.texto;
  const explicacionesAnteriores = anterior.explicaciones;
  const explicacionesNuevas = nuevo.explicaciones;
  const problemasAnteriores = anterior.problemas;
  const problemasNuevos = nuevo.problemas;
  const veredictosAnteriores = anterior.veredictos;
  const veredictosNuevos = nuevo.veredictos;

  const existente = await obtenerComparacionVersiones(id);

  return crearRespuestaSse(request, "version-comparar", async (enviar) => {
    if (existente) {
      enviar(existente);
      return;
    }

    const [cambiosCrudos, parejasCrudas] = await Promise.all([
      callTool<CambiosCrudos>(cambiosPrompt(textoAnterior, textoNuevo)),
      explicacionesNuevas.length === 0
        ? Promise.resolve<ParejasCrudas>({ parejas: [] })
        : callTool<ParejasCrudas>(
            parejasPrompt(explicacionesAnteriores, problemasAnteriores, explicacionesNuevas, problemasNuevos)
          ),
    ]);

    const { cambios } = validarCambios(cambiosCrudos?.cambios, textoAnterior, textoNuevo);
    const cambioElProblema = cambios.some((c) => c.tipo === "problema");

    const parejas = validarParejas(parejasCrudas?.parejas, explicacionesAnteriores, explicacionesNuevas);
    const transiciones = calcularTransiciones(parejas, veredictosAnteriores, veredictosNuevos, cambioElProblema);
    const emparejadas = new Set(
      transiciones.map((t) => t.explicacionAnteriorId).filter((x): x is string => x !== null)
    );

    const comparacion: ComparacionVersiones = {
      analisisNuevoId: nuevo.id,
      analisisAnteriorId: anterior.id,
      creadoPor: user.username,
      creadoEn: new Date().toISOString(),
      cambios,
      cambioElProblema,
      transiciones,
      explicacionesAnterioresSinPareja: explicacionesAnteriores
        .map((e) => e.id)
        .filter((eid) => !emparejadas.has(eid)),
    };
    await guardarComparacionVersiones(comparacion);
    enviar(comparacion);
  });
}
