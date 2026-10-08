(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPAgentMessageFormat = api;
})(globalThis, function () {
  function render(text) {
    return String(text ?? "")
      .replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      )
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  }
  return { render };
});
