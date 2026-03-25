import { BrowserWindow, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { FileHandler } from './file-handler';
import { IpcChannels } from '../shared/ipc-channels';
import { THUMBNAIL_PROTOCOL_SCHEME } from '../shared/constants';
import { ThumbnailDescriptor, ThumbnailReadyEvent } from '../shared/models';

const THUMB_DIR_NAME = 'thumbnails';
const THUMB_EXTENSION = '.jpg';
const THUMB_MAX_WIDTH = 180;
const THUMB_QUALITY = 60;
const THUMB_RESIZE_QUALITY: Electron.ResizeOptions['quality'] = 'good';
const MAX_CONCURRENT = 1;
const BACKGROUND_PRIORITY_BASE = 100_000;

interface QueueEntry {
  pageIndex: number;
  priority: number;
}

interface ThumbnailSession {
  fileHash: string;
  tempDir: string;
  thumbsDir: string;
  totalPages: number;
  watchers: Set<number>;
  queue: Map<number, QueueEntry>;
  inFlight: Set<number>;
  scheduled: boolean;
  backgroundSeeded: boolean;
}

export class ThumbnailManager {
  private sessions = new Map<string, ThumbnailSession>();

  constructor(private fileHandler: FileHandler) {}

  async initSession(win: BrowserWindow, fileHash: string): Promise<void> {
    const session = this.ensureSession(fileHash);
    if (!session) return;

    session.watchers.add(win.webContents.id);
    this.seedBackgroundQueue(session);
    this.schedule(session);
  }

  async requestRange(
    win: BrowserWindow,
    fileHash: string,
    start: number,
    end: number,
    focusPage: number,
  ): Promise<ThumbnailDescriptor[]> {
    const session = this.ensureSession(fileHash);
    if (!session) return [];

    session.watchers.add(win.webContents.id);

    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(session.totalPages, end);
    for (let pageIndex = clampedStart; pageIndex < clampedEnd; pageIndex++) {
      const distance = Math.abs(pageIndex - focusPage);
      this.enqueue(session, pageIndex, distance);
    }

    this.seedBackgroundQueue(session);
    this.schedule(session);

    const ready: ThumbnailDescriptor[] = [];
    for (let pageIndex = clampedStart; pageIndex < clampedEnd; pageIndex++) {
      const descriptor = this.getDescriptorIfReady(session, pageIndex);
      if (descriptor) {
        ready.push(descriptor);
      }
    }

    return ready;
  }

  closeSession(fileHash: string): void {
    this.sessions.delete(fileHash);
  }

  private ensureSession(fileHash: string): ThumbnailSession | null {
    const existing = this.sessions.get(fileHash);
    if (existing) return existing;

    const opened = this.fileHandler.getOpenedFile(fileHash);
    if (!opened) return null;

    const thumbsDir = path.join(opened.tempDir, THUMB_DIR_NAME);
    fs.mkdirSync(thumbsDir, { recursive: true });

    const session: ThumbnailSession = {
      fileHash,
      tempDir: opened.tempDir,
      thumbsDir,
      totalPages: opened.info.totalPages,
      watchers: new Set(),
      queue: new Map(),
      inFlight: new Set(),
      scheduled: false,
      backgroundSeeded: false,
    };

    this.sessions.set(fileHash, session);
    return session;
  }

  private seedBackgroundQueue(session: ThumbnailSession): void {
    if (session.backgroundSeeded) return;
    session.backgroundSeeded = true;

    for (let pageIndex = 0; pageIndex < session.totalPages; pageIndex++) {
      this.enqueue(session, pageIndex, BACKGROUND_PRIORITY_BASE + pageIndex);
    }
  }

  private enqueue(session: ThumbnailSession, pageIndex: number, priority: number): void {
    if (pageIndex < 0 || pageIndex >= session.totalPages) return;
    if (this.thumbnailExists(session, pageIndex)) return;
    if (session.inFlight.has(pageIndex)) return;

    const existing = session.queue.get(pageIndex);
    if (!existing || priority < existing.priority) {
      session.queue.set(pageIndex, { pageIndex, priority });
    }
  }

  private schedule(session: ThumbnailSession): void {
    if (session.scheduled) return;
    session.scheduled = true;

    setTimeout(() => {
      session.scheduled = false;
      void this.processQueue(session);
    }, 0);
  }

  private async processQueue(session: ThumbnailSession): Promise<void> {
    while (session.inFlight.size < MAX_CONCURRENT) {
      const next = this.dequeueNext(session);
      if (!next) return;

      session.inFlight.add(next.pageIndex);
      void this.generateThumbnail(session, next.pageIndex)
        .catch((error) => {
          console.error('[comiscopio:thumbnail-error]', {
            fileHash: session.fileHash,
            pageIndex: next.pageIndex,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          session.inFlight.delete(next.pageIndex);
          this.schedule(session);
        });
    }
  }

  private dequeueNext(session: ThumbnailSession): QueueEntry | null {
    let next: QueueEntry | null = null;
    for (const entry of session.queue.values()) {
      if (!next || entry.priority < next.priority) {
        next = entry;
      }
    }

    if (!next) return null;
    session.queue.delete(next.pageIndex);
    return next;
  }

  private async generateThumbnail(session: ThumbnailSession, pageIndex: number): Promise<void> {
    const existing = this.getDescriptorIfReady(session, pageIndex);
    if (existing) {
      this.emitReady(session, existing, 0);
      return;
    }

    const pagePath = this.fileHandler.getPagePath(session.fileHash, pageIndex);
    if (!pagePath) return;

    const totalStartedAt = performance.now();
    const decodeStartedAt = performance.now();
    const sourceImage = nativeImage.createFromPath(pagePath);
    const decodeMs = performance.now() - decodeStartedAt;
    if (sourceImage.isEmpty()) {
      return;
    }

    const sourceSize = sourceImage.getSize();
    const targetWidth = Math.max(1, Math.min(THUMB_MAX_WIDTH, sourceSize.width));

    const resizeStartedAt = performance.now();
    const resized = sourceImage.resize({
      width: targetWidth,
      quality: THUMB_RESIZE_QUALITY,
    });
    const resizeMs = performance.now() - resizeStartedAt;

    const encodeStartedAt = performance.now();
    const jpeg = resized.toJPEG(THUMB_QUALITY);
    const encodeMs = performance.now() - encodeStartedAt;

    const thumbPath = this.getThumbPath(session, pageIndex);
    const writeStartedAt = performance.now();
    await fs.promises.writeFile(thumbPath, jpeg);
    const writeMs = performance.now() - writeStartedAt;

    const descriptor: ThumbnailDescriptor = {
      fileHash: session.fileHash,
      pageIndex,
      fileUrl: this.getThumbnailUrl(session.fileHash, pageIndex),
      bytes: jpeg.byteLength,
    };

    console.log('[comiscopio:perf]', {
      kind: 'thumbnail-build',
      fileHash: session.fileHash,
      pageIndex,
      totalMs: Math.round(performance.now() - totalStartedAt),
      decodeMs: Math.round(decodeMs),
      resizeMs: Math.round(resizeMs),
      encodeMs: Math.round(encodeMs),
      writeMs: Math.round(writeMs),
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      outputWidth: resized.getSize().width,
      outputHeight: resized.getSize().height,
      bytes: jpeg.byteLength,
      format: 'image/jpeg',
      quality: THUMB_QUALITY,
      resizeQuality: THUMB_RESIZE_QUALITY,
    });

    this.emitReady(session, descriptor, performance.now() - totalStartedAt);
  }

  private emitReady(session: ThumbnailSession, descriptor: ThumbnailDescriptor, generationMs: number): void {
    const payload: ThumbnailReadyEvent = {
      ...descriptor,
      generationMs: Math.round(generationMs),
    };

    for (const webContentsId of session.watchers) {
      const target = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === webContentsId);
      if (!target || target.isDestroyed()) continue;
      target.webContents.send(IpcChannels.THUMBNAIL_READY, payload);
    }
  }

  private thumbnailExists(session: ThumbnailSession, pageIndex: number): boolean {
    return fs.existsSync(this.getThumbPath(session, pageIndex));
  }

  private getDescriptorIfReady(session: ThumbnailSession, pageIndex: number): ThumbnailDescriptor | null {
    const thumbPath = this.getThumbPath(session, pageIndex);
    if (!fs.existsSync(thumbPath)) return null;

    const stats = fs.statSync(thumbPath);
    return {
      fileHash: session.fileHash,
      pageIndex,
      fileUrl: this.getThumbnailUrl(session.fileHash, pageIndex),
      bytes: stats.size,
    };
  }

  private getThumbPath(session: ThumbnailSession, pageIndex: number): string {
    return path.join(session.thumbsDir, `${String(pageIndex).padStart(6, '0')}${THUMB_EXTENSION}`);
  }

  private getThumbnailUrl(fileHash: string, pageIndex: number): string {
    return `${THUMBNAIL_PROTOCOL_SCHEME}://${fileHash}/${pageIndex}`;
  }
}
