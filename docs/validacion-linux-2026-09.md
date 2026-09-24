# Actualización y validación Linux — septiembre de 2026

Estado: validación automática y ronda manual Linux completadas el 23 de septiembre,
con los alcances y salvedades registrados abajo. La comprobación final de los
paquetes 0.3.0 figura en su sección específica; el resto conserva la evidencia
de las rondas anteriores. El estado entre plataformas está en la
[revisión final](revision-final-0.3.0.md).
La [revisión de sobreingeniería](revision-sobreingenieria-2026-09.md) deja mejoras
menores diferidas por decisión del usuario. No se hicieron commits, push,
tags ni publicaciones. Las rondas manuales iniciales usaron la versión `0.2.0`.

## Correcciones de la revisión cruzada

Corrección posterior encontrada durante Windows: cerrar la última ventana podía
dejar temporales porque Electron salía antes de terminar el cierre del worker y
el borrado asíncrono. Se añadió espera al salir y una regresión de interfaz que
exige ausencia del directorio al terminar la aplicación. La comprobación Linux
del directorio empaquetado reconstruido pasó: 105 pruebas unitarias y las dos
pruebas de interfaz, incluida esa regresión. Este resultado no corresponde a
un AppImage/tar.gz nuevo; los artefactos anteriores conservan el código previo.
Diagnósticos de interfaz: `test-results/shutdown-linux/`. Véase también la
[validación Windows](validacion-windows-2026-09.md).

- **R1, cancelación ACE:** en POSIX el bridge envía SIGTERM además de `quit`.
  El backend termina el grupo del helper, escala tras 200 ms y recoge el proceso
  antes de salir. La prueba cancela durante extracción con un helper que ignora
  SIGTERM y comprueba que no sigue vivo. Windows conserva stdin y Job Object,
  pendiente de validación específica allí.
- **R2, aperturas pendientes:** el visor termina de adoptar o descartar una
  respuesta antes de iniciar la siguiente petición IPC. Las pruebas cubren dos
  peticiones del mismo archivo, alias de ruta y cancelación mientras hay una
  respuesta pendiente. Las peticiones reemplazadas antes de comenzar no se abren.
- **H1, miniaturas dañadas:** ambos workers comprueban el resultado de escritura;
  producen un placeholder si falla la miniatura y solo anuncian disponibilidad
  tras escribirla. Se prueba con un JPEG dañado de fondo y un documento XPS cuya
  segunda página está ausente. Pedir luego la página completa sigue funcionando.
- **H2, dependencias:** se exigen los cuatro ejecutables; un fallo de `ldd`, salida
  vacía o información no clasificable hace fallar la comprobación. Cinco pruebas
  cubren directorio vacío, ejecutable inválido, error, salida desconocida y éxito.
  El build portable ejecuta esta comprobación antes de terminar.

## Versiones verificadas

| Componente | Versión |
|---|---|
| Node / npm | 24.18.1 / 11.16.0 |
| Angular / CLI-builder | 22.1.7 / 22.1.8 |
| TypeScript | 6.0.3 |
| Electron / electron-builder | 44.4.4 / 26.15.3 |
| better-sqlite3 | 13.0.3 |
| Vitest / jsdom | 4.1.11 / 30.1.1 |
| libvips | 8.18.6 |
| libarchive | 3.8.9 |
| MuPDF | 1.28.4 |
| UnRAR | 7.2.7 |
| SDK 7-Zip | 26.03 |
| nlohmann/json | 3.12.0 |

Angular se migró mediante el CLI oficial, conservando el comportamiento de
actualización de los componentes con `ChangeDetectionStrategy.Eager`. Electron
usa resolución de módulos Node16 en TypeScript; no se silencia la obsolescencia
de `node10`. Se mantienen los diagnósticos estrictos de plantillas.

TypeScript 6 es el rango aceptado por Angular 22.1; TypeScript 7 no lo es.
Vitest 4 es la dependencia opcional admitida por `@angular/build`; no se fuerza
Vitest 5 mediante excepciones de peers. `npm ci` pasó sin esas excepciones,
recompilando SQLite para Electron; npm reportó cero vulnerabilidades conocidas.

