import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { WindowManager } from './window-manager';
import { NativeWorkerBridge } from './native-worker-bridge';
import { Database } from './db/database';
import { IpcChannels } from '../shared/ipc-channels';
import { FILE_FILTERS, THUMBNAIL_PROTOCOL_SCHEME, PAGE_PROTOCOL_SCHEME, ARCHIVE_EXTENSIONS } from '../shared/constants';

let windowManager: WindowManager;
let workerBridge: NativeWorkerBridge;
let database: Database;

const isDev = !app.isPackaged;

// Register custom protocol schemes before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: THUMBNAIL_PROTOCOL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: PAGE_PROTOCOL_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function getRendererUrl(): string {
  if (isDev) return 'http://localhost:4200';
  return `file://${path.join(__dirname, '..', '..', 'dist', 'Comiscopio', 'browser', 'index.html')}`;
}

async function initialize(): Promise<void> {
  database = new Database();
  database.initialize();
  workerBridge = new NativeWorkerBridge();

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
  // Serve thumbnail files from worker output: comiscopio-thumb://fileHash/pageIndex
  protocol.handle(THUMBNAIL_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const fileHash = url.hostname;
      const pageIndex = parseInt(url.pathname.replace(/^\/+/, ''), 10);

      if (!fileHash || isNaN(pageIndex)) {
        return new Response('Bad request', { status: 400 });
      }

      const thumbPath = workerBridge.resolveThumbPath(fileHash, pageIndex);
      if (!thumbPath) {
        if (isDev && pageIndex === 0) {
          console.log(`[thumb-protocol] miss page=0 url=${request.url}`);
        }
        return new Response('Not found', { status: 404 });
      }

      const bytes = await fs.promises.readFile(thumbPath);
      if (isDev && pageIndex === 0) {
        console.log(`[thumb-protocol] hit page=0 path=${thumbPath} bytes=${bytes.length}`);
      }
      return new Response(bytes, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-cache' },
      });
    } catch {
      if (isDev) {
        console.log(`[thumb-protocol] error url=${request.url}`);
      }
      return new Response('Error', { status: 500 });
    }
  });

  // Serve reader page files from worker output: comiscopio-page://fileHash/pageIndex
  protocol.handle(PAGE_PROTOCOL_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const fileHash = url.hostname;
      const pageIndex = parseInt(url.pathname.replace(/^\/+/, ''), 10);
      const variant = url.searchParams.get('variant') === 'original' ? 'original' : 'optimized';

      if (!fileHash || isNaN(pageIndex)) {
        return new Response('Bad request', { status: 400 });
      }

      const pagePath = workerBridge.resolvePagePath(fileHash, pageIndex, variant);
      if (!pagePath) {
        if (isDev && pageIndex === 0) {
          console.log(`[page-protocol] miss page=0 variant=${variant} url=${request.url}`);
        }
        return new Response('Not found', { status: 404 });
      }

      const ext = path.extname(pagePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp',
      };

      const bytes = await fs.promises.readFile(pagePath);
      if (isDev && pageIndex === 0) {
        console.log(`[page-protocol] hit page=0 variant=${variant} path=${pagePath} bytes=${bytes.length}`);
      }
      return new Response(bytes, {
        headers: {
          'content-type': mimeTypes[ext] || 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      if (isDev) {
        console.log(`[page-protocol] error url=${request.url}`);
      }
      return new Response('Error', { status: 500 });
    }
  });
}

