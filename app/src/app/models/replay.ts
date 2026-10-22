import { ArmySide, MapCell } from './turn';

export interface ReplayMorale {
  letter: string;
  percent: number;
}

export interface ReplayUnit {
  id: number;
  side: ArmySide;
  armyName: string;
  x: number;
  y: number;
  troopCode: string;
  order: number;
  formation: string | null;
  men: number;
  effectiveness: number | null;
}

export interface ReplayFrame {
  round: number | null;
  morale: [ReplayMorale, ReplayMorale] | null;
  units: ReplayUnit[];
  terrain: Array<{ x: number; y: number; token: string }>;
}

export interface ReplayBattle {
  battleNo: number;
  armyA: string;
  armyB: string;
  winner: string | null;
  frames: ReplayFrame[];
}

export interface ReplayLaunch {
  mode: 'this' | 'different';
  simNumber: number | null;
  label: string | null;
  mapCells: MapCell[] | null;
  strategicPoints: Array<{ x: number; y: number }>;
}
