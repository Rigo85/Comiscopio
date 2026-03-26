import { Component, ElementRef, ViewChild, input, output, signal, computed, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { ThumbnailCacheService } from '../../services/thumbnail-cache.service';

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
        <div class="thumbnails-list" #list (scroll)="onScroll()">
          <div class="thumbnails-spacer" [style.height.px]="totalContentHeight()">
            <div class="thumbnails-window" [style.transform]="'translateY(' + offsetTop() + 'px)'">
              @for (slot of visibleSlots(); track slot.slot) {
                @if (!slot.isEmpty) {
                  <button
                    class="thumbnail-item"
                    [attr.data-page]="slot.pageIndex"
                    [class.active]="slot.pageIndex === currentPage()"
                    (click)="pageSelect.emit(slot.pageIndex)"
                  >
                    <div class="thumbnail-media">
                      @if (thumbnailUrls().get(slot.pageIndex); as url) {
                        <img [src]="url" [alt]="'Página ' + (slot.pageIndex + 1)" loading="lazy" />
                      } @else {
                        <div class="thumbnail-placeholder">{{ slot.pageIndex + 1 }}</div>
                      }
                    </div>
                    <span class="thumbnail-label">{{ slot.pageIndex + 1 }}</span>
                  </button>
                } @else {
                  <div class="thumbnail-item thumbnail-item-empty" aria-hidden="true"></div>
                }
              }
            </div>
          </div>
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
      position: relative;
    }

    .thumbnails-spacer {
      position: relative;
      width: 100%;
    }

    .thumbnails-window {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
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
      display: grid;
      grid-template-rows: 1fr auto;
      align-items: stretch;
      transition: border-color 0.1s;
      height: 103px;
      box-sizing: border-box;
      overflow: hidden;

      &:hover {
        border-color: #555;
      }

      &.active {
        border-color: #8af;
      }

      img {
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 2px;
        object-fit: contain;
      }
    }

    .thumbnail-item-empty {
      visibility: hidden;
      pointer-events: none;
    }

    .thumbnail-media {
      min-height: 0;
      width: 100%;
      overflow: hidden;
    }

    .thumbnail-placeholder {
      width: 100%;
      height: 100%;
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
export class ThumbnailsComponent implements OnChanges, OnDestroy {
  private static readonly ITEM_HEIGHT = 109;
  private static readonly OVERSCAN = 8;
  private static readonly TARGET_ITEMS_ABOVE_CURRENT = 1;

  visible = input(false);
  currentPage = input(0);
  totalPages = input(0);
  fileHash = input<string | null>(null);

  visibleChange = output<boolean>();
  pageSelect = output<number>();

  thumbnailUrls = signal<Map<number, string>>(new Map());
  scrollTop = signal(0);
  viewportHeight = signal(0);
  startIndex = computed(() => {
    const rawStart = Math.floor(this.scrollTop() / ThumbnailsComponent.ITEM_HEIGHT) - ThumbnailsComponent.OVERSCAN;
    return Math.max(0, rawStart);
  });
  endIndex = computed(() => {
    return Math.min(this.totalPages(), this.startIndex() + this.visibleSlotCount());
  });
  visibleSlotCount = computed(() => {
    const visibleCount = Math.ceil(this.viewportHeight() / ThumbnailsComponent.ITEM_HEIGHT) + (ThumbnailsComponent.OVERSCAN * 2);
    return Math.max(visibleCount, 1);
  });
  visibleSlots = computed(() => {
    const start = this.startIndex();
    const total = this.totalPages();
    return Array.from({ length: this.visibleSlotCount() }, (_, slot) => {
      const pageIndex = start + slot;
      return {
        slot,
        pageIndex: pageIndex < total ? pageIndex : -1,
        isEmpty: pageIndex >= total,
      };
    });
  });
  offsetTop = computed(() => this.startIndex() * ThumbnailsComponent.ITEM_HEIGHT);
  totalContentHeight = computed(() => this.totalPages() * ThumbnailsComponent.ITEM_HEIGHT);
  @ViewChild('list') listRef?: ElementRef<HTMLElement>;
  private unsubscribeThumbnail?: () => void;

  constructor(private thumbnailCache: ThumbnailCacheService) {
    this.unsubscribeThumbnail = this.thumbnailCache.subscribe((pageIndex, fileUrl) => {
      this.setThumbnailUrl(pageIndex, fileUrl);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['totalPages'] || changes['fileHash']) {
      this.thumbnailUrls.set(new Map());
      this.scrollTop.set(0);
      if (!this.fileHash()) {
        this.thumbnailCache.clear();
      } else if (this.visible()) {
        queueMicrotask(() => {
          this.updateViewportMetrics();
          this.scrollToCurrentPage();
          this.loadVisibleThumbnails();
        });
      }
    }

    if (changes['visible'] || changes['currentPage']) {
      if (this.visible()) {
        queueMicrotask(() => {
          this.updateViewportMetrics();
          this.scrollToCurrentPage();
          this.loadVisibleThumbnails();
        });
      }
    }
  }

  onScroll(): void {
    this.updateViewportMetrics();
    void this.loadVisibleThumbnails();
  }

  private loadVisibleThumbnails(): void {
    if (!this.visible() || this.totalPages() === 0) return;

    for (const slot of this.visibleSlots()) {
      const pageIndex = slot.pageIndex;
      if (slot.isEmpty) continue;
      if (this.thumbnailCache.isReady(pageIndex) && !this.thumbnailUrls().has(pageIndex)) {
        this.setThumbnailUrl(pageIndex, this.thumbnailCache.getThumbUrl(pageIndex));
      }
    }
  }

  private setThumbnailUrl(pageIndex: number, fileUrl: string): void {
    this.thumbnailUrls.update((current) => {
      const next = new Map(current);
      next.set(pageIndex, fileUrl);
      return next;
    });
  }

  private scrollToCurrentPage(): void {
    const list = this.listRef?.nativeElement;
    if (!list) return;

    const targetTop = this.currentPage() * ThumbnailsComponent.ITEM_HEIGHT;
    const targetBottom = targetTop + ThumbnailsComponent.ITEM_HEIGHT;
    const viewTop = list.scrollTop;
    const viewBottom = viewTop + list.clientHeight;
    const desiredScrollTop = Math.max(
      0,
      Math.min(
        targetTop - (ThumbnailsComponent.TARGET_ITEMS_ABOVE_CURRENT * ThumbnailsComponent.ITEM_HEIGHT),
        Math.max(0, list.scrollHeight - list.clientHeight),
      ),
    );

    if (targetTop < viewTop || targetBottom > viewBottom) {
      list.scrollTop = desiredScrollTop;
    }

    this.updateViewportMetrics();
  }

  private updateViewportMetrics(): void {
    const list = this.listRef?.nativeElement;
    if (!list) return;
    this.scrollTop.set(list.scrollTop);
    this.viewportHeight.set(list.clientHeight);
  }

  ngOnDestroy(): void {
    this.unsubscribeThumbnail?.();
  }
}
