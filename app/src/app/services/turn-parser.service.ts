import { Injectable } from '@angular/core';
import { BattleHeader } from '../models/battle';
import {
  ArmyData,
  ArmySide,
  BattleBrief,
  DeploymentAreaBrief,
  FortressSize,
  FederationUnit,
  MapCell,
  ParsedTurn,
  StrategicPoint,
  TerrainFeature,
} from '../models/turn';

@Injectable({ providedIn: 'root' })
export class TurnParserService {
  private readonly mapWidth = 45;
  private readonly mapHeight = 40;

  parse(text: string): ParsedTurn {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const battle = this.findBattleField(lines);
    const mapCells = this.parseMap(lines, battle.mapStart);
    const battleBrief = this.parseBattleBrief(lines, battle.mapStart);
    const header = this.parseHeader(lines, battle.headerLine, battle.simNumber);
    const armies = this.parseArmies(lines, battleBrief);
    header.army = this.armyFromState(header.state, battleBrief) === 'A' ? 'Army A' : 'Army B';

    return {
      header,
      simNumber: battle.simNumber,
      mapCells,
      deploymentAreaA: battleBrief.deploymentAreaA.name,
      deploymentAreaB: battleBrief.deploymentAreaB.name,
      battleBrief,
      armies,
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

  private parseBattleBrief(lines: string[], startIndex: number): BattleBrief {
    const brief: BattleBrief = {
      opponents: null,
      battlefieldCoordinates: null,
      mainTerrain: null,
      fortress: null,
      deploymentAreaA: this.emptyDeploymentArea('A'),
      deploymentAreaB: this.emptyDeploymentArea('B'),
    };
    const end = Math.min(lines.length, startIndex + 120);

    for (let i = startIndex; i < end; i += 1) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const opponentsMatch = trimmed.match(/^Opponents:\s*(.+)$/i);
      if (opponentsMatch) {
        brief.opponents = opponentsMatch[1].trim();
        continue;
      }

      const coordinatesMatch = trimmed.match(/^Battlefield coordinates:\s*(.+)$/i);
      if (coordinatesMatch) {
        brief.battlefieldCoordinates = coordinatesMatch[1].trim();
        continue;
      }

      const deploymentMatch = trimmed.match(
        /^Deployment area\s*([AB])\s*,\s*(\d+)\s+Federations\s*\(Maximum\)\s*:\s*(.+)$/i,
      );
      if (deploymentMatch) {
        const side = deploymentMatch[1].toUpperCase() as ArmySide;
        const target = side === 'A' ? brief.deploymentAreaA : brief.deploymentAreaB;
        target.maxFederations = Number(deploymentMatch[2]);
        target.name = deploymentMatch[3].trim();
        continue;
      }

      const strategicPointsMatch = trimmed.match(/^Strategic points\s*([AB])\s*:\s*(.+)$/i);
      if (strategicPointsMatch) {
        const side = strategicPointsMatch[1].toUpperCase() as ArmySide;
        const target = side === 'A' ? brief.deploymentAreaA : brief.deploymentAreaB;
        target.strategicPoints = this.parseStrategicPoints(strategicPointsMatch[2]);
        continue;
      }

      const terrainMatch = trimmed.match(/^Main terrain:\s*([A-Za-z])$/i);
      if (terrainMatch) {
        brief.mainTerrain = terrainMatch[1].toUpperCase();
        brief.fortress = this.parseFortressLine(lines, i + 1);
        break;
      }
    }

    return brief;
  }

  private parseFortressLine(lines: string[], start: number): BattleBrief['fortress'] {
    for (let i = start; i < Math.min(lines.length, start + 4); i += 1) {
      const trimmed = (lines[i] ?? '').trim();
      if (!trimmed) {
        continue;
      }
      const match = trimmed.match(/^(.+?)\s+has an?\s+(small|medium|large)\s+fortress\.?$/i);
      if (!match) {
        return null;
      }
      return {
        ownerName: match[1].trim(),
        side: 'A',
        size: match[2].toLowerCase() as FortressSize,
      };
    }
    return null;
  }

  private parseStrategicPoints(raw: string): StrategicPoint[] {
    const points: StrategicPoint[] = [];
    const regex = /(\d+)\s*\/\s*(\d+)/g;
    let match: RegExpExecArray | null = regex.exec(raw);
    while (match) {
      points.push({
        x: Number(match[1]),
        y: Number(match[2]),
      });
      match = regex.exec(raw);
    }
    return points;
  }

  private parseArmies(lines: string[], brief: BattleBrief): ArmyData[] {
    const sideAName = brief.deploymentAreaA.name ?? 'Army A';
    const sideBName = brief.deploymentAreaB.name ?? 'Army B';

    return [
      {
        side: 'A',
        name: sideAName,
        units: this.parseFederationUnitsForNation(lines, sideAName),
      },
      {
        side: 'B',
        name: sideBName,
        units: this.parseFederationUnitsForNation(lines, sideBName),
      },
    ];
  }

  private parseFederationUnitsForNation(lines: string[], nationName: string): FederationUnit[] {
    const units = new Map<number, FederationUnit>();
    const targetKey = this.normalizeName(nationName);
    if (!targetKey) {
      return [];
    }

    for (let i = 0; i < lines.length; i += 1) {
      const heading = (lines[i] ?? '').trim();
      const headingMatch = heading.match(/^Battalion Groups of\s+(.+)$/i);
      if (!headingMatch || this.normalizeName(headingMatch[1]) !== targetKey) {
        continue;
      }

      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j] ?? '';
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const nextHeading = trimmed.match(/^Battalion Groups of\s+(.+)$/i);
        if (nextHeading) {
          break;
        }
        if (/^Field Marshal\b/i.test(trimmed)) {
          break;
        }

        if (
          /^Fe\s+Type\b/i.test(trimmed) ||
          /^Page\b/i.test(trimmed) ||
          /^AUSTERLITZ\b/i.test(trimmed) ||
          /^Month:/i.test(trimmed) ||
          /^The Rise of the Eagle\b/i.test(trimmed) ||
          /^Simulated battle No\./i.test(trimmed)
        ) {
          continue;
        }

        const entryRegex = /(\d+)\s+([A-Za-z]{2})(?:\s+(?:\d+\s+\d+\s+){4}(\d+),(\d+))?/g;
        let match = entryRegex.exec(trimmed);
        while (match) {
          const id = Number(match[1]);
          if (!units.has(id)) {
            const effectiveness = match[3] === undefined ? null : Number(`${match[3]}.${match[4]}`);
            units.set(id, {
              id,
              troopCode: match[2],
              effectiveness: Number.isFinite(effectiveness) ? effectiveness : null,
              formationCode: null,
              men: null,
              morale: null,
              start: null,
            });
          }
          match = entryRegex.exec(trimmed);
        }
      }
    }

