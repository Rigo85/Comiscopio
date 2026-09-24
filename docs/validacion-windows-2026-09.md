# Validación Windows — septiembre de 2026

Estado: rondas locales Windows 11 y Windows 10 x64 completadas, una VM a la vez,
con las salvedades detalladas abajo. La sección «Paquetes finales 0.3.0» recoge
los controles de los nuevos artefactos; las rondas anteriores usaron 0.2.0.
No se han hecho commits, push, tags ni publicaciones. Véase la
[revisión final](revision-final-0.3.0.md) para el estado entre plataformas.

Las simplificaciones de la [revisión de sobreingeniería](revision-sobreingenieria-2026-09.md)
quedan diferidas por decisión del usuario.

## Preparación y correcciones

- VM con KVM activo, 2 CPU y 6 GiB de RAM; disco en `/media/work`.
- Node 24.18.1, npm 11.16.0, Electron 44.4.4 y Angular 22.1.7.
- `npm ci` completado, SQLite recompilado para Electron y auditoría npm sin
  vulnerabilidades reportadas en esa ejecución.
- La primera compilación incremental reutilizó workers anteriores porque sus
  fechas eran posteriores a las fuentes sincronizadas desde Linux. Se compararon
  hashes de las fuentes, se limpiaron ambos builds y se recompilaron. Los fallos
  de esa primera ejecución no se atribuyen a las fuentes actuales. Al sincronizar
  por ZIP hay que invalidar los objetos antiguos; no basta con sustituir fuentes
  conservando sus fechas. No se modificó el build normal para resolver este
  problema particular de la copia a la VM.
- Un segundo intento de la automatización temporal reutilizó un log anterior.
  Se sustituyó esa ejecución por procesos con logs directos y nuevos. La evidencia
  vigente de lectores y empaquetado está en `windows11-validated`.
- **ACE:** el decoder privado rechazaba rutas Windows absolutas. El helper
  convierte las rutas al espacio POSIX de su propio runtime mediante
  `cygwin_conv_path`, sin asumir el montaje `/c` de MSYS2 instalado. Se verifican
  también nombres Unicode, espacios y un directorio de salida con espacios.
- **BMP/AVIF:** los módulos dinámicos de libvips no aparecían en los imports de
  los ejecutables. El bundle ahora incorpora `vips-magick`, `vips-heif`, los
  coders `magick`/`bmp` y sus DLL. El worker indica la ubicación de los coders
  dentro del bundle. ImageMagick y libheif se añadieron a la instalación local
  documentada y al workflow Windows.

## Resultados automáticos

- Compilación Angular y TypeScript/Electron: correcta.
- Vitest: 99 aprobadas; 5 omitidas porque comprueban `ldd` en Linux.
- SQLite con la ABI de Electron: 3 aprobadas, incluidas conservación ante
  corrupción y bloqueo.
- CTest después de recompilar: 3 aprobadas, incluida reutilización CB7.
- Lectores del bundle Windows actualizado: **23 aprobadas, 0 fallos, 12 omitidas**.
  Las omitidas usan señales, locale o decoders simulados específicos de Linux;
  no cuentan como verificaciones Windows.
- La suite comprobó CBZ, CBR, CB7 pequeño y sólido grande, CBT, PDF, EPUB, XPS,
  carpetas, JPEG/PNG/WebP/GIF/BMP/TIFF/AVIF, recuperación de páginas dañadas,
  miniaturas, comandos fragmentados, cierre normal, límites ACE y rutas Unicode.
- Regresión Linux tras ajustar el helper ACE: 35 pruebas de lectores aprobadas,
  sin omisiones. Usa los workers del bundle Linux y el helper recién recompilado;
  no se generó otro AppImage por este cambio condicionado a Windows/MSYS2.
- Aplicación empaquetada (`win-unpacked/Comiscopio.exe`): **2 pruebas aprobadas,
  0 fallos**. Comprueban los formatos, progreso de lectura, scroll de miniaturas,
  arrastrar y soltar, reutilización de ventanas y recuperación tras rechazar ACE
  por su límite. Esta ejecución no sustituye la prueba de los contenedores EXE/ZIP.

Evidencia local en `test-results/windows11/`; los últimos logs de compilación,
lectores y aplicación empaquetada están en `windows11-validated/`.
Estas comprobaciones no certifican todas las variantes ACE ni reemplazan una
prueba de cancelación forzada del árbol de procesos en Windows. Esa comprobación
adicional con auxiliar controlado se registra al final de este documento.

## Artefactos locales y prueba manual

Se generaron y copiaron a `release/windows11-verified/` los siguientes paquetes.
Los SHA-256 se comprobaron nuevamente después de copiarlos desde Windows:

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `Comiscopio 0.2.0.exe` | 172595920 | `2e8826cee3d09e59596138f6babe96ffa00a76dc20d173aab38decf18a942231` |
| `Comiscopio-0.2.0-win.zip` | 256802591 | `4988681178b13908416785d0c76e30edcf07127652448c42b9efdc3a809178bb` |

El bundle Windows usa libvips 8.18.6, libarchive 3.8.9 y MuPDF 1.28.2 de MSYS2;
este último difiere del MuPDF 1.28.4 del bundle Linux.

El EXE portable se lanzó directamente con un perfil de prueba y un CBR real de
113 páginas. Se verificó la primera página renderizada y se capturó la ventana
con las miniaturas visibles. La apertura inicial por sí sola no se registra como
una ronda manual completa; la revisión posterior del CBR se detalla abajo.
Los resultados iniciales están en `test-results/windows11/manual/`.

La ronda manual Windows 11 cubre CBR, CBZ, CB7, CBT, ACE/CBA, PDF, EPUB, XPS,
carpetas JPEG y siete formatos de imagen con los alcances registrados abajo.
El ZIP extraído y la terminación forzada se comprobaron después de corregir el
cierre de la última ventana, como se detalla abajo. Queda Windows 10 con los
mismos artefactos corregidos. El workflow fue actualizado localmente; no se ha ejecutado
en GitHub ni se ha publicado un release.

### CBR: primera revisión manual

El usuario avisó al terminar la prueba solicitada sin reportar fallos. La
inspección posterior encontró la página 108/113 cargada a 1561 × 2400 y 23
miniaturas montadas en el DOM. La lista estaba en su límite inferior
(`scrollTop=11640`, altura total 12327, viewport 687). Ese estado no prueba por
sí solo cada maniobra solicitada ni que se haya vuelto al inicio.

