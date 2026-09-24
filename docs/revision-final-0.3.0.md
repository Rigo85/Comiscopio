# Revisión final para Comiscopio 0.3.0

Preparación, validación y publicación del 23–24 de septiembre de 2026.
Después de las pruebas locales y de GitHub Actions, el usuario autorizó
expresamente el tag y la publicación. [Comiscopio 0.3.0 está publicado](https://github.com/Rigo85/Comiscopio/releases/tag/v0.3.0),
con [notas de versión](releases/v0.3.0.md) y cuatro paquetes verificados.

## Decisiones y trazabilidad

| Tema | Cambio y evidencia | Alcance o pendiente |
| --- | --- | --- |
| SQLite | `quick_check`, conservación de DB/WAL/SHM ante fallos; tres pruebas de persistencia, archivo inválido y bloqueo. | No se añade reparación automática. |
| Aperturas y ventanas | Generaciones, adopción de sesiones y reserva del propietario; regresiones unitarias y prueba de reutilización de ventana. | Se activa la ventana existente al abrir el mismo archivo. |
| Páginas dañadas | Marcadores del visor y miniaturas de fondo, en archivos y documentos; fixtures JPEG/XPS dañados. | DjVu permanece delegado a MuPDF sin soporte efectivo confirmado. |
| Cola y memoria | Trabajos aplazados sin perderse y desalojo acotado de caché; JPEG grande, CBZ reales y observaciones entre archivos. | Los datos no prueban ausencia general de fugas ni fijan un techo de RAM. |
| Scroll y drag-and-drop | Pruebas de interfaz y ronda manual Linux/Windows; la rueda del panel solo desplaza miniaturas. | La prueba automatizada de drop no reproduce todas las condiciones del escritorio. |
| Carpetas y codecs | Backend de carpetas, orden natural, Unicode y módulos BMP/AVIF incluidos; siete formatos probados. | Rondas manuales completadas en Linux, Windows 11 y Windows 10. |
| CB7 sólido | Una decodificación compartida entre preview y extracción; fixture de 480 MiB y cómic real. | La prueba grande dispone de una espera acorde con su tamaño. |
| ACE | Límites aprobados de 10.000 entradas, 512 MiB por entrada y 8 GiB totales; CBA real y pruebas de rechazo. | Decoders simulados y declaraciones falsas se prueban en Linux; no certifica todas las variantes ACE. |
| Cierre | El bridge espera procesos y borrados pendientes al salir; prueba de última ventana. | Controles de auxiliares bloqueados aprobados en Windows 10/11 e incorporados a la suite persistente. |
| Dependencias y build | Angular 22, Electron 44, SQLite 13, SDK 7-Zip 26.03 y lectores actualizados; Linux con ABI Ubuntu 22.04 y Windows UCRT64. | MSYS2 instala paquetes actuales y registra sus versiones; no garantiza builds idénticos entre fechas. |
| Sobreingeniería | Limpiezas menores registradas en la revisión específica. | Diferidas por decisión del usuario. |

Las regresiones R1/R2 y los huecos H1/H2 de la revisión cruzada histórica se
corrigieron durante la validación Linux; los detalles y pruebas están en los
registros enlazados abajo. No se reescribe la evidencia histórica como si esos
problemas nunca hubieran existido.

## Versión, pipeline y GitHub

La versión aprobada es **0.3.0**. `package.json` es la fuente para `package-lock.json`,
los metadatos generados y «Acerca de». Electron Builder toma esa versión para
los ejecutables y nombres de paquetes. La prueba empaquetada contrasta la versión
del ejecutable y la mostrada en «Acerca de». Ambos jobs validan la coincidencia
del tag con `v0.3.0` al preparar esa publicación.

Linux y Windows compilan desde fuentes en GitHub Actions. Las pruebas Windows
extraen el ZIP y verifican lectores, interfaz y cancelación; después abren el
EXE portable real y comprueban el cierre y los temporales. Linux verifica su
AppImage y tar.gz. Los paquetes solo se entregan tras pasar las pruebas; la
fase de publicación depende del éxito de ambos jobs. No se suben builds locales
como sustituto de esa compilación en CI.

Se actualizó la descripción pública del repositorio y se añadieron los topics
`comic-reader`, `manga-reader`, `electron`, `angular`, `cpp`, `linux`, `windows`,
`pdf`, `epub`, `cbz` y `cbr`. Se revisaron las etiquetas de issues existentes;
se conservaron las categorías estándar, sin crear duplicados ni issues.

El commit `8e3b6cb928347a5ce2399c08e53f483228863676` se subió a `master`.
La [ejecución 35953364173 de GitHub Actions](https://github.com/Rigo85/Comiscopio/actions/runs/35953364173)
terminó con éxito: Linux en 12 min 25 s y Windows en 13 min 38 s. Ambos jobs
compilaron desde fuentes, ejecutaron sus pruebas y guardaron los paquetes y
diagnósticos. El job `release` se omitió porque la ejecución vino de un push
de rama. En ese momento el último release publicado era `v0.2.0`.

Se descargaron los diagnósticos a `test-results/ci/35953364173/`. El control
del portable Windows registró 20.311 ms hasta la primera imagen y cierre
correcto; este resultado en `windows-2022` no determina la causa de las demoras
locales ni reemplaza la ronda manual Windows 10/11. La comprobación del tag
y la publicación no se ejecutaron en esa primera pasada.

### Publicación autorizada de v0.3.0

El tag anotado `v0.3.0` apunta al mismo commit probado, `8e3b6cb`; el commit
posterior `09cd5c4` solo registraba el resultado de CI en la documentación.
La [ejecución del tag, 35955995838](https://github.com/Rigo85/Comiscopio/actions/runs/35955995838),
volvió a compilar y probar todo: Linux aprobó en 12 min 13 s, Windows en
13 min 6 s y publicación en 43 s. Esta vez ambos controles de versión del
tag se ejecutaron y aprobaron. El release es público, estable y no es borrador.

Se descargaron los cuatro paquetes desde el release y se contrastaron sus
SHA-256. GitHub sustituyó el espacio del nombre del portable por un punto;
el listado original conservaba el espacio. Se corrigieron `SHA256SUMS.txt`
y las notas publicadas para usar `Comiscopio.0.3.0.exe`, manteniendo intactos
los binarios. El workflow de `master` ahora cambia los espacios por puntos
antes de calcular hashes y subir los archivos. Esta corrección posterior se
validó con `actionlint` y ejecutando su bloque de nombres/hashes con archivos
temporales; no se altera el tag publicado ni se atribuye esa corrección al
workflow original del tag.

| Descarga publicada | SHA-256 |
| --- | --- |
| `Comiscopio-0.3.0.AppImage` | `3ea6cb8e4c03ad9b6e67cae49f49c4f51078594bdfa9bcae13df8ad2381db0cd` |
| `comiscopio-0.3.0.tar.gz` | `781f95c69043420b07968e83cb8ae3b72aad9e48fa4baecb9689dfb1b08a04fe` |
| `Comiscopio.0.3.0.exe` | `4d817cc017a68d75dd93717f9bc2e179e915ec7bf87f88f38db3c7a98931319e` |
| `Comiscopio-0.3.0-win.zip` | `69bbaf3884a91e1ff7b74f013372fd7898ccb469d10fd392a685148b5723241b` |

Estos hashes corresponden a la compilación de publicación en GitHub y no
sustituyen los de los builds locales anteriores. Descargas verificadas en
`release/0.3.0-published/`; informes y evidencia en
`test-results/ci/35955995838/`.

## Observaciones conservadas

Por instrucción del usuario, la lentitud inicial observada en Windows queda
documentada y no se continúa investigando ahora. Hubo aperturas lentas en
Windows 10 y Windows 11; algunas repeticiones fueron rápidas sin cambios.
El control final del portable 0.3.0 registró unos 100 s en Windows 11 y 70 s en
Windows 10 hasta la primera imagen. La virtualización es una hipótesis, no una causa
demostrada. Esta observación no se marca como corregida.

## Evidencia

- [Validación Linux](validacion-linux-2026-09.md).
- [Validación Windows](validacion-windows-2026-09.md).
- [Revisión cruzada histórica](revision-cruzada-2026-09.md).
- [Sobreingeniería diferida](revision-sobreingenieria-2026-09.md).

Controles finales ya completados:

- `actionlint` 1.7.12: workflow válido sin diagnósticos. Se verificó el checksum
  oficial de la herramienta, usada desde `/tmp`, sin añadir dependencia al proyecto.
- Linux 0.3.0: 105 unitarias, 35 de lectores y dos de interfaz en cada paquete
  AppImage/tar.gz. Incluyen versión en «Acerca de» y cierre sin temporales.
- Windows 11 0.3.0: 100 unitarias aprobadas y cinco omisiones Linux; en el ZIP,
  23 pruebas de lectores aprobadas, 12 omisiones Linux, dos de interfaz y dos
  de cierre/cancelación con procesos bloqueados. El EXE portable exterior
  también pasó apertura, navegación, versión y cierre sin temporales. Los
  intentos fallidos previos y los ajustes del harness se conservan en el registro.
- Windows 10, paquete corregido previo 0.2.0: cancelación forzada y cierre con
  auxiliares bloqueados aprobados; portable exterior con ACE y cierre limpio.
- Windows 10 0.3.0: los mismos EXE/ZIP de Windows 11, con hashes verificados.
  Pasaron 23 pruebas de lectores (12 omisiones Linux), dos de interfaz, dos
  de procesos bloqueados y el control del portable exterior. Cierre y limpieza
  correctos; lentitud inicial conservada como observación.

Los hashes y los intentos previos están en los registros de validación de cada
plataforma. Los paquetes finales locales están en `release/0.3.0-linux/` y
`release/0.3.0-windows/`, cada uno con su `SHA256SUMS.txt`. La preparación y las
pruebas locales de esta etapa terminaron, y las ejecuciones del workflow de rama
y de publicación en GitHub también pasaron. El release 0.3.0 quedó publicado
con autorización. La lentitud Windows y las simplificaciones menores quedan
documentadas y diferidas por decisión del usuario.
