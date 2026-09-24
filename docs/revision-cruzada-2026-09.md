# Revisión cruzada de observaciones, cambios y pruebas

Seguimiento de los arreglos y actualización: [validación Linux](validacion-linux-2026-09.md).
Este documento conserva la evidencia de la revisión anterior.
El estado actualizado, tras las correcciones y las rondas Windows, está en la
[revisión final de 0.3.0](revision-final-0.3.0.md). Los pendientes descritos más
abajo corresponden a la fecha de esta revisión histórica.

Fecha: 22 de septiembre de 2026, hora de Lima. Base de comparación: `HEAD d37af41`.
Se recuperó el texto de los nueve hallazgos y los cinco pasos propuestos en esta
conversación; se contrastó con Git, código actual, decisiones Markdown y pruebas.

**Resultado: los nueve hallazgos originales estaban fundamentados, pero la
implementación y su validación todavía no están completas.** Hay dos regresiones
reproducidas en los cambios y dos huecos existentes que impiden cerrar por completo
los temas de errores de página y comprobaciones. Las pruebas aprobadas anteriores
siguen siendo evidencia válida para los casos que cubren, no una garantía general.

Esta revisión no modifica código de producto, no continúa la ronda manual pendiente
ni realiza publicaciones. Los diagnósticos añadidos están en `test-results/cross-review/`
y `/tmp/comiscopio-cross-review/`, fuera de los artefactos de distribución.

## 1. Trazabilidad de los nueve hallazgos originales

| # | Observación original | Contraste con cambios y evidencia | Estado real |
|---|---|---|---|
| 1 | SQLite podía borrar DB/WAL/SHM por cualquier error; no examinaba el resultado del chequeo. | `Database.initialize()` comprueba `quick_check`, cierra y propaga el error sin borrar. Tres pruebas con SQLite real verifican persistencia, archivo inválido y bloqueo. | El riesgo de borrado está corregido. Se optó por conservar y detener el inicio; **no** se implementaron copia de recuperación ni reparación/reintento automático. Es una diferencia respecto de la propuesta inicial, no una recuperación completa. |
| 2 | Aperturas asíncronas podían sobrescribir el archivo siguiente; el reintento de página invalidaba su propio token. | El visor comprueba generación/sesión tras esperas y conserva el token del reintento. Hay regresiones para settings, progreso, manifest y disponibilidad tardía. | Los casos originales están corregidos, pero la reapertura simultánea del mismo archivo todavía puede cerrar la sesión vigente: R2. |
| 3 | El worker compartido enviaba eventos a una sola ventana y el cierre no respetaba propiedad. | `windowSessions` reserva propietario, enfoca la ventana existente y filtra eventos/focus/cierre por propietario/sesión. La prueba empaquetada abre dos ventanas y comprueba la reutilización. | La decisión acordada está implementada. La prueba cubre una sesión ya establecida, no todas las carreras durante su creación: R2. |
| 4 | Una página corrupta no anunciaba su placeholder; el visor confundía errores de página y sesión. | Workers de archivos/documentos emiten `ready` tras generar el placeholder. El visor mantiene la lectura ante errores con índice de página. Se corrigió además la codificación del placeholder. | La ruta de página completa funciona en las pruebas. La miniatura de fondo dañada aún se anuncia sin existir: H1. Falta cobertura equivalente de una página PDF dañada. |
| 5 | La cola consumía una miniatura antes de comprobar memoria. | `WorkQueue::next()` no avanza hasta marcar el trabajo terminado. CTest comprueba aplazamiento y prioridad. La retención de JPEG progresivos se corrige desalojando operaciones bajo presión y restaurando el límite normal de caché. | Corregido y comprobado en Linux con seis JPEG de 25 MP y CBZ reales. No equivale a limitar el pico a 320 MiB ni a demostrar el mismo comportamiento en Windows. |
| 6 | El orquestador devolvía PASS aunque faltaran workers; faltaban pruebas de Electron y extracción ACE. | El orquestador principal ahora falla con binarios ausentes. Se agregaron SQLite real, diez pruebas de lectores, CBA real, prueba de interfaz y CTest en el build. | Mejorado, pero `check-deps.sh` mantiene un falso PASS: H2. CI no ejecutado y artefactos finales no probados. |
| 7 | Desarrollo/bundle podían usar binarios o bibliotecas anteriores. | El bridge prioriza builds locales recientes; las bibliotecas del bundle Linux se reconstruyen en un directorio limpio. Windows ensambla en staging antes de reemplazar el bundle. | Corregido el mecanismo señalado. La caché de la imagen Docker y las versiones apt aún requieren una política explícita para actualizar/reproducir dependencias. |
| 8 | Carpetas se enviaban a RAR; DjVu se anunciaba sin decoder registrado. | Se añadió backend de carpetas con recorrido, orden natural, filtrado y protección de origen. Prueba con BMP, Unicode, subcarpetas y página dañada. DjVu sigue delegado a MuPDF y documentado como no confirmado. | Carpetas implementadas; falta prueba manual y cobertura de más formatos de imagen. DjVu se mantiene por decisión del usuario, **sin afirmar soporte efectivo**. |
| 9 | Windows no atendía focus/quit; faltaban espera, memoria, ACE, build y recursos nativos. | Entrada JSON no bloqueante compartida, APIs Windows, proceso ACE aislado, UCRT64/MSYS2, fuentes CMake directas, DLL/recursos y scripts nuevos. En Windows 11 compilaron los cuatro binarios y pasaron dos CTest. | Adaptación compilada; falta ejecutar lectores/app/portable, probar Unicode/cierre/memoria y validar Windows 10 limpio. Compilar no permite declarar soporte terminado. |