No aparecen errores ni advertencias en el log recogido. El preview se extrajo
en 1427 ms y se procesó en 186 ms; la extracción posterior de las 113 entradas
duró 6803 ms. Son tiempos internos del worker, no del primer pintado.
El directorio temporal contiene 113 originales, 113 miniaturas y 58 páginas
del visor generadas, todos no vacíos.

Memoria tras la navegación, mediante `Win32_Process`: worker 40,7 MiB residentes,
máximo 65,3 MiB; renderer 628,0 MiB residentes y 55,7 MiB de memoria privada
comprometida. La suma de working sets de los seis procesos, incluido el lanzador
portable, fue 935,3 MiB; puede contar páginas compartidas más de una vez. Se
conserva como referencia para el cambio de archivo, sin concluir fuga o ausencia
de fuga a partir de una sola muestra.

El primer arranque del EXE portable tardó aproximadamente 66 s entre el registro
del lanzamiento y la inicialización del logger; después transcurrieron unos
12 s entre `session_start` y el primer registro del worker. Queda anotado para
comparar arranques posteriores; no se ha aislado cuánto corresponde a extracción
del portable, antivirus, carga de DLL o recursos de la VM.

Sesión: `6281844c-bba5-4dd4-be1f-9edc1f8a8b18`. Evidencia:
`test-results/windows11/manual/cbr-review/`.

### CBZ grande: revisión manual

Se preparó `Prueba CBZ grande.cbz`, copia del Juego de Tronos usado en Linux
(618.385.167 bytes, 188 páginas), para apertura por arrastre desde Explorer.
El usuario avisó al terminar la prueba solicitada sin reportar fallos. La
inspección encontró la página 58/188 cargada a 1570 × 2400 y 23 miniaturas en
el DOM. No se midió el instante del primer pintado durante la carga ni se
observó directamente cada maniobra de navegación solicitada.

- 188 originales, 188 miniaturas y 38 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Preview extraído en 1384 ms y procesado en 593 ms; extracción posterior en
  22.819 ms. Esta pasada en VM tardó más que la pasada Linux documentada; las
  condiciones difieren y no se atribuye la diferencia a una causa concreta.
- El worker CBR anterior (PID 2052) ya no existe y su directorio temporal fue
  eliminado.
- Worker CBZ: 41,4 MiB residentes y máximo 450,2 MiB. El renderer, conservando
  el mismo PID, bajó de 628,0 a 516,0 MiB residentes; memoria privada comprometida
  59,2 MiB. Suma de working sets de los seis procesos: 833,3 MiB, con la misma
  salvedad sobre páginas compartidas. Se observa liberación de memoria en esta
  pasada, sin afirmar ausencia de cualquier fuga.

Sesión: `a41b8d24-ae10-487c-b71a-5c1fb0a26fed`. Evidencia:
`test-results/windows11/manual/cbz-review/`.

### CB7 sólido: revisión manual y reutilización del bloque

Se probó `Prueba CB7 solido.cb7`, copia de
`El_Dormilon_Santullo_&_Aon_2016_Bostamr_CRG_cbz_38325c7578f6f67.cb7`
(113.631.849 bytes, 116 imágenes), utilizado también en Linux. El usuario
avisó al terminar la prueba solicitada sin reportar fallos. La inspección
encontró la página 44/116 cargada a 1618 × 2400 y 23 miniaturas en el DOM.

- 116 originales, 116 miniaturas y 47 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Un único evento `block_decode`, bloque 0 de 122.705.341 bytes descomprimidos,
  antes del preview. La extracción posterior no vuelve a descomprimir ese bloque:
  se verifica la reutilización en esta apertura real Windows.
- Preview extraído en 6965 ms y extracción posterior en 923 ms. No son tiempos
  medidos del primer pintado, ni una comparación controlada entre sistemas.
- Worker en reposo: 40,2 MiB residentes, máximo 165,4 MiB. Renderer: 639,4 MiB
  residentes y 63,6 MiB privados comprometidos. Suma de working sets: 957,6 MiB,
  que puede contar páginas compartidas más de una vez. Las muestras de renderer
  varían con la navegación; no bastan para concluir fuga o ausencia de fuga.
- El worker CBZ anterior (PID 7192) terminó y su directorio temporal ya no existe.

Sesión: `ef30dc32-e8b0-4010-b64c-fc40b8a3fff1`. Evidencia:
`test-results/windows11/manual/cb7-review/`.

### CBT: revisión manual

Se probó `Prueba CBT.cbt`, copia de `Tarzán - Pellucidar [por NEBIRE][CRG].cbt`
(81.827.328 bytes, 71 imágenes), utilizado también en Linux. El usuario avisó
al terminar la prueba solicitada sin reportar fallos. La inspección encontró
la página 27/71 cargada a 2400 × 1646 y 23 miniaturas montadas en el DOM.

- 71 originales, 71 miniaturas y 30 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Preview extraído en 20 ms y procesado en 227 ms; extracción posterior en
  1083 ms. No representan el instante del primer pintado.
- Worker: 41,5 MiB residentes y máximo 60,6 MiB. Renderer: 634,3 MiB residentes
  y 59,3 MiB privados comprometidos. Suma de working sets: 952,7 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.
- El worker CB7 anterior (PID 3472) terminó y su directorio temporal ya no existe.

Sesión: `1f365af1-a3ed-4641-9f19-fe48b9c8bbda`. Evidencia:
`test-results/windows11/manual/cbt-review/`.

### ACE/CBA: revisión manual

Se probó `Prueba ACE.cba`, copia de la muestra `abydos.cba` (180.457 bytes,
dos imágenes), utilizada también en Linux. El usuario avisó al terminar la
prueba solicitada sin reportar fallos. La inspección encontró la página 1/2
cargada a 800 × 600 y las dos miniaturas presentes en el DOM.

- Dos originales, dos miniaturas y dos páginas del visor generadas, todos no vacíos.
- Extracción completada en 1512 ms, sin errores ni advertencias en los logs.
  Los eventos de cancelación inmediatamente posteriores a `session_start`
  corresponden al cierre del CBT anterior, no a un fallo de ACE.
- El worker CBT anterior (PID 1644) terminó y su directorio temporal ya no existe.
  No aparecen procesos del helper ACE ni del decoder privado en la captura
  posterior a la extracción.
- Worker ACE: 37,0 MiB residentes y máximo 39,1 MiB; ese máximo no incluye los
  procesos auxiliares que ya terminaron. Renderer: 136,8 MiB residentes y
  59,7 MiB privados comprometidos. Bajó de 634,3 a 136,8 MiB residentes al pasar
  del CBT a esta muestra pequeña. Suma de working sets: 446,0 MiB, con las
  salvedades sobre memoria compartida ya indicadas.

