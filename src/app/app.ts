import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TitlebarComponent } from './components/titlebar/titlebar.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TitlebarComponent],
  template: `
    <app-titlebar />
    <main class="app-content">
      <router-outlet />
    </main>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: #1a1a1a;
      color: #e0e0e0;
    }

    .app-content {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
  `,
})
export class App {}
