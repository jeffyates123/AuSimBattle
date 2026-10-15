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
    expect(battle.mapCells).toHaveLength(45 * 40);

    const highGround = battle.mapCells.find((cell) => cell.x === 20 && cell.y === 1);
    expect(highGround?.token).toBe('$7');
    expect(highGround?.height).toBe(7);
    expect(highGround?.feature).toBe('special');

    const woods = battle.mapCells.find((cell) => cell.x === 13 && cell.y === 2);
    expect(woods?.token).toBe('#8');
    expect(woods?.feature).toBe('woods');
  });

  it('paints a Denmark battlefield that has blank lines between rows', () => {
    const text = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const battle = parser.parse(text);

    expect(battle.simNumber).toBe(196);
    expect(battle.mapCells).toHaveLength(45 * 40);
    expect(battle.mapCells[0]?.token).toBe('.2');
  });

  it('rejects a turn file with no battlefield', () => {
    expect(() => parser.parse('no battle here')).toThrow(/Battle field/);
  });
});
