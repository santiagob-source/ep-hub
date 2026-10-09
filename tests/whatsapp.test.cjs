const test = require("node:test"),
  assert = require("node:assert/strict");
const provider = require("../lib/whatsapp/provider"),
  store = require("../lib/whatsapp/store"),
  service = require("../lib/whatsapp/service");
const session = require("../lib/gmail/session");
process.env.GMAIL_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.RESPOND_IO_API_TOKEN = "test-token";
process.env.RESPOND_IO_WHATSAPP_CHANNEL_ID = "565351";
process.env.CRON_SECRET = "test-secret".repeat(5);
function fixture() {
  const oldAllowed = process.env.RESPOND_IO_ALLOWED_UIDS;
  process.env.RESPOND_IO_ALLOWED_UIDS = "owner";
  const originals = { provider: { ...provider }, store: { ...store } };
  const docs = new Map();
  let version = 0,
    sent = 0,
    uncertain = false;
  const write = (id, data) => {
    const doc = { id, ...data, _version: String(++version) };
    docs.set(id, doc);
    return structuredClone(doc);
  };
  store.configured = () => true;
  store.get = async (id) => structuredClone(docs.get(id) || null);
  store.create = async (id, data) => {
    if (docs.has(id)) throw new provider.WhatsAppError(409, "exists");
    return write(id, data);
  };
  store.update = async (doc, data) => {
    if (docs.get(doc.id)?._version !== doc._version)
      throw new provider.WhatsAppError(409, "changed");
    return write(doc.id, { ...docs.get(doc.id), ...data });
  };
  store.query = async (filters, limit, order) => {
    let list = [...docs.values()].filter((d) =>
      filters.every(({ fieldFilter: f }) => {
        const val =
          f.value.stringValue ??
          f.value.doubleValue ??
          f.value.arrayValue?.values.map((v) => v.stringValue);
        if (f.op === "IN") return val.includes(d[f.field.fieldPath]);
        return f.op === "EQUAL"
          ? d[f.field.fieldPath] === val
          : f.op === "LESS_THAN_OR_EQUAL"
            ? d[f.field.fieldPath] <= val
            : d[f.field.fieldPath] >= val;
      }),
    );
    if (order)
      list.sort((a, b) =>
        order.startsWith("-")
          ? b[order.slice(1)] - a[order.slice(1)]
          : a[order] - b[order],
      );
    return structuredClone(list.slice(0, limit));
  };
  store.heartbeat = async () => write("worker", { last_run: Date.now() });
  write("worker", { last_run: Date.now() });
  provider.contact = async () => ({ id: 123 });
  provider.assertWindow = async () => {};
  provider.template = async () => ({
    name: "seguimiento",
    languageCode: "es",
    status: "APPROVED",
    components: [{ type: "body", text: "Hola {{1}}, te llamamos mañana." }],
  });
  provider.send = async () => {
    sent++;
    if (uncertain) throw new provider.WhatsAppError(502, "timeout", true);
    return { messageId: 123 };
  };
  provider.messageStatus = async () => ({ status: [{ value: "delivered" }] });
  const args = {
    candidate_id: "c1",
    recipient: "Eva",
    phone: "+34600111222",
    send_at: new Date(Date.now() + 120000).toISOString(),
    template_name: "seguimiento",
    template_language: "es",
    template_parameters: ["Eva"],
  };
  return {
    docs,
    args,
    get sent() {
      return sent;
    },
    uncertain() {
      uncertain = true;
    },
    write,
    restore() {
      if (oldAllowed === undefined) delete process.env.RESPOND_IO_ALLOWED_UIDS;
      else process.env.RESPOND_IO_ALLOWED_UIDS = oldAllowed;
      Object.assign(provider, originals.provider);
      Object.assign(store, originals.store);
    },
  };
}
async function due(f) {
  const prep = await service.prepare("owner", "whatsapp_schedule", f.args);
  const result = await service.execute(
    "owner",
    "whatsapp_schedule",
    f.args,
    prep.capability,
    true,
  );
  const doc = f.docs.get(result.id);
  const payload = session.open(doc.payload, "whatsapp-job", "owner");
  payload.at = Date.now() - 1000;
  f.write(doc.id, {
    ...doc,
    due_at: payload.at,
    payload: session.seal(payload),
  });
  return result;
}
test("Madrid dates respect DST and scheduling requires explicit offset, international phone and bounded future", () => {
  assert.match(service.madrid("2026-10-25T08:00:00Z"), /9:00/);
  assert.match(service.madrid("2026-10-10T08:00:00Z"), /10:00/);
  assert.throws(() =>
    service.validate({
      phone: "600111222",
      recipient: "Eva",
      send_at: "2030-01-01T10:00",
    }),
  );
  assert.throws(() =>
    service.validate({
      phone: "+34600111222",
      recipient: "Eva",
      send_at: "2020-01-01T10:00:00Z",
      message: "Hola",
    }),
  );
});
test("template preview matches provider parameters and rejects incomplete or hidden media/buttons", () => {
  const def = {
    name: "hola",
    languageCode: "es",
    components: [{ type: "body", text: "Hola {{1}}, {{2}}." }],
  };
  const rendered = provider.renderTemplate(def, ["Eva", "mañana"]);
  assert.equal(rendered.text, "Hola Eva, mañana.");
  assert.equal(
    rendered.message.template.components[0].parameters[0].text,
    "Eva",
  );
  assert.throws(() => provider.renderTemplate(def, ["Eva"]));
  assert.throws(() =>
    provider.renderTemplate(
      {
        ...def,
        components: [
          ...def.components,
          { type: "buttons", buttons: [{ url: "https://example.com" }] },
        ],
      },
      ["Eva", "mañana"],
    ),
  );
});
test("preparing never sends; execution binds owner, args and consent and persists once for retries", async () => {
  const f = fixture();
  try {
    const prep = await service.prepare("owner", "whatsapp_schedule", f.args);
    assert.equal(f.sent, 0);
    assert.equal(prep.review.requiresConsent, true);
    assert.equal(
      prep.review.arguments.message,
      "Hola Eva, te llamamos mañana.",
    );
    await assert.rejects(
      service.execute(
        "other",
        "whatsapp_schedule",
        f.args,
        prep.capability,
        true,
      ),
    );
    await assert.rejects(
      service.execute(
        "owner",
        "whatsapp_schedule",
        { ...f.args, phone: "+34600999999" },
        prep.capability,
        true,
      ),
    );
    await assert.rejects(
      service.execute(
        "owner",
        "whatsapp_schedule",
        f.args,
        prep.capability,
        false,
      ),
    );
    const a = await service.execute(
        "owner",
        "whatsapp_schedule",
        f.args,
        prep.capability,
        true,
      ),
      b = await service.execute(
        "owner",
        "whatsapp_schedule",
        f.args,
        prep.capability,
        true,
      );
    assert.equal(a.id, b.id);
    assert.equal(a.status, "pending");
    assert.equal(f.sent, 0);
  } finally {
    f.restore();
  }
});
test("offline worker blocks scheduling; reads isolate owners and cancellation is version-bound", async () => {
  const f = fixture();
  try {
    const prep = await service.prepare("owner", "whatsapp_schedule", f.args);
    const saved = await service.execute(
      "owner",
      "whatsapp_schedule",
      f.args,
      prep.capability,
      true,
    );
    assert.equal((await service.list("other")).items.length, 0);
    assert.equal((await service.list("owner")).items.length, 1);
    await assert.rejects(
      service.prepare("other", "whatsapp_cancel", { schedule_id: saved.id }),
    );
    const args = { schedule_id: saved.id },
      cancel = await service.prepare("owner", "whatsapp_cancel", args);
    await service.execute("owner", "whatsapp_cancel", args, cancel.capability);
    await assert.rejects(
      service.execute("owner", "whatsapp_cancel", args, cancel.capability),
    );
    f.docs.delete("worker");
    await assert.rejects(
      service.prepare("owner", "whatsapp_schedule", f.args),
      /ejecutor/,
    );
  } finally {
    f.restore();
  }
});
test("concurrent cron calls claim a due job once; accepted/actual delivery are distinguished", async () => {
  const f = fixture();
  try {
    await due(f);
    await Promise.all([service.worker(), service.worker()]);
    assert.equal(f.sent, 1);
    assert.equal((await service.list("owner")).items[0].status, "delivered");
  } finally {
    f.restore();
  }
});
test("uncertain responses never resend and very late jobs expire instead of surprising the recipient", async () => {
  const f = fixture();
  try {
    await due(f);
    f.uncertain();
    await service.worker();
    await service.worker();
    assert.equal(f.sent, 1);
    assert.equal((await service.list("owner")).items[0].status, "unknown");
    const saved = await due(f),
      doc = f.docs.get(saved.id),
      payload = session.open(doc.payload, "whatsapp-job", "owner");
    payload.at = Date.now() - 700000;
    f.write(doc.id, {
      ...doc,
      due_at: payload.at,
      payload: session.seal(payload),
    });
    await service.worker();
    assert.equal(f.sent, 1);
    assert.equal(f.docs.get(saved.id).state, "expired");
  } finally {
    f.restore();
  }
});
test("changed template, switched channel and closed 24-hour window never send", async () => {
  const f = fixture();
  try {
    await due(f);
    provider.template = async () => ({
      name: "seguimiento",
      languageCode: "es",
      components: [{ type: "body", text: "Otro texto {{1}}" }],
    });
    await service.worker();
    assert.equal(f.sent, 0);
    provider.template = async () => ({
      name: "seguimiento",
      languageCode: "es",
      components: [{ type: "body", text: "Hola {{1}}, te llamamos mañana." }],
    });
    await due(f);
    process.env.RESPOND_IO_WHATSAPP_CHANNEL_ID = "777";
    await service.worker();
    assert.equal(f.sent, 0);
    process.env.RESPOND_IO_WHATSAPP_CHANNEL_ID = "565351";
    const args = { ...f.args, message: "Hola" };
    delete args.template_name;
    const prep = await service.prepare("owner", "whatsapp_schedule", args);
    const saved = await service.execute(
        "owner",
        "whatsapp_schedule",
        args,
        prep.capability,
        true,
      ),
      doc = f.docs.get(saved.id),
      payload = session.open(doc.payload, "whatsapp-job", "owner");
    payload.at = Date.now() - 1000;
    f.write(doc.id, {
      ...doc,
      due_at: payload.at,
      payload: session.seal(payload),
    });
    provider.assertWindow = async () => {
      throw new provider.WhatsAppError(400, "closed");
    };
    await service.worker();
    assert.equal(f.sent, 0);
  } finally {
    process.env.RESPOND_IO_WHATSAPP_CHANNEL_ID = "565351";
    f.restore();
  }
});
test("provider follows official v2 endpoints and never automatically retries failed POSTs", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (url, opts) => {
    calls++;
    assert.equal(
      url,
      "https://api.respond.io/v2/contact/phone%3A%2B34600111222/message",
    );
    assert.equal(opts.method, "POST");
    assert.equal(JSON.parse(opts.body).channelId, 565351);
    return { ok: false, status: 500, json: async () => ({}) };
  };
  try {
    await assert.rejects(
      provider.send({
        phone: "+34600111222",
        provider_message: { type: "text", text: "Hola" },
      }),
      (e) => e.uncertain === true,
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});
test("worker refuses unauthenticated and malformed calls with JSON", async () => {
  const handler = require("../api/whatsapp-worker");
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
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.code, 401);
  assert.equal(res.data.ok, false);
});

