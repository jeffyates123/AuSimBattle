import { Routes } from '@angular/router';
import { adminGuard, authGuard, loginGuard } from './auth.guard';
import { AdminComponent } from './admin';
import { App } from './app';
import { LoginComponent } from './login';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, canMatch: [loginGuard] },
  { path: 'planner', component: App, canMatch: [authGuard] },
  { path: 'admin', component: AdminComponent, canMatch: [adminGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'planner' },
  { path: '**', redirectTo: 'planner' },
];