Esta muestra verifica la apertura y navegación del ACE probado; no certifica
todas sus variantes ni sustituye la prueba pendiente de cancelación forzada.
Sesión: `3f4c3ba6-e15a-429b-b408-7bbe771c6295`. Evidencia:
`test-results/windows11/manual/ace-review/`.

### PDF: revisión manual

Se probó `Prueba PDF.pdf`, copia de `Esperando por los bárbaros`
(973.151 bytes, 116 páginas), utilizado también en Linux. El usuario avisó al
terminar la prueba solicitada sin reportar fallos. La inspección encontró la
página 41/116 cargada a 1828 × 2400 y 23 miniaturas montadas en el DOM.

- 116 miniaturas y 38 páginas del visor generadas, todas no vacías.
- MuPDF registró `warning: expected name after CMapName in cmap`, la misma
  advertencia observada con este documento en Linux. No aparecen errores fatales
  ni se interrumpió la generación de miniaturas. La prueba no certifica la
  fidelidad de todos los caracteres de todas las páginas.
- El worker ACE anterior (PID 9152) terminó y su directorio temporal ya no existe.
- Worker PDF: 46,6 MiB residentes y máximo 73,7 MiB. Renderer: 627,0 MiB residentes
  y 68,3 MiB privados comprometidos. Suma de working sets: 953,8 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.

Sesión: `0aa2e55c-3b0c-4958-a3a0-1bc5bf65a478`. Evidencia:
`test-results/windows11/manual/pdf-review/`.

### EPUB: revisión manual

Se probó `Prueba EPUB.epub`, copia de `Las puertas de Anubis` (565.185 bytes),
utilizado también en Linux. MuPDF lo paginó en 488 páginas. El usuario avisó al
terminar la prueba solicitada sin reportar fallos. La inspección encontró la
página 20/488 cargada a 1695 × 2400 y 23 miniaturas montadas en el DOM.

- 488 miniaturas y 23 páginas del visor generadas, todas no vacías.
- Sin errores ni advertencias nuevos desde el arranque del worker EPUB.
  `warning: ... repeated 4 times...` aparece antes de ese arranque y corresponde
  al cierre del PDF anterior, como ocurrió en la prueba Linux.
- El worker PDF anterior (PID 6844) terminó y su directorio temporal ya no existe.
- Worker EPUB: 63,3 MiB residentes y máximo 89,0 MiB. Renderer: 493,6 MiB residentes
  y 71,7 MiB privados comprometidos. Suma de working sets: 817,4 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.

Sesión: `32652909-ffb4-4489-8409-79b0ab48bdc9`; worker iniciado a las
`2026-09-23T22:35:10.377Z`. Evidencia:
`test-results/windows11/manual/epub-review/`.

### XPS: revisión manual

Se probó `Prueba XPS.xps`, copia de `test/fixtures/doc/test-5pages.xps`
(2.426 bytes, cinco páginas), utilizado también en Linux. El usuario avisó al
terminar la prueba solicitada sin reportar fallos. La inspección encontró la
página 5/5 cargada a 1600 × 2400 y las cinco miniaturas presentes en el DOM.

- Cinco miniaturas y cinco páginas del visor generadas, todas no vacías.
- Sin errores ni advertencias en el segmento de log del worker XPS.
- El worker EPUB anterior (PID 7040) terminó y su directorio temporal ya no existe.
- Worker XPS: 37,8 MiB residentes y máximo 60,1 MiB. Renderer: 170,5 MiB residentes
  y 71,7 MiB privados comprometidos. Suma de working sets: 460,0 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.

Sesión: `8bf8a651-c563-4025-9488-ae895f347075`. Evidencia:
`test-results/windows11/manual/xps-review/`.

### Carpeta de imágenes: revisión manual

Se probó `Prueba carpeta imagenes`, copia local en Windows de la carpeta de
`La tierra errante` utilizada en Linux: 110 JPEG y 346.197.646 bytes. El usuario
avisó al terminar la prueba solicitada sin reportar fallos. La inspección
encontró la página 14/110 cargada a 1713 × 2400 y 23 miniaturas en el DOM.

- 110 originales, 110 miniaturas y 17 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de la sesión.
- Preview copiado en 48 ms y procesado en 402 ms; fase `extract_raw` en 5126 ms.
  En carpetas esta fase copia los originales a temporales; no descomprime.
  `fileSize=0` del evento de apertura describe la entrada de directorio Windows,
  no el tamaño acumulado de las imágenes.
- El worker XPS anterior (PID 6240) terminó y su directorio temporal ya no existe.
- Worker: 39,7 MiB residentes y máximo 442,4 MiB. Renderer: 355,0 MiB residentes
  y 68,7 MiB privados comprometidos. Suma de working sets: 648,2 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.

Sesión: `5a7e0629-d334-4e4e-986e-9594ba6a1b1c`. Evidencia:
`test-results/windows11/manual/folder-review/`.

### Siete formatos de imagen: revisión manual

Se probó `Prueba siete formatos`, copia de `test/fixtures/image/formats`, con
JPG, PNG, WebP, GIF, BMP, TIFF y AVIF. El usuario avisó al terminar la prueba
solicitada sin reportar fallos. La inspección encontró la página 6/7 (TIFF)
cargada a 96 × 144 y las siete miniaturas presentes en el DOM. No se afirma
que AVIF estuviera visible en el instante de esa inspección.

- Siete originales, siete miniaturas y siete páginas del visor generadas,
  todos no vacíos; incluye las páginas de BMP, TIFF y AVIF.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- El worker de la carpeta JPEG anterior (PID 8096) terminó y sus temporales
  ya no existen.
- Worker: 40,3 MiB residentes y máximo 42,7 MiB. Renderer: 347,4 MiB residentes
  y 70,3 MiB privados comprometidos. Suma de working sets: 627,5 MiB, con la
  salvedad sobre páginas compartidas indicada en las pruebas anteriores.

Sesión: `e9008632-85c4-49b6-ab4e-ba94abb37468`. Evidencia:
`test-results/windows11/manual/formats-review/`. Continúan las comprobaciones
automáticas del ZIP extraído y de cancelación de procesos Windows.

## Cierre de la última ventana: regresión detectada

Tras la ronda manual, al cerrar el portable terminaron Electron y el worker,
pero seguía existiendo la carpeta temporal de la última sesión después de 20 s.
`closeSession` iniciaba el cierre asíncrono y retiraba la sesión del mapa;
`before-quit` no esperaba al evento `close` del proceso ni al borrado pendiente.
La limpieza entre archivos había pasado, pero no cubría la salida de la aplicación.

