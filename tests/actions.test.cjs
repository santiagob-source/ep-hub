const { test } = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../public/agent/catalog");
const Hub = require("../public/agent/hub-actions");
const Engine = require("../public/agent/engine");
const Runtime = require("../public/agent/runtime");
function setup(adapters) {
  let next = 0,
    saves = 0;
  const state = Object.fromEntries(
    Object.keys(catalog.entities)
      .filter((k) => k !== "focusActivities")
      .map((k) => [k, []]),
  );
  state.currentUser = "Santi";
  state.pomodoro = {
    activities: [],
    minutes: 25,
    remaining: 1500,
    running: false,
  };
  state.dashWidgets = [];
  const hub = Hub.create({
    getState: () => state,
    uid: () => `id-${++next}`,
    save: () => saves++,
    schedule() {},
    notify() {},
    generateProposal: () => "<html>proposal</html>",
  });
  const functions = new Proxy(
    { calcTotals: () => ({ total: 0 }) },
    { get: (o, k) => o[k] || (() => {}) },
  );
  const engine = Engine.create({
    adapters,
    hub,
    getState: () => state,
    normalize: Hub.norm,
    save: () => saves++,
    functions,
  });
  const plan = (name, args) =>
    engine.prepare({
      call_id: `call-${++next}`,
      name,
      arguments: JSON.stringify(args),
    });
  const write = async (name, args) => {
    const p = plan(name, args);
    return engine.execute(p, engine.approval([p]));
  };
  return {
    state,
    hub,
    engine,
    plan,
    write,
    get saves() {
      return saves;
    },
  };
}
test("every editable entity uses the same create, patch, read and delete actions", async () => {
  const s = setup();
  for (const [entity, spec] of Object.entries(catalog.entities)) {
    const data = {
      ...spec.defaults,
      [spec.required]: entity === "fichajes" ? "2026-10-08" : "Test " + entity,
    };
    if (entity === "fichajes") data.entrada = "2026-10-08T09:00:00Z";
    const p = s.plan("create_record", { entity, data });
    await assert.rejects(s.engine.execute(p), /Confirmación/);
    assert.equal(s.hub.list(entity).length, 0);
    const out = await s.engine.execute(p, s.engine.approval([p]));
    assert.equal(out.ok, true);
    const id = out.record.id;
    const patch =
      entity === "fichajes"
        ? { notas: "Editada" }
        : { [spec.required]: "Editado " + entity };
    await s.write("update_record", { entity, id, data: patch });
    const read = await s.engine.execute(s.plan("get_record", { entity, id }));
    assert.equal(read[Object.keys(patch)[0]], Object.values(patch)[0]);
    await s.write("delete_record", { entity, id });
    assert.equal(s.hub.list(entity).length, 0);
  }
});
test("updates preserve unmentioned data, attachments, proposals and task/calendar synchronization", async () => {
  const s = setup(),
    c = s.hub.save("candidates", null, { name: "Ana", notes: "No borrar" });
  s.state.candidates[0].files = {
    cv: { name: "cv.pdf", data: "data:application/pdf;base64,test" },
  };
  await s.write("update_record", {
    entity: "candidates",
    id: c.id,
    data: { phone: "612345678" },
  });
  assert.equal(s.state.candidates[0].notes, "No borrar");
  assert.equal(s.state.candidates[0].files.cv.name, "cv.pdf");
  const t = s.hub.save("tasks", null, {
    title: "Llamar",
    due: "2026-10-09T10:00",
  });
  assert.equal(s.state.events[0].taskId, t.id);
  await s.write("update_record", {
    entity: "tasks",
    id: t.id,
    data: { title: "Llamar mañana" },
  });
  assert.equal(s.state.events[0].title, "Llamar mañana");
  await s.write("update_record", {
    entity: "tasks",
    id: t.id,
    data: { due: "" },
  });
  assert.equal(s.state.events.length, 0);
  await s.write("update_record", {
    entity: "tasks",
    id: t.id,
    data: { due: "2026-10-09T12:00" },
  });
  assert.equal(s.state.events.length, 1);
  await s.write("delete_record", { entity: "tasks", id: t.id });
  assert.equal(s.state.events.length, 0);
});
test("pipeline linking, movement, notes and unlinking use exact IDs and preserve relationships", async () => {
  const s = setup(),
    c = s.hub.save("candidates", null, { name: "Ana" }),
    client = s.hub.save("clients", null, { name: "Clínica" }),
    j = s.hub.save("jobs", null, { title: "Médico", client: client.name });
  await s.write("pipeline_action", {
    action: "link",
    candidate_id: c.id,
    job_id: j.id,
    stage: "Contactado",
  });
  await s.write("pipeline_action", {
    action: "move",
    candidate_id: c.id,
    job_id: j.id,
    stage: "Entrevista",
  });
  assert.equal(s.state.jobs[0].pipeline[0].stage, "Entrevista");
  await s.write("candidate_note", {
    action: "add",
    candidate_id: c.id,
    text: "Disponible",
  });
  await s.write("candidate_note", {
    action: "update",
    candidate_id: c.id,
    index: 0,
    text: "Disponible en noviembre",
  });
  assert.equal(
    s.state.candidates[0].callNotes[0].text,
    "Disponible en noviembre",
  );
  await s.write("update_record", {
    entity: "candidates",
    id: c.id,
    data: { name: "Ana María" },
  });
  assert.equal(s.state.jobs[0].pipeline[0].name, "Ana María");
  await s.write("pipeline_action", {
    action: "unlink",
    candidate_id: c.id,
    job_id: j.id,
  });
  assert.equal(s.state.jobs[0].pipeline.length, 0);
  assert.equal(s.state.candidates[0].jobs, "");
  await s.write("candidate_note", {
    action: "delete",
    candidate_id: c.id,
    index: 0,
  });
  assert.equal(s.state.candidates[0].callNotes.length, 0);
});
test("unknown tools, malformed args, protected fields and stale/repeated/forged approvals fail closed", async () => {
  const s = setup();
  assert.throws(() => s.plan("invented_tool", {}), /no disponible/);
  assert.throws(
    () =>
      s.engine.prepare({
        call_id: "x",
        name: "delete_record",
        arguments: "not json",
      }),
    /JSON inválidos/,
  );
  assert.throws(
    () =>
      s.plan("create_record", {
        entity: "candidates",
        data: { name: "Ana", files: {} },
      }),
    /no editable/,
  );
  assert.throws(
    () =>
      s.plan("create_record", {
        entity: "candidates",
        data: { name: "Ana", id: "evil" },
      }),
    /no editable/,
  );
  const p = s.plan("create_record", {
      entity: "candidates",
      data: { name: "Ana" },
    }),
    token = s.engine.approval([p]);
  s.hub.save("notas", null, { title: "Un cambio externo" });
  await assert.rejects(s.engine.execute(p, token), /datos cambiados/);
  const fresh = s.engine.approval([p]);
  await s.engine.execute(p, fresh);
  await assert.rejects(s.engine.execute(p, fresh), /Confirmación/);
  await assert.rejects(
    s.engine.execute({ ...p, effect: "read" }),
    /no verificado/,
  );
  assert.ok(Object.isFrozen(p.args.data));
});
test("duplicate names are returned for user disambiguation instead of guessed", async () => {
  const s = setup();
  s.hub.save("candidates", null, { name: "Ana" });
  s.hub.save("candidates", null, { name: "Ana" });
  const out = await s.engine.execute(
    s.plan("search_records", { entity: "candidates", query: "Ana" }),
  );
  assert.equal(out.count, 2);
  assert.notEqual(out.items[0].id, out.items[1].id);
  assert.throws(
    () => s.plan("delete_record", { entity: "candidates", id: "Ana" }),
    /no encontrado/,
  );
});
test("runtime preserves order, pauses writes, rejects stale buttons and reports cancellation to the model", async () => {
  const s = setup(),
    events = [],
    payloads = [];
  const calls = [
    {
      call_id: "read",
      name: "search_records",
      arguments: '{"entity":"notas"}',
    },
    {
      call_id: "write",
      name: "create_record",
      arguments: '{"entity":"notas","data":{"title":"Nueva"}}',
    },
    {
      call_id: "after",
      name: "search_records",
      arguments: '{"entity":"notas"}',
    },
  ];
  let turn = 0;
  const runtime = Runtime.create({
    engine: s.engine,
    fetch: async (url, o) => {
      payloads.push(JSON.parse(o.body));
      return new Response(
        JSON.stringify({
          response_id: "resp_" + ++turn,
          text: "",
          calls: turn === 1 ? calls : [],
        }),
      );
    },
    context: () => ({}),
    setBusy() {},
    message: (...x) => events.push(x),
    review: (...x) => events.push(["review", ...x]),
    showResult: (p, r) => events.push([p.name, r]),
    finishReview() {},
  });
  await runtime.send("Crea una nota");
  assert.equal(s.state.notas.length, 0);
  assert.ok(runtime.pending);
  const id = runtime.pending.id;
  await runtime.approve("obsolete");
  assert.equal(s.state.notas.length, 0);
  await runtime.approve(id);
  assert.equal(s.state.notas.length, 1);
  assert.equal(payloads[1].tool_outputs.length, 3);
  assert.equal(payloads[1].tool_outputs[2].output.count, 1);
  await runtime.approve(id);
  assert.equal(s.state.notas.length, 1);
  // Another proposal is cancelled without mutation.
  const runtime2 = Runtime.create({
    engine: s.engine,
    fetch: async (url, o) => {
      const p = JSON.parse(o.body);
      payloads.push(p);
      return new Response(
        JSON.stringify({
          response_id: "cancel",
          text: "",
          calls: p.message
            ? [
                {
                  call_id: "del",
                  name: "delete_record",
                  arguments: JSON.stringify({
                    entity: "notas",
                    id: s.state.notas[0].id,
                  }),
                },
              ]
            : [],
        }),
      );
    },
    context: () => ({}),
    setBusy() {},
    message() {},
    review() {},
    showResult() {},
  });
  await runtime2.send("Elimina la nota");
  await runtime2.reject(runtime2.pending.id);
  assert.equal(s.state.notas.length, 1);
  assert.equal(payloads.at(-1).tool_outputs[0].output.cancelled, true);
});
test("proposal CRUD preserves local attachments and uses the Hub generator", async () => {
  const s = setup(),
    c = s.hub.save("clients", null, { name: "Clínica" });
  const created = await s.write("proposal_action", {
    action: "create",
    client_id: c.id,
    data: { feeLines: [{ perfil: "Médico", valor: "16" }] },
  });
  const p = s.state.clients[0].proposals[0];
  p.signedFile = { name: "firma.pdf", data: "data:test" };
  await s.write("proposal_action", {
    action: "update",
    client_id: c.id,
    proposal_id: created.proposal_id,
    data: { validity: "Diciembre" },
  });
  assert.equal(s.state.clients[0].proposals[0].signedFile.name, "firma.pdf");
  assert.equal(
    s.state.clients[0].proposals[0].generatedContent,
    "<html>proposal</html>",
  );
  await s.write("proposal_action", {
    action: "delete",
    client_id: c.id,
    proposal_id: created.proposal_id,
  });
  assert.equal(s.state.clients[0].proposals.length, 0);
});
test("changed data requires a new review and retains outputs of already executed reads", async () => {
  const s = setup(),
    payloads = [],
    reviews = [];
  let turn = 0;
  const runtime = Runtime.create({
    engine: s.engine,
    fetch: async (url, o) => {
      payloads.push(JSON.parse(o.body));
      return new Response(
        JSON.stringify({
          response_id: "resp_" + ++turn,
          text: "",
          calls:
            turn === 1
              ? [
                  {
                    call_id: "r",
                    name: "search_records",
                    arguments: '{"entity":"notas"}',
                  },
                  {
                    call_id: "w",
                    name: "create_record",
                    arguments: '{"entity":"notas","data":{"title":"A"}}',
                  },
                ]
              : [],
        }),
      );
    },
    context: () => ({}),
    setBusy() {},
    message() {},
    review: (id) => reviews.push(id),
    showResult() {},
    finishReview() {},
  });
  await runtime.send("Crear");
  const old = runtime.pending.id;
  s.hub.save("notas", null, { title: "Otro usuario" });
  await runtime.approve(old);
  assert.notEqual(runtime.pending.id, old);
  assert.equal(s.state.notas.length, 1);
  await runtime.approve(old);
  assert.equal(s.state.notas.length, 1);
  await runtime.approve(runtime.pending.id);
  assert.equal(s.state.notas.length, 2);
  assert.deepEqual(
    payloads.at(-1).tool_outputs.map((o) => o.call_id),
    ["r", "w"],
  );
});
test("future integration adapters inherit write approval without changing the runtime", async () => {
  const s = setup();
  let sent = 0;
  s.engine.register(
    {
      name: "example_external_send",
      effect: "write",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      check(args) {
        assert.equal(typeof args.text, "string");
      },
      execute() {
        sent++;
        return { ok: true };
      },
    },
  );
  const plan = s.plan("example_external_send", { text: "Example" });
  await assert.rejects(s.engine.execute(plan), /Confirmación/);
  assert.equal(sent, 0);
  await s.engine.execute(plan, s.engine.approval([plan]));
  assert.equal(sent, 1);
});
test("typed search filters distinguish pending tasks from completed tasks", async () => {
  const s = setup();
  s.hub.save("tasks", null, { title: "Pendiente", done: false });
  s.hub.save("tasks", null, { title: "Hecha", done: true });
  const result = await s.engine.execute(
    s.plan("search_records", { entity: "tasks", filters: { done: false } }),
  );
  assert.equal(result.count, 1);
  assert.equal(result.items[0].title, "Pendiente");
});
test("passive timer ticks do not invalidate approvals, but actual focus changes do", async () => {
  const s = setup();
  s.state.pomodoro.running = true;
  const p = s.plan("create_record", {
    entity: "notas",
    data: { title: "Nota" },
  });
  const grant = s.engine.approval([p]);
  s.state.pomodoro.remaining--;
  await s.engine.execute(p, grant);
  assert.equal(s.state.notas.length, 1);
  const p2 = s.plan("create_record", {
    entity: "notas",
    data: { title: "Otra" },
  });
  const grant2 = s.engine.approval([p2]);
  s.state.pomodoro.running = false;
  await assert.rejects(s.engine.execute(p2, grant2), /datos cambiados/);
});
test("client references resolve accents, partial names, abbreviations, small typos and IDs before confirmation", async () => {
  const s = setup(),
    c = s.hub.save("clients", null, {
      name: "Policlínica Nuestra Señora del Rosario",
    });
  for (const reference of [
    "Rosario",
    "policlinica nuestra senora del rosario",
    "Policlinica Ntra. Sra. del Rosario",
    "Rosairo",
    c.id,
  ]) {
    const p = s.plan("create_record", {
      entity: "jobs",
      data: { title: "Enfermería", client: reference },
    });
    assert.equal(p.args.data.client, c.name);
    assert.equal(p.review.arguments.data.client, c.name);
    await assert.rejects(s.engine.execute(p), /Confirmación/);
    const out = await s.engine.execute(p, s.engine.approval([p]));
    assert.equal(out.record.client, c.name);
  }
  const result = await s.engine.execute(
    s.plan("search_records", {
      entity: "clients",
      query: "Policlinica Ntra. Sra. del Rosario",
    }),
  );
  assert.equal(result.items[0].id, c.id);
});
test("ambiguous client fragments require a choice and never create an unlinked record", () => {
  const s = setup();
  s.hub.save("clients", null, { name: "Clínica Rosario Norte" });
  s.hub.save("clients", null, { name: "Clínica Rosario Sur" });
  assert.throws(
    () =>
      s.plan("create_record", {
        entity: "jobs",
        data: { title: "Enfermería", client: "Rosario" },
      }),
    /varias coincidencias/,
  );
  assert.equal(s.state.jobs.length, 0);
});
test("task links resolve partial client names while short unrelated names never fuzzy-match", async () => {
  const s = setup();
  s.hub.save("clients", null, { name: "Hospital VIC Barcelona" });
  const task = await s.write("create_record", {
    entity: "tasks",
    data: { title: "Llamar a Eva", linkedTo: "vic" },
  });
  assert.equal(task.record.linkedTo, "Hospital VIC Barcelona");
  assert.throws(
    () =>
      s.plan("create_record", {
        entity: "tasks",
        data: { title: "Otra", linkedTo: "VIP" },
      }),
    /No encontré/,
  );
});

