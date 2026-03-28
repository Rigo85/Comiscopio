import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';
import { execFile } from 'child_process';
import { Readable } from 'stream';
import { WindowManager } from './window-manager';
import { NativeWorkerBridge } from './native-worker-bridge';
import { Database } from './db/database';
import { IpcChannels } from '../shared/ipc-channels';
import { FILE_FILTERS, THUMBNAIL_PROTOCOL_SCHEME, PAGE_PROTOCOL_SCHEME, ARCHIVE_EXTENSIONS } from '../shared/constants';

let windowManager: WindowManager;
let workerBridge: NativeWorkerBridge;
let database: Database;

const isDev = !app.isPackaged;
const LOG_DIR = path.join(os.homedir(), '.comiscopio', 'logs');
const LOG_FILE_NAME = 'performance.log';
const LOG_FILE_PATH = path.join(LOG_DIR, LOG_FILE_NAME);
const LOG_MAX_BYTES = 10 * 1024 * 1024;
const LOG_MAX_FILES = 5;

let installedFileLogger = false;
let currentLogSize = 0;

function rotateLogFiles(): void {
  for (let index = LOG_MAX_FILES - 1; index >= 1; index--) {
    const source = `${LOG_FILE_PATH}.${index}`;
    const target = `${LOG_FILE_PATH}.${index + 1}`;
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
    if (fs.existsSync(source)) {
      fs.renameSync(source, target);
    }
  }

  if (fs.existsSync(LOG_FILE_PATH)) {
    const rotated = `${LOG_FILE_PATH}.1`;
    if (fs.existsSync(rotated)) {
      fs.rmSync(rotated, { force: true });
    }
    fs.renameSync(LOG_FILE_PATH, rotated);
  }

  currentLogSize = 0;
}

function appendLogLine(line: string): void {
  const output = `${line}\n`;
  const bytes = Buffer.byteLength(output);

  fs.mkdirSync(LOG_DIR, { recursive: true });

  if (currentLogSize + bytes > LOG_MAX_BYTES) {
    rotateLogFiles();
  }

  fs.appendFileSync(LOG_FILE_PATH, output, 'utf8');
  currentLogSize += bytes;
}

function installFileLogger(): void {
  if (installedFileLogger) return;
  installedFileLogger = true;

  fs.mkdirSync(LOG_DIR, { recursive: true });
  app.setAppLogsPath(LOG_DIR);
  currentLogSize = fs.existsSync(LOG_FILE_PATH) ? fs.statSync(LOG_FILE_PATH).size : 0;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    const line = util.format(...args);
    originalLog(...args);
    appendLogLine(line);
  };

  console.warn = (...args: unknown[]) => {
    const line = util.format(...args);
    originalWarn(...args);
    appendLogLine(line);
  };

  console.error = (...args: unknown[]) => {
    const line = util.format(...args);
    originalError(...args);
    appendLogLine(line);
  };

  logDiagnostic('info', 'logger', 'initialized', {
    logDir: LOG_DIR,
    file: LOG_FILE_NAME,
    maxBytes: LOG_MAX_BYTES,
    maxFiles: LOG_MAX_FILES,
  });
}

type LogValue = string | number | boolean | null | undefined;

function logTimestamp(): string {
  return new Date().toISOString();
}

function formatLogValue(value: LogValue): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

function logDiagnostic(
  level: 'info' | 'warn' | 'error',
  source: string,
  event: string,
  fields: Record<string, LogValue> = {},
): void {
  const parts = [`ts=${logTimestamp()}`, `level=${level}`, `source=${source}`, `event=${event}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key}=${formatLogValue(value)}`);
  }
  console.log(parts.join(' '));
}

function formatMbFromBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatMbFromKb(kb: number): string {
  return `${(kb / 1024).toFixed(1)}MB`;
}

