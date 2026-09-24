# Comiscopio

Visor de cómics y manga para escritorio. Lee archivos comprimidos (CBZ, CBR, CB7, CBT, CBA), documentos PDF/EPUB/XPS y carpetas de imágenes. Incluye modos LTR, RTL y vertical, miniaturas y progreso guardado.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-lightgrey.svg)](#)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](#)

**Versión publicada: [0.3.0](https://github.com/Rigo85/Comiscopio/releases/tag/v0.3.0).** Completadas las rondas manuales y las pruebas locales en Linux y Windows 10/11 x64. La [compilación, validación y publicación en GitHub Actions](https://github.com/Rigo85/Comiscopio/actions/runs/35955995838) también pasó para Linux y Windows. Consulta la [revisión final](docs/revision-final-0.3.0.md) y las [notas de versión](docs/releases/v0.3.0.md).

![Comiscopio leyendo un cómic](docs/screenshot-comic.png)

---

## Características

- **Modos de lectura:** LTR (cómic occidental), RTL (manga), Vertical (webtoon/scroll)
- **Página simple y doble** con detección automática de páginas de doble ancho
- **Zoom y desplazamiento:** Ctrl + rueda para acercar/alejar; arrastre cuando hay zoom o tamaño original. Cuatro modos de ajuste: ancho, alto, página y original.
- **Miniaturas** con panel lateral de navegación rápida
- **Filtros de imagen:** brillo y contraste ajustables en tiempo real
- **Marcadores** por archivo con nombre y salto directo a página
- **Persistencia:** progreso de lectura, marcadores y configuración guardados en SQLite
- **Multi-ventana** y modo siempre visible (*always on top*). Al volver a abrir el mismo archivo, se activa la ventana que ya lo muestra.
- **Atajos de teclado:** 25 acciones, consultables desde el menú → Atajos.
- **Workers nativos en C++** para extracción y rasterizado eficiente
- **Ventana deslizante de páginas:** mantiene las páginas cercanas y descarta imágenes alejadas de la caché del visor. El consumo total de memoria depende del archivo y su formato.

---

## Formatos y disponibilidad

| Formato | Extensiones | Backend |
|---|---|---|
| Comic ZIP | `.cbz`, `.zip` | libarchive |
| Comic RAR | `.cbr`, `.rar` | libunrar |
| Comic 7-Zip | `.cb7`, `.7z` | 7-Zip SDK |
| Comic TAR | `.cbt`, `.tar`, `.tgz` | libarchive |
| Comic ACE | `.cba`, `.ace` | ACE helper (`unace-nonfree`) |
| PDF | `.pdf` | MuPDF |
| EPUB | `.epub` | MuPDF |
| DjVu | `.djvu`, `.djv` | Se delega a MuPDF; soporte no confirmado, sin lector registrado en las versiones inspeccionadas |
| XPS | `.xps` | MuPDF |
| Carpeta de imágenes | jpg, png, webp, avif, gif, bmp, tiff | Recorrido de subcarpetas, orden natural y libvips |

ACE/CBA admite inicialmente hasta **10.000 entradas**, **512 MiB por archivo
descomprimido** y **8 GiB en total**. El recuento incluye carpetas y archivos
auxiliares; los tamaños se comprueban al listar y la escritura se limita durante
la extracción. Si se supera un límite, se muestra el motivo y se limpian los
temporales de la sesión sin modificar el original. Estos límites controlan los
datos extraídos, no el consumo de RAM o CPU al decodificar.

Se pueden ajustar antes de iniciar la aplicación mediante
`COMISCOPIO_ACE_MAX_ENTRIES`, `COMISCOPIO_ACE_MAX_ENTRY_BYTES` y
`COMISCOPIO_ACE_MAX_TOTAL_BYTES` (enteros positivos; tamaños en bytes).
El helper limita además la salida del decoder a 8 MiB al listar y a 64 KiB por
extracción individual. Los rechazos por límites, los valores inválidos y los
límites exactos con decoder real se probaron en Linux y Windows 10/11. Las
pruebas con decoders simulados y tamaños declarados falsos son específicas de
Linux; no certifican todas las variantes ACE.

---

## Capturas de pantalla

| Leyendo un cómic | Menú de opciones | Leyendo un PDF |
|:---:|:---:|:---:|
| ![Comic LTR](docs/screenshot-comic.png) | ![Menú contextual](docs/screenshot-menu.png) | ![PDF](docs/screenshot-pdf.png) |

---

## Requisitos

### Ejecutar en Linux x64

Los paquetes incluyen los lectores nativos y sus bibliotecas. Requieren un
entorno de escritorio Linux x64 con glibc 2.35 o posterior. El AppImage usa
FUSE 2 para montarse; si falta, instala el paquete correspondiente:

```bash
sudo apt install libfuse2      # Ubuntu 22.04 / Debian 12
# En Ubuntu 24.04:
sudo apt install libfuse2t64
```

Consulta la [guía oficial de FUSE para AppImage](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
para otras distribuciones. Para iniciar el AppImage de 0.3.0:

```bash
chmod +x Comiscopio-0.3.0.AppImage
./Comiscopio-0.3.0.AppImage
```

Como alternativa sin FUSE, descarga el `tar.gz`, extrae y ejecuta el binario directamente:

```bash
tar -xzf comiscopio-0.3.0.tar.gz
./comiscopio-0.3.0/comiscopio
```

### Ejecutar en Windows x64

La versión 0.3.0 se probó en Windows 10 22H2 y Windows 11. Sus paquetes son
portables, sin instalador ni firma de código:

- Ejecuta `Comiscopio.0.3.0.exe`, o
- extrae **todo** `Comiscopio-0.3.0-win.zip` en una carpeta y abre `Comiscopio.exe`.

No necesitas instalar Node.js ni MSYS2 para usar esos paquetes. En las VM de
prueba se observaron algunos arranques lentos; la causa sigue sin determinarse.
Consulta las [observaciones de Windows](docs/validacion-windows-2026-09.md).

Descarga los paquetes y `SHA256SUMS.txt` desde
[GitHub Releases](https://github.com/Rigo85/Comiscopio/releases/tag/v0.3.0).
El build local genera `Comiscopio 0.3.0.exe`; la descarga de GitHub usa puntos
en lugar de espacios en ese nombre.

### Compilar desde código fuente

- **Node.js 24.18.1** y **npm 11.16.0** son las versiones usadas en la validación local. CI selecciona Node.js 24.18.1; `package.json` declara npm 11.16.0 como gestor del proyecto.
- **Windows:** consulta la [guía de compilación local](docs/windows.md).
- **Linux portable:** Docker, con Ubuntu 22.04 como base de compilación para conservar glibc 2.35.
- **Linux — dependencias de sistema:**

```bash
sudo apt install \
  build-essential python3 \
  libvips-dev libarchive-dev libunrar-dev \
  libmupdf-dev libjbig2dec0-dev libgumbo-dev libmujs-dev \
  libfreetype-dev libharfbuzz-dev libopenjp2-7-dev libjpeg-dev \
  nlohmann-json3-dev cmake pkg-config
```

---

## Compilar y ejecutar

```bash
# Instalar dependencias Node
npm ci

# Modo desarrollo (Angular dev server + Electron con hot-reload)
npm start

# Build local completo (workers nativos + Angular + Electron)
npm run build

# Regenerar bundle portable de workers nativos
npm run build:portable

# Validación local completa
npm test

# Empaquetar un directorio sin instalador para el sistema anfitrión
npm run pack

# Empaquetar para Linux (AppImage + tar.gz)
npm run dist:linux

# En Windows con MSYS2 configurado: empaquetar portable + zip
npm run dist:win
```

`npm run build:portable` usa Docker Ubuntu 22.04 en Linux y MSYS2 UCRT64 en Windows. Guarda los lectores y sus dependencias en `native/vendor/linux-x64/` o `native/vendor/win32-x64/`. El bundle Linux compila libvips 8.18.6, libarchive 3.8.9, MuPDF 1.28.4, UnRAR 7.2.7 y nlohmann/json 3.12.0 desde fuentes verificadas; el SDK 7-Zip es 26.03. Incluye también los módulos de ImageMagick necesarios para BMP. Las versiones y hashes están en `native/deps/versions.env`; las versiones efectivas de los paquetes Ubuntu se conservan en el bundle. Los comandos de empaquetado usan `--publish never`; no publican en GitHub.

### Flujo recomendado

```bash
# Desarrollo
npm start

# Verificar que nada se rompió
npm test

# Generar artefactos Linux de distribución
npm run dist:linux
```

---

## Tests

```bash
# Build y comprobaciones locales de código, base de datos y lectores
npm test

# Comprobaciones individuales
npm run test:unit
npm run test:database
npm run test:fixtures
npm run build:portable
```

`npm test` compila el proyecto, ejecuta Vitest, CTest y pruebas de SQLite con la
ABI de Electron. Luego comprueba los lectores del bundle: archivos comprimidos,
PDF/EPUB/XPS, carpetas Unicode, páginas dañadas, comandos fragmentados y cierre.
En Linux añade la suite Bash existente. Un binario o fixture requerido ausente
hace fallar la ejecución.

Para probar únicamente el bundle Linux:

```bash
COMISCOPIO_NATIVE_DIR=native/vendor/linux-x64 npm run test:workers:portable
```

En PowerShell:

```powershell
$env:COMISCOPIO_NATIVE_DIR = 'native/vendor/win32-x64'
npm run test:workers:portable
```

Los [fixtures incluidos](test/fixtures/README.md) cubren ZIP/RAR/7z/TAR/PDF/EPUB/XPS y los formatos de imagen anunciados.
`npm run test:fixtures` descarga una muestra pública CBA de dos imágenes,
verificada por SHA-256, en `.cache/fixtures/`; no se incorpora al repositorio ni
al paquete. Las pruebas requieren esta descarga inicial; después reutilizan el
archivo verificado.

### Aplicación empaquetada

La prueba abre el ejecutable empaquetado con un perfil temporal. Verifica páginas
renderizadas, progreso al reabrir, reutilización de la ventana propietaria y las
regresiones de scroll/rueda en miniaturas. Conserva capturas y logs en
`test-results/electron/`.

```bash
npm run pack
COMISCOPIO_APP_BINARY=release/linux-unpacked/comiscopio npm run test:packaged
# Tras generar AppImage y tar.gz, probar también sus lanzadores:
npm run test:linux-artifacts
```

En un entorno Linux sin escritorio, usa `xvfb-run --auto-servernum` antes del
comando. En Windows, tras generar el directorio de prueba:

```powershell
$env:COMISCOPIO_APP_BINARY = 'release/win-unpacked/Comiscopio.exe'
npm run test:packaged
# Tras generar el EXE portable y el ZIP:
npm run test:windows-artifacts
```

### Portabilidad Linux

```bash
bash test/ldd/check-deps.sh native/vendor/linux-x64
npm run test:functional -- --pull
```

La matriz usa [la lista de distribuciones](test/workers/distros.txt). Sin
`--pull`, las imágenes Docker ausentes se marcan como `SKIP`; eso no demuestra
compatibilidad con esas distribuciones. La base actual del bundle requiere
glibc 2.35 o posterior.

### CI y validación manual

El workflow compila Linux y Windows por separado a partir del código del
repositorio; no recibe los paquetes construidos en las máquinas locales.
Linux usa Docker Ubuntu 22.04 para los lectores y Windows usa MSYS2 UCRT64
en un runner `windows-2022`. Ambos compilan Angular/Electron, comprueban SQLite
y ejecutan pruebas de lectores e interfaz.

Antes de subir los artefactos, Linux prueba el AppImage y el tar.gz extraído.
Windows extrae un ZIP nuevo, prueba sus lectores e interfaz y comprueba que un
auxiliar ACE bloqueado y su descendiente terminan al cerrar. También inicia el
EXE portable real, abre ACE y exige que el cierre elimine sus temporales. El
PATH de estas pruebas Windows excluye MSYS2. La versión de «Acerca de» y del
ejecutable se contrasta con `package.json`.

Los informes se conservan incluso al fallar. Solo un push de tag que coincida
con la versión puede publicar, y necesita éxito de ambos jobs; usa las notas
de `docs/releases/<tag>.md` y genera SHA-256 de los paquetes probados. PR, push
de rama y ejecución manual prueban sin publicar. El workflow pasó primero
en [la ejecución de rama](https://github.com/Rigo85/Comiscopio/actions/runs/35953364173)
y después en [la publicación de `v0.3.0`](https://github.com/Rigo85/Comiscopio/actions/runs/35955995838),
con artefactos y diagnósticos de ambos sistemas.

La revisión manual se hace de un formato a la vez: abrir, navegar, probar
miniaturas, saltar al final/inicio, revisar logs y recién continuar al siguiente.
Las pruebas automáticas no sustituyen esta comprobación de la experiencia de uso.

---

## Uso básico

1. Abre un archivo con **Ctrl+O**, desde el menú contextual o arrastrándolo a la ventana.
2. Navega con las **flechas del teclado** o la **rueda sobre el visor**. Sobre el panel de miniaturas (**T**), la rueda solo desplaza la lista; haz clic en una miniatura para cambiar de página.
3. Cambia el modo de lectura con **R** (LTR → RTL → Vertical).
4. El progreso se guarda automáticamente al cerrar.

---

## Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl+O` | Abrir archivo |
| `Ctrl+W` | Cerrar archivo |
| `Ctrl+N` | Nueva ventana |
| `Ctrl+G` | Ir a página... |
| `→` / `←` | Página siguiente / anterior |
| `PageDown` / `PageUp` | Página siguiente / anterior (alt) |
| `Espacio` | Página siguiente |
| `Home` / `End` | Primera / última página |
| `Ctrl+=` / `Ctrl+-` | Acercar / alejar |
| `Ctrl+0` | Restablecer zoom |
| `Shift+↑` / `Shift+↓` | Subir / bajar brillo |
| `Shift+→` / `Shift+←` | Subir / bajar contraste |
| `I` | Restablecer filtros |
| `R` | Cambiar modo de lectura |
| `D` | Alternar página simple / doble |
| `F` | Cambiar ajuste de imagen |
| `T` | Mostrar / ocultar miniaturas |
| `B` | Agregar marcador |
| `F11` | Pantalla completa |

El menú → Atajos muestra las combinaciones actuales; todavía no incluye un
editor para cambiarlas. Con zoom o tamaño original, las flechas desplazan la
imagen; en ese caso puedes usar PageDown/PageUp para cambiar de página.

---

## Licencias

Comiscopio se distribuye bajo **[AGPL-3.0-or-later](LICENSE)**.

Las dependencias de terceros tienen sus propias licencias:

| Componente | Licencia | Notas |
|---|---|---|
| [MuPDF](https://mupdf.com) (Artifex) | AGPL-3.0 | Licencia dual; se usa la rama open source, compatible con AGPL-3.0 |
| [libunrar](https://www.rarlab.com/rar_add.htm) | Freeware propietario | Solo descompresión; redistribución sin modificación permitida; no compatible con GPL |
| [unace-nonfree (vendorizado)](https://packages.debian.org/source/sid/unace-nonfree) | Public UnAce Licence | Solo descompresión; integrado como helper separado para ACE; parches locales documentados en [`README.comiscopio`](native/ace-helper/third_party/unace-nonfree/README.comiscopio.md) |
| [libvips](https://www.libvips.org) | LGPL-2.1-or-later | |
| [libarchive](https://www.libarchive.org) | BSD-2-Clause | |
| [Electron](https://www.electronjs.org) | MIT | |
| [Angular](https://angular.dev) | MIT | |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | |
| [nlohmann/json](https://github.com/nlohmann/json) | MIT | |

**MuPDF:** Artifex ofrece MuPDF bajo licencia dual (AGPL-3.0 u comercial). Comiscopio usa la rama AGPL-3.0. Si deseas integrar Comiscopio en un producto propietario, necesitarás adquirir una licencia comercial de Artifex.

**libunrar:** La licencia de UnRAR permite descompresión libre pero prohíbe crear software de compresión RAR y es incompatible con GPL. Por este motivo algunas distribuciones (Fedora, Debian main) no incluyen libunrar en sus repositorios oficiales.

**unace-nonfree:** Comiscopio usa una copia vendorizada y parcheada del paquete fuente Debian `unace-nonfree` para soportar archivos `ace/cba`. El decoder ACE corre como helper separado y se usa solo para descompresión. El origen del snapshot, la licencia y los parches locales que deben conservarse al actualizarlo están documentados en [`native/ace-helper/third_party/unace-nonfree/README.comiscopio.md`](native/ace-helper/third_party/unace-nonfree/README.comiscopio.md).

---

## Contribuir

Las contribuciones son bienvenidas. Abre un [issue](https://github.com/Rigo85/Comiscopio/issues) para reportar bugs o proponer mejoras, o un pull request con tus cambios.
