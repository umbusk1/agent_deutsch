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
};

export async function callTool<T>(params: ToolCallParams): Promise<T> {
  const response = await getClient().messages.create({
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
  });

  const toolUse = response.content.find(
    (block) => block.type === "tool_use" && block.name === params.toolName
  );

  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("El modelo no devolvió una respuesta estructurada válida.");
  }

  return toolUse.input as T;
}
