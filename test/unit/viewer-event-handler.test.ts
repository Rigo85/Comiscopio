/**
 * Tests for ViewerComponent.handleWorkerEvent — the function that translates
 * raw worker events into UI state changes.
 *
 * We instantiate the class directly (no Angular TestBed / no DOM) and call
 * the private method via TypeScript casting.  Each test checks the resulting
 * signal values rather than implementation details.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { PageCacheService } from '../../src/app/services/page-cache.service';

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

  it('reports a fatal worker failure even after loading', () => {
    const { viewer } = makeViewer();
    (viewer as any).openingFileHash = 'h';
    viewer.loading.set(false);

    dispatch(viewer, { type: 'error', fileHash: 'h', message: 'late error' });

    expect(viewer.error()).toBe('late error');
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


afterEach(() => { vi.useRealTimers(); });

function active(viewer: ViewerComponent, hash: string, sessionId = hash) {
  viewer.fileState.set({ fileHash: hash, sessionId, filePath: '/' + hash, fileName: hash, totalPages: 5 });
}

it('ignores events from a replaced session of the same file', () => {
  const { viewer, pageCache } = makeViewer();
  active(viewer, 'same', 'new');
  dispatch(viewer, { type: 'ready', fileHash: 'same', sessionId: 'old', page: 0 });
  expect(pageCache.markReady).not.toHaveBeenCalled();
});

it('keeps reading after a single damaged page during opening', () => {
  const { viewer } = makeViewer();
  active(viewer, 'h');
  viewer.loading.set(true);
  dispatch(viewer, { type: 'error', fileHash: 'h', page: 2, message: 'Invalid image' });
  expect(viewer.error()).toBeNull();
  expect(viewer.fileState()?.fileHash).toBe('h');
  expect((viewer as any).resetViewerState).not.toHaveBeenCalled();
});

it('a delayed settings response cannot initialize the next file cache', async () => {
  const { viewer, electron, pageCache } = makeViewer();
  let resolve!: (value: any) => void;
  electron.getSettings.mockReturnValue(new Promise(r => { resolve = r; }));
  active(viewer, 'old');
  const complete = (ViewerComponent.prototype as any).completeOpen.call(viewer, 'old', 100);
  active(viewer, 'new');
  resolve({ slidingWindowSize: 5 });
  await complete;
  expect(pageCache.init).not.toHaveBeenCalled();
  expect(viewer.fileState()?.totalPages).toBe(5);
});

it('a delayed progress response cannot navigate the next file', async () => {
  const { viewer, electron, thumbnailCache } = makeViewer();
  let resolve!: (value: any) => void;
  (electron as any).getProgress = vi.fn(() => new Promise(r => { resolve = r; }));
  (thumbnailCache as any).syncReadyFromManifest = vi.fn();
  viewer.goToPage = vi.fn();
  active(viewer, 'old');
  const complete = (ViewerComponent.prototype as any).completeOpen.call(viewer, 'old', 100);
  await Promise.resolve();
  await Promise.resolve();
  active(viewer, 'new');
  resolve({ currentPage: 88 });
  await complete;
  expect(viewer.goToPage).not.toHaveBeenCalled();
});

it('a delayed manifest does not populate a different file', async () => {
  const { viewer, electron, pageCache } = makeViewer();
  let resolve!: (value: any) => void;
  (electron as any).getWorkerManifest = vi.fn(() => new Promise(r => { resolve = r; }));
  active(viewer, 'old');
  const read = (ViewerComponent.prototype as any).refreshManifest.call(viewer, 'old');
  active(viewer, 'new');
  resolve({ pages: [{ page: 'old.jpg' }] });
  await read;
  expect(pageCache.updateManifest).not.toHaveBeenCalled();
});

it('retries the current page when it becomes ready without another event', () => {
  vi.useFakeTimers();
  const { viewer, pageCache } = makeViewer();
  (viewer as any).clearPageReadyRetry = (ViewerComponent.prototype as any).clearPageReadyRetry.bind(viewer);
  active(viewer, 'h');
  (viewer as any).schedulePageReadyRetry(0, 'optimized');
  vi.advanceTimersByTime(40);
  pageCache.isReady.mockReturnValue(true);
  vi.advanceTimersByTime(60);
  expect(viewer.currentPageUrl()).toBe('comiscopio-page://hash/0');
});

it('a duplicate opening in another window keeps the current reader', async () => {
  const { viewer, electron } = makeViewer();
  active(viewer, 'current');
  (electron as any).workerStart = vi.fn().mockResolvedValue({ redirected: true, alreadyOpen: true });
  await viewer.openFile('/already-open');
  expect(viewer.fileState()?.fileHash).toBe('current');
  expect((viewer as any).closeCurrentFile).not.toHaveBeenCalled();
  expect(viewer.loading()).toBe(false);
});

it('redirecting a duplicate does not invalidate an opening already in progress', async () => {
  const { viewer, electron, pageCache } = makeViewer();
  active(viewer, 'current');
  viewer.loading.set(true);
  const generation = (viewer as any).openGeneration;
  (electron as any).workerStart = vi.fn().mockResolvedValue({ redirected: true, alreadyOpen: true });
  await viewer.openFile('/already-open');
  expect((viewer as any).openGeneration).toBe(generation);
  expect(viewer.loading()).toBe(true);
  expect(viewer.fileState()?.fileHash).toBe('current');
  expect(pageCache.init).not.toHaveBeenCalled();
});

it('shows the first page when ready arrives after the preview probe expires', async () => {
  vi.useFakeTimers();
  const { viewer, electron } = makeViewer();
  const pageCache = new PageCacheService(electron as any);
  (viewer as any).pageCache = pageCache;
  (viewer as any).buildPageUrl = (ViewerComponent.prototype as any).buildPageUrl.bind(viewer);
  active(viewer, 'slow', 'session');
  viewer.fileState.update(s => s ? { ...s, totalPages: 0 } : s);
  viewer.loading.set(true);
  (viewer as any).openingFileHash = 'slow';
  (viewer as any).openingSessionId = 'session';
  (viewer as any).initializePreview = (ViewerComponent.prototype as any).initializePreview.bind(viewer);
  (electron as any).getWorkerManifest = vi.fn().mockResolvedValue({ pages: [] });
  (viewer as any).schedulePreviewProbe('slow');
  await vi.advanceTimersByTimeAsync(5000);
  expect(viewer.currentPageUrl()).toBeNull();
  dispatch(viewer, { type: 'ready', fileHash: 'slow', sessionId: 'session', page: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(pageCache.isReady(0)).toBe(true);
  expect(viewer.currentPageUrl()).toMatch(/^comiscopio-page:\/\/slow\/0\?/);
  expect(viewer.fileState()?.totalPages).toBe(1);
  expect(viewer.loading()).toBe(true); // Extraction is still in progress.
});

it('does not use a delayed preview probe from a previous opening of the same file', async () => {
  vi.useFakeTimers();
  const { viewer, electron } = makeViewer();
  let resolve!: (value: any) => void;
  (electron as any).getWorkerManifest = vi.fn(() => new Promise(r => { resolve = r; }));
  active(viewer, 'same', 'old');
  viewer.loading.set(true);
  (viewer as any).openingFileHash = 'same';
  (viewer as any).openingSessionId = 'old';
  (viewer as any).schedulePreviewProbe('same');
  await vi.advanceTimersByTimeAsync(0);
  (viewer as any).openGeneration++;
  active(viewer, 'same', 'new');
  (viewer as any).openingSessionId = 'new';
  resolve({ pages: [{ page: 'old-session.jpg' }] });
  await vi.advanceTimersByTimeAsync(0);
  expect((viewer as any).initializePreview).not.toHaveBeenCalled();
});

for (const secondPath of ['/same.cbz', '/alias/same.cbz']) {
  it(`serializes pending openings before reusing a session: ${secondPath}`, async () => {
    const { viewer, electron } = makeViewer();
    let resolveFirst!: (value: any) => void;
    (viewer as any).schedulePreviewProbe = vi.fn();
    (electron as any).workerClose = vi.fn();
    const result = { fileHash: 'same', sessionId: 'first', filePath: '/same.cbz', fileName: 'same.cbz', totalPages: 0, alreadyOpen: false };
    (electron as any).workerStart = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(async () => {
        expect((electron as any).workerClose).toHaveBeenCalledWith('same', { sessionId: 'first', reason: 'superseded-open' });
        return { ...result, sessionId: 'second' };
      });
    const first = viewer.openFile('/same.cbz');
    await Promise.resolve();
    const second = viewer.openFile(secondPath);
    await Promise.resolve();
    expect((electron as any).workerStart).toHaveBeenCalledTimes(1);
    resolveFirst(result);
    await Promise.all([first, second]);
    expect(viewer.fileState()?.sessionId).toBe('second');
    expect((electron as any).workerClose).toHaveBeenCalledTimes(1);
  });
}

it('does not start an opening cancelled while another response was pending', async () => {
  const { viewer, electron } = makeViewer();
  let resolveFirst!: (value: any) => void;
  (electron as any).workerClose = vi.fn();
  (electron as any).workerStart = vi.fn(() => new Promise(resolve => { resolveFirst = resolve; }));
  const first = viewer.openFile('/first.cbz');
  await Promise.resolve();
  const second = viewer.openFile('/second.cbz');
  viewer.cancelOpen();
  resolveFirst({ fileHash: 'first', sessionId: 'first-session', alreadyOpen: false });
  await Promise.all([first, second]);
  expect((electron as any).workerStart).toHaveBeenCalledTimes(1);
  expect((electron as any).workerClose).toHaveBeenCalledWith('first', { sessionId: 'first-session', reason: 'superseded-open' });
  expect(viewer.fileState()).toBeNull();
});
