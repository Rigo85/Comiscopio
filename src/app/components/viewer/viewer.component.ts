import { Component, OnInit, OnDestroy, HostListener, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { ElectronService, WindowState } from '../../services/electron.service';
import { PageCacheService, CachedPage, PageArtifactSource } from '../../services/page-cache.service';
import { ThumbnailCacheService } from '../../services/thumbnail-cache.service';
import { ReaderStateService } from '../../services/reader-state.service';
import { ZoomPanService } from '../../services/zoom-pan.service';
import { KeybindingsService } from '../../services/keybindings.service';
import { ToolbarComponent } from '../toolbar/toolbar.component';
import { ContextMenuComponent, ContextMenuAction } from '../context-menu/context-menu.component';
import { ThumbnailsComponent } from '../thumbnails/thumbnails.component';
import type { RecentFile, Bookmark } from '../../../../shared/models';
import type { KeyBinding } from '../../../../shared/keybindings';
import { APP_METADATA } from '../../../../shared/app-metadata';

interface FileState {
  fileHash: string;
  sessionId: string;
  fileName: string;
  filePath: string;
  totalPages: number;
}

interface ShortcutSection {
  title: string;
  items: KeyBinding[];
}

interface VerticalPageItem {
  index: number;
  ready: boolean;
  url: string | null;
  aspectRatio: string | null;
}

@Component({
  selector: 'app-viewer',
  imports: [ToolbarComponent, ContextMenuComponent, ThumbnailsComponent],
  template: `
    @if (loading()) {
      <div class="viewer-overlay">
        <div class="viewer-loading">
          <p>{{ loadingMessage() }}</p>
          @if (loading()) {
            <button class="loading-cancel" (click)="cancelOpen()">Cancelar</button>
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

    @if (showShortcuts()) {
      <div class="viewer-overlay" (click)="showShortcuts.set(false)">
        <div
          class="shortcuts-modal"
          (click)="$event.stopPropagation()"
          (wheel)="onShortcutsWheel($event)"
        >
          <div class="shortcuts-header">
            <h2>Atajos</h2>
            <button class="shortcuts-close" (click)="showShortcuts.set(false)" title="Cerrar">Cerrar</button>
          </div>

          <div class="shortcuts-content">
            @for (section of shortcutSections(); track section.title) {
              <section class="shortcuts-section">
                <h3>{{ section.title }}</h3>
                <div class="shortcuts-list">
                  @for (item of section.items; track item.action) {
                    <div class="shortcut-row">
                      <span class="shortcut-label">{{ item.label }}</span>
                      <kbd>{{ formatShortcut(item.keys) }}</kbd>
                    </div>
                  }
                </div>
              </section>
            }
          </div>
        </div>
      </div>
    }

    @if (showAbout()) {
      <div class="viewer-overlay" (click)="showAbout.set(false)">
        <div class="about-modal" (click)="$event.stopPropagation()">
          <div class="about-header">
            <div>
              <h2>{{ appMetadata.name }}</h2>
              <p>{{ appMetadata.description }}</p>
            </div>
            <button class="about-close" (click)="showAbout.set(false)" title="Cerrar">Cerrar</button>
          </div>

          <div class="about-content">
            <div class="about-row">
              <span class="about-label">Version</span>
              <span class="about-value">{{ appMetadata.version }}</span>
            </div>
            <div class="about-row">
              <span class="about-label">Autor</span>
              <span class="about-value">{{ appMetadata.author }}</span>
            </div>
            <div class="about-row">
              <span class="about-label">Licencia</span>
              <span class="about-value">{{ appMetadata.license }}</span>
            </div>
            <div class="about-row about-row-stack">
              <span class="about-label">Repositorio</span>
              <code class="about-code">{{ appMetadata.repositoryUrl }}</code>
            </div>
          </div>
        </div>
      </div>
    }

    @if (showBookmarks()) {
      <div class="viewer-overlay" (click)="showBookmarks.set(false)">
        <div class="bookmarks-modal" (click)="$event.stopPropagation()">
          <div class="bookmarks-header">
            <h2>Marcadores</h2>
            <button class="bookmarks-close" (click)="showBookmarks.set(false)" title="Cerrar">Cerrar</button>
          </div>
          <div class="bookmarks-content">
            @if (bookmarks().length === 0) {
              <p class="bookmarks-empty">No hay marcadores para este archivo.</p>
            } @else {
              @for (bookmark of bookmarks(); track bookmark.id ?? (bookmark.page + ':' + bookmark.createdAt)) {
                <div class="bookmark-row">
                  <button class="bookmark-main" (click)="goToBookmark(bookmark)">
                    <span class="bookmark-name">{{ bookmark.name }}</span>
                    <span class="bookmark-page">Página {{ bookmark.page + 1 }}</span>
                  </button>
                  <button class="bookmark-delete" (click)="removeBookmark(bookmark, $event)" title="Eliminar marcador">
                    Eliminar
                  </button>
                </div>
              }
            }
          </div>
        </div>
      </div>
    }

    @if (isDragOver()) {
      <div
        class="drag-drop-overlay"
        (dragenter)="onDragEnter($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      ></div>
    }

    @if (!fileState()) {
      <div
        class="viewer-container"
        [class.drag-over]="isDragOver()"
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
        [class.pannable]="canPanReader()"
        (mousedown)="onPanStart($event)"
        (mousemove)="onPanMove($event)"
        (mouseup)="onPanEnd()"
        (mouseleave)="onPanEnd()"
        (contextmenu)="onContextMenu($event)"
        #viewerContainer
      >
        <app-thumbnails
          [visible]="showThumbnails()"
          [currentPage]="currentPageIndex()"
          [totalPages]="fileState()!.totalPages"
          [fileHash]="fileState()!.fileHash"
          (visibleChange)="showThumbnails.set($event)"
          (pageSelect)="goToPage($event)"
        />

        <div
          class="pages-wrapper"
          [class.double-layout]="isDoublePage()"
          [class.rtl-layout]="readerState.isReversed()"
          [class.vertical-strip]="readerState.isVertical()"
          [class.with-thumbnails]="showThumbnails()"
          (scroll)="onViewerScroll()"
          [style.transform]="zoomPan.transformStyle()"
          [style.filter]="zoomPan.filterStyle()"
          #pagesWrapper
        >
          @if (readerState.isVertical()) {
            @for (page of verticalPages(); track page.index) {
              <div
                class="vertical-page"
                [attr.data-page-index]="page.index"
                [style.aspect-ratio]="page.aspectRatio"
              >
                @if (page.url) {
                  <img
                    class="viewer-image vertical-image"
                    [src]="page.url"
                    [alt]="'Página ' + (page.index + 1)"
                    draggable="false"
                  />
                } @else {
                  <div class="vertical-placeholder">Página {{ page.index + 1 }}</div>
                }
              </div>
            }
          } @else {
            @if (currentPageUrl()) {
              <img
                class="viewer-image"
                [class]="fitClass()"
                [src]="currentPageUrl()"
                [alt]="'Página ' + (currentPageIndex() + 1)"
                (error)="onCurrentImageError()"
                draggable="false"
              />
            }
            @if (secondPageUrl()) {
              <img
                class="viewer-image"
                [class]="fitClass()"
                [src]="secondPageUrl()"
                [alt]="'Página ' + (currentPageIndex() + 2)"
                (error)="onSecondImageError()"
                draggable="false"
              />
            }
          }
        </div>

        <div class="page-indicator">
          @if (secondPageUrl()) {
            {{ currentPageIndex() + 1 }}-{{ currentPageIndex() + 2 }} / {{ fileState()!.totalPages }}
          } @else {
            {{ currentPageIndex() + 1 }} / {{ fileState()!.totalPages }}
          }
          @if (zoomPan.isZoomed()) {
            <span class="zoom-label">{{ zoomPan.getZoomLabel() }}</span>
          }
          @if (zoomPan.hasFilters()) {
            <span class="filter-label">B:{{ zoomPan.brightness() }} C:{{ zoomPan.contrast() }}</span>
          }
          <span class="mode-label">{{ readerState.getReadingModeLabel() }}</span>
        </div>

        <app-toolbar
          [currentPage]="currentPageIndex()"
          [totalPages]="fileState()!.totalPages"
          (pageChange)="goToPage($event)"
        />

        @if (showGoToPage()) {
          <div class="goto-overlay" (click)="showGoToPage.set(false)">
            <div class="goto-dialog" (click)="$event.stopPropagation()">
              <label>Ir a página:</label>
              <input
                #gotoInput
                type="number"
                min="1"
                [max]="fileState()!.totalPages"
                [value]="currentPageIndex() + 1"
                (keydown.enter)="goToPageFromInput(gotoInput.value)"
                (keydown.escape)="showGoToPage.set(false)"
              />
              <span class="goto-total">/ {{ fileState()!.totalPages }}</span>
            </div>
          </div>
        }
      </div>
    }

    <app-context-menu
      [hasFile]="!!fileState()"
      [readingMode]="readerState.readingMode()"
      [fitMode]="readerState.fitMode()"
      [pageLayout]="readerState.pageLayout()"
      [isAlwaysOnTop]="isAlwaysOnTop()"
      [isFullscreen]="isFullscreen()"
      [showThumbnails]="showThumbnails()"
      [pageSource]="pageSource()"
      (action)="onMenuAction($event)"
      #contextMenu
    />
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }

    .viewer-container {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      background: #1a1a1a; position: relative; overflow: hidden;
      &.drag-over { background: #2a2a3a; outline: 2px dashed #667; outline-offset: -8px; }
      &.vertical-mode { align-items: stretch; }
      &.pannable { cursor: grab; &:active { cursor: grabbing; } }
    }

    .viewer-reading { cursor: default; }

    .pages-wrapper {
      display: flex; align-items: center; justify-content: center;
      height: 100%; width: 100%; gap: 0;
      transform-origin: center center;
      will-change: transform, filter;
      transition: filter 0.15s ease, margin-left 0.2s ease;
      &.double-layout { gap: 2px; }
      &.rtl-layout { flex-direction: row-reverse; }
      &.with-thumbnails { margin-left: 160px; width: calc(100% - 160px); }
      &.vertical-strip {
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        height: 100%;
        padding: 16px 0 40px;
        gap: 12px;
        overflow-y: auto;
      }
    }

    .viewer-welcome {
      text-align: center; color: #666;
      h1 { font-size: 2rem; font-weight: 300; margin-bottom: 0.5rem; color: #888; }
      p { font-size: 0.9rem; margin: 0.25rem 0; }
      .hint { font-size: 0.8rem; color: #555; margin-top: 1rem; }
    }

    .open-btn {
      margin-top: 1.5rem; padding: 8px 24px;
      background: #3a3a3a; color: #ccc;
      border: 1px solid #555; border-radius: 4px;
      cursor: pointer; font-size: 0.9rem;
      &:hover { background: #4a4a4a; color: #fff; }
    }

    .recent-section {
      margin-top: 2rem; text-align: left; max-width: 400px; width: 100%;
      h3 { font-size: 0.8rem; color: #777; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    }
    .recent-list { display: flex; flex-direction: column; gap: 2px; }
    .recent-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 10px; background: transparent; border: none; border-radius: 4px;
      color: #aaa; cursor: pointer; text-align: left; font-size: 13px;
      &:hover { background: #2a2a2a; color: #ddd; }
      .recent-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px; }
      .recent-progress { color: #666; font-size: 11px; flex-shrink: 0; }
    }

    .viewer-image {
      user-select: none; display: block;
      &.fit-width { width: 100%; height: auto; max-height: none; }
      &.fit-height { height: 100%; width: auto; max-width: none; }
      &.fit-page { max-width: 100%; max-height: 100%; object-fit: contain; }
      &.fit-original { /* no constraints */ }
    }
    .double-layout .viewer-image {
      &.fit-width { width: 50%; }
      &.fit-page { max-width: 50%; }
    }
    .vertical-page {
      width: min(100%, 980px);
      display: flex;
      align-items: center;
      justify-content: center;
      scroll-margin-top: 12px;
    }
    .vertical-image {
      width: 100%;
      height: auto;
      max-width: 100%;
      max-height: none;
      object-fit: contain;
    }
    .vertical-placeholder {
      width: 100%;
      min-height: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      background: #202020;
      border: 1px solid #2c2c2c;
      border-radius: 8px;
      font-size: 0.9rem;
    }

    .page-indicator {
      position: absolute; bottom: 8px; right: 12px;
      background: rgba(0, 0, 0, 0.6); color: #aaa;
      padding: 2px 8px; border-radius: 4px; font-size: 12px;
      pointer-events: none; display: flex; gap: 8px; z-index: 5;
      .mode-label { color: #777; }
      .zoom-label { color: #8af; }
      .filter-label { color: #fa8; }
    }

    .viewer-overlay {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; background: rgba(0, 0, 0, 0.7); z-index: 10;
    }
    .drag-drop-overlay {
      position: fixed;
      inset: 0;
      z-index: 60;
    }
    .viewer-loading {
      color: #aaa; font-size: 1.1rem;
      display: flex; flex-direction: column; align-items: center; gap: 12px;
      p { margin: 0; }
    }
    .loading-cancel {
      padding: 6px 14px; background: #2f2f2f; color: #ddd;
      border: 1px solid #555; border-radius: 4px; cursor: pointer;
      &:hover { background: #3b3b3b; }
    }
    .viewer-error {
      text-align: center; color: #e55;
      p { margin-bottom: 1rem; max-width: 400px; white-space: pre-wrap; }
      button { padding: 6px 16px; background: #3a3a3a; color: #ccc; border: 1px solid #555; border-radius: 4px; cursor: pointer; &:hover { background: #4a4a4a; } }
    }
    .shortcuts-modal {
      width: min(720px, calc(100vw - 32px));
      max-height: min(80vh, 720px);
      overflow: auto;
      background: #252525;
      border: 1px solid #444;
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      color: #ddd;
    }
    .shortcuts-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px 12px;
      border-bottom: 1px solid #3a3a3a;
      h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: #f0f0f0; }
    }
    .shortcuts-close {
      padding: 6px 12px; background: #333; color: #ddd;
      border: 1px solid #555; border-radius: 6px; cursor: pointer;
      &:hover { background: #3d3d3d; }
    }
    .shortcuts-content {
      padding: 14px 18px 18px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .shortcuts-section {
      h3 {
        margin: 0 0 10px;
        font-size: 0.85rem;
        color: #9aa7c9;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    }
    .shortcuts-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .shortcut-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 10px;
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
    }
    .shortcut-label {
      color: #cfcfcf;
      font-size: 0.9rem;
    }
    kbd {
      min-width: fit-content;
      padding: 3px 8px;
      background: #111;
      border: 1px solid #555;
      border-bottom-color: #666;
      border-radius: 6px;
      color: #fafafa;
      font: inherit;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    .about-modal {
      width: min(560px, calc(100vw - 32px));
      background: #252525;
      border: 1px solid #444;
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      color: #ddd;
    }
    .about-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px 12px;
      border-bottom: 1px solid #3a3a3a;
      h2 { margin: 0 0 4px; font-size: 1.1rem; color: #f4f4f4; }
      p { margin: 0; color: #aaa; font-size: 0.95rem; }
    }
    .about-close {
      padding: 6px 12px; background: #333; color: #ddd;
      border: 1px solid #555; border-radius: 6px; cursor: pointer;
      &:hover { background: #3d3d3d; }
    }
    .about-content {
      padding: 16px 18px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .about-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 12px;
      align-items: start;
    }
    .about-row-stack {
      grid-template-columns: 1fr;
    }
    .about-label {
      color: #8fa0c4;
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .about-value {
      color: #ddd;
      font-size: 0.95rem;
    }
    .about-code {
      display: block;
      padding: 8px 10px;
      background: #1b1b1b;
      border: 1px solid #333;
      border-radius: 8px;
      color: #d9d9d9;
      font: inherit;
      font-size: 0.9rem;
      white-space: normal;
      word-break: break-word;
    }
    .bookmarks-modal {
      width: min(560px, calc(100vw - 32px));
      max-height: min(80vh, 680px);
      overflow: auto;
      background: #252525;
      border: 1px solid #444;
      border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      color: #ddd;
    }
    .bookmarks-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px 12px;
      border-bottom: 1px solid #3a3a3a;
      h2 { margin: 0; font-size: 1.05rem; font-weight: 600; color: #f0f0f0; }
    }
    .bookmarks-close,
    .bookmark-delete {
      padding: 6px 12px; background: #333; color: #ddd;
      border: 1px solid #555; border-radius: 6px; cursor: pointer;
      &:hover { background: #3d3d3d; }
    }
    .bookmarks-content {
      padding: 14px 18px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .bookmarks-empty {
      margin: 0;
      color: #9a9a9a;
      font-size: 0.95rem;
    }
    .bookmark-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
    }
    .bookmark-main {
      flex: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 0;
      background: none;
      border: none;
      color: #ddd;
      cursor: pointer;
      text-align: left;
    }
    .bookmark-name {
      font-size: 0.92rem;
      color: #ddd;
    }
    .bookmark-page {
      color: #8fa0c4;
      font-size: 0.86rem;
      white-space: nowrap;
    }
    .goto-overlay {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; background: rgba(0, 0, 0, 0.5); z-index: 20;
    }
    .goto-dialog {
      background: #2b2b2b; padding: 16px 20px; border-radius: 8px;
      display: flex; align-items: center; gap: 8px; border: 1px solid #444;
      label { color: #aaa; font-size: 0.9rem; }
      input { width: 80px; padding: 4px 8px; background: #1a1a1a; color: #eee; border: 1px solid #555; border-radius: 4px; font-size: 1rem; text-align: center; outline: none; &:focus { border-color: #777; } }
      .goto-total { color: #777; font-size: 0.9rem; }
    }
  `,
})
export class ViewerComponent implements OnInit, OnDestroy {
  // --- State ---
  fileState = signal<FileState | null>(null);
  currentPageUrl = signal<string | null>(null);
  secondPageUrl = signal<string | null>(null);
  currentPageIndex = signal(0);
  loading = signal(false);
  loadingMessage = signal('Abriendo archivo...');
  error = signal<string | null>(null);
  isDragOver = signal(false);
  showGoToPage = signal(false);
  showShortcuts = signal(false);
  showAbout = signal(false);
  showBookmarks = signal(false);
  showThumbnails = signal(true);
  isAlwaysOnTop = signal(false);
  isFullscreen = signal(false);
  recentFiles = signal<RecentFile[]>([]);
  pageSource = signal<PageArtifactSource>('optimized');
  shortcuts = signal<KeyBinding[]>([]);
  bookmarks = signal<Bookmark[]>([]);
  private verticalRenderVersion = signal(0);
  readonly appMetadata = APP_METADATA;
  shortcutSections = computed<ShortcutSection[]>(() => {
    const groups: Array<{ title: string; actions: string[] }> = [
      { title: 'Archivo', actions: ['open-file', 'close-file', 'new-window'] },
      { title: 'Navegacion', actions: ['next-page', 'prev-page', 'next-page-alt', 'prev-page-alt', 'next-page-alt2', 'first-page', 'last-page', 'goto-page'] },
      { title: 'Zoom', actions: ['zoom-in', 'zoom-out', 'zoom-reset'] },
      { title: 'Filtros', actions: ['brightness-up', 'brightness-down', 'contrast-up', 'contrast-down', 'reset-filters'] },
      { title: 'Vista', actions: ['cycle-reading-mode', 'toggle-page-layout', 'cycle-fit-mode', 'toggle-thumbnails', 'toggle-fullscreen', 'add-bookmark'] },
    ];
    const bindings = this.shortcuts();
    return groups
      .map((group) => ({
        title: group.title,
        items: group.actions
          .map((action) => bindings.find((binding) => binding.action === action))
          .filter((binding): binding is KeyBinding => !!binding),
      }))
      .filter((group) => group.items.length > 0);
  });

  private currentPageMeta: CachedPage | null = null;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private openingFileHash: string | null = null;
  private openingSessionId: string | null = null;
  private previewInitializedHash: string | null = null;
  private currentImageRetryKey: string | null = null;
  private secondImageRetryKey: string | null = null;
  private previewProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private pageReadyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private pageReadyRetryToken = 0;
  private postCloseTimers: Array<ReturnType<typeof setTimeout>> = [];
  private verticalScrollFramePending = false;

  isDoublePage = computed(() => {
    return this.readerState.pageLayout() === 'double'
      && this.secondPageUrl() !== null
      && !this.readerState.isVertical();
  });

  canPanReader = computed(() => {
    if (this.readerState.isVertical()) return false;
    return this.zoomPan.isZoomed() || this.readerState.fitMode() === 'original';
  });

  verticalPages = computed<VerticalPageItem[]>(() => {
    const state = this.fileState();
    const source = this.pageSource();
    this.verticalRenderVersion();
    if (!state || !this.readerState.isVertical()) return [];

    return Array.from({ length: state.totalPages }, (_, index) => {
      const ready = this.pageCache.isReady(index);
      const meta = this.pageCache.getPageMeta(index, source);
      return {
        index,
        ready,
        url: ready ? this.buildPageUrl(index, source) : null,
        aspectRatio: meta && meta.width > 0 && meta.height > 0 ? `${meta.width} / ${meta.height}` : null,
      };
    });
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
  @ViewChild('pagesWrapper') pagesWrapper?: ElementRef<HTMLElement>;
  @ViewChild('contextMenu') contextMenu!: ContextMenuComponent;

  private unsubFileOpened?: () => void;
  private unsubWindowState?: () => void;
  private unsubWorkerEvent?: () => void;
  private navigating = false;
  private dragDepth = 0;

  constructor(
    private electron: ElectronService,
    private pageCache: PageCacheService,
    private thumbnailCache: ThumbnailCacheService,
    public readerState: ReaderStateService,
    public zoomPan: ZoomPanService,
    private keybindings: KeybindingsService,
  ) {}

  ngOnInit(): void {
    if (!this.electron.isElectron) return;

    this.unsubFileOpened = this.electron.onFileOpened((filePath: string) => {
      this.openFile(filePath);
    });
    this.unsubWindowState = this.electron.onWindowStateChanged((state: WindowState) => {
      this.isAlwaysOnTop.set(state.isAlwaysOnTop);
      this.isFullscreen.set(state.isFullscreen);
    });
    this.unsubWorkerEvent = this.electron.onWorkerEvent((event: any) => {
      this.handleWorkerEvent(event);
    });

    this.electron.getWindowState().then((state) => {
      this.isAlwaysOnTop.set(state.isAlwaysOnTop);
      this.isFullscreen.set(state.isFullscreen);
    });

    void this.keybindings.load().then(() => {
      this.shortcuts.set(this.keybindings.getAll());
    });
    this.loadRecentFiles();
  }

  ngOnDestroy(): void {
    this.reportRendererStats('destroy');
    this.clearPostCloseDiagnostics();
    this.unsubFileOpened?.();
    this.unsubWindowState?.();
    this.unsubWorkerEvent?.();
    this.closeCurrentFile('destroy');
  }

  // --- Worker events ---

  private handleWorkerEvent(event: any): void {
    const hash = event.fileHash;
    if (hash !== this.openingFileHash && hash !== this.fileState()?.fileHash) return;

    switch (event.type) {
      case 'extracting':
        if (event.total > 0) {
          this.loadingMessage.set(`Extrayendo ${event.current + 1}/${event.total}...`);
        } else {
          this.loadingMessage.set(`Extrayendo... (${event.current + 1} páginas)`);
        }
        break;

      case 'archive':
        void this.refreshManifest(hash);
        queueMicrotask(() => {
          this.bumpVerticalRenderVersion();
          void this.completeOpen(hash, event.totalPages);
        });
        break;

      case 'ready':
        void this.refreshManifest(hash);
        // A page is available on disk
        this.pageCache.markReady(event.page);
        this.thumbnailCache.markReady(event.page);
        this.bumpVerticalRenderVersion();

        // If this is the page we're waiting for, show it
        if (this.currentPageIndex() === event.page && this.fileState()) {
          this.clearPageReadyRetry();
          this.currentPageUrl.set(this.buildPageUrl(event.page, this.pageSource()));
          this.currentPageMeta = this.pageCache.getPageMeta(event.page, this.pageSource());
          this.currentImageRetryKey = null;
          this.loadSecondPage(event.page);
        } else if (this.loading() && this.openingFileHash === hash && event.page === 0) {
          void this.initializePreview(hash, event.page);
        }
        break;

      case 'progress':
        void this.refreshManifest(hash);
        // Background thumb ready
        if (event.stage === 'thumb') {
          this.thumbnailCache.markReady(event.page);
        }
        break;

      case 'error':
        if (this.loading()) {
          this.loading.set(false);
          this.error.set(event.message || 'Error del worker');
          this.openingFileHash = null;
          this.openingSessionId = null;
          this.resetViewerState();
        }
        break;

      case 'done':
        // All processing complete
        break;
    }
  }

  private async completeOpen(fileHash: string, totalPages: number): Promise<void> {
    this.openingFileHash = null;
    this.openingSessionId = null;

    const settings = await this.electron.getSettings();
    this.readerState.applySettings(settings);
    if (this.previewInitializedHash !== fileHash) {
      this.pageCache.init(fileHash, totalPages, settings.slidingWindowSize, settings.slidingWindowSize);
      this.thumbnailCache.init(fileHash);
    } else {
      this.pageCache.init(fileHash, totalPages, this.pageCache.windowBefore, this.pageCache.windowAfter);
      this.thumbnailCache.init(fileHash);
      this.previewInitializedHash = null;
    }
    await this.refreshManifest(fileHash);

    // Recover ready state for pages the worker already processed (preview or
    // early processing) whose "ready" events were lost during cache re-init.
    this.pageCache.syncReadyFromManifest();
    this.thumbnailCache.syncReadyFromManifest(this.pageCache.manifestPages);

    this.fileState.update(s => s ? { ...s, totalPages } : s);

    const progress = await this.electron.getProgress(fileHash);
    const startPage = progress ? progress.currentPage : 0;

    this.loading.set(false);
    this.loadingMessage.set('Abriendo archivo...');
    this.reportRendererStats('open-complete');

    this.goToPage(startPage);
  }

  // --- Context menu ---

  onContextMenu(event: MouseEvent): void { this.contextMenu.open(event); }

  onMenuAction(action: ContextMenuAction): void {
    switch (action.type) {
      case 'reading-mode':
        this.readerState.readingMode.set(action.value);
        if (action.value === 'vertical') {
          this.secondPageUrl.set(null);
          this.bumpVerticalRenderVersion();
          this.scrollVerticalPageIntoView(this.currentPageIndex());
        } else {
          this.refreshCurrentPage();
        }
        this.persistSettings();
        return;
      case 'fit-mode':
        this.readerState.fitMode.set(action.value);
        this.zoomPan.resetZoom();
        this.persistSettings();
        return;
      case 'page-layout':
        this.readerState.pageLayout.set(action.value);
        this.refreshCurrentPage();
        this.persistSettings();
        return;
      case 'page-source':
        this.pageSource.set(action.value);
        this.refreshCurrentPage();
        return;
      case 'always-on-top':
        this.electron.toggleAlwaysOnTop();
        return;
      case 'open-folder':
        this.openFolderDialog();
        return;
      case 'shortcuts':
        this.showShortcuts.set(true);
        return;
      case 'about':
        this.showAbout.set(true);
        return;
      case 'goto-bookmark':
        void this.openBookmarks();
        return;
    }

    const actionMap: Record<string, string> = {
      'open-file': 'open-file', 'new-window': 'new-window',
      'thumbnails': 'toggle-thumbnails', 'goto-page': 'goto-page',
      'reset-filters': 'reset-filters', 'close-file': 'close-file',
      'fullscreen': 'toggle-fullscreen',
      'add-bookmark': 'add-bookmark',
    };
    const mapped = actionMap[action.type];
    if (mapped) this.executeAction(mapped);
  }

  async addBookmark(): Promise<void> {
    const state = this.fileState();
    if (!state) return;
    await this.electron.addBookmark({
      fileHash: state.fileHash, page: this.currentPageIndex(),
      name: `Página ${this.currentPageIndex() + 1}`,
      createdAt: new Date().toISOString(),
    });
    if (this.showBookmarks()) {
      await this.loadBookmarks(state.fileHash);
    }
  }

  async openBookmarks(): Promise<void> {
    const state = this.fileState();
    if (!state) return;
    await this.loadBookmarks(state.fileHash);
    this.showBookmarks.set(true);
  }

  async goToBookmark(bookmark: Bookmark): Promise<void> {
    this.showBookmarks.set(false);
    this.goToPage(bookmark.page);
  }

  async removeBookmark(bookmark: Bookmark, event?: Event): Promise<void> {
    event?.stopPropagation();
    if (bookmark.id == null) return;
    await this.electron.removeBookmark(bookmark.id);
    const state = this.fileState();
    if (!state) return;
    await this.loadBookmarks(state.fileHash);
  }

  // --- Keyboard ---

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'F1') {
      event.preventDefault();
      this.showShortcuts.update((value) => !value);
      return;
    }
    if (event.key === 'Escape') {
      if (this.showAbout()) { this.showAbout.set(false); return; }
      if (this.showBookmarks()) { this.showBookmarks.set(false); return; }
      if (this.showShortcuts()) { this.showShortcuts.set(false); return; }
      if (this.showGoToPage()) { this.showGoToPage.set(false); return; }
      if (this.showThumbnails()) { this.showThumbnails.set(false); return; }
      return;
    }
    if (this.showGoToPage()) return;

    const action = this.keybindings.match(event);
    if (action) { event.preventDefault(); this.executeAction(action); return; }

    if (this.fileState() && this.canPanReader() && !event.ctrlKey && !event.shiftKey) {
      const S = 50;
      switch (event.key) {
        case 'ArrowRight': event.preventDefault(); this.zoomPan.pan(-S, 0, this.readerState.fitMode() === 'original'); return;
        case 'ArrowLeft': event.preventDefault(); this.zoomPan.pan(S, 0, this.readerState.fitMode() === 'original'); return;
        case 'ArrowDown': event.preventDefault(); this.zoomPan.pan(0, -S, this.readerState.fitMode() === 'original'); return;
        case 'ArrowUp': event.preventDefault(); this.zoomPan.pan(0, S, this.readerState.fitMode() === 'original'); return;
      }
    }
  }

  private executeAction(action: string): void {
    const isReversed = this.readerState.isReversed();
    const isVertical = this.readerState.isVertical();

    switch (action) {
      case 'open-file': this.openFileDialog(); break;
      case 'close-file': this.closeCurrentFile('manual'); break;
      case 'new-window': this.electron.newWindow(); break;
      case 'next-page':
        if (!this.fileState()) break;
        if (!isVertical) { isReversed ? this.prevPage() : this.nextPage(); } else { this.nextPage(); }
        break;
      case 'prev-page':
        if (!this.fileState()) break;
        if (!isVertical) { isReversed ? this.nextPage() : this.prevPage(); } else { this.prevPage(); }
        break;
      case 'next-page-alt': case 'next-page-alt2': this.nextPage(); break;
      case 'prev-page-alt': this.prevPage(); break;
      case 'first-page': this.goToPage(0); break;
      case 'last-page': this.goToPage((this.fileState()?.totalPages ?? 1) - 1); break;
      case 'goto-page':
        if (this.fileState()) {
          this.showGoToPage.set(true);
          setTimeout(() => { (document.querySelector('.goto-dialog input') as HTMLInputElement)?.select(); }, 0);
        }
        break;
      case 'zoom-in': this.zoomPan.zoomIn(); break;
      case 'zoom-out': this.zoomPan.zoomOut(); break;
      case 'zoom-reset': this.zoomPan.resetZoom(); break;
      case 'brightness-up': this.zoomPan.adjustBrightness(5); break;
      case 'brightness-down': this.zoomPan.adjustBrightness(-5); break;
      case 'contrast-up': this.zoomPan.adjustContrast(5); break;
      case 'contrast-down': this.zoomPan.adjustContrast(-5); break;
      case 'reset-filters': this.zoomPan.resetFilters(); break;
      case 'cycle-reading-mode': {
        const mode = this.readerState.cycleReadingMode();
        if (mode === 'vertical') {
          this.secondPageUrl.set(null);
          this.bumpVerticalRenderVersion();
          this.scrollVerticalPageIntoView(this.currentPageIndex());
        } else {
          this.refreshCurrentPage();
        }
        this.persistSettings();
        break;
      }
      case 'toggle-page-layout': this.readerState.togglePageLayout(); this.refreshCurrentPage(); this.persistSettings(); break;
      case 'cycle-fit-mode': this.readerState.cycleFitMode(); this.persistSettings(); break;
      case 'toggle-thumbnails': this.showThumbnails.update(v => !v); break;
      case 'toggle-fullscreen': this.electron.toggleFullscreen(); break;
      case 'add-bookmark': this.addBookmark(); break;
    }
  }

  // --- Click navigation ---

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent): void {
    if (!this.fileState() || this.showGoToPage() || this.canPanReader() || this.readerState.isVertical()) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' ||
        target.closest('app-thumbnails') || target.closest('app-toolbar') || target.closest('app-context-menu')) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (this.readerState.isForwardClick(event.clientX - rect.left, rect.width)) {
      this.nextPage();
    } else {
      this.prevPage();
    }
  }

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent): void {
    if (!this.fileState()) return;
    if (event.ctrlKey) {
      event.preventDefault();
      const c = this.viewerContainer?.nativeElement;
      if (!c) return;
      const r = c.getBoundingClientRect();
      this.zoomPan.zoomAtPoint(event.deltaY > 0 ? -0.1 : 0.1, event.clientX - r.left, event.clientY - r.top, r.width, r.height);
      return;
    }
    if (this.readerState.isVertical()) {
      return;
    }
    if (event.deltaY > 0) {
      this.readerState.isReversed() ? this.prevPage() : this.nextPage();
    } else if (event.deltaY < 0) {
      this.readerState.isReversed() ? this.nextPage() : this.prevPage();
    }
  }

  // --- Pan ---
  onPanStart(event: MouseEvent): void {
    if (!this.canPanReader() || event.button !== 0) return;
    this.isPanning = true; this.lastPanX = event.clientX; this.lastPanY = event.clientY; event.preventDefault();
  }
  onPanMove(event: MouseEvent): void {
    if (!this.isPanning) return;
    this.zoomPan.pan(
      event.clientX - this.lastPanX,
      event.clientY - this.lastPanY,
      this.readerState.fitMode() === 'original',
    );
    this.lastPanX = event.clientX; this.lastPanY = event.clientY;
  }
  onPanEnd(): void { this.isPanning = false; }

  onViewerScroll(): void {
    if (!this.readerState.isVertical() || this.verticalScrollFramePending) return;
    this.verticalScrollFramePending = true;
    requestAnimationFrame(() => {
      this.verticalScrollFramePending = false;
      this.syncVerticalCurrentPage();
    });
  }

  @HostListener('window:dragenter', ['$event'])
  onWindowDragEnter(event: DragEvent): void {
    this.handleGlobalDragEnter(event);
  }

  @HostListener('window:dragover', ['$event'])
  onWindowDragOver(event: DragEvent): void {
    this.handleGlobalDragOver(event);
  }

  @HostListener('window:dragleave', ['$event'])
  onWindowDragLeave(event: DragEvent): void {
    this.handleGlobalDragLeave(event);
  }

  @HostListener('window:drop', ['$event'])
  onWindowDrop(event: DragEvent): void {
    this.handleGlobalDrop(event);
  }

  // --- Drag & Drop ---
  onDragEnter(event: DragEvent): void {
    this.handleGlobalDragEnter(event);
  }

  onDragOver(event: DragEvent): void {
    this.handleGlobalDragOver(event);
  }

  onDragLeave(event: DragEvent): void {
    this.handleGlobalDragLeave(event);
  }

  onDrop(event: DragEvent): void {
    this.handleGlobalDrop(event);
  }

  // --- File operations ---

  async openFileDialog(): Promise<void> {
    const p = await this.electron.openFileDialog();
    if (p) this.openFile(p);
  }

  async openFolderDialog(): Promise<void> {
    const p = await this.electron.openFolderDialog();
    if (p) this.openFile(p);
  }

  cancelOpen(): void {
    if (this.openingFileHash) {
      this.electron.workerClose(this.openingFileHash, {
        sessionId: this.openingSessionId ?? undefined,
        reason: 'cancel-open',
      });
      this.openingFileHash = null;
      this.openingSessionId = null;
      this.clearPreviewProbe();
      this.clearPageReadyRetry();
      this.resetViewerState();
      this.loading.set(false);
      this.loadingMessage.set('Abriendo archivo...');
    }
  }

  async openFile(filePath: string): Promise<void> {
    if (this.openingFileHash) { this.cancelOpen(); }
    this.closeCurrentFile('open-replace');

    this.loading.set(true);
    this.loadingMessage.set('Preparando archivo...');
    this.error.set(null);

    try {
      const result = await this.electron.workerStart(filePath);
      this.openingFileHash = result.fileHash;
      this.openingSessionId = result.sessionId;

      this.fileState.set({
        fileHash: result.fileHash,
        sessionId: result.sessionId,
        fileName: result.fileName,
        filePath: result.filePath,
        totalPages: result.totalPages || 0,
      });
      this.schedulePreviewProbe(result.fileHash);

      if (result.alreadyOpen) {
        // Already extracted — go straight to reading
        await this.completeOpen(result.fileHash, result.totalPages);
      }
      // Otherwise, wait for "archive" event from worker
    } catch (err: any) {
      this.loading.set(false);
      this.error.set(err.message || 'Error al abrir el archivo');
      this.fileState.set(null);
      this.openingFileHash = null;
      this.openingSessionId = null;
    }
  }

  goToPageFromInput(value: string): void {
    const page = parseInt(value, 10);
    if (!isNaN(page) && page >= 1 && page <= (this.fileState()?.totalPages ?? 0)) {
      this.showGoToPage.set(false);
      this.goToPage(page - 1);
    }
  }

  // --- Navigation ---

  nextPage(): void {
    const s = this.fileState();
    if (!s) return;
    const next = this.currentPageIndex() + this.getNavigationStep();
    if (next < s.totalPages) this.goToPage(next);
  }

  prevPage(): void {
    const prev = this.currentPageIndex() - this.getNavigationStep();
    if (prev >= 0) this.goToPage(prev);
  }

  goToPage(index: number): void {
    const s = this.fileState();
    if (!s || this.navigating) return;

    index = Math.max(0, Math.min(index, s.totalPages - 1));
    this.navigating = true;

    try {
      this.pageCache.navigateTo(index, this.pageSource());
      this.currentPageIndex.set(index);
      this.currentPageMeta = this.pageCache.getPageMeta(index, this.pageSource());
      this.currentImageRetryKey = null;
      this.clearPageReadyRetry();
      if (this.readerState.isVertical()) {
        this.currentPageUrl.set(this.pageCache.isReady(index) ? this.buildPageUrl(index, this.pageSource()) : null);
        this.secondPageUrl.set(null);
        this.zoomPan.resetOnPageChange();
        this.scrollVerticalPageIntoView(index);
        this.saveProgress(s, index);
        return;
      }
      if (this.pageCache.isReady(index)) {
        this.currentPageUrl.set(this.buildPageUrl(index, this.pageSource()));
      } else {
        this.schedulePageReadyRetry(index, this.pageSource());
      }
      this.zoomPan.resetOnPageChange();
      this.resetReaderScrollPosition();
      this.loadSecondPage(index);
      this.saveProgress(s, index);
    } finally {
      this.navigating = false;
    }
  }

  clearError(): void { this.error.set(null); }

  formatShortcut(value: string): string {
    return value === ' ' ? 'Espacio' : value;
  }

  onShortcutsWheel(event: WheelEvent): void {
    event.stopPropagation();
  }

  // --- Private ---

  private loadSecondPage(firstIndex: number): void {
    const s = this.fileState();
    if (!s || this.readerState.pageLayout() !== 'double' || this.readerState.isVertical()) {
      this.secondPageUrl.set(null);
      return;
    }
    if (this.currentPageMeta && this.readerState.isSpread(this.currentPageMeta.width, this.currentPageMeta.height)) {
      this.secondPageUrl.set(null);
      return;
    }
    const secondIndex = firstIndex + 1;
    if (secondIndex >= s.totalPages) { this.secondPageUrl.set(null); return; }

    const secondMeta = this.pageCache.getPageMeta(secondIndex, this.pageSource());
    if (secondMeta && this.readerState.isSpread(secondMeta.width, secondMeta.height)) {
      this.secondPageUrl.set(null);
      return;
    }
    this.secondImageRetryKey = null;
    if (this.pageCache.isReady(secondIndex)) {
      this.secondPageUrl.set(this.buildPageUrl(secondIndex, this.pageSource()));
    } else {
      this.secondPageUrl.set(null);
    }
  }

  private getNavigationStep(): number {
    const isSpread = this.currentPageMeta ? this.readerState.isSpread(this.currentPageMeta.width, this.currentPageMeta.height) : false;
    return this.readerState.getStep(isSpread);
  }

  private refreshCurrentPage(): void {
    this.navigating = false;
    if (this.readerState.isVertical()) {
      this.currentPageUrl.set(this.pageCache.isReady(this.currentPageIndex())
        ? this.buildPageUrl(this.currentPageIndex(), this.pageSource())
        : null);
      this.secondPageUrl.set(null);
      this.currentPageMeta = this.pageCache.getPageMeta(this.currentPageIndex(), this.pageSource());
      this.bumpVerticalRenderVersion();
      return;
    }
    this.goToPage(this.currentPageIndex());
  }

  private resetReaderScrollPosition(): void {
    const container = this.readerState.isVertical()
      ? this.pagesWrapper?.nativeElement
      : this.viewerContainer?.nativeElement;
    if (!container) return;

    container.scrollTop = 0;
    container.scrollLeft = 0;

    requestAnimationFrame(() => {
      const currentContainer = this.readerState.isVertical()
        ? this.pagesWrapper?.nativeElement
        : this.viewerContainer?.nativeElement;
      if (!currentContainer) return;
      currentContainer.scrollTop = 0;
      currentContainer.scrollLeft = 0;
    });
  }

  private closeCurrentFile(reason = 'manual'): void {
    const s = this.fileState();
    this.clearPostCloseDiagnostics();
    if (s) {
      this.reportRendererStats('close-begin', { reason });
    }
    this.thumbnailCache.clear();
    if (s) {
      this.pageCache.clear();
      this.currentPageUrl.set(null);
      this.secondPageUrl.set(null);
      this.currentPageIndex.set(0);
      this.currentPageMeta = null;
      this.fileState.set(null);
      this.pageSource.set('optimized');
      this.previewInitializedHash = null;
      this.openingSessionId = null;
      this.currentImageRetryKey = null;
      this.secondImageRetryKey = null;
      this.clearPreviewProbe();
      this.clearPageReadyRetry();
      this.zoomPan.resetAll();
      this.electron.workerClose(s.fileHash, { sessionId: s.sessionId, reason });
      this.reportRendererStats('close-after-worker-close', { reason, sessionId: s.sessionId });
      this.schedulePostCloseDiagnostics(reason, s.sessionId);
      this.loadRecentFiles();
    } else {
      this.openingSessionId = null;
    }
  }

  private resetViewerState(): void {
    this.pageCache.clear();
    this.thumbnailCache.clear();
    this.fileState.set(null);
    this.currentPageUrl.set(null);
    this.secondPageUrl.set(null);
    this.currentPageIndex.set(0);
    this.currentPageMeta = null;
    this.pageSource.set('optimized');
    this.previewInitializedHash = null;
    this.currentImageRetryKey = null;
    this.secondImageRetryKey = null;
    this.clearPreviewProbe();
    this.clearPageReadyRetry();
    this.zoomPan.resetAll();
  }

  private async loadRecentFiles(): Promise<void> {
    try { this.recentFiles.set(await this.electron.getRecentFiles()); } catch { /* ignore */ }
  }

  private async loadBookmarks(fileHash: string): Promise<void> {
    try {
      this.bookmarks.set(await this.electron.getBookmarks(fileHash));
    } catch {
      this.bookmarks.set([]);
    }
  }

  private extractDroppedPath(event: DragEvent): string | null {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const p = window.electronAPI?.getPathForFile(files[0]) || (files[0] as any).path;
      if (typeof p === 'string' && p.length > 0) return p;
    }
    return null;
  }

  private hasFileDrag(event: DragEvent): boolean {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) return true;

    const items = event.dataTransfer?.items;
    if (items && Array.from(items).some((item) => item.kind === 'file')) return true;

    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).some((type) =>
      type === 'Files' ||
      type.toLowerCase().includes('file') ||
      type === 'application/x-moz-file'
    );
  }

  private handleGlobalDragEnter(event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.preventDefault();
    this.dragDepth += 1;
    if (this.hasFileDrag(event)) {
      this.isDragOver.set(true);
    }
  }

  private handleGlobalDragOver(event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (this.hasFileDrag(event)) {
      this.isDragOver.set(true);
    }
  }

  private handleGlobalDragLeave(event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);

    if (event.target === document.documentElement || event.target === document.body) {
      this.dragDepth = 0;
    }

    if (this.dragDepth === 0) {
      this.isDragOver.set(false);
    }
  }

  private handleGlobalDrop(event: DragEvent): void {
    if (!event.dataTransfer) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragOver.set(false);
    const filePath = this.extractDroppedPath(event);
    if (filePath) {
      void this.openFile(filePath);
    }
  }

  private saveProgress(state: FileState, page: number): void {
    this.electron.saveProgress({
      fileHash: state.fileHash, filePath: state.filePath,
      currentPage: page, totalPages: state.totalPages,
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

  private async refreshManifest(fileHash: string): Promise<void> {
    try {
      const manifest = await this.electron.getWorkerManifest(fileHash);
      if (manifest?.pages) {
        this.pageCache.updateManifest(manifest.pages);
        this.bumpVerticalRenderVersion();
      }
    } catch {
      // Ignore transient read/write races while worker updates manifest.
    }
  }

  private async initializePreview(fileHash: string, pageIndex: number): Promise<void> {
    if (this.previewInitializedHash === fileHash) return;

    const settings = await this.electron.getSettings();
    this.readerState.applySettings(settings);
    this.pageCache.init(fileHash, Math.max(pageIndex + 1, 1), settings.slidingWindowSize, settings.slidingWindowSize);
    this.thumbnailCache.init(fileHash);
    this.pageCache.markReady(pageIndex);
    this.thumbnailCache.markReady(pageIndex);
    await this.refreshManifest(fileHash);

    const previewUrl = this.buildPageUrl(pageIndex, this.pageSource());
    this.currentPageUrl.set(previewUrl);
    this.currentPageIndex.set(pageIndex);
    this.currentPageMeta = this.pageCache.getPageMeta(pageIndex, this.pageSource());
    this.secondPageUrl.set(null);
    this.previewInitializedHash = fileHash;
    this.clearPreviewProbe();
    this.fileState.update(s => s ? { ...s, totalPages: Math.max(s.totalPages, pageIndex + 1) } : s);
    this.bumpVerticalRenderVersion();
    this.reportRendererStats('preview-ready');
  }

  private schedulePreviewProbe(fileHash: string, attempt = 0): void {
    this.clearPreviewProbe();
    if (!this.loading() || this.openingFileHash !== fileHash || this.previewInitializedHash === fileHash) {
      return;
    }

    this.previewProbeTimer = setTimeout(async () => {
      if (!this.loading() || this.openingFileHash !== fileHash || this.previewInitializedHash === fileHash) {
        return;
      }

      try {
        const manifest = await this.electron.getWorkerManifest(fileHash);
        const page0 = manifest?.pages?.[0];
        if (page0?.page) {
          await this.initializePreview(fileHash, 0);
          return;
        }
      } catch {
        // Ignore manifest races while the worker writes preview output.
      }

      if (attempt < 40) {
        this.schedulePreviewProbe(fileHash, attempt + 1);
      }
    }, attempt === 0 ? 0 : 100);
  }

  private clearPreviewProbe(): void {
    if (this.previewProbeTimer) {
      clearTimeout(this.previewProbeTimer);
      this.previewProbeTimer = null;
    }
  }

  private schedulePageReadyRetry(pageIndex: number, source: PageArtifactSource, attempt = 0, token?: number): void {
    const retryToken = token ?? ++this.pageReadyRetryToken;
    if (token === undefined) {
      this.clearPageReadyRetry();
    }

    this.pageReadyRetryTimer = setTimeout(() => {
      if (retryToken !== this.pageReadyRetryToken) {
        return;
      }
      if (this.currentPageIndex() !== pageIndex || this.pageSource() !== source) {
        return;
      }
      if (this.pageCache.isReady(pageIndex)) {
        this.currentPageUrl.set(this.buildPageUrl(pageIndex, source));
        this.currentPageMeta = this.pageCache.getPageMeta(pageIndex, source);
        this.clearPageReadyRetry();
        this.loadSecondPage(pageIndex);
        return;
      }
      if (attempt < 15) {
        this.schedulePageReadyRetry(pageIndex, source, attempt + 1, retryToken);
        return;
      }
      this.currentPageUrl.set(null);
      this.clearPageReadyRetry();
    }, attempt === 0 ? 40 : 60);
  }

  private clearPageReadyRetry(): void {
    this.pageReadyRetryToken += 1;
    if (this.pageReadyRetryTimer) {
      clearTimeout(this.pageReadyRetryTimer);
      this.pageReadyRetryTimer = null;
    }
  }

  private schedulePostCloseDiagnostics(reason: string, sessionId: string | null): void {
    for (const delay of [250, 1000, 3000]) {
      const timer = setTimeout(() => {
        this.reportRendererStats(`close-post-${delay}ms`, { reason, sessionId });
      }, delay);
      this.postCloseTimers.push(timer);
    }
  }

  private clearPostCloseDiagnostics(): void {
    for (const timer of this.postCloseTimers) {
      clearTimeout(timer);
    }
    this.postCloseTimers = [];
  }

  private bumpVerticalRenderVersion(): void {
    this.verticalRenderVersion.update((value) => value + 1);
  }

  private scrollVerticalPageIntoView(index: number): void {
    requestAnimationFrame(() => {
      const container = this.pagesWrapper?.nativeElement;
      const target = container?.querySelector(`[data-page-index="${index}"]`) as HTMLElement | null;
      if (!container || !target) return;
      target.scrollIntoView({ block: 'start' });
    });
  }

  private syncVerticalCurrentPage(): void {
    const state = this.fileState();
    const container = this.pagesWrapper?.nativeElement;
    if (!state || !container) return;

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + (container.clientHeight * 0.35);
    const pages = Array.from(container.querySelectorAll('.vertical-page')) as HTMLElement[];
    let bestIndex = this.currentPageIndex();
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue;
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - centerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = Number(page.dataset['pageIndex'] ?? bestIndex);
      }
    }

    if (bestIndex === this.currentPageIndex()) return;

    this.currentPageIndex.set(bestIndex);
    this.currentPageMeta = this.pageCache.getPageMeta(bestIndex, this.pageSource());
    this.currentPageUrl.set(this.pageCache.isReady(bestIndex) ? this.buildPageUrl(bestIndex, this.pageSource()) : null);
    this.secondPageUrl.set(null);
    this.pageCache.navigateTo(bestIndex, this.pageSource());
    this.saveProgress(state, bestIndex);
  }

  private buildPageUrl(pageIndex: number, source: PageArtifactSource, retry = 0): string {
    const base = this.pageCache.getPageUrl(pageIndex, source);
    return retry > 0 ? `${base}&view=${retry}` : base;
  }

  onCurrentImageError(): void {
    const pageIndex = this.currentPageIndex();
    const key = `${pageIndex}:${this.pageSource()}`;
    if (this.currentImageRetryKey === key || !this.pageCache.isReady(pageIndex)) {
      return;
    }
    this.currentImageRetryKey = key;
    this.currentPageUrl.set(this.buildPageUrl(pageIndex, this.pageSource(), 1));
  }

  onSecondImageError(): void {
    const pageIndex = this.currentPageIndex() + 1;
    const key = `${pageIndex}:${this.pageSource()}`;
    if (this.secondImageRetryKey === key || !this.pageCache.isReady(pageIndex)) {
      return;
    }
    this.secondImageRetryKey = key;
    this.secondPageUrl.set(this.buildPageUrl(pageIndex, this.pageSource(), 1));
  }

  private reportRendererStats(label: string, extra: Record<string, unknown> = {}): void {
    if (!this.electron.isElectron) return;

    const perfMemory = (performance as any).memory;
    const pageStats = this.pageCache.stats;
    const thumbnailReady = (this.thumbnailCache as any).readyThumbs?.size ?? 0;
    const thumbnailVersionCount = (this.thumbnailCache as any).thumbVersions?.size ?? 0;
    const thumbnailList = document.querySelector('.thumbnails-list') as HTMLElement | null;
    const thumbnailItems = Array.from(document.querySelectorAll('.thumbnail-item')) as HTMLElement[];
    const thumbnailImgs = Array.from(document.querySelectorAll('.thumbnail-item img')) as HTMLImageElement[];
    const thumbnailPlaceholders = document.querySelectorAll('.thumbnail-placeholder').length;
    const pageImages = Array.from(document.querySelectorAll('.viewer-image')) as HTMLImageElement[];
    const visiblePageImgs = pageImages.length;
    const thumbnailViewportRect = thumbnailList?.getBoundingClientRect() ?? null;
    const pageImageRects = pageImages.map((img) => img.getBoundingClientRect());
    const pageImageNaturalWidths = pageImages.map((img) => img.naturalWidth || 0);
    const pageImageNaturalHeights = pageImages.map((img) => img.naturalHeight || 0);
    const pageImageClientWidths = pageImageRects.map((rect) => Math.round(rect.width));
    const pageImageClientHeights = pageImageRects.map((rect) => Math.round(rect.height));
    const activePageUrls = pageImages
      .map((img) => img.currentSrc || img.src || '')
      .filter((url) => !!url);
    const currentPageMeta = this.currentPageMeta;
    const secondPageMeta = this.fileState()
      ? this.pageCache.getPageMeta(this.currentPageIndex() + 1, this.pageSource())
      : null;
    const thumbnailItemsInViewport = thumbnailList
      ? thumbnailItems.filter((item) => {
          const rect = item.getBoundingClientRect();
          return rect.bottom > thumbnailViewportRect!.top && rect.top < thumbnailViewportRect!.bottom;
        }).length
      : 0;
    const thumbnailImgsInViewport = thumbnailList
      ? thumbnailImgs.filter((img) => {
          const rect = img.getBoundingClientRect();
          return rect.bottom > thumbnailViewportRect!.top && rect.top < thumbnailViewportRect!.bottom;
        }).length
      : 0;

    this.electron.reportRendererStats({
      label,
      sessionId: this.fileState()?.sessionId ?? this.openingSessionId ?? '',
      hasFile: !!this.fileState(),
      currentPage: this.currentPageIndex(),
      totalPages: this.fileState()?.totalPages ?? 0,
      showThumbnails: this.showThumbnails(),
      isDoublePage: this.isDoublePage(),
      pageSource: this.pageSource(),
      pageReady: pageStats.readyPages,
      pageTotal: pageStats.totalPages,
      thumbReady: thumbnailReady,
      thumbVersioned: thumbnailVersionCount,
      thumbnailItemsDom: thumbnailItems.length,
      thumbnailImgsDom: thumbnailImgs.length,
      thumbnailPlaceholdersDom: thumbnailPlaceholders,
      thumbnailItemsInViewport,
      thumbnailImgsInViewport,
      thumbnailScrollTop: thumbnailList?.scrollTop ?? 0,
      thumbnailViewportHeight: thumbnailList?.clientHeight ?? 0,
      thumbnailScrollHeight: thumbnailList?.scrollHeight ?? 0,
      visiblePageImgs,
      pageImageNaturalWidths: pageImageNaturalWidths.join(','),
      pageImageNaturalHeights: pageImageNaturalHeights.join(','),
      pageImageClientWidths: pageImageClientWidths.join(','),
      pageImageClientHeights: pageImageClientHeights.join(','),
      activePageUrlCount: activePageUrls.length,
      currentPageUrlActive: this.currentPageUrl() ? 1 : 0,
      secondPageUrlActive: this.secondPageUrl() ? 1 : 0,
      currentPageMetaWidth: currentPageMeta?.width ?? 0,
      currentPageMetaHeight: currentPageMeta?.height ?? 0,
      secondPageMetaWidth: secondPageMeta?.width ?? 0,
      secondPageMetaHeight: secondPageMeta?.height ?? 0,
      jsHeapUsed: perfMemory?.usedJSHeapSize ?? 0,
      jsHeapTotal: perfMemory?.totalJSHeapSize ?? 0,
      jsHeapLimit: perfMemory?.jsHeapSizeLimit ?? 0,
      ...extra,
    });
  }
}
