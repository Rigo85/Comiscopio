import { Component, input, output, signal, HostListener } from '@angular/core';
import type { ReadingMode, FitMode, PageLayout } from '../../../../shared/models';

export interface ContextMenuAction {
  type:
    | 'reading-mode'
    | 'fit-mode'
    | 'page-layout'
    | 'always-on-top'
    | 'fullscreen'
    | 'thumbnails'
    | 'goto-page'
    | 'open-file'
    | 'reset-filters'
    | 'close-file'
    | 'new-window'
    | 'zen-mode'
    | 'add-bookmark'
    | 'goto-bookmark';
  value?: any;
}

interface MenuItem {
  label: string;
  action: ContextMenuAction;
  active?: boolean;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

type MenuEntry = MenuItem | MenuSeparator;

@Component({
  selector: 'app-context-menu',
  template: `
    @if (visible()) {
      <div class="menu-backdrop" (click)="close()" (contextmenu)="$event.preventDefault(); close()">
        <div
          class="menu"
          [style.left.px]="x()"
          [style.top.px]="y()"
          (click)="$event.stopPropagation()"
        >
          @for (entry of menuItems(); track $index) {
            @if (entry.separator) {
              <div class="menu-separator"></div>
            } @else {
              <button
                class="menu-item"
                [class.active]="$any(entry).active"
                (click)="onAction($any(entry).action)"
              >
                {{ $any(entry).label }}
              </button>
            }
          }
        </div>
      </div>
    }
  `,
  styles: `
    .menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
    }

    .menu {
      position: fixed;
      background: #2b2b2b;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 4px 0;
      min-width: 200px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      z-index: 51;
    }

    .menu-item {
      display: block;
      width: 100%;
      padding: 6px 16px;
      background: none;
      border: none;
      color: #ccc;
      font-size: 13px;
      text-align: left;
      cursor: pointer;

      &:hover {
        background: #3a3a4a;
        color: #fff;
      }

      &.active {
        color: #8af;

        &::before {
          content: '● ';
          font-size: 8px;
          vertical-align: middle;
        }
      }
    }

    .menu-separator {
      height: 1px;
      background: #444;
      margin: 4px 0;
    }
  `,
})
export class ContextMenuComponent {
  hasFile = input(false);
  readingMode = input<ReadingMode>('ltr');
  fitMode = input<FitMode>('fit-width');
  pageLayout = input<PageLayout>('single');
  isAlwaysOnTop = input(false);
  isFullscreen = input(false);
  showThumbnails = input(false);

  action = output<ContextMenuAction>();

  visible = signal(false);
  x = signal(0);
  y = signal(0);

  menuItems = signal<MenuEntry[]>([]);

  open(event: MouseEvent): void {
    event.preventDefault();
    this.x.set(event.clientX);
    this.y.set(event.clientY);
    this.buildMenu();
    this.visible.set(true);

    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
      const menu = document.querySelector('.menu') as HTMLElement;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        this.x.set(event.clientX - rect.width);
      }
      if (rect.bottom > window.innerHeight) {
        this.y.set(event.clientY - rect.height);
      }
    });
  }

  close(): void {
    this.visible.set(false);
  }

  onAction(act: ContextMenuAction): void {
    this.close();
    this.action.emit(act);
  }

  @HostListener('window:keydown.escape')
  onEsc(): void {
    this.close();
  }

  private buildMenu(): void {
    const items: MenuEntry[] = [];

    items.push({ label: 'Abrir archivo...', action: { type: 'open-file' } });
    items.push({ label: 'Nueva ventana', action: { type: 'new-window' } });

    if (this.hasFile()) {
      items.push({ separator: true });

      // Reading modes
      const rm = this.readingMode();
      items.push({ label: 'Cómic (LTR)', action: { type: 'reading-mode', value: 'ltr' }, active: rm === 'ltr' });
      items.push({ label: 'Manga (RTL)', action: { type: 'reading-mode', value: 'rtl' }, active: rm === 'rtl' });
      items.push({ label: 'Vertical (Webtoon)', action: { type: 'reading-mode', value: 'vertical' }, active: rm === 'vertical' });

      items.push({ separator: true });

      // Page layout
      const pl = this.pageLayout();
      items.push({ label: 'Página simple', action: { type: 'page-layout', value: 'single' }, active: pl === 'single' });
      items.push({ label: 'Doble página', action: { type: 'page-layout', value: 'double' }, active: pl === 'double' });

      items.push({ separator: true });

      // Fit modes
      const fm = this.fitMode();
      items.push({ label: 'Ajustar al ancho', action: { type: 'fit-mode', value: 'fit-width' }, active: fm === 'fit-width' });
      items.push({ label: 'Ajustar al alto', action: { type: 'fit-mode', value: 'fit-height' }, active: fm === 'fit-height' });
      items.push({ label: 'Ajustar a la página', action: { type: 'fit-mode', value: 'fit-page' }, active: fm === 'fit-page' });
      items.push({ label: 'Tamaño original', action: { type: 'fit-mode', value: 'original' }, active: fm === 'original' });

      items.push({ separator: true });

      items.push({ label: 'Ir a página...', action: { type: 'goto-page' } });
      items.push({ label: 'Agregar marcador', action: { type: 'add-bookmark' } });
      items.push({ label: 'Miniaturas', action: { type: 'thumbnails' }, active: this.showThumbnails() });
      items.push({ label: 'Resetear filtros', action: { type: 'reset-filters' } });

      items.push({ separator: true });

      items.push({ label: 'Cerrar archivo', action: { type: 'close-file' } });
    }

    items.push({ separator: true });

    items.push({ label: 'Siempre visible', action: { type: 'always-on-top' }, active: this.isAlwaysOnTop() });
    items.push({ label: 'Pantalla completa', action: { type: 'fullscreen' }, active: this.isFullscreen() });
    items.push({ label: 'Modo zen', action: { type: 'zen-mode' } });

    this.menuItems.set(items);
  }
}