test("external staging shows real mailbox preview and never grants write approval", async () => {
  let sent = 0;
  const { engine } = setup({
    gmail_send_draft: {
      stage: async () => ({
        capability: "private-token",
        review: {
          title: "Enviar a Eva",
          arguments: { to: "eva@example.com", body: "Hola" },
          effects: "Enviar",
        },
      }),
      execute: async (args, context) => {
        assert.equal(context.capability, "private-token");
        sent++;
        return { ok: true };
      },
    },
  });
  const plan = engine.prepare({
    name: "gmail_send_draft",
    call_id: "mail-1",
    arguments: { draft_id: "draft-1" },
  });
  await engine.stage(plan);
  assert.equal(engine.review(plan).arguments.to, "eva@example.com");
  await assert.rejects(engine.execute(plan), /Confirmación/);
  assert.equal(sent, 0);
  const approval = engine.approval([plan]);
  await engine.execute(plan, approval);
  assert.equal(sent, 1);
  await assert.rejects(engine.execute(plan, approval), /Confirmación/);
  assert.equal(sent, 1);
});

test('editing a Gmail proposal stages fresh content and requires a new confirmation', async () => {
  const staged = [], executed = [];
  const s = setup({ gmail_create_draft: {
    stage: async args => { staged.push(structuredClone(args)); return { review: { title: 'Borrador', data: args } }; },
    execute: async args => { executed.push(structuredClone(args)); return { ok: true }; },
  } });
  let turn = 0;
  const runtime = Runtime.create({
    engine: s.engine, context: () => ({}), setBusy() {}, message() {}, review() {}, showResult() {}, finishReview() {},
    fetch: async () => new Response(JSON.stringify({ response_id: 'edit-' + ++turn, text: '', calls: turn === 1 ? [{ call_id: 'draft', name: 'gmail_create_draft', arguments: JSON.stringify({ to: ['alba@example.com'], subject: 'Original', body: 'Original' }) }] : [] })),
  });
  await runtime.send('Prepará un borrador');
  const oldId = runtime.pending.id;
  await runtime.editDraft(oldId, { subject: 'Editado', body: 'Texto corregido\nGracias' });
  assert.equal(executed.length, 0);
  assert.equal(staged.length, 2);
  assert.notEqual(runtime.pending.id, oldId);
  await runtime.approve(oldId);
  assert.equal(executed.length, 0);
  await runtime.approve(runtime.pending.id);
  assert.deepEqual(executed, [{ to: ['alba@example.com'], subject: 'Editado', body: 'Texto corregido\nGracias' }]);
});

