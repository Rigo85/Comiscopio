# Comiscopio

Visor de cómics y manga para escritorio. Soporta archivos comprimidos (CBZ, CBR, CB7), documentos (PDF, EPUB, DjVu, XPS) y carpetas de imágenes, con énfasis en rendimiento y archivos grandes.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-lightgrey.svg)](#)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](#)

![Comiscopio leyendo un cómic](docs/screenshot-comic.png)

---

## Características

- **Modos de lectura:** LTR (cómic occidental), RTL (manga), Vertical (webtoon/scroll)
- **Página simple y doble** con detección automática de páginas de doble ancho
- **Zoom y pan** con rueda del ratón y arrastre; cuatro modos de ajuste (ancho, alto, página, original)
- **Miniaturas** con panel lateral de navegación rápida
- **Filtros de imagen:** brillo y contraste ajustables en tiempo real
- **Marcadores** por archivo con nombre y salto directo a página
- **Persistencia:** progreso de lectura, marcadores y configuración guardados en SQLite
- **Multi-ventana** y modo siempre visible (*always on top*)
- **Atajos de teclado configurables** (28 acciones)
- **Workers nativos en C++** para extracción y rasterizado eficiente
- **Ventana deslizante de páginas:** archivos de cientos de páginas sin agotar la memoria

---

## Formatos soportados

| Formato | Extensiones | Backend |
|---|---|---|
| Comic ZIP | `.cbz`, `.zip` | libarchive |
| Comic RAR | `.cbr`, `.rar` | libunrar |
| Comic 7-Zip | `.cb7`, `.7z` | libarchive |
| Comic TAR | `.cbt`, `.tar`, `.tgz` | libarchive |
| PDF | `.pdf` | MuPDF |
| EPUB | `.epub` | MuPDF |
| DjVu | `.djvu`, `.djv` | MuPDF |
| XPS | `.xps` | MuPDF |
| Carpeta de imágenes | jpg, png, webp, avif, gif, bmp, tiff | — |

---

## Capturas de pantalla

| Leyendo un cómic | Menú de opciones | Leyendo un PDF |
|:---:|:---:|:---:|
| ![Comic LTR](docs/screenshot-comic.png) | ![Menú contextual](docs/screenshot-menu.png) | ![PDF](docs/screenshot-pdf.png) |

---

## Requisitos

### Ejecutar la aplicación (AppImage)

El AppImage de Linux es autocontenido y no requiere dependencias del sistema.

### Compilar desde código fuente

- **Node.js 24+**
- **Linux — dependencias de sistema:**

```bash
sudo apt install \
  libvips-dev libarchive-dev libunrar-dev \
  libmupdf-dev libjbig2dec0-dev libgumbo-dev libmujs-dev \
  libfreetype-dev libharfbuzz-dev libopenjp2-7-dev libjpeg-dev \
  nlohmann-json3-dev cmake pkg-config
```

---

## Compilar y ejecutar

```bash
# Instalar dependencias Node
npm install

# Modo desarrollo (Angular dev server + Electron con hot-reload)
npm start

# Build de producción
npm run build

# Empaquetar para Linux (AppImage + tar.gz)
npm run dist:linux

# Empaquetar para Windows (portable + zip)
npm run dist:win

# Build nativo portable con Docker + empaquetar (recomendado para distribución)
npm run full:package-linux
```

> `full:package-linux` compila los workers nativos en un contenedor Docker Ubuntu 22.04, enlazando las dependencias estáticamente o empaquetando los `.so` necesarios. Garantiza compatibilidad con distribuciones con glibc ≥ 2.35 sin depender del entorno del host.

---

## Uso básico

1. Abre un archivo con **Ctrl+O**, desde el menú contextual o arrastrándolo a la ventana.
2. Navega con las **flechas del teclado**, la **rueda del ratón** o el panel de miniaturas (**T**).
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

Todos los atajos son reconfigurables desde el menú → Atajos.

---

## Licencias

Comiscopio se distribuye bajo **[AGPL-3.0-or-later](LICENSE)**.

Las dependencias de terceros tienen sus propias licencias:

| Componente | Licencia | Notas |
|---|---|---|
| [MuPDF](https://mupdf.com) (Artifex) | AGPL-3.0 | Licencia dual; se usa la rama open source, compatible con AGPL-3.0 |
| [libunrar](https://www.rarlab.com/rar_add.htm) | Freeware propietario | Solo descompresión; redistribución sin modificación permitida; no compatible con GPL |
| [libvips](https://www.libvips.org) | LGPL-2.1-or-later | |
| [libarchive](https://www.libarchive.org) | BSD-2-Clause | |
| [Electron](https://www.electronjs.org) | MIT | |
| [Angular](https://angular.dev) | MIT | |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | |
| [nlohmann/json](https://github.com/nlohmann/json) | MIT | |

**MuPDF:** Artifex ofrece MuPDF bajo licencia dual (AGPL-3.0 u comercial). Comiscopio usa la rama AGPL-3.0. Si deseas integrar Comiscopio en un producto propietario, necesitarás adquirir una licencia comercial de Artifex.

**libunrar:** La licencia de UnRAR permite descompresión libre pero prohíbe crear software de compresión RAR y es incompatible con GPL. Por este motivo algunas distribuciones (Fedora, Debian main) no incluyen libunrar en sus repositorios oficiales.

---

## Contribuir

Las contribuciones son bienvenidas. Abre un [issue](https://github.com/Rigo85/Comiscopio/issues) para reportar bugs o proponer mejoras, o un pull request con tus cambios.
