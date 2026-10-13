# Adjuntos de La Kitty

El usuario puede seleccionar hasta cinco archivos desde Adjuntar, juntos o uno tras otro, y quitar cada uno antes de enviar. Se aceptan PDF, Word (.docx), TXT UTF-8, PNG y JPG: hasta 2 MB por archivo y 3 MB entre todos. El límite combinado mantiene la petición JSON bajo el máximo del servicio de alojamiento.

Cada mensaje incluye el contenido de todos los archivos seleccionados, además de sus nombres. Los PDF e imágenes se envían como entradas nativas del modelo. Para Word se extrae el texto de documento, encabezados, pies y notas, sin extraer archivos a disco ni ejecutar contenido; se limitan tamaño descomprimido y longitud. TXT se valida como UTF-8. Word no incluye sus imágenes incrustadas en el texto extraído; para comparaciones que dependan de gráficos, usar PDF.

Analizar, resumir y comparar propuestas no modifica fichas. Guardar un documento sigue requiriendo revisión de archivo, cliente y job y confirmación; guardar uno conserva los otros adjuntos seleccionados. Los IDs de cada archivo vinculan la revisión al archivo exacto, y quitarlo invalida su acción pendiente.

Los documentos son contenido no confiable, no instrucciones. Los formatos no admitidos se rechazan con una explicación. PDFs cifrados, archivos dañados o páginas ilegibles pueden impedir la lectura: el asistente debe explicarlo, nunca inventar datos. Los tests usan documentos ficticios y no envían datos de candidatos reales.
