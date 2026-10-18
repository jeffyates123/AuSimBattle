import { Injectable } from '@angular/core';
import armyTablesData from '../data/army-tables.json';
import simBattleRulesData from '../data/sim-battle-rules.json';
import { FortressSize } from '../models/turn';

type FormationCode = 'Co' | 'Li' | 'Sk' | 'Sq';
type TroopSpecCode = 'Lc' | 'Lr' | 'Cu';

export interface ArmyBattalionRule {
  no: number;
  typeName: string;
  shortName: string;
  costLouisdore: number | null;
  economicPointsPer25: number | null;
  maxTrainingExperience: number | null;
  handToHand: number | null;
  longRange: number | null;
  range: number | null;
  simMovement: number | null;
  mapMovement: number | null;
  formations: FormationCode[];
  troopSpecs: TroopSpecCode[];
}

export interface ArmyNationRule {
  name: string;
  aliases: string[];
  battalions: ArmyBattalionRule[];
}

export interface ArmyTablesStore {
  source: {
    document: string;
    section: string;
  };
  nations: ArmyNationRule[];
  generatedAt: string;
}

export type SimBattleRulesStore = typeof simBattleRulesData;

@Injectable({ providedIn: 'root' })
export class RulesService {
  private readonly armyStore = armyTablesData as ArmyTablesStore;
  private readonly simBattleStore = simBattleRulesData;
  private readonly nationByKey = new Map<string, ArmyNationRule>();

  constructor() {
    this.armyStore.nations.forEach((nation) => {
      this.nationByKey.set(this.normalizeNationKey(nation.name), nation);
      nation.aliases.forEach((alias) => this.nationByKey.set(this.normalizeNationKey(alias), nation));
    });
  }

  getArmyStore(): ArmyTablesStore {
    return this.armyStore;
  }

  getSimBattleStore(): SimBattleRulesStore {
    return this.simBattleStore;
  }

  fortressAllowance(size: FortressSize | null | undefined): { entrenchments: number; wallStrength: number } | null {
    if (!size) {
      return null;
    }
    return this.simBattleStore.fortresses[size] ?? null;
  }

  getNationRule(nationName: string | null | undefined): ArmyNationRule | null {
    const key = this.normalizeNationKey(nationName);
    if (!key) {
      return null;
    }
    return this.nationByKey.get(key) ?? null;
  }

  getBattalionRuleByNo(nationName: string | null | undefined, battalionNo: number): ArmyBattalionRule | null {
    const nation = this.getNationRule(nationName);
    if (!nation) {
      return null;
    }
    return nation.battalions.find((item) => item.no === battalionNo) ?? null;
  }

  getBattalionRuleByShortName(nationName: string | null | undefined, shortName: string): ArmyBattalionRule | null {
    const nation = this.getNationRule(nationName);
    if (!nation) {
      return null;
    }
    const normalizedShortName = shortName.trim().toLowerCase();
    return nation.battalions.find((item) => item.shortName.toLowerCase() === normalizedShortName) ?? null;
  }

  private normalizeNationKey(nationName: string | null | undefined): string {
    return (nationName ?? '').trim().toLowerCase();
  }
}
