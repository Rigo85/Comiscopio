import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';
import { ThumbnailDescriptor, ThumbnailReadyEvent } from '../../../shared/models';

interface ThumbnailEntry {
  pageIndex: number;
  fileUrl: string;
  bytes: number;
  lastAccessed: number;
}

@Injectable({ providedIn: 'root' })
export class ThumbnailCacheService {
  private cache = new Map<number, ThumbnailEntry>();
  private fileHash: string | null = null;
  private totalPages = 0;
  private readonly maxEntries = 40;
  private listeners = new Set<(pageIndex: number, fileUrl: string) => void>();

  constructor(private electron: ElectronService) {
    this.electron.onThumbnailReady((event) => {
      this.handleThumbnailReady(event);
    });
  }

  init(fileHash: string, totalPages: number): void {
    this.clear();
    this.fileHash = fileHash;
    this.totalPages = totalPages;
    void this.electron.initThumbnails(fileHash);
  }

  clear(): void {
    this.cache.clear();
    this.fileHash = null;
    this.totalPages = 0;
  }

  subscribe(listener: (pageIndex: number, fileUrl: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async requestRange(start: number, end: number, focusPage: number): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (!this.fileHash || start >= end) return result;

    const ready = await this.electron.requestThumbnailRange(this.fileHash, start, end, focusPage);
    for (const descriptor of ready) {
      const entry = this.upsert(descriptor);
      result.set(entry.pageIndex, entry.fileUrl);
    }

    return result;
  }

  getThumbnail(pageIndex: number): string | null {
    const cached = this.cache.get(pageIndex);
    if (!cached) return null;
    cached.lastAccessed = Date.now();
    return cached.fileUrl;
  }

  private handleThumbnailReady(event: ThumbnailReadyEvent): void {
    if (!this.fileHash || event.fileHash !== this.fileHash) return;
    const entry = this.upsert(event);
    for (const listener of this.listeners) {
      listener(entry.pageIndex, entry.fileUrl);
    }
  }

  private upsert(descriptor: ThumbnailDescriptor): ThumbnailEntry {
    const existing = this.cache.get(descriptor.pageIndex);
    if (existing) {
      existing.fileUrl = descriptor.fileUrl;
      existing.bytes = descriptor.bytes;
      existing.lastAccessed = Date.now();
      return existing;
    }

    const entry: ThumbnailEntry = {
      pageIndex: descriptor.pageIndex,
      fileUrl: descriptor.fileUrl,
      bytes: descriptor.bytes,
      lastAccessed: Date.now(),
    };

    this.cache.set(entry.pageIndex, entry);
    this.evictOverflow();
    return entry;
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxEntries) {
      let oldest: ThumbnailEntry | null = null;
      for (const entry of this.cache.values()) {
        if (!oldest || entry.lastAccessed < oldest.lastAccessed) {
          oldest = entry;
        }
      }

      if (!oldest) return;
      this.cache.delete(oldest.pageIndex);
    }
  }

  get stats(): { cachedEntries: number; totalSizeBytes: number } {
    let totalSizeBytes = 0;
    for (const entry of this.cache.values()) {
      totalSizeBytes += entry.bytes;
    }
    return {
      cachedEntries: this.cache.size,
      totalSizeBytes,
    };
  }
}
