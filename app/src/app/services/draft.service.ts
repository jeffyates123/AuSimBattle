import { Injectable } from '@angular/core';
import { BattleHeader, FederationOrder } from '../models/battle';
import { ArmySide, Coordinate } from '../models/turn';

export interface SetupDraft {
  header: BattleHeader;
  placements: Record<number, Coordinate>;
  fortressEntrenchments?: Array<{ x: number | null; y: number | null }>;
  federationOrders?: Record<number, FederationOrder>;
  sheetFedNos?: Record<number, number>;
}

@Injectable({ providedIn: 'root' })
export class DraftService {
  save(gameId: string, simNumber: number, army: ArmySide, draft: SetupDraft): void {
    const key = this.keyFor(gameId, simNumber, army);
    localStorage.setItem(key, JSON.stringify(draft));
  }

  load(gameId: string, simNumber: number, army: ArmySide): SetupDraft | null {
    const key = this.keyFor(gameId, simNumber, army);
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as SetupDraft;
    } catch {
      return null;
    }
  }

  private keyFor(gameId: string, simNumber: number, army: ArmySide): string {
    return `ausim.setup.${gameId}.${simNumber}.${army}`;
  }
}
