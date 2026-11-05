import { Injectable, signal } from '@angular/core';

export interface SessionUser {
  username: string;
  isAdmin: boolean;
  displayName: string;
}

interface LoginRequest {
  username: string;
  password: string;
  displayName: string;
  consent: boolean;
}

/** Set to false when the login server should be required again. */
export const signInDisabled = true;

const localUser: SessionUser = {
  username: 'local',
  isAdmin: true,
  displayName: 'Local',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserState = signal<SessionUser | null>(null);
  private loaded = false;

  readonly currentUser = this.currentUserState.asReadonly();

  async ensureSession(): Promise<SessionUser | null> {
    if (signInDisabled) {
      this.currentUserState.set(localUser);
      this.loaded = true;
      return localUser;
    }
    if (this.loaded) {
      return this.currentUserState();
    }
    this.loaded = true;
    const response = await this.safeRequest('/api/me', { method: 'GET' });
    if (!response || !response.ok) {
      this.currentUserState.set(null);
      return null;
    }
    let body: SessionUser;
    try {
      body = (await response.json()) as SessionUser;
    } catch {
      this.currentUserState.set(null);
      return null;
    }
    this.currentUserState.set(body);
    return body;
  }

  async login(request: LoginRequest): Promise<{ ok: true } | { ok: false; error: string }> {
    const response = await this.safeRequest('/api/login', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response) {
      return { ok: false, error: 'Login service is unreachable.' };
    }
    if (!response.ok) {
      return { ok: false, error: await this.readError(response, 'Login failed.') };
    }
    let body: SessionUser;
    try {
      body = (await response.json()) as SessionUser;
    } catch {
      return { ok: false, error: 'Login failed.' };
    }
    this.currentUserState.set(body);
    this.loaded = true;
    return { ok: true };
  }

  async logout(): Promise<void> {
    if (signInDisabled) {
      this.currentUserState.set(localUser);
      this.loaded = true;
      return;
    }
    await this.safeRequest('/api/logout', { method: 'POST' });
    this.currentUserState.set(null);
    this.loaded = true;
  }

  private async safeRequest(path: string, init: RequestInit): Promise<Response | null> {
    try {
      return await fetch(path, { ...init, credentials: 'include' });
    } catch {
      return null;
    }
  }

  private async readError(response: Response, fallback: string): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      return body.error ?? fallback;
    } catch {
      return fallback;
    }
  }
}