## 2. Problemas confirmados durante esta revisión

### R1 — Regresión: cancelación de ACE puede dejar procesos vivos en Linux

Prioridad alta. [Bridge](../electron/native-worker-bridge.ts), `closeSession()`,
actualmente envía `quit` y tras 1,5 segundos fuerza `SIGKILL` al worker.
El worker lee ese comando después de la extracción; mientras `AceBackend::open()`
espera al helper, no lo procesa. El helper Linux tiene un grupo de procesos separado,
y matar únicamente al worker impide ejecutar su limpieza cooperativa.

Reproducción controlada: se sustituyó el helper mediante la variable de entorno
prevista por un proceso de prueba lento. Con `quit` y posterior `SIGKILL`, el worker
terminó con -9 y el helper seguía vivo. Como control, enviando `SIGTERM` al mismo
worker, el helper terminó. Se limpiaron los procesos de prueba.

No se utilizó una muestra ACE grande real para esta reproducción. Lo demostrado
es el defecto del ciclo de vida mientras el helper está ocupado, no una medición
de rendimiento del decoder. Windows usa un Job Object; no se le atribuye esta
regresión Linux sin probarlo.

Pendiente: cierre cooperativo durante extracción y terminación garantizada del árbol,
con una prueba que cancele durante el trabajo, no únicamente después de renderizar.

### R2 — Regresión: dos aperturas rápidas del mismo archivo pueden cerrar su worker

Prioridad alta. [Visor](../src/app/components/viewer/viewer.component.ts),
`openFile()`, rama `superseded-open`, y [reserva en main](../electron/main.ts).

Secuencia reproducida con respuestas controladas:

1. La primera petición reserva una sesión nueva; su respuesta se retrasa.
2. La segunda petición del mismo archivo recibe y adopta esa misma sesión como `alreadyOpen`.
3. Llega la respuesta de la primera petición y el visor la considera reemplazada.
4. Envía `workerClose` para la sesión que acaba de adoptar la petición vigente.

La prueba nueva falla porque observa exactamente ese cierre. El filtro de sesión
en main no lo evita: ambas respuestas tienen el mismo identificador legítimo.
La prueba anterior de dos ventanas pasa porque opera sobre una sesión ya abierta.

Pendiente: deduplicar las aperturas en curso o no cerrar una sesión adoptada por
la petición vigente; comprobar también órdenes inversos de respuesta. No se afirma
que esta carrera concreta causara el incidente manual de vista previa.

### H1 — Hueco del hallazgo 4: miniatura dañada anunciada sin archivo

Prioridad media. En la rama de fondo del [worker](../native/worker/src/app/main.cpp),
se emite `progress(stage=thumb)` y se marca la página aunque falle la generación.

Reproducción: carpeta con primera imagen válida y segunda JPEG corrupta, ventana
prioritaria de cero vecinos. El evento anunció `thumbs/000001.jpg`, pero ese archivo
no existía. Al pedir después la segunda página en primer plano, se generaron tanto
el placeholder de lectura como su miniatura. La rama equivalente del doc-worker
presenta el mismo patrón por inspección; no se reprodujo con PDF corrupto.

Pendiente: anunciar disponibilidad solo después de escribir el artefacto, o generar
un placeholder de miniatura y registrar el error. La prueba actual usa una primera
página corrupta y solicita las demás, por lo que no detectaba este caso de fondo.

### H2 — Hueco del hallazgo 6: comprobación de dependencias con cero binarios

