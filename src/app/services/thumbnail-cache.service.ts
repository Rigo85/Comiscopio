import { Injectable } from '@angular/core';
const THUMB_PROTOCOL = 'comiscopio-thumb';

/**
 * Simplified thumbnail cache for the native worker pipeline.
 *
 * Thumbnails are served via comiscopio-thumb:// protocol from the
 * worker's output directory. This service tracks availability and
 * provides URLs.
 */
@Injectable({ providedIn: 'root' })
export class ThumbnailCacheService {
  private fileHash: string | null = null;
  private readyThumbs = new Set<number>();
  private thumbVersions = new Map<number, number>();
  private generation = 0;
  private listeners: Array<(pageIndex: number, url: string) => void> = [];

  init(fileHash: string): void {
    this.generation++;
    this.clear();
    this.fileHash = fileHash;
  }

  markReady(pageIndex: number): void {
    if (!this.fileHash) return;
    this.readyThumbs.add(pageIndex);
    this.thumbVersions.set(pageIndex, (this.thumbVersions.get(pageIndex) ?? 0) + 1);
    const url = this.getThumbUrl(pageIndex);
    for (const listener of this.listeners) {
      listener(pageIndex, url);
    }
  }

  isReady(pageIndex: number): boolean {
    return this.readyThumbs.has(pageIndex);
  }

  getThumbUrl(pageIndex: number): string {
    if (!this.fileHash) return '';
    const rev = this.thumbVersions.get(pageIndex) ?? 0;
    return `${THUMB_PROTOCOL}://${this.fileHash}/${pageIndex}?gen=${this.generation}&rev=${rev}`;
  }

  /** Mark thumbs as ready from page-cache manifest entries. */
  syncReadyFromManifest(manifestPages: any[]): void {
    for (let i = 0; i < manifestPages.length; i++) {
      const entry = manifestPages[i];
      if (entry?.thumb && !this.readyThumbs.has(i)) {
        this.markReady(i);
      }
    }
  }

  subscribe(listener: (pageIndex: number, url: string) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  clear(): void {
    this.fileHash = null;
    this.readyThumbs.clear();
    this.thumbVersions.clear();
  }
}