function summarizeProcessMetrics(
  metrics: Array<{
    pid?: number;
    type?: string;
    memory?: { workingSetSize?: number; privateBytes?: number };
  }>
): string {
  const grouped = new Map<string, { count: number; workingSetKb: number; privateBytesKb: number }>();

  for (const metric of metrics) {
    const type = metric.type || 'unknown';
    const current = grouped.get(type) || { count: 0, workingSetKb: 0, privateBytesKb: 0 };
    current.count += 1;
    current.workingSetKb += metric.memory?.workingSetSize || 0;
    current.privateBytesKb += metric.memory?.privateBytes || 0;
    grouped.set(type, current);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => b[1].workingSetKb - a[1].workingSetKb)
    .map(([type, info]) =>
      `${type}:count=${info.count},ws=${formatMbFromKb(info.workingSetKb)},private=${formatMbFromKb(info.privateBytesKb)}`
    )
    .join(' | ');
}

function listProcessMetrics(
  metrics: Array<{
    pid?: number;
    type?: string;
    memory?: { workingSetSize?: number; privateBytes?: number };
  }>
): string {
  return metrics
    .slice()
    .sort((a, b) => (b.memory?.workingSetSize || 0) - (a.memory?.workingSetSize || 0))
    .map((metric) =>
      `pid=${metric.pid || 0},type=${metric.type || 'unknown'},` +
      `ws=${formatMbFromKb(metric.memory?.workingSetSize || 0)},` +
      `private=${formatMbFromKb(metric.memory?.privateBytes || 0)}`
    )
    .join(' | ');
}

