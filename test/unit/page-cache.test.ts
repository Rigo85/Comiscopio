/**
 * Tests for PageCacheService:
 *  - getPageUrl: correct URL format with versioning and cache-busting params
 *  - markReady / isReady: page readiness tracking
 *  - syncReadyFromManifest: pages with artifacts in manifest are auto-marked
 *  - generation increments on each init() call
 *  - clear(): resets all state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageCacheService } from '../../src/app/services/page-cache.service';

// Minimal ElectronService stub — only workerFocus is used by navigateTo
function makeElectronStub() {
  return { workerFocus: vi.fn() } as any;
}

function makeService() {
  return new PageCacheService(makeElectronStub());
}

// ─── getPageUrl ────────────────────────────────────────────────────────────

describe('getPageUrl', () => {
  let svc: PageCacheService;

  beforeEach(() => {
    svc = makeService();
    svc.init('abc123', 10);
  });

  it('returns empty string when no fileHash is set', () => {
    const fresh = makeService();
    expect(fresh.getPageUrl(0)).toBe('');
  });

  it('uses comiscopio-page:// protocol', () => {
    expect(svc.getPageUrl(0)).toMatch(/^comiscopio-page:\/\//);
  });

  it('embeds fileHash as hostname', () => {
    expect(svc.getPageUrl(0)).toContain('abc123');
  });

  it('embeds page index in path', () => {
    expect(svc.getPageUrl(3)).toMatch(/\/3(\?|$)/);
  });

  it('defaults variant to optimized', () => {
    expect(svc.getPageUrl(0)).toContain('variant=optimized');
  });

  it('uses original variant when specified', () => {
    expect(svc.getPageUrl(0, 'original')).toContain('variant=original');
  });

  it('revision starts at 0 for unready pages', () => {
    expect(svc.getPageUrl(0)).toContain('rev=0');
  });

  it('revision increments after markReady', () => {
    svc.markReady(0);
    expect(svc.getPageUrl(0)).toContain('rev=1');
    svc.markReady(0);
    expect(svc.getPageUrl(0)).toContain('rev=2');
  });

  it('generation is included in URL', () => {
    // generation starts at 1 after first init
    expect(svc.getPageUrl(0)).toContain('gen=1');
  });

  it('generation increments on each init() call', () => {
    svc.init('abc123', 10);
    expect(svc.getPageUrl(0)).toContain('gen=2');
    svc.init('abc123', 10);
    expect(svc.getPageUrl(0)).toContain('gen=3');
  });
});

// ─── markReady / isReady ───────────────────────────────────────────────────

describe('markReady / isReady', () => {
  it('page is not ready before markReady', () => {
    const svc = makeService();
    svc.init('hash', 5);
    expect(svc.isReady(0)).toBe(false);
  });

  it('page is ready after markReady', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.markReady(2);
    expect(svc.isReady(2)).toBe(true);
  });

  it('other pages remain not ready', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.markReady(2);
    expect(svc.isReady(0)).toBe(false);
    expect(svc.isReady(1)).toBe(false);
  });
});

// ─── syncReadyFromManifest ─────────────────────────────────────────────────

describe('syncReadyFromManifest', () => {
  it('marks pages that have a page artifact in the manifest', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.updateManifest([
      { page: 'pages/000000.jpg', originalWidth: 800, originalHeight: 1200 },
      null,
      { page: 'pages/000002.jpg', originalWidth: 800, originalHeight: 1200 },
    ]);
    svc.syncReadyFromManifest();
    expect(svc.isReady(0)).toBe(true);
    expect(svc.isReady(1)).toBe(false);
    expect(svc.isReady(2)).toBe(true);
  });

  it('does not overwrite existing revision for pages already marked', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.markReady(0); // rev becomes 1
    svc.updateManifest([{ page: 'pages/000000.jpg' }]);
    svc.syncReadyFromManifest();
    // rev should still be 1, not reset to 1 by syncReadyFromManifest
    expect(svc.getPageUrl(0)).toContain('rev=1');
  });

  it('sets revision to 1 for newly synced pages', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.updateManifest([{ page: 'pages/000000.jpg' }]);
    svc.syncReadyFromManifest();
    expect(svc.getPageUrl(0)).toContain('rev=1');
  });

  it('ignores manifest entries without page artifact', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.updateManifest([{ originalWidth: 800 }]); // no 'page' key
    svc.syncReadyFromManifest();
    expect(svc.isReady(0)).toBe(false);
  });
});

// ─── clear ─────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('resets ready pages and URL generation', () => {
    const svc = makeService();
    svc.init('hash', 5);
    svc.markReady(0);
    svc.clear();
    // After clear, getPageUrl returns empty (no fileHash)
    expect(svc.getPageUrl(0)).toBe('');
    expect(svc.isReady(0)).toBe(false);
    expect(svc.stats.readyPages).toBe(0);
  });
});

// ─── stats ─────────────────────────────────────────────────────────────────

describe('stats', () => {
  it('reports correct ready page count', () => {
    const svc = makeService();
    svc.init('hash', 10);
    svc.markReady(0);
    svc.markReady(1);
    svc.markReady(0); // duplicate
    expect(svc.stats.readyPages).toBe(2);
    expect(svc.stats.totalPages).toBe(10);
  });
});
