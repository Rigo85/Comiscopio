import * as path from 'path';
import * as os from 'os';

/** Supported image extensions (lowercase) */
export const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tiff', '.tif',
]);

/** Supported archive extensions mapped to format */
export const ARCHIVE_EXTENSIONS: Record<string, string> = {
  '.cbz': 'cbz',
  '.zip': 'cbz',
  '.cbr': 'cbr',
  '.rar': 'cbr',
  '.cb7': 'cb7',
  '.7z': 'cb7',
  '.cbt': 'cbt',
  '.tar': 'cbt',
  '.tgz': 'cbt',
  '.cba': 'ace',
  '.ace': 'ace',
  '.pdf': 'pdf',
  '.djvu': 'djvu',
  '.djv': 'djvu',
  '.epub': 'epub',
  '.xps': 'xps',
};

/** File dialog filters */
export const FILE_FILTERS = [
  {
    name: 'Comics',
    extensions: ['cbz', 'cbr', 'cb7', 'cbt', 'cba', 'ace', 'zip', 'rar', '7z', 'tar', 'tgz', 'pdf', 'djvu', 'djv', 'epub', 'xps'],
  },
  {
    name: 'All Files',
    extensions: ['*'],
  },
];

/** Config directory path */
export function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] || os.homedir(), 'comiscopio');
  }
  return path.join(os.homedir(), '.comiscopio');
}

/** Temp directory for extracted files */
export function getTempDir(): string {
  return path.join(os.tmpdir(), 'comiscopio');
}

/** App name */
export const APP_NAME = 'Comiscopio';

/** Custom protocol to serve thumbnails from worker output */
export const THUMBNAIL_PROTOCOL_SCHEME = 'comiscopio-thumb';

/** Custom protocol to serve reader pages from worker output */
export const PAGE_PROTOCOL_SCHEME = 'comiscopio-page';

/** App version — synced from package.json at build time */
export const APP_VERSION = '0.1.0';
