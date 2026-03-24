# Comiscopio — Checklist de Desarrollo

> Visor de comic/manga de escritorio — Electron + Angular 19 + Web Workers
> Fecha de inicio: 2026-03-23

---

## Decisiones de Arquitectura

| Decisión | Valor | Notas |
|----------|-------|-------|
| Stack | Electron + Angular 19 (standalone) + Web Workers | Workers para decodificación e I/O pesado |
| Modo de lectura por defecto | RTL (manga) | Cambiable desde menú contextual |
| Alcance inicial | Solo visor | Biblioteca/indexación diferida |
| Persistencia | SQLite en `~/.comiscopio/` | Resiliente a borrado de la carpeta |
| Multi-ventana | Sí | Cada archivo en su propia ventana |
| Ventana | Frameless, maximizable, always-on-top toggle | Botones custom de ventana |
| Empaquetado | Portable (Linux + Windows) | GitHub Releases, instalador diferido |
| Gestión de memoria | Ventana deslizante + extracción a temporal | Nunca todo en memoria |
| Barra de progreso | Auto-hide, aparece al hover en zona inferior | Se oculta tras ~2s de inactividad |
| Panel de miniaturas | Oculto por defecto | Toggle con atajo/menú |
| Progreso de lectura | Tabla SQLite, clave: hash del archivo | Sobrevive renombrado/movimiento |
| Fallback de extractores | Node lib → binario del sistema → error | Aplica a CBR, CB7, etc. |
| Hot reload en desarrollo | Sí | Angular dev server + Electron watch |
| Config dir (Linux) | `~/.comiscopio/` | |
| Config dir (Windows) | `%APPDATA%/comiscopio/` | |

---

## Estructura del Proyecto

```
Comiscopio/
├── src/                          # Angular (renderer)
│   ├── app/
│   │   ├── components/
│   │   │   ├── viewer/           # Componente principal del visor
│   │   │   ├── toolbar/          # Barra de progreso inferior
│   │   │   ├── thumbnails/       # Panel lateral de miniaturas
│   │   │   ├── context-menu/     # Menú contextual
│   │   │   └── titlebar/         # Barra de título custom (frameless)
│   │   ├── services/
│   │   │   ├── electron.service.ts
│   │   │   ├── reader.service.ts
│   │   │   └── settings.service.ts
│   │   ├── workers/
│   │   │   ├── image-decoder.worker.ts
│   │   │   └── prefetch.worker.ts
│   │   ├── models/
│   │   └── app.component.ts
│   ├── types/
│   └── styles/
├── electron/                     # Electron main process
│   ├── main.ts
│   ├── preload.ts
│   ├── window-manager.ts
│   ├── file-handler.ts
│   ├── extractors/
│   │   ├── extractor.interface.ts
│   │   ├── cbz.extractor.ts
│   │   ├── cbr.extractor.ts
│   │   ├── cb7.extractor.ts
│   │   ├── pdf.extractor.ts
│   │   └── folder.extractor.ts
│   ├── temp-manager.ts
│   └── db/
│       ├── database.ts
│       ├── reading-progress.repo.ts
│       ├── settings.repo.ts
│       └── bookmarks.repo.ts
├── shared/                       # Tipos e interfaces compartidas
│   ├── ipc-channels.ts
│   ├── models.ts
│   └── constants.ts
├── resources/                    # Iconos, assets estáticos
├── angular.json
├── tsconfig.json
├── tsconfig.electron.json
├── electron-builder.yml
├── package.json
└── checklist.md
```

---

## Fases y Checklist

### Fase 1: Infraestructura del Proyecto
- [x] Scaffolding Angular 21 (standalone components)
- [x] Configuración Electron 41 (main, preload, contextBridge)
- [x] TypeScript configs separadas (Angular ESM / Electron CJS)
- [x] Scripts de build (dev con hot-reload, producción)
- [x] electron-builder configurado (portable Linux + Windows)
- [x] Estructura de carpetas definitiva
- [x] CLAUDE.md con convenciones del proyecto

### Fase 2: Ventana y Chrome
- [x] Ventana frameless (sin bordes)
- [x] Botones de ventana custom (minimizar, maximizar, cerrar)
- [x] Toggle always-on-top (IPC listo, indicador visual en titlebar)
- [x] Multi-ventana (IPC WINDOW_NEW, WindowManager soporta múltiples)
- [x] Restaurar tamaño/posición de ventana entre sesiones (SQLite)

### Fase 3: Apertura de Archivos
- [x] Abrir archivo por diálogo nativo (Ctrl+O, botón, soporta archivos y carpetas)
- [x] Abrir archivo por drag & drop
- [x] Abrir archivo por argumento de línea de comandos
- [x] Abrir carpeta de imágenes como "archivo especial" (symlinks en Linux, copia en Windows)
- [x] Soporte CBZ (ZIP) — adm-zip
- [x] Soporte CBR (RAR) — fallback: node-7z (usa 7z del sistema) → unrar → error
- [x] Soporte CB7 (7zip) — fallback: node-7z → 7z directo → error
- [x] Soporte PDF (pdf.js + canvas) — requiere `npm install canvas`
- [x] Formatos de imagen: JPG, PNG, WebP, AVIF, GIF, BMP, TIFF
- [x] Ordenamiento natural de páginas (localeCompare con numeric: true)