Se ajustó el bridge para seguir los workers y borrados pendientes aunque ya no
estén en el mapa de sesiones. `before-quit` espera ese cierre, conserva la
terminación forzada a los 1500 ms y después cierra SQLite y sale. El borrado
incluye reintentos acotados y registra una advertencia si finalmente falla.

Una prueba unitaria cubre el cierre iniciado antes de `closeAll` y un borrado
asíncrono aún pendiente. La prueba de interfaz empaquetada ahora cierra la última
ventana con un archivo abierto y exige que su directorio temporal ya no exista
cuando termina la aplicación. Pasaron 105 pruebas unitarias en Linux y 100 en
Windows, con cinco comprobaciones `ldd` omitidas en Windows.

Se regeneraron los paquetes; los hashes de la tabla anterior corresponden a la
ronda manual previa a esta corrección. Los nuevos artefactos se copiaron a
`release/windows11-shutdown-fixed/` y se verificaron otra vez sus SHA-256:

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `Comiscopio 0.2.0.exe` | 172587676 | `59b90d646dcc0d572672926390e33fcbbee4b638aac95db2a08f64f56e7ec7c4` |
| `Comiscopio-0.2.0-win.zip` | 256803156 | `7fc0e2e2d3b70cd2e7bb3c8f5cc8513b8306ca47f55ec50d7d1f03aba8c559b4` |

Las dos pruebas de interfaz pasaron desde una extracción nueva de ese ZIP,
incluido el cierre de la última ventana y la eliminación de sus temporales.
En el primer intento, el arranque de la primera prueba superó 45 s; el logger
recién se inicializó unos 43 s después del lanzamiento. La segunda prueba pasó.
Se conserva ese diagnóstico y se amplió el límite de arranque Windows a 120 s;
la repetición pasó en 3,8 s y 20,7 s respectivamente. No se atribuye la demora
inicial a una causa concreta ni se oculta como un fallo funcional resuelto.
Las dos pruebas también pasaron en el directorio empaquetado Linux reconstruido.

Se comprobó el control de procesos con un auxiliar Windows de prueba que crea
un hijo y mantiene ambos bloqueados. Forzar el cierre del worker terminó ambos
en 72 ms. Cerrar la última ventana de la aplicación mientras esperaba al auxiliar
activó la terminación prevista tras 1500 ms: la aplicación salió en 1667 ms,
sin auxiliares vivos ni temporales de esa sesión. Una comprobación preliminar
que enviaba únicamente `quit` no terminó el worker bloqueado; ese comando solo
no representa la política del bridge, que incluye la terminación forzada.
Esta prueba controlada verifica el Job Object y el cierre de la aplicación;
no equivale a cancelar todas las variantes de un ACE real durante extracción.
El auxiliar y la automatización son herramientas locales de validación, todavía
no pruebas persistentes del workflow. Los PATH de ejecución excluyeron MSYS2.

El EXE portable corregido también se ejecutó directamente, con perfil nuevo y
sin MSYS2 en el PATH: abrió ACE, mostró ambas páginas y cerró sin dejar temporales.
Tardó 93.261 ms desde el lanzamiento hasta tener la primera imagen lista y
95.264 ms hasta completar la prueba, incluido el cierre. Se conserva esta demora
del primer arranque como observación de rendimiento pendiente de aislar; el
resultado funcional no implica considerar aceptable ese tiempo. Evidencia:
`test-results/windows11/windows11-portable-after-fix/`.

Evidencia del fallo original:
`test-results/windows11/windows11-final-checks/`; validación de la corrección:
`test-results/windows11/windows11-shutdown-fix/`.

## Windows 10: validación en curso

Tras apagar Windows 11 se inició Windows 10 Pro 22H2, compilación 19045, x64,
con 2 CPU y 6 GiB de RAM. Se copiaron los mismos EXE y ZIP corregidos y sus
SHA-256 coinciden con los registrados arriba. Se usa Node portable únicamente
para conducir las pruebas, junto con fixtures y Playwright; no se instala
MSYS2 ni un compilador en esta VM. Los lectores y la aplicación se ejecutan
desde los artefactos, sin recompilar.

Resultados desde la extracción del ZIP corregido:

- Lectores: 23 aprobadas, cero fallos y 12 omitidas específicas de Linux; 64,1 s.
  Incluye ACE, rutas Unicode, siete formatos de imagen, CB7 sólido grande,
  documentos y recuperación de páginas dañadas.
- Interfaz: dos pruebas aprobadas, cero fallos; 42,7 s. Incluye formatos,
  navegación, progreso, drag-and-drop, ventanas, recuperación tras rechazo ACE
  y cierre de la última ventana sin dejar temporales.

No se recompilaron las bibliotecas ni la aplicación. El EXE portable corregido
se inició con un perfil nuevo y el CBR de 113 páginas: se verificó la primera
imagen renderizada mientras continuaba la carga. La ronda manual Windows 10
continúa por formato, con sus resultados abajo. La prueba controlada de auxiliares
bloqueados descrita arriba se realizó en Windows 11. Evidencia Windows 10:
`test-results/windows10/`.

### Windows 10 — CBR

El usuario avisó tras la prueba solicitada con `Prueba CBR.cbr`, copia del
Frankenstein utilizado en Linux y Windows 11 (211.714.166 bytes, 113 páginas),
sin reportar fallos. La inspección encontró la última página, 113/113, cargada
a 1280 × 1968 y 23 miniaturas montadas en el DOM. La lista estaba en su límite
inferior (`scrollTop=11632`, altura 12327, viewport 695); no se afirma haber
observado el regreso al inicio a partir de esa captura.

- 113 originales, 113 miniaturas y 20 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el log de la sesión.
- Preview extraído en 2011 ms y procesado en 223 ms; extracción posterior en
  14.183 ms. Son tiempos del worker, no una medición del primer pintado.
- Worker: 158,0 MiB residentes, máximo 168,5 MiB y 35,1 MiB privados comprometidos.
  Renderer: 377,0 MiB residentes y 67,4 MiB privados comprometidos. Suma de
  working sets de seis procesos, incluido el lanzador: 1263,0 MiB; puede contar
  memoria compartida más de una vez. Se conserva como referencia para el cambio
  de archivo, sin inferir fuga de memoria a partir de esta muestra.

Sesión: `18a7ed9b-acc4-493d-ab68-ed2c0ee9d624`. Evidencia:
`test-results/windows10/manual/cbr-review/`.

### Windows 10 — CBZ grande

