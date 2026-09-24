# Windows: compilación y validación local

Objetivo: Windows 10 22H2 y Windows 11, x64, portable `.exe` y `.zip`.
La ronda manual por formatos está completada en ambos sistemas. La versión
0.3.0 está en preparación; el estado de los paquetes, controles automáticos y
observaciones está en la [validación Windows](validacion-windows-2026-09.md)
y la [revisión final](revision-final-0.3.0.md).

## Entorno de compilación

- Node.js 24.18.1 x64 y npm 11.16.0.
- Python 3 y Visual Studio 2022 Build Tools con **Desktop development with C++**,
  incluidos MSVC y Windows SDK. SQLite 13 se compila desde fuente; MSYS2 por sí
  solo no reemplaza las herramientas que necesita `node-gyp`.
- MSYS2 en `C:\msys64`, entorno UCRT64 actualizado. Para otra ubicación, definir
  `COMISCOPIO_MSYS2` antes de `npm run build:native`.

En la terminal UCRT64, actualizar primero MSYS2 según sus instrucciones y luego:

```bash
pacman -S --needed make patch gcc \
  mingw-w64-ucrt-x86_64-gcc \
  mingw-w64-ucrt-x86_64-cmake \
  mingw-w64-ucrt-x86_64-ninja \
  mingw-w64-ucrt-x86_64-pkgconf \
  mingw-w64-ucrt-x86_64-nlohmann-json \
  mingw-w64-ucrt-x86_64-libvips \
  mingw-w64-ucrt-x86_64-imagemagick \
  mingw-w64-ucrt-x86_64-libheif \
  mingw-w64-ucrt-x86_64-libarchive \
  mingw-w64-ucrt-x86_64-libmupdf
```

La aplicación, el worker de archivos y el de documentos usan UCRT64. El decoder
ACE heredado se mantiene en procesos separados con el runtime MSYS2 privado.
La licencia de ese runtime contiene una excepción de enlace; deben acompañarse
las licencias correspondientes en el bundle. No se integra UnACE al proceso del
lector ni se requiere que el usuario final instale MSYS2.

## Comprobaciones

En PowerShell, desde el repositorio:

```powershell
npm ci
npm test
```

Si Python no se detecta automáticamente, indicar su ruta real mediante `PYTHON`.
`postinstall` recompila `better-sqlite3` para Electron. Las pruebas de base de
datos usan Electron con `ELECTRON_RUN_AS_NODE=1`, no la ABI del Node anfitrión.

El build nativo descarga UnRAR 7.2.7 desde RARLAB y exige un SHA-256 fijo.
Normaliza rutas POSIX de archivos `.pc` a rutas Windows antes de pasarlas a los
compiladores nativos. CTest forma parte del build; los DLL se resuelven
recursivamente y un import no resuelto detiene el empaquetado del bundle.
ImageMagick y libheif son dependencias opcionales de libvips en MSYS2, pero
necesarias aquí para BMP y AVIF. El bundle incluye sus módulos de libvips,
los coders `magick` y `bmp` de ImageMagick, y resuelve las DLL importadas por
ellos; copiar solo los imports de los
ejecutables no basta. Véase el [paquete libvips de MSYS2](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-libvips).

El helper ACE convierte las rutas Windows al espacio POSIX de su propio runtime,
incluidas rutas Unicode y con espacios. No presupone que exista el montaje
`/c` de una instalación de MSYS2. La conversión usa la
[API del runtime Cygwin/MSYS2](https://www.cygwin.com/doc/preview/cygwin-api/func-cygwin-conv-path.html).

Salida: `native/vendor/win32-x64/`, con binarios, licencias y registros de las
versiones de paquetes instalados. Estos registros permiten distinguir las
dependencias verificadas localmente de las que instala una ejecución futura.

Para generar solo un directorio de aplicación de prueba:

```powershell
npx electron-builder --win --dir --publish never
$env:COMISCOPIO_APP_BINARY = 'release/win-unpacked/Comiscopio.exe'
npm run test:packaged
```

La prueba necesita una sesión de escritorio interactiva. Guarda capturas y logs
en `test-results/electron/`; usa datos temporales para no alterar la biblioteca
personal. No publicar esos informes sin revisar nombres y rutas personales.

Para comprobar los contenedores finales después de `npm run dist:win`:

```powershell
npm run test:windows-artifacts
```

Se extrae el ZIP en un directorio temporal nuevo y se ejecutan las pruebas de
lectores, interfaz y cancelación. Después se inicia el EXE portable exterior,
se recorren las dos páginas del CBA de prueba y se cierra la última ventana;
el lanzador debe terminar y su caché de lectura debe desaparecer. No se usan
MSYS2 ni bibliotecas de desarrollo desde el PATH. Los informes quedan en
`test-results/windows-artifacts/`. `COMISCOPIO_WINDOWS_ARTIFACTS` permite probar
otra carpeta que contenga los artefactos de la versión de `package.json`.

La prueba de cancelación puede ejecutarse por separado con
`npm run test:windows-processes` y `COMISCOPIO_APP_BINARY` definido. Compila un
helper de prueba mínimo mediante el compilador de .NET Framework incluido en
Windows (`Framework64/v4.0.30319/csc.exe`). Solo este fixture usa .NET; no se
incorpora a los paquetes ni cambia las dependencias de Comiscopio. Comprueba
terminación forzada del worker y cierre de la última ventana con dos procesos
auxiliares bloqueados, además del borrado de temporales.

GitHub Actions compila y genera el EXE/ZIP en `windows-2022` desde las fuentes;
ejecuta estos mismos controles antes de subirlos como artefactos del job.
La publicación por tag requiere también que Linux termine correctamente.

## Validación en ambas versiones de Windows

Primero completar Windows 11, apagar su VM y después ejecutar Windows 10.
Usar el mismo paquete, verificar su hash y probar apertura, navegación,
miniaturas, progreso, múltiples ventanas, rutas Unicode y cierre de workers.
Verificar también el arranque en Windows sin las herramientas de desarrollo.

Una ejecución en `windows-2022` de GitHub Actions no reemplaza estas pruebas en
Windows 10 y Windows 11. Ni un build correcto ni un test automático bastan por
sí solos para aprobar la publicación.

Referencias: [MSYS2](https://www.msys2.org/),
[node-gyp para Windows](https://github.com/nodejs/node-gyp#on-windows),
[licencia del runtime MSYS2](https://github.com/msys2/msys2-runtime/blob/b54860d002ad85de2949bec05ca579aa62f0ef7c/winsup/CYGWIN_LICENSE).