### Fase 4: Extracción y Gestión de Memoria
- [x] Extraer archivo a directorio temporal del SO
- [x] Extracción por lotes (main process lee de disco bajo demanda, no todo en memoria)
- [x] Ventana deslizante en memoria (PageCacheService: configurable behind/ahead)
- [x] Pre-fetch de las siguientes N páginas (async, no bloquea UI)
- [x] Liberación de páginas fuera de la ventana (revoke Blob URLs)
- [x] Limpieza del temporal al cerrar archivo/app
- [x] Limpieza de temporales huérfanos al iniciar la app (TempManager.cleanupOrphans)
- [x] Manejo de archivos grandes (lectura bajo demanda desde disco, solo N páginas en RAM)

### Fase 5: Navegación y Lectura
- [x] Modo RTL (manga) — **por defecto** — tecla `R` para ciclar
- [x] Modo LTR (cómic occidental)
- [x] Modo scroll vertical continuo (webtoon)
- [x] Página simple
- [x] Doble página — tecla `D` para toggle, RTL invierte orden
- [x] Detección de double-page spreads (width > height*1.2 → muestra sola)
- [x] Navegación por teclado: flechas respetan RTL/LTR, arriba/abajo, PgUp/PgDn
- [x] Navegación por clic: mitades respetan modo de lectura (RTL/LTR)
- [x] Navegación por rueda del mouse
- [x] Home/End para primera/última página
- [x] Ir a página específica (Ctrl+G, input numérico)

### Fase 6: Visualización de Imagen
- [x] Fit to width / height / page / original — tecla `F` para ciclar
- [x] Zoom con Ctrl+rueda (zoom hacia cursor) y Ctrl++/Ctrl+-
- [x] Ctrl+0 para resetear zoom
- [x] Pan/arrastrar imagen con mouse cuando está en zoom (cursor grab/grabbing)
- [x] Flechas se convierten en pan cuando hay zoom
- [x] Filtros: brillo (Shift+Up/Down), contraste (Shift+Left/Right)
- [x] Tecla `I` para resetear filtros
- [x] Indicadores en status bar: zoom %, brillo/contraste cuando activos
- [x] Reset automático de zoom/pan al cambiar página
- [ ] Recorte automático de márgenes blancos (diferido — requiere análisis de píxeles)

### Fase 7: Interfaz de Usuario
- [x] Barra de progreso inferior (auto-hide 2s, aparece al hover en zona inferior)
- [x] Slider de progreso para saltar a cualquier página
- [x] Indicador de página actual / total + zoom + filtros + modo lectura
- [x] Panel lateral de miniaturas (oculto, toggle con `T` o menú, 160px, lazy-load)
- [x] Menú contextual (clic derecho):
  - [x] Cambiar modo de lectura (RTL/LTR/Vertical) con indicador activo
  - [x] Cambiar modo de visualización (fit width/height/page/original)
  - [x] Cambiar layout (simple/doble página)
  - [x] Toggle always-on-top
  - [x] Toggle pantalla completa
  - [x] Toggle panel de miniaturas
  - [x] Ir a página...
  - [x] Abrir archivo... / Nueva ventana
  - [x] Resetear filtros de imagen
  - [x] Cerrar archivo
  - [x] Modo zen
- [x] Modo zen (`Z` o doble clic — fullscreen + oculta toolbar/indicador/miniaturas, Esc para salir)
- [x] Tema oscuro por defecto (#1a1a1a)
- [ ] Tema claro opcional (diferido)

### Fase 8: Persistencia (SQLite)
- [x] Directorio de config: `~/.comiscopio/` (Linux) / `%APPDATA%/comiscopio/` (Windows)
- [x] Creación automática del directorio y DB si no existen
- [x] Recuperación graceful: DB corrupta → borra y recrea. Dir borrado → recrea
- [x] Tabla `reading_progress` (file_hash, file_path, page, total_pages, last_read)
- [x] Tabla `app_settings` (key-value para configuración)
- [x] Tabla `bookmarks` (file_hash, page, name, created_at)
- [x] Guardar automáticamente última página leída
- [x] Restaurar posición al reabrir un archivo
- [x] Bookmarks: agregar con tecla `B` o menú contextual (IPC completo)
- [x] Historial de archivos recientes en welcome screen (últimos 20)
### Fase 9: Atajos de Teclado
- [x] Todos los atajos configurables (28 acciones, persistidos en SQLite como JSON)
- [x] Defaults sensatos (shared/keybindings.ts — single source of truth)
- [x] KeybindingsService: match(event) → action, load/update/persist/resetAll
- [x] executeAction() central — reusado por keybindings y menú contextual
- [x] Navegación respeta dirección de lectura (RTL invierte ArrowLeft/Right)
- [x] Zoom pan con flechas cuando hay zoom activo (override sobre navegación)
- [ ] Panel de configuración de atajos en UI (diferido)

### Fase 10: Empaquetado y Distribución
- [x] Build portable Linux: tar.gz (130MB) y AppImage — verificado funcionando
- [x] Build portable Windows: zip y portable .exe (config lista)
- [x] GitHub Actions: `.github/workflows/release.yml` — build Linux+Windows en push de tag `v*`
- [x] GitHub Releases automáticos via `softprops/action-gh-release`
- [x] Versionado semántico: 0.1.0
- [x] File associations: CBZ, CBR, CB7, PDF
- [x] ASAR con unpack para better-sqlite3 (native module)
- [x] electron-builder install-app-deps en postinstall

---

## Diferido (post-v1.0)

- [ ] Gestión de biblioteca (indexar carpetas, series, metadatos)
- [ ] Soporte EPUB
- [ ] Lectura de metadatos ComicInfo.xml
- [ ] AI upscaling para scans de baja resolución
- [ ] Instaladores (deb, msi/nsis)
- [ ] Soporte macOS
- [ ] Sistema de plugins
- [ ] Sincronización entre dispositivos
- [ ] Integración con trackers (AniList, MyAnimeList)
