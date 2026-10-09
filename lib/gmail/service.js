const { createHash } = require("node:crypto");
class GmailError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function callGoogle(token, path, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
      {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      },
    );
    const data = await response.json();
    if (!response.ok) {
      const messages = {
        401: "La conexión de Gmail venció. Conectá Google nuevamente.",
        403: "Google no permitió esta operación. Revisá los permisos concedidos y que Gmail API esté habilitada.",
        404: "El correo o borrador ya no existe.",
        429: "Gmail alcanzó su límite de solicitudes. Intentá de nuevo en un momento.",
      };
      throw new GmailError(
        response.status,
        messages[response.status] || "Gmail no pudo completar la operación.",
      );
    }
    return data;
  } catch (error) {
    if (error instanceof GmailError) throw error;
    throw new GmailError(
      controller.signal.aborted ? 504 : 502,
      controller.signal.aborted
        ? "Gmail tardó demasiado en responder."
        : "No se pudo conectar con Gmail.",
    );
  } finally {
    clearTimeout(timer);
  }
}
function messageView(message) {
  const headers = message.payload?.headers || [];
  const header = (name) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value || "";
  const parts = [],
    htmlParts = [],
    attachments = [];
  function visit(part) {
    if (part.mimeType === "text/plain" && part.body?.data)
      parts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    if (part.mimeType === "text/html" && part.body?.data)
      htmlParts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    if (part.filename)
      attachments.push({
        filename: part.filename,
        mime_type: part.mimeType,
        size: part.body?.size || 0,
      });
    (part.parts || []).forEach(visit);
  }
  if (message.payload) visit(message.payload);
  return {
    id: message.id,
    thread_id: message.threadId,
    from: header("from"),
    to: header("to"),
    cc: header("cc"),
    bcc: header("bcc"),
    subject: header("subject"),
    date: header("date"),
    snippet: message.snippet || "",
    body: (parts.length ? parts : htmlParts).join("\n").slice(0, 30000),
    body_format: parts.length ? "text" : "html",
    truncated: (parts.length ? parts : htmlParts).join("\n").length > 30000,
    attachments,
    revision: fingerprint(message.payload || {}),
    labels: message.labelIds || [],
  };
}
function validateDraft(args) {
  if (
    !args ||
    !Array.isArray(args.to) ||
    !args.to.length ||
    args.to.length > 20
  )
    throw new GmailError(400, "Indicá entre 1 y 20 destinatarios.");
  for (const email of args.to)
    if (
      typeof email !== "string" ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)
    )
      throw new GmailError(
        400,
        "Indicá direcciones de correo válidas, sin nombres ni saltos de línea.",
      );
  if (
    typeof args.subject !== "string" ||
    !args.subject.trim() ||
    /[\r\n]/.test(args.subject) ||
    args.subject.length > 500
  )
    throw new GmailError(400, "El asunto no es válido.");
  if (
    typeof args.body !== "string" ||
    !args.body.trim() ||
    args.body.length > 50000
  )
    throw new GmailError(400, "El cuerpo del correo no es válido.");
  return { to: [...args.to], subject: args.subject, body: args.body };
}
function mimeMessage(args) {
  const data = validateDraft(args);
  const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">' +
    data.body.replace(/\r\n/g, '\n').split(/\n{2,}/).map(paragraph =>
      '<p style="margin:0 0 16px">' + escape(paragraph).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>'
    ).join('') + '</div>';
  const boundary = 'kitty-' + fingerprint(data).slice(0, 24);
  const encode = value => Buffer.from(value).toString('base64').match(/.{1,76}/g).join('\r\n');
  const lines = [
    'To: ' + data.to.join(', '),
    'Subject: =?UTF-8?B?' + Buffer.from(data.subject).toString('base64') + '?=',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', encode(data.body),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', encode(html),
    '--' + boundary + '--', '',
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

async function search(token, args) {
  if (typeof args.query !== "string" || args.query.length > 1000)
    throw new GmailError(400, "Consulta de Gmail inválida.");
  const limit = args.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new GmailError(400, "El límite debe ser de 1 a 20.");
  const params = new URLSearchParams({
    q: args.query,
    maxResults: String(limit),
  });
  if (args.page_token) params.set("pageToken", args.page_token);
  const result = await callGoogle(token, "messages?" + params);
  // Only fetch metadata in search; full bodies require gmail_read explicitly.
  const messages = await Promise.all(
    (result.messages || []).map(async (item) =>
      messageView(
        await callGoogle(
          token,
          "messages/" + encodeURIComponent(item.id) + "?format=metadata",
        ),
      ),
    ),
  );
  return {
    items: messages,
    next_page_token: result.nextPageToken || "",
    estimated_count: result.resultSizeEstimate || 0,
  };
}
async function read(token, id) {
  return messageView(
    await callGoogle(
      token,
      "messages/" + encodeURIComponent(id) + "?format=full",
    ),
  );
}
async function getDraft(token, id) {
  const draft = await callGoogle(
    token,
    "drafts/" + encodeURIComponent(id) + "?format=full",
  );
  return { draft_id: draft.id, ...messageView(draft.message) };
}
async function createDraft(token, args) {
  const draft = await callGoogle(token, "drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw: mimeMessage(args) } }),
  });
  return {
    ok: true,
    draft_id: draft.id,
    message_id: draft.message?.id,
    sent: false,
  };
}
async function sendDraft(token, id) {
  const result = await callGoogle(token, "drafts/send", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  return {
    ok: true,
    message_id: result.id,
    thread_id: result.threadId,
    sent: true,
  };
}
function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
module.exports = {
  GmailError,
  callGoogle,
  messageView,
  validateDraft,
  mimeMessage,
  search,
  read,
  getDraft,
  createDraft,
  sendDraft,
  fingerprint,
};