function logElectronMemory(event: string, extraFields: Record<string, LogValue> = {}, win?: BrowserWindow): void {
  if (!isDev) return;

  const mainMem = process.memoryUsage();
  const metrics = app.getAppMetrics() as Array<{
    pid?: number;
    type?: string;
    memory?: { workingSetSize?: number; privateBytes?: number };
  }>;

  const rendererPid = win?.webContents.getOSProcessId();
  const rendererMetric = rendererPid ? metrics.find((metric) => metric.pid === rendererPid) : undefined;
  const totalWorkingSetKb = metrics.reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0);
  const breakdown = summarizeProcessMetrics(metrics);
  const processes = listProcessMetrics(metrics);

  logDiagnostic('info', 'electron', event, {
    ...extraFields,
    mainRss: formatMbFromBytes(mainMem.rss),
    mainHeapUsed: formatMbFromBytes(mainMem.heapUsed),
    appWorkingSet: formatMbFromKb(totalWorkingSetKb),
    rendererWorkingSet: formatMbFromKb(rendererMetric?.memory?.workingSetSize || 0),
    rendererPid: rendererPid || 0,
    breakdown,
    processes,
  });
}

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
        return new Response('Not found', { status: 404 });
      }

      const stat = await fs.promises.stat(thumbPath);
      const stream = Readable.toWeb(fs.createReadStream(thumbPath)) as ReadableStream;
      return new Response(stream, {
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(stat.size),
          'cache-control': 'no-cache',
        },
      });
    } catch {
      if (isDev) {
        logDiagnostic('error', 'thumb_protocol', 'request_error', { url: request.url });
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
        return new Response('Not found', { status: 404 });
      }

      const ext = path.extname(pagePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp',
      };

      const stat = await fs.promises.stat(pagePath);
      const stream = Readable.toWeb(fs.createReadStream(pagePath)) as ReadableStream;
      return new Response(stream, {
        headers: {
          'content-type': mimeTypes[ext] || 'application/octet-stream',
          'content-length': String(stat.size),
          'cache-control': 'no-cache',
        },
      });
    } catch {
      if (isDev) {
        logDiagnostic('error', 'page_protocol', 'request_error', { url: request.url });
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
    const sessionId = require('crypto').randomUUID();

    // Compute file hash for session key
    const stat = fs.statSync(filePath);
    const crypto = require('crypto');
    const data = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    const fileHash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    const fileName = path.basename(filePath);

    logDiagnostic('info', 'session', 'session_start', {
      sessionId,
      fileHash,
      filePath,
      fileName,
      fileSize: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      alreadyOpen: !!workerBridge.getSession(fileHash)?.ready,
    });

    // Check if already opened
    const existing = workerBridge.getSession(fileHash);
    if (existing && existing.ready) {
      return { fileHash, sessionId, fileName, filePath, totalPages: existing.totalPages, alreadyOpen: true };
    }

    // Start native worker on the next tick so the renderer has time to
    // store fileHash/opening state before early preview events arrive.
    setImmediate(() => {
      workerBridge.startSession(fileHash, filePath, (evt) => {
        if (win.isDestroyed()) return;
        if (evt.type === 'archive') {
          logElectronMemory('archive', { fileHash, sessionId }, win);
        } else if (evt.type === 'done') {
          logElectronMemory('done', { fileHash, sessionId }, win);
        }
        win.webContents.send(IpcChannels.WORKER_EVENT, { fileHash, sessionId, ...evt });
      });
    });

    return { fileHash, sessionId, fileName, filePath, totalPages: 0, alreadyOpen: false };
  });

  ipcMain.on(IpcChannels.WORKER_FOCUS, (_event, fileHash: string, page: number) => {
    workerBridge.focus(fileHash, page);
  });

  ipcMain.on(
    IpcChannels.WORKER_CLOSE,
    (_event, fileHash: string, meta?: { sessionId?: string; reason?: string }) => {
    workerBridge.closeSession(fileHash);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      logElectronMemory(
        'worker_close',
        { fileHash, sessionId: meta?.sessionId, reason: meta?.reason ?? 'unspecified' },
        win,
      );
    }
    },
  );

  ipcMain.on(IpcChannels.REPORT_RENDERER_STATS, (event, payload: Record<string, unknown>) => {
    if (!isDev) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const label = typeof payload?.['label'] === 'string' ? payload['label'] : 'renderer';
    const details = Object.fromEntries(Object.entries(payload || {}).filter(([key]) => key !== 'label')) as Record<
      string,
      LogValue
    >;
    if (win && !win.isDestroyed()) {
      logElectronMemory(label, details, win);
    } else {
      logElectronMemory(label, details);
    }
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

// Install a .desktop file + icon on first run (or when the AppImage path changes).
// Only runs when launched as an AppImage on Linux — process.env.APPIMAGE is set by
// the AppImage runtime and contains the absolute path to the .AppImage file.
function installDesktopIntegration(): void {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return;

  const appImagePath = process.env.APPIMAGE;
  const storedPath = database.settingsRepo.get('desktopIntegrationAppImage');
  if (storedPath === appImagePath) return; // already up-to-date

  const home = os.homedir();
  const appsDir = path.join(home, '.local', 'share', 'applications');
  const iconDir = path.join(home, '.local', 'share', 'icons', 'hicolor', '1024x1024', 'apps');
  const iconDest = path.join(iconDir, 'comiscopio.png');
  const desktopDest = path.join(appsDir, 'comiscopio.desktop');

  try {
    // Copy icon to standard hicolor theme location
    const iconSrc = path.join(process.resourcesPath, 'icon.png');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(iconSrc, iconDest);

    // Write .desktop file — use absolute icon path to bypass icon theme cache issues
    fs.mkdirSync(appsDir, { recursive: true });
    const desktop = [
      '[Desktop Entry]',
      'Name=Comiscopio',
      'Comment=Visor de cómics y manga',
      `Exec=${appImagePath} %U`,
      `Icon=${iconDest}`,
      'Type=Application',
      'Categories=Graphics;Viewer;',
      'MimeType=application/x-cbz;application/x-cbr;application/x-cb7;application/x-cbt;application/pdf;image/vnd.djvu;application/epub+zip;application/vnd.ms-xpsdocument;',
      'StartupWMClass=Comiscopio',
      'Terminal=false',
      '',
    ].join('\n');
    fs.writeFileSync(desktopDest, desktop, { mode: 0o755 });

    // Mark as trusted so GNOME does not prompt for authorization
    execFile('gio', ['set', desktopDest, 'metadata::trusted', 'true'], () => { /* ignore errors */ });

    // Refresh desktop database and icon cache
    execFile('update-desktop-database', [appsDir], () => { /* ignore errors */ });
    execFile('gtk-update-icon-cache', ['-f', '-t', path.join(home, '.local', 'share', 'icons', 'hicolor')], () => { /* ignore errors */ });

    database.settingsRepo.set('desktopIntegrationAppImage', appImagePath);
  } catch (err) {
    // Non-fatal: log but do not crash
    console.error('[desktop-integration] failed:', err);
  }
}

app.whenReady().then(async () => {
  installFileLogger();
  await initialize();
  installDesktopIntegration();
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
