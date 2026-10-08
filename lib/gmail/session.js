const crypto = require("node:crypto");
const { GmailError } = require("./service");
function key() {
  const value = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new GmailError(
      503,
      "Falta configurar la conexión de Gmail en el servidor.",
    );
  return Buffer.from(value, "hex");
}
function seal(data) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(data)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
function open(value, kind, uid) {
  try {
    const bytes = Buffer.from(value || "", "base64url");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key(),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
    if (
      data.kind !== kind ||
      data.expires <= Date.now() ||
      (uid && data.uid !== uid)
    )
      throw Error();
    return data;
  } catch {
    throw new GmailError(
      401,
      "La autorización de Gmail venció o no corresponde a tu usuario. Conectá de nuevo.",
    );
  }
}
function cookie(name, value, age) {
  return `${name}=${value}; Max-Age=${age}; Path=/api/gmail; HttpOnly; Secure; SameSite=Lax`;
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "").split(";").map((x) => x.trim().split("=")),
  );
}
module.exports = { seal, open, cookie, cookies };
