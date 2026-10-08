(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPAgentMessageFormat = api;
})(globalThis, function () {
  function render(text) {
    const formatted = String(text ?? "")
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
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>");
    const lines = formatted.split("\n");
    let list = null;
    const output = [];
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/),
        number = line.match(/^\s*\d+[.)]\s+(.+)$/),
        heading = line.match(/^#{1,3}\s+(.+)$/);
      const kind = bullet ? "ul" : number ? "ol" : null;
      if (list && list !== kind) {
        output.push("</" + list + ">");
        list = null;
      }
      if (kind) {
        if (!list) {
          output.push("<" + kind + ">");
          list = kind;
        }
        output.push("<li>" + (bullet || number)[1] + "</li>");
      } else output.push(heading ? "<h3>" + heading[1] + "</h3>" : line);
    }
    if (list) output.push("</" + list + ">");
    return output.join("\n");
  }
  return { render };
});