El usuario avisó tras la prueba solicitada con `Prueba CBZ grande.cbz`, copia
del Juego de Tronos utilizado en Linux y Windows 11 (618.385.167 bytes,
188 páginas), sin reportar fallos. La inspección encontró la última página,
188/188, cargada a 1568 × 2400 y 23 miniaturas montadas en el DOM. La lista
estaba en su límite inferior (`scrollTop=19807`, altura 20502, viewport 695).

- 188 originales, 188 miniaturas y 31 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Preview extraído en 1102 ms y procesado en 565 ms; extracción posterior en
  15.397 ms. No son tiempos medidos del primer pintado.
- El worker CBR anterior (PID 5936) terminó y su directorio temporal ya no existe.
- Worker CBZ: 37,0 MiB residentes, máximo 616,2 MiB y 23,3 MiB privados
  comprometidos. Renderer: 618,7 MiB residentes y 72,6 MiB privados comprometidos.
  Suma de working sets: 1391,1 MiB, con la salvedad sobre memoria compartida ya
  indicada. El worker liberó memoria tras el pico; la muestra del renderer
  depende de la navegación y no basta para concluir fuga o ausencia de fuga.

Sesión: `ebbc1ada-88c2-4758-9e14-725c35e9a971`. Evidencia:
`test-results/windows10/manual/cbz-review/`.

### Windows 10 — CB7 sólido

El usuario avisó tras la prueba solicitada con `Prueba CB7 solido.cb7`, copia
de `El Dormilón` utilizado en Linux y Windows 11 (113.631.849 bytes, 116 imágenes),
sin reportar fallos. La inspección encontró la página 35/116 cargada a
1618 × 2400 y 23 miniaturas montadas en el DOM.

- 116 originales, 116 miniaturas y 36 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Un único evento `block_decode`, bloque 0 de 122.705.341 bytes descomprimidos,
  antes del preview. La extracción posterior reutilizó el bloque, confirmando
  la optimización en esta apertura Windows 10.
- Preview extraído en 9094 ms y procesado en 156 ms; extracción posterior en
  623 ms. No son tiempos medidos del primer pintado ni una comparación
  controlada entre sistemas operativos.
- El worker CBZ anterior (PID 664) terminó y su directorio temporal ya no existe.
- Worker CB7: 119,6 MiB residentes, máximo 245,2 MiB y 21,2 MiB privados
  comprometidos. Renderer: 679,3 MiB residentes y 74,0 MiB privados comprometidos.
  Suma de working sets: 1541,5 MiB; puede contar páginas compartidas más de una
  vez. Se conserva la muestra para continuar observando los cambios entre archivos.

Sesión: `bd5a460c-9ae8-4119-9538-ac4bc316271d`. Evidencia:
`test-results/windows10/manual/cb7-review/`. Siguiente prueba: CBT de Tarzán,
81.827.328 bytes y 71 imágenes, utilizado también en Linux y Windows 11.

### Windows 10 — CBT: apertura correcta con demora inicial

El usuario confirmó que `Prueba CBT.cbt` abrió bien, pero tardó un poco. Es la
copia de Tarzán utilizada en Linux y Windows 11 (81.827.328 bytes, 71 imágenes).
La inspección encontró la página 71/71 cargada a 2400 × 1689, con 23 miniaturas
montadas y la lista en su límite inferior (`scrollTop=7054`, altura 7749,
viewport 695).

- 71 originales, 71 miniaturas y 44 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Arranque del worker aproximadamente 244 ms después de iniciar la sesión.
  Extracción del preview: 5125 ms. Procesamiento de la primera imagen: 3564 ms,
  de los cuales 3443 ms corresponden a la miniatura, 32 ms a decodificación y
  90 ms a la página del visor. El procesamiento terminó unos 9,2 s después del
  inicio de sesión; esto no mide el primer pintado de la interfaz.
- La extracción posterior de las 71 entradas tardó 421 ms. La demora observada
  se concentra antes de esta fase. Queda pendiente repetir la apertura para
  comprobar su reproducibilidad; no se atribuye todavía a disco, antivirus,
  virtualización ni a una regresión del lector.
- El worker CB7 anterior (PID 3716) terminó y su directorio temporal ya no existe.
- Worker CBT (PID 2928): 152,4 MiB residentes, máximo 173,3 MiB y 20,5 MiB
  privados comprometidos. Renderer: 766,3 MiB residentes, máximo 809,8 MiB y
  65,9 MiB privados comprometidos. Suma de working sets: 1660,6 MiB, que puede
  contar memoria compartida más de una vez; esta muestra no demuestra una fuga.

Sesión: `08ce4b77-a144-451c-8f97-e36ab59c3038`. Evidencia:
`test-results/windows10/manual/cbt-review/`.

#### Reapertura del mismo CBT

Tras solicitar cerrar solo el archivo y volver a abrirlo, el usuario pidió
revisar. Se confirmó una sesión nueva y la demora inicial se reprodujo:

| Fase | Primera apertura | Reapertura |
| --- | ---: | ---: |
| Extracción del preview | 5125 ms | 3826 ms |
| Procesamiento de primera imagen | 3564 ms | 4019 ms |
| Miniatura, incluida en el procesamiento | 3443 ms | 3878 ms |
| Inicio de sesión hasta preview procesado | 9,2 s | 8,3 s |
| Extracción posterior | 421 ms | 565 ms |

No se midió el primer pintado. La segunda muestra descarta que el retraso
ocurriera exclusivamente en la primera apertura de este archivo, pero no
identifica su causa. Se mantiene pendiente investigar el rendimiento inicial.
No se modificó el código ni la configuración de Windows para esta repetición.

Se encontraron 71 originales, 71 miniaturas y siete páginas del visor, todos
no vacíos; página 71/71 cargada a 2400 × 1689 y sin errores ni advertencias.
El worker anterior (PID 2928) y su directorio temporal ya no existían.
El nuevo worker (PID 7052) usaba 152,6 MiB residentes y 21,0 MiB privados
comprometidos. El renderer bajó de 766,3 a 391,0 MiB residentes, con 71,9 MiB
privados comprometidos; la suma de working sets fue 1281,9 MiB. Esta reducción
demuestra liberación de memoria residente entre estas muestras, sin constituir
una prueba general de ausencia de fugas.

Sesión: `08e03508-d4d8-4ca1-ac38-4e8b90d86800`. Evidencia:
`test-results/windows10/manual/cbt-repeat-review/`.

### Windows 10 — ACE/CBA

El usuario avisó tras la prueba solicitada con `Prueba ACE.cba`, copia de
`abydos.cba` (180.457 bytes, dos imágenes), sin reportar fallos. La inspección
encontró la página 2/2 cargada a 800 × 600 y las dos miniaturas presentes.

