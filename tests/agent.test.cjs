const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/agent");
const { buildPayload } = require("../lib/agent/service");
const originalFetch = global.fetch;
const originalKey = process.env.OPENAI_API_KEY;
after(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});
async function request(body, method = "POST") {
  const res = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(n) {
      this.code = n;
      return this;
    },
    json(data) {
      this.body = JSON.parse(JSON.stringify(data));
      return this;
    },
  };
  await handler({ method, body }, res);
  assert.match(res.headers["Content-Type"], /application\/json/);
  return res;
}
test("HTTP methods, bad JSON, invalid input and missing key return JSON", async () => {
  assert.equal((await request({}, "GET")).code, 405);
  assert.equal((await request("bad json")).code, 400);
  for (const body of [
    null,
    [],
    {},
    { previous_response_id: "x", tool_outputs: [{}] },
  ])
    assert.equal((await request(body)).code, 400);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await request({ message: "Hola" })).code, 503);
});
test("Responses request preserves optional tool schemas and extracts text and calls", async () => {
  process.env.OPENAI_API_KEY = "test-only";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    const payload = JSON.parse(options.body);
    assert.ok(payload.tools.length >= 20);
    assert.ok(payload.tools.some((t) => t.name === "delete_record"));
    assert.ok(payload.tools.some((t) => t.name === "proposal_action"));
    assert.ok(payload.tools.every((t) => t.strict === false));
    assert.match(payload.instructions, /Fecha\/hora/);
    return new Response(
      JSON.stringify({
        id: "resp_1",
        output: [
          { type: "message", content: [{ type: "output_text", text: "Hola" }] },
          {
            type: "function_call",
            call_id: "call_1",
            name: "search_records",
            arguments: '{"query":"Ana"}',
          },
        ],
      }),
    );
  };
  const res = await request({ message: "Busca Ana" });
  assert.equal(res.code, 200);
  assert.equal(res.body.text, "Hola");
  assert.equal(res.body.calls[0].name, "search_records");
});
test("tool continuation sends outputs and repeats instructions", () => {
  const p = buildPayload({
    previous_response_id: "resp_1",
    tool_outputs: [{ call_id: "call_1", output: { count: 0 } }],
  });
  assert.equal(p.previous_response_id, "resp_1");
  assert.equal(p.input[0].output, '{"count":0}');
  assert.ok(p.instructions);
});
test("upstream JSON errors, HTML, malformed success and network failures stay JSON", async () => {
  process.env.OPENAI_API_KEY = "test-only";
  for (const [response, status] of [
    [new Response('{"error":{"message":"Rate limit"}}', { status: 429 }), 429],
    [new Response("The page could not be found", { status: 404 }), 502],
    [new Response("{}"), 502],
  ]) {
    global.fetch = async () => response;
    const res = await request({ message: "Hola" });
    assert.equal(res.code, status);
    assert.equal(typeof res.body.error, "string");
  }
  global.fetch = async () => {
    throw new Error("private network diagnostic");
  };
  const res = await request({ message: "Hola" });
  assert.equal(res.code, 502);
  assert.ok(!res.body.error.includes("private"));
});
test("upstream timeout returns JSON before the function deadline", async (t) => {
  process.env.OPENAI_API_KEY = "test-only";
  t.mock.timers.enable({ apis: ["setTimeout"] });
  global.fetch = async (url, { signal }) =>
    new Promise((resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      }),
    );
  const pending = request({ message: "Hola" });
  t.mock.timers.tick(20000);
  const res = await pending;
  assert.equal(res.code, 504);
  assert.equal(typeof res.body.error, "string");
});
test("a new user message retains previous response context without requiring tool outputs", () => {
  const p = buildPayload({
    message: "Ahora edita ese candidato",
    previous_response_id: "resp_1",
  });
  assert.equal(p.previous_response_id, "resp_1");
  assert.match(p.input[0].content, /Ahora edita/);
});
