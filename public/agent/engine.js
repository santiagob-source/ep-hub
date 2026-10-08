(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./catalog"));
  else root.EPAgentEngine = factory(root.EPAgentCatalog);
})(globalThis, function (catalog) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function validate(value, schema, path = "args") {
    if (schema.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error(path + " debe ser un objeto");
      for (const key of schema.required || [])
        if (!Object.hasOwn(value, key))
          throw Error("Falta " + path + "." + key);
      for (const [key, v] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw Error("Campo no permitido");
        if (schema.properties?.[key])
          validate(v, schema.properties[key], path + "." + key);
        else if (schema.additionalProperties === false)
          throw Error("Campo desconocido: " + path + "." + key);
      }
    } else if (schema.type === "array") {
      if (!Array.isArray(value)) throw Error(path + " debe ser una lista");
      value.forEach((v) => validate(v, schema.items, path));
    } else {
      const type = schema.type === "integer" ? "number" : schema.type;
      if (
        typeof value !== type ||
        (type === "number" &&
          (!Number.isFinite(value) ||
            (schema.type === "integer" && !Number.isInteger(value))))
      )
        throw Error("Tipo inválido: " + path);
      if (schema.enum && !schema.enum.includes(value))
        throw Error("Valor no disponible: " + path);
      if (
        (schema.minimum !== undefined && value < schema.minimum) ||
        (schema.maximum !== undefined && value > schema.maximum)
      )
        throw Error("Fuera de rango: " + path);
    }
  }
  function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !["generatedContent", "_sync"].includes(k))
          .map(([k, v]) => [k, redact(v)]),
      );
    return typeof value === "string" && value.startsWith("data:")
      ? "[archivo local]"
      : value;
  }
  function create(env) {
    const hub = env.hub,
      registry = new Map(),
      prepared = new WeakSet();
    function freeze(value) {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    }
    const snapshot = () => {
      const state = env.getState();
      return JSON.stringify(state, function (key, value) {
        if (
          key === "_sync" ||
          (this === state.pomodoro &&
            key === "remaining" &&
            state.pomodoro.running)
        )
          return undefined;
        return value;
      });
    };
    const invoke = (name, ...args) => {
      if (typeof env.functions[name] !== "function")
        throw Error("Acción no disponible: " + name);
      return env.functions[name](...args);
    };
    function proposal(args) {
      const client = hub.record("clients", args.client_id);
      const index = (client.proposals || []).findIndex(
        (p) => p.id === args.proposal_id,
      );
      if (index < 0) throw Error("Propuesta no encontrada");
      return { client, index, record: client.proposals[index] };
    }
    function check(args, name) {
      if (["get_record", "update_record", "delete_record"].includes(name))
        hub.record(args.entity, args.id);
      if (["create_record", "update_record"].includes(name))
        hub.validate(args.entity, args.data, name === "create_record");
      if (name === "pipeline_action") {
        const c = hub.record("candidates", args.candidate_id),
          j = hub.record("jobs", args.job_id);
        if (
          (j.pipeline || []).some((p) => !p.candidateId && p.name === c.name) &&
          env
            .getState()
            .candidates.some(
              (other) => other.id !== c.id && other.name === c.name,
            )
        )
          throw Error(
            "Pipeline ambiguo: hay varios candidatos con el mismo nombre y el vínculo antiguo no tiene ID. Revisá el vínculo en el Hub.",
          );
        if (
          (j.pipeline || []).some(
            (p) => p.name === c.name && p.candidateId && p.candidateId !== c.id,
          )
        )
          throw Error(
            "Este pipeline ya contiene otro candidato con el mismo nombre. Revisá los nombres antes de vincularlos.",
          );
        if (
          args.action !== "link" &&
          !(j.pipeline || []).some(
            (p) =>
              p.candidateId === c.id || (!p.candidateId && p.name === c.name),
          )
        )
          throw Error("El candidato no está vinculado al job");
        if (
          ["link", "move"].includes(args.action) &&
          ![
            "Busqueda",
            "Contactado",
            "Entrevista",
            "Entrevista C/C",
            "Oferta",
          ].includes(args.stage || "Busqueda")
        )
          throw Error("Etapa no disponible");
        if (
          args.action === "label" &&
          !["En proceso", "Placement", "No presentado", "Rechazado"].includes(
            args.label,
          )
        )
          throw Error("Etiqueta no disponible");
      }
      if (name === "candidate_note") {
        const c = hub.record("candidates", args.candidate_id);
        if (
          args.action !== "add" &&
          (!Number.isInteger(args.index) || !c.callNotes?.[args.index])
        )
          throw Error("Nota no encontrada");
        if (args.action !== "delete" && typeof args.text !== "string")
          throw Error("Falta el texto de la nota");
      }
      if (name === "job_finance") {
        hub.record("jobs", args.job_id);
        if (
          args.action === "set" &&
          ![
            "Enero",
            "Febrero",
            "Marzo",
            "Abril",
            "Mayo",
            "Junio",
            "Julio",
            "Agosto",
            "Septiembre",
            "Octubre",
            "Noviembre",
            "Diciembre",
          ].includes(args.month)
        )
          throw Error("Mes inválido");
      }
      if (name === "forecast_billing") hub.record("forecast", args.id);
      if (name === "proposal_action") {
        hub.record("clients", args.client_id);
        if (args.action !== "create") proposal(args);
        if (["create", "update"].includes(args.action) && !args.data)
          throw Error("Faltan los datos de la propuesta");
        if (
          args.action === "renew" &&
          (typeof args.date !== "string" ||
            (args.date && !Number.isFinite(Date.parse(args.date))))
        )
          throw Error("Fecha de renovación inválida");
      }
      if (name === "clock_action") {
        const open = (env.getState().fichajes || []).find(
          (f) =>
            f.date === new Date().toISOString().slice(0, 10) &&
            f.entrada &&
            !f.salida,
        );
        if (args.type === "salida" && !open)
          throw Error("No hay una entrada abierta para hoy");
        if (args.type === "entrada" && open)
          throw Error("Ya hay una entrada abierta para hoy");
      }
      if (name === "focus_action" && args.action === "select")
        hub.record("focusActivities", args.activity_id);
      if (name === "dashboard_action") {
        if (
          args.action === "reorder" &&
          (!args.order || new Set(args.order).size !== args.order.length)
        )
          throw Error("Orden de widgets inválido");
        if (args.action !== "reorder" && !args.widget)
          throw Error("Falta el widget");
      }
      if (name === "generate_report") hub.record("reportProjects", args.id);
      if (name === "open_view" && !args.view && !(args.entity && args.id))
        throw Error("Indica sección o detalle");
      if (name === "open_view" && args.entity) hub.record(args.entity, args.id);
      if (name === "prepare_document" && args.kind !== "weekly_report")
        hub.record(
          args.kind === "placement_email" ? "placements" : "jobs",
          args.id,
        );
      if (name === "file_action") {
        if (["download", "upload", "remove"].includes(args.action)) {
          const c = hub.record("candidates", args.candidate_id);
          if (!args.field) throw Error("Falta el tipo de archivo");
          if (args.action !== "upload" && !c.files?.[args.field])
            throw Error("Archivo no disponible");
        } else {
          hub.record("clients", args.client_id);
          if (args.action !== "attach_proposal") {
            const p = proposal(args);
            if (
              (args.action === "download_signed" && !p.record.signedFile) ||
              (args.action === "download_attached" && !p.record.adjuntedFile)
            )
              throw Error("Archivo no disponible");
          }
        }
      }
      if (name === "prepare_whatsapp")
        hub.record("candidates", args.candidate_id);
    }
    function preview(name, args) {
      const before =
        args.entity && args.id
          ? redact(hub.record(args.entity, args.id))
          : args.candidate_id
            ? redact(hub.record("candidates", args.candidate_id))
            : args.job_id
              ? redact(hub.record("jobs", args.job_id))
              : args.client_id
                ? redact(hub.record("clients", args.client_id))
                : null;
      let effects =
        "Se guardará el cambio usando la sincronización habitual del Hub.";
      if (name === "delete_record")
        effects =
          "Se eliminará este registro. Tareas: también su evento asociado. Candidatos: sus vínculos en pipelines. Jobs: sus forecasts y vínculos. Clientes: se desvinculan jobs y tareas. La facturación histórica se conserva.";
      if (name === "job_finance" || name === "forecast_billing")
        effects =
          "También puede modificar forecast, facturación, estado del job y candidato relacionados, según la lógica existente del Hub.";
      if (name === "update_record")
        effects =
          "Solo se cambian los campos indicados. Se actualizan las relaciones por nombre, el calendario de tareas y los cálculos de fee cuando corresponda.";
      if (name === "file_action" || name === "import_data")
        effects =
          "Se abrirá el selector/importador del Hub. La selección y revisión del archivo siguen siendo manuales; abrirlo no significa que se haya importado.";
      const verbs = {
        create_record: "Crear",
        update_record: "Editar",
        delete_record: "Eliminar",
        pipeline_action: "Cambiar vínculo de candidato y job",
        candidate_note: "Cambiar nota de llamada",
        job_finance: "Actualizar forecast/facturación del job",
        forecast_billing: "Facturar o revertir forecast",
        proposal_action: "Actualizar propuesta",
        clock_action: "Registrar fichaje",
        focus_action: "Controlar Pomodoro",
        dashboard_action: "Configurar dashboard",
        generate_report: "Generar informe",
        file_action: "Gestionar archivo",
        import_data: "Importar datos",
        example_external_send: "Enviar",
      };
      const subject = args.entity
        ? catalog.entities[args.entity]?.label || args.entity
        : "";
      const target =
        before?.name ||
        before?.title ||
        before?.activity ||
        before?.consultant ||
        "";
      const title =
        (verbs[name] || name) +
        (subject ? " " + subject : "") +
        (target ? " · " + target : "");
      return { title, action: name, arguments: redact(args), before, effects };
    }
    const implementations = {
      describe_actions: () => ({
        entities: catalog.entities,
        fields: catalog.fields,
        actions: catalog.definitions.map((d) => ({
          name: d.name,
          description: d.description,
          effect: d.effect,
        })),
        pipeline_stages: [
          "Busqueda",
          "Contactado",
          "Entrevista",
          "Entrevista C/C",
          "Oferta",
        ],
      }),
      search_records: (a) => {
        let all = hub
          .list(a.entity)
          .filter(
            (r) =>
              (!a.query ||
                env
                  .normalize(JSON.stringify(redact(r)))
                  .includes(env.normalize(a.query))) &&
              Object.entries(a.filters || {}).every(([k, v]) =>
                typeof v === "boolean" || typeof v === "number"
                  ? r[k] === v
                  : env.normalize(r[k]).includes(env.normalize(v)),
              ),
          );
        let similar = false;
        if (!all.length && a.query) {
          all = hub
            .nameMatches(a.entity, a.query)
            .map((m) => m.item)
            .filter((r) =>
              Object.entries(a.filters || {}).every(([k, v]) =>
                typeof v === "boolean" || typeof v === "number"
                  ? r[k] === v
                  : env.normalize(r[k]).includes(env.normalize(v)),
              ),
            );
          similar = all.length > 0;
        }
        const offset = a.offset || 0;
        return {
          count: all.length,
          similar_matches: similar,
          items: redact(all.slice(offset, offset + (a.limit || 20))),
          offset,
          has_more: offset + (a.limit || 20) < all.length,
        };
      },
      get_record: (a) => redact(hub.record(a.entity, a.id)),
      create_record: (a) => ({
        ok: true,
        record: redact(hub.save(a.entity, null, a.data)),
      }),
      update_record: (a) => ({
        ok: true,
        record: redact(hub.save(a.entity, a.id, a.data)),
      }),
      delete_record: (a) => ({ ok: true, ...hub.remove(a.entity, a.id) }),
      pipeline_action: (a) => {
        const c = hub.record("candidates", a.candidate_id),
          j = hub.record("jobs", a.job_id);
        if (a.action === "link")
          return { ok: true, ...hub.link(c.id, j.id, a.stage || "Busqueda") };
        return {
          ok: true,
          ...hub.pipeline(
            c.id,
            j.id,
            a.action,
            a.action === "move" ? a.stage : a.label,
          ),
        };
      },
      candidate_note: (a) => ({
        ok: true,
        ...hub.callNote(a.candidate_id, a.action, a.index, a.text),
      }),
      job_finance: (a) => {
        invoke(
          a.action === "set" ? "jd_month" : "jd_clearMonth",
          a.job_id,
          a.type,
          ...(a.action === "set" ? [a.month] : []),
        );
        return { ok: true, job: redact(hub.record("jobs", a.job_id)) };
      },
      forecast_billing: (a) => {
        invoke(a.billed ? "fc_bill" : "fc_unbill", a.id);
        return { ok: true, forecast: redact(hub.record("forecast", a.id)) };
      },
      proposal_action: (a) => {
        if (["create", "update"].includes(a.action))
          return {
            ok: true,
            ...hub.proposal(
              a.client_id,
              a.action === "create" ? null : a.proposal_id,
              a.data,
            ),
          };
        const p = proposal(a);
        if (a.action === "delete")
          hub.removeProposal(a.client_id, a.proposal_id);
        if (a.action === "sign")
          invoke("prop_markSigned", a.client_id, p.index);
        if (a.action === "renew")
          invoke("prop_setRenewal", a.client_id, p.index, a.date);
        return { ok: true, action: a.action, proposal_id: a.proposal_id };
      },
      clock_action: (a) => {
        invoke("fichajeAction", a.type);
        return { ok: true, type: a.type };
      },
      focus_action: (a) => {
        const p = env.getState().pomodoro;
        if (a.action === "select") {
          const activity = hub.record("focusActivities", a.activity_id);
          Object.assign(p, {
            mode: activity.name,
            minutes: activity.minutes,
            remaining: activity.minutes * 60,
            running: false,
          });
        } else {
          p.running = a.action === "start";
          if (a.action === "reset") p.remaining = p.minutes * 60;
        }
        env.save();
        invoke("renderPomodoro");
        return { ok: true, pomodoro: redact(p) };
      },
      dashboard_action: (a) => {
        const s = env.getState();
        if (a.action === "hide") invoke("dash_hide", a.widget);
        if (a.action === "show" && !s.dashWidgets.includes(a.widget))
          invoke("dash_show", a.widget);
        if (a.action === "reorder") {
          s.dashWidgets = clone(a.order);
          env.save();
          invoke("renderDashboard");
        }
        return { ok: true, widgets: s.dashWidgets };
      },
      generate_report: (a) => {
        invoke("generateCandidateReport", a.id);
        return { ok: true, output: hub.record("reportProjects", a.id).output };
      },
      hub_summary: () => ({
        counts: Object.fromEntries(
          Object.keys(catalog.entities).map((k) => [k, hub.list(k).length]),
        ),
        billing: invoke("calcTotals"),
        forecast: redact(hub.list("forecast")),
        goals: redact(hub.list("goals")),
        pomodoro: redact(env.getState().pomodoro),
        widgets: env.getState().dashWidgets,
      }),
      open_view: (a) => {
        if (a.entity)
          invoke(
            "openDetail",
            { candidates: "candidate", clients: "client", jobs: "job" }[
              a.entity
            ],
            a.id,
          );
        else invoke("setView", a.view);
        return { ok: true, opened: a };
      },
      prepare_document: (a) => {
        if (a.kind === "weekly_report")
          return {
            ok: true,
            prepared: true,
            text: invoke("generateWeeklyReport"),
            sent: false,
          };
        invoke(
          {
            job_email: "generarEmailMati",
            placement_email: "emailMatiPlacement",
            job_description: "generarJobDescription",
          }[a.kind],
          a.id,
        );
        return {
          ok: true,
          prepared: true,
          sent: false,
          text: env.documentText?.(a) || "",
        };
      },
      file_action: (a) => {
        const map = {
          download: "cand_downloadFile",
          upload: "cand_uploadFile",
          remove: "cand_removeFile",
          view_proposal: "prop_view",
          download_word: "prop_downloadWord",
          download_signed: "prop_downloadSigned",
          download_attached: "prop_downloadAdjunted",
          upload_signed: "prop_uploadSigned",
          attach_proposal: "prop_attachAny",
        };
        if (["download", "upload", "remove"].includes(a.action))
          invoke(map[a.action], a.candidate_id, a.field);
        else if (a.action === "attach_proposal") {
          invoke("openDetail", "client", a.client_id);
          invoke(map[a.action], a.client_id);
        } else {
          const p = proposal(a);
          if (a.action === "upload_signed")
            invoke("openDetail", "client", a.client_id);
          invoke(map[a.action], a.client_id, p.index);
        }
        return {
          ok: true,
          action: a.action,
          ...(["upload", "upload_signed", "attach_proposal"].includes(a.action)
            ? { awaiting_user: true, completed: false }
            : { completed: true }),
        };
      },
      export_data: () => {
        invoke("exportarDatos");
        return { ok: true, download_started: true };
      },
      import_data: () => {
        invoke("importarDatos");
        return { ok: true, awaiting_user: true, completed: false };
      },
      generate_boolean: (a) => {
        const terms = [];
        if (a.specialty)
          terms.push(
            "(" +
              [a.specialty, ...(a.aliases || [])]
                .map((x) => JSON.stringify(x))
                .join(" OR ") +
              ")",
          );
        if (a.location)
          terms.push(
            "(" +
              [a.location, ...(a.locationAliases || [])]
                .map((x) => JSON.stringify(x))
                .join(" OR ") +
              ")",
          );
        if (a.keywords?.length)
          terms.push(
            "(" + a.keywords.map((x) => JSON.stringify(x)).join(" OR ") + ")",
          );
        if (a.exclude?.length)
          terms.push(
            a.exclude.map((x) => "NOT " + JSON.stringify(x)).join(" "),
          );
        return { boolean: terms.join(" AND ") || a.query || "" };
      },
      prepare_whatsapp: (a) => {
        const c = hub.record("candidates", a.candidate_id),
          url = invoke("whatsappUrl", c.phone);
        if (!url) throw Error("El candidato no tiene teléfono");
        return {
          ok: true,
          candidate: c.name,
          url:
            url + (a.message ? "?text=" + encodeURIComponent(a.message) : ""),
          message: a.message || "",
          sent: false,
        };
      },
    };
    function register(def, adapter) {
      if (registry.has(def.name)) throw Error("Herramienta duplicada");
      if (
        !["read", "write", "delete", "dynamic"].includes(def.effect) ||
        typeof adapter.execute !== "function"
      )
        throw Error("La herramienta debe declarar política y ejecutor");
      registry.set(def.name, { def, adapter });
    }
    for (const def of catalog.definitions)
      register(
        def,
        env.adapters?.[def.name] || {
          check: (a) => check(a, def.name),
          execute:
            implementations[def.name] ||
            (() => {
              throw Error(
                "Conectá Gmail desde la app para usar esta herramienta.",
              );
            }),
        },
      );
    const staged = new WeakMap();
    async function stage(plan) {
      const value = await registry
        .get(plan.name)
        .adapter.stage?.(clone(plan.args));
      if (value) staged.set(plan, value);
    }
    function review(plan) {
      return staged.get(plan)?.review || plan.review;
    }
    function prepare(call) {
      const entry = registry.get(call.name);
      if (!entry) throw Error("Herramienta no disponible: " + call.name);
      if (typeof call.call_id !== "string" || !call.call_id)
        throw Error("Falta call_id");
      let args;
      try {
        args =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : clone(call.arguments || {});
      } catch {
        throw Error("Argumentos JSON inválidos");
      }
      validate(args, entry.def.parameters);
      if (call.name === "create_record" || call.name === "update_record")
        args.data = hub.resolveRelations(args.entity, args.data);
      entry.adapter.check?.(args);
      const effect = catalog.effect(entry.def, args);
      const sealed = clone({
        call_id: call.call_id,
        name: call.name,
        args,
        effect,
      });
      const plan = freeze({ ...sealed, review: preview(call.name, args) });
      prepared.add(plan);
      return plan;
    }
    // Approval is a one-use capability kept in this closure, never accepted from model arguments.
    const approvals = new WeakMap();
    function approval(plans) {
      const token = Object.freeze({});
      approvals.set(token, {
        snapshot: snapshot(),
        plans: plans.map((p) => JSON.stringify({ name: p.name, args: p.args })),
        used: new Set(),
      });
      return token;
    }
    async function execute(plan, token) {
      if (!prepared.has(plan)) throw Error("Plan de acción no verificado");
      if (plan.effect !== "read") {
        const grant = approvals.get(token),
          key = JSON.stringify({ name: plan.name, args: plan.args });
        if (
          !grant ||
          grant.snapshot !== snapshot() ||
          !grant.plans.includes(key) ||
          grant.used.has(plan.call_id)
        )
          throw Error(
            "Confirmación ausente o datos cambiados. Revisá la acción nuevamente.",
          );
        grant.used.add(plan.call_id);
      }
      const entry = registry.get(plan.name);
      entry.adapter.check?.(plan.args);
      const result = await entry.adapter.execute(
        clone(plan.args),
        staged.get(plan),
      );
      if (plan.effect !== "read") {
        const grant = approvals.get(token);
        grant.snapshot = snapshot();
        env.refresh?.();
        grant.snapshot = snapshot();
      }
      return result;
    }
    return {
      prepare,
      stage,
      review,
      execute,
      approval,
      snapshot,
      register,
      redact,
    };
  }
  return { create, validate, redact };
});
