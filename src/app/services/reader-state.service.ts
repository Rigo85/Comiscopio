import { Injectable, signal, computed } from '@angular/core';
import type { ReadingMode, FitMode, PageLayout, AppSettings } from '../../../shared/models';

/**
 * Manages reading state: mode, layout, fit, and navigation direction.
 * Single source of truth for how content is displayed and navigated.
 */
@Injectable({ providedIn: 'root' })
export class ReaderStateService {
  readingMode = signal<ReadingMode>('ltr');
  fitMode = signal<FitMode>('fit-width');
  pageLayout = signal<PageLayout>('single');

  /** Whether navigation direction is reversed (RTL) */
  isReversed = computed(() => this.readingMode() === 'rtl');

  /** Whether we're in vertical scroll mode */
  isVertical = computed(() => this.readingMode() === 'vertical');

  /** Initialize from saved settings */
  applySettings(settings: AppSettings): void {
    this.readingMode.set(settings.readingMode);
    this.fitMode.set(settings.fitMode);
    this.pageLayout.set(settings.pageLayout);
  }

  /** Cycle through reading modes: rtl → ltr → vertical → rtl */
  cycleReadingMode(): ReadingMode {
    const modes: ReadingMode[] = ['rtl', 'ltr', 'vertical'];
    const current = modes.indexOf(this.readingMode());
    const next = modes[(current + 1) % modes.length];
    this.readingMode.set(next);
    return next;
  }

  /** Toggle between single and double page layout */
  togglePageLayout(): PageLayout {
    const next = this.pageLayout() === 'single' ? 'double' : 'single';
    this.pageLayout.set(next);
    return next;
  }

  /** Cycle fit modes: fit-width → fit-height → fit-page → original */
  cycleFitMode(): FitMode {
    const modes: FitMode[] = ['fit-width', 'fit-height', 'fit-page', 'original'];
    const current = modes.indexOf(this.fitMode());
    const next = modes[(current + 1) % modes.length];
    this.fitMode.set(next);
    return next;
  }

  /**
   * Determine the "forward" direction for navigation given a click position.
   * Returns true if the click should advance (next page).
   */
  isForwardClick(clickX: number, containerWidth: number): boolean {
    const clickedRight = clickX > containerWidth / 2;
    // RTL: left = forward (next), right = backward (prev)
    // LTR: right = forward, left = backward
    if (this.isReversed()) {
      return !clickedRight;
    }
    return clickedRight;
  }

  /**
   * Get navigation step for double-page mode.
   * Returns how many pages to advance/retreat.
   * If the current page is a spread (width > height), step is 1.
   */
  getStep(isSpread: boolean): number {
    if (this.pageLayout() === 'double' && !isSpread) {
      return 2;
    }
    return 1;
  }

  /** Check if a page is a double-page spread based on its dimensions */
  isSpread(width: number, height: number): boolean {
    if (width === 0 || height === 0) return false;
    return width > height * 1.2; // 20% wider than tall = spread
  }

  /** Get reading mode display label */
  getReadingModeLabel(): string {
    switch (this.readingMode()) {
      case 'rtl': return 'Manga (RTL)';
      case 'ltr': return 'Cómic (LTR)';
      case 'vertical': return 'Vertical (Webtoon)';
    }
  }

  /** Get page layout display label */
  getPageLayoutLabel(): string {
    return this.pageLayout() === 'single' ? 'Página simple' : 'Doble página';
  }

  /** Get fit mode display label */
  getFitModeLabel(): string {
    switch (this.fitMode()) {
      case 'fit-width': return 'Ajustar al ancho';
      case 'fit-height': return 'Ajustar al alto';
      case 'fit-page': return 'Ajustar a la página';
      case 'original': return 'Tamaño original';
    }
  }
}
