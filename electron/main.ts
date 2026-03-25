import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Worker } from 'worker_threads';
import { WindowManager } from './window-manager';
import { FileHandler } from './file-handler';
import { ThumbnailManager } from './thumbnail-manager';
import { TempManager } from './temp-manager';
import { Database } from './db/database';
import { IpcChannels } from '../shared/ipc-channels';
import { FILE_FILTERS, THUMBNAIL_PROTOCOL_SCHEME } from '../shared/constants';

let windowManager: WindowManager;
let fileHandler: FileHandler;
let thumbnailManager: ThumbnailManager;
let tempManager: TempManager;
let database: Database;
let nextOpenSessionId = 1;

interface OpenSession {
  id: number;
  worker: Worker;
  win: BrowserWindow;
  fileHash: string;
  tempDir: string;
  cancelled: boolean;
}

const openSessions = new Map<number, OpenSession>();

const isDev = !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  {
    scheme: THUMBNAIL_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function getRendererUrl(): string {
  if (isDev) {
    return 'http://localhost:4200';
  }
  // In production: __dirname = <app>/dist-electron/electron/
  // Renderer is at: <app>/dist/Comiscopio/browser/index.html
  return `file://${path.join(__dirname, '..', '..', 'dist', 'Comiscopio', 'browser', 'index.html')}`;
}

function getOpenFileWorkerPath(): string {
  return path.join(__dirname, 'open-file.worker.js');
}

async function initialize(): Promise<void> {
  database = new Database();
  database.initialize();

  tempManager = new TempManager();
  tempManager.cleanupOrphans();

  fileHandler = new FileHandler(tempManager);
  thumbnailManager = new ThumbnailManager(fileHandler);

  windowManager = new WindowManager(
    getPreloadPath(),
    getRendererUrl(),
    (bounds) => database.settingsRepo.set('windowBounds', JSON.stringify(bounds)),
    () => {
      const raw = database.settingsRepo.get('windowBounds');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
  );
}

function registerProtocolHandlers(): void {
  protocol.handle(THUMBNAIL_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const fileHash = url.hostname;
      const rawPageIndex = url.pathname.replace(/^\/+/, '');
      const pageIndex = Number.parseInt(rawPageIndex, 10);
      if (!fileHash || Number.isNaN(pageIndex)) {
        return new Response('Invalid thumbnail request', { status: 400 });
      }

      const opened = fileHandler.getOpenedFile(fileHash);
      if (!opened) {
        return new Response('Thumbnail session not found', { status: 404 });
      }

      const thumbPath = path.join(
        opened.tempDir,
        'thumbnails',
        `${String(pageIndex).padStart(6, '0')}.jpg`,
      );

      if (!fs.existsSync(thumbPath)) {
        return new Response('Thumbnail not ready', { status: 404 });
      }

      const bytes = await fs.promises.readFile(thumbPath);
      return new Response(bytes, {
        headers: {
          'content-type': 'image/jpeg',
          'cache-control': 'no-cache',
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Thumbnail error', { status: 500 });
    }
  });
}

function setupIpcHandlers(): void {
  // Open file dialog
  ipcMain.handle(IpcChannels.OPEN_FILE_DIALOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      filters: FILE_FILTERS,
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Open folder dialog (separate — Linux doesn't support openFile+openDirectory together)
  ipcMain.handle(IpcChannels.OPEN_FOLDER_DIALOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Open a file and extract it
  ipcMain.handle(IpcChannels.OPEN_FILE, async (_event, filePath: string) => {
    return fileHandler.openFile(filePath);
  });

  ipcMain.handle(IpcChannels.OPEN_FILE_START, async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      throw new Error('Ventana no disponible');
    }

    const descriptor = fileHandler.describeFile(filePath);
    const existing = fileHandler.getOpenedFile(descriptor.fileHash);
    if (existing) {
      return {
        sessionId: 0,
        filePath: existing.info.filePath,
        fileName: existing.info.fileName,
        info: existing.info,
      };
    }

    const tempDir = fileHandler.createTempDir(descriptor.fileHash);
    const sessionId = nextOpenSessionId++;
    const worker = new Worker(getOpenFileWorkerPath());
    const session: OpenSession = {
      id: sessionId,
      worker,
      win,
      fileHash: descriptor.fileHash,
      tempDir,
      cancelled: false,
    };
    openSessions.set(sessionId, session);

    worker.on('message', (message: any) => {
      if (!openSessions.has(sessionId)) return;

      switch (message.kind) {
        case 'progress':
          win.webContents.send(IpcChannels.OPEN_FILE_PROGRESS, {
            sessionId,
            stage: message.stage,
            message: message.message,
          });
          break;
        case 'complete':
          fileHandler.registerOpenedFile(message.info, message.tempDir, message.pageFiles);
          console.log('[comiscopio:open-timing]', {
            file: message.info.fileName,
            format: message.info.format,
            totalMs: Math.round(message.timings?.totalMs ?? 0),
            extractMs: Math.round(message.timings?.extractMs ?? 0),
            indexMs: Math.round(message.timings?.indexMs ?? 0),
            pageCount: message.info.totalPages,
          });
          openSessions.delete(sessionId);
          worker.terminate();
          win.webContents.send(IpcChannels.OPEN_FILE_COMPLETE, {
            sessionId,
            info: message.info,
          });
          break;
        case 'cancelled':
          tempManager.cleanup(session.fileHash);
          openSessions.delete(sessionId);
          worker.terminate();
          win.webContents.send(IpcChannels.OPEN_FILE_CANCELLED, { sessionId });
          break;
        case 'error':
          tempManager.cleanup(session.fileHash);
          openSessions.delete(sessionId);
          worker.terminate();
          win.webContents.send(IpcChannels.OPEN_FILE_ERROR, {
            sessionId,
            message: message.message,
          });
          break;
      }
    });

    worker.on('error', (error) => {
      if (!openSessions.has(sessionId)) return;
      tempManager.cleanup(session.fileHash);
      openSessions.delete(sessionId);
      win.webContents.send(IpcChannels.OPEN_FILE_ERROR, {
        sessionId,
        message: error.message || 'Error al abrir el archivo',
      });
    });

    worker.on('exit', (code) => {
      const active = openSessions.get(sessionId);
      if (!active) return;
      if (active.cancelled) {
        tempManager.cleanup(active.fileHash);
        openSessions.delete(sessionId);
        win.webContents.send(IpcChannels.OPEN_FILE_CANCELLED, { sessionId });
        return;
      }
      if (code !== 0) {
        tempManager.cleanup(active.fileHash);
        openSessions.delete(sessionId);
        win.webContents.send(IpcChannels.OPEN_FILE_ERROR, {
          sessionId,
          message: 'La apertura del archivo terminó de forma inesperada',
        });
      }
    });

    worker.postMessage({
      kind: 'start',
      sessionId,
      descriptor,
      tempDir,
    });

    return {
      sessionId,
      filePath: descriptor.filePath,
      fileName: descriptor.fileName,
    };
  });

  ipcMain.on(IpcChannels.OPEN_FILE_CANCEL, (_event, sessionId: number) => {
    const session = openSessions.get(sessionId);
    if (!session) return;
    session.cancelled = true;
    session.worker.postMessage({ kind: 'cancel' });
    setTimeout(() => {
      if (openSessions.has(sessionId)) {
        session.worker.terminate();
      }
    }, 100);
  });

  // Request a specific page
  ipcMain.handle(IpcChannels.REQUEST_PAGE, async (_event, fileHash: string, pageIndex: number) => {
    return fileHandler.getPage(fileHash, pageIndex);
  });

  ipcMain.handle(IpcChannels.THUMBNAILS_INIT, async (event, fileHash: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    await thumbnailManager.initSession(win, fileHash);
  });

  ipcMain.handle(
    IpcChannels.THUMBNAILS_REQUEST_RANGE,
    async (event, fileHash: string, start: number, end: number, focusPage: number) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return [];
      return thumbnailManager.requestRange(win, fileHash, start, end, focusPage);
    },
  );

  // Save reading progress
  ipcMain.handle(IpcChannels.SAVE_PROGRESS, async (_event, progress) => {
    database.readingProgressRepo.save(progress);
  });

  // Get reading progress for a file
  ipcMain.handle(IpcChannels.GET_PROGRESS, async (_event, fileHash: string) => {
    return database.readingProgressRepo.get(fileHash);
  });

  // Get recent files
  ipcMain.handle(IpcChannels.GET_RECENT_FILES, async () => {
    return database.readingProgressRepo.getRecent(20);
  });

  // Get settings
  ipcMain.handle(IpcChannels.GET_SETTINGS, async () => {
    return database.settingsRepo.getAll();
  });

  ipcMain.handle(IpcChannels.GET_MEMORY_STATS, async () => {
    const memory = await process.getProcessMemoryInfo();
    return {
      mainRssBytes: memory.residentSet * 1024,
    };
  });

  ipcMain.on(IpcChannels.LOG_MEMORY_STATS, (_event, stats) => {
    console.log('[comiscopio:memory]', stats);
  });

  ipcMain.on(IpcChannels.LOG_PERFORMANCE_EVENT, (_event, payload) => {
    console.log('[comiscopio:perf]', payload);
  });

  // Save settings
  ipcMain.handle(IpcChannels.SAVE_SETTINGS, async (_event, settings) => {
    database.settingsRepo.saveAll(settings);
  });

  // Bookmarks
  ipcMain.handle(IpcChannels.ADD_BOOKMARK, async (_event, bookmark) => {
    database.bookmarksRepo.add(bookmark);
  });

  ipcMain.handle(IpcChannels.GET_BOOKMARKS, async (_event, fileHash: string) => {
    return database.bookmarksRepo.getForFile(fileHash);
  });

  ipcMain.handle(IpcChannels.REMOVE_BOOKMARK, async (_event, id: number) => {
    database.bookmarksRepo.remove(id);
  });

  // Window controls
  ipcMain.on(IpcChannels.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IpcChannels.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.isMaximized() ? win.unmaximize() : win.maximize();
    }
  });

  ipcMain.on(IpcChannels.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const fileHash = windowManager.getFileHashForWindow(win);
      if (fileHash) {
        thumbnailManager.closeSession(fileHash);
        fileHandler.closeFile(fileHash);
      }
      win.close();
    }
  });

  ipcMain.on(IpcChannels.WINDOW_TOGGLE_ALWAYS_ON_TOP, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const newState = !win.isAlwaysOnTop();
      win.setAlwaysOnTop(newState);
      win.webContents.send(IpcChannels.WINDOW_STATE_CHANGED, {
        isMaximized: win.isMaximized(),
        isFullscreen: win.isFullScreen(),
        isAlwaysOnTop: newState,
      });
    }
  });

  ipcMain.on(IpcChannels.WINDOW_TOGGLE_FULLSCREEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { isMaximized: false, isFullscreen: false, isAlwaysOnTop: false };
    return {
      isMaximized: win.isMaximized(),
      isFullscreen: win.isFullScreen(),
      isAlwaysOnTop: win.isAlwaysOnTop(),
    };
  });

  ipcMain.handle(IpcChannels.WINDOW_IS_ALWAYS_ON_TOP, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop() ?? false;
  });

  // New window
  ipcMain.on(IpcChannels.WINDOW_NEW, () => {
    windowManager.createWindow();
  });

  // Cleanup temp on request
  ipcMain.handle(IpcChannels.CLEANUP_TEMP, async (_event, fileHash: string) => {
    thumbnailManager.closeSession(fileHash);
    fileHandler.closeFile(fileHash);
  });
}

