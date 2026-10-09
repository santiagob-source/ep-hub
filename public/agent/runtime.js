(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EPAgentRuntime = factory();
})(globalThis, function () {
  function create(env) {
    let busy = false,
      pending = null,
      responseId = null,
      sequence = 0;
    const controls = () => {
      env.setBusy(busy || !!pending);
    };
    const errorText = (e) => e?.message || "Error del agente";
    async function request(payload) {
      env.progress?.("Kitty está pensando…");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 35000);
      try {
        const res = await env.fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        let data;
        try {
          data = JSON.parse(await res.text());
        } catch {
          throw Error(
            `El endpoint /api/agent devolvió una respuesta no JSON (HTTP ${res.status}). Revisá el despliegue de la función en Vercel.`,
          );
        }
        if (!res.ok)
          throw Error(
            typeof data?.error === "string"
              ? data.error
              : `Error del agente (HTTP ${res.status})`,
          );
        if (
          !data ||
          typeof data.response_id !== "string" ||
          typeof data.text !== "string" ||
          !Array.isArray(data.calls)
        )
          throw Error("Respuesta inválida del agente");
        responseId = data.response_id;
        return data;
      } catch (e) {
        if (controller.signal.aborted)
          throw Error(
            "El agente tardó demasiado en responder. Intentá de nuevo.",
          );
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    function disableReview() {
      env.finishReview?.();
      pending = null;
      controls();
    }
    async function execute(plan, token) {
      try {
        env.progress?.(
          plan.name.startsWith("whatsapp_")
            ? plan.effect === "read"
              ? "Consultando WhatsApp…"
              : "Guardando la programación…"
            : plan.name.startsWith("gmail_")
              ? plan.effect === "read"
                ? "Consultando Gmail…"
                : "Aplicando la acción en Gmail…"
              : plan.effect === "read"
                ? "Buscando en el Hub…"
                : "Aplicando los cambios…",
        );
        const output = await env.engine.execute(plan, token);
        env.showResult(plan, output);
        return { call_id: plan.call_id, output };
      } catch (e) {
        env.message("system", errorText(e));
        return {
          call_id: plan.call_id,
          output: { ok: false, error: errorText(e) },
        };
      }
    }
    async function handle(data, round = 0, afterCancel = false) {
      if (data.text) env.message("assistant", data.text);
      if (!data.calls.length) return;
      if (round >= 8) {
        responseId = null;
        env.message(
          "system",
          "El agente alcanzó el límite de pasos. Pedí continuar con la acción pendiente.",
        );
        return;
      }
      if (afterCancel) {
        responseId = null;
        env.message(
          "assistant",
          "Las acciones quedaron canceladas. No ejecutaré otros cambios hasta un nuevo pedido.",
        );
        return;
      }
      const outputs = [],
        plans = [];
      const ids = new Set();
      for (const call of data.calls) {
        try {
          if (ids.has(call.call_id)) throw Error("Llamada duplicada");
          ids.add(call.call_id);
          const plan = env.engine.prepare(call);
          env.progress?.("Preparando la acción…");
          await env.engine.stage?.(plan);
          plans.push(plan);
        } catch (e) {
          outputs.push({
            call_id: call.call_id,
            output: { ok: false, error: errorText(e) },
          });
          env.message("system", errorText(e));
        }
      }
      // Preserve tool order. Reads after a write wait for the same reviewed batch.
      while (plans.length && plans[0].effect === "read")
        outputs.push(await execute(plans.shift()));
      if (plans.length) {
        const id = String(++sequence);
        pending = {
          id,
          plans,
          outputs,
          responseId: data.response_id,
          round,
          snapshot: env.engine.snapshot(),
        };
        env.review(
          id,
          plans
            .filter((p) => p.effect !== "read")
            .map((p) => env.engine.review?.(p) || p.review),
        );
        controls();
        return;
      }
      await handle(
        await request({
          previous_response_id: data.response_id,
          tool_outputs: outputs,
        }),
        round + 1,
      );
    }
    async function send(message) {
      if (busy || pending) {
        env.message(
          "system",
          pending
            ? "Confirmá o cancelá las acciones pendientes antes de enviar otro pedido."
            : "Esperá a que termine la petición actual.",
        );
        return;
      }
      if (!message.trim()) return;
      busy = true;
      controls();
      env.message("user", message);
      try {
        await handle(
          await request({
            message,
            context: env.context(),
            ...(responseId ? { previous_response_id: responseId } : {}),
          }),
        );
      } catch (e) {
        env.message("system", "No pude conectar con la IA: " + errorText(e));
      } finally {
        busy = false;
        controls();
      }
    }
    async function approve(id) {
      if (busy || !pending || pending.id !== id) return;
      const current = pending;
      if (current.snapshot !== env.engine.snapshot()) {
        busy = true;
        disableReview();
        controls();
        env.message(
          "system",
          "Los datos cambiaron desde la propuesta. La confirmación anterior ya no sirve; revisá los datos actuales.",
        );
        const outputs = [...current.outputs],
          plans = [];
        try {
          for (const plan of current.plans) {
            try {
              const refreshed = env.engine.prepare({
                call_id: plan.call_id,
                name: plan.name,
                arguments: JSON.stringify(plan.args),
              });
              await env.engine.stage?.(refreshed);
              plans.push(refreshed);
            } catch (e) {
              outputs.push({
                call_id: plan.call_id,
                output: { ok: false, error: errorText(e) },
              });
              env.message("system", errorText(e));
            }
          }
          if (plans.length) {
            pending = {
              ...current,
              id: String(++sequence),
              plans,
              outputs,
              snapshot: env.engine.snapshot(),
            };
            env.review(
              pending.id,
              plans
                .filter((p) => p.effect !== "read")
                .map((p) => env.engine.review?.(p) || p.review),
            );
          } else
            await handle(
              await request({
                previous_response_id: current.responseId,
                tool_outputs: outputs,
              }),
              current.round + 1,
            );
        } catch (e) {
          env.message("system", errorText(e));
        } finally {
          busy = false;
          controls();
        }
        return;
      }
      busy = true;
      disableReview();
      controls();
      try {
        const token = env.engine.approval(
          current.plans.filter((p) => p.effect !== "read"),
        );
        const outputs = [...current.outputs];
        for (const plan of current.plans)
          outputs.push(await execute(plan, token));
        await handle(
          await request({
            previous_response_id: current.responseId,
            tool_outputs: outputs,
          }),
          current.round + 1,
        );
      } catch (e) {
        responseId = null;
        env.message("system", "No pude completar la acción: " + errorText(e));
      } finally {
        busy = false;
        controls();
      }
    }
    async function reject(id) {
      if (busy || !pending || pending.id !== id) return;
      busy = true;
      const current = pending;
      disableReview();
      controls();
      env.message(
        "assistant",
        "Cancelado. No ejecuté las acciones pendientes.",
      );
      try {
        await handle(
          await request({
            previous_response_id: current.responseId,
            tool_outputs: [
              ...current.outputs,
              ...current.plans.map((p) => ({
                call_id: p.call_id,
                output: {
                  ok: false,
                  cancelled: true,
                  error:
                    "El usuario canceló esta acción; no reintentar sin un nuevo pedido explícito.",
                },
              })),
            ],
          }),
          current.round + 1,
          true,
        );
      } catch (e) {
        responseId = null;
        env.message(
          "system",
          "Las acciones siguen canceladas. " + errorText(e),
        );
      } finally {
        busy = false;
        controls();
      }
    }
    return {
      send,
      approve,
      reject,
      request,
      get pending() {
        return pending;
      },
      get busy() {
        return busy;
      },
    };
  }
  return { create };
});
