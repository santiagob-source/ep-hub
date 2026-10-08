const TOOLS = [
  {
    type: "function",
    name: "search_candidates",
    description: "Busca candidatos en la base interna de Expansion People. Usa filtros amplios y combinables. No modifica datos.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto libre para buscar en nombre, especialidad, ubicación, estado, jobs, notas, email o teléfono." },
        specialty: { type: "string" },
        location: { type: "string" },
        status: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_candidate",
    description: "Crea un candidato nuevo en la app. Úsala solo cuando el usuario lo pide claramente.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, specialty: { type: "string" }, location: { type: "string" }, status: { type: "string" }, linkedin: { type: "string" }, jobs: { type: "string" }, notes: { type: "string" }
      },
      required: ["name"], additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_client",
    description: "Crea un cliente nuevo en la app.",
    parameters: {
      type: "object",
      properties: { name:{type:"string"}, status:{type:"string"}, contact:{type:"string"}, phone:{type:"string"}, email:{type:"string"}, notes:{type:"string"} },
      required:["name"], additionalProperties:false
    }
  },
  {
    type: "function",
    name: "create_job",
    description: "Crea un job/vacante nuevo. Si el usuario menciona cliente, inclúyelo.",
    parameters: {
      type:"object",
      properties:{ title:{type:"string"}, client:{type:"string"}, owner:{type:"string"}, status:{type:"string"}, feePercent:{type:"number"}, notes:{type:"string"} },
      required:["title"], additionalProperties:false
    }
  },
  {
    type: "function",
    name: "link_candidate_to_job",
    description: "Vincula un candidato existente a un job existente y lo añade al pipeline.",
    parameters: {
      type:"object",
      properties:{ candidate:{type:"string"}, job:{type:"string"}, client:{type:"string"}, stage:{type:"string"} },
      required:["candidate","job"], additionalProperties:false
    }
  },
  {
    type: "function",
    name: "create_task",
    description: "Crea un To-Do/recordatorio en la app. due debe ser datetime-local ISO sin zona, por ejemplo 2026-10-09T10:00, solo si el usuario dio fecha/hora suficiente.",
    parameters: {
      type:"object",
      properties:{ title:{type:"string"}, priority:{type:"string"}, due:{type:"string"}, linkedTo:{type:"string"}, notes:{type:"string"} },
      required:["title"], additionalProperties:false
    }
  },
  {
    type: "function",
    name: "generate_boolean",
    description: "Genera una búsqueda booleana para LinkedIn/recruitment. No busca LinkedIn; solo construye el booleano.",
    parameters: {
      type:"object",
      properties:{ specialty:{type:"string"}, aliases:{type:"array",items:{type:"string"}}, location:{type:"string"}, locationAliases:{type:"array",items:{type:"string"}}, keywords:{type:"array",items:{type:"string"}}, exclude:{type:"array",items:{type:"string"}}, query:{type:"string"} },
      additionalProperties:false
    }
  },
  {
    type: "function",
    name: "prepare_whatsapp",
    description: "Prepara un enlace de WhatsApp para un candidato existente. Nunca envía el mensaje por sí solo.",
    parameters: {
      type:"object",
      properties:{ candidate:{type:"string"}, message:{type:"string"} },
      required:["candidate"], additionalProperties:false
    }
  }
];

const SYSTEM = `Eres Agente EP, asistente operativo de Expansion People, una consultora de selección centrada especialmente en perfiles sanitarios.
Tu trabajo es ejecutar tareas operativas dentro de la app usando herramientas, no hacer rankings complejos de candidatos salvo que te lo pidan.
Prioridades:
- Sé breve y práctico.
- Usa search_candidates para consultar la base antes de afirmar que alguien existe o no.
- Si el usuario pide crear/modificar datos, llama a la herramienta correspondiente. La interfaz pedirá confirmación antes de escribir.
- Para LinkedIn puedes generar booleanos, pero no afirmar que has buscado LinkedIn.
- prepare_whatsapp solo prepara el contacto; no envía mensajes.
- Si faltan datos indispensables para una acción, pregunta solo lo mínimo necesario.
- No inventes candidatos, clientes, jobs, teléfonos, emails, fechas ni resultados.
- Puedes encadenar varias herramientas en una misma petición cuando tenga sentido.
- Para fechas relativas, usa como referencia la fecha actual del servidor y devuelve due en formato YYYY-MM-DDTHH:mm cuando corresponda.
La arquitectura irá incorporando más herramientas (Gmail, WhatsApp Business API, búsquedas externas, etc.), así que mantén las decisiones basadas en herramientas y no en supuestos.`;

function extractText(response) {
  if (response.output_text) return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    if (item.type === "message") {
      for (const c of item.content || []) if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function extractCalls(response) {
  return (response.output || []).filter(x => x.type === "function_call").map(x => ({
    call_id: x.call_id,
    name: x.name,
    arguments: x.arguments || "{}"
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "OPENAI_API_KEY no configurada" });

  try {
    const body = req.body || {};
    const model = process.env.AGENT_MODEL || "gpt-5.4-mini";
    let payload;

    if (body.previous_response_id && Array.isArray(body.tool_outputs)) {
      payload = {
        model,
        previous_response_id: body.previous_response_id,
        input: body.tool_outputs.map(x => ({ type: "function_call_output", call_id: x.call_id, output: JSON.stringify(x.output) })),
        tools: TOOLS,
        parallel_tool_calls: true
      };
    } else {
      const context = body.context || {};
      const now = new Date().toISOString();
      payload = {
        model,
        input: [
          { role: "system", content: SYSTEM + `\nFecha/hora de referencia del servidor: ${now}.` },
          { role: "user", content: `Contexto de la app: ${JSON.stringify(context)}\n\nPedido del usuario: ${String(body.message || "")}` }
        ],
        tools: TOOLS,
        parallel_tool_calls: true
      };
    }

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : "Error de OpenAI";
      return res.status(r.status).json({ error: msg });
    }

    return res.status(200).json({ response_id: data.id, text: extractText(data), calls: extractCalls(data) });
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : "Error interno del agente" });
  }
};
