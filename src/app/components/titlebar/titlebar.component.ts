import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { ElectronService, WindowState } from '../../services/electron.service';

@Component({
  selector: 'app-titlebar',
  template: `
    @if (!isFullscreen()) {
      <div class="titlebar" (dblclick)="onMaximize()">
        <div class="titlebar-drag">
          <span class="titlebar-title">Comiscopio</span>
          @if (isAlwaysOnTop()) {
            <span class="titlebar-badge" title="Siempre visible">
              <svg width="10" height="10" viewBox="0 0 16 16">
                <path d="M4.5 1.5a.5.5 0 0 1 1 0V4h5V1.5a.5.5 0 0 1 1 0V4h1a.5.5 0 0 1 .5.5v2a2.5 2.5 0 0 1-2 2.45V12h1.5a.5.5 0 0 1 0 1h-4v2.5a.5.5 0 0 1-1 0V13h-4a.5.5 0 0 1 0-1H5V8.95A2.5 2.5 0 0 1 3 6.5v-2A.5.5 0 0 1 3.5 4h1V1.5z" fill="currentColor"/>
              </svg>
            </span>
          }
        </div>
        <div class="titlebar-controls">
          <button class="titlebar-btn" (click)="onMinimize()" title="Minimizar">
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor"/>
            </svg>
          </button>
          <button class="titlebar-btn" (click)="onMaximize()" [title]="isMaximized() ? 'Restaurar' : 'Maximizar'">
            @if (isMaximized()) {
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M2 0v2H0v8h8V8h2V0H2zm6 8H1V3h7v5zm1-6H3V1h6v5h-0V2z" fill="currentColor"/>
              </svg>
            } @else {
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect width="10" height="10" fill="none" stroke="currentColor" stroke-width="1"/>
              </svg>
            }
          </button>
          <button class="titlebar-btn titlebar-btn--close" (click)="onClose()" title="Cerrar">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .titlebar {
      display: flex;
      align-items: center;
      height: 32px;
      background: #2b2b2b;
      user-select: none;
      flex-shrink: 0;
    }

    .titlebar-drag {
      flex: 1;
      -webkit-app-region: drag;
      height: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      padding-left: 12px;
    }

    .titlebar-title {
      font-size: 12px;
      color: #999;
      font-weight: 500;
    }

    .titlebar-badge {
      display: flex;
      align-items: center;
      color: #e8a817;
      opacity: 0.8;
    }

    .titlebar-controls {
      display: flex;
      height: 100%;
      -webkit-app-region: no-drag;
    }

    .titlebar-btn {
      width: 46px;
      height: 100%;
      border: none;
      background: transparent;
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.1s;

      &:hover {
        background: #3a3a3a;
        color: #fff;
      }

      &--close:hover {
        background: #e81123;
        color: #fff;
      }
    }
  `,
})
export class TitlebarComponent implements OnInit, OnDestroy {
  isMaximized = signal(false);
  isFullscreen = signal(false);
  isAlwaysOnTop = signal(false);

  private unsubscribe?: () => void;

  constructor(private electron: ElectronService) {}

  ngOnInit(): void {
    if (this.electron.isElectron) {
      this.electron.getWindowState().then((state) => this.applyState(state));
      this.unsubscribe = this.electron.onWindowStateChanged((state) => this.applyState(state));
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  onMinimize(): void {
    this.electron.minimize();
  }

  onMaximize(): void {
    this.electron.maximize();
  }

  onClose(): void {
    this.electron.close();
  }

  private applyState(state: WindowState): void {
    this.isMaximized.set(state.isMaximized);
    this.isFullscreen.set(state.isFullscreen);
    this.isAlwaysOnTop.set(state.isAlwaysOnTop);
  }
}