Prioridad media. [check-deps.sh](../test/ldd/check-deps.sh) recorre `bin/*` y termina
con éxito si no encuentra dependencias faltantes, aunque no haya comprobado ningún
binario. Reproducción: `bin/` vacío devuelve `OVERALL: PASS` y salida 0.

Como control, el orquestador corregido `run-worker-tests.sh` sobre el mismo directorio
sí devuelve `OVERALL: FAIL` y salida 1. No se debe confundir el arreglo de un script
con el cierre de todos los mecanismos de validación.

Pendiente: exigir los ejecutables esperados y tratar los fallos no clasificables de
`ldd` como errores; conectar esta comprobación al workflow si será un control requerido.

## 3. Mejoras surgidas durante las pruebas manuales

| Mejora | Evidencia y límite |
|---|---|
| Fin del scroll de miniaturas | Prueba de interfaz falló antes y pasó después; se conservaron filas virtuales reales, sin relleno que extendiera el scroll. |
| Rueda tras arrastrar la barra | Se reprodujo que la rueda cambiaba la página del visor y recentraba el panel. Se detiene la propagación del panel; prueba antes/después y comprobación manual. |
| Caché JPEG / miniaturas pausadas | La corrección de la cola dejó visible una retención antes ocultada por el salto de tareas. Prueba sintética falló antes y pasó después del desalojo seguro de caché; dos CBZ manuales, incluido estrés. No se usa `vips_cache_drop_all()`. |
| Drag-and-drop | Registro nativo sin `drop`, ajuste temporal `pointer-events: none`, confirmación manual y cambio permanente sin handlers duplicados. La prueba automatizada de drop **también pasaba antes**: comprueba el funcionamiento, pero no reproduce por sí sola el fallo nativo del escritorio. |
| Primera página tardía | Dos pruebas controladas fallaron antes y pasaron después: `ready` tras expirar el sondeo y respuesta antigua al reabrir el mismo archivo. No prueban que todos los fallos de apertura estén eliminados; R2 es un caso distinto. |
| BMP en bundle Linux | Se incluyeron módulos ImageMagick cargados dinámicamente que `ldd` no enumera. El fixture BMP funciona con las bibliotecas del paquete. No prueba automáticamente todos los plugins/formatos anunciados. |
| Memoria tras estrés | Worker del primer CBZ: pico 635,9 MiB y 71,1 MiB al finalizar; segundo: pico 184,4 MiB y 26,8 MiB en reposo. Toda la app: 356,4–357,8 MiB PSS durante 20 segundos. Es una observación acotada, no una certificación de ausencia de fugas. |

## 4. Dependencias y observaciones secundarias

- JavaScript: Electron 41→44, SQLite 12→13 y actualizaciones compatibles de Angular
  21, TypeScript, Vitest y empaquetado están implementadas. Angular 22 no era un
  requisito: se autorizó migrar de versión mayor cuando resultara necesario.
- Se retiraron `7zip-bin`, `adm-zip`, `node-7z`, `node-unrar-js`, `pdfjs-dist`,
  `image-size` y tipos asociados sin uso en el pipeline actual. La prueba empaquetada
  ejercita los lectores nativos tras retirarlos.
- `npm audit` consultado de nuevo en esta revisión: **0 vulnerabilidades reportadas**.
  Eso corresponde al lockfile npm; no audita bibliotecas C/C++, binarios ni DLL.
- El lockfile contiene variantes opcionales Linux/Windows de Rollup y esbuild.
  `npm ci` funcionó en la preparación Windows; sigue pendiente validar la ejecución
  completa con el snapshot final de fuentes/lockfile y en GitHub.
- 7-Zip SDK 26.03 está incorporado con procedencia/hash. El lector sigue usando
  `SzArEx_Extract` y su buffer de bloque sólido: falta medir un 7z sólido grande.
- Las bibliotecas Linux no se han migrado a las ramas nativas recientes. Consulta
  del builder real: libvips `8.12.1-1build1`, libarchive `3.6.0-1ubuntu1.8`, MuPDF
  `1.19.0+ds1-2`, UnRAR `1:6.1.5-1ubuntu0.1`. Mantener glibc 2.35 no obliga a
  mantener todas esas versiones; la estrategia de actualización sigue pendiente.
- `native/deps/versions.env` dice UnRAR 5.6.6, pero el builder usa 6.1.5. También
  presenta Ubuntu 22.04 como fijación de todas las versiones apt: una etiqueta
  mutable y paquetes sin versión explícita no garantizan esa reproducibilidad.
- ACE: hay rechazo de rutas peligrosas y límites de longitud de rutas. **No hay aún
  límites explícitos de cantidad de entradas ni tamaño descomprimido por entrada**,
  ni fixtures negativos que demuestren todos los rechazos previstos en los planes.