Las bibliotecas lectoras Linux se compilan desde archivos fijados por SHA-256,
sobre Ubuntu 22.04 con digest fijado. Las dependencias transitivas de Ubuntu
reciben sus parches de distribución; no se afirma que todas sean las últimas
versiones mayores upstream. `reader-versions.env`, `package-versions.txt` y
licencias se incluyen en el bundle. El decoder ACE heredado permanece aislado:
no se presenta como una actualización a un decoder moderno inexistente en esta
implementación. El build local con dependencias del sistema sigue siendo una
alternativa de desarrollo y puede tener otras versiones; esta validación usa
exclusivamente el bundle portable reconstruido.

## Problemas adicionales detectados y corregidos al actualizar

1. **TIFF pequeño:** se copiaba sin recodificar aunque Chromium no puede mostrarlo.
   Ahora también se convierte a JPEG/WebP cuando mide menos del límite de tamaño.
   La prueba nativa falló antes; la prueba visual reforzada también falló en el
   paquete anterior. La interfaz verifica URL de la página, imagen actual y
   decodificación; no acepta la imagen anterior con el texto de página nuevo.
2. **Codecs de MuPDF:** los símbolos de sus codecs estáticos interferían con las
   bibliotecas compartidas usadas por libvips. PDF/EPUB/XPS fallaron al guardar
   imágenes. Se ocultan esos símbolos al enlazar; los tres formatos y el documento
   dañado pasaron después.
3. **Unicode con locale C:** un ZIP con nombres Unicode podía aparecer vacío en
   un Linux mínimo. El lector selecciona C.UTF-8 cuando la configuración es C o
   POSIX. ZIP y TAR tienen regresiones específicas; la matriz de tres contenedores
   pasó tras el arreglo. El fallo previo se reprodujo en ZIP, no en TAR.
4. **Matriz de distribuciones:** acepta directamente la ruta del bundle, respeta
   la carpeta de fixtures indicada y falla si no llegó a probar ninguna imagen.

## Evidencia automática

- Compilación de producción Angular y TypeScript/Electron: aprobada.
- Vitest: 102 pruebas aprobadas.
- SQLite real, con la ABI de Electron: 3 pruebas aprobadas.
- CTest nativo: 2 pruebas aprobadas dentro del builder.
- Lectores portables: 18 pruebas aprobadas, incluidos ACE real, XPS, siete formatos
  de imagen, Unicode, páginas dañadas, comandos y cancelación durante extracción.
- Suite Bash local: 91 comprobaciones de archivos + 13 de documentos aprobadas.
- Ubuntu 22.04, Ubuntu 24.04 y Debian 13 limpios: suite Bash aprobada en los tres,
  sin SKIP. No equivale a probar un escritorio completo en esas distribuciones.
- Interfaz del directorio empaquetado con Angular 22: aprobada. Incluye todos los
  formatos de imagen de los fixtures, navegación, progreso, drag-and-drop,
  scroll/rueda y reutilización de ventana.
- AppImage y tar.gz finales: aprobados mediante `npm run test:linux-artifacts`.
  El tar se extrae en un directorio temporal y se usa su wrapper. El AppImage se
  arranca mediante su propio runtime con `APPIMAGE_EXTRACT_AND_RUN=1`; el montaje
  FUSE no se probó. Ambos usan perfiles temporales y recorren la suite de interfaz.
- 7z de un único bloque sólido de 480 MiB, 16 BMP sintéticos: extracción,
  miniaturas, navegación y cierre aprobados. En una pasada medida, pico RSS
  712,8 MiB; 129,5 MiB tras completar miniaturas y unos 288 MiB tras renderizar
  la última página, antes del cierre. Muestreo cada 20 ms; no es un techo de RAM.

## Ronda manual del AppImage actualizado

El 23 de septiembre se inició la comprobación de RAR/CBR con
`Frankenstein_New_World_2023_digital_F_Son_of_Ultron_Empire.cbr`
(211.714.166 bytes, 113 páginas). Tras el aviso del usuario se verificaron:

