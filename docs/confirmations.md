# Confirmaciones de La Kitty

Preferencia del usuario: las operaciones internas cotidianas no deben pedir una segunda confirmación. El pedido en el chat autoriza crear/editar registros, vínculos y etapas, añadir/editar notas, tareas, foco, informes, guardar adjuntos, crear borradores de Gmail y eventos de Calendar sin invitados.

Mantener revisión explícita para enviar correos y WhatsApps, programar WhatsApps, crear invitaciones de Calendar, eliminar registros/notas/propuestas/archivos, firmar propuestas e importar datos. Herramientas futuras requieren confirmación por defecto hasta definir su política.

`catalog.requiresConfirmation` es la lista de reglas compartida. El motor conserva validación, planes inmutables y capacidades de un solo uso: `autoApproval` solo emite capacidades para planes verificados que no requieren confirmación. Ni texto del modelo ni argumentos `approved` pueden habilitar envíos. Las capacidades de backend de Gmail/Calendar/WhatsApp mantienen sus verificaciones de usuario, cuenta y argumentos.

El runtime respeta el orden: aplica operaciones rutinarias hasta encontrar una acción que exige revisión; el resto del lote espera. Cancelar ese lote no revierte cambios rutinarios ya realizados, pero evita las acciones pendientes. Ante destinatarios o registros ambiguos se sigue preguntando cuál corresponde; no se supone una elección.
