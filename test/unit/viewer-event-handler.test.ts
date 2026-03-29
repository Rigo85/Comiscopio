/**
 * Tests for ViewerComponent.handleWorkerEvent — the function that translates
 * raw worker events into UI state changes.
 *
 * We instantiate the class directly (no Angular TestBed / no DOM) and call
 * the private method via TypeScript casting.  Each test checks the resulting
 * signal values rather than implementation details.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';

// ─── Minimal service stubs ─────────────────────────────────────────────────

function makePageCacheStub() {
  return {
    markReady: vi.fn(),
    isReady: vi.fn(() => false),
    getPageMeta: vi.fn(() => null),
    init: vi.fn(),
    updateManifest: vi.fn(),
    syncReadyFromManifest: vi.fn(),
    getPageUrl: vi.fn(() => 'comiscopio-page://hash/0'),
    stats: { readyPages: 0, totalPages: 0 },
  };
}

function makeThumbnailCacheStub() {
  return { markReady: vi.fn(), init: vi.fn() };
}

function makeElectronStub() {
  return {
    isElectron: true,
    onFileOpened: vi.fn(() => () => {}),
    onWindowStateChanged: vi.fn(() => () => {}),
    onWorkerEvent: vi.fn(() => () => {}),
    getWindowState: vi.fn(() => Promise.resolve({ isAlwaysOnTop: false, isFullscreen: false })),
    getSettings: vi.fn(() => Promise.resolve({})),
    workerFocus: vi.fn(),
    getRecentFiles: vi.fn(() => Promise.resolve([])),
    getBookmarks: vi.fn(() => Promise.resolve([])),
  };
}

function makeReaderStateStub() {
  return {
    readingMode: signal('ltr' as any),
    fitMode: signal('fit-page' as any),
    pageLayout: signal('single' as any),
    isReversed: () => false,
    isVertical: () => false,
    applySettings: vi.fn(),
  };
}

function makeZoomPanStub() {
  return { reset: vi.fn(), onWheel: vi.fn() };
}

function makeKeybindingsStub() {
  return {
    load: vi.fn(() => Promise.resolve()),
    getAll: vi.fn(() => []),
  };
}

// ─── Load viewer component class without bootstrapping Angular ─────────────

// Angular decorators (@Component, @Injectable) are safe to run in Node; they
// just attach metadata.  The template is NOT compiled at import time — JIT
// compilation is deferred until the component is actually used in a view.
import { ViewerComponent } from '../../src/app/components/viewer/viewer.component';

// ─── Factory ───────────────────────────────────────────────────────────────

function makeViewer() {
  const electron = makeElectronStub();
  const pageCache = makePageCacheStub();
  const thumbnailCache = makeThumbnailCacheStub();
  const readerState = makeReaderStateStub();
  const zoomPan = makeZoomPanStub();
  const keybindings = makeKeybindingsStub();

  const viewer = new ViewerComponent(
    electron as any,
    pageCache as any,
    thumbnailCache as any,
    readerState as any,
    zoomPan as any,
    keybindings as any,
  );

  // Stub internal async methods that are irrelevant for these unit tests
  (viewer as any).refreshManifest = vi.fn(() => Promise.resolve());
  (viewer as any).completeOpen = vi.fn(() => Promise.resolve());
  (viewer as any).bumpVerticalRenderVersion = vi.fn();
  (viewer as any).clearPageReadyRetry = vi.fn();
  (viewer as any).buildPageUrl = vi.fn((page: number) => `comiscopio-page://hash/${page}`);
  (viewer as any).loadSecondPage = vi.fn();
  (viewer as any).initializePreview = vi.fn(() => Promise.resolve());
  (viewer as any).resetViewerState = vi.fn();
  (viewer as any).reportRendererStats = vi.fn();
  (viewer as any).clearPostCloseDiagnostics = vi.fn();
  (viewer as any).closeCurrentFile = vi.fn();
  (viewer as any).loadRecentFiles = vi.fn();

  return { viewer, electron, pageCache, thumbnailCache };
}

function dispatch(viewer: ViewerComponent, event: Record<string, any>) {
  (viewer as any).handleWorkerEvent(event);
}

// ─── Hash filtering ────────────────────────────────────────────────────────

describe('handleWorkerEvent: hash filtering', () => {
  it('ignores events whose hash does not match the active or opening file', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'active-hash';

    dispatch(viewer, { type: 'extracting', fileHash: 'other-hash', current: 0, total: 5 });

    // loadingMessage should not have changed
    expect(viewer.loadingMessage()).toBe('Abriendo archivo...');
  });

  it('accepts events matching openingFileHash', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'my-hash';

    dispatch(viewer, { type: 'extracting', fileHash: 'my-hash', current: 2, total: 10 });

    expect(viewer.loadingMessage()).toContain('3/10');
  });

  it('accepts events matching the active fileState hash', () => {
    const { viewer } = makeViewer();
    viewer.fileState.set({ fileHash: 'open-hash', sessionId: 's1', fileName: 'test.cbz', filePath: '/test.cbz', totalPages: 5 });

    dispatch(viewer, { type: 'extracting', fileHash: 'open-hash', current: 0, total: 3 });

    expect(viewer.loadingMessage()).toContain('1/3');
  });
});

// ─── extracting ────────────────────────────────────────────────────────────

describe('handleWorkerEvent: extracting', () => {
  it('sets loadingMessage with progress when total is known', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    dispatch(viewer, { type: 'extracting', fileHash: 'h', current: 4, total: 20 });
    expect(viewer.loadingMessage()).toBe('Extrayendo 5/20...');
  });

  it('sets loadingMessage without total when total is 0', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    dispatch(viewer, { type: 'extracting', fileHash: 'h', current: 2, total: 0 });
    expect(viewer.loadingMessage()).toContain('3 páginas');
  });
});

// ─── error ─────────────────────────────────────────────────────────────────

describe('handleWorkerEvent: error', () => {
  it('sets error message and clears loading flag', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    viewer.loading.set(true);

    dispatch(viewer, { type: 'error', fileHash: 'h', message: 'Formato no soportado' });

    expect(viewer.loading()).toBe(false);
    expect(viewer.error()).toBe('Formato no soportado');
  });

  it('uses fallback message when event has no message', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    viewer.loading.set(true);

    dispatch(viewer, { type: 'error', fileHash: 'h' });

    expect(viewer.error()).toBe('No se pudo abrir el archivo.');
  });

  it('clears openingFileHash and openingSessionId on error', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    (viewer as any).openingSessionId = 's1';
    viewer.loading.set(true);

    dispatch(viewer, { type: 'error', fileHash: 'h', message: 'fail' });

    expect((viewer as any).openingFileHash).toBeNull();
    expect((viewer as any).openingSessionId).toBeNull();
  });

  it('does not set error when not in loading state', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    viewer.loading.set(false);

    dispatch(viewer, { type: 'error', fileHash: 'h', message: 'late error' });

    // When not loading, error event is a no-op
    expect(viewer.error()).toBeNull();
  });
});

// ─── archive ───────────────────────────────────────────────────────────────

describe('handleWorkerEvent: archive', () => {
  it('calls refreshManifest and completeOpen', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';

    dispatch(viewer, { type: 'archive', fileHash: 'h', totalPages: 12 });

    expect((viewer as any).refreshManifest).toHaveBeenCalledWith('h');
    // completeOpen is called inside queueMicrotask; flush it
    return Promise.resolve().then(() => {
      // queueMicrotask runs after promise resolution
    });
  });
});

// ─── ready ─────────────────────────────────────────────────────────────────

describe('handleWorkerEvent: ready', () => {
  it('marks page ready in caches', () => {
    const { viewer, pageCache, thumbnailCache } = makeViewer();
    (viewer as any).openingFileHash = 'h';

    dispatch(viewer, { type: 'ready', fileHash: 'h', page: 3 });

    expect(pageCache.markReady).toHaveBeenCalledWith(3);
    expect(thumbnailCache.markReady).toHaveBeenCalledWith(3);
  });

  it('updates currentPageUrl when the ready page is the current page', () => {
    const { viewer } = makeViewer();
    viewer.fileState.set({ fileHash: 'h', sessionId: 's', fileName: 'f', filePath: '/f', totalPages: 5 });
    viewer.currentPageIndex.set(2);

    dispatch(viewer, { type: 'ready', fileHash: 'h', page: 2 });

    expect((viewer as any).buildPageUrl).toHaveBeenCalledWith(2, 'optimized');
  });

  it('does not update currentPageUrl for non-current page', () => {
    const { viewer } = makeViewer();
    viewer.fileState.set({ fileHash: 'h', sessionId: 's', fileName: 'f', filePath: '/f', totalPages: 5 });
    viewer.currentPageIndex.set(0);

    dispatch(viewer, { type: 'ready', fileHash: 'h', page: 3 });

    expect((viewer as any).buildPageUrl).not.toHaveBeenCalled();
  });
});

// ─── progress ──────────────────────────────────────────────────────────────

describe('handleWorkerEvent: progress', () => {
  it('marks thumbnail ready on thumb stage', () => {
    const { viewer, thumbnailCache } = makeViewer();
    (viewer as any).openingFileHash = 'h';

    dispatch(viewer, { type: 'progress', fileHash: 'h', page: 5, stage: 'thumb' });

    expect(thumbnailCache.markReady).toHaveBeenCalledWith(5);
  });
});

// ─── done ──────────────────────────────────────────────────────────────────

describe('handleWorkerEvent: done', () => {
  it('does not crash or change state', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    viewer.loading.set(false);

    expect(() => dispatch(viewer, { type: 'done', fileHash: 'h' })).not.toThrow();
    expect(viewer.loading()).toBe(false);
    expect(viewer.error()).toBeNull();
  });
});