- Extracción de 113 originales y generación de 113 miniaturas; sin errores ni
  advertencias en el segmento de log de esta sesión.
- Preview extraído por el worker en 2.788 ms y procesado en 213 ms; estos tiempos
  no prueban cuándo apareció en pantalla. Extracción posterior en 9.060 ms.
- Visor en página 16 con imagen cargada de 1561 × 2400; 23 elementos de miniatura
  montados en el DOM. Esto comprueba el estado observado, no todas las páginas.
- Worker en reposo: RSS 47,1 MiB y máximo residente 68,1 MiB, leídos de `/proc`.
  No representan un límite de memoria para otros archivos.

El usuario confirmó la maniobra de arrastre de la barra seguida de rueda y que
el problema anterior ya no ocurre al separar el scroll de miniaturas del cambio
de página. La inspección posterior mostró la lista arriba (`scrollTop=0`) y el
visor todavía en página 16, coherente con ese comportamiento. No aparecieron
errores nuevos. Se cierra esta comprobación manual de scroll y apertura CBR;
no se certifica la visualización de la última página: hay 16 páginas del visor
generadas, incluida la primera, pero no la última.
Sesión: `46953497-4421-46ba-8335-4d262e94856b`.
Log: `test-results/manual/config/logs/performance.log`, desde
`2026-09-23T05:09:13.346Z`.

### CBZ grande

Se probó por arrastre `George R.R. Martin - Juego De Tronos 02 [CRG].cbz`
(618.385.167 bytes, 188 páginas). El usuario avisó al terminar la apertura y
navegación solicitadas; no comunicó fallos. Inspección posterior:

- 188 originales y 188 miniaturas, todos no vacíos; 26 páginas del visor generadas.
- Página 94 visible, imagen cargada de 1549 × 2400 y 23 miniaturas montadas en DOM.
- Preview extraído en 1.845 ms y procesado en 697 ms; extracción posterior en
  7.214 ms. Los tiempos son del worker, no una medición visual del primer pintado.
- Sin errores ni advertencias en el log de la apertura y navegación observadas.
  Los eventos `very_slow_page` registran tiempos de procesamiento, no fallos.
- Worker en reposo con RSS 49,2 MiB; máximo residente 444,8 MiB. El descenso
  demuestra liberación de memoria en esta pasada, no ausencia de cualquier fuga.
- El worker CBR anterior terminó y su directorio temporal ya no existe.

Sesión: `1adf9ad4-a9d2-491d-a172-3cabb19abcc1`; log manual desde
`2026-09-23T05:28:21.548Z`. Las primeras líneas posteriores a `session_start`
contienen el cierre del CBR anterior; no se atribuyen sus métricas al CBZ.

### CB7 sólido: observación anterior a la optimización

El usuario abrió `El_Dormilon_Santullo_&_Aon_2016_Bostamr_CRG_cbz_38325c7578f6f67.cb7`
(113.631.849 bytes, 116 imágenes) y reportó que funciona, aunque tardó más de lo
habitual. `7z l -slt` confirma LZMA2:24, `Solid = +`, `Blocks = 1`.

- Extracción de preview: 16.650 ms; procesamiento de esa imagen: 187 ms.
  La extracción completa posterior consumió otros 6.218 ms.
- 116 originales y 116 miniaturas no vacíos; 25 páginas del visor generadas.
  Página 46 visible con imagen cargada de 1618 × 2400.
- Sin errores ni advertencias registrados durante esta apertura/navegación.
- Worker en reposo: RSS 36,0 MiB; máximo residente 145,9 MiB.

El código probado en esa apertura creaba lectores independientes en `extractPreview`
y `open`. El bloque sólido descomprimido por el SDK para el preview se descarta
al salir de esa función y se vuelve a descomprimir para la extracción completa.
Esto confirma trabajo duplicado; no permite atribuir los 16,65 s iniciales ni
la diferencia frente a los 6,22 s exclusivamente al decoder, sin una medición
separada de E/S y CPU. Tampoco hay una medición comparable de la versión anterior
que demuestre una regresión de las bibliotecas actualizadas.

