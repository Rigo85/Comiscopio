import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

const MAX_CACHE_BYTES = 48 * 1024 * 1024;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_DIMENSION = 4500;
const MAX_PAGE_PIXELS = 18_000_000;

export interface CachedPage {
  index: number;
  blobUrl: string;
  mimeType: string;
  width: number;
  height: number;
  size: number; // approximate memory size in bytes
  originalSize: number;
  isDegraded: boolean;
  degradeReason: string | null;
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
  private currentIndex = 0;
  private fullQualityOverrides = new Set<number>();

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
    this.currentIndex = index;

    let cached = this.cache.get(index);
    if (!cached) {
      cached = await this.fetchPage(index) ?? undefined;
    }

    // Trigger async prefetch (non-blocking)
    this.prefetchAround(index);

    // Evict pages outside the window
    this.evictOutsideWindow(index);
    this.evictToBudget(index);

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
    this.currentIndex = 0;
    this.fullQualityOverrides.clear();
  }

  /** Current cache stats */
  get stats(): { cachedPages: number; totalSizeBytes: number } {
    return {
      cachedPages: this.cache.size,
      totalSizeBytes: this._totalCacheSize,
    };
  }

  shouldOfferFullQuality(index: number): boolean {
    return this.cache.get(index)?.isDegraded ?? false;
  }

  async loadFullQuality(index: number): Promise<CachedPage | null> {
    this.fullQualityOverrides.add(index);
    this.removeFromCache(index);
    return this.navigateTo(index);
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
      const totalStartedAt = performance.now();
      const requestStartedAt = totalStartedAt;
      const pageData = await this.electron.requestPage(this.currentFileHash, index);
      if (!pageData) return null;
      const fetchMs = performance.now() - requestStartedAt;

      const base64DecodeStartedAt = performance.now();
      const binary = atob(pageData.imageBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const base64DecodeMs = performance.now() - base64DecodeStartedAt;

      const originalSize = bytes.byteLength;
      const blobStartedAt = performance.now();
      const sourceBlob = new Blob([bytes], { type: pageData.mimeType });
      const blobMs = performance.now() - blobStartedAt;
      const transformStartedAt = performance.now();
      const useFullQuality = this.fullQualityOverrides.has(index);
      const degradeReason = !useFullQuality ? this.getDegradeReason(originalSize, pageData.width, pageData.height) : null;
      const transformed = degradeReason
        ? await this.createReducedBlob(sourceBlob, pageData.mimeType, pageData.width, pageData.height)
        : null;
      const transformMs = performance.now() - transformStartedAt;
      const blob = transformed?.blob ?? sourceBlob;
      const objectUrlStartedAt = performance.now();
      const blobUrl = URL.createObjectURL(blob);
      const objectUrlMs = performance.now() - objectUrlStartedAt;

      const cached: CachedPage = {
        index,
        blobUrl,
        mimeType: transformed?.mimeType ?? pageData.mimeType,
        width: pageData.width,
        height: pageData.height,
        size: blob.size,
        originalSize,
        isDegraded: !!transformed,
        degradeReason,
      };

      this.removeFromCache(index);
      this.cache.set(index, cached);
      this._totalCacheSize += cached.size;
      this.evictToBudget(this.currentIndex);

      if (index === this.currentIndex || cached.isDegraded) {
        this.electron.logPerformanceEvent({
          kind: 'page-fetch',
          index,
          totalMs: Math.round(performance.now() - totalStartedAt),
          fetchMs: Math.round(fetchMs),
          base64DecodeMs: Math.round(base64DecodeMs),
          blobMs: Math.round(blobMs),
          transformMs: Math.round(transformMs),
          objectUrlMs: Math.round(objectUrlMs),
          originalBytes: originalSize,
          cachedBytes: cached.size,
          width: pageData.width,
          height: pageData.height,
          pixels: pageData.width * pageData.height,
          degraded: cached.isDegraded,
          degradeReason: cached.degradeReason,
          transformDetails: transformed?.details ?? null,
        });
      }

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

  private evictToBudget(currentIndex: number): void {
    while (this._totalCacheSize > MAX_CACHE_BYTES && this.cache.size > 1) {
      let candidate: CachedPage | null = null;

      for (const page of this.cache.values()) {
        if (page.index === currentIndex) continue;
        if (!candidate) {
          candidate = page;
          continue;
        }

        const candidateDistance = Math.abs(candidate.index - currentIndex);
        const pageDistance = Math.abs(page.index - currentIndex);
        if (pageDistance > candidateDistance || (pageDistance === candidateDistance && page.size > candidate.size)) {
          candidate = page;
        }
      }

      if (!candidate) break;
      this.removeFromCache(candidate.index);
    }
  }

  private removeFromCache(index: number): void {
    const existing = this.cache.get(index);
    if (!existing) return;
    URL.revokeObjectURL(existing.blobUrl);
    this._totalCacheSize -= existing.size;
    this.cache.delete(index);
  }

  private getDegradeReason(sizeBytes: number, width: number, height: number): string | null {
    if (sizeBytes > MAX_PAGE_BYTES) {
      return 'bytes';
    }
    if (Math.max(width, height) > MAX_PAGE_DIMENSION) {
      return 'dimension';
    }
    if (width * height > MAX_PAGE_PIXELS) {
      return 'pixels';
    }
    return null;
  }

  private async createReducedBlob(sourceBlob: Blob, mimeType: string, width: number, height: number): Promise<{ blob: Blob; mimeType: string; details: Record<string, number | string> } | null> {
    const bitmapStartedAt = performance.now();
    const bitmap = await createImageBitmap(sourceBlob);
    const bitmapMs = performance.now() - bitmapStartedAt;

    try {
      const candidates = [
        { maxDimension: 2400, quality: 0.82 },
        { maxDimension: 2000, quality: 0.76 },
        { maxDimension: 1600, quality: 0.7 },
      ];

      for (const candidate of candidates) {
        const result = await this.renderReducedBlob(bitmap, candidate.maxDimension, candidate.quality);
        if (result && result.blob.size <= MAX_PAGE_BYTES) {
          return {
            ...result,
            details: {
              bitmapMs: Math.round(bitmapMs),
              drawMs: result.details.drawMs,
              encodeMs: result.details.encodeMs,
              maxDimension: candidate.maxDimension,
              quality: candidate.quality,
              outputWidth: result.details.outputWidth,
              outputHeight: result.details.outputHeight,
              format: result.mimeType,
            },
          };
        }
      }

      const fallback = await this.renderReducedBlob(bitmap, 1400, 0.65);
      if (!fallback) return null;
      return {
        ...fallback,
        details: {
          bitmapMs: Math.round(bitmapMs),
          drawMs: fallback.details.drawMs,
          encodeMs: fallback.details.encodeMs,
          maxDimension: 1400,
          quality: 0.65,
          outputWidth: fallback.details.outputWidth,
          outputHeight: fallback.details.outputHeight,
          format: fallback.mimeType,
        },
      };
    } finally {
      bitmap.close();
    }
  }

  private async renderReducedBlob(bitmap: ImageBitmap, maxDimension: number, quality: number): Promise<{ blob: Blob; mimeType: string; details: { drawMs: number; encodeMs: number; outputWidth: number; outputHeight: number } } | null> {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;

    const drawStartedAt = performance.now();
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const drawMs = performance.now() - drawStartedAt;
    const encodeStartedAt = performance.now();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/webp', quality);
    });
    const encodeMs = performance.now() - encodeStartedAt;
    if (!blob) return null;
    return {
      blob,
      mimeType: 'image/webp',
      details: {
        drawMs: Math.round(drawMs),
        encodeMs: Math.round(encodeMs),
        outputWidth: canvas.width,
        outputHeight: canvas.height,
      },
    };
  }
}