function setupIpcHandlers(): void {
  // --- File dialogs ---
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

  ipcMain.handle(IpcChannels.OPEN_FOLDER_DIALOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Native worker lifecycle ---
  ipcMain.handle(IpcChannels.WORKER_START, async (event, filePath: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window');

    // Compute file hash for session key
    const stat = fs.statSync(filePath);
    const crypto = require('crypto');
    const data = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    const fileHash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    const fileName = path.basename(filePath);

    // Check if already opened
    const existing = workerBridge.getSession(fileHash);
    if (existing && existing.ready) {
      return { fileHash, fileName, filePath, totalPages: existing.totalPages, alreadyOpen: true };
    }

    // Start native worker on the next tick so the renderer has time to
    // store fileHash/opening state before early preview events arrive.
    setImmediate(() => {
      workerBridge.startSession(fileHash, filePath, (evt) => {
        if (win.isDestroyed()) return;
        win.webContents.send(IpcChannels.WORKER_EVENT, { fileHash, ...evt });
      });
    });

    return { fileHash, fileName, filePath, totalPages: 0, alreadyOpen: false };
  });

  ipcMain.on(IpcChannels.WORKER_FOCUS, (_event, fileHash: string, page: number) => {
    workerBridge.focus(fileHash, page);
  });

  ipcMain.on(IpcChannels.WORKER_CLOSE, (_event, fileHash: string) => {
    workerBridge.closeSession(fileHash);
  });

  ipcMain.handle(IpcChannels.GET_WORKER_MANIFEST, async (_event, fileHash: string) => {
    return workerBridge.readManifest(fileHash);
  });

  // --- Reading progress ---
  ipcMain.handle(IpcChannels.SAVE_PROGRESS, async (_event, progress) => {
    database.readingProgressRepo.save(progress);
  });

  ipcMain.handle(IpcChannels.GET_PROGRESS, async (_event, fileHash: string) => {
    return database.readingProgressRepo.get(fileHash);
  });

  ipcMain.handle(IpcChannels.GET_RECENT_FILES, async () => {
    return database.readingProgressRepo.getRecent(20);
  });

  // --- Settings ---
  ipcMain.handle(IpcChannels.GET_SETTINGS, async () => {
    return database.settingsRepo.getAll();
  });

  ipcMain.handle(IpcChannels.SAVE_SETTINGS, async (_event, settings) => {
    database.settingsRepo.saveAll(settings);
  });

  // --- Bookmarks ---
  ipcMain.handle(IpcChannels.ADD_BOOKMARK, async (_event, bookmark) => {
    database.bookmarksRepo.add(bookmark);
  });

  ipcMain.handle(IpcChannels.GET_BOOKMARKS, async (_event, fileHash: string) => {
    return database.bookmarksRepo.getForFile(fileHash);
  });

  ipcMain.handle(IpcChannels.REMOVE_BOOKMARK, async (_event, id: number) => {
    database.bookmarksRepo.remove(id);
  });

  // --- Window controls ---
  ipcMain.on(IpcChannels.WINDOW_MINIMIZE, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(IpcChannels.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on(IpcChannels.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const fileHash = windowManager.getFileHashForWindow(win);
      if (fileHash) workerBridge.closeSession(fileHash);
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
    if (win) win.setFullScreen(!win.isFullScreen());
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

  ipcMain.on(IpcChannels.WINDOW_NEW, () => {
    windowManager.createWindow();
  });

  ipcMain.handle(IpcChannels.CLEANUP_TEMP, async (_event, fileHash: string) => {
    workerBridge.closeSession(fileHash);
  });
}

// --- App lifecycle ---

function isSupportedPath(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return true;
    const ext = path.extname(filePath).toLowerCase();
    return ext in ARCHIVE_EXTENSIONS;
  } catch { return false; }
}

function getFileFromArgs(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('-') || arg === '.') continue;
    if (isSupportedPath(arg)) return arg;
  }
  return null;
}

app.whenReady().then(async () => {
  await initialize();
  registerProtocolHandlers();
  setupIpcHandlers();

  const cliFilePath = getFileFromArgs(process.argv);
  const win = windowManager.createWindow();

  if (cliFilePath) {
    let sent = false;
    const sendOnce = () => {
      if (sent) return;
      sent = true;
      setTimeout(() => {
        win.webContents.send(IpcChannels.FILE_OPENED, cliFilePath);
      }, 500);
    };
    win.webContents.once('did-finish-load', sendOnce);
    setTimeout(sendOnce, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow();
  });

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

app.on('window-all-closed', () => {
  workerBridge.closeAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  workerBridge.closeAll();
  database.close();
});
