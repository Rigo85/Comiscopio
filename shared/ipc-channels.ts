/**
 * IPC channel names shared between main and renderer processes.
 * Single source of truth — import in both preload.ts and electron.service.ts.
 */
export const IpcChannels = {
  // File operations
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FOLDER_DIALOG: 'open-folder-dialog',
  FILE_OPENED: 'file-opened',

  // Native worker lifecycle
  WORKER_START: 'worker-start',
  WORKER_EVENT: 'worker-event',
  WORKER_FOCUS: 'worker-focus',
  WORKER_CLOSE: 'worker-close',
  GET_WORKER_MANIFEST: 'get-worker-manifest',

  // Page/thumb resolution
  REQUEST_PAGE_PATH: 'request-page-path',
  REQUEST_THUMB_PATH: 'request-thumb-path',

  // Reading progress
  SAVE_PROGRESS: 'save-progress',
  GET_PROGRESS: 'get-progress',

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
  REMOVE_RECENT_FILE: 'remove-recent-file',
  CLEANUP_TEMP: 'cleanup-temp',
  REPORT_RENDERER_STATS: 'report-renderer-stats',

  // Settings
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
