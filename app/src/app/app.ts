import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BattleHeader } from './models/battle';
import {
  ArmyData,
  ArmySide,
  Coordinate,
  FederationUnit,
  MapCell,
  ParsedTurn,
  SetupZone,
} from './models/turn';
import { DraftService } from './services/draft.service';
import { ExcelExportService } from './services/excel-export.service';
import { TurnParserService } from './services/turn-parser.service';

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly setupZones: Record<ArmySide, SetupZone> = {
    A: { minX: 11, maxX: 35, minY: 1, maxY: 10 },
    B: { minX: 11, maxX: 35, minY: 31, maxY: 40 },
  };
  protected readonly mapWidth = 45;
  protected readonly mapHeight = 40;
  protected parsedTurn: ParsedTurn | null = null;
  protected selectedArmySide: ArmySide | null = null;
  protected selectedArmy: ArmyData | null = null;
  protected enemyArmy: ArmyData | null = null;
  protected header: BattleHeader | null = null;
  protected parseError = '';
  protected exportError = '';
  protected statusMessage = '';
  protected hoverText = '';
  protected readonly columnNumbers = Array.from({ length: 45 }, (_, index) => index + 1);
  protected readonly fortressRowOne = [1, 2, 3, 4, 5];
  protected readonly fortressRowTwo = [6, 7, 8, 9, 10];
  protected readonly fortressRows = [this.fortressRowOne, this.fortressRowTwo];

  protected isAnchored(slot: number): boolean {
    return ((slot - 1) % 5) % 2 === 0;
  }

  protected entrenchmentColumn(slot: number): number {
    return ((slot - 1) % 5) + 2;
  }
  protected fortressEntrenchments: Array<{ x: number | null; y: number | null }> = this.emptyFortressEntrenchments();
  protected loading = false;
  protected exporting = false;
  protected placements = new Map<number, Coordinate>();
  protected rows: MapCell[][] = [];
  protected ownByCoord = new Map<string, FederationUnit>();
  protected enemyByCoord = new Map<string, FederationUnit>();

  constructor(
    private readonly parser: TurnParserService,
    private readonly draft: DraftService,
    private readonly excelExport: ExcelExportService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  protected async onTurnFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.loading = true;
    this.parseError = '';
    this.exportError = '';
    this.statusMessage = '';

    try {
      const text = await file.text();
      this.parseTurnText(text);
    } catch (error) {
      this.parseError = error instanceof Error ? error.message : 'Unable to parse this turn file.';
      this.parsedTurn = null;
      this.rows = [];
    } finally {
      this.loading = false;
      input.value = '';
      this.changeDetector.markForCheck();
    }
  }

  protected onArmySelected(army: BattleHeader['army']): void {
    if (!this.header) {
      return;
    }
    this.header.army = army;
    if (army === 'Army A' || army === 'Army B') {
      const side: ArmySide = army === 'Army A' ? 'A' : 'B';
      if (this.parsedTurn?.armies.length) {
        this.pickArmy(side);
        return;
      }
      this.selectedArmySide = side;
    } else {
      this.selectedArmySide = null;
    }
    this.saveDraftNow();
  }

  protected pickArmy(side: ArmySide): void {
    if (!this.parsedTurn || !this.header) {
      return;
    }
    const own = this.parsedTurn.armies.find((army) => army.side === side) ?? null;
    const enemy = this.parsedTurn.armies.find((army) => army.side !== side) ?? null;
    if (!own || !enemy) {
      return;
    }

    this.selectedArmySide = side;
    this.selectedArmy = own;
    this.enemyArmy = enemy;
    this.header.army = side === 'A' ? 'Army A' : 'Army B';
    this.placements = new Map<number, Coordinate>();

    const zone = this.setupZones[side];
    own.units.forEach((unit) => {
      if (unit.start && this.inZone(unit.start, zone) && !this.enemyHasCoord(unit.start.x, unit.start.y)) {
        this.placements.set(unit.id, { ...unit.start });
      }
    });

    this.tryRestoreDraft();
    this.rebuildOccupancyMaps();
    this.statusMessage = `${own.name} selected. Drag federations to setup coordinates.`;
    this.autoSaveDraft();
  }

  protected onUnitDragStart(event: DragEvent, unitId: number): void {
    event.dataTransfer?.setData('text/plain', String(unitId));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onCellDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onCellDrop(event: DragEvent, x: number, y: number): void {
    event.preventDefault();
    if (!this.selectedArmySide || !this.selectedArmy) {
      return;
    }

    const unitId = Number(event.dataTransfer?.getData('text/plain') ?? '');
    if (!unitId || !this.selectedArmy.units.some((unit) => unit.id === unitId)) {
      return;
    }

    if (!this.inZone({ x, y }, this.setupZones[this.selectedArmySide])) {
      this.statusMessage = 'Drop rejected: outside setup area.';
      return;
    }

    if (this.enemyHasCoord(x, y)) {
      this.statusMessage = 'Drop rejected: enemy federation occupies that coordinate.';
      return;
    }

    const source = this.placements.get(unitId) ?? null;
    const occupant = this.ownByCoord.get(this.coordKey(x, y));
    if (occupant && occupant.id === unitId) {
      return;
    }

    if (occupant) {
      if (source) {
        this.placements.set(occupant.id, source);
      } else {
        this.placements.delete(occupant.id);
      }
      this.statusMessage = `Swapped federation ${unitId} with ${occupant.id}.`;
    } else {
      this.statusMessage = `Placed federation ${unitId} at ${x}/${y}.`;
    }

    this.placements.set(unitId, { x, y });
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
  }

  protected onTrayDrop(event: DragEvent): void {
    event.preventDefault();
    const unitId = Number(event.dataTransfer?.getData('text/plain') ?? '');
    if (!unitId || !this.placements.has(unitId)) {
      return;
    }
    this.placements.delete(unitId);
    this.rebuildOccupancyMaps();
    this.statusMessage = `Federation ${unitId} moved back to tray.`;
    this.autoSaveDraft();
  }

  protected onTrayDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected getUnplacedUnits(): FederationUnit[] {
    if (!this.selectedArmy) {
      return [];
    }
    return this.selectedArmy.units.filter((unit) => !this.placements.has(unit.id));
  }

  protected getPlacedCount(): number {
    return this.placements.size;
  }

  protected getTotalCount(): number {
    return this.selectedArmy?.units.length ?? 0;
  }

  protected getArmyLabel(side: ArmySide): string {
    const army = this.parsedTurn?.armies.find((item) => item.side === side);
    return army?.name ?? 'Unknown';
  }

  protected canExport(): boolean {
    return !!this.selectedArmy && this.getUnplacedUnits().length === 0 && !!this.header;
  }

  protected async downloadSimSheet(): Promise<void> {
    if (!this.selectedArmy || !this.selectedArmySide || !this.header) {
      return;
    }
    this.exporting = true;
    this.exportError = '';
    try {
      await this.excelExport.exportSetup(this.header, this.selectedArmySide, this.selectedArmy.units, this.placements);
      this.statusMessage = 'SIM setup sheet downloaded.';
    } catch (error) {
      this.exportError = error instanceof Error ? error.message : 'Failed to export sheet.';
    } finally {
      this.exporting = false;
      this.changeDetector.markForCheck();
    }
  }

  protected saveDraftNow(): void {
    this.autoSaveDraft();
    this.statusMessage = 'Draft saved.';
  }

  protected getOccupant(x: number, y: number): { unit: FederationUnit; kind: 'own' | 'enemy' } | null {
    const own = this.ownByCoord.get(this.coordKey(x, y));
    if (own) {
      return { kind: 'own', unit: own };
    }
    const enemy = this.enemyByCoord.get(this.coordKey(x, y));
    if (enemy) {
      return { kind: 'enemy', unit: enemy };
    }
    return null;
  }

  protected cellFeatureClass(cell: MapCell): string {
    return `feature-${cell.feature}`;
  }

  protected heightColor(height: number): string {
    const stops = ['#ffffff', '#ffe500', '#9be59b', '#1f7a32', '#d3d3d3'];
    if (height <= 4) {
      return stops[height] ?? '#ffffff';
    }
    const mix = (height - 4) / 5;
    const channel = Math.round(211 * (1 - mix));
    return `rgb(${channel}, ${channel}, ${channel})`;
  }

  protected cellLabel(cell: MapCell): string {
    const feature = cell.feature === 'open' ? '' : cell.token[0];
    return feature ? `${feature}${cell.height}` : String(cell.height);
  }

  protected glyphIsLight(height: number): boolean {
    return height >= 6;
  }

  protected zoneShadow(cell: MapCell): string {
    const shadows: string[] = [];
    for (const zone of Object.values(this.setupZones)) {
      if (cell.x < zone.minX || cell.x > zone.maxX || cell.y < zone.minY || cell.y > zone.maxY) {
        continue;
      }
      if (cell.y === zone.minY) {
        shadows.push('inset 0 2px 0 #000');
      }
      if (cell.y === zone.maxY) {
        shadows.push('inset 0 -2px 0 #000');
      }
      if (cell.x === zone.minX) {
        shadows.push('inset 2px 0 0 #000');
      }
      if (cell.x === zone.maxX) {
        shadows.push('inset -2px 0 0 #000');
      }
    }
    return shadows.join(', ');
  }

  protected mapCaption(): string {
    const sim = this.parsedTurn?.simNumber ?? 'unknown';
    const armyA = this.parsedTurn?.deploymentAreaA ?? 'unknown';
    const armyB = this.parsedTurn?.deploymentAreaB ?? 'unknown';
    return `Sim ${sim} — A: ${armyA}, B: ${armyB}`;
  }

  protected onCellHover(cell: MapCell): void {
    this.hoverText = `${cell.x}, ${cell.y}  ${cell.token}  height ${cell.height}`;
  }

  protected cellInSelectedZone(x: number, y: number): boolean {
    if (!this.selectedArmySide) {
      return false;
    }
    return this.inZone({ x, y }, this.setupZones[this.selectedArmySide]);
  }

  private rebuildOccupancyMaps(): void {
    this.ownByCoord = new Map<string, FederationUnit>();
    this.enemyByCoord = new Map<string, FederationUnit>();

    if (this.selectedArmy) {
      this.selectedArmy.units.forEach((unit) => {
        const coord = this.placements.get(unit.id);
        if (coord) {
          this.ownByCoord.set(this.coordKey(coord.x, coord.y), unit);
        }
      });
    }

    if (this.enemyArmy) {
      this.enemyArmy.units.forEach((unit) => {
        if (unit.start) {
          this.enemyByCoord.set(this.coordKey(unit.start.x, unit.start.y), unit);
        }
      });
    }
  }

  private autoSaveDraft(): void {
    if (!this.header || !this.selectedArmySide) {
      return;
    }
    const gameId = this.header.gameId ?? 'unknown';
    const sim = this.header.simulationNumber ?? 0;
    const placementsRecord: Record<number, Coordinate> = {};
    this.placements.forEach((coord, id) => {
      placementsRecord[id] = coord;
    });
    this.draft.save(gameId, sim, this.selectedArmySide, {
      header: this.header,
      placements: placementsRecord,
    });
  }

  private tryRestoreDraft(): void {
    if (!this.header || !this.selectedArmy || !this.selectedArmySide) {
      return;
    }
    const gameId = this.header.gameId ?? 'unknown';
    const sim = this.header.simulationNumber ?? 0;
    const draft = this.draft.load(gameId, sim, this.selectedArmySide);
    if (!draft) {
      return;
    }

    this.header.generalFederation = draft.header.generalFederation;
    this.header.processDate = draft.header.processDate;
    const zone = this.setupZones[this.selectedArmySide];

    this.placements.clear();
    this.selectedArmy.units.forEach((unit) => {
      const coord = draft.placements[unit.id];
      if (coord && this.inZone(coord, zone) && !this.enemyHasCoord(coord.x, coord.y)) {
        this.placements.set(unit.id, { x: coord.x, y: coord.y });
      }
    });
  }

  private buildRows(cells: MapCell[]): MapCell[][] {
    const rows: MapCell[][] = [];
    for (let y = 1; y <= this.mapHeight; y += 1) {
      const row = cells.filter((cell) => cell.y === y).sort((a, b) => a.x - b.x);
      rows.push(row);
    }
    return rows;
  }

  private inZone(coord: Coordinate, zone: SetupZone): boolean {
    return coord.x >= zone.minX && coord.x <= zone.maxX && coord.y >= zone.minY && coord.y <= zone.maxY;
  }

  private enemyHasCoord(x: number, y: number): boolean {
    return this.enemyByCoord.has(this.coordKey(x, y));
  }

  private coordKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private emptyFortressEntrenchments(): Array<{ x: number | null; y: number | null }> {
    return Array.from({ length: 10 }, () => ({ x: null, y: null }));
  }

  private parseTurnText(text: string): void {
    this.parsedTurn = this.parser.parse(text);
    this.header = { ...this.parsedTurn.header };
    if (!this.header.processDate) {
      this.header.processDate = new Date().toISOString().slice(0, 10);
    }
    this.fortressEntrenchments = this.emptyFortressEntrenchments();
    this.header.army = 'Army A';
    this.selectedArmySide = 'A';
    this.selectedArmy = null;
    this.enemyArmy = null;
    this.placements = new Map<number, Coordinate>();
    this.rows = this.buildRows(this.parsedTurn.mapCells);
    this.ownByCoord.clear();
    this.enemyByCoord.clear();
    this.statusMessage = 'Turn parsed. Army A selected.';
  }
}
