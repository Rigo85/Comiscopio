import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

export interface CachedPage {
  index: number;
  blobUrl: string;
  mimeType: string;
  width: number;
  height: number;
  size: number; // approximate memory size in bytes
}

/**
 * Sliding window page cache.
 *
 * Keeps only a configurable number of pages in memory as Blob URLs.
 * Pre-fetches pages ahead of the current position.
 * Automatically evicts pages outside the window, revoking Blob URLs.
 *
 * Flow:
 * 1. goToPage(n) → ensure page n is cached, display it
 * 2. Trigger prefetch for pages n+1..n+prefetchCount
 * 3. Evict pages outside [n - windowBehind, n + windowAhead]
 */
@Injectable({ providedIn: 'root' })
export class PageCacheService {
  private cache = new Map<number, CachedPage>();
  private pendingRequests = new Map<number, Promise<CachedPage | null>>();
  private currentFileHash: string | null = null;
  private totalPages = 0;

  /** Pages to keep behind current position */
  windowBehind = 3;
  /** Pages to keep ahead of current position */
  windowAhead = 5;
  /** Pages to prefetch ahead (subset of windowAhead) */
  prefetchCount = 3;

  private _totalCacheSize = 0;

  constructor(private electron: ElectronService) {}

  /** Initialize cache for a new file */
  init(fileHash: string, totalPages: number, windowBehind = 3, windowAhead = 5, prefetchCount = 3): void {
    this.clear();
    this.currentFileHash = fileHash;
    this.totalPages = totalPages;
    this.windowBehind = windowBehind;
    this.windowAhead = windowAhead;
    this.prefetchCount = prefetchCount;
  }

  /** Get a page's blob URL. Fetches if not cached. Returns null on failure. */
  async getPage(index: number): Promise<string | null> {
    if (!this.currentFileHash || index < 0 || index >= this.totalPages) return null;

    const cached = this.cache.get(index);
    if (cached) return cached.blobUrl;

    const page = await this.fetchPage(index);
    return page?.blobUrl ?? null;
  }

  /** Get cached page metadata (dimensions). Returns null if not cached. */
  getCachedMeta(index: number): CachedPage | null {
    return this.cache.get(index) ?? null;
  }

  /**
   * Navigate to a page: fetch it, prefetch ahead, evict outside window.
   * Returns the CachedPage with blob URL and dimensions.
   */
  async navigateTo(index: number): Promise<CachedPage | null> {
    if (!this.currentFileHash || index < 0 || index >= this.totalPages) return null;

    let cached = this.cache.get(index);
    if (!cached) {
      cached = await this.fetchPage(index) ?? undefined;
    }

    // Trigger async prefetch (non-blocking)
    this.prefetchAround(index);

    // Evict pages outside the window
    this.evictOutsideWindow(index);

    return cached ?? null;
  }

  /** Clear all cached pages and revoke all blob URLs */
  clear(): void {
    for (const page of this.cache.values()) {
      URL.revokeObjectURL(page.blobUrl);
    }
    this.cache.clear();
    this.pendingRequests.clear();
    this.currentFileHash = null;
    this.totalPages = 0;
    this._totalCacheSize = 0;
  }

  /** Current cache stats */
  get stats(): { cachedPages: number; totalSizeBytes: number } {
    return {
      cachedPages: this.cache.size,
      totalSizeBytes: this._totalCacheSize,
    };
  }

  // --- Private ---

  private async fetchPage(index: number): Promise<CachedPage | null> {
    if (!this.currentFileHash) return null;

    // Deduplicate concurrent requests for the same page
    const pending = this.pendingRequests.get(index);
    if (pending) return pending;

    const promise = this.doFetchPage(index);
    this.pendingRequests.set(index, promise);

    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(index);
    }
  }

  private async doFetchPage(index: number): Promise<CachedPage | null> {
    if (!this.currentFileHash) return null;

    try {
      const pageData = await this.electron.requestPage(this.currentFileHash, index);
      if (!pageData) return null;

      // Convert base64 to Blob URL (much more memory-efficient than data URIs)
      const binary = atob(pageData.imageBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: pageData.mimeType });
      const blobUrl = URL.createObjectURL(blob);

      const cached: CachedPage = {
        index,
        blobUrl,
        mimeType: pageData.mimeType,
        width: pageData.width,
        height: pageData.height,
        size: bytes.byteLength,
      };

      this.cache.set(index, cached);
      this._totalCacheSize += cached.size;

      return cached;
    } catch (err) {
      console.error(`Failed to fetch page ${index}:`, err);
      return null;
    }
  }

  /** Prefetch pages around the current index (non-blocking) */
  private prefetchAround(currentIndex: number): void {
    for (let i = 1; i <= this.prefetchCount; i++) {
      const ahead = currentIndex + i;
      if (ahead < this.totalPages && !this.cache.has(ahead) && !this.pendingRequests.has(ahead)) {
        // Fire and forget — don't await
        this.fetchPage(ahead);
      }
    }

    // Also prefetch 1 page behind for quick back-navigation
    const behind = currentIndex - 1;
    if (behind >= 0 && !this.cache.has(behind) && !this.pendingRequests.has(behind)) {
      this.fetchPage(behind);
    }
  }

  /** Evict pages outside the sliding window to free memory */
  private evictOutsideWindow(currentIndex: number): void {
    const minKeep = currentIndex - this.windowBehind;
    const maxKeep = currentIndex + this.windowAhead;

    const toEvict: number[] = [];
    for (const [pageIndex, page] of this.cache) {
      if (pageIndex < minKeep || pageIndex > maxKeep) {
        toEvict.push(pageIndex);
        URL.revokeObjectURL(page.blobUrl);
        this._totalCacheSize -= page.size;
      }
    }

    for (const idx of toEvict) {
      this.cache.delete(idx);
    }
  }
}
