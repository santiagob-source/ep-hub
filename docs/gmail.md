# Gmail del Kitty

Cada usuario conecta su propia cuenta desde **Conectar Gmail** en el panel del agente. La sesión se valida con Firebase; el token de actualización de Google se cifra en el servidor y se guarda en una cookie HTTPS HttpOnly vinculada al UID del usuario. No se guarda en el estado compartido de Firestore, localStorage ni en conversaciones con OpenAI. La conexión dura hasta 30 días en ese navegador; Google puede revocarla antes. Al cambiar de usuario del Hub, el buzón anterior no queda accesible al nuevo usuario.

## Activación en producción

1. En Google Cloud Console, crear o elegir un proyecto y habilitar **Gmail API**.
2. Configurar Google Auth Platform: nombre de la aplicación, audiencia y permisos `https://www.googleapis.com/auth/gmail.readonly` y `https://www.googleapis.com/auth/gmail.compose`. En modo de pruebas, añadir las cuentas que van a conectar Gmail como usuarios de prueba. Google suele limitar a siete días los refresh tokens de aplicaciones externas en pruebas; para uso general puede requerir publicar y verificar la aplicación.
3. Crear un cliente OAuth de tipo **Aplicación web**, con origen autorizado `https://expansion-people-recruiter.vercel.app` y URI de redirección exacta `https://expansion-people-recruiter.vercel.app/api/gmail`.
4. En Vercel → proyecto → Settings → Environment Variables, añadir a Production:
   - `GOOGLE_CLIENT_ID`: ID del cliente OAuth.
   - `GOOGLE_CLIENT_SECRET`: secreto del cliente OAuth.
   - `GMAIL_TOKEN_ENCRYPTION_KEY`: 32 bytes aleatorios en hexadecimal (64 caracteres). Generar localmente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y cargar directamente en Vercel. No compartir estos valores por chat ni subirlos al repositorio.
5. Hacer Redeploy para que Vercel aplique las variables. Mantener `OPENAI_API_KEY` con su nombre actual.
6. Iniciar sesión en el Hub, abrir Kitty, pulsar **Conectar Gmail**, elegir cuenta y conceder los permisos solicitados. La autorización vuelve a la app.
7. Probar primero: «Buscá mis últimos cinco correos». Luego «Leé el primero». Para probar borradores: «Prepará un borrador para [email] con asunto [asunto] y texto [texto]», revisar y confirmar. Para enviar hace falta un pedido explícito y otra confirmación mostrando destinatarios, asunto y contenido real del borrador. No se envían mensajes como parte de las pruebas automatizadas.

**Desconectar** elimina el acceso desde ese navegador. Para revocar completamente el permiso de Google, quitar la app en la configuración de seguridad de la cuenta de Google. Cambiar la clave de cifrado invalida las conexiones existentes.

## Implementación y límites de esta fase

- `lib/gmail`: autenticación Firebase, sesiones cifradas y servicio Gmail independiente del Hub.
- `api/gmail.js`: OAuth con PKCE y estado con vencimiento, JSON en errores, verificación de identidad y capacidades de revisión vinculadas al usuario, cuenta, argumentos y contenido del borrador.
- `public/agent/gmail.js`: adaptadores modulares; usa el mismo motor de confirmaciones que el Hub.
- Lecturas no cambian etiquetas ni marcan correos como leídos. Crear borradores y enviar requieren confirmación. Se envían únicamente borradores existentes: Gmail consume el borrador al enviar, por lo que un segundo intento no genera un correo nuevo. No se reintentan envíos automáticamente.
- El envío vuelve a leer el borrador y rechaza cambios posteriores a la revisión. Los correos son datos no confiables para el modelo, nunca instrucciones. Las revisiones muestran también CC, BCC y los adjuntos existentes. Un cambio concurrente en Gmail entre la comprobación y el envío no puede bloquearse con una transacción en Gmail; revisar mientras se confirma evita esa ventana habitual.
- Esta fase no añade descarga/subida de adjuntos, modificación de etiquetas ni conexión permanente para trabajos en segundo plano. Los cuerpos consultados se limitan a 30.000 caracteres; los correos HTML muestran su fuente en la revisión. Crear borradores admite destinatarios To, asunto y texto simple.
- Las pruebas simulan Google y no acceden ni escriben en buzones reales. La activación requiere las credenciales del proyecto Google y el consentimiento del titular; un despliegue correcto no acredita una conexión real de Gmail.
