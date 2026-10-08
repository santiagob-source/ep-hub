(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./catalog"));
  else root.EPHubActions = factory(root.EPAgentCatalog);
})(globalThis, function (catalog) {
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const norm = (x) =>
    String(x || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
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
        updated.jobStatus = Object.hasOwn(data, "status")
          ? updated.status
          : existing?.jobStatus || updated.status;
        updated.fee =
          updated.feePercent && updated.salaryAgreed
            ? Math.round((updated.feePercent / 100) * updated.salaryAgreed)
            : 0;
      }
      if (entity === "forecast") {
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
      env.save();
      return { candidate_id: candidateId, job_id: jobId, action };
    }
    function removeProposal(clientId, proposalId) {
      const c = record("clients", clientId),
        index = (c.proposals || []).findIndex((p) => p.id === proposalId);
      if (index < 0) throw Error("Propuesta no encontrada");
      c.proposals.splice(index, 1);
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
