const budget = require("./deadline");
class WhatsAppError extends Error {
  constructor(status, message, uncertain = false) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}
function channelId() {
  const id = Number(process.env.RESPOND_IO_WHATSAPP_CHANNEL_ID);
  if (!process.env.RESPOND_IO_API_TOKEN || !Number.isSafeInteger(id) || id <= 0)
    throw new WhatsAppError(503, "Falta configurar respond.io en Vercel.");
  return id;
}
async function request(path, { method = "GET", body } = {}) {
  channelId();
  let response, data;
  const signal = budget.signal(5000);
  try {
    response = await fetch("https://api.respond.io/v2" + path, {
      method,
      headers: {
        Authorization: "Bearer " + process.env.RESPOND_IO_API_TOKEN,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
    data = await response.json();
  } catch {
    throw new WhatsAppError(
      502,
      "No se pudo confirmar la respuesta de respond.io.",
      method !== "GET",
    );
  }
  if (!response.ok) {
    const messages = {
      401: "El token de respond.io no es válido.",
      403: "respond.io no permitió esta operación. Revisá los permisos y el acceso a Developer API del plan.",
      404: "El contacto o recurso no existe en respond.io.",
      429: "respond.io alcanzó su límite de solicitudes.",
    };
    throw new WhatsAppError(
      response.status,
      messages[response.status] ||
        "respond.io rechazó la operación. Revisá el canal, saldo y plantilla.",
      method !== "GET" && response.status >= 500,
    );
  }
  return data;
}
function identifier(phone) {
  if (typeof phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(phone))
    throw new WhatsAppError(
      400,
      "El teléfono debe incluir prefijo internacional, por ejemplo +34, sin espacios.",
    );
  return encodeURIComponent("phone:" + phone);
}
async function contact(phone) {
  try {
    return await request("/contact/" + identifier(phone));
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
async function channels(phone) {
  const data = await request(
    "/contact/" + identifier(phone) + "/channels?limit=100",
  );
  return data.items || [];
}
async function templates(cursor) {
  const data = await request(
    "/space/channel/" +
      channelId() +
      "/template?limit=100" +
      (cursor ? "&cursorId=" + encodeURIComponent(cursor) : ""),
  );
  return {
    items: (data.items || []).filter(
      (t) => String(t.status).toUpperCase() === "APPROVED",
    ),
    pagination: data.pagination,
  };
}
async function template(name, language) {
  let cursor;
  for (let i = 0; i < 3; i++) {
    const page = await templates(cursor);
    const found = page.items.find(
      (t) => t.name === name && t.languageCode === language,
    );
    if (found) return found;
    const next = page.pagination?.next;
    if (!next) break;
    cursor = new URL(next, "https://api.respond.io").searchParams.get(
      "cursorId",
    );
    if (!cursor) break;
  }
  throw new WhatsAppError(
    400,
    "No encontré esa plantilla aprobada en el canal. Consultá whatsapp_templates y elegí una disponible.",
  );
}
function renderTemplate(def, params = []) {
  if (
    !Array.isArray(params) ||
    params.some((v) => typeof v !== "string" || !v.trim() || v.length > 500)
  )
    throw new WhatsAppError(400, "Parámetros de plantilla inválidos.");
  if (
    (def.components || []).some(
      (c) => !["body", "footer"].includes(c.type) || typeof c.text !== "string",
    )
  )
    throw new WhatsAppError(
      400,
      "Esta fase admite plantillas de texto con cuerpo y pie, sin botones ni multimedia.",
    );
  const body = def.components.find((c) => c.type === "body");
  if (!body)
    throw new WhatsAppError(400, "La plantilla no tiene cuerpo de texto.");
  const indexes = [...body.text.matchAll(/{{\s*(\d+)\s*}}/g)].map((x) =>
    Number(x[1]),
  );
  const count = Math.max(0, ...indexes);
  if (
    params.length !== count ||
    Array.from({ length: count }, (_, i) => i + 1).some(
      (n) => !indexes.includes(n),
    )
  )
    throw new WhatsAppError(
      400,
      "Faltan o sobran parámetros para la plantilla.",
    );
  const text = def.components
    .map((c) =>
      c.text.replace(/{{\s*(\d+)\s*}}/g, (_, n) => params[Number(n) - 1] ?? ""),
    )
    .join("\n");
  return {
    text,
    message: {
      type: "whatsapp_template",
      template: {
        name: def.name,
        languageCode: def.languageCode,
        components: count
          ? [
              {
                type: "body",
                parameters: params.map((text) => ({ type: "text", text })),
              },
            ]
          : [],
      },
    },
  };
}
async function assertWindow(phone, at) {
  const list = await channels(phone);
  const ch = list.find((c) => c.id === channelId());
  let last = Number(ch?.lastIncomingMessageTime) || 0;
  if (last < 1e12) last *= 1000;
  if (!last || last > Date.now() + 60000 || at >= last + 86400000)
    throw new WhatsAppError(
      400,
      "A esa hora no hay una ventana de 24 horas disponible. Usá una plantilla aprobada; Kitty no cambiará el mensaje automáticamente.",
    );
}
async function send(job) {
  if (job.create_contact) {
    const existing = await contact(job.phone);
    if (!existing)
      await request("/contact/" + identifier(job.phone), {
        method: "POST",
        body: { firstName: job.recipient, phone: job.phone },
      });
  }
  const result = await request(
    "/contact/" + identifier(job.phone) + "/message",
    {
      method: "POST",
      body: { channelId: channelId(), message: job.provider_message },
    },
  );
  if (!Number.isSafeInteger(result.messageId))
    throw new WhatsAppError(
      502,
      "respond.io no devolvió un identificador de envío.",
      true,
    );
  return result;
}
async function messageStatus(job) {
  return request(
    "/contact/" +
      identifier(job.phone) +
      "/message/" +
      encodeURIComponent(job.message_id),
  );
}
module.exports = {
  WhatsAppError,
  channelId,
  request,
  identifier,
  contact,
  channels,
  templates,
  template,
  renderTemplate,
  assertWindow,
  send,
  messageStatus,
};
