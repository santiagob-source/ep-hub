const { randomUUID, createHash } = require("node:crypto");
const provider = require("./provider"),
  store = require("./store"),
  session = require("../gmail/session");
const { WhatsAppError } = provider;
const hash = (args) =>
  createHash("sha256").update(JSON.stringify(args)).digest("hex");
function madrid(at) {
  return (
    new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(at)) + " (Europe/Madrid)"
  );
}
function privateJob(doc) {
  const data = session.open(doc.payload, "whatsapp-job", doc.owner);
  if (data.id !== doc.id || data.at !== doc.due_at)
    throw new WhatsAppError(
      409,
      "La programación no coincide con su autorización.",
    );
  return data;
}
function view(doc) {
  const data = privateJob(doc);
  return {
    id: doc.id,
    recipient: data.recipient,
    phone: data.phone,
    scheduled_for: madrid(data.at),
    send_at: new Date(data.at).toISOString(),
    message: data.text,
    status: doc.state,
    message_id: doc.message_id || null,
    detail: doc.detail || "",
    approved_at: data.approved_at,
  };
}
async function readiness() {
  if (!store.configured() || (process.env.CRON_SECRET || "").length < 32)
    throw new WhatsAppError(
      503,
      "Falta configurar la cola privada y el ejecutor de WhatsApp.",
    );
  const worker = await store.get("worker");
  if (!worker || worker.last_run < Date.now() - 180000)
    throw new WhatsAppError(
      503,
      "El ejecutor de WhatsApp no está activo. No puedo garantizar la programación; revisá el cron externo.",
    );
}
function validate(args, now = Date.now()) {
  provider.identifier(args.phone);
  if (
    typeof args.recipient !== "string" ||
    !args.recipient.trim() ||
    args.recipient.length > 200
  )
    throw new WhatsAppError(400, "Falta el nombre del destinatario.");
  if (
    typeof args.send_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(
      args.send_at,
    )
  )
    throw new WhatsAppError(
      400,
      "Indicá fecha y hora con zona horaria. Kitty usa Europe/Madrid.",
    );
  const at = Date.parse(args.send_at);
  if (!Number.isFinite(at) || at < now + 60000 || at > now + 30 * 86400000)
    throw new WhatsAppError(
      400,
      "Programá entre un minuto y 30 días en el futuro.",
    );
  if (args.template_name) {
    if (args.message)
      throw new WhatsAppError(
        400,
        "Elegí texto libre o plantilla, sin mezclar ambos mensajes.",
      );
    if (typeof args.template_language !== "string" || !args.template_language)
      throw new WhatsAppError(400, "Falta el idioma de la plantilla.");
  } else if (
    typeof args.message !== "string" ||
    !args.message.trim() ||
    args.message.length > 4096
  )
    throw new WhatsAppError(400, "Indicá un mensaje de hasta 4096 caracteres.");
  return at;
}
async function prepare(uid, tool, args) {
  if (tool === "whatsapp_cancel") {
    const doc = await store.get(args.schedule_id);
    if (!doc || doc.owner !== uid)
      throw new WhatsAppError(
        404,
        "No encontré esa programación entre tus envíos.",
      );
    if (doc.state !== "pending")
      throw new WhatsAppError(
        409,
        "Solo se pueden cancelar envíos pendientes. Un envío ya iniciado no puede detenerse.",
      );
    return {
      capability: session.seal({
        kind: "whatsapp-approval",
        uid,
        tool,
        id: doc.id,
        version: doc._version,
        hash: hash(args),
        expires: Date.now() + 300000,
      }),
      review: {
        title: "Cancelar WhatsApp programado",
        arguments: view(doc),
        effects: "Se cancelará este envío pendiente.",
      },
    };
  }
  if (tool !== "whatsapp_schedule")
    throw new WhatsAppError(400, "Acción de WhatsApp inválida.");
  const at = validate(args);
  await readiness();
  const existing = await provider.contact(args.phone);
  let text, message;
  if (args.template_name) {
    const def = await provider.template(
      args.template_name,
      args.template_language,
    );
    const rendered = provider.renderTemplate(
      def,
      args.template_parameters || [],
    );
    text = rendered.text;
    message = rendered.message;
  } else {
    if (!existing)
      throw new WhatsAppError(
        400,
        "No hay una conversación abierta para este contacto. Usá una plantilla aprobada.",
      );
    await provider.assertWindow(args.phone, at);
    text = args.message;
    message = { type: "text", text };
  }
  const payload = {
    kind: "whatsapp-approval",
    uid,
    tool,
    id: randomUUID(),
    hash: hash(args),
    at,
    recipient: args.recipient,
    phone: args.phone,
    channel_id: provider.channelId(),
    text,
    provider_message: message,
    create_contact: !existing,
    expires: Date.now() + 300000,
  };
  return {
    capability: session.seal(payload),
    review: {
      title: "Programar WhatsApp",
      arguments: {
        recipient: args.recipient,
        phone: args.phone,
        scheduled_for: madrid(at),
        message: text,
        ...(args.template_name
          ? {
              template_name: args.template_name,
              template_language: args.template_language,
            }
          : {}),
      },
      requiresConsent: true,
      effects:
        "Se enviará desde el WhatsApp de la empresa a la hora indicada, aunque cierres el Hub. Se procesa un envío por minuto. Tolerancia habitual: aproximadamente un minuto; si se retrasa más de 10 minutos, se marcará vencido sin enviar." +
        (!existing ? " También se creará el contacto en respond.io." : ""),
    },
  };
}
async function execute(uid, tool, args, capability, consent) {
  const approval = session.open(capability, "whatsapp-approval", uid);
  if (approval.tool !== tool || approval.hash !== hash(args))
    throw new WhatsAppError(409, "La acción cambió. Revisala nuevamente.");
  if (tool === "whatsapp_cancel") {
    const doc = await store.get(approval.id);
    if (
      !doc ||
      doc.owner !== uid ||
      doc.state !== "pending" ||
      doc._version !== approval.version
    )
      throw new WhatsAppError(
        409,
        "El envío cambió o ya empezó. Consultá su estado.",
      );
    await store.update(doc, {
      state: "cancelled",
      detail: "Cancelado por el usuario.",
    });
    return { ok: true, cancelled: true, schedule_id: doc.id };
  }
  if (tool !== "whatsapp_schedule" || consent !== true)
    throw new WhatsAppError(
      400,
      "Confirmá que el destinatario aceptó recibir mensajes de la empresa por WhatsApp.",
    );
  const existing = await store.get(approval.id);
  if (existing && existing.owner === uid)
    return { ok: true, scheduled: true, ...view(existing) };
  validate(args);
  await readiness();
  const job = {
    ...approval,
    kind: "whatsapp-job",
    approved_at: new Date().toISOString(),
    consent_confirmed: true,
    expires: Date.now() + 366 * 86400000,
  };
  let doc;
  try {
    doc = await store.create(job.id, {
      owner: uid,
      due_at: job.at,
      state: "pending",
      payload: session.seal(job),
      last_check_at: 0,
    });
  } catch (e) {
    if (e.status !== 409) throw e;
    doc = await store.get(job.id);
    if (!doc || doc.owner !== uid) throw e;
  }
  return { ok: true, scheduled: true, ...view(doc) };
}
async function list(uid) {
  return {
    items: (
      await store.query(
        [
          store.filter("owner", "EQUAL", uid),
          store.filter(
            "due_at",
            "GREATER_THAN_OR_EQUAL",
            Date.now() - 30 * 86400000,
          ),
        ],
        100,
        "-due_at",
      )
    )
      .filter((d) => d.payload)
      .map(view)
      .sort((a, b) => b.send_at.localeCompare(a.send_at)),
    limit: 100,
  };
}
async function status() {
  const data = await provider.request("/space/channel?limit=100");
  const ch = (data.items || []).find((x) => x.id === provider.channelId());
  if (!ch || !String(ch.source).includes("whatsapp"))
    throw new WhatsAppError(
      503,
      "No encontré el canal WhatsApp configurado entre los canales del token.",
    );
  let worker = false;
  try {
    await readiness();
    worker = true;
  } catch {}
  return {
    connected: true,
    channel: ch.name,
    channel_id: ch.id,
    scheduler_ready: worker,
  };
}
async function worker() {
  const deadline = Date.now() + 42000;
  const filter = store.filter;
  // CAS claims prevent concurrent cron calls from sending the same job twice.
  const due = await store.query(
    [
      filter("state", "EQUAL", "pending"),
      filter("due_at", "LESS_THAN_OR_EQUAL", Date.now()),
    ],
    1,
    "due_at",
  );
  await store.heartbeat();
  let handled = 0;
  for (const doc of due) {
    let claimed;
    try {
      claimed = await store.update(doc, {
        state: "sending",
        started_at: Date.now(),
      });
    } catch (e) {
      if (e.status === 409) continue;
      throw e;
    }
    let job, result;
    try {
      job = privateJob(claimed);
      if (
        !(process.env.RESPOND_IO_ALLOWED_UIDS || "")
          .split(",")
          .map((x) => x.trim())
          .includes(job.uid) ||
        job.consent_confirmed !== true
      )
        throw new WhatsAppError(
          403,
          "La autorización del usuario o consentimiento ya no es válida. No se envió.",
        );
      if (job.channel_id !== provider.channelId())
        throw new WhatsAppError(
          409,
          "El canal de WhatsApp cambió después de la confirmación. No se envió.",
        );
      if (job.at < Date.now() - 600000) {
        await store.update(claimed, {
          state: "expired",
          detail: "Venció la tolerancia de 10 minutos. No se envió.",
        });
        continue;
      }
      if (job.provider_message.type === "text")
        await provider.assertWindow(job.phone, Date.now());
      else {
        const def = await provider.template(
          job.provider_message.template.name,
          job.provider_message.template.languageCode,
        );
        const params =
          job.provider_message.template.components?.[0]?.parameters?.map(
            (p) => p.text,
          ) || [];
        if (provider.renderTemplate(def, params).text !== job.text)
          throw new WhatsAppError(
            409,
            "La plantilla cambió después de la confirmación. No se envió.",
          );
      }
      result = await provider.send(job);
    } catch (e) {
      await store.update(claimed, {
        state: e.uncertain ? "unknown" : "failed",
        detail: e.status
          ? e.message
          : "No se pudo verificar la programación. No se reintentará automáticamente.",
      });
      handled++;
      continue;
    }
    // If this save fails after provider accepted, job remains sending; never resend automatically.
    await store.update(claimed, {
      state: "accepted",
      message_id: result.messageId,
      detail: "Aceptado por respond.io; entrega pendiente de confirmar.",
    });
    handled++;
  }
  if (Date.now() > deadline) return { ok: true, processed: handled };
  const stuck = await store.query([filter("state", "EQUAL", "sending")], 10);
  for (const doc of stuck) {
    if (Date.now() > deadline) break;
    if (doc.started_at < Date.now() - 180000) {
      try {
        await store.update(doc, {
          state: "unknown",
          detail:
            "No se pudo confirmar el resultado. Revisá respond.io antes de programar otro envío; no se reintentó.",
        });
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
  }
  if (Date.now() > deadline) return { ok: true, processed: handled };
  const accepted = await store.query(
    [filter("state", "IN", ["accepted", "sent", "delivered"])],
    1,
    "last_check_at",
  );
  for (const doc of accepted) {
    try {
      const result = await provider.messageStatus({
        ...privateJob(doc),
        message_id: doc.message_id,
      });
      const last = result.status?.at(-1)?.value;
      if (["sent", "delivered", "read", "failed"].includes(last))
        await store.update(doc, {
          state: last,
          detail: "Estado confirmado por respond.io: " + last,
          last_check_at: Date.now(),
        });
      else await store.update(doc, { last_check_at: Date.now() });
    } catch {
      try {
        await store.update(doc, { last_check_at: Date.now() });
      } catch {}
    }
  }
  return { ok: true, processed: handled };
}
module.exports = {
  validate,
  madrid,
  prepare,
  execute,
  list,
  status,
  worker,
  view,
  readiness,
};
