(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPTextEncoding = api;
})(globalThis, function() {
  const extra = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
  const byte = c => { const index = extra.indexOf(c); return index >= 0 ? 128 + index : c.charCodeAt(0); };
  function repair(value) {
    if (typeof value !== "string") return value;
    let result = value;
    for (let pass = 0; pass < 3; pass++) {
      const next = result.replace(/[ÃÂâð][\u0080-\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]{1,3}/g, token => {
        try { return new TextDecoder("utf-8", {fatal:true}).decode(Uint8Array.from([...token].map(byte))); }
        catch { return token; }
      });
      if (next === result) break;
      result = next;
    }
    return result;
  }
  const fields = new Set(["name","title","client","clientName","job","jobs","linkedTo","specialty","location","notes","contact","contactFac","razonSocial","dirFac","activity","consultant","owner","description","text","content","contactarNotas"]);
  function repairState(value) {
    if (Array.isArray(value)) { value.forEach(repairState); return value; }
    if (!value || typeof value !== "object") return value;
    for (const [key, child] of Object.entries(value)) {
      if (fields.has(key) && typeof child === "string") value[key] = repair(child);
      else if (child && typeof child === "object" && !["files","attachments","_sync"].includes(key)) repairState(child);
    }
    return value;
  }
  return { repair, repairState };
});
