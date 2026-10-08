(function (root) {
  function create(env) {
    let state = { connected: false, configured: false, email: "" };
    async function request(body) {
      const user = env.user();
      if (!user) throw Error("Iniciá sesión en el Hub para conectar Gmail.");
      const response = await fetch("/api/gmail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + (await user.getIdToken()),
        },
        body: JSON.stringify(body),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw Error("Gmail no respondió correctamente.");
      }
      if (!response.ok)
        throw Error(data.error || "Gmail no pudo completar la operación.");
      return data;
    }
    async function status() {
      state = await request({ action: "status" });
      env.changed?.(state);
      return state;
    }
    const adapters = {};
    for (const name of [
      "gmail_search",
      "gmail_read",
      "gmail_get_draft",
      "gmail_create_draft",
      "gmail_send_draft",
    ])
      adapters[name] = {
        check: () => {},
        stage: async (args) =>
          name === "gmail_create_draft" || name === "gmail_send_draft"
            ? request({ action: "prepare", tool: name, args })
            : null,
        execute: (args, staged) =>
          request({
            action: "execute",
            tool: name,
            args,
            capability: staged?.capability,
          }),
      };
    adapters.gmail_status = { execute: status };
    return {
      adapters,
      status,
      context: () => ({ ...state }),
      connect: async () => {
        const data = await request({ action: "connect" });
        location.assign(data.url);
      },
      disconnect: async () => {
        await request({ action: "disconnect" });
        return status();
      },
    };
  }
  root.EPAgentGmail = { create };
})(globalThis);
