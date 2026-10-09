(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPKittyPresentation = api;
})(globalThis, function () {
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const labels = {
    recipient: "Destinatario",
    scheduled_for: "Fecha y hora",
    send_at: "Fecha y hora",
    template_name: "Plantilla",
    template_language: "Idioma",
    schedule_id: "Envío programado",
    approved_at: "Confirmado el",
    detail: "Detalle",
    name: "Nombre",
    title: "Título",
    client: "Cliente",
    linkedTo: "Vincular con",
    due: "Fecha",
    priority: "Prioridad",
    status: "Estado",
    email: "Correo",
    phone: "Teléfono",
    phoneCountry: "País del teléfono",
    notes: "Notas",
    location: "Ubicación",
    specialty: "Especialidad",
    to: "Para",
    from: "De",
    cc: "CC",
    bcc: "CCO",
    subject: "Asunto",
    body: "Mensaje",
    data: "Cambios",
    entity: "Tipo de registro",
    id: "Registro",
    candidate_id: "Candidato",
    job_id: "Job",
    client_id: "Cliente",
    draft_id: "Borrador",
    stage: "Etapa",
    message: "Mensaje",
    action: "Acción",
    attachments: "Adjuntos",
    filename: "Archivo",
    body_format: "Formato",
    truncated: "Contenido recortado",
    draft_id: "Borrador",
  };
  function stateLabel(value) {
    const names = {
      pending: "Pendiente",
      sending: "En proceso",
      accepted: "Aceptado; entrega sin confirmar",
      sent: "Enviado",
      delivered: "Entregado",
      read: "Leído",
      failed: "Falló",
      unknown: "Resultado incierto; revisar respond.io",
      cancelled: "Cancelado",
      expired: "Vencido sin enviar",
      APPROVED: "Aprobada",
    };
    return Object.hasOwn(names, value) ? names[value] : value;
  }
  function fields(data, resolve) {
    return Object.entries(data || {})
      .filter(
        ([key]) =>
          ![
            "revision",
            "thread_id",
            "message_id",
            "labels",
            "snippet",
          ].includes(key),
      )
      .map(([key, value]) => {
        if (value && typeof value === "object" && !Array.isArray(value))
          return (
            '<div class="kitty-field-group"><h4>' +
            escape(labels[key] || key.replace(/[_-]/g, " ")) +
            "</h4>" +
            fields(value, resolve) +
            "</div>"
          );
        const pretty =
          resolve?.(key, value, data) ||
          (typeof value === "boolean"
            ? value
              ? "Sí"
              : "No"
            : Array.isArray(value)
              ? value
                  .map((v) =>
                    typeof v === "object" ? Object.values(v).join(" · ") : v,
                  )
                  .join(", ")
              : value);
        return (
          '<div class="kitty-field"><dt>' +
          escape(labels[key] || key.replace(/[_-]/g, " ")) +
          "</dt><dd>" +
          escape(pretty === "" || pretty == null ? "Sin valor" : pretty) +
          "</dd></div>"
        );
      })
      .join("");
  }
  function review(item, resolve) {
    return (
      '<article class="agent-call"><h3>' +
      escape(item.title) +
      "</h3><dl>" +
      fields(item.arguments, resolve) +
      "</dl>" +
      (item.before
        ? "<details><summary>Ver datos actuales</summary><dl>" +
          fields(item.before, resolve) +
          "</dl></details>"
        : "") +
      '<p class="kitty-effects">' +
      escape(item.effects) +
      "</p></article>"
    );
  }
  function rootPhone(value) { return globalThis.EPPhone ? globalThis.EPPhone.display(value) : value; }
  function results(plan, result) {
    if (plan.name === "gmail_search") return "";
    if (!Array.isArray(result.items) || !result.items.length) return "";
    const items = result.items || [],
      mail = plan.name === "gmail_search";
    return (
      '<div class="kitty-results-heading">' +
      items.length +
      " " +
      (mail ? "correos" : "resultados") +
      (result.has_more || result.next_page_token
        ? " · Hay más resultados"
        : "") +
      '</div><div class="agent-result-list">' +
      items
        .map(
          (item) =>
            '<article class="agent-result-item"><strong>' +
            escape(
              item.name ||
                item.title ||
                item.subject ||
                item.activity ||
                item.date ||
                "Sin título",
            ) +
            "</strong><span>" +
            escape(
              mail
                ? [item.from, item.date].filter(Boolean).join(" · ")
                : [
                    item.scheduled_for,
                    rootPhone(item.phone),
                    item.specialty,
                    item.location,
                    stateLabel(item.status),
                    item.languageCode,
                    item.client,
                    item.email,
                  ]
                    .filter(Boolean)
                    .join(" · "),
            ) +
            "</span>" +
            (mail
              ? "<p>" + escape(item.snippet) + "</p>"
              : plan.args.entity && item.id
                ? '<button type="button" data-kitty-record="' +
                  escape(item.id) +
                  '" data-kitty-entity="' +
                  escape(plan.args.entity) +
                  '">Abrir ficha ↗</button>'
                : "") +
            "</article>",
        )
        .join("") +
      "</div>"
    );
  }
  return { review, results, escape };
});
