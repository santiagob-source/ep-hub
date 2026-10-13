# Google Calendar de La Kitty

La Kitty puede consultar los calendarios seleccionados de tu cuenta de Google y crear reuniones en calendarios donde tengas permiso de escritura. El calendario interno del Hub y Google Calendar son fuentes distintas: una consulta fallida o sin conexión no significa que no tengas reuniones.

## Activar

1. En el proyecto de Google Cloud que ya usa Gmail, habilitar **Google Calendar API**: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com.
2. En Google Auth Platform → Data Access, añadir `https://www.googleapis.com/auth/calendar.calendarlist.readonly` y `https://www.googleapis.com/auth/calendar.events`. Si la aplicación está en pruebas, la cuenta debe figurar entre los usuarios de prueba.
3. No hacen falta nuevas variables de Vercel ni otra URL de redirección: se reutilizan el cliente OAuth, el cifrado y `https://expansion-people-recruiter.vercel.app/api/gmail`.
4. Dentro de La Kitty, pulsar **Conectar Calendar**, elegir la cuenta y conceder los permisos de Gmail y Calendar. Se pide consentimiento nuevo incluso si Gmail ya está conectado. Reconectar Gmail después conserva los permisos de Calendar.
5. Preguntar «¿Qué reuniones tengo hoy?». Para crear: «Creá una reunión mañana a las 10, de 30 minutos, titulada Seguimiento». Se muestra calendario, horario de España e invitados antes de confirmar. Si hay invitados, confirmar envía invitaciones; Google Meet se añade solo cuando se pide.

## Límites y protección

- Sesión personal cifrada y vinculada al usuario Firebase, con cookie HTTPS HttpOnly y vencimiento de 30 días. Los tokens no se guardan en Firestore ni se envían al modelo. Google puede revocar o limitar antes las autorizaciones de aplicaciones en pruebas.
- Lecturas no modifican eventos. Las consultas por defecto usan el día actual en Europe/Madrid, incluidos cambios de hora; se expanden eventos recurrentes, se incluyen eventos de día completo y se excluyen cancelados. Se consultan hasta diez calendarios seleccionados, y se informa si faltan calendarios o páginas.
- Creación protegida por la confirmación del usuario, capacidad cifrada de cinco minutos y vinculación a cuenta, calendario y argumentos. Los permisos de escritura se verifican nuevamente al ejecutar. Un ID de evento estable por confirmación evita duplicados al repetir esa solicitud. No se reintentan escrituras automáticamente ante errores inciertos.
- Esta fase no modifica ni elimina reuniones existentes, no añade recurrencia ni carga las reuniones en el calendario visual compartido del Hub. La Kitty consulta Google directamente cuando se le pregunta.
- Las pruebas simulan Google y no crean eventos ni envían invitaciones reales. Publicar el código no equivale a haber autorizado una cuenta ni a haber habilitado Calendar API.
