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
};

// TODO (pendiente, no resolver en esta ronda): tool_choice va forzado a una tool específica en las 7 llamadas
// de prompts.ts, pero ninguna declara `strict: true` en la tool — sin eso, "required" del input_schema no se
// aplica de verdad: el modelo puede omitir un campo "obligatorio" sin que la API lo rechace (lo confirmamos con
// razonamientoDiagnostico en el diagnóstico de Paso 1, que a veces venía completamente ausente pese a estar en
// "required"). Falta una auditoría de los 7 schemas en prompts.ts para ver si algún otro campo obligatorio se
// está perdiendo en silencio del mismo modo, sin que lo hayamos notado porque el código downstream no lo exige
// con la misma dureza que exigimos razonamientoDiagnostico en ese diagnóstico puntual.
export async function callTool<T>(params: ToolCallParams): Promise<T> {
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
