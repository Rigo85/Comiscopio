import { Component, input, output, signal, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { PageCacheService } from '../../services/page-cache.service';

/**
 * Side panel with page thumbnails.
 * Hidden by default, toggled via shortcut or menu.
 * Lazy-loads thumbnails as they scroll into view.
 */
@Component({
  selector: 'app-thumbnails',
  template: `
    @if (visible()) {
      <div class="thumbnails-panel" (click)="$event.stopPropagation()">
        <div class="thumbnails-header">
          <span>Páginas</span>
          <button class="thumbnails-close" (click)="visibleChange.emit(false)" title="Cerrar">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="thumbnails-list">
          @for (i of pageIndices(); track i) {
            <button
              class="thumbnail-item"
              [class.active]="i === currentPage()"
              (click)="pageSelect.emit(i)"
            >
              @if (thumbnailUrls.get(i); as url) {
                <img [src]="url" [alt]="'Página ' + (i + 1)" loading="lazy" />
              } @else {
                <div class="thumbnail-placeholder">{{ i + 1 }}</div>
              }
              <span class="thumbnail-label">{{ i + 1 }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .thumbnails-panel {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 160px;
      background: #222;
      border-right: 1px solid #333;
      display: flex;
      flex-direction: column;
      z-index: 12;
      user-select: none;
    }

    .thumbnails-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid #333;
      color: #aaa;
      font-size: 12px;
      font-weight: 500;
      flex-shrink: 0;
    }

    .thumbnails-close {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      padding: 2px;
      display: flex;

      &:hover { color: #fff; }
    }

    .thumbnails-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .thumbnail-item {
      background: #2a2a2a;
      border: 2px solid transparent;
      border-radius: 4px;
      padding: 2px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: border-color 0.1s;

      &:hover {
        border-color: #555;
      }

      &.active {
        border-color: #8af;
      }

      img {
        width: 100%;
        height: auto;
        display: block;
        border-radius: 2px;
      }
    }

    .thumbnail-placeholder {
      width: 100%;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #555;
      font-size: 14px;
      background: #1a1a1a;
      border-radius: 2px;
    }

    .thumbnail-label {
      font-size: 10px;
      color: #888;
      padding: 2px 0;
    }
  `,
})
export class ThumbnailsComponent implements OnChanges {
  visible = input(false);
  currentPage = input(0);
  totalPages = input(0);
  fileHash = input<string | null>(null);

  visibleChange = output<boolean>();
  pageSelect = output<number>();

  pageIndices = signal<number[]>([]);
  thumbnailUrls = new Map<number, string>();

  constructor(private pageCache: PageCacheService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['totalPages'] || changes['fileHash']) {
      this.pageIndices.set(Array.from({ length: this.totalPages() }, (_, i) => i));
      this.thumbnailUrls.clear();
    }

    if (changes['visible'] && this.visible()) {
      this.loadVisibleThumbnails();
    }
  }

  private async loadVisibleThumbnails(): Promise<void> {
    // Load thumbnails for pages near current page first
    const current = this.currentPage();
    const total = this.totalPages();
    const batchSize = 10;

    const start = Math.max(0, current - batchSize / 2);
    const end = Math.min(total, start + batchSize);

    for (let i = start; i < end; i++) {
      if (!this.thumbnailUrls.has(i)) {
        const url = await this.pageCache.getPage(i);
        if (url) {
          this.thumbnailUrls.set(i, url);
        }
      }
    }
  }
}