- Atajos personalizados: `keybindings` se añadió a valores predeterminados y la
  prueba SQLite confirma que sobrevive a guardar/cerrar/reabrir.
- Metadatos de versión: se generan desde `package.json`; hay comprobación de tag.
  Persisten tipos/canales antiguos sin consumidores, como `PageData`, `OpenFileSession`
  y `REQUEST_PAGE_PATH`. Su limpieza es deuda menor, no causa demostrada de un fallo.
- El paquete Linux ahora incluye `uninstall.sh`; se comprobó la configuración,
  no se ejecutó la desinstalación sobre los datos del usuario.

## 5. Propuesta de avance: grado de cumplimiento

| Paso original | Estado |
|---|---|
| 1. Corregir hallazgos prioritarios con regresiones | Avanzado, pero deben cerrarse R1/R2/H1/H2. |
| 2. Actualizar por grupos y validar localmente | JavaScript y SDK actualizados; Linux probado en varios niveles. Bibliotecas nativas Linux y validación Windows incompletas. |
| 3. Endurecer release Linux / lockfile / controles | `npm ci`, comprobación de versión, CTest, SQLite e interfaz incluidos en el borrador. No se ha ejecutado en Actions; faltan controles de portabilidad y artefacto final. |
| 4. Windows 10/11 x64 portable con ACE | Build nativo Windows 11 completado. Falta ejecución/paquete/entorno limpio/Windows 10; no hay aprobación de soporte terminado. |
| 5. Pruebas Actions y publicar lo probado | Workflow redactado; no ejecutado. Publicación bloqueada por instrucción expresa del usuario. |

La prueba de interfaz usa `linux-unpacked`/`win-unpacked`. No abre el AppImage,
ni extrae el ZIP generado, ni arranca el EXE portable autoextraíble. Por tanto,
"publicar exactamente lo probado" aún no está verificado hasta el contenedor
final. En CI Linux se lanza `comiscopio.bin`, que además evita el wrapper usado
normalmente. Los empaquetados se hacen con `--publish never`, y el job final espera
los dos sistemas; esto está bien separado, pero no reemplaza la prueba pendiente.

Faltan también cobertura de interrupción durante extracción, XPS, 7z sólido grande,
carpetas/formatos de imagen adicionales y pruebas de Windows sin depender de las
herramientas instaladas para compilar. No deben darse por cubiertos por el conteo
actual de pruebas.

## 6. Documentación y precisión de lo informado

`README.md`, `docs/windows.md` y el registro de septiembre explican el trabajo en
curso. Los documentos locales históricos conservan contradicciones sin identificar
suficientemente: `CLAUDE.md` describe extractores/Web Workers retirados;
`checklist.md` todavía marca borrar/recrear SQLite y Windows como completados.
Parte de esos Markdown está ignorada por Git. Deben conservarse como historia,
con una indicación clara de qué decisiones fueron sustituidas y dónde está el
estado vigente; no conviene borrar su contexto.

Los informes de memoria originales se sostienen con los logs y las mediciones de
procesos. Los eventos detallados del renderer están desactivados en el paquete
por `isDev`, así que un `preview_ready` del worker no demuestra que el usuario
viera la imagen: para esa afirmación se usó la confirmación visual del usuario.
Se debe mantener esa distinción al investigar carreras intermitentes.

La descripción/topics/etiquetas de GitHub siguen pendientes. No hubo commits,
push, tags ni nuevas publicaciones. La versión del proyecto continúa en 0.2.0.

## 7. Evidencia de esta revisión y siguiente orden

Evidencia local, ignorada por Git: `test-results/cross-review/results.json`,
`npm-audit.json`, `session-reuse.test.ts`, `check-ace-cancel.py` y
`check-damaged-thumb.py`. La prueba de sesión está deliberadamente en rojo para
mostrar el problema actual; no forma parte del conteo previo de 93 aprobadas.
No se repitieron suites completas ya aprobadas sin cambios ni se alteró la ventana
que usa el usuario.

Orden propuesto antes de retomar la ronda pendiente:

1. Corregir y cubrir R1 y R2, porque afectan cierre de procesos y aperturas.
2. Completar H1 y H2 para que los estados de página y los controles sean fiables.
3. Resolver el alcance pendiente de límites ACE y actualización nativa Linux;
   dejar explícitas las limitaciones que se acuerde diferir.
4. Volver a la validación manual por formato y después Windows 11/10, uno por vez.
5. Cerrar pruebas de contenedores finales, Actions, documentación y metadatos GH.
   Publicar únicamente con autorización posterior; actualmente sigue prohibido.