test('a failed result card cannot report an already created Gmail draft as failed', async () => {
  const s = setup({ gmail_create_draft: { execute: async () => ({ ok: true, draft_id: 'created', sent: false }) } });
  let turn = 0;
  const payloads = [];
  const runtime = Runtime.create({
    engine: s.engine, context: () => ({}), setBusy() {}, message() {}, review() {}, finishReview() {},
    showResult() { throw Error('Broken rendering'); },
    fetch: async (url, options) => {
      payloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ response_id: 'result-' + ++turn, text: '', calls: turn === 1 ? [{ call_id: 'draft', name: 'gmail_create_draft', arguments: JSON.stringify({ to: ['alba@example.com'], subject: 'Hola', body: 'Hola' }) }] : [] }));
    },
  });
  await runtime.send('Prepará un borrador');
  await runtime.approve(runtime.pending.id);
  assert.deepEqual(payloads[1].tool_outputs[0].output, { ok: true, draft_id: 'created', sent: false });
});

test('new vacancies default to People while editing legacy vacancies preserves Business and billing',()=>{
 const s=setup();
 const created=s.hub.save('jobs',null,{title:'Nueva'});
 assert.equal(created.businessArea,'Expansion People');
 s.state.jobs.push({id:'old',title:'Anterior',status:'En proceso',jobStatus:'Facturado',pipeline:[],feePercent:10,salaryAgreed:30000});
 const edited=s.hub.save('jobs','old',{status:'Cubierto',notes:'Actualizada'});
 assert.equal(edited.businessArea,'Expansion Business');assert.equal(edited.jobStatus,'Facturado');assert.equal(edited.processStatus,'Cubierto');
 const moved=s.hub.save('jobs','old',{businessArea:'Expansion People'});
 assert.equal(moved.businessArea,'Expansion People');assert.equal(moved.jobStatus,'Facturado');
});
