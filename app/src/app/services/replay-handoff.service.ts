import { Injectable } from '@angular/core';
import { ReplayLaunch } from '../models/replay';

@Injectable({ providedIn: 'root' })
export class ReplayHandoffService {
  launch: ReplayLaunch | null = null;
  turnText: string | null = null;
  resultsText: string | null = null;
  freshSetup: { text: string; fileName: string } | null = null;
}
