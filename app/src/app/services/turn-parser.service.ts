import { Injectable } from '@angular/core';
import { BattleHeader } from '../models/battle';
import { MapCell, ParsedTurn, TerrainFeature } from '../models/turn';

@Injectable({ providedIn: 'root' })
export class TurnParserService {
  private readonly mapWidth = 45;
  private readonly mapHeight = 40;

  parse(text: string): ParsedTurn {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const battle = this.findBattleField(lines);
    const mapCells = this.parseMap(lines, battle.mapStart);
    const areas = this.parseDeploymentAreas(lines, battle.mapStart);

    return {
      header: this.parseHeader(lines, battle.headerLine, battle.simNumber),
      simNumber: battle.simNumber,
      mapCells,
      deploymentAreaA: areas.a,
      deploymentAreaB: areas.b,
      armies: [],
    };
  }

  private findBattleField(lines: string[]): { simNumber: number; headerLine: number; mapStart: number } {
    for (let i = 0; i < lines.length; i += 1) {
      const simMatch = lines[i]?.match(/Simulated battle No\.\s*(\d+)/i);
      if (!simMatch) {
        continue;
      }

      const windowEnd = Math.min(lines.length, i + 12);
      for (let j = i + 1; j < windowEnd; j += 1) {
        if (/Simulated battle No\./i.test(lines[j] ?? '')) {
          break;
        }
        if (/The Battle field/i.test(lines[j] ?? '')) {
          return {
            simNumber: Number(simMatch[1]),
            headerLine: i,
            mapStart: j + 1,
          };
        }
      }
    }

    throw new Error('The Battle field block was not found in this turn file.');
  }

  private parseMap(lines: string[], startIndex: number): MapCell[] {
    const cells: MapCell[] = [];
    let rowsFound = 0;

    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!line.trim()) {
        continue;
      }
      if (/^Opponents:/i.test(line)) {
        break;
      }

      const row = this.parseMapRow(line);
      if (!row) {
        if (rowsFound === 0) {
          continue;
        }
        break;
      }

      rowsFound += 1;
      if (row.y !== rowsFound) {
        throw new Error(`Battlefield row ${row.y} is out of order. Expected row ${rowsFound}.`);
      }

      row.tokens.forEach((token, index) => {
        cells.push(this.parseToken(token, index + 1, row.y));
      });

      if (rowsFound === this.mapHeight) {
        break;
      }
    }

    if (rowsFound !== this.mapHeight) {
      throw new Error(`Battlefield must have ${this.mapHeight} rows. Found ${rowsFound}.`);
    }

    return cells;
  }

  private parseMapRow(line: string): { y: number; tokens: string[] } | null {
    const match = line.match(/^\s*(\d+)\s*>\s*(.*?)\s*<\s*\d+\s*$/);
    if (!match) {
      return null;
    }

    const tokens = (match[2] ?? '').trim().split(/\s+/);
    const y = Number(match[1]);
    if (tokens.length !== this.mapWidth) {
      throw new Error(`Battlefield row ${y} has ${tokens.length} cells. Expected ${this.mapWidth}.`);
    }

    return { y, tokens };
  }

  private parseToken(token: string, x: number, y: number): MapCell {
    const match = token.match(/^([.#bW$])(\d)$/);
    if (!match) {
      throw new Error(`Unrecognised battlefield token "${token}" at ${x}, ${y}.`);
    }

    return {
      x,
      y,
      token,
      feature: this.toFeature(match[1]),
      height: Number(match[2]),
    };
  }

  private toFeature(mark: string): TerrainFeature {
    switch (mark) {
      case '#':
        return 'woods';
      case 'b':
        return 'builtup';
      case 'W':
        return 'water';
      case '$':
        return 'special';
      default:
        return 'open';
    }
  }

  private parseDeploymentAreas(lines: string[], startIndex: number): { a: string | null; b: string | null } {
    let a: string | null = null;
    let b: string | null = null;
    const end = Math.min(lines.length, startIndex + 80);

    for (let i = startIndex; i < end; i += 1) {
      const line = lines[i] ?? '';
      const areaA = line.match(/Deployment area A,.*?Maximum\):\s*(.+)$/i);
      const areaB = line.match(/Deployment area B,.*?Maximum\):\s*(.+)$/i);
      if (areaA) {
        a = areaA[1].trim();
      }
      if (areaB) {
        b = areaB[1].trim();
      }
      if (a && b) {
        break;
      }
    }

    return { a, b };
  }

  private parseHeader(lines: string[], battleLine: number, simNumber: number): BattleHeader {
    let gameLine = '';
    for (let i = battleLine; i >= 0; i -= 1) {
      if (/Game:\s*/i.test(lines[i] ?? '')) {
        gameLine = lines[i] ?? '';
        break;
      }
    }

    const accountLine = lines.find((line) => /ACCOUNT:\s*/i.test(line)) ?? '';
    const playerLine = lines.find((line) => /^\s*Mr\s+/i.test(line)) ?? '';
    const gameMatch = gameLine.match(/Game:\s*([A-Z]{2}-\d+)/i);
    const stateMatch = gameLine.match(/Game:\s*[A-Z]{2}-\d+\s+(.+?)\s*$/i);
    const accountMatch = accountLine.match(/ACCOUNT:\s*(\d+)/i);
    const playerMatch = playerLine.match(/^\s*Mr\s+(.+?)\.?\s*$/i);

    return {
      state: stateMatch ? stateMatch[1].trim() : null,
      accountId: accountMatch ? Number(accountMatch[1]) : null,
      gameId: gameMatch ? gameMatch[1].trim() : null,
      playerName: playerMatch ? playerMatch[1].trim() : null,
      simulationNumber: simNumber,
      processDate: null,
      generalFederation: null,
      validationStatus: null,
      army: null,
    };
  }
}
