const budget = require("../lib/whatsapp/deadline");
const { verifyFirebaseToken } = require("../lib/gmail/auth");
const service = require("../lib/whatsapp/service"),
  provider = require("../lib/whatsapp/provider");
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST")
      throw new provider.WhatsAppError(405, "Método no permitido.");
    if (
      req.headers.origin &&
      req.headers.origin !== "https://expansion-people-recruiter.vercel.app"
    )
      throw new provider.WhatsAppError(403, "Origen no permitido.");
    const user = await verifyFirebaseToken(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
    );
    const allowed = (process.env.RESPOND_IO_ALLOWED_UIDS || "")
      .split(",")
      .map((x) => x.trim());
    if (!allowed.includes(user.sub))
      throw new provider.WhatsAppError(
        403,
        "Tu usuario todavía no tiene acceso al WhatsApp de la empresa. Añadí este UID a RESPOND_IO_ALLOWED_UIDS en Vercel: " +
          user.sub,
      );
    const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body || {},
      args = body.args || {};
    let result;
    if (body.action === "prepare")
      result = await service.prepare(user.sub, body.tool, args);
    else if (body.action === "execute") {
      if (body.tool === "whatsapp_status") result = await service.status();
      else if (body.tool === "whatsapp_templates")
        result = await provider.templates(args.cursor_id);
      else if (body.tool === "whatsapp_list_scheduled")
        result = await service.list(user.sub);
      else
        result = await service.execute(
          user.sub,
          body.tool,
          args,
          body.capability,
          body.consent,
        );
    } else throw new provider.WhatsAppError(400, "Acción desconocida.");
    res.status(200).json(result);
  } catch (e) {
    res.status(e instanceof SyntaxError ? 400 : e.status || 502).json({
      ok: false,
      error:
        e.status === 401
          ? "Iniciá sesión en el Hub para usar WhatsApp."
          : e.status
            ? e.message
            : "No se pudo completar la operación de WhatsApp.",
    });
  }
}
module.exports = (req, res) => budget.run(24000, () => handler(req, res));
