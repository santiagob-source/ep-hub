(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./catalog"), require("./phone"));
  else root.EPHubActions = factory(root.EPAgentCatalog, root.EPPhone);
})(globalThis, function (catalog, phone) {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const norm = (x) =>
    String(x || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  // Conservative name matching: normalize spelling, then match complete query
  // tokens. Short names never use edit distance, and competing matches stay ambiguous.
  function nameKey(value) {
    const aliases = {
      ntra: "nuestra",
      sra: "senora",
      sr: "senor",
      sta: "santa",
      sto: "santo",
    };
    return norm(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((t) => aliases[t] || t)
      .join(" ");
  }
  function distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i),
      previous = null;
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) {
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        if (previous && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          next[j] = Math.min(next[j], previous[j - 2] + 1);
      }
      previous = row;
      row = next;
    }
    return row[b.length];
  }
  function nameMatches(items, query) {
    const q = nameKey(query);
    if (!q) return [];
    const tokens = q
      .split(" ")
      .filter((t) => !["de", "del", "la", "el", "los", "las", "y"].includes(t));
    return items
      .map((item) => {
        const name = nameKey(
          item.name || item.title || item.activity || item.consultant || "",
        );
        let score = 0;
        if (name === q) score = 1;
        else if (q.length >= 3 && name.includes(q)) score = 0.95;
        else if (tokens.length && tokens.every((t) => t.length >= 3)) {
          const words = name.split(" ");
          const strengths = tokens.map((t) =>
            Math.max(
              0,
              ...words.map((w) => {
                if (w === t) return 1;
                if (t.length >= 4 && w.startsWith(t)) return 0.9;
                if (
                  t.length >= 4 &&
                  w.length >= 4 &&
                  distance(t, w) <=
                    Math.min(2, Math.floor(Math.max(t.length, w.length) / 5))
                )
                  return 0.8;
                return 0;
              }),
            ),
          );
          if (strengths.every(Boolean)) score = Math.min(...strengths);
        }
        return { item, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
  }
  function create(env) {
    const get = () => env.getState();
    function list(entity) {
      if (!catalog.entities[entity]) throw Error("Entidad no disponible");
      return entity === "focusActivities"
        ? get().pomodoro.activities
        : get()[entity];
    }
    function record(entity, id) {
      const r = list(entity).find((x) => x.id === id);
      if (!r) throw Error("Registro no encontrado: " + entity + " / " + id);
      return r;
    }
    function resolveName(entity, reference) {
      const items = list(entity);
      const byId = items.find((r) => r.id === reference);
      if (byId) return byId;
      const matches = nameMatches(items, reference);
      const exact = matches.filter((m) => m.score === 1);
      const choices = exact.length ? exact : matches;
      if (choices.length === 1) return choices[0].item;
      if (!choices.length)
        throw Error(
          "No encontré " +
            catalog.entities[entity].label +
            ' para "' +
            reference +
            '". Buscá otras palabras del nombre antes de cambiar el vínculo.',
        );
      throw Error(
        'Hay varias coincidencias para "' +
          reference +
          '": ' +
          choices
            .slice(0, 10)
            .map(
              (m) => (m.item.name || m.item.title) + " (ID: " + m.item.id + ")",
            )
            .join("; ") +
          ". Pedile al usuario elegir una.",
      );
    }
    function resolveRelations(entity, data) {
      const result = { ...data };
      if (Object.hasOwn(result, "phone")) result.phone = phone.normalize(result.phone, result.phoneCountry);
      const relations = {
        jobs: { client: "clients" },
        tasks: { linkedTo: "clients" },
      };
      for (const [field, target] of Object.entries(relations[entity] || {})) {
        if (
          typeof result[field] === "string" &&
          result[field].trim() &&
          !(
            entity === "placements" &&
            field === "job" &&
            norm(result[field]) === "otros"
          )
        ) {
          const match = resolveName(target, result[field]);
          result[field] = match.name || match.title;
        }
      }
      return result;
    }
    function validate(entity, data, creating = false) {
      const spec = catalog.entities[entity];
      if (!spec) throw Error("Entidad no disponible");
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !Object.keys(data).length
      )
        throw Error("Indica los campos que querés cambiar");
      for (const [key, value] of Object.entries(data)) {
        const type = catalog.fields[entity][key]?.type;
        if (!type) throw Error("Campo no editable: " + key);
        if (
          typeof value !== type ||
          (type === "number" && !Number.isFinite(value))
        )
          throw Error("Tipo inválido para " + key);
      }
      if (
        (creating || Object.hasOwn(data, spec.required)) &&
        !String(data[spec.required] || "").trim()
      )
        throw Error("Falta " + spec.required);
      for (const key of ["due", "contactarFecha", "entrada", "salida", "date"])
        if (data[key] && !Number.isFinite(Date.parse(data[key])))
          throw Error("Fecha inválida: " + key);
      if (
        entity === "focusActivities" &&
        data.minutes !== undefined &&
        data.minutes < 1
      )
        throw Error("Minutos debe ser mayor que cero");
      if (
        entity === "jobs" &&
        data.client &&
        !get().clients.some((x) => x.name === data.client)
      )
        throw Error("Cliente no encontrado");
      if (
        entity === "tasks" &&
        data.linkedTo &&
        !get().clients.some((x) => x.name === data.linkedTo)
      )
        throw Error("Cliente relacionado no encontrado");
      if (entity === "forecast")
        for (const [field, target] of [
          ["jobId", "jobs"],
          ["candId", "candidates"],
        ])
          if (data[field] && data[field] !== "otros")
            record(target, data[field]);
      return data;
    }
    function reminder(due, title, body, max) {
      const delay = Date.parse(due) - Date.now();
      if (delay > 0 && delay < max)
        env.schedule(() => env.notify(title, body), delay);
    }
    function rename(entity, before, after) {
      const s = get();
      const replaceJobs = (text, oldName, newName) =>
        String(text || "")
          .split(", ")
          .map((t) =>
            t === oldName
              ? newName
              : t.startsWith(oldName + " - ")
                ? newName + t.slice(oldName.length)
                : t,
          )
          .filter(Boolean)
          .join(", ");
      if (entity === "candidates" && before.name !== after.name) {
        s.jobs.forEach((j) =>
          (j.pipeline || []).forEach((p) => {
            if (
              p.candidateId === before.id ||
              (!p.candidateId &&
                p.name === before.name &&
                !s.candidates.some(
                  (c) => c.id !== before.id && c.name === before.name,
                ))
            )
              p.name = after.name;
          }),
        );
        s.reportProjects.forEach((p) => {
          if (p.candidate === before.name) p.candidate = after.name;
        });
      }
      if (entity === "clients" && before.name !== after.name) {
        s.jobs.forEach((j) => {
          if (j.client === before.name) j.client = after.name;
        });
        s.tasks.forEach((t) => {
          if (t.linkedTo === before.name) t.linkedTo = after.name;
        });
        s.reportProjects.forEach((p) => {
          if (p.client === before.name) p.client = after.name;
        });
      }
      if (entity === "jobs" && before.title !== after.title) {
        s.candidates.forEach(
          (c) => (c.jobs = replaceJobs(c.jobs, before.title, after.title)),
        );
        s.clients.forEach(
          (c) => (c.jobs = replaceJobs(c.jobs, before.title, after.title)),
        );
        s.forecast.forEach((f) => {
          if (f.jobId === before.id) f.title = after.title;
        });
      }
    }
    // Shared persistence used by the Hub forms and the agent. UI supplies form strings;
    // tools validate typed fields before invoking the same operation.
    function save(entity, id, data) {
      data = resolveRelations(entity, data);
      const s = get(),
        spec = catalog.entities[entity];
      if (!spec) throw Error("Entidad no disponible");
      const existing = id ? record(entity, id) : null;
      const updated = {
        ...copy(spec.defaults),
        ...(existing || {}),
        ...data,
        id: existing?.id || env.uid(),
      };
      for (const [key, type] of Object.entries(catalog.fields[entity]))
        if (type.type === "number") updated[key] = Number(updated[key]) || 0;
      if (entity === "jobs") {
        updated.pipeline = existing?.pipeline || [];
        updated.businessArea = data.businessArea || existing?.businessArea || (existing ? "Expansion Business" : "Expansion People");
        if (!["Expansion Business", "Expansion People"].includes(updated.businessArea)) throw Error("Área no disponible");
        if (data.processStatus) updated.status = data.processStatus;
        if (Object.hasOwn(data, "status") || data.processStatus) {
          const value = updated.status;
          updated.processStatus = value === "Facturado" ? "Cubierto" : value === "En proceso" ? "Abierto" : value;
          if (!["Pendiente", "Abierto", "Standby", "Cubierto", "Cancelado"].includes(updated.processStatus)) throw Error("Estado de vacante no disponible");
        }
        updated.jobStatus = existing?.jobStatus === "Facturado" ? "Facturado" : Object.hasOwn(data, "status") || data.processStatus
          ? updated.status
          : existing?.jobStatus || updated.status;
        updated.fee =
          updated.feePercent && updated.salaryAgreed
            ? Math.round((updated.feePercent / 100) * updated.salaryAgreed)
            : 0;
      }
      if (entity === "forecast") {
        const linked = updated.jobId && updated.jobId !== "otros" ? record("jobs", updated.jobId) : null;
        updated.businessArea = data.businessArea || existing?.businessArea || (existing ? "Expansion Business" : linked ? linked.businessArea || "Expansion Business" : "Expansion People");
        updated.year = Number(data.year || existing?.year || 2026);
        if (!["Expansion People", "Expansion Business"].includes(updated.businessArea) || !Number.isInteger(updated.year) || updated.year < 2026 || updated.year > 2100) throw Error("Área o año de previsión inválidos");
        updated.billed = existing?.billed || false;
        if (updated.jobId && updated.jobId !== "otros") {
          const job = record("jobs", updated.jobId);
          updated.title = job.title;
          updated.clientName = job.client;
          updated.consultor = job.owner || "Santi";
          if (!updated.amount && !Object.hasOwn(data, "amount"))
            updated.amount = job.fee || 0;
        }
      }
      if (entity === "reportProjects") updated.output = existing?.output || "";
      const items = list(entity);
      if (existing) items[items.indexOf(existing)] = updated;
      else items.push(updated);
      if (existing) rename(entity, existing, updated);
      if (entity === "candidates" && updated.contactarFecha)
        reminder(
          updated.contactarFecha,
          "Volver a contactar: " + updated.name,
          updated.contactarNotas || "",
          30 * 24 * 3600 * 1000,
        );
      if (entity === "tasks") {
        if (updated.due) {
          reminder(
            updated.due,
            "Tarea: " + updated.title,
            updated.linkedTo || "",
            86400000,
          );
          const due = new Date(updated.due),
            day = [
              "Domingo",
              "Lunes",
              "Martes",
              "Miércoles",
              "Jueves",
              "Viernes",
              "Sábado",
            ][due.getDay()];
          if (!["Domingo", "Sábado"].includes(day)) {
            const evt = s.events.find((e) => e.taskId === updated.id) || {
              id: env.uid(),
              taskId: updated.id,
            };
            Object.assign(evt, {
              title: updated.title,
              day,
              time:
                String(due.getHours()).padStart(2, "0") +
                ":" +
                String(due.getMinutes()).padStart(2, "0"),
              due: updated.due,
            });
            if (!s.events.includes(evt)) s.events.push(evt);
          } else s.events = s.events.filter((e) => e.taskId !== updated.id);
        } else s.events = s.events.filter((e) => e.taskId !== updated.id);
      }
      if (entity === "events" && updated.due)
        reminder(
          updated.due,
          "Evento: " + updated.title,
          updated.day + " a las " + updated.time,
          7 * 86400000,
        );
      if (entity === "routine" && updated.due)
        reminder(
          updated.due,
          "Recordatorio: " + updated.activity,
          updated.reminder || "",
          86400000,
        );
      if (entity === "placements" && updated.candidato) {
        const c = s.candidates.find(
          (c) => norm(c.name) === norm(updated.candidato),
        );
        if (c) c.facturado = true;
      }
      if (entity === "focusActivities")
        updated.minutes = Math.max(updated.minutes, 1);
      if (entity === "focusActivities")
        Object.assign(s.pomodoro, {
          mode: updated.name,
          minutes: updated.minutes,
          remaining: updated.minutes * 60,
          running: false,
        });
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return copy(updated);
    }
    function remove(entity, id) {
      const s = get(),
        r = record(entity, id),
        items = list(entity);
      items.splice(items.indexOf(r), 1);
      if (entity === "tasks")
        s.events = s.events.filter((e) => e.taskId !== id);
      if (entity === "candidates") {
        s.jobs.forEach(
          (j) =>
            (j.pipeline = (j.pipeline || []).filter(
              (p) =>
                !(
                  p.candidateId === id ||
                  (!p.candidateId &&
                    p.name === r.name &&
                    !s.candidates.some((c) => c.name === r.name))
                ),
            )),
        );
        s.forecast.forEach((f) => {
          if (f.candId === id) f.candId = "";
        });
      }
      if (entity === "jobs") {
        s.forecast = s.forecast.filter((f) => f.jobId !== id);
        s.candidates.forEach(
          (c) =>
            (c.jobs = String(c.jobs || "")
              .split(", ")
              .filter((t) => t !== r.title && !t.startsWith(r.title + " - "))
              .join(", ")),
        );
        s.clients.forEach(
          (c) =>
            (c.jobs = String(c.jobs || "")
              .split(", ")
              .filter((t) => t !== r.title)
              .join(", ")),
        );
      }
      if (entity === "clients") {
        s.jobs.forEach((j) => {
          if (j.client === r.name) j.client = "";
        });
        s.tasks.forEach((t) => {
          if (t.linkedTo === r.name) t.linkedTo = "";
        });
      }
      if (entity === "focusActivities" && !items.length)
        s.pomodoro.activities = copy(env.defaultActivities || []);
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return { id, deleted: true };
    }
    function link(candidateId, jobId, stage, pipelineDetails = {}) {
      const cand = record("candidates", candidateId),
        job = record("jobs", jobId);
      job.pipeline ||= [];
      const existing = job.pipeline.find(
        (p) =>
          p.candidateId === cand.id ||
          (!p.candidateId && norm(p.name) === norm(cand.name)),
      );
      if (existing) {
        existing.stage = stage;
        existing.candidateId = cand.id;
      } else
        job.pipeline.push({
          candidateId: cand.id,
          name: cand.name,
          stage,
          label: "En proceso",
          spec: cand.specialty || "",
          tel: cand.phone || "",
          email: cand.email || "",
          linkedin: cand.linkedin || "",
          cv: cand.cv || "",
          ...pipelineDetails,
        });
      if (!norm(cand.jobs).includes(norm(job.title)))
        cand.jobs = [cand.jobs, job.title + " - " + job.client]
          .filter(Boolean)
          .join(", ");
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return { candidate_id: cand.id, job_id: job.id, stage };
    }
    function pipeline(candidateId, jobId, action, value) {
      const c = record("candidates", candidateId),
        j = record("jobs", jobId),
        p = (j.pipeline || []).find(
          (p) =>
            p.candidateId === c.id || (!p.candidateId && p.name === c.name),
        );
      if (!p) throw Error("El candidato no está vinculado");
      if (action === "unlink") {
        j.pipeline = j.pipeline.filter((x) => x !== p);
        c.jobs = String(c.jobs || "")
          .split(", ")
          .filter(
            (t) =>
              t !== j.title + " - " + j.client &&
              (t !== j.title ||
                get().jobs.some(
                  (other) =>
                    other.id !== j.id &&
                    other.title === j.title &&
                    (other.pipeline || []).some((x) => x.name === c.name),
                )),
          )
          .join(", ");
      } else p[action === "move" ? "stage" : "label"] = value;
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return { candidate_id: candidateId, job_id: jobId, action };
    }
    function removeProposal(clientId, proposalId) {
      const c = record("clients", clientId),
        index = (c.proposals || []).findIndex((p) => p.id === proposalId);
      if (index < 0) throw Error("Propuesta no encontrada");
      c.proposals.splice(index, 1);
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return { client_id: clientId, proposal_id: proposalId, deleted: true };
    }
    function callNote(candidateId, action, index, text) {
      const c = record("candidates", candidateId);
      c.callNotes ||= [];
      if (action === "add")
        c.callNotes.unshift({
          date: new Date().toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          text: text || "",
        });
      else {
        if (!Number.isInteger(index) || !c.callNotes[index])
          throw Error("Nota de llamada no encontrada");
        if (action === "delete") c.callNotes.splice(index, 1);
        else c.callNotes[index].text = text;
      }
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return {
        candidate_id: candidateId,
        action,
        index: action === "add" ? 0 : index,
      };
    }
    function proposalDefaults(clientId) {
      var client = record("clients", clientId);
      var CONSULTORES = {
        Santi: {
          email: "santiagob@expansion-people.com",
          tel: "(+34) 636 240 244",
        },
        Esteve: {
          email: "seleccion@expansion-people.com",
          tel: "(+34) 93 3957662",
        },
        Alba: {
          email: "seleccion@expansion-people.com",
          tel: "(+34) 93 3957662",
        },
        Cori: {
          email: "seleccion@expansion-people.com",
          tel: "(+34) 93 3957662",
        },
      };

      var today = new Date().toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
      var defConsultor = get().currentUser || "Santi";
      var defInfo = CONSULTORES[defConsultor] || CONSULTORES["Santi"];

      return {
        id: env.uid(),
        date: today,
        status: "borrador",
        clientName: client.name,
        razonSocial: client.razonSocial || "",
        cif: client.cif || "",
        direccion: client.dirFac || "",
        contacto: client.contact || "",
        emailCliente: client.email || "",
        consultorName: defConsultor,
        consultorEmail: defInfo.email,
        consultorTel: defInfo.tel,
        validity:
          "Hasta " +
          new Date().getFullYear() +
          "/" +
          (new Date().getFullYear() + 1),
        exclusivity: "Sí",
        feeLines: [],
        paymentTerms: {
          modalidad: "Al éxito 100% honorarios",
          emision: "Al pactar fecha de incorporación candidato/a-cliente",
          vencimiento: "30 días f/f",
          medio: "Transferencia",
          notas: "",
        },
      };
    }
    function proposal(clientId, proposalId, data) {
      const c = record("clients", clientId);
      c.proposals ||= [];
      const existing = proposalId
        ? c.proposals.find((p) => p.id === proposalId)
        : null;
      if (proposalId && !existing) throw Error("Propuesta no encontrada");
      const defaults = proposalDefaults(clientId);
      const updated = {
        ...defaults,
        ...(existing || {}),
        ...data,
        status: "generada",
        paymentTerms: {
          ...defaults.paymentTerms,
          ...(existing?.paymentTerms || {}),
          ...(data.paymentTerms || {}),
        },
      };
      updated.generatedContent = env.generateProposal(
        updated,
        c,
        updated.propTipo || "completa",
      );
      if (existing) c.proposals[c.proposals.indexOf(existing)] = updated;
      else c.proposals.push(updated);
      if (globalThis.EPTextEncoding) globalThis.EPTextEncoding.repairState(get());
      env.save();
      return {
        client_id: clientId,
        proposal_id: updated.id,
        status: updated.status,
      };
    }
    return {
      list,
      record,
      validate,
      resolveName,
      resolveRelations,
      nameMatches: (entity, query) => nameMatches(list(entity), query),
      save,
      remove,
      link,
      pipeline,
      callNote,
      proposal,
      proposalDefaults,
      removeProposal,
    };
  }
  return { create, norm };
});
