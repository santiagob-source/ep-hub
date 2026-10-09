const budget = require("../lib/whatsapp/deadline");
const { timingSafeEqual } = require("node:crypto");
const { worker } = require("../lib/whatsapp/service");
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected || expected.length < 32)
      return res.status(503).json({
        ok: false,
        error: "Falta configurar el ejecutor de WhatsApp.",
      });
    const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    )
      return res
        .status(401)
        .json({ ok: false, error: "Ejecutor no autorizado." });
    if (!["GET", "POST"].includes(req.method))
      return res.status(405).json({ ok: false, error: "Método no permitido." });
    res.status(200).json(await worker());
  } catch (e) {
    res.status(e.status || 502).json({
      ok: false,
      error: e.status ? e.message : "No se pudo ejecutar la cola de WhatsApp.",
    });
  }
}
module.exports = (req, res) => budget.run(55000, () => handler(req, res));
