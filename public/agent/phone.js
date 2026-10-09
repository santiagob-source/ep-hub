(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPPhone = api;
})(globalThis, function () {
  const countries = [
    ["34", "ES", ["espana", "spain", "es"]],
    ["56", "CL", ["chile", "cl"]],
    ["51", "PE", ["peru", "pe"]],
    ["54", "AR", ["argentina", "ar"]],
    ["57", "CO", ["colombia", "co"]],
    ["52", "MX", ["mexico", "mx"]],
    ["598", "UY", ["uruguay", "uy"]],
    ["593", "EC", ["ecuador", "ec"]],
    ["591", "BO", ["bolivia", "bo"]],
    ["595", "PY", ["paraguay", "py"]],
    ["58", "VE", ["venezuela", "ve"]],
    ["55", "BR", ["brasil", "brazil", "br"]],
    ["351", "PT", ["portugal", "pt"]],
    ["33", "FR", ["francia", "france", "fr"]],
    ["49", "DE", ["alemania", "germany", "de"]],
    ["39", "IT", ["italia", "italy", "it"]],
    ["44", "GB", ["reino unido", "uk", "gb"]],
  ];
  function normalize(raw, country) {
    let phone = String(raw || "").trim().replace(/[\s().-]/g, "");
    if (!phone) return "";
    if (phone.startsWith("00")) phone = "+" + phone.slice(2);
    if (!phone.startsWith("+")) {
      const key = String(country || "espana").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const match = countries.find(([code, iso, names]) => names.includes(key) || key === "+" + code || key === code);
      if (!match) throw Error("Indicá el prefijo internacional del teléfono para ese país.");
      phone = "+" + match[0] + phone;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw Error("Revisá el teléfono: debe contener un número internacional válido.");
    if (phone.startsWith("+34") && phone.length !== 12) throw Error("Los teléfonos de España deben tener 9 dígitos después de +34.");
    return phone;
  }
  function display(raw) {
    const phone = String(raw || "");
    const match = [...countries].sort((a,b) => b[0].length-a[0].length).find(([code]) => phone.startsWith("+"+code));
    const flag = match ? [...match[1]].map(c => String.fromCodePoint(127397+c.charCodeAt(0))).join("") : "";
    return [flag, phone].filter(Boolean).join(" ");
  }
  function html(raw) {
    let value = String(raw || "").trim();
    // Infer the requested Spanish default for older local numbers, for display only.
    if (/^[6789]\d{8}$/.test(value.replace(/\s/g, ""))) value = "+34" + value.replace(/\s/g, "");
    const match = countries.find(([code]) => value.startsWith("+" + code));
    const safe = value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    return (match ? '<img src="/public/flags/' + match[1] + '.svg" alt="' + match[1] + '" width="22" height="15" style="display:inline-block;vertical-align:middle;margin-right:6px;border-radius:2px;border:1px solid #ddd">' : "") + safe;
  }
  return { normalize, display, html };
});
