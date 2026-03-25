/** Reading direction modes */
export type ReadingMode = 'rtl' | 'ltr' | 'vertical';

/** Image fit modes */
export type FitMode = 'fit-width' | 'fit-height' | 'fit-page' | 'original';

/** Page layout */
export type PageLayout = 'single' | 'double';

/** Supported archive formats */
export type ArchiveFormat = 'cbz' | 'cbr' | 'cb7' | 'pdf' | 'folder';

/** Reading progress for a file */
export interface ReadingProgress {
  fileHash: string;
  filePath: string;
  currentPage: number;
  totalPages: number;
  lastRead: string; // ISO timestamp
}

/** Bookmark entry */
export interface Bookmark {
  id?: number;
  fileHash: string;
  page: number;
  name: string;
  createdAt: string;
}

/** Application settings */
export interface AppSettings {
  readingMode: ReadingMode;
  fitMode: FitMode;
  pageLayout: PageLayout;
  theme: 'dark' | 'light';
  slidingWindowSize: number; // pages to keep in memory before/after current
  prefetchCount: number; // pages to prefetch ahead
}

/** Default application settings */
export const DEFAULT_SETTINGS: AppSettings = {
  readingMode: 'ltr',
  fitMode: 'fit-page',
  pageLayout: 'single',
  theme: 'dark',
  slidingWindowSize: 5,
  prefetchCount: 3,
};

/** Page info sent from main to renderer */
export interface PageData {
  index: number;
  totalPages: number;
  imageBase64: string;
  mimeType: string;
  width: number;
  height: number;
}

/** File info after opening */
export interface FileInfo {
  filePath: string;
  fileHash: string;
  format: ArchiveFormat;
  totalPages: number;
  fileName: string;
}

/** Recent file entry */
export interface RecentFile {
  filePath: string;
  fileName: string;
  fileHash: string;
  lastRead: string;
  currentPage: number;
  totalPages: number;
}

export type OpenFileStage = 'preparing' | 'extracting' | 'indexing' | 'ready';

export interface OpenFileSession {
  sessionId: number;
  filePath: string;
  fileName: string;
  info?: FileInfo;
}

export interface OpenFileProgress {
  sessionId: number;
  stage: OpenFileStage;
  message: string;
}

export interface OpenFileComplete {
  sessionId: number;
  info: FileInfo;
}

export interface OpenFileError {
  sessionId: number;
  message: string;
}

export interface MemoryStats {
  mainRssBytes: number;
  rendererHeapUsedBytes: number | null;
  rendererHeapLimitBytes: number | null;
  pageCacheBytes: number;
  pageCachePages: number;
  thumbnailCacheBytes: number;
  thumbnailCacheEntries: number;
}

export interface ThumbnailDescriptor {
  fileHash: string;
  pageIndex: number;
  fileUrl: string;
  bytes: number;
}

export interface ThumbnailReadyEvent extends ThumbnailDescriptor {
  generationMs: number;
}