**Mejora identificada:** reutilizar el lector/bloque entre preview y extracción,
o unificar ambas fases conservando la primera imagen temprana. Debe verificarse
con este archivo, el fixture sólido grande, cancelación y memoria. Se implementó
posteriormente; véase la comparación de ejecutables en la sección siguiente.
Sesión: `7ff461b3-287d-499a-bd63-e74c9f502955`; log desde
`2026-09-23T05:31:52.756Z` (las primeras métricas de cierre son del CBZ anterior).

### TAR/CBT

Se abrió `Tarzán - Pellucidar [por NEBIRE][CRG].cbt` (81.827.328 bytes,
71 imágenes). El usuario avisó al terminar la prueba solicitada, sin reportar
fallos. La inspección encontró 71 originales y 71 miniaturas no vacíos,
10 páginas del visor generadas y la página 49 visible, cargada a 2400 × 1646.

El preview se extrajo en 1.373 ms y se procesó en 209 ms; la extracción completa
posterior duró 84 ms. No hubo errores ni advertencias registrados. Worker en
reposo: RSS 29,2 MiB y máximo residente 47,3 MiB. El worker CB7 anterior terminó
y su directorio temporal fue eliminado.

Sesión: `955fca33-5b1e-4fb4-8e86-0120d0ea7a7b`; log desde
`2026-09-23T05:35:09.121Z`. Las métricas iniciales de cierre son del CB7 previo.

### ACE/CBA

Se abrió la muestra real `.cache/fixtures/abydos.cba` (180.457 bytes, 2 imágenes).
El usuario avisó tras la comprobación solicitada, sin reportar fallos. Se
verificaron 2 originales, 2 miniaturas y 2 páginas del visor, todos no vacíos;
la página 1 estaba visible y cargada a 800 × 600.

La extracción duró 186 ms; no se registraron errores ni advertencias. Worker
en reposo: RSS 25,7 MiB y máximo residente 26,4 MiB. Esas cifras corresponden
al worker, no al pico combinado con el helper ACE durante la extracción.
El worker CBT anterior terminó y su directorio temporal fue eliminado.
Esta muestra pequeña no certifica todas las variantes ACE ni archivos grandes.

Sesión: `065be804-d47c-4725-8490-f4c0ffc3dbaa`; log desde
`2026-09-23T05:38:15.187Z`. Las métricas iniciales de cierre corresponden al CBT.

### PDF

Se abrió `[1982][Nominado] - Coetzee, John Maxwell - Esperando por los bárbaros.pdf`
(973.151 bytes, 116 páginas). El usuario avisó tras la navegación solicitada,
sin reportar problemas visuales. Se verificaron 116 miniaturas y 30 páginas
del visor generadas, todas no vacías. En la inspección de la interfaz estaba
cargada la página 27 a 1828 × 2400.

MuPDF registró la advertencia `expected name after CMapName in cmap`. No detuvo
la generación de miniaturas ni la navegación observada, pero esta comprobación
no certifica la fidelidad de todos los caracteres de todas las páginas. No se
registraron errores fatales. Worker en reposo: RSS 41,5 MiB, máximo residente
67,2 MiB. El worker ACE anterior terminó y su directorio temporal fue eliminado.

Sesión: `987aab08-015c-47e3-98bb-1d1b95bbb9f6`; log desde
`2026-09-23T05:39:52.633Z`. Las métricas iniciales de cierre son del CBA previo.

### EPUB

Se abrió `[1983][Premio] - Powers, Tim - Las puertas de Anubis.epub`
(565.185 bytes). MuPDF lo paginó en 488 páginas. El usuario avisó tras la
navegación solicitada, sin reportar fallos. Se verificaron 488 miniaturas y
49 páginas del visor generadas, todas no vacías; la página 486 estaba visible
y cargada a 1695 × 2400.

