import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import sizeOf from 'image-size';
import { TempManager } from './temp-manager';
import { IMAGE_EXTENSIONS, ARCHIVE_EXTENSIONS } from '../shared/constants';
import { FileInfo, PageData, ArchiveFormat } from '../shared/models';
import { Extractor } from './extractors/extractor.interface';
import { CbzExtractor } from './extractors/cbz.extractor';
import { CbrExtractor } from './extractors/cbr.extractor';
import { Cb7Extractor } from './extractors/cb7.extractor';
import { PdfExtractor } from './extractors/pdf.extractor';
import { FolderExtractor } from './extractors/folder.extractor';

/** Tracks an opened file's state */
interface OpenedFile {
  info: FileInfo;
  tempDir: string;
  pageFiles: string[];
}

export interface FileDescriptor {
  filePath: string;
  fileName: string;
  fileHash: string;
  format: ArchiveFormat;
  isDirectory: boolean;
}

export class FileHandler {
  private openedFiles = new Map<string, OpenedFile>();

  constructor(private tempManager: TempManager) {}

  describeFile(filePath: string): FileDescriptor {
    filePath = path.resolve(filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const isDirectory = stat.isDirectory();
    const format = isDirectory ? 'folder' as ArchiveFormat : this.detectFormat(filePath);
    if (!format) {
      throw new Error(`Formato no soportado: ${path.extname(filePath)}`);
    }

    return {
      filePath,
      fileName: path.basename(filePath),
      fileHash: this.computeHash(filePath, stat),
      format,
      isDirectory,
    };
  }

  createTempDir(fileHash: string): string {
    return this.tempManager.create(fileHash);
  }

  registerOpenedFile(info: FileInfo, tempDir: string, pageFiles: string[]): void {
    this.openedFiles.set(info.fileHash, { info, tempDir, pageFiles });
  }

  getOpenedFile(fileHash: string): OpenedFile | null {
    return this.openedFiles.get(fileHash) ?? null;
  }

  getPagePath(fileHash: string, pageIndex: number): string | null {
    const opened = this.openedFiles.get(fileHash);
    if (!opened) return null;
    if (pageIndex < 0 || pageIndex >= opened.pageFiles.length) return null;
    return opened.pageFiles[pageIndex] ?? null;
  }

  /** Open a comic file: detect format, extract, index pages */
  async openFile(filePath: string): Promise<FileInfo> {
    const descriptor = this.describeFile(filePath);
    const { filePath: resolvedPath, fileHash, format, fileName, isDirectory } = descriptor;

    // If already opened, return existing info
    const existing = this.openedFiles.get(fileHash);
    if (existing) {
      return existing.info;
    }

    const extractor = this.getExtractor(format);
    const tempDir = this.tempManager.create(fileHash);

    try {
      await extractor.extract(resolvedPath, tempDir);
    } catch (err: any) {
      this.tempManager.cleanup(fileHash);
      throw new Error(`Error al extraer ${fileName}: ${err.message}`);
    }

    const pageFiles = this.indexPages(isDirectory ? resolvedPath : tempDir);
    if (pageFiles.length === 0) {
      this.tempManager.cleanup(fileHash);
      throw new Error('No se encontraron imágenes en el archivo');
    }

    const info: FileInfo = {
      filePath: resolvedPath,
      fileHash,
      format,
      totalPages: pageFiles.length,
      fileName,
    };

    this.registerOpenedFile(info, tempDir, pageFiles);
    return info;
  }

  /** Get a specific page's image data */
  async getPage(fileHash: string, pageIndex: number): Promise<PageData | null> {
    const opened = this.openedFiles.get(fileHash);
    if (!opened) return null;
    if (pageIndex < 0 || pageIndex >= opened.pageFiles.length) return null;

    const imgPath = opened.pageFiles[pageIndex];

    const realPath = fs.realpathSync(imgPath);
    const buffer = await fs.promises.readFile(realPath);
    const ext = path.extname(imgPath).toLowerCase();
    const mimeType = this.getMimeType(ext);

    // Get image dimensions for spread detection
    let width = 0;
    let height = 0;
    try {
      const dims = sizeOf(buffer);
      width = dims.width ?? 0;
      height = dims.height ?? 0;
    } catch { /* ignore dimension errors */ }

    return {
      index: pageIndex,
      totalPages: opened.info.totalPages,
      imageBase64: buffer.toString('base64'),
      mimeType,
      width,
      height,
    };
  }

  /** Close a file and clean up its temp directory */
  closeFile(fileHash: string): void {
    const opened = this.openedFiles.get(fileHash);
    if (opened) {
      this.openedFiles.delete(fileHash);
      this.tempManager.cleanup(fileHash);
    }
  }

  /** Check if a path is a supported format */
  static isSupportedPath(filePath: string): boolean {
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return true;
      const ext = path.extname(filePath).toLowerCase();
      return ext in ARCHIVE_EXTENSIONS;
    } catch {
      return false;
    }
  }

  private detectFormat(filePath: string): ArchiveFormat | null {
    const ext = path.extname(filePath).toLowerCase();
    return (ARCHIVE_EXTENSIONS[ext] as ArchiveFormat) ?? null;
  }

  private computeHash(filePath: string, stat: fs.Stats): string {
    const data = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  private getExtractor(format: ArchiveFormat): Extractor {
    switch (format) {
      case 'cbz':
        return new CbzExtractor();
      case 'cbr':
        return new CbrExtractor();
      case 'cb7':
        return new Cb7Extractor();
      case 'pdf':
        return new PdfExtractor();
      case 'folder':
        return new FolderExtractor();
      default:
        throw new Error(`Extractor no implementado para formato: ${format}`);
    }
  }

  /** Index all image files in a directory, sorted naturally */
  private indexPages(dir: string): string[] {
    const files = this.walkDir(dir);
    return files
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => this.naturalCompare(path.basename(a), path.basename(b)));
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }

  private naturalCompare(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