- Dos originales, dos miniaturas y dos páginas del visor generadas, todos no vacíos.
- Extracción completada en 7204 ms, sin errores ni advertencias. Es una demora
  relevante para esta muestra pequeña y queda registrada para la investigación
  de rendimiento; el tiempo de extracción no mide el primer pintado.
- Los eventos de cancelación y resumen posteriores al inicio de sesión y
  anteriores al arranque del worker nuevo corresponden al cierre del CBT.
- El worker CBT anterior (PID 7052) terminó y su directorio temporal ya no existe.
  En la captura no quedan procesos del helper ACE ni del decoder privado.
- Worker ACE (PID 1896): 149,1 MiB residentes, máximo 153,2 MiB y 17,2 MiB
  privados comprometidos. Ese máximo no incluye los auxiliares ya terminados.
  Renderer: 341,6 MiB residentes y 71,9 MiB privados comprometidos. Suma de
  working sets: 1222,5 MiB; puede contar páginas compartidas más de una vez.

La muestra valida este ACE concreto, no todas sus variantes. La comprobación
controlada de auxiliares bloqueados continúa acreditada solo en Windows 11.
Sesión: `fa514392-0371-4cbd-bb23-3edf536d18a7`. Evidencia:
`test-results/windows10/manual/ace-review/`.

### Windows 10 — PDF

El usuario avisó tras la prueba solicitada con `Prueba PDF.pdf`, copia de
`Esperando por los bárbaros` (973.151 bytes, 116 páginas), sin reportar fallos.
La inspección encontró la página 25/116 cargada a 1828 × 2400 y 23 miniaturas
montadas en el DOM.

- 116 miniaturas y 28 páginas del visor generadas, todas no vacías.
- MuPDF registró `warning: expected name after CMapName in cmap`, ya observada
  con este documento en Linux y Windows 11. No hay errores fatales ni se
  interrumpió la generación de miniaturas. Esta inspección no certifica la
  fidelidad de todos los caracteres de todas las páginas.
- El evento de arranque del worker aparece 3,68 s después del inicio de sesión;
  el documento se declaró abierto 215 ms después. Entre el inicio de la fase
  de preview y la de procesamiento por foco transcurrieron 379 ms. No son
  mediciones del primer pintado ni permiten atribuir la demora del arranque
  a una causa concreta.
- El worker ACE anterior (PID 1896) terminó y su directorio temporal ya no existe.
- Worker PDF (PID 5828): 134,9 MiB residentes, máximo 163,5 MiB y 24,3 MiB
  privados comprometidos. Renderer: 729,2 MiB residentes y 72,9 MiB privados
  comprometidos. Suma de working sets: 1601,0 MiB; puede contar memoria
  compartida más de una vez.

Sesión: `dcd8375c-37db-48f9-8f0f-599538875470`. Evidencia:
`test-results/windows10/manual/pdf-review/`.

### Windows 10 — EPUB

El usuario avisó tras la prueba solicitada con `Prueba EPUB.epub`, copia de
`Las puertas de Anubis` (565.185 bytes), sin reportar fallos. MuPDF lo paginó
en 488 páginas. La inspección encontró la página 16/488 cargada a 1695 × 2400
y 23 miniaturas montadas en el DOM.

- 488 miniaturas y 19 páginas del visor generadas, todas no vacías.
- Sin errores ni advertencias nuevos desde el arranque del worker EPUB.
  `warning: ... repeated 4 times...` aparece antes de ese arranque y corresponde
  al cierre del PDF anterior, como en las rondas Linux y Windows 11.
- Arranque del worker 348 ms después del inicio de sesión. Desde ese evento
  hasta `document_opened` transcurrieron 4308 ms; entre el inicio de la fase
  de preview y la de procesamiento por foco, 3282 ms. Son tiempos registrados
  del lector, no mediciones del primer pintado. Se conservan como parte de la
  investigación pendiente del rendimiento inicial en Windows 10.
- El worker PDF anterior (PID 5828) terminó y su directorio temporal ya no existe.
- Worker EPUB (PID 7164): 175,3 MiB residentes, máximo 202,3 MiB y 42,1 MiB
  privados comprometidos. Renderer: 780,5 MiB residentes y 77,8 MiB privados
  comprometidos. Suma de working sets: 1696,0 MiB; puede contar memoria
  compartida más de una vez. Se conserva esta muestra para observar el cambio
  al documento pequeño siguiente, sin inferir una fuga a partir de ella.

Sesión: `ef71999c-fd9c-4c27-bb4e-3ad4d02d4d96`. Evidencia:
`test-results/windows10/manual/epub-review/`.

### Windows 10 — XPS

El usuario avisó tras la prueba solicitada con `Prueba XPS.xps`, copia de
`test/fixtures/doc/test-5pages.xps` (2426 bytes, cinco páginas), sin reportar
fallos. La inspección encontró la página 5/5 cargada a 1600 × 2400 y las cinco
miniaturas presentes en el DOM. No se acredita el regreso al inicio a partir
de esa captura.

- Cinco miniaturas y cinco páginas del visor generadas, todas no vacías.
- Sin errores ni advertencias en el segmento de log del worker XPS.
- Arranque del worker 268 ms después del inicio de sesión. Desde ese evento
  hasta `document_opened` transcurrieron 4025 ms; entre el inicio de la fase
  de preview y la de procesamiento por foco, 3532 ms. La demora inicial también
  aparece con este documento pequeño y sigue pendiente de investigación.
  Estos intervalos no miden el primer pintado ni identifican la causa.
- El worker EPUB anterior (PID 7164) terminó y su directorio temporal ya no existe.
- Worker XPS (PID 6132): 144,6 MiB residentes, máximo 175,6 MiB y 17,8 MiB
  privados comprometidos. Renderer: 290,1 MiB residentes y 77,3 MiB privados
  comprometidos; bajó desde los 780,5 MiB residentes del EPUB. Suma de working
  sets: 1168,0 MiB, que puede contar memoria compartida más de una vez.

Sesión: `b68751cf-282f-4b75-a0e7-c814257d9910`. Evidencia:
`test-results/windows10/manual/xps-review/`.

### Windows 10 — Carpeta de imágenes

El usuario avisó tras la prueba solicitada con `Prueba carpeta imagenes`, copia
local de `La tierra errante` (110 JPEG, 346.197.646 bytes), sin reportar fallos.
La inspección encontró la página 29/110 cargada a 1731 × 2400 y 23 miniaturas
montadas en el DOM.