No aparecen errores ni advertencias nuevos después del arranque del worker EPUB.
La línea `warning: ... repeated 4 times...` se emitió al cerrar el PDF anterior,
antes del arranque del nuevo lector, y no se atribuye al EPUB. Worker en reposo:
RSS 56,5 MiB, máximo residente 81,8 MiB. El worker PDF anterior terminó y su
directorio temporal fue eliminado.

Sesión: `53fca100-f9ee-4cc8-afd0-744421790a0c`; log desde
`2026-09-23T05:48:06.640Z`; arranque del worker EPUB a las `05:48:06.674Z`.

### XPS

Se abrió `test/fixtures/doc/test-5pages.xps` (2.426 bytes, 5 páginas).
El usuario avisó tras la prueba solicitada, sin reportar fallos. La inspección
encontró 5 miniaturas y 4 páginas del visor generadas, todas no vacías. La página
1 estaba visible y cargada a 1600 × 2400; no se certifica la visualización manual
de la quinta página a partir de estos datos.

Sin errores ni advertencias en el log del worker XPS. Worker en reposo:
RSS 32,0 MiB, máximo residente 53,2 MiB. El worker EPUB anterior terminó y su
directorio temporal fue eliminado.

Sesión: `e9a8a43d-e828-4949-b3d5-ca7aa96ff26e`; log desde
`2026-09-23T05:54:56.892Z`. Las métricas iniciales de cierre son del EPUB anterior.

### Carpeta real de imágenes

Se abrió la carpeta `Los_futuros_de_Cixin_Liu_La_tierra_errante_Christophe_Bec_&_Cixin`
con el backend `folder`. Se verificaron 110 originales copiados (346.197.646 bytes),
110 miniaturas y 33 páginas del visor generadas, todos no vacíos. La página 100
estaba visible y cargada a 1733 × 2400. El usuario pidió revisar tras navegar;
no comunicó un fallo concreto.

El preview se copió en 163 ms y se procesó en 380 ms. La fase `extract_raw`
duró 17.673 ms: en este backend corresponde a copiar las imágenes a temporales,
no a descomprimir un archivo. Algunas páginas tardaron aproximadamente 1,3 s
en procesarse; el log registra recuperación de memoria tras esos picos.
No aparecen errores ni advertencias de esta sesión. Worker en reposo:
RSS 42,0 MiB, máximo residente 461,1 MiB. El worker XPS anterior terminó y su
directorio temporal fue eliminado. El campo `fileSize=24576` del evento de
apertura es el tamaño de la entrada de directorio, no la suma de las imágenes.

Sesión: `b1dad598-e91f-42ee-ba4c-3f0a95634512`; log desde
`2026-09-23T06:00:17.768Z`. Las primeras métricas de cierre son del XPS anterior.

### Carpeta de siete formatos

Se abrió `test/fixtures/image/formats`, con JPG, PNG, WebP, GIF, BMP, TIFF y AVIF.
Tras el aviso del usuario se encontraron los 7 originales y las 7 miniaturas,
todos no vacíos, pero solo 4 páginas del visor generadas (JPG, PNG, WebP y GIF).
La interfaz seguía en la página 1, cargada a 96 × 144. La presencia de miniaturas
no demuestra que se hayan abierto BMP, TIFF y AVIF en el visor; se solicita
seleccionar explícitamente esas tres imágenes antes de cerrar la prueba manual.

Tras la segunda confirmación del usuario se verificaron las 7 páginas generadas,
incluidos BMP, TIFF convertido a JPEG (`000005.jpg`) y AVIF. No aparecieron
errores nuevos. Se cierra la comprobación de esta carpeta con la confirmación
del usuario y la evidencia de generación; la inspección final encontró el visor
de vuelta en la página 1, por lo que no se afirma haber observado directamente
la séptima página visible en ese instante.

Sin errores ni advertencias del worker de esta carpeta. RSS y máximo residente:
29,5 MiB. El worker de la carpeta anterior terminó y sus temporales se eliminaron.
Sesión: `8e675b9b-1b2d-4ce1-aaa3-0ebf70243709`; log desde
`2026-09-23T06:07:51.978Z` (las métricas iniciales de cierre son de la carpeta previa).

