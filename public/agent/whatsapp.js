(function (root) {
  function create(env) {
    let info = { connected: false, scheduler_ready: false };
    async function request(body) {
      const user = env.user();
      if (!user) throw Error("Iniciá sesión en el Hub para usar WhatsApp.");
      const r = await fetch("/api/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (await user.getIdToken()),
        },
        body: JSON.stringify(body),
      });
      let data;
      try {
        data = await r.json();
      } catch {
        throw Error("WhatsApp no devolvió una respuesta JSON.");
      }
      if (!r.ok)
        throw Error(data.error || "No se pudo completar la operación.");
      return data;
    }
    const adapters = {};
    for (const name of [
      "whatsapp_status",
      "whatsapp_templates",
      "whatsapp_list_scheduled",
      "whatsapp_schedule",
      "whatsapp_cancel",
    ])
      adapters[name] = {
        check: (args) => {
          if (name === "whatsapp_schedule")
            env.hub.record("candidates", args.candidate_id);
        },
        stage: async (args) => {
          if (!["whatsapp_schedule", "whatsapp_cancel"].includes(name))
            return null;
          let serverArgs = { ...args };
          if (name === "whatsapp_schedule") {
            const c = env.hub.record("candidates", args.candidate_id);
            const phone = String(c.phone || "")
              .replace(/[\s()-]/g, "")
              .replace(/^00/, "+");
            if (!/^\+[1-9]\d{7,14}$/.test(phone))
              throw Error(
                "El candidato necesita un teléfono con prefijo internacional. Actualizá su ficha antes de programar.",
              );
            serverArgs = { ...args, recipient: c.name, phone };
          }
          return {
            ...(await request({
              action: "prepare",
              tool: name,
              args: serverArgs,
            })),
            serverArgs,
          };
        },
        execute: async (args, staged) => {
          const data = await request({
            action: "execute",
            tool: name,
            args: staged?.serverArgs || args,
            capability: staged?.capability,
            consent: name === "whatsapp_schedule" ? env.consent() : undefined,
          });
          if (name === "whatsapp_status") {
            info = data;
            env.changed?.(data);
          }
          return data;
        },
      };
    return {
      adapters,
      context: () => ({ ...info }),
      status: () => adapters.whatsapp_status.execute({}),
    };
  }
  root.EPAgentWhatsApp = { create };
})(globalThis);
