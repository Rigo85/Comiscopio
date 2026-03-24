import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { WindowManager } from './window-manager';
import { FileHandler } from './file-handler';
import { TempManager } from './temp-manager';
import { Database } from './db/database';
import { IpcChannels } from '../shared/ipc-channels';
import { FILE_FILTERS } from '../shared/constants';

let windowManager: WindowManager;
let fileHandler: FileHandler;
let tempManager: TempManager;
let database: Database;

const isDev = !app.isPackaged;

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

async function initialize(): Promise<void> {
  database = new Database();
  database.initialize();

  tempManager = new TempManager();
  tempManager.cleanupOrphans();

  fileHandler = new FileHandler(tempManager);

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

function setupIpcHandlers(): void {
  // Open file dialog (supports files and folders)
  ipcMain.handle(IpcChannels.OPEN_FILE_DIALOG, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const result = await dialog.showOpenDialog(win, {
      filters: FILE_FILTERS,
      properties: ['openFile', 'openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Open a file and extract it
  ipcMain.handle(IpcChannels.OPEN_FILE, async (_event, filePath: string) => {
    return fileHandler.openFile(filePath);
  });

  // Request a specific page
  ipcMain.handle(IpcChannels.REQUEST_PAGE, async (_event, fileHash: string, pageIndex: number) => {
    return fileHandler.getPage(fileHash, pageIndex);
  });

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
    fileHandler.closeFile(fileHash);
  });
}

app.whenReady().then(async () => {
  await initialize();
  setupIpcHandlers();

  // Check CLI args for a file to open
  const cliFilePath = getFileFromArgs(process.argv);
  const win = windowManager.createWindow();

  if (cliFilePath) {
    // Wait for window to load, then tell renderer to open the file
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IpcChannels.FILE_OPENED, cliFilePath);
    });
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
  tempManager.cleanupAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  tempManager.cleanupAll();
  database.close();
});
