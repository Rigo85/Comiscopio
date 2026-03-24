# Comiscopio

Visor de cómics y manga de escritorio. Electron + Angular.

## Formatos soportados

- **CBZ** (ZIP)
- **CBR** (RAR) — fallback: 7z del sistema → unrar → error
- **CB7** (7zip) — fallback: 7z del sistema → 7z directo → error
- **PDF** — requiere `npm install canvas`
- **Carpetas de imágenes** (JPG, PNG, WebP, AVIF, GIF, BMP, TIFF)

## Características

- Modos de lectura: LTR (cómic), RTL (manga), vertical (webtoon)
- Página simple y doble con detección de double-page spreads
- Zoom (Ctrl+rueda), pan, filtros de brillo/contraste
- Ventana sin bordes, always-on-top, multi-ventana
- Menú contextual, panel de miniaturas, barra de progreso, modo zen
- Persistencia en SQLite: progreso de lectura, marcadores, configuración
- Gestión de memoria con ventana deslizante (archivos grandes sin problema)
- 28 atajos de teclado configurables

## Requisitos

- Node.js >= 24
- Linux: `7z` (p7zip-full) para soporte CBR/CB7
- Windows: `7z` en PATH para soporte CBR/CB7

## Desarrollo

```bash
npm install
npm start          # Angular dev server + Electron con hot-reload
```

## Build

```bash
npm run build              # Producción (Angular + Electron)
npm run dist:linux         # Empaquetar Linux (AppImage + tar.gz)
npm run dist:win           # Empaquetar Windows (portable + zip)
```

## Atajos principales

| Atajo | Acción |
|-------|--------|
| Ctrl+O | Abrir archivo |
| Ctrl+G | Ir a página |
| Ctrl+rueda | Zoom |
| Ctrl+0 | Resetear zoom |
| Flechas | Navegar páginas |
| R | Cambiar modo lectura |
| D | Simple/doble página |
| F | Cambiar ajuste |
| T | Miniaturas |
| Z | Modo zen |
| B | Agregar marcador |
| F11 | Pantalla completa |
| Shift+flechas | Brillo/contraste |
| I | Resetear filtros |

## Licencia

[AGPL-3.0](LICENSE)
