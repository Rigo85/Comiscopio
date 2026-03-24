# Comiscopio

Comic/manga desktop viewer built with Electron + Angular 21 + Web Workers.

## Project Structure

- `src/` — Angular renderer (UI, components, services, workers)
- `electron/` — Electron main process (window management, file I/O, extractors, SQLite)
- `shared/` — Types, interfaces, and constants shared between main and renderer
- `resources/` — App icons and static assets
- `dist/` — Angular build output (production)
- `dist-electron/` — Compiled Electron TypeScript output

## Development

Use Node 24 from `/home/rigo/Install/node-24/bin`.

```bash
export PATH="/home/rigo/Install/node-24/bin:$PATH"
npm start        # Dev mode: Angular dev server + Electron with hot-reload
npm run build    # Production build
npm run dist:linux  # Package for Linux
```

## Key Conventions

- Angular 21 with standalone components (no NgModules)
- Hash routing (`withHashLocation()`) for Electron file:// compatibility
- IPC channels defined in `shared/ipc-channels.ts` — single source of truth
- Preload script whitelists channels — no open-ended IPC
- TypeScript strict mode in both Angular and Electron configs
- Extractors use Strategy pattern with fallback chain (node lib → system binary → error)
- SQLite via better-sqlite3 (synchronous API, WAL mode)
- Config stored in `~/.comiscopio/` (Linux) / `%APPDATA%/comiscopio/` (Windows)

## Build Commands

- `npm run build:angular` — Build Angular for production
- `npm run build:electron` — Compile Electron TypeScript
- `npm run start:angular` — Angular dev server on :4200
- `npm run start:electron` — Compile & launch Electron (waits for Angular)