app.whenReady().then(async () => {
  await initialize();
  registerProtocolHandlers();
  setupIpcHandlers();

  // Check CLI args for a file to open
  const cliFilePath = getFileFromArgs(process.argv);
  const win = windowManager.createWindow();

  if (cliFilePath) {
    // Wait for renderer to signal it's ready, with did-finish-load as fallback
    const sendFile = () => {
      win.webContents.send(IpcChannels.FILE_OPENED, cliFilePath);
    };

    // The renderer will invoke GET_SETTINGS on init — use that as "ready" signal
    // Also set a fallback timer in case the renderer loads from cache
    let sent = false;
    const sendOnce = () => {
      if (sent) return;
      sent = true;
      // Small delay to ensure Angular component is mounted
      setTimeout(sendFile, 500);
    };

    win.webContents.once('did-finish-load', sendOnce);
    // Extra fallback
    setTimeout(sendOnce, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createWindow();
    }
  });

  // Handle second instance (e.g. double-clicking a file when app is already open)
  app.on('second-instance', (_event, argv) => {
    const filePath = getFileFromArgs(argv);
    if (filePath) {
      const newWin = windowManager.createWindow();
      newWin.webContents.once('did-finish-load', () => {
        newWin.webContents.send(IpcChannels.FILE_OPENED, filePath);
      });
    }
  });
});

/** Extract a file path from CLI arguments (skip electron/node flags) */
function getFileFromArgs(argv: string[]): string | null {
  // In dev: electron --no-sandbox . [file]
  // In prod: comiscopio [file]
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-') || arg === '.') continue;
    if (FileHandler.isSupportedPath(arg)) {
      return arg;
    }
  }
  return null;
}

app.on('window-all-closed', () => {
  for (const session of openSessions.values()) {
    session.cancelled = true;
    session.worker.postMessage({ kind: 'cancel' });
    session.worker.terminate();
  }
  openSessions.clear();
  tempManager.cleanupAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  tempManager.cleanupAll();
  database.close();
});
