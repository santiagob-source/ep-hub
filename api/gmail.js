const crypto = require("node:crypto");
const gmail = require("../lib/gmail/service");
const { verifyFirebaseToken } = require("../lib/gmail/auth");
const session = require("../lib/gmail/session");
const ORIGIN = "https://expansion-people-recruiter.vercel.app";
const CALLBACK = ORIGIN + "/api/gmail";
const scope =
  "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";
function configured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    /^[a-fA-F0-9]{64}$/.test(process.env.GMAIL_TOKEN_ENCRYPTION_KEY || "")
  );
}
async function oauth(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
    signal: AbortSignal.timeout(6000),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token)
    throw new gmail.GmailError(
      401,
      "Google rechazó la conexión. Volvé a conectar Gmail.",
    );
  return data;
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const url = new URL(req.url, ORIGIN);
      const saved = session.open(session.cookies(req).ep_gmail_state, "oauth");
      if (
        url.searchParams.get("state") !== saved.state ||
        !url.searchParams.get("code")
      )
        throw new gmail.GmailError(
          400,
          "Google no autorizó la conexión de Gmail.",
        );
      const token = await oauth({
        grant_type: "authorization_code",
        code: url.searchParams.get("code"),
        redirect_uri: CALLBACK,
        code_verifier: saved.verifier,
      });
      if (
        !token.refresh_token ||
        !scope
          .split(" ")
          .every((s) => (token.scope || "").split(" ").includes(s))
      )
        throw new gmail.GmailError(
          403,
          "Concedé los permisos de lectura y borradores para conectar Gmail.",
        );
      const profile = await gmail.callGoogle(token.access_token, "profile");
      res.setHeader("Set-Cookie", [
        session.cookie(
          "ep_gmail",
          session.seal({
            kind: "mailbox",
            uid: saved.uid,
            refresh: token.refresh_token,
            email: profile.emailAddress,
            expires: Date.now() + 30 * 86400000,
          }),
          30 * 86400,
        ),
        session.cookie("ep_gmail_state", "", 0),
      ]);
      res.statusCode = 303;
      res.setHeader("Location", ORIGIN + "/?gmail=connected");
      res.end();
      return;
    }
    if (req.method !== "POST")
      throw new gmail.GmailError(405, "Método no permitido.");
    if (req.headers.origin && req.headers.origin !== ORIGIN)
      throw new gmail.GmailError(403, "Origen no permitido.");
    const user = await verifyFirebaseToken(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
    );
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (body.action === "status") {
      let account = null;
      try {
        account = session.open(
          session.cookies(req).ep_gmail,
          "mailbox",
          user.sub,
        );
      } catch {}
      res
        .status(200)
        .json({
          configured: configured(),
          connected: !!account,
          email: account?.email || "",
        });
      return;
    }
    if (body.action === "disconnect") {
      res.setHeader("Set-Cookie", session.cookie("ep_gmail", "", 0));
      res.status(200).json({ ok: true });
      return;
    }
    if (!configured())
      throw new gmail.GmailError(
        503,
        "Falta configurar Google OAuth y la clave de cifrado de Gmail en Vercel.",
      );
    if (body.action === "connect") {
      const state = crypto.randomBytes(24).toString("base64url"),
        verifier = crypto.randomBytes(32).toString("base64url");
      res.setHeader(
        "Set-Cookie",
        session.cookie(
          "ep_gmail_state",
          session.seal({
            kind: "oauth",
            state,
            verifier,
            uid: user.sub,
            expires: Date.now() + 600000,
          }),
          600,
        ),
      );
      const query = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: CALLBACK,
        response_type: "code",
        scope,
        state,
        code_challenge: crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      });
      res
        .status(200)
        .json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + query });
      return;
    }
    const account = session.open(
      session.cookies(req).ep_gmail,
      "mailbox",
      user.sub,
    );
    const token = (
      await oauth({
        grant_type: "refresh_token",
        refresh_token: account.refresh,
      })
    ).access_token;
    const args = body.args || {},
      tool = body.tool;
    let result;
    if (body.action === "prepare") {
      let review, fingerprint;
      if (tool === "gmail_create_draft") review = gmail.validateDraft(args);
      else if (tool === "gmail_send_draft") {
        review = await gmail.getDraft(token, args.draft_id);
        fingerprint = gmail.fingerprint(review);
      } else throw new gmail.GmailError(400, "Acción de Gmail inválida.");
      result = {
        capability: session.seal({
          kind: "approval",
          uid: user.sub,
          email: account.email,
          tool,
          hash: gmail.fingerprint(args),
          fingerprint,
          expires: Date.now() + 300000,
        }),
        review: {
          title:
            tool === "gmail_send_draft"
              ? "Enviar correo desde " + account.email
              : "Crear borrador en " + account.email,
          arguments: review,
          effects:
            tool === "gmail_send_draft"
              ? "Se enviará este borrador a los destinatarios indicados."
              : "Se guardará el borrador. No se enviará ningún correo.",
        },
      };
    } else if (body.action === "execute") {
      if (["gmail_create_draft", "gmail_send_draft"].includes(tool)) {
        const approval = session.open(body.capability, "approval", user.sub);
        if (
          approval.email !== account.email ||
          approval.tool !== tool ||
          approval.hash !== gmail.fingerprint(args)
        )
          throw new gmail.GmailError(
            409,
            "La acción cambió. Revisala y confirmala de nuevo.",
          );
        if (
          tool === "gmail_send_draft" &&
          approval.fingerprint !==
            gmail.fingerprint(await gmail.getDraft(token, args.draft_id))
        )
          throw new gmail.GmailError(
            409,
            "El borrador cambió en Gmail. Revisalo y confirmalo nuevamente.",
          );
      }
      if (tool === "gmail_search") result = await gmail.search(token, args);
      else if (tool === "gmail_read")
        result = await gmail.read(token, args.message_id);
      else if (tool === "gmail_get_draft")
        result = await gmail.getDraft(token, args.draft_id);
      else if (tool === "gmail_create_draft")
        result = await gmail.createDraft(token, args);
      else if (tool === "gmail_send_draft")
        result = await gmail.sendDraft(token, args.draft_id);
      else throw new gmail.GmailError(400, "Herramienta de Gmail desconocida.");
    } else throw new gmail.GmailError(400, "Acción desconocida.");
    res.status(200).json(result);
  } catch (error) {
    res
      .status(error instanceof SyntaxError ? 400 : error.status || 502)
      .json({
        ok: false,
        error: error.status
          ? error.message
          : "No se pudo completar la operación de Gmail.",
      });
  }
};
