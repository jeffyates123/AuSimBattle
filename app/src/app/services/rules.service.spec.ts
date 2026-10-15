import { RulesService } from './rules.service';

describe('RulesService', () => {
  const rules = new RulesService();

  it('resolves nation aliases and battalion rows', () => {
    const nation = rules.getNationRule('Conf. of the Rhine');
    expect(nation?.name).toBe('Confederation of the Rhine');

    const fusilier = rules.getBattalionRuleByNo('Conf. of the Rhine', 1);
    expect(fusilier?.shortName).toBe('Fu');
  });

  it('shows nation-specific differences for same troop short name', () => {
    const denmarkLineInfantry = rules.getBattalionRuleByShortName('Denmark', 'Ln');
    const franceLineInfantry = rules.getBattalionRuleByShortName('France', 'Ln');

    expect(denmarkLineInfantry).not.toBeNull();
    expect(franceLineInfantry).not.toBeNull();
    expect(denmarkLineInfantry?.mapMovement).toBe(28);
    expect(franceLineInfantry?.mapMovement).toBe(32);
  });

  it('returns one known simulated-battle numeric figure', () => {
    const simRules = rules.getSimBattleStore();
    const distanceOne = simRules.longRangeCombat.distanceMultiplierPercent.find((item) => item.distance === '1');
    expect(distanceOne?.artillery).toBe(250);
  });

  it('returns null for unknown nation', () => {
    expect(rules.getNationRule('Unknown Nation')).toBeNull();
    expect(rules.getBattalionRuleByNo('Unknown Nation', 1)).toBeNull();
  });
});