test("Firestore queue uses only kitty-private with encrypted payloads and CAS preconditions", async () => {
  const crypto = require("node:crypto");
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const original = global.fetch;
  process.env.FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON = JSON.stringify({
    project_id: "ep-hub-7c4b9",
    client_email: "test@example.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  const id = crypto.randomUUID();
  let calls = 0;
  global.fetch = async (url, opts) => {
    if (url === "https://oauth2.googleapis.com/token")
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "test" }),
      };
    calls++;
    assert.match(url, /databases\/kitty-private\/documents/);
    assert.ok(!url.includes("/(default)/"));
    if (opts.method === "PATCH")
      assert.ok(url.includes("currentDocument.updateTime=version-1"));
    const fields = opts.body
      ? JSON.parse(opts.body).fields
      : {
          payload: { stringValue: "ciphertext" },
          state: { stringValue: "pending" },
        };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name:
          "projects/ep-hub-7c4b9/databases/kitty-private/documents/whatsapp_jobs/" +
          id,
        fields,
        updateTime: "version-1",
      }),
    };
  };
  try {
    const created = await store.create(id, {
      payload: "ciphertext",
      state: "pending",
      due_at: Date.now(),
    });
    assert.equal(created.payload, "ciphertext");
    await store.update(created, { state: "cancelled" });
    assert.equal(calls, 2);
  } finally {
    global.fetch = original;
    delete process.env.FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON;
  }
});

