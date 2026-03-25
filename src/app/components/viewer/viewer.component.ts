import { Component, OnInit, OnDestroy, HostListener, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { ElectronService, WindowState } from '../../services/electron.service';
import { PageCacheService, CachedPage } from '../../services/page-cache.service';
import { ReaderStateService } from '../../services/reader-state.service';
import { ZoomPanService } from '../../services/zoom-pan.service';
import { KeybindingsService } from '../../services/keybindings.service';
import { ThumbnailCacheService } from '../../services/thumbnail-cache.service';
import { ToolbarComponent } from '../toolbar/toolbar.component';
import { ContextMenuComponent, ContextMenuAction } from '../context-menu/context-menu.component';
import { ThumbnailsComponent } from '../thumbnails/thumbnails.component';
import type { FileInfo, RecentFile } from '../../../../shared/models';

@Component({
  selector: 'app-viewer',
  imports: [ToolbarComponent, ContextMenuComponent, ThumbnailsComponent],
  template: `
    @if (loading()) {
      <div class="viewer-overlay">
        <div class="viewer-loading">
          <p>{{ loadingMessage() }}</p>
          @if (openingSessionId() !== null) {
            <button class="loading-cancel" (click)="cancelOpenFile()">Cancelar</button>
          }
        </div>
      </div>
    }

    @if (error()) {
      <div class="viewer-overlay">
        <div class="viewer-error">
          <p>{{ error() }}</p>
          <button (click)="clearError()">Cerrar</button>
        </div>
      </div>
    }

    @if (!fileInfo()) {
      <div
        class="viewer-container"
        [class.drag-over]="isDragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        (contextmenu)="onContextMenu($event)"
      >
        <div class="viewer-welcome">
          <h1>Comiscopio</h1>
          <p>Abre un archivo para comenzar a leer</p>
          <p class="hint">Ctrl+O o arrastra un archivo aquí</p>
          <button class="open-btn" (click)="openFileDialog()">Abrir archivo</button>

          @if (recentFiles().length > 0) {
            <div class="recent-section">
              <h3>Recientes</h3>
              <div class="recent-list">
                @for (file of recentFiles(); track file.fileHash) {
                  <button class="recent-item" (click)="openFile(file.filePath)" [title]="file.filePath">
                    <span class="recent-name">{{ file.fileName }}</span>
                    <span class="recent-progress">{{ file.currentPage + 1 }}/{{ file.totalPages }}</span>
                  </button>
                }
              </div>
            </div>
          }
        </div>
      </div>
    } @else {
      <div
        class="viewer-container viewer-reading"
        [class.vertical-mode]="readerState.isVertical()"
        [class.zoomed]="zoomPan.isZoomed()"
        [class.zen-mode]="zenMode()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        (mousedown)="onPanStart($event)"
        (mousemove)="onPanMove($event)"
        (mouseup)="onPanEnd()"
        (mouseleave)="onPanEnd()"
        (contextmenu)="onContextMenu($event)"
        (dblclick)="onDoubleClick()"
        #viewerContainer
      >
        <!-- Thumbnails panel -->
        <app-thumbnails
          [visible]="showThumbnails()"
          [currentPage]="currentPageIndex()"
          [totalPages]="fileInfo()!.totalPages"
          [fileHash]="fileInfo()!.fileHash"
          (visibleChange)="showThumbnails.set($event)"
          (pageSelect)="goToPage($event)"
        />

        <div
          class="pages-wrapper"
          [class.double-layout]="isDoublePage()"
          [class.rtl-layout]="readerState.isReversed()"
          [class.with-thumbnails]="showThumbnails()"
          [style.transform]="zoomPan.transformStyle()"
          [style.filter]="zoomPan.filterStyle()"
        >
          @if (currentPageUrl()) {
            <img
              class="viewer-image"
              [class]="fitClass()"
              [src]="currentPageUrl()"
              [alt]="'Página ' + (currentPageIndex() + 1)"
              draggable="false"
            />
          }
          @if (secondPageUrl()) {
            <img
              class="viewer-image"
              [class]="fitClass()"
              [src]="secondPageUrl()"
              [alt]="'Página ' + (currentPageIndex() + 2)"
              draggable="false"
            />
          }
        </div>

        <!-- Page indicator (hidden in zen mode) -->
        @if (!zenMode()) {
          <div class="page-indicator">
            @if (secondPageUrl()) {
              {{ currentPageIndex() + 1 }}-{{ currentPageIndex() + 2 }} / {{ fileInfo()!.totalPages }}
            } @else {
              {{ currentPageIndex() + 1 }} / {{ fileInfo()!.totalPages }}
            }
            @if (zoomPan.isZoomed()) {
              <span class="zoom-label">{{ zoomPan.getZoomLabel() }}</span>
            }
            @if (zoomPan.hasFilters()) {
              <span class="filter-label">B:{{ zoomPan.brightness() }} C:{{ zoomPan.contrast() }}</span>
            }
            <span class="mode-label">{{ readerState.getReadingModeLabel() }}</span>
          </div>
        }

        <!-- Bottom toolbar with slider -->
        @if (!zenMode()) {
          <app-toolbar
            [currentPage]="currentPageIndex()"
            [totalPages]="fileInfo()!.totalPages"
            (pageChange)="goToPage($event)"
          />
        }

        <!-- Go to page dialog -->
        @if (showGoToPage()) {
          <div class="goto-overlay" (click)="showGoToPage.set(false)">
            <div class="goto-dialog" (click)="$event.stopPropagation()">
              <label>Ir a página:</label>
              <input
                #gotoInput
                type="number"
                min="1"
                [max]="fileInfo()!.totalPages"
                [value]="currentPageIndex() + 1"
                (keydown.enter)="goToPageFromInput(gotoInput.value)"
                (keydown.escape)="showGoToPage.set(false)"
              />
              <span class="goto-total">/ {{ fileInfo()!.totalPages }}</span>
            </div>
          </div>
        }
      </div>
    }

    <!-- Context menu (rendered outside flow) -->
    <app-context-menu
      [hasFile]="!!fileInfo()"
      [readingMode]="readerState.readingMode()"
      [fitMode]="readerState.fitMode()"
      [pageLayout]="readerState.pageLayout()"
      [isAlwaysOnTop]="isAlwaysOnTop()"
      [isFullscreen]="isFullscreen()"
      [showThumbnails]="showThumbnails()"
      [canLoadFullQuality]="currentPageIsDegraded()"
      (action)="onMenuAction($event)"
      #contextMenu
    />
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .viewer-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1a1a;
      position: relative;
      overflow: hidden;

      &.drag-over {
        background: #2a2a3a;
        outline: 2px dashed #667;
        outline-offset: -8px;
      }

      &.vertical-mode {
        overflow-y: auto;
        align-items: flex-start;
      }

      &.zoomed {
        cursor: grab;
        &:active { cursor: grabbing; }
      }

      &.zen-mode {
        cursor: none;
        &:hover { cursor: default; }
      }
    }

    .viewer-reading { cursor: default; }

    .pages-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      gap: 0;
      transform-origin: center center;
      will-change: transform, filter;
      transition: filter 0.15s ease, margin-left 0.2s ease;

      &.double-layout { gap: 2px; }
      &.rtl-layout { flex-direction: row-reverse; }
      &.with-thumbnails { margin-left: 160px; width: calc(100% - 160px); }
    }

    .viewer-welcome {
      text-align: center;
      color: #666;
      h1 { font-size: 2rem; font-weight: 300; margin-bottom: 0.5rem; color: #888; }
      p { font-size: 0.9rem; margin: 0.25rem 0; }
      .hint { font-size: 0.8rem; color: #555; margin-top: 1rem; }
    }

    .open-btn {
      margin-top: 1.5rem;
      padding: 8px 24px;
      background: #3a3a3a;
      color: #ccc;
      border: 1px solid #555;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      &:hover { background: #4a4a4a; color: #fff; }
    }

    .recent-section {
      margin-top: 2rem;
      text-align: left;
      max-width: 400px;
      width: 100%;

      h3 {
        font-size: 0.8rem;
        color: #777;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }
    }

    .recent-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .recent-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: #aaa;
      cursor: pointer;
      text-align: left;
      font-size: 13px;

      &:hover {
        background: #2a2a2a;
        color: #ddd;
      }

      .recent-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        margin-right: 8px;
      }

      .recent-progress {
        color: #666;
        font-size: 11px;
        flex-shrink: 0;
      }
    }

    .viewer-image {
      user-select: none;
      display: block;
      &.fit-width { width: 100%; height: auto; max-height: none; }
      &.fit-height { height: 100%; width: auto; max-width: none; }
      &.fit-page { max-width: 100%; max-height: 100%; object-fit: contain; }
      &.fit-original { /* no constraints */ }
    }

    .double-layout .viewer-image {
      &.fit-width { width: 50%; }
      &.fit-page { max-width: 50%; }
    }

    .page-indicator {
      position: absolute;
      bottom: 8px;
      right: 12px;
      background: rgba(0, 0, 0, 0.6);
      color: #aaa;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      display: flex;
      gap: 8px;
      z-index: 5;
      .mode-label { color: #777; }
      .zoom-label { color: #8af; }
      .filter-label { color: #fa8; }
    }

    .viewer-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      z-index: 10;
    }

    .viewer-loading {
      color: #aaa;
      font-size: 1.1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;

      p {
        margin: 0;
      }
    }

    .loading-cancel {
      padding: 6px 14px;
      background: #2f2f2f;
      color: #ddd;
      border: 1px solid #555;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: #3b3b3b;
      }
    }

    .viewer-error {
      text-align: center;
      color: #e55;
      p { margin-bottom: 1rem; max-width: 400px; white-space: pre-wrap; }
      button {
        padding: 6px 16px;
        background: #3a3a3a;
        color: #ccc;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
        &:hover { background: #4a4a4a; }
      }
    }

    .goto-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      z-index: 20;
    }

    .goto-dialog {
      background: #2b2b2b;
      padding: 16px 20px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid #444;
      label { color: #aaa; font-size: 0.9rem; }
      input {
        width: 80px; padding: 4px 8px;
        background: #1a1a1a; color: #eee;
        border: 1px solid #555; border-radius: 4px;
        font-size: 1rem; text-align: center; outline: none;
        &:focus { border-color: #777; }
      }
      .goto-total { color: #777; font-size: 0.9rem; }
    }
  `,
})
export class ViewerComponent implements OnInit, OnDestroy {
  fileInfo = signal<FileInfo | null>(null);
  currentPageUrl = signal<string | null>(null);
  secondPageUrl = signal<string | null>(null);
  currentPageIndex = signal(0);
  loading = signal(false);
  loadingMessage = signal('Abriendo archivo...');
  error = signal<string | null>(null);
  isDragOver = signal(false);
  showGoToPage = signal(false);
  showThumbnails = signal(false);
  zenMode = signal(false);
  isAlwaysOnTop = signal(false);
  isFullscreen = signal(false);
  recentFiles = signal<RecentFile[]>([]);
  openingSessionId = signal<number | null>(null);
  currentPageIsDegraded = signal(false);

  private currentPageMeta: CachedPage | null = null;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;

  isDoublePage = computed(() => {
    return this.readerState.pageLayout() === 'double'
      && this.secondPageUrl() !== null
      && !this.readerState.isVertical();
  });

  fitClass = computed(() => {
    switch (this.readerState.fitMode()) {
      case 'fit-width': return 'fit-width';
      case 'fit-height': return 'fit-height';
      case 'fit-page': return 'fit-page';
      case 'original': return 'fit-original';
    }
  });

  @ViewChild('viewerContainer') viewerContainer?: ElementRef<HTMLElement>;
  @ViewChild('contextMenu') contextMenu!: ContextMenuComponent;

  private unsubFileOpened?: () => void;
  private unsubWindowState?: () => void;
  private unsubOpenProgress?: () => void;
  private unsubOpenComplete?: () => void;
  private unsubOpenError?: () => void;
  private unsubOpenCancelled?: () => void;
  private navigating = false;
  private memoryStatsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private electron: ElectronService,
    private pageCache: PageCacheService,
    private thumbnailCache: ThumbnailCacheService,
    public readerState: ReaderStateService,
    public zoomPan: ZoomPanService,
    private keybindings: KeybindingsService,
  ) {}

  ngOnInit(): void {
    if (this.electron.isElectron) {
      this.unsubFileOpened = this.electron.onFileOpened((filePath: string) => {
        this.openFile(filePath);
      });
      this.unsubWindowState = this.electron.onWindowStateChanged((state: WindowState) => {
        this.isAlwaysOnTop.set(state.isAlwaysOnTop);
        this.isFullscreen.set(state.isFullscreen);
      });
      this.unsubOpenProgress = this.electron.onOpenFileProgress((event) => {
        if (event.sessionId === this.openingSessionId()) {
          this.loadingMessage.set(event.message);
        }
      });
      this.unsubOpenComplete = this.electron.onOpenFileComplete((event) => {
        if (event.sessionId === this.openingSessionId()) {
          this.completeOpenFile(event.info);
        }
      });
      this.unsubOpenError = this.electron.onOpenFileError((event) => {
        if (event.sessionId === this.openingSessionId()) {
          this.openingSessionId.set(null);
          this.loading.set(false);
          this.loadingMessage.set('Abriendo archivo...');
          this.error.set(event.message);
          this.fileInfo.set(null);
        }
      });
      this.unsubOpenCancelled = this.electron.onOpenFileCancelled((event) => {
        if (event.sessionId === this.openingSessionId()) {
          this.openingSessionId.set(null);
          this.loading.set(false);
          this.loadingMessage.set('Abriendo archivo...');
          this.fileInfo.set(null);
        }
      });
      // Get initial state
      this.electron.getWindowState().then((state) => {
        this.isAlwaysOnTop.set(state.isAlwaysOnTop);
        this.isFullscreen.set(state.isFullscreen);
      });

      // Load keybindings and recent files
      this.keybindings.load();
      this.loadRecentFiles();
      this.startMemoryLogging();
    }
  }

  private async loadRecentFiles(): Promise<void> {
    try {
      const files = await this.electron.getRecentFiles();
      this.recentFiles.set(files);
    } catch { /* ignore */ }
  }

  ngOnDestroy(): void {
    this.unsubFileOpened?.();
    this.unsubWindowState?.();
    this.unsubOpenProgress?.();
    this.unsubOpenComplete?.();
    this.unsubOpenError?.();
    this.unsubOpenCancelled?.();
    this.cancelOpenFile();
    this.closeCurrentFile();
    if (this.memoryStatsInterval) {
      clearInterval(this.memoryStatsInterval);
    }
  }

  // --- Context menu ---

  onContextMenu(event: MouseEvent): void {
    this.contextMenu.open(event);
  }

  onMenuAction(action: ContextMenuAction): void {
    // Actions with values need special handling
    switch (action.type) {
      case 'reading-mode':
        this.readerState.readingMode.set(action.value);
        this.persistSettings();
        return;
      case 'fit-mode':
        this.readerState.fitMode.set(action.value);
        this.persistSettings();
        return;
      case 'page-layout':
        this.readerState.pageLayout.set(action.value);
        this.refreshCurrentPage();
        this.persistSettings();
        return;
      case 'always-on-top':
        this.electron.toggleAlwaysOnTop();
        return;
    }

    // Map context menu types to keybinding action names
    // open-folder needs special handling
    if (action.type === 'open-folder') {
      this.openFolderDialog();
      return;
    }

    const actionMap: Record<string, string> = {
      'open-file': 'open-file',
      'new-window': 'new-window',
      'thumbnails': 'toggle-thumbnails',
      'goto-page': 'goto-page',
      'reset-filters': 'reset-filters',
      'close-file': 'close-file',
      'zen-mode': 'toggle-zen',
      'fullscreen': 'toggle-fullscreen',
      'add-bookmark': 'add-bookmark',
      'load-full-quality': 'load-full-quality',
    };

    const mapped = actionMap[action.type];
    if (mapped) {
      this.executeAction(mapped);
    }
  }

  async addBookmark(): Promise<void> {
    const info = this.fileInfo();
    if (!info) return;
    const page = this.currentPageIndex();
    const name = `Página ${page + 1}`;
    await this.electron.addBookmark({
      fileHash: info.fileHash,
      page,
      name,
      createdAt: new Date().toISOString(),
    });
  }

  // --- Zen mode ---

  toggleZenMode(): void {
    const entering = !this.zenMode();
    this.zenMode.set(entering);
    if (entering) {
      this.showThumbnails.set(false);
      if (!this.isFullscreen()) {
        this.electron.toggleFullscreen();
      }
    } else {
      if (this.isFullscreen()) {
        this.electron.toggleFullscreen();
      }
    }
  }

  onDoubleClick(): void {
    if (this.fileInfo()) {
      this.toggleZenMode();
    }
  }

  // --- Keyboard ---

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Escape always works — cascading close
    if (event.key === 'Escape') {
      if (this.zenMode()) { this.toggleZenMode(); return; }
      if (this.showGoToPage()) { this.showGoToPage.set(false); return; }
      if (this.showThumbnails()) { this.showThumbnails.set(false); return; }
      return;
    }

    // Don't handle other keys when goto dialog is open
    if (this.showGoToPage()) return;

    // Match via configurable keybindings
    const action = this.keybindings.match(event);
    if (action) {
      event.preventDefault();
      this.executeAction(action);
      return;
    }

    // Arrow keys when zoomed → pan instead of navigate
    if (this.fileInfo() && this.zoomPan.isZoomed() && !event.ctrlKey && !event.shiftKey) {
      const PAN_STEP = 50;
      switch (event.key) {
        case 'ArrowRight': event.preventDefault(); this.zoomPan.pan(-PAN_STEP, 0); return;
        case 'ArrowLeft': event.preventDefault(); this.zoomPan.pan(PAN_STEP, 0); return;
        case 'ArrowDown': event.preventDefault(); this.zoomPan.pan(0, -PAN_STEP); return;
        case 'ArrowUp': event.preventDefault(); this.zoomPan.pan(0, PAN_STEP); return;
      }
    }
  }

  /** Central action dispatcher — used by keybindings and context menu */
  private executeAction(action: string): void {
    const isReversed = this.readerState.isReversed();
    const isVertical = this.readerState.isVertical();

    switch (action) {
      // File
      case 'open-file': this.openFileDialog(); break;
      case 'close-file': this.closeCurrentFile(); break;
      case 'new-window': this.electron.newWindow(); break;

      // Navigation (respects reading direction)
      case 'next-page':
        if (!this.fileInfo()) break;
        if (!isVertical) { isReversed ? this.prevPage() : this.nextPage(); }
        else { this.nextPage(); }
        break;
      case 'prev-page':
        if (!this.fileInfo()) break;
        if (!isVertical) { isReversed ? this.nextPage() : this.prevPage(); }
        else { this.prevPage(); }
        break;
      case 'next-page-alt': case 'next-page-alt2':
        this.nextPage(); break;
      case 'prev-page-alt':
        this.prevPage(); break;
      case 'first-page': this.goToPage(0); break;
      case 'last-page': this.goToPage((this.fileInfo()?.totalPages ?? 1) - 1); break;
      case 'goto-page':
        if (this.fileInfo()) {
          this.showGoToPage.set(true);
          setTimeout(() => {
            const input = document.querySelector('.goto-dialog input') as HTMLInputElement;
            input?.select();
          }, 0);
        }
        break;

      // Zoom
      case 'zoom-in': this.zoomPan.zoomIn(); break;
      case 'zoom-out': this.zoomPan.zoomOut(); break;
      case 'zoom-reset': this.zoomPan.resetZoom(); break;

      // Filters
      case 'brightness-up': this.zoomPan.adjustBrightness(5); break;
      case 'brightness-down': this.zoomPan.adjustBrightness(-5); break;
      case 'contrast-up': this.zoomPan.adjustContrast(5); break;
      case 'contrast-down': this.zoomPan.adjustContrast(-5); break;
      case 'reset-filters': this.zoomPan.resetFilters(); break;

      // Modes
      case 'cycle-reading-mode': this.readerState.cycleReadingMode(); this.persistSettings(); break;
      case 'toggle-page-layout': this.readerState.togglePageLayout(); this.refreshCurrentPage(); this.persistSettings(); break;
      case 'cycle-fit-mode': this.readerState.cycleFitMode(); this.persistSettings(); break;

      // UI
      case 'toggle-thumbnails': this.showThumbnails.update(v => !v); break;
      case 'toggle-zen': this.toggleZenMode(); break;
      case 'toggle-fullscreen': this.electron.toggleFullscreen(); break;
      case 'add-bookmark': this.addBookmark(); break;
      case 'load-full-quality': this.loadCurrentPageFullQuality(); break;
    }
  }

  // --- Click navigation ---

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (!this.fileInfo()) return;
    if (this.showGoToPage()) return;
    if (this.zoomPan.isZoomed()) return;

    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('app-thumbnails') || target.closest('app-toolbar') || target.closest('app-context-menu')) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const clickX = event.clientX - rect.left;

    if (this.readerState.isForwardClick(clickX, rect.width)) {
      this.nextPage();
    } else {
      this.prevPage();
    }
  }

  // --- Mouse wheel ---

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent): void {
    if (!this.fileInfo()) return;

    if (event.ctrlKey) {
      event.preventDefault();
      const container = this.viewerContainer?.nativeElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      this.zoomPan.zoomAtPoint(delta, event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
      return;
    }

    if (event.deltaY > 0) { this.nextPage(); }
    else if (event.deltaY < 0) { this.prevPage(); }
  }

  // --- Pan ---

  onPanStart(event: MouseEvent): void {
    if (!this.zoomPan.isZoomed() || event.button !== 0) return;
    this.isPanning = true;
    this.lastPanX = event.clientX;
    this.lastPanY = event.clientY;
    event.preventDefault();
  }

  onPanMove(event: MouseEvent): void {
    if (!this.isPanning) return;
    this.zoomPan.pan(event.clientX - this.lastPanX, event.clientY - this.lastPanY);
    this.lastPanX = event.clientX;
    this.lastPanY = event.clientY;
  }

  onPanEnd(): void { this.isPanning = false; }

  // --- Drag & Drop ---

  onDragOver(event: DragEvent): void { event.preventDefault(); event.stopPropagation(); this.isDragOver.set(true); }
  onDragLeave(event: DragEvent): void { event.preventDefault(); event.stopPropagation(); this.isDragOver.set(false); }

  onDrop(event: DragEvent): void {
    event.preventDefault(); event.stopPropagation(); this.isDragOver.set(false);
    const filePath = this.extractDroppedPath(event);
    if (filePath) {
      this.openFile(filePath);
    }
  }

  cancelOpenFile(): void {
    const sessionId = this.openingSessionId();
    if (sessionId !== null) {
      this.electron.cancelOpenFile(sessionId);
      this.loadingMessage.set('Cancelando apertura...');
    }
  }

  // --- File operations ---

  async openFileDialog(): Promise<void> {
    const filePath = await this.electron.openFileDialog();
    if (filePath) { await this.openFile(filePath); }
  }

  async openFolderDialog(): Promise<void> {
    const folderPath = await this.electron.openFolderDialog();
    if (folderPath) { await this.openFile(folderPath); }
  }

  async openFile(filePath: string): Promise<void> {
    if (this.openingSessionId() !== null) {
      this.cancelOpenFile();
      return;
    }

    await this.closeCurrentFile();
    this.loading.set(true);
    this.loadingMessage.set('Preparando archivo...');
    this.error.set(null);

    try {
      const session = await this.electron.startOpenFile(filePath);
      if (session.sessionId === 0 && session.info) {
        await this.completeOpenFile(session.info);
        return;
      }
      this.openingSessionId.set(session.sessionId);
    } catch (err: any) {
      this.error.set(err.message || 'Error al abrir el archivo');
      this.fileInfo.set(null);
      this.loading.set(false);
    }
  }

  goToPageFromInput(value: string): void {
    const page = parseInt(value, 10);
    if (!isNaN(page) && page >= 1 && page <= (this.fileInfo()?.totalPages ?? 0)) {
      this.showGoToPage.set(false);
      this.goToPage(page - 1);
    }
  }

  // --- Navigation ---

  async nextPage(): Promise<void> {
    const info = this.fileInfo();
    if (!info) return;
    const next = this.currentPageIndex() + this.getNavigationStep();
    if (next < info.totalPages) { await this.goToPage(next); }
  }

  async prevPage(): Promise<void> {
    const prev = this.currentPageIndex() - this.getNavigationStep();
    if (prev >= 0) { await this.goToPage(prev); }
  }

  async goToPage(index: number): Promise<void> {
    const info = this.fileInfo();
    if (!info || this.navigating) return;

    index = Math.max(0, Math.min(index, info.totalPages - 1));
    this.navigating = true;

    try {
      const cached = await this.pageCache.navigateTo(index);
      if (cached) {
        this.currentPageUrl.set(cached.blobUrl);
        this.currentPageIndex.set(index);
        this.currentPageMeta = cached;
        this.currentPageIsDegraded.set(cached.isDegraded);
        this.zoomPan.resetOnPageChange();
        await this.loadSecondPage(index, cached);
        this.saveProgress(info, index);
      }
    } finally {
      this.navigating = false;
    }
  }

  clearError(): void { this.error.set(null); }

  // --- Private ---

  private async loadSecondPage(firstIndex: number, firstMeta: CachedPage): Promise<void> {
    const info = this.fileInfo();
    if (!info || this.readerState.pageLayout() !== 'double' || this.readerState.isVertical() || this.readerState.isSpread(firstMeta.width, firstMeta.height)) {
      this.secondPageUrl.set(null);
      return;
    }

    const secondIndex = firstIndex + 1;
    if (secondIndex >= info.totalPages) { this.secondPageUrl.set(null); return; }

    const secondUrl = await this.pageCache.getPage(secondIndex);
    const secondMeta = this.pageCache.getCachedMeta(secondIndex);

    if (secondMeta && this.readerState.isSpread(secondMeta.width, secondMeta.height)) {
      this.secondPageUrl.set(null);
      return;
    }
    this.secondPageUrl.set(secondUrl);
  }

  private getNavigationStep(): number {
    const isSpread = this.currentPageMeta ? this.readerState.isSpread(this.currentPageMeta.width, this.currentPageMeta.height) : false;
    return this.readerState.getStep(isSpread);
  }

  private async refreshCurrentPage(): Promise<void> {
    this.navigating = false;
    await this.goToPage(this.currentPageIndex());
  }

  private async closeCurrentFile(): Promise<void> {
    const info = this.fileInfo();
    this.thumbnailCache.clear();
    if (info) {
      this.pageCache.clear();
      this.currentPageUrl.set(null);
      this.secondPageUrl.set(null);
      this.currentPageIndex.set(0);
      this.currentPageMeta = null;
      this.currentPageIsDegraded.set(false);
      this.fileInfo.set(null);
      this.zoomPan.resetAll();
      this.showThumbnails.set(false);
      await this.electron.cleanupTemp(info.fileHash);
      this.loadRecentFiles();
    }
  }

  private async completeOpenFile(info: FileInfo): Promise<void> {
    this.fileInfo.set(info);

    try {
      const settings = await this.electron.getSettings();
      this.readerState.applySettings(settings);
      this.pageCache.init(info.fileHash, info.totalPages, settings.slidingWindowSize, settings.slidingWindowSize, settings.prefetchCount);
      this.thumbnailCache.init(info.fileHash, info.totalPages);

      const progress = await this.electron.getProgress(info.fileHash);
      await this.goToPage(progress ? progress.currentPage : 0);
    } catch (err: any) {
      this.error.set(err.message || 'Error al inicializar el archivo');
      this.fileInfo.set(null);
    } finally {
      this.openingSessionId.set(null);
      this.loading.set(false);
      this.loadingMessage.set('Abriendo archivo...');
    }
  }

  private async loadCurrentPageFullQuality(): Promise<void> {
    const index = this.currentPageIndex();
    const cached = await this.pageCache.loadFullQuality(index);
    if (!cached) return;

    this.currentPageUrl.set(cached.blobUrl);
    this.currentPageMeta = cached;
    this.currentPageIsDegraded.set(cached.isDegraded);
    await this.loadSecondPage(index, cached);
  }

  private extractDroppedPath(event: DragEvent): string | null {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const directPath = window.electronAPI?.getPathForFile(files[0]) || (files[0] as any).path;
      if (typeof directPath === 'string' && directPath.length > 0) {
        return directPath;
      }
    }

    const items = event.dataTransfer?.items;
    if (items && items.length > 0) {
      const itemFile = items[0].getAsFile();
      const itemPath = itemFile ? (window.electronAPI?.getPathForFile(itemFile) || (itemFile as any)?.path) : null;
      if (typeof itemPath === 'string' && itemPath.length > 0) {
        return itemPath;
      }
    }

    const uriList = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain');
    if (uriList) {
      const firstLine = uriList.split('\n').find((line) => line.trim().length > 0 && !line.startsWith('#'))?.trim();
      if (firstLine?.startsWith('file://')) {
        try {
          return decodeURIComponent(firstLine.replace('file://', ''));
        } catch {
          return firstLine.replace('file://', '');
        }
      }
    }

    return null;
  }

  private startMemoryLogging(): void {
    const isDev = window.location.hostname === 'localhost';
    if (!isDev) return;

    this.memoryStatsInterval = setInterval(async () => {
      if (!this.fileInfo()) return;

      const processStats = await this.electron.getMemoryStats();
      const rendererMemory = (performance as any).memory;
      this.electron.logMemoryStats({
        mainRssBytes: processStats.mainRssBytes,
        rendererHeapUsedBytes: rendererMemory?.usedJSHeapSize ?? null,
        rendererHeapLimitBytes: rendererMemory?.jsHeapSizeLimit ?? null,
        pageCacheBytes: this.pageCache.stats.totalSizeBytes,
        pageCachePages: this.pageCache.stats.cachedPages,
        thumbnailCacheBytes: this.thumbnailCache.stats.totalSizeBytes,
        thumbnailCacheEntries: this.thumbnailCache.stats.cachedEntries,
      });
    }, 5000);
  }

  private saveProgress(info: FileInfo, page: number): void {
    this.electron.saveProgress({
      fileHash: info.fileHash, filePath: info.filePath,
      currentPage: page, totalPages: info.totalPages,
      lastRead: new Date().toISOString(),
    });
  }

  private persistSettings(): void {
    this.electron.saveSettings({
      readingMode: this.readerState.readingMode(),
      fitMode: this.readerState.fitMode(),
      pageLayout: this.readerState.pageLayout(),
    });
  }
}
