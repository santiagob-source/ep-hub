# Expansion People Hub

Aplicación HTML con Firebase y un Agente EP operativo. Vercel publica `api/agent.js` como `/api/agent`. La variable de producción sigue siendo **`OPENAI_API_KEY`**; `AGENT_MODEL` es opcional (`gpt-5.4-mini` por defecto).

El directorio raíz del proyecto en Vercel debe ser la raíz de este repositorio. `vercel.json` establece la salida estática en `.` para servir las páginas y `/public/agent/*.js`, además de la función Node. Tras desplegar, GET `/api/agent` debe devolver 405 con JSON. POST con `{"message":"Hola"}` devuelve `response_id`, `text` y `calls`. Los errores controlados de la función devuelven JSON; el frontend también reconoce respuestas HTML de la plataforma y explica el error de despliegue. OpenAI tiene un límite de 20 segundos, dentro de los 30 segundos de la función.

## Acciones disponibles

El agente usa lenguaje natural y conserva el contexto entre pedidos. Consulta la base antes de identificar registros; devuelve varias coincidencias para que el usuario pueda desambiguar. Las ediciones usan IDs exactos y solo los campos solicitados.

| Área                              | Operaciones                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Candidatos, clientes y jobs       | Buscar, consultar, crear, editar, eliminar; mantener relaciones y calcular fee           |
| Pipeline                          | Vincular, desvincular, cambiar etapa y etiqueta                                          |
| Tareas y calendario               | Crear, editar, completar, eliminar; sincronizar eventos asociados a tareas               |
| Notas                             | Notas generales y notas de llamadas de candidatos: crear, editar y eliminar              |
| Rutina y comercial                | Consultar, crear, editar, mover horarios o estados y eliminar                            |
| Forecast y facturación            | CRUD, asignar/quitar meses de job, facturar y revertir con la lógica existente del Hub   |
| Propuestas de clientes            | Consultar, crear, editar, eliminar, firmar, renovar, visualizar y descargar              |
| Objetivos y proyectos de informes | CRUD y generación de informes existente                                                  |
| Fichaje                           | Entrada, salida y CRUD de registros manuales                                             |
| Pomodoro                          | CRUD de actividades, selección, inicio, pausa y reinicio                                 |
| Dashboard y navegación            | Resumen, secciones y detalles, mostrar/ocultar/reordenar widgets                         |
| Archivos y backups                | Descargar/quitar archivos, abrir selectores existentes, exportar y abrir importador      |
| Contacto y sourcing               | Booleanos, enlaces de WhatsApp y borradores de email/Job Description; no enviar mensajes |

Las lecturas se ejecutan directamente. Toda escritura, eliminación, importación o selección de archivo requiere confirmación. La propuesta muestra argumentos, datos actuales y efectos relacionados. Cancelar devuelve resultados de cancelación al modelo. Los botones antiguos no pueden aprobar nuevos pedidos ni repetir acciones. Si cambia el estado mientras se revisa una propuesta, se muestra una revisión nueva antes de permitir la ejecución.

Los archivos necesitan selección manual: el agente distingue abrir un selector de completar una subida/importación. Los documentos de propuestas reutilizan `prop_generateHTML`; los informes reutilizan el generador actual, sin atribuirle capacidades nuevas de IA.

## Arquitectura

- `public/agent/catalog.js`: fuente compartida de esquemas, entidades, campos editables y políticas de lectura/escritura. `describe_actions` comunica estos campos al modelo.
- `public/agent/hub-actions.js`: operaciones de dominio compartidas por formularios y herramientas. Conserva guardado/Firebase, recordatorios, calendario de tareas, relaciones, pipeline y propuestas. El estado se obtiene mediante un getter para seguir funcionando cuando Firebase o el importador lo reemplazan.
- `public/agent/engine.js`: registro de ejecutores y adaptadores a las funciones existentes del Hub, validación de argumentos, IDs, vista previa y permisos de confirmación de un solo uso. Rechaza herramientas desconocidas y planes alterados.
- `public/agent/runtime.js`: conversación, ejecución secuencial, confirmación/cancelación y transporte JSON. No decide qué campos ni funciones pueden ejecutarse.
- `index.html`: UI del Hub, Firebase y enlace de esos módulos con las funciones existentes.
- `lib/agent/tools.js`: exporta el catálogo compartido al servidor.
- `lib/agent/service.js` y `prompt.js`: OpenAI Responses e instrucciones, incluyendo continuaciones de herramientas y nuevos mensajes de conversación.
- `api/agent.js`: contrato HTTP y errores JSON. `agent.js` conserva el punto de entrada de runners locales anteriores.

Las operaciones de dominio se guardan con `saveState`, por lo que siguen usando la sincronización de Firebase. Renombrar actualiza relaciones activas; eliminar una tarea quita su evento asociado, eliminar un job quita sus forecasts y vínculos, y eliminar un candidato quita sus entradas de pipeline. La facturación histórica se conserva. Los vínculos nuevos de pipeline incluyen `candidateId`; los vínculos antiguos ambiguos por nombre requieren revisión en el Hub.

## Añadir Gmail, WhatsApp u otras integraciones

Añadir la definición al catálogo, con su esquema y efecto explícito, y el adaptador al registro del motor. `EPAgentEngine.create` admite `adapters` por nombre, y `register(definition, adapter)` permite incorporar módulos adicionales. Cada adaptador expone `check(args)` y `execute(args)`; el runtime conserva la misma confirmación y presentación de resultados.

Las integraciones que necesiten secretos deben llamar a endpoints propios del servidor; las credenciales nunca van al navegador. Antes de implementar envíos externos, esos endpoints deben autenticar al usuario y validar la autorización para la acción revisada. Un esquema nuevo debe publicarse también en el catálogo del servidor. Hoy no se han implementado envíos de Gmail ni WhatsApp Business.

## Pruebas

```sh
node --test tests/*.test.cjs
node tests/browser.cjs
```

Las pruebas de Node no requieren dependencias adicionales. Las de navegador requieren Playwright y Chromium (disponibles en el entorno de desarrollo usado). Usan respuestas simuladas de OpenAI, almacenamiento local de prueba y Firebase bloqueado; no necesitan credenciales ni escriben en Firebase de producción. Cubren CRUD por entidad, campos preservados, relaciones, confirmación, cancelación, revisiones obsoletas, JSON/HTML, facturación/reversión, propuestas, formularios y todas las vistas del Hub.

La autenticación y sincronización con Firebase real y la llamada a OpenAI con la clave de producción se validan después del despliegue con una cuenta de prueba autorizada.
