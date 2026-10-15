export interface SimulatedBattle {
  battle: BattleHeader;
  fortressEntrenchments: Array<number | null>;
  federations: FederationOrder[];
}

export interface BattleHeader {
  state: string | null;
  accountId: number | null;
  gameId: string | null;
  playerName: string | null;
  simulationNumber: number | null;
  processDate: string | null;
  generalFederation: number | null;
  validationStatus: string | null;
  army: 'Army A' | 'Army B' | null;
}

export interface FederationOrder {
  federation: number;
  battalionGroup: number | null;
  start: Coordinate;
  primary: PrimaryOrder;
  alternative: AlternativeOrder;
}

export interface Coordinate {
  x: number | null;
  y: number | null;
}

export interface PrimaryOrder {
  startAttack: number | null;
  order: number | null;
  additionalOrder: number | null;
  formation: number | null;
  destination1: Coordinate;
  destination2: Coordinate;
}

export interface AlternativeOrder {
  condition: number | null;
  order: number | null;
  additionalOrder: number | null;
  formation: number | null;
  destination1: Coordinate;
  destination2: Coordinate;
}