test("WhatsApp endpoint enforces verified identity, UID allowlist, same-origin and JSON errors", async () => {
  const auth = require("../lib/gmail/auth");
  const original = auth.verifyFirebaseToken,
    originalStatus = service.status;
  auth.verifyFirebaseToken = async () => ({ sub: "owner" });
  service.status = async () => ({ connected: true, scheduler_ready: false });
  delete require.cache[require.resolve("../api/whatsapp")];
  const handler = require("../api/whatsapp");
  async function call(body, method = "POST", origin) {
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
        method,
        headers: {
          authorization: "Bearer test",
          ...(origin ? { origin } : {}),
        },
        body,
      },
      res,
    );
    return res;
  }
  try {
    delete process.env.RESPOND_IO_ALLOWED_UIDS;
    assert.equal(
      (await call({ action: "execute", tool: "whatsapp_status" })).code,
      403,
    );
    process.env.RESPOND_IO_ALLOWED_UIDS = "owner";
    const ok = await call({ action: "execute", tool: "whatsapp_status" });
    assert.equal(ok.code, 200);
    assert.equal(ok.data.scheduler_ready, false);
    assert.equal((await call({}, "GET")).code, 405);
    assert.equal((await call({}, "POST", "https://evil.example")).code, 403);
    assert.equal((await call("{bad")).code, 400);
  } finally {
    auth.verifyFirebaseToken = original;
    service.status = originalStatus;
    delete process.env.RESPOND_IO_ALLOWED_UIDS;
  }
});

test("request deadlines abort provider calls before Vercel timeout and POST ambiguity never retries", async () => {
  const budget = require("../lib/whatsapp/deadline"),
    original = global.fetch;
  let calls = 0;
  global.fetch = async (url, opts) => {
    calls++;
    return new Promise((resolve, reject) =>
      opts.signal.addEventListener(
        "abort",
        () => reject(new Error("timeout")),
        { once: true },
      ),
    );
  };
  try {
    const keepalive = setTimeout(() => {}, 100);
    await assert.rejects(
      budget.run(10, () =>
        provider.send({
          phone: "+34600111222",
          provider_message: { type: "text", text: "Hola" },
        }),
      ),
      (e) => e.uncertain === true,
    );
    clearTimeout(keepalive);
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});
