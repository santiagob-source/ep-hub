const budget = require("./deadline");
// Dedicated private database: never reads/writes the Hub's shared state or default DB.
const crypto = require("node:crypto");
const { WhatsAppError } = require("./provider");
const ROOT = "projects/ep-hub-7c4b9/databases/kitty-private/documents";
let cached;
function configured() {
  return !!process.env.FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON;
}
async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  let account;
  try {
    account = JSON.parse(
      process.env.FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON || "",
    );
  } catch {
    throw new WhatsAppError(
      503,
      "Falta configurar el almacenamiento privado de WhatsApp.",
    );
  }
  if (
    account.project_id !== "ep-hub-7c4b9" ||
    !account.private_key ||
    !account.client_email
  )
    throw new WhatsAppError(
      503,
      "La cuenta de servicio de WhatsApp no corresponde al proyecto del Hub.",
    );
  const now = Math.floor(Date.now() / 1000),
    encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
  const input =
    encode({ alg: "RS256", typ: "JWT" }) +
    "." +
    encode({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });
  const assertion =
    input +
    "." +
    crypto
      .sign("RSA-SHA256", Buffer.from(input), account.private_key)
      .toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: budget.signal(5000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token)
    throw new WhatsAppError(
      503,
      "No se pudo acceder al almacenamiento privado de WhatsApp.",
    );
  cached = { token: data.access_token, expires: Date.now() + 3000000 };
  return cached.token;
}
function value(v) {
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { doubleValue: v };
  return { stringValue: String(v) };
}
function fields(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, value(v)]),
  );
}
function decode(doc) {
  if (!doc?.fields) return null;
  return {
    id: doc.name.split("/").pop(),
    ...Object.fromEntries(
      Object.entries(doc.fields).map(([k, v]) => [
        k,
        v.stringValue ??
          v.doubleValue ??
          (v.integerValue !== undefined
            ? Number(v.integerValue)
            : (v.booleanValue ?? null)),
      ]),
    ),
    _version: doc.updateTime,
  };
}
async function request(path, method = "GET", body) {
  const response = await fetch(
    "https://firestore.googleapis.com/v1/" + ROOT + path,
    {
      method,
      headers: {
        Authorization: "Bearer " + (await accessToken()),
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: budget.signal(5000),
    },
  );
  const data = await response.json();
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok) {
    // runQuery can return a streamed error inside a JSON array.
    const googleError = Array.isArray(data)
      ? data.find((entry) => entry?.error)?.error
      : data?.error;
    const reason = googleError?.status;
    const explanations = {
      PERMISSION_DENIED: "Google denegó el acceso a kitty-private. Revisá el rol y la condición IAM de kitty-whatsapp.",
      FAILED_PRECONDITION: "Firestore requiere configurar los índices de whatsapp_jobs en kitty-private. Revisá docs/whatsapp/firestore-private.indexes.json.",
      NOT_FOUND: "Google no encontró la base kitty-private en el proyecto ep-hub-7c4b9.",
      UNAUTHENTICATED: "Google rechazó la autenticación de la cuenta de servicio de WhatsApp.",
    };
    throw new WhatsAppError(
      response.status === 409 || response.status === 412 ? 409 : 503,
      response.status === 409 || response.status === 412
        ? "El envío cambió. Consultalo y confirmá nuevamente."
        : explanations[reason] || `No se pudo acceder a kitty-private (HTTP ${response.status}). Revisá la base, permisos e índice de la cola.`,
    );
  }
  return data;
}
async function get(id) {
  if (!/^[a-f0-9-]{16,80}$/.test(id) && id !== "worker")
    throw new WhatsAppError(400, "Identificador de programación inválido.");
  return decode(await request("/whatsapp_jobs/" + id));
}
async function create(id, data) {
  return decode(
    await request("/whatsapp_jobs?documentId=" + id, "POST", {
      fields: fields(data),
    }),
  );
}
async function update(doc, data) {
  const params = new URLSearchParams({
    "currentDocument.updateTime": doc._version,
  });
  Object.keys(data).forEach((k) => params.append("updateMask.fieldPaths", k));
  return decode(
    await request("/whatsapp_jobs/" + doc.id + "?" + params, "PATCH", {
      fields: fields(data),
    }),
  );
}
async function query(filters, limit = 50, order) {
  const structuredQuery = {
    from: [{ collectionId: "whatsapp_jobs" }],
    where:
      filters.length === 1
        ? filters[0]
        : { compositeFilter: { op: "AND", filters } },
    limit,
    ...(order
      ? {
          orderBy: [
            {
              field: { fieldPath: order.replace(/^-/, "") },
              direction: order.startsWith("-") ? "DESCENDING" : "ASCENDING",
            },
          ],
        }
      : {}),
  };
  const result = await request(":runQuery", "POST", { structuredQuery });
  return (result || [])
    .filter((r) => r.document)
    .map((r) => decode(r.document));
}
const filter = (field, op, v) => ({
  fieldFilter: { field: { fieldPath: field }, op, value: value(v) },
});
async function heartbeat() {
  let doc = await get("worker");
  const data = { last_run: Date.now() };
  return doc ? update(doc, data) : create("worker", data);
}
module.exports = { configured, get, create, update, query, filter, heartbeat };
