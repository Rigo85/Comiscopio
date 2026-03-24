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
  fitMode: 'fit-width',
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
