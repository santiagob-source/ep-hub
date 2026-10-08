const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const gmail = require("../lib/gmail/service"),
  session = require("../lib/gmail/session");
const format = require("../public/agent/message-format");
process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "12".repeat(32);
test("assistant bold formatting escapes HTML before adding strong tags", () => {
  assert.equal(
    format.render(
      "Hecho: **Leonardo**\n- **Nota:** <img src=x onerror=alert(1)>",
    ),
    "Hecho: <strong>Leonardo</strong>\n<ul>\n<li><strong>Nota:</strong> &lt;img src=x onerror=alert(1)&gt;</li>\n</ul>",
  );
});
test("Gmail encrypted sessions bind user, purpose and expiry and reject tampering", () => {
  const value = session.seal({
    kind: "mailbox",
    uid: "a",
    refresh: "secret",
    expires: Date.now() + 60000,
  });
  assert.ok(!value.includes("secret"));
  assert.equal(session.open(value, "mailbox", "a").refresh, "secret");
  assert.throws(() => session.open(value, "mailbox", "b"));
  assert.throws(() => session.open(value, "approval", "a"));
  assert.throws(() => session.open(value.slice(0, -3) + "abc", "mailbox", "a"));
  assert.throws(() =>
    session.open(session.seal({ kind: "approval", expires: 1 }), "approval"),
  );
});
test("draft MIME encodes accents and blocks header injection", () => {
  const raw = Buffer.from(
    gmail.mimeMessage({
      to: ["eva@example.com"],
      subject: "Selección",
      body: "Hola, ¿cómo estás?",
    }),
    "base64url",
  ).toString();
  assert.match(raw, /To: eva@example.com/);
  assert.ok(raw.includes(Buffer.from("Selección").toString("base64")));
  assert.throws(() =>
    gmail.mimeMessage({
      to: ["eva@example.com\r\nBcc: bad@example.com"],
      subject: "a",
      body: "b",
    }),
  );
  assert.throws(() =>
    gmail.mimeMessage({
      to: ["eva@example.com"],
      subject: "a\nBcc: bad@example.com",
      body: "b",
    }),
  );
});
test("draft preview includes hidden recipients, attachments, HTML and revision", () => {
  const view = gmail.messageView({
    id: "x",
    payload: {
      headers: [{ name: "Bcc", value: "a@example.com" }],
      parts: [
        {
          mimeType: "text/html",
          body: { data: Buffer.from("<b>Hola</b>").toString("base64url") },
        },
        { filename: "cv.pdf", mimeType: "application/pdf", body: { size: 30 } },
      ],
    },
  });
  assert.equal(view.bcc, "a@example.com");
  assert.equal(view.body, "<b>Hola</b>");
  assert.equal(view.attachments[0].filename, "cv.pdf");
  assert.ok(view.revision);
});
test("API checks Firebase signatures; writes require a user-bound prepared capability and unchanged draft", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString(
    "base64url",
  );
  const b = Buffer.from(
    JSON.stringify({
      sub: "user-a",
      aud: "ep-hub-7c4b9",
      iss: "https://securetoken.google.com/ep-hub-7c4b9",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const jwt =
    h +
    "." +
    b +
    "." +
    crypto
      .sign("RSA-SHA256", Buffer.from(h + "." + b), privateKey)
      .toString("base64url");
  const original = global.fetch;
  let sends = 0,
    draftBody = "Hola";
  process.env.GOOGLE_CLIENT_ID = "test";
  process.env.GOOGLE_CLIENT_SECRET = "test";
  global.fetch = async (url, options) => {
    if (String(url).includes("/metadata/x509/"))
      return {
        ok: true,
        json: async () => ({
          test: publicKey.export({ type: "spki", format: "pem" }),
        }),
      };
    if (String(url).includes("oauth2.googleapis.com"))
      return { ok: true, json: async () => ({ access_token: "test" }) };
    if (String(url).endsWith("/drafts/send")) {
      sends++;
      return { ok: true, json: async () => ({ id: "sent" }) };
    }
    return {
      ok: true,
      json: async () => ({
        id: "draft-1",
        message: {
          id: "msg-1",
          payload: {
            mimeType: "text/plain",
            headers: [{ name: "To", value: "eva@example.com" }],
            body: { data: Buffer.from(draftBody).toString("base64url") },
          },
        },
      }),
    };
  };
  const handler = require("../api/gmail");
  const cookie =
    "ep_gmail=" +
    session.seal({
      kind: "mailbox",
      uid: "user-a",
      refresh: "test",
      email: "me@example.com",
      expires: Date.now() + 60000,
    });
  async function invoke(body, auth = jwt) {
    const res = {
      setHeader() {},
      status(code) {
        this.code = code;
        return this;
      },
      json(data) {
        this.data = data;
      },
    };
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer " + auth, cookie },
        body,
      },
      res,
    );
    return res;
  }
  try {
    assert.equal(
      (await invoke({ action: "status" }, jwt + "broken")).code,
      401,
    );
    const args = { draft_id: "draft-1" };
    assert.equal(
      (await invoke({ action: "execute", tool: "gmail_send_draft", args }))
        .code,
      401,
    );
    assert.equal(sends, 0);
    const prep = await invoke({
      action: "prepare",
      tool: "gmail_send_draft",
      args,
    });
    assert.equal(prep.code, 200);
    assert.equal(prep.data.review.arguments.to, "eva@example.com");
    draftBody = "Otro texto";
    assert.equal(
      (
        await invoke({
          action: "execute",
          tool: "gmail_send_draft",
          args,
          capability: prep.data.capability,
        })
      ).code,
      409,
    );
    assert.equal(sends, 0);
    draftBody = "Hola";
    assert.equal(
      (
        await invoke({
          action: "execute",
          tool: "gmail_send_draft",
          args,
          capability: prep.data.capability,
        })
      ).code,
      200,
    );
    assert.equal(sends, 1);
  } finally {
    global.fetch = original;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});
