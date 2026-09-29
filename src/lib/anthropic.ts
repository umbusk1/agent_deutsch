import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no está configurada en el servidor.");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const MODEL = "claude-sonnet-5";

type ToolCallParams = {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Anthropic.Tool["input_schema"];
  maxTokens?: number;
  timeoutMs?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  // Hace cumplir "required" de verdad (sin esto, el modelo puede omitir un campo "obligatorio" sin que la API
  // lo rechace). Requiere additionalProperties:false en cada objeto del schema. Sonnet 5 lo soporta y es
  // compatible con tool_choice forzado y con effort (confirmado contra la documentación de la API de Claude).
  strict?: boolean;
};

// TODO (pendiente, no resolver en esta ronda): tool_choice va forzado a una tool específica en las 7 llamadas
// de prompts.ts, pero ninguna declara `strict: true` en la tool — sin eso, "required" del input_schema no se
// aplica de verdad: el modelo puede omitir un campo "obligatorio" sin que la API lo rechace (lo confirmamos con
// razonamientoDiagnostico en el diagnóstico de Paso 1, que a veces venía completamente ausente pese a estar en
// "required"). Falta una auditoría de los 7 schemas en prompts.ts para ver si algún otro campo obligatorio se
// está perdiendo en silencio del mismo modo, sin que lo hayamos notado porque el código downstream no lo exige
// con la misma dureza que exigimos razonamientoDiagnostico en ese diagnóstico puntual.
//
// Patrón confirmado 3 veces en esta misma ronda: "el schema permite una salida vacía/trivial → bajo presión de
// generación, el modelo toma ese atajo en vez de hacer el trabajo real". Visto en razonamientoDiagnostico (Paso 1,
// arriba), en candidatosBrutos (Paso 3 — variantesAceptadas podía salir vacía con una sola llamada mezclando
// "identificar" y "generar"; se resolvió con el split de dos llamadas + candidatosBrutos como campo obligatorio de
// scaffolding) y en Relaciones (Paso 6 — relaciones podía salir [] aun con explicaciones que compartían
// problemaId; se resolvió reemplazando el array libre por una clave obligatoria por par, ver step6Prompt en
// prompts.ts). Vale la pena revisar los pasos restantes (2, 4, 5, 7) con esta misma pregunta antes de que aparezca
// un cuarto caso sin que lo hayamos anticipado.
// Confirmado en un registro real de producción (2026-09-29, análisis "Así no, Mister Trump", explicación E3):
// un fragmento de la sintaxis interna de tool-call ("<parameter name=\"resultado\">rompe") se filtró crudo a
// un campo de texto y se persistió sin que nada lo detectara. Estos tres marcadores son el síntoma de esa
// clase de falla (una respuesta que no terminó de resolverse como tool_use limpio) — si aparecen en CUALQUIER
// string del input parseado, el input no es confiable, sin importar qué campo puntual sea.
const MARCADORES_TOOL_CALL_MAL_FORMADO = ["<parameter", "</invoke", "antml"];

function marcadorMalFormadoEn(valor: unknown): string | null {
  if (typeof valor === "string") {
    for (const marcador of MARCADORES_TOOL_CALL_MAL_FORMADO) {
      if (valor.includes(marcador)) return marcador;
    }
    return null;
  }
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const hallado = marcadorMalFormadoEn(item);
      if (hallado) return hallado;
    }
    return null;
  }
  if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) {
      const hallado = marcadorMalFormadoEn(v);
      if (hallado) return hallado;
    }
    return null;
  }
  return null;
}

async function unaLlamada<T>(params: ToolCallParams): Promise<T> {
  let response;
  try {
    response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: params.maxTokens ?? 4096,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
        tools: [
          {
            name: params.toolName,
            description: params.toolDescription,
            input_schema: params.inputSchema,
            ...(params.strict ? { strict: true } : {}),
          },
        ],
        tool_choice: { type: "tool", name: params.toolName },
        ...(params.effort ? { output_config: { effort: params.effort } } : {}),
      },
      { timeout: params.timeoutMs ?? 50_000 }
    );
  } catch (error) {
    throw new Error(friendlyClaudeErrorMessage(error));
  }

  const toolUse = response.content.find(
    (block) => block.type === "tool_use" && block.name === params.toolName
  );

  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude no devolvió una respuesta estructurada válida para este paso.");
  }

  return toolUse.input as T;
}

// Capa de validación de forma, aplicada a TODAS las llamadas con schema (no solo a Paso 4, que además tiene
// su propia validación de invariantes de negocio encima de esta — ver step4/route.ts): un solo reintento si
// aparece alguno de los marcadores de arriba, y si el reintento también sale mal formado, un error explícito
// en vez de devolver — y dejar persistir — contenido no confiable.
export async function callTool<T>(params: ToolCallParams): Promise<T> {
  const primerIntento = await unaLlamada<T>(params);
  const marcador = marcadorMalFormadoEn(primerIntento);
  if (!marcador) return primerIntento;

  console.error(
    `[callTool] "${params.toolName}" devolvió un marcador de tool-call mal formado ("${marcador}") filtrado en el contenido — reintentando una vez.`
  );
  const segundoIntento = await unaLlamada<T>(params);
  const marcador2 = marcadorMalFormadoEn(segundoIntento);
  if (marcador2) {
    throw new Error(
      `Claude devolvió una respuesta mal formada para este paso (marcador "${marcador2}" filtrado en el contenido), incluso después de reintentar. No se guardó nada — intenta de nuevo.`
    );
  }
  return segundoIntento;
}

type FreeformCallParams = {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

// Llamada de texto libre, sin tools ni tool_choice forzado: para pasos donde el modelo debe razonar en prosa
// abierta antes de que otra llamada (con callTool) estructure esa conclusión ya escrita. Separar "pensar" de
// "estructurar" evita que el modelo, bajo la presión de producir ya una respuesta con schema, tome el atajo más
// barato (relleno genérico) en vez de razonar de verdad — visto en el Paso 1 incluso con tool_choice forzado +
// strict:true + una instrucción explícita prohibiendo el relleno.
export async function callFreeform(params: FreeformCallParams): Promise<string> {
  let response;
  try {
    response = await getClient().messages.create(
      {
        model: MODEL,
        max_tokens: params.maxTokens ?? 4096,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
        ...(params.effort ? { output_config: { effort: params.effort } } : {}),
      },
      { timeout: params.timeoutMs ?? 50_000 }
    );
  } catch (error) {
    throw new Error(friendlyClaudeErrorMessage(error));
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude no devolvió texto en este paso.");
  }

  return textBlock.text;
}

export function friendlyClaudeErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "Se agotó el tiempo de espera al conectar con Claude. Intenta de nuevo.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Falla de conexión con Claude. Revisa tu conexión e intenta de nuevo en unos segundos.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Se alcanzó el límite de solicitudes de la API de Claude. Espera un momento y reintenta.";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "La API key de Anthropic no es válida o no está configurada. Contacta al administrador de la app.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "El servicio de Claude está teniendo problemas internos. Intenta de nuevo en unos minutos.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Error de la API de Claude (${error.status ?? "desconocido"}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "Error desconocido al comunicarse con Claude.";
}
