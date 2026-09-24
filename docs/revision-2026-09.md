# Revisión y validación local — septiembre de 2026

Seguimiento de los arreglos y actualización: [validación Linux](validacion-linux-2026-09.md).
Este documento conserva la evidencia de la revisión anterior.

Estado: trabajo en curso. No se autoriza publicar releases. Los cambios todavía
no se han enviado a GitHub ni convertido en commits.

La [revisión cruzada posterior](revision-cruzada-2026-09.md) contrasta los nueve
hallazgos originales y registra regresiones/huecos aún abiertos. Los resultados
aprobados de este documento no equivalen a cerrar esos casos adicionales.

## Decisiones acordadas

- Windows 10 y Windows 11, x64, portable; instaladores diferidos.
- Validar localmente antes de commit, push o publicación.
- Conservar ACE/CBA si es posible; mantener el decoder como proceso separado.
- Abrir carpetas de imágenes reales, incluido su contenido en subcarpetas.
- Si un archivo ya está abierto, enfocar su ventana existente.
- Mantener las extensiones DjVu y delegar la apertura a MuPDF. Eso no demuestra
  soporte del decoder: falta una muestra y las versiones inspeccionadas de
  MuPDF no registran un lector DjVu.
- Pruebas manuales de un formato a la vez, revisando los logs entre aperturas.
- Conservar la virtualización de miniaturas, el límite de caché de libvips y
  el umbral de 320 MB para frenar el trabajo de fondo.

## Cambios que se están validando

- Preservar la base SQLite ante corrupción o bloqueo, sin borrarla al fallar.
- Separar sesiones y temporales del worker; descartar eventos y respuestas
  asíncronas de aperturas que ya fueron reemplazadas.
- Enfocar la ventana propietaria de un archivo y cerrar únicamente su worker.
- Leer carpetas con orden natural y continuar ante páginas dañadas.
- Hacer fallar las pruebas cuando falta un binario requerido.
- Actualizar dependencias JavaScript y el SDK 7-Zip 26.03; compilar los lectores
  Windows con MSYS2 UCRT64 y conservar el entorno Linux Ubuntu 22.04 del bundle.
- Probar la aplicación empaquetada, además de los workers y pruebas unitarias.

## Regresiones de interfaz detectadas manualmente

1. **Scroll después de la última miniatura.** Las filas vacías del conjunto
   virtual extendían el área desplazable. La prueba con cinco páginas llegó a
   medir 5.125 píxeles de contenido. Se eliminan las filas sin página, se limita
   el inicio del conjunto visible y se recorta el contenido al alto real.
2. **Arrastrar la barra arriba y usar la rueda provoca un salto.** El evento de
   rueda subía al visor, cambiaba la página y volvía a centrar las miniaturas.
   El panel detiene la propagación sin impedir su desplazamiento nativo.

3. **Miniaturas detenidas en un CBZ grande.** Las operaciones JPEG progresivas
   retenían memoria del decodificador que no contabiliza el límite de libvips.
   Al superar 320 MB, la cola de fondo esperaba sin liberar esa caché. Ahora se
   desalojan las operaciones al detectar presión, se restaura su límite normal
   y se vuelve a medir antes de pausar. Se evita `vips_cache_drop_all()`, que
   destruye la tabla y ya había causado errores GLib en pruebas anteriores.
   Una prueba sintética con seis páginas de 25 MP falló antes y pasa después.

Los dos problemas de scroll se reprodujeron con una prueba de interfaz que falló antes de
la corrección y pasó después. La confirmación manual completa sigue pendiente.

## Arrastrar archivos y primera imagen

La captura temporal de eventos mostró `dragenter` y `dragover`, sin `drop`.
Desactivar la captura del ratón de la capa invisible permitió continuar las
pruebas manuales. La capa ahora usa `pointer-events: none` y los eventos se
atienden solo en la ventana, sin duplicar los manejadores del overlay.
La prueba empaquetada cubre soltar un archivo, reemplazarlo y reabrir tras cerrar.

La primera imagen podía faltar si su evento `ready` llegaba después de agotar
el sondeo de aproximadamente cuatro segundos: la rama de página actual evitaba
inicializar la caché de vista previa. También podía llegar una consulta pendiente
de una sesión anterior al reabrir el mismo archivo. Ambas condiciones se
reprodujeron con pruebas que fallaron antes de corregirlas y pasan después.
No se puede atribuir con certeza el incidente manual a una de ellas. Las últimas
dos aperturas manuales generaron la primera imagen antes de acabar la extracción;
el usuario confirmó drag-and-drop en la nueva versión y sometió el primer CBZ
a navegación intensa antes de abrir el segundo.

## Memoria en la prueba manual de estrés

Medición posterior a las correcciones de vista previa y drag-and-drop:

- Primer CBZ (188 páginas): 108 páginas procesadas para lectura y todas las
  miniaturas disponibles. Pico RSS del worker: 635,9 MiB; al terminar por cambio
  de archivo: 71,1 MiB. Seis liberaciones por presión; una bajó de 588,2 a 53,4
  MiB. El worker anterior terminó, sin quedar otro lector nativo activo.
- Segundo CBZ (185 páginas), solo apertura: las 185 miniaturas terminaron. Pico
  RSS del worker: 184,4 MiB; en reposo: 26,8 MiB RSS y 22,9 MiB PSS.
- Todos los procesos de Comiscopio: 356,4–357,8 MiB PSS en tres muestras durante
  20 segundos, más 2,1 MiB en swap proporcional. PSS reparte la memoria compartida
  para evitar duplicarla; no es la suma de los picos históricos de cada proceso.
- Cero errores registrados y cero pausas de fondo en esas dos sesiones.

No se observa retención creciente en esta pasada. La observación breve no
descarta todas las fugas ni representa el pico simultáneo de toda la aplicación.

## Evidencia disponible

- 93 pruebas unitarias aprobadas.
- Tres pruebas de SQLite real, ejecutadas con la ABI de Electron.
- Diez pruebas de workers del bundle Linux, incluida una muestra CBA real,
  nombres Unicode, carpetas, páginas dañadas y JPEG progresivos grandes.
- Prueba de aplicación empaquetada Linux: siete formatos, progreso, reutilización
  de ventana y las dos regresiones de miniaturas.
- CBR manual de 113 páginas: extracción completa sin errores del worker;
  la interacción de miniaturas requirió las correcciones anteriores.
- CBZ real de 188 páginas: genera las 188 miniaturas y permite abrir la última
  sin errores; cero pausas de fondo. En la prueba corregida, liberar la caché
  redujo el RSS de 468 MB a 38 MB; el máximo del proceso fue 490 MB. El umbral
  de 320 MB regula el trabajo entre páginas, no limita el pico al decodificar.
- Windows 11: Node, MSYS2, Python y Visual Studio Build Tools instalados;
  `npm ci` y la compilación del módulo SQLite completaron correctamente.
  Los lectores de archivos/documentos compilan y sus dos pruebas CTest pasan.
  El auxiliar ACE y el bundle completo compilaron; falta validar su ejecución.
- Windows 10: VM preparada; falta probar la aplicación.

Los resultados no equivalen a una aprobación de publicación. Aún faltan la
validación manual restante, la compilación y pruebas completas de Windows,
la revisión final de documentación y los cambios de descripción/etiquetas en
GitHub. No se ha ejecutado el nuevo workflow en GitHub.

Los logs y capturas locales se guardan en `test-results/`, excluido de Git.
No se deben subir logs con rutas o nombres de archivos personales.
