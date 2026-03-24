import { BrowserWindow, screen } from 'electron';
import { APP_NAME } from '../shared/constants';
import { IpcChannels } from '../shared/ipc-channels';

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export class WindowManager {
  private windows = new Map<BrowserWindow, string | null>(); // window → fileHash
  private lastBounds: WindowBounds | null = null;

  constructor(
    private preloadPath: string,
    private rendererUrl: string,
    private saveBounds: (bounds: WindowBounds) => void,
    private loadBounds: () => WindowBounds | null,
  ) {
    this.lastBounds = this.loadBounds();
  }

  createWindow(fileHash?: string): BrowserWindow {
    const bounds = this.getInitialBounds();

    const win = new BrowserWindow({
      ...bounds,
      minWidth: 400,
      minHeight: 300,
      frame: false,
      titleBarStyle: 'hidden',
      title: APP_NAME,
      backgroundColor: '#1a1a1a',
      show: false,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.windows.set(win, fileHash ?? null);
    win.removeMenu();

    // Restore maximized state
    if (bounds.isMaximized) {
      win.maximize();
    }

    // Persist bounds on changes
    const saveBoundsDebounced = this.debounce(() => this.persistBounds(win), 500);
    win.on('resize', saveBoundsDebounced);
    win.on('move', saveBoundsDebounced);

    // Emit state changes to renderer
    win.on('maximize', () => {
      this.persistBounds(win);
      win.webContents.send(IpcChannels.WINDOW_STATE_CHANGED, {
        isMaximized: true,
        isFullscreen: win.isFullScreen(),
        isAlwaysOnTop: win.isAlwaysOnTop(),
      });
    });

    win.on('unmaximize', () => {
      this.persistBounds(win);
      win.webContents.send(IpcChannels.WINDOW_STATE_CHANGED, {
        isMaximized: false,
        isFullscreen: win.isFullScreen(),
        isAlwaysOnTop: win.isAlwaysOnTop(),
      });
    });

    win.on('enter-full-screen', () => {
      win.webContents.send(IpcChannels.WINDOW_STATE_CHANGED, {
        isMaximized: win.isMaximized(),
        isFullscreen: true,
        isAlwaysOnTop: win.isAlwaysOnTop(),
      });
    });

    win.on('leave-full-screen', () => {
      win.webContents.send(IpcChannels.WINDOW_STATE_CHANGED, {
        isMaximized: win.isMaximized(),
        isFullscreen: false,
        isAlwaysOnTop: win.isAlwaysOnTop(),
      });
    });

    win.on('closed', () => {
      this.windows.delete(win);
    });

    win.once('ready-to-show', () => {
      win.show();
      // Open DevTools in dev mode
      if (!require('electron').app.isPackaged) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    });

    win.loadURL(this.rendererUrl);

    return win;
  }

  getFileHashForWindow(win: BrowserWindow): string | null {
    return this.windows.get(win) ?? null;
  }

  setFileHashForWindow(win: BrowserWindow, fileHash: string): void {
    this.windows.set(win, fileHash);
  }

  getAllWindows(): BrowserWindow[] {
    return Array.from(this.windows.keys());
  }

  private getInitialBounds(): { x?: number; y?: number; width: number; height: number; isMaximized: boolean } {
    if (this.lastBounds && this.isBoundsVisible(this.lastBounds)) {
      return this.lastBounds;
    }

    // Offset new windows so they don't stack exactly
    const offset = this.windows.size * 30;
    return {
      width: 1024,
      height: 768,
      x: undefined,
      y: undefined,
      isMaximized: false,
    };
  }

  /** Check if saved bounds are still on a visible display */
  private isBoundsVisible(bounds: WindowBounds): boolean {
    const displays = screen.getAllDisplays();
    return displays.some((display) => {
      const { x, y, width, height } = display.workArea;
      return (
        bounds.x >= x - 100 &&
        bounds.y >= y - 100 &&
        bounds.x < x + width + 100 &&
        bounds.y < y + height + 100
      );
    });
  }

  private persistBounds(win: BrowserWindow): void {
    if (win.isDestroyed() || win.isFullScreen()) return;

    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? (this.lastBounds ?? win.getNormalBounds()) : win.getNormalBounds();

    this.lastBounds = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    };

    this.saveBounds(this.lastBounds);
  }

  private debounce(fn: () => void, ms: number): () => void {
    let timeout: NodeJS.Timeout | null = null;
    return () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(fn, ms);
    };
  }
}
