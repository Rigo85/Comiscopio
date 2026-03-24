import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/viewer/viewer.component').then((m) => m.ViewerComponent),
  },
];