## Optimización posterior de CB7 sólido

El worker conserva la instancia 7z usada para el preview y su bloque decodificado.
`open()` toma ese lector y lo libera al terminar la extracción, también al
cancelarse o salir por una excepción dentro de esa fase. `close()` descarta
cualquier preview retenido y un cambio de archivo crea un lector nuevo. Los
demás backends conservan su ciclo de preview independiente. Solo se retiene
el bloque actual del SDK; no se acumulan todos los bloques del archivo.

El diagnóstico `source=7z event=block_decode` registra las entradas al decoder
por fallo de caché, con identificador y tamaño del bloque. La regresión del
fixture sólido exige exactamente una entrada entre preview y extracción y
que la primera página esté lista antes del evento de archivo completo.

Se comparó el worker portable anterior con el nuevo, con las mismas bibliotecas,
en tres pasadas alternadas por ejecutable del CB7 de El Dormilón (116 imágenes).
No se vació la caché del sistema: son lecturas recientes, sin interacción del
usuario ni compilaciones concurrentes durante las mediciones. Medianas:

| Medida | Antes | Después |
| --- | ---: | ---: |
| Primera página lista, evento del worker | 6,715 s | 6,565 s |
| Extracción posterior al preview | 6,458 s | 0,096 s |
| Archivo completo, desde arranque | 13,174 s | 6,661 s |
| Todas las miniaturas, desde arranque | 17,076 s | 10,458 s |
| CPU del worker hasta miniaturas y última página | 16,838 s | 10,421 s |
| Pico RSS | 146,3 MiB | 154,5 MiB |
| RSS al completar miniaturas | 29,5 MiB | 29,8 MiB |

Las 116 imágenes extraídas tienen el mismo SHA-256 agregado en las seis pasadas.
La mejora elimina la segunda descompresión; no elimina la primera ni demuestra
una mejora de arranque en frío. El aumento del pico es el coste de conservar
el bloque mientras se procesa el preview.

En el fixture de bloque único de 480 MiB, una pasada por ejecutable dio
1.020 → 421 ms de extracción posterior, pico RSS 712,6 → 742,8 MiB y RSS tras
miniaturas 128,7 → 128,4 MiB. Las imágenes extraídas también coinciden.

Validación de este cambio: 3 CTest, 19 pruebas de lectores y 91 comprobaciones
funcionales de archivos aprobadas. CTest cubre reutilización, archivo distinto,
cierre, preview fuera de rango y cancelación antes de extraer; la prueba Linux
adicional cancela durante la descompresión con SIGTERM y el límite de 1,5 s
para SIGKILL usado por el bridge. El SDK sigue sin interrupción interna del
decode; la cancelación no se presenta como instantánea.

La suite de interfaz pasó también sobre el AppImage nuevo: formatos, imágenes
decodificadas, navegación, progreso, scroll, drag-and-drop y reutilización de
ventana. Se ejecutó con un perfil temporal, usando el runtime extract-and-run
del AppImage; no se volvió a generar el tar.gz en esta pasada.

Evidencia y script de medición: `test-results/cb7-optimization/`. El AppImage
anterior conserva sus resultados e identidad; el nuevo está en
`release/cb7-optimized/Comiscopio-0.2.0.AppImage`, SHA-256
`8b980a71f2d8574cea47258fc4a35a387fed168eaaa11bf59cf3e393c5caaa6e`.
El worker empaquetado coincide por SHA-256 con el probado en las mediciones.
La confirmación manual posterior del mismo CB7 real se registra a continuación.

### Confirmación manual del CB7 optimizado

El usuario volvió a abrir El Dormilón y navegó hasta la última página en el
AppImage optimizado. Sesión `1cd8e30c-5245-4fb3-9726-6806f6101d36`, desde
`2026-09-23T06:24:29.864Z` en el log manual:

- Exactamente un `block_decode`, bloque 0 de 122.705.341 bytes descomprimidos.
- Preview extraído en 6.213 ms y procesado en 175 ms. Extracción posterior de
  las 116 imágenes en 103,5 ms, sin segunda descompresión.