- 110 originales, 110 miniaturas y 30 páginas del visor generadas, todos no vacíos.
- Sin errores ni advertencias en el segmento de log de esta sesión.
- Preview copiado en 4205 ms; procesamiento de primera imagen registrado en
  285 ms. Entre los eventos `preview_ready` y `slow_preview_page` transcurrieron
  3,8 s, intervalo que no explica por completo el temporizador del procesamiento.
  La extracción posterior tardó 2921 ms. Se conserva esta diferencia para
  investigar la demora inicial, sin atribuirla todavía a una causa ni equiparar
  esos tiempos con el primer pintado de la interfaz.
- El worker XPS anterior (PID 6132) terminó y su directorio temporal ya no existe.
- Worker de carpeta (PID 1492): 152,5 MiB residentes, máximo 554,9 MiB y 20,6 MiB
  privados comprometidos. Renderer: 708,0 MiB residentes y 75,4 MiB privados
  comprometidos. Suma de working sets: 1600,3 MiB; puede contar memoria
  compartida más de una vez. El worker redujo su memoria residente tras el pico.

Sesión: `a441a5eb-4d8f-43bf-92a3-f407ebd7cf07`. Evidencia:
`test-results/windows10/manual/folder-review/`.

### Windows 10 — Siete formatos de imagen

El usuario avisó tras la prueba solicitada con `Prueba siete formatos`, copia
de `test/fixtures/image/formats` (siete archivos, 86.437 bytes), sin reportar
fallos. Incluye JPG, PNG, WebP, GIF, BMP, TIFF y AVIF. La inspección encontró
la página 7/7 (AVIF) cargada a 96 × 144 y las siete miniaturas presentes.

- Siete originales, siete miniaturas y siete páginas del visor generadas,
  todos no vacíos; sin errores ni advertencias en el segmento de esta sesión.
- Preview copiado en 4317 ms. Entre `preview_ready` y el inicio de extracción
  posterior transcurrieron 3,8 s; no se registró un evento de procesamiento
  lento de la primera imagen. La extracción posterior tardó 105 ms. Persiste
  una demora inicial incluso con estas muestras pequeñas; se inicia una
  comprobación aislada del lector para investigar su causa.
- El worker de la carpeta anterior (PID 1492) terminó y su directorio temporal
  ya no existe.
- Worker (PID 2336): 151,2 MiB residentes, máximo 155,0 MiB y 19,2 MiB privados
  comprometidos. Renderer: 712,6 MiB residentes y 75,8 MiB privados comprometidos.
  Suma de working sets: 1590,9 MiB; puede contar memoria compartida más de una vez.
  A diferencia del cambio EPUB→XPS, esta muestra no muestra una caída importante
  de memoria residente del renderer al pasar a un archivo pequeño.

Sesión: `70e38602-ee92-40f8-a27a-633b67e40144`. Evidencia:
`test-results/windows10/manual/formats-review/`. Con esta prueba termina la
ronda manual por formatos de Windows 10; no implica cerrar las observaciones
de rendimiento ni la validación controlada de cancelación pendiente en este SO.

### Windows 10 — Aislamiento inicial de la demora

Después de la ronda manual se ejecutaron secuencialmente los lectores del
portable abierto y del ZIP extraído contra la misma carpeta de siete formatos
y el mismo XPS. Se mantuvieron los parámetros de imagen de la aplicación y
se usaron salidas temporales nuevas. No se modificaron el código, el antivirus
ni la configuración de Windows. Se conservó abierta la aplicación manual.

En la primera serie, las ejecuciones completas del lector del portable tardaron
165 ms (carpeta) y 188 ms (XPS), incluido el cierre cooperativo tras recibir
preview y metadatos. Las del ZIP tardaron 12.072 ms y 1552 ms, respectivamente;
los logs sitúan la mayor parte de esa diferencia antes del evento de arranque
del lector. Las copias aisladas del JPEG de 1763 bytes tardaron entre 1,3 y
2,3 ms. Durante esa serie, `MsMpEng` acumuló 6,28 s adicionales de CPU; esta
coincidencia no demuestra que causara las esperas. El host tenía unos 5,8 GiB
de swap ocupados y una muestra breve registró actividad de lectura de swap y
espera de E/S; tampoco permite atribuirle la causa.

La segunda serie usó salidas nuevas dentro de `%TEMP%/comiscopio`, la ubicación
habitual de la aplicación. Se midió desde el lanzamiento hasta recibir el
evento de primera página lista:

| Lector | Carpeta de siete formatos | XPS |
| --- | ---: | ---: |
| Incluido en el portable | 130 ms | 162 ms |
| Extraído del ZIP | 129 ms | 169 ms |

Las cuatro ejecuciones terminaron con código 0, sin errores ni timeouts, y sus
salidas de prueba se eliminaron. Estos tiempos no incluyen renderizado Electron.
En el primer script, el campo `firstReadyMs` quedó sobrescrito por el campo
`ms` del evento del worker y no sirve como tiempo desde el lanzamiento. La
segunda serie lo corrige con `receivedMs`; se conserva la primera evidencia y
solo se usan de ella los tiempos totales y logs válidos.

A continuación se repitieron las aperturas mediante drag-and-drop automatizado
en la aplicación ya abierta, XPS y después la carpeta. Se detectó una imagen
cargada del documento nuevo a los 538 ms y 696 ms, respectivamente, sin errores
JavaScript. Esto mide disponibilidad en el DOM, no presentación física en
pantalla. La carpeta restaura la página 7 tras el preview; la captura inmediata
coincidió con esa transición y mostró anchura 0 en la imagen restaurada, por
lo que esos 696 ms no acreditan que AVIF ya estuviera estable. El log posterior
registra su procesamiento sin error. En estas aperturas, el XPS pasó de arranque
a documento abierto en 13 ms y de preview a procesamiento por foco en 90 ms;
la carpeta copió el preview en 5 ms y procesó la primera imagen en 172 ms.

La demora dejó de reproducirse en esta repetición sin aplicar una corrección.
No se considera resuelta: falta aislar las condiciones de las aperturas lentas
y de las rápidas antes de atribuirlas a caché, antivirus, VM o código.
Evidencia, incluidos los scripts temporales de medición:
`test-results/windows10/windows10-performance-isolation/`,
`test-results/windows10/windows10-performance-isolation-repeat/` y
`test-results/windows10/windows10-performance-ui/`.

La inspección final confirmó AVIF (página 7/7) cargado a 96 × 144, siete
originales, siete miniaturas y cuatro páginas del visor generadas según la
navegación de esta reapertura, sin archivos vacíos. El worker y los temporales
de la sesión manual inicial de siete formatos ya no existían. El renderer
usaba 285,4 MiB residentes, frente a 712,6 MiB en la inspección previa a estas
mediciones. Evidencia: `test-results/windows10/manual/formats-afterperf-review/`.

