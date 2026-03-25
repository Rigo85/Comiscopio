import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels } from '../shared/ipc-channels';

const validInvokeChannels = new Set([
  IpcChannels.OPEN_FILE_DIALOG,
  IpcChannels.OPEN_FOLDER_DIALOG,
  IpcChannels.WORKER_START,
  IpcChannels.SAVE_PROGRESS,
  IpcChannels.GET_PROGRESS,
  IpcChannels.GET_RECENT_FILES,
  IpcChannels.GET_SETTINGS,
  IpcChannels.SAVE_SETTINGS,
  IpcChannels.CLEANUP_TEMP,
  IpcChannels.ADD_BOOKMARK,
  IpcChannels.GET_BOOKMARKS,
  IpcChannels.REMOVE_BOOKMARK,
  IpcChannels.WINDOW_IS_MAXIMIZED,
  IpcChannels.WINDOW_IS_ALWAYS_ON_TOP,
]);

const validSendChannels = new Set([
  IpcChannels.WORKER_FOCUS,
  IpcChannels.WORKER_CLOSE,
  IpcChannels.WINDOW_MINIMIZE,
  IpcChannels.WINDOW_MAXIMIZE,
  IpcChannels.WINDOW_CLOSE,
  IpcChannels.WINDOW_TOGGLE_ALWAYS_ON_TOP,
  IpcChannels.WINDOW_TOGGLE_FULLSCREEN,
  IpcChannels.WINDOW_NEW,
]);

const validOnChannels = new Set([
  IpcChannels.WINDOW_STATE_CHANGED,
  IpcChannels.FILE_OPENED,
  IpcChannels.WORKER_EVENT,
]);

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!validInvokeChannels.has(channel as any)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  send: (channel: string, ...args: unknown[]) => {
    if (!validSendChannels.has(channel as any)) {
      throw new Error(`Invalid send channel: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },

  on: (channel: string, listener: (...args: unknown[]) => void) => {
    if (!validOnChannels.has(channel as any)) {
      throw new Error(`Invalid on channel: ${channel}`);
    }
    const sub = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  },

  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
