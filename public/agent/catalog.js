(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EPAgentCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const str = { type: "string" },
    num = { type: "number" },
    bool = { type: "boolean" };
  const entities = {
    candidates: {
      label: "candidato",
      required: "name",
      defaults: {
        name: "",
        phone: "",
        email: "",
        specialty: "",
        location: "",
        status: "CV Recibido",
        cv: "",
        linkedin: "",
        jobs: "",
        interviews: "",
        notes: "",
        contactarFecha: "",
        contactarNotas: "",
      },
    },
    clients: {
      label: "cliente",
      required: "name",
      defaults: {
        name: "",
        status: "Activo",
        contact: "",
        phone: "",
        email: "",
        jobs: "",
        notes: "",
        razonSocial: "",
        cif: "",
        dirFac: "",
        emailFac: "",
        contactFac: "",
      },
    },
    jobs: {
      label: "job",
      required: "title",
      defaults: {
        title: "",
        client: "",
        owner: "Santi",
        status: "En proceso",
        feePercent: 0,
        salaryAgreed: 0,
        notes: "",
      },
    },
    tasks: {
      label: "tarea",
      required: "title",
      defaults: {
        title: "",
        priority: "Media",
        due: "",
        linkedTo: "",
        notes: "",
        done: false,
      },
    },
    events: {
      label: "evento",
      required: "title",
      defaults: { title: "", day: "Lunes", time: "08:00", due: "" },
    },
    routine: {
      label: "bloque de rutina",
      required: "activity",
      defaults: {
        day: "Lunes",
        slot: "08:00",
        activity: "",
        due: "",
        reminder: "",
      },
    },
    commercial: {
      label: "acción comercial",
      required: "title",
      defaults: {
        channel: "",
        title: "",
        status: "Prospeccion",
        owner: "Santi",
        details: "",
      },
    },
    placements: {
      label: "facturación",
      required: "client",
      defaults: {
        consultant: "Santi",
        month: "",
        amount: 0,
        client: "",
        job: "",
        candidato: "",
        date: "",
        notes: "",
      },
    },
    forecast: {
      label: "forecast",
      required: "title",
      defaults: {
        title: "Nuevo item",
        jobId: "",
        candId: "",
        clientName: "",
        consultor: "Santi",
        amount: 0,
        month: "",
        notas: "",
      },
    },
    goals: {
      label: "objetivo",
      required: "consultant",
      defaults: { consultant: "", role: "", target: 0, tiers: "" },
    },
    notas: {
      label: "nota",
      required: "title",
      defaults: { title: "Nueva nota", content: "", color: "#FEF9C3" },
    },
    reportProjects: {
      label: "proyecto de informe",
      required: "name",
      defaults: { name: "", client: "", candidate: "", cv: "", notes: "" },
    },
    fichajes: {
      label: "fichaje",
      required: "date",
      defaults: { date: "", entrada: "", salida: "", notas: "" },
    },
    focusActivities: {
      label: "actividad de enfoque",
      required: "name",
      defaults: { name: "", minutes: 25 },
    },
  };
  const fields = {};
  for (const [key, spec] of Object.entries(entities))
    fields[key] = Object.fromEntries(
      Object.entries(spec.defaults).map(([k, v]) => [
        k,
        typeof v === "number" ? num : typeof v === "boolean" ? bool : str,
      ]),
    );
  const entity = { type: "string", enum: Object.keys(entities) };
  const data = {
    type: "object",
    description:
      "Solo campos editables de la entidad, descritos por describe_actions. Nunca id, archivos, pipeline, proposals ni metadatos.",
    additionalProperties: true,
  };
  const definitions = [];
  function add(name, description, properties, required, effect = "read") {
    definitions.push({
      name,
      description,
      effect,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    });
  }
  add(
    "describe_actions",
    "Lista entidades, campos y acciones disponibles. Consultar antes de escribir campos desconocidos.",
    {},
    [],
  );
  add(
    "search_records",
    "Busca/lista entidades del Hub. Devuelve IDs exactos y registros. Filtros por campos; incluye notas, jobs y clientes relacionados.",
    {
      entity,
      query: str,
      filters: { type: "object", additionalProperties: true },
      limit: { type: "integer", minimum: 1, maximum: 50 },
      offset: { type: "integer", minimum: 0 },
    },
    ["entity"],
  );
  add(
    "get_record",
    "Lee el detalle completo de un registro por ID, incluyendo relaciones y notas. No envía contenido binario de archivos.",
    { entity, id: str },
    ["entity", "id"],
  );
  add(
    "create_record",
    "Crea una entidad con datos explícitos. Requiere confirmación.",
    { entity, data },
    ["entity", "data"],
    "write",
  );
  add(
    "update_record",
    "Edita SOLO los campos indicados de un registro identificado por ID. Buscar primero; no adivinar IDs. Requiere confirmación.",
    { entity, id: str, data },
    ["entity", "id", "data"],
    "write",
  );
  add(
    "delete_record",
    "Elimina un registro por ID. Muestra los efectos sobre relaciones y requiere confirmación.",
    { entity, id: str },
    ["entity", "id"],
    "delete",
  );
  add(
    "pipeline_action",
    "Vincula/desvincula un candidato existente a un job o cambia etapa/etiqueta. IDs exactos. Etapas: Busqueda, Contactado, Entrevista, Entrevista C/C, Oferta.",
    {
      action: { type: "string", enum: ["link", "unlink", "move", "label"] },
      candidate_id: str,
      job_id: str,
      stage: str,
      label: str,
    },
    ["action", "candidate_id", "job_id"],
    "write",
  );
  add(
    "candidate_note",
    "Añade, edita o elimina una nota de llamada. Para editar/eliminar leer antes el registro y usar el índice exacto.",
    {
      action: { type: "string", enum: ["add", "update", "delete"] },
      candidate_id: str,
      index: { type: "integer", minimum: 0 },
      text: str,
    },
    ["action", "candidate_id"],
    "write",
  );
  add(
    "job_finance",
    "Asigna/quita mes de forecast o facturación usando la lógica del Hub. Puede crear/eliminar forecast y placements y cambiar el estado del job.",
    {
      job_id: str,
      type: { type: "string", enum: ["forecast", "billing"] },
      action: { type: "string", enum: ["set", "clear"] },
      month: str,
    },
    ["job_id", "type", "action"],
    "write",
  );
  add(
    "forecast_billing",
    "Factura o revierte un forecast usando fc_bill/fc_unbill; modifica facturación, job y candidato relacionados.",
    { id: str, billed: bool },
    ["id", "billed"],
    "write",
  );
  const feeLines = {
    type: "array",
    items: {
      type: "object",
      properties: {
        perfil: str,
        tipoFee: str,
        valor: str,
        garantia: str,
        notas: str,
      },
      required: ["perfil"],
      additionalProperties: false,
    },
  };
  const proposalData = {
    type: "object",
    properties: Object.fromEntries(
      [
        "date",
        "clientName",
        "razonSocial",
        "cif",
        "direccion",
        "contacto",
        "emailCliente",
        "consultorName",
        "consultorEmail",
        "consultorTel",
        "propTipo",
        "validity",
        "exclusivity",
      ].map((k) => [k, str]),
    ),
    additionalProperties: false,
  };
  proposalData.properties.feeLines = feeLines;
  proposalData.properties.paymentTerms = {
    type: "object",
    properties: Object.fromEntries(
      ["modalidad", "emision", "vencimiento", "medio", "notas"].map((k) => [
        k,
        str,
      ]),
    ),
    additionalProperties: false,
  };
  add(
    "proposal_action",
    "Crear/editar/eliminar propuesta de cliente, marcar firmada o programar renovación. Leer primero cliente para obtener proposal_id. Conserva los archivos existentes.",
    {
      action: {
        type: "string",
        enum: ["create", "update", "delete", "sign", "renew"],
      },
      client_id: str,
      proposal_id: str,
      data: proposalData,
      date: str,
    },
    ["action", "client_id"],
    "write",
  );
  add(
    "clock_action",
    "Registrar entrada o salida del fichaje actual. No inventar horarios pasados; usar create_record fichajes para registros manuales.",
    { type: { type: "string", enum: ["entrada", "salida"] } },
    ["type"],
    "write",
  );
  add(
    "focus_action",
    "Controla Pomodoro o selecciona una actividad existente.",
    {
      action: { type: "string", enum: ["start", "pause", "reset", "select"] },
      activity_id: str,
    },
    ["action"],
    "write",
  );
  add(
    "dashboard_action",
    "Mostrar/ocultar un widget o cambiar su orden en el dashboard.",
    {
      action: { type: "string", enum: ["show", "hide", "reorder"] },
      widget: {
        type: "string",
        enum: [
          "stats",
          "urgentes",
          "candidatos",
          "jobs",
          "placements",
          "tasks",
        ],
      },
      order: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "stats",
            "urgentes",
            "candidatos",
            "jobs",
            "placements",
            "tasks",
          ],
        },
      },
    },
    ["action"],
    "write",
  );
  add(
    "generate_report",
    "Genera y guarda el informe de un proyecto existente reutilizando el generador del Hub.",
    { id: str },
    ["id"],
    "write",
  );
  add(
    "hub_summary",
    "Lee cifras de facturación, candidatos, jobs, tareas, forecast y objetivos; no modifica datos.",
    {},
    [],
  );
  add(
    "open_view",
    "Abre una sección o detalle existente del Hub.",
    {
      view: {
        type: "string",
        enum: [
          "dashboard",
          "clients",
          "candidates",
          "jobs",
          "tasks",
          "calendar",
          "routine",
          "commercial",
          "notas",
          "forecast",
          "placements",
          "goals",
          "pomodoro",
          "reports",
          "fichaje",
          "metricas",
        ],
      },
      entity: { type: "string", enum: ["candidates", "clients", "jobs"] },
      id: str,
    },
    [],
  );
  add(
    "prepare_document",
    "Prepara un email de facturación o job description usando las funciones existentes. No envía correos.",
    {
      kind: {
        type: "string",
        enum: [
          "job_email",
          "placement_email",
          "job_description",
          "weekly_report",
        ],
      },
      id: str,
    },
    ["kind"],
  );
  add(
    "file_action",
    "Descarga/abre un archivo o solicita al usuario seleccionarlo; quitar/adjuntar requiere confirmación. Nunca inventar contenido de archivos.",
    {
      action: {
        type: "string",
        enum: [
          "download",
          "upload",
          "remove",
          "view_proposal",
          "download_word",
          "download_signed",
          "download_attached",
          "upload_signed",
          "attach_proposal",
        ],
      },
      candidate_id: str,
      field: { type: "string", enum: ["cv", "informe"] },
      client_id: str,
      proposal_id: str,
    },
    ["action"],
    "dynamic",
  );
  add(
    "export_data",
    "Descarga una copia JSON local del Hub con la función de exportación existente.",
    {},
    [],
  );
  add(
    "import_data",
    "Abre el importador existente. Requiere confirmación del agente y selección/revisión del archivo por el usuario en el Hub.",
    {},
    [],
    "write",
  );
  add(
    "generate_boolean",
    "Genera un booleano de búsqueda, sin consultar LinkedIn.",
    {
      specialty: str,
      aliases: { type: "array", items: str },
      location: str,
      locationAliases: { type: "array", items: str },
      keywords: { type: "array", items: str },
      exclude: { type: "array", items: str },
      query: str,
    },
    [],
  );
  add(
    "prepare_whatsapp",
    "Prepara un enlace de WhatsApp para un candidato existente, sin enviar mensajes.",
    { candidate_id: str, message: str },
    ["candidate_id"],
  );
  function effect(def, args) {
    return def.effect === "dynamic"
      ? ["upload", "remove", "upload_signed", "attach_proposal"].includes(
          args.action,
        )
        ? "write"
        : "read"
      : def.effect;
  }
  return {
    entities,
    fields,
    definitions,
    effect,
    tools: definitions.map(({ name, description, parameters }) => ({
      type: "function",
      name,
      description,
      parameters,
      strict: false,
    })),
  };
});
