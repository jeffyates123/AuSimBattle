import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReplayParserService } from './replay-parser.service';

function battlefield(tokens: Record<string, string>): string {
  const lines: string[] = [];
  for (let y = 1; y <= 40; y += 1) {
    const cells: string[] = [];
    for (let x = 1; x <= 45; x += 1) {
      cells.push(tokens[`${x},${y}`] ?? '..');
    }
    const prefix = y === 1 ? '          __          ' : '';
    lines.push(`${prefix}${y} > ${cells.join(' ')} < ${y}`);
  }
  return lines.join('\n');
}

function report(): string {
  const initial = battlefield({
    '11,10': '1__',
    '12,8': 'a0__',
    '20,31': '..2',
    '16,16': '##',
    '17,16': 'WW',
    '18,16': 'bb',
  });
  const round = battlefield({ '11,14': '__1', '30,20': '2..', '16,16': '##', '17,16': 'WW', '18,16': 'bb' });
  const other = battlefield({ '15,15': '4' });
  return [
    'Simulated battle No. 196    Initial Deployment',
    initial,
    'Federations of Denmark',
    ' 1 11/10 Rm 13 * 3027  8.0     a0 12/ 8 Kg 31 K 2177  9.0',
    'Federations of Great Britain',
    ' 2 20/31 Ha 33   3100  7.5',
    'Simulated battle No. 196    Round: 1    Morale level:  D: 4%  G: 9%',
    round,
    'Federations of Denmark',
    ' 1 11/14 Rm 13 p 3027-10-30',
    'Federations of Great Britain',
    ' 2 30/20 Ha 33   3000 41 41',
    'Winner of the battle: Denmark',
    'Simulated battle No. 201    Initial Deployment',
    other,
    'Federations of Spain',
    ' 4 15/15 Ln 11 k 2400  6.0',
  ].join('\n');
}

describe('ReplayParserService', () => {
  const parser = new ReplayParserService();

  it('reads effectiveness, morale letters, and federation ids past 99', () => {
    const [battle] = parser.parse(report());
    expect(battle.battleNo).toBe(196);
    expect(battle.armyA).toBe('Denmark');
    expect(battle.armyB).toBe('Great Britain');
    expect(battle.winner).toBe('Denmark');
    expect(battle.frames.map((frame) => frame.round)).toEqual([null, 1]);

    const initial = battle.frames[0];
    const denmark = initial?.units.find((unit) => unit.side === 'A' && unit.id === 1);
    const cuirassiers = initial?.units.find((unit) => unit.id === 100);
    expect(denmark).toMatchObject({
      troopCode: 'Rm',
      order: 13,
      formation: '*',
      men: 3027,
      effectiveness: 8,
      x: 11,
      y: 10,
    });
    expect(cuirassiers).toMatchObject({ side: 'A', troopCode: 'Kg', effectiveness: 9, x: 12, y: 8 });
    expect(initial?.units.find((unit) => unit.side === 'B' && unit.id === 2)?.effectiveness).toBe(7.5);
    expect(initial?.terrain).toEqual([
      { x: 16, y: 16, token: '##' },
      { x: 17, y: 16, token: 'WW' },
      { x: 18, y: 16, token: 'bb' },
    ]);

    const round = battle.frames[1];
    expect(round?.morale).toEqual([
      { letter: 'D', percent: 4 },
      { letter: 'G', percent: 9 },
    ]);
    const moved = round?.units.find((unit) => unit.side === 'A' && unit.id === 1);
    expect(moved).toMatchObject({ x: 11, y: 14, formation: 'p', men: 3027, effectiveness: 8 });
    expect(round?.units.some((unit) => unit.id === 100)).toBe(false);
  });

  it('reads the Denmark Sim 196 results file', () => {
    const path = resolve(process.cwd(), '../124D0213.txt');
    if (!existsSync(path)) {
      return;
    }
    const battles = parser.parse(readFileSync(path, 'utf8'));
    const battle = battles.find((item) => item.battleNo === 196);
    expect(battle?.armyA).toBe('Denmark');
    expect(battle?.armyB).toBe('Great Britain');
    expect(battle?.winner).toBe('Denmark');
    expect(battle?.frames.length).toBeGreaterThan(20);
    const first = battle?.frames.find((frame) => frame.round === null)?.units.find((unit) => unit.side === 'A' && unit.id === 1);
    const later = battle?.frames.find((frame) => frame.round === 1)?.units.find((unit) => unit.side === 'A' && unit.id === 1);
    expect(first?.effectiveness).toBeGreaterThan(0);
    expect(later?.effectiveness).toBe(first?.effectiveness);
    expect(battle?.frames[0]?.units.some((unit) => unit.id === 100)).toBe(true);
  });

  it('loads both armies when deployment A is marked __ and deployment B is marked ..', () => {
    const path = resolve(process.cwd(), '../Austerlitz-Sim-Battle-Turns/battle-turns/117E1113.txt');
    if (!existsSync(path)) {
      return;
    }
    const battle = parser.parse(readFileSync(path, 'utf8')).find((item) => item.battleNo === 247);
    const initial = battle?.frames.find((frame) => frame.round === null);
    const spain = initial?.units.filter((unit) => unit.side === 'A').length ?? 0;
    const holland = initial?.units.filter((unit) => unit.side === 'B').length ?? 0;
    expect(spain).toBeGreaterThan(50);
    expect(holland).toBeGreaterThan(50);
  });

  it('loads units whose side mark follows the federation number', () => {
    const path = resolve(process.cwd(), '../Austerlitz-Sim-Battle-Turns/battle-turns/102R0009Mindham.txt');
    if (!existsSync(path)) {
      return;
    }
    const battle = parser.parse(readFileSync(path, 'utf8')).find((item) => item.battleNo === 1);
    const initial = battle?.frames.find((frame) => frame.round === null);
    const top = initial?.units.filter((unit) => unit.side === 'A').length ?? 0;
    const bottom = initial?.units.filter((unit) => unit.side === 'B').length ?? 0;
    expect(top).toBeGreaterThan(90);
    expect(bottom).toBeGreaterThan(60);
    expect(initial?.units.some((unit) => unit.id === 100)).toBe(true);
    const marks = new Set(initial?.terrain.map((mark) => mark.token));
    expect(marks.has('WW')).toBe(true);
    expect(marks.has('bb')).toBe(true);
    expect(marks.has('##')).toBe(true);
  });

  it('keeps a second simulated battle as its own choice', () => {
    const battles = parser.parse(report());
    expect(battles.map((battle) => battle.battleNo)).toEqual([196, 201]);
    expect(battles[1]?.armyA).toBe('Spain');
    expect(battles[1]?.frames[0]?.units[0]).toMatchObject({ id: 4, troopCode: 'Ln' });
  });
});