    return [...units.values()].sort((a, b) => a.id - b.id);
  }

  private emptyDeploymentArea(side: ArmySide): DeploymentAreaBrief {
    return {
      side,
      name: null,
      maxFederations: null,
      strategicPoints: [],
    };
  }

  private armyFromState(state: string | null, brief: BattleBrief): ArmySide {
    const scoreA = this.nameScore(state, brief.deploymentAreaA.name);
    const scoreB = this.nameScore(state, brief.deploymentAreaB.name);
    return scoreB > scoreA ? 'B' : 'A';
  }

  private nameScore(state: string | null, area: string | null): number {
    const left = this.compactName(state);
    const right = this.compactName(area);
    if (!left || !right) {
      return 0;
    }
    if (left === right) {
      return 100;
    }
    if (left.includes(right) || right.includes(left)) {
      return 80;
    }

    const stateTokens = this.nameTokens(state);
    const areaTokens = this.nameTokens(area);
    return stateTokens.reduce((score, token) => {
      const matched = areaTokens.some(
        (areaToken) => areaToken === token || areaToken.startsWith(token) || token.startsWith(areaToken),
      );
      return matched ? score + 20 : score;
    }, 0);
  }

  private normalizeName(name: string | null): string {
    return (name ?? '').trim().toLowerCase();
  }

  private compactName(name: string | null): string {
    return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private nameTokens(name: string | null): string[] {
    return (name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 2 && token !== 'the' && token !== 'and');
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
