import { Component, input, output, signal } from '@angular/core';

/**
 * Bottom toolbar with page slider.
 * Auto-hides: appears when mouse enters bottom zone, hides after 2s of inactivity.
 */
@Component({
  selector: 'app-toolbar',
  template: `
    <div
      class="toolbar"
      [class.visible]="visible()"
      (mouseenter)="onMouseEnter()"
      (mouseleave)="onMouseLeave()"
    >
      <span class="toolbar-page">{{ currentPage() + 1 }}</span>
      <input
        #slider
        type="range"
        class="toolbar-slider"
        [min]="0"
        [max]="totalPages() - 1"
        [value]="currentPage()"
        (input)="onSliderInput(slider.value)"
        (change)="onSliderChange(slider.value)"
        (pointerdown)="$event.stopPropagation()"
        (click)="$event.stopPropagation()"
      />
      <span class="toolbar-page">{{ totalPages() }}</span>
    </div>
    <div
      class="toolbar-trigger"
      [class.inactive]="visible()"
      (mouseenter)="show()"
    ></div>
  `,
  styles: `
    :host {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 15;
      pointer-events: none;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(4px);
      border-top: 1px solid #333;
      transform: translateY(100%);
      transition: transform 0.2s ease;
      pointer-events: auto;

      &.visible {
        transform: translateY(0);
      }
    }

    .toolbar-trigger {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      pointer-events: auto;

      &.inactive {
        pointer-events: none;
      }
    }

    .toolbar-page {
      color: #aaa;
      font-size: 12px;
      min-width: 30px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .toolbar-slider {
      flex: 1;
      height: 4px;
      appearance: none;
      background: #444;
      border-radius: 2px;
      outline: none;
      cursor: pointer;

      &::-webkit-slider-thumb {
        appearance: none;
        width: 10px;
        height: 18px;
        border-radius: 3px;
        background: #c7c7c7;
        cursor: pointer;
        transition: background 0.1s;
        border: 1px solid #1f1f1f;

        &:hover {
          background: #fff;
        }
      }

      &::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
      }
    }
  `,
})
export class ToolbarComponent {
  currentPage = input.required<number>();
  totalPages = input.required<number>();
  pageChange = output<number>();

  visible = signal(false);
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  show(): void {
    this.visible.set(true);
    this.resetHideTimer();
  }

  hide(): void {
    this.visible.set(false);
  }

  onMouseEnter(): void {
    this.visible.set(true);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
  }

  onMouseLeave(): void {
    this.resetHideTimer();
  }

  onSliderInput(value: string): void {
    const page = parseInt(value, 10);
    if (!isNaN(page)) {
      this.pageChange.emit(page);
    }
  }

  onSliderChange(value: string): void {
    const page = parseInt(value, 10);
    if (!isNaN(page)) {
      this.pageChange.emit(page);
    }
  }

  private resetHideTimer(): void {
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    this.hideTimeout = setTimeout(() => this.hide(), 2000);
  }
}
