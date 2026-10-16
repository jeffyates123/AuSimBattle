import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TurnParserService } from './turn-parser.service';

describe('TurnParserService battlefield', () => {
  const parser = new TurnParserService();

  it('paints the Warsaw sim 204 battlefield', () => {
    const text = readFileSync(resolve(process.cwd(), '../124W0213.txt'), 'utf8');
    const battle = parser.parse(text);

    expect(battle.simNumber).toBe(204);
    expect(battle.deploymentAreaA).toBe('Conf. of the Rhine');
    expect(battle.deploymentAreaB).toBe('Duchy of Warsaw');
    expect(battle.header.army).toBe('Army B');
    expect(battle.battleBrief.opponents).toBe('Conf. of the Rhine vs Duchy of Warsaw');
    expect(battle.battleBrief.battlefieldCoordinates).toBe('44 / 27');
    expect(battle.battleBrief.mainTerrain).toBe('G');
    expect(battle.battleBrief.deploymentAreaA.maxFederations).toBe(99);
    expect(battle.battleBrief.deploymentAreaB.maxFederations).toBe(81);
    expect(battle.battleBrief.deploymentAreaA.strategicPoints).toEqual([
      { x: 12, y: 3 },
      { x: 23, y: 2 },
      { x: 17, y: 5 },
    ]);
    expect(battle.battleBrief.deploymentAreaB.strategicPoints).toEqual([
      { x: 28, y: 36 },
      { x: 18, y: 39 },
      { x: 35, y: 35 },
    ]);
    expect(battle.mapCells).toHaveLength(45 * 40);

    const highGround = battle.mapCells.find((cell) => cell.x === 20 && cell.y === 1);
    expect(highGround?.token).toBe('$7');
    expect(highGround?.height).toBe(7);
    expect(highGround?.feature).toBe('special');

    const woods = battle.mapCells.find((cell) => cell.x === 13 && cell.y === 2);
    expect(woods?.token).toBe('#8');
    expect(woods?.feature).toBe('woods');

    const armyA = battle.armies.find((army) => army.side === 'A');
    const armyB = battle.armies.find((army) => army.side === 'B');
    expect(armyA?.name).toBe('Conf. of the Rhine');
    expect(armyB?.name).toBe('Duchy of Warsaw');
    expect(armyA?.units[0]).toMatchObject({ id: 1, troopCode: 'Fu', start: null });
    expect(armyA?.units.some((unit) => unit.troopCode === 'GR')).toBe(true);
    expect(armyA?.units.some((unit) => unit.troopCode === 'La')).toBe(true);
    expect(armyB?.units[0]).toMatchObject({ id: 1, troopCode: 'Gc', start: null });
    expect(armyB?.units[3]).toMatchObject({ id: 4, troopCode: 'Fu', start: null });
    expect(armyB?.units.some((unit) => unit.id === 3)).toBe(true);
    expect(armyB?.units.some((unit) => unit.id === 4)).toBe(true);
  });

  it('paints a Denmark battlefield that has blank lines between rows', () => {
    const text = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const battle = parser.parse(text);

    expect(battle.simNumber).toBe(196);
    expect(battle.header.army).toBe('Army A');
    expect(battle.battleBrief.mainTerrain).toBe('B');
    expect(battle.battleBrief.deploymentAreaA.maxFederations).toBe(102);
    expect(battle.battleBrief.deploymentAreaB.maxFederations).toBe(78);
    expect(battle.mapCells).toHaveLength(45 * 40);
    expect(battle.mapCells[0]?.token).toBe('.2');
  });

  it('rejects a turn file with no battlefield', () => {
    expect(() => parser.parse('no battle here')).toThrow(/Battle field/);
  });
});