- 116 originales y 116 miniaturas completos, ninguno vacío; 41 páginas del
  visor generadas. La página 116 estaba visible y cargada a 916 × 1359.
- Sin errores ni advertencias de esta apertura/navegación. Worker en reposo:
  RSS 35,2 MiB, máximo residente 154,3 MiB.

Se da por verificada la eliminación de la doble descompresión también en la
prueba manual. La diferencia del primer preview frente a la primera ronda no
se atribuye íntegramente al cambio: las condiciones de caché no son iguales.

## Límites ACE acordados e implementados

El usuario aprobó 10.000 entradas, 512 MiB descomprimidos por archivo y 8 GiB
acumulados. Los valores por defecto son 10.000, 536.870.912 y 8.589.934.592 bytes;
se pueden ajustar mediante las variables `COMISCOPIO_ACE_MAX_ENTRIES`,
`COMISCOPIO_ACE_MAX_ENTRY_BYTES` y `COMISCOPIO_ACE_MAX_TOTAL_BYTES`. Cero, negativos,
texto no decimal y valores fuera de rango se rechazan explícitamente.

El decoder lista los tamaños declarados y los nombres codificados en hexadecimal.
Comprueba cantidad/tamaño antes de extraer; el helper vuelve a comprobarlos al
interpretar el listado. Se cuentan también carpetas, archivos auxiliares y
entradas que no son imágenes. No se usa el tamaño comprimido para estos topes.

Cada extracción recibe como presupuesto el menor entre su tamaño declarado,
el límite por archivo y el total restante. El decoder comprueba ese presupuesto
antes de cada escritura; el helper valida también el tamaño final. La salida
capturada del decoder está acotada a 8 MiB para listar y 64 KiB por extracción.
Al rechazar o cancelar, se eliminan el directorio de trabajo y los archivos ya
generados por ese helper. Se exige un directorio raw vacío para conservar archivos
preexistentes. El original no se modifica.

El worker comunica el motivo como error JSON. Electron espera el cierre de los
canales del proceso y conserva ese error concreto; un error recuperable de una
página no suprime el aviso posterior de caída del worker.

Las 34 pruebas de lectores pasaron: CBA real, límites reducidos, igualdad exacta
con los topes, rechazo de 10.001 directorios y de tamaños declarados excesivos,
desbordamiento numérico, listado malformado, salida excesiva, escritura real
con tamaño declarado falso y limpieza tras fallo en una página posterior.
Las respuestas de decoder simuladas permiten comprobar los topes sin crear
archivos de varios GiB; la comprobación de escritura usa además el decoder real.
Los controles no constituyen un límite de RAM/CPU ni certifican todas las
variantes ACE. Su ejecución en Windows sigue pendiente.

Además pasaron 104 pruebas unitarias, la compilación TypeScript/Electron, 3 CTest
y la comprobación de bibliotecas del bundle. El AppImage pasó las dos pruebas
de interfaz: rechazo con límite de una entrada, conservación del motivo tras
cerrar el worker, apertura de un CBZ posterior y recorrido habitual de formatos,
navegación, progreso, scroll, drag-and-drop y reutilización de ventana.
El límite reducido se usa únicamente en el perfil temporal de esa prueba.

Evidencia de esta pasada: `test-results/ace-limits/`. AppImage local:
`release/ace-limits/Comiscopio-0.2.0.AppImage`, SHA-256
`9b86420ad1b7327a1e80fb710cc31d15e132b643210a7b7a2cabbcd6bf9ba205`.
Incluye la optimización CB7 anterior y los límites normales acordados. El tar.gz
anterior no incluye estos cambios. La muestra ACE original conserva su SHA-256.
La última apertura manual del CBA se completó con este paquete. Tras la
confirmación del usuario se verificaron 2 originales, 2 miniaturas y 2 páginas
del visor, todos no vacíos; la página 1 estaba visible a 800 × 600. Extracción
en 281,4 ms, sin errores ni advertencias. Worker en reposo: RSS 26,3 MiB y máximo
residente 27,0 MiB; estas cifras no incluyen el pico del helper/decoder durante
la extracción. Ambos procesos auxiliares habían terminado y `.ace-work` ya
no existía. Sesión `e643eca0-d30f-4272-b048-355700d39f18`, desde
`2026-09-23T07:05:39.304Z` en el log manual. Esta muestra de dos imágenes confirma
la apertura normal con los límites acordados; los rechazos se verificaron en
las pruebas automáticas descritas arriba.

