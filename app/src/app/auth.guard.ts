import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

export const authGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  return user ? true : router.parseUrl('/login');
};

export const adminGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  if (!user) {
    return router.parseUrl('/login');
  }
  return user.isAdmin ? true : router.parseUrl('/planner');
};

export const loginGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const user = await auth.ensureSession();
  if (!user) {
    return true;
  }
  return router.parseUrl(user.isAdmin ? '/admin' : '/planner');
};
