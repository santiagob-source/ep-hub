# WhatsApp programado de Kitty

Implementación para respond.io Developer API v2. Reutiliza la búsqueda de candidatos, sus fichas y el motor de confirmaciones del Hub. Las rutas y tipos se contrastaron con el [SDK oficial de respond.io](https://github.com/respond-io/typescript-sdk). No cambia el WhatsApp del móvil ni el canal conectado con coexistencia.

## Qué permite

- Comprobar el canal y si hay un ejecutor activo.
- Consultar plantillas aprobadas con su nombre e idioma reales.
- Programar a un candidato existente entre un minuto y 30 días en el futuro.
- Ver destinatario, número, texto final y fecha de Madrid antes de confirmar, con una casilla explícita de consentimiento del destinatario.
- Consultar los últimos 100 envíos propios (30 días de historial) y cancelar los pendientes, con confirmación.
- Revalidar la ventana de 24 horas o la plantilla antes de enviar. Si la condición cambió, falla sin sustituir el texto.

La API y la cola necesitan activarse antes de probar un envío real. Los tests usan Google, Firestore y respond.io simulados: no envían mensajes a personas.

## Variables de Vercel (Production)

| Nombre | Valor |
|---|---|
| `RESPOND_IO_API_TOKEN` | Token privado de Developer API del workspace conectado. |
| `RESPOND_IO_WHATSAPP_CHANNEL_ID` | ID del canal respond.io (actualmente `565351`), no el ID del teléfono de Meta. |
| `RESPOND_IO_ALLOWED_UIDS` | UID de Firebase de los usuarios autorizados, separados por comas. |
| `FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON` | JSON completo de una cuenta de servicio exclusiva del proyecto `ep-hub-7c4b9`, con acceso a la base privada. |
| `CRON_SECRET` | Secreto aleatorio, al menos 32 caracteres. Generar con `openssl rand -hex 32` y copiar directamente a Vercel y al cron. |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | La clave de cifrado ya configurada. También cifra las autorizaciones y datos de esta integración; mantenerla estable. |

Mantener `OPENAI_API_KEY` como está. No poner tokens en el navegador, estado compartido, Git, URLs de cron, capturas ni chat. Después de añadir/cambiar variables, hacer Redeploy.

## 1. Autorizar usuario y probar lectura

Iniciar sesión en el Hub y pulsar **WhatsApp** en Kitty. Si todavía no está autorizado, el mensaje muestra el UID de esa sesión: es un identificador, no un token. Copiarlo en `RESPOND_IO_ALLOWED_UIDS`, guardar y redeployar.

Volver a pulsar **WhatsApp**. Esta acción solo lee los canales de respond.io; verifica que el token tenga acceso al canal `565351`. Debe informar «WhatsApp está conectado», aunque aún falte activar la programación. Si falla, revisar Developer API/plan/token sin probar envíos.

## 2. Cola privada

Crear **una base de Firestore nueva** de tipo Native llamada exactamente `kitty-private`, dentro de `ep-hub-7c4b9`. Puede hacerse desde Google Cloud → Firestore → Databases → Create database. Elegir una región europea adecuada. No editar, sustituir ni migrar la base `(default)` del Hub. Una base adicional puede requerir facturación y genera costes de Firestore por uso; comprobarlo en el proyecto antes de crearla.

En **kitty-private**, mantener reglas de producción que denieguen todas las lecturas/escrituras de clientes. El contenido está en [whatsapp/firestore-private.rules](whatsapp/firestore-private.rules). No aplicar esas reglas a la base del Hub.

Crear una cuenta de servicio dedicada, por ejemplo `kitty-whatsapp`, en IAM del mismo proyecto. Darle acceso de datos a **kitty-private**, con el rol **Cloud Datastore User** (`roles/datastore.user`), restringiendo el alcance a esa base mediante IAM/condición de recurso. No necesita Firebase Admin, Owner ni Editor. Una condición de recurso para la base es:

```
resource.name == "projects/ep-hub-7c4b9/databases/kitty-private"
```

Si la organización no permite claves de servicio o no permite ese alcance, detener la configuración y escoger otra forma de identidad de servidor; no ampliar permisos al estado del Hub como atajo.

Crear una clave JSON de esa cuenta, descargarla y copiar su contenido completo directamente en `FIREBASE_WHATSAPP_SERVICE_ACCOUNT_JSON` en Vercel. Guardar/eliminar el archivo local según la política de la empresa. Nunca enviarlo por chat ni guardarlo en el repositorio.

En **kitty-private → Indexes**, crear los tres índices de [whatsapp/firestore-private.indexes.json](whatsapp/firestore-private.indexes.json), colección `whatsapp_jobs`, alcance Collection. Esperar a que estén disponibles. Todos corresponden a la base privada.

## 3. Ejecutor por minuto, sin exigir Vercel Pro

No se incluye un cron de Vercel en `vercel.json`: Hobby no permite frecuencia por minuto y podría bloquear el despliegue del Hub.

Usar un servicio externo de cron HTTPS, por ejemplo [cron-job.org](https://cron-job.org/), con estas opciones:

- URL: `https://expansion-people-recruiter.vercel.app/api/whatsapp-worker`
- Método: GET o POST.
- Frecuencia: cada minuto.
- Header privado: `Authorization: Bearer <valor de CRON_SECRET>`.
- No añadir el secreto a la URL. El proveedor de cron custodiará ese secreto; quien lo posea puede disparar los envíos ya confirmados, por lo que no debe compartirse.
- Ejecutar una prueba manual: debe devolver HTTP 200 JSON. Si devuelve 503, revisar base/cuenta/índices; 401 indica un secreto incorrecto.

El ejecutor registra actividad solo después de validar que puede leer los trabajos vencidos. Kitty exige una ejecución reciente (menos de tres minutos) antes de preparar y confirmar una programación. No se activa mediante una bandera que pueda afirmar disponibilidad sin comprobarla. Vigilar también la disponibilidad del servicio de cron.

Para usar Vercel Cron en Pro más adelante, la misma ruta y `CRON_SECRET` sirven; basta configurar su cron con la frecuencia elegida. No hace falta rehacer el agente ni comprar Pro para este diseño.

## 4. Primera prueba real

1. Comprobar que Kitty informe conexión y ejecutor activos.
2. Consultar plantillas aprobadas. Esta fase admite cuerpo y pie de texto, sin botones, cabeceras, multimedia ni parámetros con nombres: usa parámetros numéricos como `{{1}}`.
3. Preparar un envío a un destinatario de prueba que haya dado consentimiento, con teléfono internacional en su ficha. Antes del envío, revisar y confirmar explícitamente. La implementación no autoriza enviar a terceros como parte de las pruebas técnicas.
4. Pedir «Mostrame mis WhatsApps programados» y comprobar el estado. Probar una cancelación de otro envío futuro confirmado para la prueba.

Para texto libre, la hora debe caer dentro de las 24 horas posteriores al último mensaje entrante del destinatario en ese canal. Se consulta `lastIncomingMessageTime`, no una fecha inventada ni el último mensaje saliente. Fuera de esa ventana, hay que elegir una plantilla aprobada y consentida. El saldo y los requisitos de Meta/plan de respond.io son independientes de OpenAI.

## Estados y límites operativos

- `pending`: guardado, pendiente; puede cancelarse.
- `sending`: el ejecutor ganó la reserva atómica e inició la operación; no puede cancelarse.
- `accepted`: respond.io devolvió `messageId`; aún no acredita entrega.
- `sent`, `delivered`, `read`, `failed`: confirmados consultando respond.io.
- `unknown`: se perdió la respuesta, el proceso se interrumpió o no pudo guardar el resultado tras enviar. No se reintenta automáticamente, porque podría duplicar el mensaje. Comprobar respond.io antes de programar otro.
- `cancelled`, `expired`: no se envían. Si pasan más de diez minutos desde la hora prevista, vence sin envío.

Cada ejecución procesa **un envío** y consulta el estado de uno enviado. Capacidad inicial: aproximadamente un envío por minuto si el cron ejecuta con esa frecuencia; varios pedidos a la misma hora se procesan sucesivamente. Esto no garantiza el segundo exacto ni la entrega: depende del cron, Firestore, respond.io, Meta y el destinatario. El reloj siempre guarda el instante UTC y muestra `Europe/Madrid`, incluidos los cambios de horario.

Las reservas usan precondiciones `updateTime` de Firestore. Dos cron concurrentes no pueden reservar el mismo trabajo; cancelar compite con la misma precondición. La creación usa un ID inmutable incluido en la autorización, por lo que repetir esa confirmación no crea otro trabajo. No se hacen reintentos automáticos de POST a respond.io. Se prioriza evitar envíos duplicados ante respuestas ambiguas.

Los datos del destinatario y texto quedan cifrados en una cola independiente; el worker envía los datos aprobados en ese momento, no vuelve a buscar un candidato parecido. Editar o eliminar una ficha del Hub no cancela programaciones existentes: pedir la cancelación explícitamente. Cambiar canal, plantilla o clave de cifrado puede invalidar trabajos pendientes. Quitar al usuario de `RESPOND_IO_ALLOWED_UIDS` impide sus envíos pendientes. No almacenar ni restaurar esta cola dentro de exportaciones del Hub.

## Arquitectura

- `public/agent/whatsapp.js`: adaptadores del catálogo, resolución por ID a través de las funciones existentes del Hub y Firebase ID token.
- `api/whatsapp.js`: autentica, autoriza UIDs y emite capacidades cifradas de revisión.
- `lib/whatsapp/provider.js`: cliente nativo de respond.io v2, plantillas y verificación de ventana. Puede sustituirse por otro proveedor manteniendo la interfaz.
- `lib/whatsapp/store.js`: Firestore REST privado con identidad de servicio, sin dependencias del estado Firebase del navegador.
- `lib/whatsapp/service.js`: programación, cancelación, estados, idempotencia y ejecución.
- `api/whatsapp-worker.js`: entrada protegida del cron, siempre JSON en errores.
- `lib/whatsapp/deadline.js`: presupuesto global de solicitudes para abortar antes del límite de Vercel; si la respuesta de un POST es incierta, se conserva la reserva y no se repite el envío.

Sin estos requisitos, el Hub, Gmail y los enlaces manuales `prepare_whatsapp` continúan funcionando; la programación permanece bloqueada con una explicación del requisito faltante.
