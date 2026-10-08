const { verify, createPublicKey } = require("node:crypto");
const { GmailError } = require("./service");
const PROJECT = "ep-hub-7c4b9";
let certificates = null,
  certificatesExpire = 0;
async function verifyFirebaseToken(token) {
  try {
    if (typeof token !== "string" || token.length > 12000) throw Error();
    const [headerText, bodyText, signature, extra] = token.split(".");
    if (extra || !signature) throw Error();
    const header = JSON.parse(Buffer.from(headerText, "base64url").toString());
    const claims = JSON.parse(Buffer.from(bodyText, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (
      header.alg !== "RS256" ||
      claims.aud !== PROJECT ||
      claims.iss !== "https://securetoken.google.com/" + PROJECT ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= now ||
      !Number.isFinite(claims.iat) ||
      claims.iat > now + 60
    )
      throw Error();
    if (!certificates || certificatesExpire <= Date.now()) {
      const response = await fetch(
        "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) throw Error();
      certificates = await response.json();
      certificatesExpire = Date.now() + 300000;
    }
    if (
      !Object.hasOwn(certificates, header.kid) ||
      !verify(
        "RSA-SHA256",
        Buffer.from(headerText + "." + bodyText),
        createPublicKey(certificates[header.kid]),
        Buffer.from(signature, "base64url"),
      )
    )
      throw Error();
    return claims;
  } catch {
    throw new GmailError(
      401,
      "Iniciá sesión en el Hub antes de conectar Gmail.",
    );
  }
}
module.exports = { verifyFirebaseToken };