### Windows 10 — cierre y cancelación controlada completados

Se incorporó al repositorio `test/integration/windows-processes.test.cjs`, con
un helper de prueba y un descendiente que permanecen bloqueados. Ambos casos
pasaron sobre el ZIP 0.2.0 corregido usado en la ronda manual, sin MSYS2 en PATH:

- Terminación forzada del worker: ambos auxiliares desaparecieron en 31 ms.
- Cierre de la última ventana durante extracción ACE bloqueada: cierre,
  terminación de auxiliares y eliminación del directorio de lectura en 2220 ms.

Se probó también el EXE portable exterior con perfil nuevo, apertura de ACE,
navegación a la segunda página y cierre. Terminó el lanzador y se eliminaron
los temporales. Primera imagen a los 86.230 ms y prueba completa en 88.544 ms;
esa demora se conserva como observación, sin continuar su investigación por
instrucción del usuario. La comprobación de la sesión manual antigua no pudo
usarse porque sus PID/directorio ya no coincidían con el estado esperado; ese
fallo de precondición se conserva y no se cuenta como prueba de cierre.

La primera pasada de la suite de artefactos alcanzó el límite interno de 20 s
del CB7 sintético de 480 MiB mientras seguía extrayendo. Se amplió solo la espera
de ese fixture a 60 s para extracción/miniaturas, dentro de 180 s totales;
la repetición pasó 23 pruebas de lectores con 12 omisiones propias de Linux.
La interfaz detectó después una carrera del controlador de pruebas: al cerrar,
Electron destruía el contexto antes de responder a `page.evaluate`. Se admite
esa desconexión esperada y se mantienen obligatorias las comprobaciones de
salida y limpieza. No se modificó el lector para resolver estos dos fallos del
harness. La suite completa corregida se ejecuta sobre los paquetes 0.3.0.

Evidencia: `test-results/windows10/windows10-final-artifact-tests/`,
`windows10-final-artifact-tests-retry/`, `windows10-final-process-tests/`,
`windows10-manual-portable-close/` y `windows10-portable-final-close/`, todos
bajo `test-results/windows10/`. El helper C# se compila únicamente como fixture
con el compilador de .NET Framework del sistema; no forma parte del producto.

## Paquetes finales 0.3.0

Se generaron el EXE portable y el ZIP después de actualizar la versión a 0.3.0.
La compilación de Angular/Electron y las unitarias en Windows 11 finalizaron
correctamente: 100 pruebas aprobadas y cinco comprobaciones `ldd` exclusivas
de Linux omitidas. Los lectores nativos son los actualizados y validados
durante la ronda anterior; no se cambiaron para esta reconstrucción.

| Archivo | SHA-256 |
| --- | --- |
| `Comiscopio 0.3.0.exe` | `415dcc844e69846083de4ebf8f8b499dc66c6b7e8cec938d6de0805163295e69` |
| `Comiscopio-0.3.0-win.zip` | `327dc9d964a23516fed800e04cb80fcd3e709df2454638eedb5a3b8443f791c4` |

Copias locales: `release/0.3.0-windows/`. El EXE no contiene firma de código.
La suite extrae un ZIP nuevo y utiliza un PATH sin MSYS2 para comprobar que
los paquetes llevan sus dependencias. También verifica 0.3.0 en el ejecutable
y en «Acerca de».

### Windows 11

La última ejecución completa aprobó:

- 23 pruebas de lectores; 12 casos exclusivos de Linux omitidos.
- Dos pruebas de interfaz sobre el ZIP extraído.
- Dos pruebas con auxiliares bloqueados: terminación forzada del worker y
  descendientes en 26 ms; cierre de última ventana y limpieza en 1708 ms.
- EXE portable exterior: apertura ACE, navegación, versión y cierre con
  eliminación de temporales. Primera imagen a los 100.269 ms; prueba completa
  en 103.232 ms. La demora queda documentada, sin atribuir causa ni corregirla.

Se conservan los intentos fallidos anteriores. El primer CBZ superó 20 s sin
emitir eventos; la espera inicial en Windows se amplió a 120 s, manteniendo
las comprobaciones de navegación y cierre. Otra pasada dejó el controlador
de interfaz sin completar y procesos de la aplicación vivos; no se estableció
su causa. Un error `EPERM` al borrar la extracción temporal ocultaba el error
original. El harness ahora registra estado, señal, PID y duración de cada
subproceso, conserva el fallo original y, ante un fallo, termina únicamente
los procesos cuyo ejecutable pertenece a su extracción temporal. La limpieza
de una ejecución satisfactoria sigue siendo obligatoria. La repetición completa
en una extracción nueva pasó; esto no demuestra la causa del bloqueo anterior.

Evidencia: `test-results/windows11/windows11-0.3.0/`; resultados satisfactorios
en `tests-second-retry/`, incluidos `completed.json`, `portable.json` y
`zip-processes/results.json`.

### Windows 10

Se probaron los mismos EXE y ZIP de Windows 11, sin recompilarlos; sus hashes
se verificaron antes de ejecutar las pruebas. La suite completa aprobó en la
primera pasada de estos paquetes 0.3.0:

- 23 pruebas de lectores, sin fallos y con 12 omisiones exclusivas de Linux
  (62,2 s en total).
- Dos pruebas de interfaz: formatos, progreso, reutilización de ventana,
  rechazo ACE, versión y limpieza al cerrar (35,3 s en total).
- Dos pruebas de procesos bloqueados: terminación forzada del worker y
  descendientes en 31 ms; cierre de última ventana y limpieza en 1675 ms.
- EXE portable exterior: ACE, navegación, «Acerca de» 0.3.0 y cierre limpio.
  Primera imagen a los 69.884 ms; prueba completa en 76.409 ms. Se conserva
  esta demora como observación pendiente, sin investigar ahora su causa.

Evidencia: `test-results/windows10/windows10-0.3.0/`, incluidos los hashes,
`status.txt` con `Completed`, `tests/completed.json`, `tests/portable.json`
y `tests/zip-processes/results.json`. Los paquetes probados están en
`release/0.3.0-windows/`, con `SHA256SUMS.txt` local. Estos resultados locales
no equivalen a una ejecución del workflow actualizado en GitHub Actions.

## Referencias de implementación

- [Guía de compilación Windows](windows.md).
- [Dependencias opcionales y módulos de libvips en MSYS2](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-libvips).
- [Conversión de rutas del runtime Cygwin/MSYS2](https://www.cygwin.com/doc/preview/cygwin-api/func-cygwin-conv-path.html).
