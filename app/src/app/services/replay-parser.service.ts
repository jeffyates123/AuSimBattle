import { Injectable } from '@angular/core';
import { ArmySide } from '../models/turn';
import { ReplayBattle, ReplayFrame, ReplayMorale, ReplayUnit } from '../models/replay';

const mapWidth = 45;
const mapHeight = 40;

interface FrameHeader {
  battleNo: number;
  round: number | null;
  morale: [ReplayMorale, ReplayMorale] | null;
}

interface ListedUnit {
  id: number;
  x: number;
  y: number;
  troopCode: string;
  order: number;
  formation: string | null;
  men: number;
  effectiveness: number | null;
  armyName: string;
}

@Injectable({ providedIn: 'root' })
export class ReplayParserService {
  parse(text: string): ReplayBattle[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const battles = new Map<number, ReplayBattle>();
    const order: number[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const winner = lines[index]?.match(/Winner of the battle:\s*(.+)\s*$/i);
      if (winner) {
        const battleNo = order[order.length - 1];
        const battle = battleNo === undefined ? undefined : battles.get(battleNo);
        if (battle && !battle.winner) {
          battle.winner = winner[1].trim();
        }
        continue;
      }

      const header = this.readHeader(lines[index] ?? '');
      if (!header) {
        continue;
      }

      const read = this.readFrame(lines, index, header);
      if (read.next <= index) {
        continue;
      }
      index = read.next - 1;
      if (!read.frame) {
        continue;
      }

      let battle = battles.get(header.battleNo);
      if (!battle) {
        battle = {
          battleNo: header.battleNo,
          armyA: '',
          armyB: '',
          winner: null,
          frames: [],
        };
        battles.set(header.battleNo, battle);
        order.push(header.battleNo);
      }
      battle.frames.push(read.frame);
    }

    return order.map((battleNo) => {
      const battle = battles.get(battleNo);
      if (!battle) {
        throw new Error(`Missing battle ${battleNo}.`);
      }
      this.finishBattle(battle);
      return battle;
    });
  }

  private readHeader(line: string): FrameHeader | null {
    const initial = line.match(/Simulated battle No\.\s*(\d+)\s+Initial Deployment/i);
    if (initial) {
      return { battleNo: Number(initial[1]), round: null, morale: null };
    }

    const round = line.match(
      /Simulated battle No\.\s*(\d+)\s+Round:\s*(\d+)\s+Morale level:\s*([A-Za-z]):\s*(\d+)%\s*([A-Za-z]):\s*(\d+)%/i,
    );
    if (!round) {
      return null;
    }

    return {
      battleNo: Number(round[1]),
      round: Number(round[2]),
      morale: [
        { letter: round[3].toUpperCase(), percent: Number(round[4]) },
        { letter: round[5].toUpperCase(), percent: Number(round[6]) },
      ],
    };
  }

