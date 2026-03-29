/**
 * Tests for ReaderStateService pure logic:
 *  - isForwardClick: LTR vs RTL navigation direction
 *  - isSpread: aspect-ratio spread detection
 *  - getStep: single vs double page stepping
 *  - cycleReadingMode: correct cycle order
 *  - cycleFitMode: correct cycle order
 *  - togglePageLayout: toggle between single and double
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ReaderStateService } from '../../src/app/services/reader-state.service';

function makeService(): ReaderStateService {
  return new ReaderStateService();
}

// ─── isSpread ──────────────────────────────────────────────────────────────

describe('isSpread', () => {
  const svc = makeService();

  it('returns false for portrait page', () => {
    expect(svc.isSpread(800, 1200)).toBe(false);
  });

  it('returns false for square page', () => {
    expect(svc.isSpread(800, 800)).toBe(false);
  });

  it('returns false just below threshold (width = 1.2 * height)', () => {
    // 1.2 * 1000 = 1200 — not strictly greater
    expect(svc.isSpread(1200, 1000)).toBe(false);
  });

  it('returns true when width is more than 1.2× height', () => {
    expect(svc.isSpread(1201, 1000)).toBe(true);
  });

  it('returns false for zero dimensions', () => {
    expect(svc.isSpread(0, 0)).toBe(false);
    expect(svc.isSpread(800, 0)).toBe(false);
    expect(svc.isSpread(0, 800)).toBe(false);
  });

  it('handles landscape page that is not a spread', () => {
    // Typical wide-screen: 1280×720 → 1280 / 720 ≈ 1.78, IS a spread
    expect(svc.isSpread(1280, 720)).toBe(true);
  });
});

// ─── isForwardClick ────────────────────────────────────────────────────────

describe('isForwardClick (LTR mode)', () => {
  let svc: ReaderStateService;

  beforeEach(() => {
    svc = makeService();
    svc.readingMode.set('ltr');
  });

  it('right half click = forward', () => {
    expect(svc.isForwardClick(600, 800)).toBe(true);   // 600 > 400
  });

  it('left half click = backward', () => {
    expect(svc.isForwardClick(300, 800)).toBe(false);  // 300 < 400
  });

  it('click exactly at center is backward (not strictly right)', () => {
    expect(svc.isForwardClick(400, 800)).toBe(false);  // 400 is not > 400
  });
});

describe('isForwardClick (RTL mode)', () => {
  let svc: ReaderStateService;

  beforeEach(() => {
    svc = makeService();
    svc.readingMode.set('rtl');
  });

  it('left half click = forward in RTL', () => {
    expect(svc.isForwardClick(300, 800)).toBe(true);
  });

  it('right half click = backward in RTL', () => {
    expect(svc.isForwardClick(600, 800)).toBe(false);
  });
});

// ─── getStep ───────────────────────────────────────────────────────────────

describe('getStep', () => {
  it('single layout always returns 1', () => {
    const svc = makeService();
    svc.pageLayout.set('single');
    expect(svc.getStep(false)).toBe(1);
    expect(svc.getStep(true)).toBe(1);
  });

  it('double layout returns 2 for normal pages', () => {
    const svc = makeService();
    svc.pageLayout.set('double');
    expect(svc.getStep(false)).toBe(2);
  });

  it('double layout returns 1 for spread pages', () => {
    const svc = makeService();
    svc.pageLayout.set('double');
    expect(svc.getStep(true)).toBe(1);
  });
});

// ─── cycleReadingMode ──────────────────────────────────────────────────────

describe('cycleReadingMode', () => {
  it('cycles rtl → ltr → vertical → rtl', () => {
    const svc = makeService();
    svc.readingMode.set('rtl');
    expect(svc.cycleReadingMode()).toBe('ltr');
    expect(svc.cycleReadingMode()).toBe('vertical');
    expect(svc.cycleReadingMode()).toBe('rtl');
  });

  it('updates the signal', () => {
    const svc = makeService();
    svc.readingMode.set('ltr');
    svc.cycleReadingMode();
    expect(svc.readingMode()).toBe('vertical');
  });
});

// ─── cycleFitMode ──────────────────────────────────────────────────────────

describe('cycleFitMode', () => {
  it('cycles fit-width → fit-height → fit-page → original → fit-width', () => {
    const svc = makeService();
    svc.fitMode.set('fit-width');
    expect(svc.cycleFitMode()).toBe('fit-height');
    expect(svc.cycleFitMode()).toBe('fit-page');
    expect(svc.cycleFitMode()).toBe('original');
    expect(svc.cycleFitMode()).toBe('fit-width');
  });
});

// ─── togglePageLayout ──────────────────────────────────────────────────────

describe('togglePageLayout', () => {
  it('single → double → single', () => {
    const svc = makeService();
    svc.pageLayout.set('single');
    expect(svc.togglePageLayout()).toBe('double');
    expect(svc.togglePageLayout()).toBe('single');
  });
});

// ─── computed signals ──────────────────────────────────────────────────────

describe('computed signals', () => {
  it('isReversed is true only for rtl mode', () => {
    const svc = makeService();
    svc.readingMode.set('rtl');
    expect(svc.isReversed()).toBe(true);
    svc.readingMode.set('ltr');
    expect(svc.isReversed()).toBe(false);
    svc.readingMode.set('vertical');
    expect(svc.isReversed()).toBe(false);
  });

  it('isVertical is true only for vertical mode', () => {
    const svc = makeService();
    svc.readingMode.set('vertical');
    expect(svc.isVertical()).toBe(true);
    svc.readingMode.set('ltr');
    expect(svc.isVertical()).toBe(false);
  });
});
