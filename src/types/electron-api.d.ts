/**
 * Type declarations for the Electron API exposed via contextBridge.
 * This is what the renderer (Angular) sees as window.electronAPI.
 */
export interface ElectronAPI {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