  private readFrame(
    lines: string[],
    headerIndex: number,
    header: FrameHeader,
  ): { frame: ReplayFrame | null; next: number } {
    let cursor = headerIndex + 1;
    const grid: Array<Array<{ id: number | null; terrain: string | null }>> = [];
    while (cursor < lines.length && grid.length < mapHeight) {
      const line = lines[cursor] ?? '';
      if (this.readHeader(line) || /Winner of the battle/i.test(line)) {
        break;
      }
      cursor += 1;
      const row = this.mapRow(line);
      if (row) {
        grid.push(row);
      }
    }

    if (grid.length !== mapHeight) {
      return { frame: null, next: Math.max(cursor, headerIndex + 1) };
    }

    const units: ListedUnit[] = [];
    let armyName: string | null = null;
    while (cursor < lines.length) {
      const line = lines[cursor] ?? '';
      if (
        this.readHeader(line) ||
        /Winner of the battle/i.test(line) ||
        /^Battalion Federations\b/i.test(line.trim()) ||
        /^Battalion Groups\b/i.test(line.trim())
      ) {
        break;
      }
      const army = line.trim().match(/^Federations of\s+(.+)$/i);
      if (army) {
        armyName = army[1].trim();
        cursor += 1;
        continue;
      }
      if (armyName) {
        units.push(...this.listingEntries(line, armyName));
      }
      cursor += 1;
    }

    const placed = units.filter((unit) => {
      const cell = grid[unit.y - 1]?.[unit.x - 1];
      return cell?.id === unit.id;
    });
    const terrain: Array<{ x: number; y: number; token: string }> = [];
    grid.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell.terrain) {
          terrain.push({ x: x + 1, y: y + 1, token: cell.terrain });
        }
      });
    });

    return {
      frame: {
        round: header.round,
        morale: header.morale,
        units: placed.map((unit) => ({
          id: unit.id,
          side: 'A',
          armyName: unit.armyName,
          x: unit.x,
          y: unit.y,
          troopCode: unit.troopCode,
          order: unit.order,
          formation: unit.formation,
          men: unit.men,
          effectiveness: unit.effectiveness,
        })),
        terrain,
      },
      next: cursor,
    };
  }

  private mapRow(line: string): Array<{ id: number | null; terrain: string | null }> | null {
    const match = line.match(/(\d+)\s*>\s*(.*?)\s*<\s*(\d+)\s*$/);
    if (!match || match[1] !== match[3]) {
      return null;
    }
    const tokens = match[2].trim().split(/\s+/);
    if (tokens.length !== mapWidth) {
      return null;
    }
    return tokens.map((token) => ({
      id: this.federationId(token),
      terrain: this.terrainToken(token),
    }));
  }

  private terrainToken(token: string): string | null {
    if (this.federationId(token) !== null || token === '..') {
      return null;
    }
    if (token === '##' || token === 'WW' || token === 'bb' || token === '$$') {
      return token;
    }
    return null;
  }

  private federationId(token: string): number | null {
    const body = token
      .replace(/^(?:__|\.\.)(?=[0-9a-z])/i, '')
      .replace(/(?<=[0-9a-z])(?:__|\.\.)$/i, '');
    if (/^\d{1,3}$/.test(body)) {
      const value = Number(body);
      return value > 0 ? value : null;
    }
    const letter = body.match(/^([a-z])(\d)$/i);
    if (!letter) {
      return null;
    }
    return (letter[1].toLowerCase().charCodeAt(0) - 97 + 10) * 10 + Number(letter[2]);
  }

  private listingEntries(line: string, armyName: string): ListedUnit[] {
    const pattern =
      /(?:^|\s)((?:[a-z]\d|\d{1,3}))\s+(\d{1,2})\/\s*(\d{1,2})\s+([A-Za-z]{2})\s+(\d{1,2})(?:\s+([A-Za-z*#]))?\s+(\d{1,5})(?:\s+(\d+\.\d+))?/gi;
    const units: ListedUnit[] = [];
    for (const match of line.matchAll(pattern)) {
      const formation = match[6] ?? null;
      const effectiveness = match[8] === undefined ? null : Number(match[8]);
      units.push({
        id: this.federationId(match[1]) ?? Number(match[1]),
        x: Number(match[2]),
        y: Number(match[3]),
        troopCode: match[4],
        order: Number(match[5]),
        formation,
        men: Number(match[7]),
        effectiveness: Number.isFinite(effectiveness) ? effectiveness : null,
        armyName,
      });
    }
    return units;
  }

  private finishBattle(battle: ReplayBattle): void {
    const names: string[] = [];
    for (const frame of battle.frames) {
      for (const unit of frame.units) {
        if (!names.includes(unit.armyName)) {
          names.push(unit.armyName);
        }
      }
    }
    battle.armyA = names[0] ?? '';
    battle.armyB = names[1] ?? '';
    const sideByArmy = new Map<string, ArmySide>([
      [battle.armyA, 'A'],
      [battle.armyB, 'B'],
    ]);
    const effectiveness = new Map<string, number>();
    for (const frame of battle.frames) {
      for (const unit of frame.units) {
        unit.side = sideByArmy.get(unit.armyName) ?? 'A';
        if (unit.effectiveness !== null) {
          const key = `${unit.side}:${unit.id}`;
          if (!effectiveness.has(key)) {
            effectiveness.set(key, unit.effectiveness);
          }
        }
      }
    }
    for (const frame of battle.frames) {
      for (const unit of frame.units) {
        unit.effectiveness = effectiveness.get(`${unit.side}:${unit.id}`) ?? unit.effectiveness;
      }
    }
    battle.frames.sort((left, right) => (left.round ?? -1) - (right.round ?? -1));
  }
}
