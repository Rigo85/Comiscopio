import { Injectable, signal, computed } from '@angular/core';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.15;

/**
 * Manages zoom level, pan offset, and image filters.
 * Resets on page change. CSS-transform based for performance.
 */
@Injectable({ providedIn: 'root' })
export class ZoomPanService {
  zoom = signal(1);
  panX = signal(0);
  panY = signal(0);

  /** Image filter values */
  brightness = signal(100); // percentage, 100 = normal
  contrast = signal(100);   // percentage, 100 = normal

  /** Whether we're currently zoomed in (shows grab cursor, enables pan) */
  isZoomed = computed(() => this.zoom() > 1.01);

  /** Whether filters are modified from defaults */
  hasFilters = computed(() => this.brightness() !== 100 || this.contrast() !== 100);

  /** CSS transform string for the image wrapper */
  transformStyle = computed(() => {
    const z = this.zoom();
    const x = this.panX();
    const y = this.panY();
    if (z === 1 && x === 0 && y === 0) return '';
    return `scale(${z}) translate(${x}px, ${y}px)`;
  });

  /** CSS filter string for images */
  filterStyle = computed(() => {
    const b = this.brightness();
    const c = this.contrast();
    if (b === 100 && c === 100) return '';
    return `brightness(${b}%) contrast(${c}%)`;
  });

  // --- Zoom ---

  zoomIn(): void {
    this.setZoom(this.zoom() + ZOOM_STEP);
  }

  zoomOut(): void {
    this.setZoom(this.zoom() - ZOOM_STEP);
  }

  /** Zoom at a specific point (for mouse wheel zoom toward cursor) */
  zoomAtPoint(delta: number, pointX: number, pointY: number, containerW: number, containerH: number): void {
    const oldZoom = this.zoom();
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom + delta));
    if (newZoom === oldZoom) return;

    // Zoom toward the mouse position
    const factor = newZoom / oldZoom;
    const cx = containerW / 2;
    const cy = containerH / 2;

    // Adjust pan so the point under cursor stays fixed
    const dx = (pointX - cx) / oldZoom;
    const dy = (pointY - cy) / oldZoom;

    this.panX.update(x => x - dx * (factor - 1));
    this.panY.update(y => y - dy * (factor - 1));
    this.zoom.set(newZoom);
  }

  resetZoom(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  setZoom(value: number): void {
    this.zoom.set(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)));
    // If back to 1, reset pan
    if (Math.abs(this.zoom() - 1) < 0.01) {
      this.panX.set(0);
      this.panY.set(0);
    }
  }

  // --- Pan ---

  pan(dx: number, dy: number): void {
    if (!this.isZoomed()) return;
    this.panX.update(x => x + dx / this.zoom());
    this.panY.update(y => y + dy / this.zoom());
  }

  // --- Filters ---

  adjustBrightness(delta: number): void {
    this.brightness.update(b => Math.max(10, Math.min(300, b + delta)));
  }

  adjustContrast(delta: number): void {
    this.contrast.update(c => Math.max(10, Math.min(300, c + delta)));
  }

  resetFilters(): void {
    this.brightness.set(100);
    this.contrast.set(100);
  }

  /** Reset zoom and pan (called on page change) */
  resetOnPageChange(): void {
    this.resetZoom();
    // Filters persist across pages intentionally
  }

  /** Full reset including filters */
  resetAll(): void {
    this.resetZoom();
    this.resetFilters();
  }

  /** Get zoom percentage for display */
  getZoomLabel(): string {
    return `${Math.round(this.zoom() * 100)}%`;
  }
}
