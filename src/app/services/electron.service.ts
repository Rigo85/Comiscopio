import { Injectable } from '@angular/core';
import type { ElectronAPI } from '../../types/electron-api';
import type { ReadingProgress, AppSettings, RecentFile, Bookmark } from '../../../shared/models';
import { IpcChannels } from '../../../shared/ipc-channels';

@Injectable({ providedIn: 'root' })
export class ElectronService {
  private api: ElectronAPI;

  constructor() {
    if (!window.electronAPI) {
      console.warn('electronAPI not available — running outside Electron?');
    }
    this.api = window.electronAPI;
  }

  get isElectron(): boolean {
    return !!window.electronAPI;
  }

  // --- File dialogs ---

  async openFileDialog(): Promise<string | null> {
    return (await this.api.invoke(IpcChannels.OPEN_FILE_DIALOG)) as string | null;
  }

  async openFolderDialog(): Promise<string | null> {
    return (await this.api.invoke(IpcChannels.OPEN_FOLDER_DIALOG)) as string | null;
  }

  // --- Native worker ---

  async workerStart(filePath: string): Promise<{
    fileHash: string;
    fileName: string;
    filePath: string;
    totalPages: number;
    alreadyOpen: boolean;
  }> {
    return (await this.api.invoke(IpcChannels.WORKER_START, filePath)) as any;
  }

  async getWorkerManifest(fileHash: string): Promise<any | null> {
    return (await this.api.invoke(IpcChannels.GET_WORKER_MANIFEST, fileHash)) as any;
  }

  workerFocus(fileHash: string, page: number): void {
    this.api.send(IpcChannels.WORKER_FOCUS, fileHash, page);
  }

  workerClose(fileHash: string): void {
    this.api.send(IpcChannels.WORKER_CLOSE, fileHash);
  }

  onWorkerEvent(listener: (event: any) => void): () => void {
    return this.api.on(IpcChannels.WORKER_EVENT, listener as any);
  }

  // --- Reading progress ---

  async saveProgress(progress: ReadingProgress): Promise<void> {
    await this.api.invoke(IpcChannels.SAVE_PROGRESS, progress);
  }

  async getProgress(fileHash: string): Promise<ReadingProgress | null> {
    return (await this.api.invoke(IpcChannels.GET_PROGRESS, fileHash)) as ReadingProgress | null;
  }

  async getRecentFiles(): Promise<RecentFile[]> {
    return (await this.api.invoke(IpcChannels.GET_RECENT_FILES)) as RecentFile[];
  }

  // --- Bookmarks ---

  async addBookmark(bookmark: Bookmark): Promise<void> {
    await this.api.invoke(IpcChannels.ADD_BOOKMARK, bookmark);
  }

  async getBookmarks(fileHash: string): Promise<Bookmark[]> {
    return (await this.api.invoke(IpcChannels.GET_BOOKMARKS, fileHash)) as Bookmark[];
  }

  async removeBookmark(id: number): Promise<void> {
    await this.api.invoke(IpcChannels.REMOVE_BOOKMARK, id);
  }

  // --- Settings ---

  async getSettings(): Promise<AppSettings> {
    return (await this.api.invoke(IpcChannels.GET_SETTINGS)) as AppSettings;
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    await this.api.invoke(IpcChannels.SAVE_SETTINGS, settings);
  }

  // --- Window controls ---

  minimize(): void { this.api.send(IpcChannels.WINDOW_MINIMIZE); }
  maximize(): void { this.api.send(IpcChannels.WINDOW_MAXIMIZE); }
  close(): void { this.api.send(IpcChannels.WINDOW_CLOSE); }
  toggleAlwaysOnTop(): void { this.api.send(IpcChannels.WINDOW_TOGGLE_ALWAYS_ON_TOP); }
  toggleFullscreen(): void { this.api.send(IpcChannels.WINDOW_TOGGLE_FULLSCREEN); }
  newWindow(): void { this.api.send(IpcChannels.WINDOW_NEW); }

  async getWindowState(): Promise<WindowState> {
    return (await this.api.invoke(IpcChannels.WINDOW_IS_MAXIMIZED)) as WindowState;
  }

  onWindowStateChanged(listener: (state: WindowState) => void): () => void {
    return this.api.on(IpcChannels.WINDOW_STATE_CHANGED, listener as any);
  }

  onFileOpened(listener: (filePath: string) => void): () => void {
    return this.api.on(IpcChannels.FILE_OPENED, listener as any);
  }

  // --- Helpers ---

  getPathForFile(file: File): string {
    return this.api.getPathForFile(file);
  }
}

export interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isAlwaysOnTop: boolean;
}
