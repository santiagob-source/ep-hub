// Existing Chromium + Playwright; no Firebase credentials, remote writes or OpenAI calls.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const handler = require("../api/agent");
(async () => {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/api/agent") {
        let text = "";
        for await (const chunk of req) text += chunk;
        req.body = text;
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => res.end(JSON.stringify(data));
        return handler(req, res);
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      if (
        !["index.html", "login.html", "rescate.html"].includes(file) &&
        !/^public\/flags\/[A-Z]{2}\.svg$/.test(file) &&
        !/^public\/agent\/[a-z-]+\.js$/.test(file)
      ) {
        res.writeHead(404);
        return res.end("The page could not be found");
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".js") ? "application/javascript" : file.endsWith(".svg") ? "image/svg+xml" : "text/html",
      );
      res.end(await fs.readFile(path.join(root, file)));
    } catch (e) {
      res.writeHead(500);
      res.end("Local test server error");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://www.gstatic.com/**", (r) => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page
      .getByText("Firebase no conecto. No cargues datos reales.", {
        exact: true,
      })
      .waitFor();
    assert.ok(await page.locator(".shell").isVisible());
    // UI forms and natural-language agent share persistence, including untouched fields.
    await page.evaluate(() => editRecord("clients"));
    await page.locator(".modal [name=name]").fill("Clínica Test");
    await page.locator(".modal [data-save-modal]").click();
    await page.locator("#agent-launcher").click();
    let turn = 0;
    const bodies = [];
    await page.route("**/api/agent", async (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      turn++;
      await route.fulfill({
        json: {
          response_id: "resp_" + turn,
          text: turn === 1 ? "Voy a crear el candidato" : "Candidato creado",
          calls:
            turn === 1
              ? [
                  {
                    call_id: "create",
                    name: "create_record",
                    arguments: JSON.stringify({
                      entity: "candidates",
                      data: { name: "Ana Test", notes: "Conservar" },
                    }),
                  },
                ]
              : [],
        },
      });
    });
    await page.locator("#agent-input").fill("Crea a Ana Test");
    await page.locator("#agent-send").click();
    await page.locator(".agent-approve:enabled").waitFor();
    assert.equal(await page.evaluate(() => state.candidates.length), 0);
    await page.locator(".agent-approve:enabled").click();
    await page.getByText("Candidato creado", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => state.candidates.length), 1);
    assert.equal(bodies[1].tool_outputs[0].output.ok, true);
    // Real adapters exercise finance, proposals, files metadata, notes and pipeline functions.
    const result = await page.evaluate(async () => {
      let n = 0;
      async function action(name, args) {
        const plan = agentEngine.prepare({
          call_id: "test_" + ++n,
          name,
          arguments: JSON.stringify(args),
        });
        return agentEngine.execute(
          plan,
          plan.effect === "read" ? undefined : agentEngine.approval([plan]),
        );
      }
      const c = state.candidates[0],
        client = state.clients[0];
      await action("update_record", {
        entity: "candidates",
        id: c.id,
        data: { phone: "600123456" },
      });
      const j = (
        await action("create_record", {
          entity: "jobs",
          data: {
            title: "Dermatólogo Test",
            client: client.name,
            feePercent: 16,
            salaryAgreed: 50000,
          },
        })
      ).record;
      await action("pipeline_action", {
        action: "link",
        candidate_id: c.id,
        job_id: j.id,
        stage: "Contactado",
      });
      await action("pipeline_action", {
        action: "move",
        candidate_id: c.id,
        job_id: j.id,
        stage: "Entrevista",
      });
      await action("candidate_note", {
        action: "add",
        candidate_id: c.id,
        text: "Llamada confirmada",
      });
      await action("job_finance", {
        job_id: j.id,
        type: "forecast",
        action: "set",
        month: "Octubre",
      });
      await action("forecast_billing", {
        id: state.forecast[0].id,
        billed: true,
      });
      const billed = state.placements.length;
      await action("update_record", {
        entity: "jobs",
        id: j.id,
        data: { notes: "No revertir facturación" },
      });
      const statusAfterEdit = state.jobs[0].jobStatus;
      await action("forecast_billing", {
        id: state.forecast[0].id,
        billed: false,
      });
      const unbilled = state.placements.length;
      const t = (
        await action("create_record", {
          entity: "tasks",
          data: {
            title: "Llamar Ana",
            due: "2026-10-09T10:00",
            linkedTo: client.name,
          },
        })
      ).record;
      const linkedEvent = state.events.find((e) => e.taskId === t.id);
      await action("update_record", {
        entity: "tasks",
        id: t.id,
        data: { done: true },
      });
      const taskDone = state.tasks[0].done;
      await action("delete_record", { entity: "tasks", id: t.id });
      const proposal = await action("proposal_action", {
        action: "create",
        client_id: client.id,
        data: {
          feeLines: [
            {
              perfil: "Dermatólogo",
              tipoFee: "porcentaje",
              valor: "16",
              garantia: "3 meses",
            },
          ],
        },
      });
      await action("proposal_action", {
        action: "sign",
        client_id: client.id,
        proposal_id: proposal.proposal_id,
      });
      await action("proposal_action", {
        action: "renew",
        client_id: client.id,
        proposal_id: proposal.proposal_id,
        date: "2026-12-01",
      });
      const p = state.clients[0].proposals[0];
      const report = (
        await action("create_record", {
          entity: "reportProjects",
          data: {
            name: "Informe Test",
            client: client.name,
            candidate: c.name,
            cv: "Experiencia sanitaria",
          },
        })
      ).record;
      const output = await action("generate_report", { id: report.id });
      const whatsapp = await action("prepare_whatsapp", {
        candidate_id: c.id,
        message: "Hola Ana",
      });
      await action("pipeline_action", {
        action: "unlink",
        candidate_id: c.id,
        job_id: j.id,
      });
      const candidate = state.candidates[0];
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return {
        billed,
        unbilled,
        statusAfterEdit,
        linkedEvent,
        taskDone,
        eventsAfterDelete: state.events.length,
        proposalStatus: p.status,
        generated: !!p.generatedContent,
        renewal: p.renewalDate,
        output: output.output,
        whatsapp: whatsapp.url,
        notes: candidate.notes,
        callNote: candidate.callNotes[0].text,
        pipeline: state.jobs[0].pipeline.length,
        jobs: candidate.jobs,
        savedCount: saved.candidates.length,
      };
    });
    assert.equal(result.billed, 1);
    assert.equal(result.unbilled, 0);
    assert.equal(result.statusAfterEdit, "Facturado");
    assert.ok(result.linkedEvent);
    assert.equal(result.taskDone, true);
    assert.equal(result.eventsAfterDelete, 0);
    assert.equal(result.proposalStatus, "firmada");
    assert.ok(result.generated);
    assert.equal(result.renewal, "2026-12-01");
    assert.match(result.output, /Experiencia sanitaria/);
    assert.match(result.whatsapp, /wa.me/);
    assert.equal(result.notes, "Conservar");
    assert.equal(result.callNote, "Llamada confirmada");
    assert.equal(result.pipeline, 0);
    assert.equal(result.jobs, "");
    assert.equal(result.savedCount, 1);
    // Existing forms still edit the same records after actions.
    await page.locator("#agent-close").click();
    await page.evaluate(() => editTask());
    await page.locator(".modal [name=title]").fill("Tarea desde formulario");
    await page.locator(".modal [name=due]").fill("2026-10-09T11:00");
    await page.locator(".modal .primary-button").click();
    assert.equal(await page.evaluate(() => state.tasks.length), 1);
    assert.equal(
      await page.evaluate(() => state.events[0].taskId === state.tasks[0].id),
      true,
    );
    await page.evaluate(() => setView("notas"));
    assert.equal(await page.evaluate(() => state.notas.length), 0);
    for (const view of [
      "clients",
      "candidates",
      "jobs",
      "tasks",
      "calendar",
      "routine",
      "commercial",
      "forecast",
      "placements",
      "goals",
      "pomodoro",
      "reports",
      "fichaje",
      "metricas",
      "dashboard",
    ])
      await page.evaluate((v) => setView(v), view);
    await page.locator("#agent-launcher").click();
    await page.unroute("**/api/agent");
    await page.route("**/api/agent", (r) =>
      r.fulfill({
        status: 404,
        contentType: "text/html",
        body: "The page could not be found",
      }),
    );
    await page.locator("#agent-input").fill("Hola");
    await page.locator("#agent-send").click();
    await page.getByText(/respuesta no JSON \(HTTP 404\)/).waitFor();
    await page.evaluate(() =>
      agentAddMessage(
        "assistant",
        "Hecho: **Leonardo** · **Nota:** <script>alert(1)</script>",
      ),
    );
    const formatted = page.locator(".agent-msg.assistant").last();
    assert.equal(await formatted.locator("strong").count(), 2);
    assert.equal(await formatted.locator("script").count(), 0);
    assert.ok(!(await formatted.innerText()).includes("**"));
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.ok((await page.locator("#agent-panel").boundingBox()).width >= 670);
    await page.locator("#agent-expand").click();
    assert.equal(
      await page.locator("#agent-expand").getAttribute("aria-pressed"),
      "true",
    );
    assert.ok((await page.locator("#agent-panel").boundingBox()).width > 1000);
    await page.locator("[data-kitty-prompt]").first().click();
    assert.match(
      await page.locator("#agent-input").inputValue(),
      /tareas pendientes/,
    );
    await page.evaluate(() =>
      agentAddMessage(
        "assistant",
        "",
        EPKittyPresentation.review({
          title: "Crear tarea",
          arguments: { data: { title: "Llamar a Eva", linkedTo: "VIC" } },
          effects: "Se guardará en el Hub.",
        }),
      ),
    );
    const review = page.locator(".agent-call").last();
    assert.match(await review.innerText(), /Vincular con/);
    assert.equal(await review.locator("pre").count(), 0);
    await page.unroute("**/api/agent");
    const waCalls = [];
    let waTurn = 0;
    const waCandidate = await page.evaluate(() =>
      hubActions.save("candidates", null, {
        name: "Eva WhatsApp",
        phone: "+34600111222",
      }),
    );
    await page.evaluate(() => {
      window.kittyTestAuth = fbAuth;
      fbAuth = { currentUser: { getIdToken: async () => "local-test-token" } };
    });
    await page.route("**/api/whatsapp", async (route) => {
      const body = route.request().postDataJSON();
      waCalls.push(body);
      await route.fulfill({
        json:
          body.action === "prepare"
            ? {
                capability: "test-capability",
                review: {
                  title: "Programar WhatsApp",
                  arguments: {
                    recipient: "Eva WhatsApp",
                    phone: "+34600111222",
                    message: "Hola Eva",
                    scheduled_for: "Mañana a las 10:00 (Europe/Madrid)",
                  },
                  requiresConsent: true,
                  effects: "Se programará el envío.",
                },
              }
            : {
                ok: true,
                scheduled: true,
                scheduled_for: "Mañana a las 10:00 (Europe/Madrid)",
              },
      });
    });
    await page.route("**/api/agent", async (route) => {
      waTurn++;
      await route.fulfill({
        json: {
          response_id: "wa-" + waTurn,
          text: waTurn === 1 ? "Voy a preparar el WhatsApp." : "Programado.",
          calls:
            waTurn === 1
              ? [
                  {
                    name: "whatsapp_schedule",
                    call_id: "wa-call-1",
                    arguments: JSON.stringify({
                      candidate_id: waCandidate.id,
                      send_at: "2026-11-01T10:00:00+01:00",
                      message: "Hola Eva",
                    }),
                  },
                ]
              : [],
        },
      });
    });
    await page.locator("#agent-input").fill("Programá un WhatsApp para Eva");
    await page.locator("#agent-send").click();
    await page.locator(".kitty-consent").waitFor();
    assert.equal(waCalls.length, 1);
    await page.locator(".agent-approve:enabled").click();
    assert.equal(waCalls.length, 1);
    assert.match(
      await page.locator(".agent-msg.system").last().innerText(),
      /consentimiento/,
    );
    await page.locator(".kitty-consent").check();
    await page.locator(".agent-approve:enabled").click();
    await page.waitForFunction(
      () => !agentRuntime.busy && !agentRuntime.pending,
    );
    assert.equal(waCalls.length, 2);
    assert.equal(waCalls[1].consent, true);
    assert.equal(waCalls[1].args.phone, "+34600111222");
    assert.equal(waCalls[1].capability, "test-capability");
    await page.evaluate(() => {
      fbAuth = window.kittyTestAuth;
      delete window.kittyTestAuth;
    });
    await page.screenshot({ path: "/tmp/kitty-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.locator("#agent-panel").boundingBox();
    assert.equal(mobile.width, 390);
    assert.equal(
      await page.evaluate(
        () => document.getElementById("agent-panel").scrollWidth + 2,
      ),
      390,
    );
    assert.ok(await page.locator("#agent-input").isVisible());
    await page.screenshot({ path: "/tmp/kitty-mobile.png" });
    await page.locator("#agent-input").press("Escape");
    assert.equal(
      await page.locator("#agent-launcher").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(await page.locator("#agent-panel").isVisible(), false);
    await page.evaluate(() => {
      state.candidates.push({id:"unicode-check",name:"Ana GarcÃ­a Robles",phone:"+5492325681206",jobs:"DirecciÃ³n Mutua",status:"CV Recibido"});
      setView("candidates");
    });
    assert.ok(await page.getByText("Ana García Robles", {exact:true}).isVisible());
    assert.ok(await page.getByText("Dirección Mutua", {exact:true}).isVisible());
    const flag = page.locator('[data-card="unicode-check"] img[alt="AR"]');
    assert.ok(await flag.isVisible());
    await page.waitForFunction(() => document.querySelector('[data-card="unicode-check"] img[alt="AR"]')?.naturalWidth > 0);
    await page.evaluate(() => {
      state.jobs.push({id:'business-fixture',title:'Vacante histórica',client:'Clínica Test',owner:'Santi',status:'En proceso',pipeline:[]});
      state.jobs.push({id:'billed-fixture',title:'Vacante cubierta',client:'Clínica Test',owner:'Santi',jobStatus:'Facturado',pipeline:[]});
      hubActions.save('jobs',null,{title:'Vacante People',client:'Clínica Test',owner:'Alba'});
      window._jobAreaFilter='Todos';window._jobStatusFilter='Activos';setView('jobs');
    });
    assert.ok(await page.getByText('Vacante histórica',{exact:true}).isVisible());
    assert.equal(await page.getByText('Vacante cubierta',{exact:true}).count(),0);
    // Opening a native select must not rebuild the DOM and dismiss its popup.
    for(const selector of ['[data-job-status]','[data-job-owner]','[data-job-client]']){
      const unchanged=await page.evaluate(selector=>{
        const control=document.querySelector(selector);
        control.click();
        return control===document.querySelector(selector)&&control.isConnected;
      },selector);
      assert.equal(unchanged,true,'click must preserve '+selector);
    }
    await page.locator('[data-job-area="Expansion People"]').click();
    assert.ok(await page.getByText('Vacante People',{exact:true}).isVisible());
    assert.equal(await page.getByText('Vacante histórica',{exact:true}).count(),0);
    await page.locator('[data-job-area="Expansion Business"]').click();
    await page.locator('[data-job-status]').selectOption('Archivo');
    assert.ok(await page.getByText('Vacante cubierta',{exact:true}).isVisible());
    assert.ok(await page.locator('table').getByText('Cubierta',{exact:true}).isVisible());
    await page.evaluate(()=>{window._jobStatusFilter='Activos';window._jobAreaFilter='Todos';renderJobs();});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'/tmp/vacantes-review.png',fullPage:true});
    await page.evaluate(()=>{activeFilters.clients='Datos pendientes';setView('clients');});
    assert.ok(await page.getByText('Falta Persona de contacto, Teléfono, Email',{exact:true}).first().isVisible());
    await page.locator('[data-edit^="clients:"]').first().click();
    assert.ok(await page.locator('.modal .field-pending input').count()>0);
    await page.locator('.modal [data-close-modal]').first().click();
    await page.screenshot({path:'/tmp/clientes-review.png',fullPage:true});
    await page.evaluate(()=>setView('dashboard'));
    assert.ok(await page.getByText('Mi día',{exact:true}).last().isVisible());
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/tmp/midia-review.png',fullPage:true});
    await page.evaluate(()=>{
      delete window._jobAreaFilter;setView('jobs');
    });
    assert.equal(await page.locator('.workspace-tabs button').first().textContent(),'Expansion People');
    assert.ok(await page.locator('[data-job-area="Expansion People"]').evaluate(el=>el.classList.contains('selected')));
    assert.equal(await page.locator('[data-view="clients"] .icon').textContent(),'🏢');
    await page.evaluate(()=>{
      state.forecast=[{id:'legacy-fc',title:'Previsión histórica',month:'Enero',amount:1000,consultor:'Santi'}];
      forecastContext={};setView('forecast');
    });
    assert.match(await page.locator('[data-fc-year="2026"]').textContent(),/0,00/);
    await page.locator('[data-fc-area="Expansion Business"]').click();
    assert.match(await page.locator('[data-fc-year="2026"]').textContent(),/1000,00|1.000,00/);
    await page.locator('[data-fc-year="2026"]').click();
    assert.equal(await page.locator('[data-fc-quarter]').count(),4);
    await page.locator('[data-fc-quarter="Q1"]').click();
    assert.equal(await page.locator('[data-fc-month]').count(),3);
    await page.locator('[data-fc-month="Enero"]').click();
    assert.ok(await page.getByText('Previsión histórica',{exact:true}).isVisible());
    await page.locator('[data-fc-area="Expansion People"]').click();
    await page.locator('[data-fc-year="2026"]').click();
    await page.locator('[data-fc-quarter="Q1"]').click();
    await page.locator('[data-fc-month="Enero"]').click();
    assert.equal(await page.getByText('Previsión histórica',{exact:true}).count(),0);
    await page.evaluate(()=>{
      editForecast(null);
    });
    assert.equal(await page.locator('.modal [name=businessArea]').inputValue(),'Expansion People');
    assert.equal(await page.locator('.modal [name=year]').inputValue(),'2026');
    await page.locator('.modal [name=title]').fill('Nueva previsión People');
    await page.locator('.modal [name=amount]').fill('250');
    await page.locator('[data-save-fc]').click();
    assert.ok(await page.getByText('Nueva previsión People',{exact:true}).isVisible());
    await page.evaluate(()=>{
      state.forecast.push({id:'year-2027',title:'Año siguiente',businessArea:'Expansion People',year:2027,month:'Enero',amount:999,consultor:'Santi'});
      renderForecast();
    });
    assert.equal(await page.getByText('Año siguiente',{exact:true}).count(),0);
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-fc-back="months"]').click();
    await page.screenshot({path:'/tmp/forecast-hierarchy.png',fullPage:true});
    await page.evaluate(()=>{
      state.forecast.push({id:'billing-2026',title:'Igual título',businessArea:'Expansion People',year:2026,month:'Enero',amount:100,consultor:'Santi'});
      state.forecast.push({id:'billing-2027',title:'Igual título',businessArea:'Expansion People',year:2027,month:'Enero',amount:200,consultor:'Santi'});
      fc_bill('billing-2026');fc_bill('billing-2027');
    });
    assert.equal(await page.evaluate(()=>state.placements.filter(p=>p.forecastId?.startsWith('billing-')).length),2);
    await page.evaluate(()=>fc_unbill('billing-2026'));
    assert.equal(await page.evaluate(()=>state.placements.filter(p=>p.forecastId==='billing-2027').length),1);
    await page.evaluate(()=>setView('metricas'));
    const navLabels=await page.locator('#nav .nav-label').allTextContents();
    assert.ok(navLabels.indexOf('Métricas')<navLabels.indexOf('Planificación'));
    assert.equal((await page.locator('#nav [data-view="metricas"]').textContent()).trim(),'📊Resumen');
    assert.ok(await page.locator('.metrics-grid').isVisible());
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('.metrics-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
    await page.screenshot({path:'/tmp/metrics-color.png',fullPage:true});
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: UI approval, shared forms, pipeline/notes, finance/reversal, calendar, proposals, reports, WhatsApp, every Hub view, HTML errors; no uncaught JS errors",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