## Paquetes 0.3.0 — comprobación final

Tras aprobar la versión 0.3.0 se actualizaron `package.json`, el lockfile y los
metadatos generados antes de compilar Angular/Electron y empaquetar. Se reutilizó
el bundle nativo actualizado y ya validado; los cambios finales fueron versión,
cierre de Electron y pruebas. No se recompilaron bibliotecas sin cambios.

Pasaron 105 pruebas unitarias, 35 pruebas de lectores sin omisiones (30,8 s)
y las dos pruebas de interfaz en cada contenedor:
tar.gz recién extraído (11,2 s) y AppImage real (34,2 s). Incluyen rechazo ACE,
formatos, progreso, scroll, drag-and-drop, ventanas, cierre con eliminación de
temporales y coincidencia de versión del ejecutable y «Acerca de» con 0.3.0.
Se usó el escritorio Linux disponible porque `xvfb-run` no está instalado en el
host; el workflow mantiene el escritorio virtual de su runner.

Artefactos en `release/0.3.0-linux/`; evidencia en `test-results/0.3.0-linux/`:

- `Comiscopio-0.3.0.AppImage`: SHA-256
  `c16867fe81c2b7216beb636daa7c574854c554f9a48d39786529599410351f81`.
- `comiscopio-0.3.0.tar.gz`: SHA-256
  `df3013312dd1e5099932d0324799955d464ead82aa86dd32108c3f2868d4848d`.

Estos paquetes sustituyen para la preparación actual a los paquetes 0.2.0
descritos como anteriores en este registro. No se han publicado.

## Lo que quedaba al terminar la ronda manual

Se completó la ronda de apertura y navegación solicitada por formatos en el
AppImage actualizado, con los alcances y salvedades registrados arriba. No
certifica cada página de cada archivo; en particular, la quinta página XPS no
quedó acreditada en la inspección manual. Los resultados de rondas anteriores
a este AppImage pertenecen al conjunto de dependencias anterior.

La optimización del CB7 sólido quedó comprobada en pruebas y en la ronda manual.
La advertencia CMap del PDF también queda registrada;
no impidió la navegación observada, pero no se verificó la fidelidad de todos
sus caracteres.

DjVu continúa delegado a MuPDF sin afirmar que exista un decoder efectivo.
Los límites ACE están implementados y probados en Linux con el alcance descrito
arriba; las pruebas no certifican todos los archivos maliciosos ni todas las
variantes ACE. Una medición de 7z sólido no impone un techo de memoria.

Windows 11/10, sus artefactos, la ejecución real de Actions y la revisión final
de metadatos GitHub quedan para después. La prohibición de publicar sigue vigente.

## Artefactos y diagnósticos de esta pasada

Los paquetes locales están en `release/linux-verified/`; no se publicaron.
El AppImage aprobado se usa para la nueva ronda manual. Evidencia automática en
`test-results/linux-update/`: instalación, builds, suites, matriz, memoria,
reproducciones previas, capturas y logs de los dos artefactos.

SHA-256 de los artefactos probados:

- AppImage: `41eedc0fc5512912a6db2e06492c279f3a894c52877c03eff56a19a9de472870`
- tar.gz: `c3b7312703e7787036151d8dcd6f589c37181c02105c2d3d9caba263cf44cf94`

Fuentes de compatibilidad/versiones: [Angular](https://angular.dev/reference/versions),
[libvips](https://github.com/libvips/libvips/releases/tag/v8.18.6),
[libarchive](https://libarchive.org/downloads/),
[MuPDF](https://mupdf.com/releases/history), [UnRAR](https://www.rarlab.com/rar_add.htm).
