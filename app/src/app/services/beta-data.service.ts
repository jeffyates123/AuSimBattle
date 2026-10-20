import { Injectable } from '@angular/core';

export interface BattleSummary {
  id: string;
  createdAt: string;
  account: string;
  isAdmin: boolean;
  displayName: string;
  turnFileName: string;
  gameId: string | null;
  simulationNumber: number | null;
  army: string | null;
  parseError: string | null;
  sheetFileName: string | null;
  sheetStoredAt: string | null;
}

type StoreResult = 'stored' | 'failed' | 'skipped';

@Injectable({ providedIn: 'root' })
export class BetaDataService {
  async createBattle(payload: {
    fileName: string;
    turnText: string;
    gameId: string | null;
    simulationNumber: number | null;
    army: string | null;
    parseError: string | null;
  }): Promise<{ result: StoreResult; id: string | null }> {
    const response = await this.request('/api/battles', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response) {
      return { result: 'failed', id: null };
    }
    if (response.status === 404) {
      return { result: 'skipped', id: null };
    }
    if (!response.ok) {
      return { result: 'failed', id: null };
    }
    const body = (await response.json()) as { id: string };
    return { result: 'stored', id: body.id };
  }

  async attachSheet(battleId: string, fileName: string, buffer: ArrayBuffer): Promise<StoreResult> {
    const response = await this.request(`/api/battles/${encodeURIComponent(battleId)}/sheet`, {
      method: 'POST',
      body: JSON.stringify({
        fileName,
        sheetBase64: this.toBase64(buffer),
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response) {
      return 'failed';
    }
    if (response.status === 404) {
      return 'skipped';
    }
    return response.ok ? 'stored' : 'failed';
  }

  async listBattles(): Promise<{ result: 'ok'; battles: BattleSummary[] } | { result: 'failed'; error: string }> {
    const response = await this.request('/api/admin/battles', { method: 'GET' });
    if (!response) {
      return { result: 'failed', error: 'Admin service is unreachable.' };
    }
    if (!response.ok) {
      return { result: 'failed', error: await this.readError(response, 'Unable to load battle list.') };
    }
    try {
      const body = (await response.json()) as { battles?: BattleSummary[] };
      return { result: 'ok', battles: body.battles ?? [] };
    } catch {
      return { result: 'failed', error: 'Battle list response was invalid.' };
    }
  }

  turnDownloadUrl(id: string): string {
    return `/api/admin/battles/${encodeURIComponent(id)}/turn`;
  }

  sheetDownloadUrl(id: string): string {
    return `/api/admin/battles/${encodeURIComponent(id)}/sheet`;
  }

  private async request(path: string, init: RequestInit): Promise<Response | null> {
    try {
      return await fetch(path, { ...init, credentials: 'include' });
    } catch {
      return null;
    }
  }

  private toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
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
