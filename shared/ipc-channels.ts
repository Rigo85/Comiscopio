/**
 * IPC channel names shared between main and renderer processes.
 * Single source of truth — import in both preload.ts and electron.service.ts.
 */
export const IpcChannels = {
  // File operations
  OPEN_FILE_DIALOG: 'open-file-dialog',
  OPEN_FOLDER_DIALOG: 'open-folder-dialog',
  FILE_OPENED: 'file-opened',
  OPEN_FILE: 'open-file',
  OPEN_FILE_START: 'open-file-start',
  OPEN_FILE_CANCEL: 'open-file-cancel',
  OPEN_FILE_PROGRESS: 'open-file-progress',
  OPEN_FILE_COMPLETE: 'open-file-complete',
  OPEN_FILE_ERROR: 'open-file-error',
  OPEN_FILE_CANCELLED: 'open-file-cancelled',

  // Page data
  REQUEST_PAGE: 'request-page',
  PAGE_DATA: 'page-data',
  PAGE_COUNT: 'page-count',
  THUMBNAILS_INIT: 'thumbnails-init',
  THUMBNAILS_REQUEST_RANGE: 'thumbnails-request-range',
  THUMBNAIL_READY: 'thumbnail-ready',

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
  GET_MEMORY_STATS: 'get-memory-stats',
  LOG_MEMORY_STATS: 'log-memory-stats',
  LOG_PERFORMANCE_EVENT: 'log-performance-event',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
