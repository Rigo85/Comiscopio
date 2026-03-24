/**
 * IPC channel names shared between main and renderer processes.
 * Single source of truth — import in both preload.ts and electron.service.ts.
 */
export const IpcChannels = {
  // File operations
  OPEN_FILE_DIALOG: 'open-file-dialog',
  FILE_OPENED: 'file-opened',
  OPEN_FILE: 'open-file',

  // Page data
  REQUEST_PAGE: 'request-page',
  PAGE_DATA: 'page-data',
  PAGE_COUNT: 'page-count',

  // Navigation
  NAVIGATE: 'navigate',

  // Reading progress
  SAVE_PROGRESS: 'save-progress',
  GET_PROGRESS: 'get-progress',
  PROGRESS_DATA: 'progress-data',

  // Window controls
  WINDOW_MINIMIZE: 'window-minimize',
  WINDOW_MAXIMIZE: 'window-maximize',
  WINDOW_CLOSE: 'window-close',
  WINDOW_TOGGLE_ALWAYS_ON_TOP: 'window-toggle-always-on-top',
  WINDOW_IS_MAXIMIZED: 'window-is-maximized',
  WINDOW_IS_ALWAYS_ON_TOP: 'window-is-always-on-top',
  WINDOW_TOGGLE_FULLSCREEN: 'window-toggle-fullscreen',
  WINDOW_STATE_CHANGED: 'window-state-changed',
  WINDOW_NEW: 'window-new',

  // Bookmarks
  ADD_BOOKMARK: 'add-bookmark',
  GET_BOOKMARKS: 'get-bookmarks',
  REMOVE_BOOKMARK: 'remove-bookmark',

  // App
  GET_RECENT_FILES: 'get-recent-files',
  RECENT_FILES_DATA: 'recent-files-data',
  CLEANUP_TEMP: 'cleanup-temp',

  // Settings
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  SETTINGS_DATA: 'settings-data',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
