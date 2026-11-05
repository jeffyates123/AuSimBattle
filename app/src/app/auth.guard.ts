import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService, signInDisabled } from './services/auth.service';

export const authGuard: CanMatchFn = async () => {
  if (signInDisabled) {
    await inject(AuthService).ensureSession();
    return true;
  }
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  return user ? true : router.parseUrl('/login');
};

export const adminGuard: CanMatchFn = async () => {
  if (signInDisabled) {
    await inject(AuthService).ensureSession();
    return true;
  }
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  if (!user) {
    return router.parseUrl('/login');
  }
  return user.isAdmin ? true : router.parseUrl('/planner');
};

export const loginGuard: CanMatchFn = async () => {
  const router = inject(Router);
  if (signInDisabled) {
    return router.parseUrl('/planner');
  }
  const auth = inject(AuthService);
  const user = await auth.ensureSession();
  if (!user) {
    return true;
  }
  return router.parseUrl(user.isAdmin ? '/admin' : '/planner');
};
