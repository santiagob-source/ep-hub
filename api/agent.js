const { AgentError, buildPayload, runAgent } = require("../lib/agent/service");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Método no permitido" });
    }
    let body = req.body;
    if (typeof body === "string" || Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString());
      } catch {
        throw new AgentError(400, "JSON inválido");
      }
    }
    const payload = buildPayload(body);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AgentError(503, "OPENAI_API_KEY no configurada");
    return res.status(200).json(await runAgent(payload, apiKey));
  } catch (error) {
    return res.status(error instanceof AgentError ? error.status : 500).json({
      error:
        error instanceof AgentError
          ? error.message
          : "Error interno del agente",
    });
  }
};
