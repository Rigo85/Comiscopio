import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

const PAGE_PROTOCOL = 'comiscopio-page';

export interface CachedPage {
  index: number;
  url: string;
  width: number;
  height: number;
}

/**
 * Simplified page cache for the native worker pipeline.
 *
 * Pages are served via comiscopio-page:// protocol from the worker's
 * output directory. No base64, no blobs, no memory budget — the native
 * worker does all processing and serves from disk.
 */
@Injectable({ providedIn: 'root' })
export class PageCacheService {
  private fileHash: string | null = null;
  private totalPages = 0;
  private readyPages = new Set<number>();
  private manifestPages: any[] = [];

  windowBefore = 2;
  windowAfter = 3;

  constructor(private electron: ElectronService) {}

  init(fileHash: string, totalPages: number, windowBefore = 2, windowAfter = 3): void {
    this.clear();
    this.fileHash = fileHash;
    this.totalPages = totalPages;
    this.windowBefore = windowBefore;
    this.windowAfter = windowAfter;
  }

  markReady(pageIndex: number): void {
    this.readyPages.add(pageIndex);
  }

  updateManifest(pages: any[]): void {
    this.manifestPages = pages;
  }

  isReady(pageIndex: number): boolean {
    return this.readyPages.has(pageIndex);
  }

  getPageUrl(pageIndex: number): string {
    if (!this.fileHash) return '';
    return `${PAGE_PROTOCOL}://${this.fileHash}/${pageIndex}`;
  }

  getPageMeta(pageIndex: number): CachedPage | null {
    const entry = this.manifestPages[pageIndex];
    if (!entry) return null;
    return {
      index: pageIndex,
      url: this.getPageUrl(pageIndex),
      width: entry.originalWidth || 0,
      height: entry.originalHeight || 0,
    };
  }

  navigateTo(pageIndex: number): string {
    if (!this.fileHash || pageIndex < 0 || pageIndex >= this.totalPages) return '';
    this.electron.workerFocus(this.fileHash, pageIndex);
    return this.getPageUrl(pageIndex);
  }

  clear(): void {
    this.fileHash = null;
    this.totalPages = 0;
    this.readyPages.clear();
    this.manifestPages = [];
  }

  get stats() {
    return { readyPages: this.readyPages.size, totalPages: this.totalPages };
  }
}
