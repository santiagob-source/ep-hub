const { AsyncLocalStorage } = require("node:async_hooks");
const context = new AsyncLocalStorage();
function run(milliseconds, fn) {
  return context.run(Date.now() + milliseconds, fn);
}
function signal(milliseconds) {
  const deadline = context.getStore();
  const remaining = deadline ? deadline - Date.now() : milliseconds;
  if (remaining <= 0) {
    const error = new Error(
      "La operación de WhatsApp tardó demasiado. Consultá su estado antes de repetirla.",
    );
    error.status = 504;
    throw error;
  }
  return AbortSignal.timeout(
    Math.max(1, Math.min(milliseconds, Math.floor(remaining))),
  );
}
module.exports = { run, signal };
