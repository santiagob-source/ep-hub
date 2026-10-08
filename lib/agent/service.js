const tools = require("./tools");
const system = require("./prompt");

class AgentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function buildPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AgentError(400, "El cuerpo debe ser un objeto JSON");
  const base = {
    model: process.env.AGENT_MODEL || "gpt-5.4-mini",
    tools,
    parallel_tool_calls: true,
  };
  // Instructions must be supplied again when continuing a Responses conversation.
  base.instructions =
    system +
    `\nFecha/hora de referencia del servidor: ${new Date().toISOString()}`;
  if (
    body.previous_response_id !== undefined &&
    (typeof body.previous_response_id !== "string" ||
      !body.previous_response_id.trim())
  )
    throw new AgentError(400, "previous_response_id inválido");
  if (body.tool_outputs !== undefined) {
    if (
      typeof body.previous_response_id !== "string" ||
      !body.previous_response_id.trim() ||
      !Array.isArray(body.tool_outputs) ||
      !body.tool_outputs.length
    ) {
      throw new AgentError(
        400,
        "La continuación requiere previous_response_id y tool_outputs",
      );
    }
    if (
      body.tool_outputs.some(
        (x) =>
          !x ||
          typeof x.call_id !== "string" ||
          !x.call_id.trim() ||
          !Object.hasOwn(x, "output"),
      )
    ) {
      throw new AgentError(400, "Resultado de herramienta inválido");
    }
    return {
      ...base,
      previous_response_id: body.previous_response_id,
      input: body.tool_outputs.map((x) => ({
        type: "function_call_output",
        call_id: x.call_id,
        output: JSON.stringify(x.output),
      })),
    };
  }
  if (typeof body.message !== "string" || !body.message.trim())
    throw new AgentError(400, "Falta el mensaje");
  return {
    ...base,
    ...(body.previous_response_id
      ? { previous_response_id: body.previous_response_id }
      : {}),
    input: [
      {
        role: "user",
        content: `Contexto de la app: ${JSON.stringify(body.context || {})}\n\nPedido del usuario: ${body.message}`,
      },
    ],
  };
}

async function runAgent(payload, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data;
    try {
      data = JSON.parse(await response.text());
    } catch {
      throw new AgentError(502, "OpenAI devolvió una respuesta no JSON");
    }
    if (!response.ok)
      throw new AgentError(
        response.status >= 400 && response.status <= 599
          ? response.status
          : 502,
        typeof data?.error?.message === "string"
          ? data.error.message
          : "Error de OpenAI",
      );
    if (!data || typeof data.id !== "string" || !Array.isArray(data.output))
      throw new AgentError(502, "Respuesta inválida de OpenAI");
    const text =
      typeof data.output_text === "string"
        ? data.output_text
        : data.output
            .filter((x) => x.type === "message")
            .flatMap((x) => x.content || [])
            .filter(
              (x) => x.type === "output_text" && typeof x.text === "string",
            )
            .map((x) => x.text)
            .join("\n");
    const calls = data.output
      .filter((x) => x.type === "function_call")
      .map((x) => ({
        call_id: x.call_id,
        name: x.name,
        arguments: x.arguments || "{}",
      }));
    return { response_id: data.id, text, calls };
  } catch (error) {
    if (controller.signal.aborted)
      throw new AgentError(
        504,
        "OpenAI tardó demasiado en responder. Intentá de nuevo.",
      );
    if (error instanceof AgentError) throw error;
    throw new AgentError(502, "No se pudo conectar con OpenAI");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { AgentError, buildPayload, runAgent };
