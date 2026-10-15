import { BattleHeader } from './battle';

export type ArmySide = 'A' | 'B';

export type TerrainFeature =
  | 'open'
  | 'water'
  | 'woods'
  | 'builtup'
  | 'special'
  | 'impassable';

export interface MapCell {
  x: number;
  y: number;
  token: string;
  feature: TerrainFeature;
  height: number;
}

export interface SetupZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface FederationUnit {
  id: number;
  troopCode: string;
  formationCode: number | null;
  men: number | null;
  morale: number | null;
  start: Coordinate | null;
}

export interface Coordinate {
  x: number;
  y: number;
}

export interface ArmyData {
  side: ArmySide;
  name: string;
  units: FederationUnit[];
}

export interface ParsedTurn {
  header: BattleHeader;
  simNumber: number | null;
  mapCells: MapCell[];
  deploymentAreaA: string | null;
  deploymentAreaB: string | null;
  armies: ArmyData[];
}
