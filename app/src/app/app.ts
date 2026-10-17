import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
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
import { ExcelExportService, SimSheetSetup } from './services/excel-export.service';
import { RulesService } from './services/rules.service';
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
  protected missingSimWarning: string | null = null;
  protected savePrompt: { fileName: string; nextName: string } | null = null;
  protected simFileChoices: string[] | null = null;
  protected clearAllPrompt = false;
  protected statusMessage = '';
  protected sheetView: 'header' | 'deploy' = 'header';
  protected mapZoomed = false;
  protected fedsHidden = false;
  protected awaitingEntrenchment = false;
  protected entrenchmentWarning: string | null = null;
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
  protected loadingSim = false;
  protected placements = new Map<number, Coordinate>();
  protected highlightedFederationId: number | null = null;
  private lastDropAt = 0;
  private armedClickAt = 0;
  private lastPaletteDragAt = 0;
  protected rows: MapCell[][] = [];
  protected ownByCoord = new Map<string, FederationUnit>();
  protected enemyByCoord = new Map<string, FederationUnit>();

  constructor(
    private readonly parser: TurnParserService,
    private readonly draft: DraftService,
    private readonly excelExport: ExcelExportService,
    private readonly rules: RulesService,
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

  protected onArmySelected(army: BattleHeader['army'] | string | null): void {
    if (!this.header) {
      return;
    }
    const normalizedArmy = this.normalizeArmySelection(army);
    this.header.army = normalizedArmy;
    if (normalizedArmy === 'Army A' || normalizedArmy === 'Army B') {
      const side: ArmySide = normalizedArmy === 'Army A' ? 'A' : 'B';
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
    this.highlightedFederationId = null;
    this.fortressEntrenchments = this.emptyFortressEntrenchments();
    this.awaitingEntrenchment = false;

    const zone = this.setupZones[side];
    own.units.forEach((unit) => {
      if (unit.start && this.inZone(unit.start, zone) && !this.enemyHasCoord(unit.start.x, unit.start.y)) {
        this.placements.set(unit.id, { ...unit.start });
      }
    });

    this.tryRestoreDraft();
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
  }

  protected onUnitDragStart(event: DragEvent, unitId: number): void {
    event.dataTransfer?.setData('text/plain', String(unitId));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onUnitDragEnd(): void {
    this.lastPaletteDragAt = performance.now();
  }

  protected onPaletteUnitClick(unitId: number): void {
    if (performance.now() - this.lastPaletteDragAt < 400) {
      return;
    }
    this.highlightedFederationId = unitId;
  }

  protected onCellDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onCellDrop(event: DragEvent, x: number, y: number): void {
    event.preventDefault();
    this.lastDropAt = performance.now();
    const unitId = Number(event.dataTransfer?.getData('text/plain') ?? '');
    this.placeFederation(unitId, x, y);
  }

  protected onCellClick(event: MouseEvent, x: number, y: number): void {
    if (performance.now() - this.lastDropAt < 400) {
      return;
    }
    if (this.awaitingEntrenchment) {
      if (this.inSelectedSetup(x, y)) {
        this.placeEntrenchment(x, y);
        return;
      }
      this.awaitingEntrenchment = false;
    }
    const own = this.ownByCoord.get(this.coordKey(x, y));
    if (event.detail >= 2 && own) {
      if (performance.now() - this.armedClickAt > 500) {
        this.returnToPool(own.id);
      }
      return;
    }
    if (this.highlightedFederationId === null) {
      return;
    }
    this.armedClickAt = performance.now();
    this.placeFederation(this.highlightedFederationId, x, y);
  }

  protected onCellContextMenu(event: MouseEvent, x: number, y: number): void {
    event.preventDefault();
    if (this.clearEntrenchmentAt(x, y)) {
      return;
    }
    const own = this.ownByCoord.get(this.coordKey(x, y));
    if (!own) {
      return;
    }
    this.returnToPool(own.id);
  }

  protected beginEntrenchmentPlacement(event: MouseEvent): void {
    event.stopPropagation();
    if (this.awaitingEntrenchment) {
      this.awaitingEntrenchment = false;
      this.statusMessage = 'Entrenchment placement cancelled.';
      return;
    }
    if (this.firstEmptyEntrenchment() < 0) {
      this.entrenchmentWarning = 'No free fortress entrenchment. All 10 slots are in use.';
      return;
    }
    this.awaitingEntrenchment = true;
    this.highlightedFederationId = null;
    this.statusMessage = 'Click squares in the deployment area to place entrenchments. Click elsewhere to stop.';
  }

  @HostListener('document:click', ['$event'])
  protected cancelEntrenchmentOnClickElsewhere(event: MouseEvent): void {
    if (!this.awaitingEntrenchment) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.cell.deployment')) {
      return;
    }
    this.awaitingEntrenchment = false;
  }

  protected clearEntrenchments(): void {
    this.fortressEntrenchments = this.emptyFortressEntrenchments();
    this.awaitingEntrenchment = false;
    this.statusMessage = 'Fortress entrenchments cleared.';
    this.autoSaveDraft();
  }

  protected clearEntrenchmentSlot(slot: number): void {
    const index = slot - 1;
    if (!this.fortressEntrenchments[index]) {
      return;
    }
    this.fortressEntrenchments[index] = { x: null, y: null };
    this.statusMessage = `Entrenchment ${slot} cleared.`;
    this.autoSaveDraft();
  }

  protected onEntrenchmentEdited(): void {
    this.autoSaveDraft();
  }

  protected hasEntrenchment(x: number, y: number): boolean {
    return this.entrenchmentIndexAt(x, y) >= 0;
  }

  protected onTrayDrop(event: DragEvent): void {
    event.preventDefault();
    const unitId = Number(event.dataTransfer?.getData('text/plain') ?? '');
    this.returnToPool(unitId);
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
    return this.getPlacementLimit() ?? 0;
  }

  protected getArmyLabel(side: ArmySide): string {
    const army = this.parsedTurn?.armies.find((item) => item.side === side);
    return army?.name ?? 'Unknown';
  }

  protected canExport(): boolean {
    return !!this.selectedArmy && !!this.selectedArmySide && !!this.header;
  }

  protected async downloadSimSheet(): Promise<void> {
    if (!this.selectedArmy || !this.selectedArmySide || !this.header) {
      return;
    }
    this.exporting = true;
    this.exportError = '';
    this.missingSimWarning = null;
    this.simFileChoices = null;
    try {
      const existing = await this.excelExport.matchingFileNames(this.header);
      const fileName = this.excelExport.fileName(this.header);
      if (existing.includes(fileName)) {
        this.savePrompt = { fileName, nextName: this.excelExport.fileName(this.header, this.nextVersion(existing)) };
        return;
      }
      await this.writeSimSheet(fileName);
    } catch (error) {
      this.exportError = error instanceof Error ? error.message : 'Failed to export sheet.';
    } finally {
      this.exporting = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async confirmSave(choice: 'overwrite' | 'version'): Promise<void> {
    if (!this.savePrompt || !this.selectedArmy || !this.selectedArmySide || !this.header) {
      return;
    }
    const fileName = choice === 'overwrite' ? this.savePrompt.fileName : this.savePrompt.nextName;
    this.savePrompt = null;
    this.exporting = true;
    this.exportError = '';
    try {
      await this.writeSimSheet(fileName);
    } catch (error) {
      this.exportError = error instanceof Error ? error.message : 'Failed to export sheet.';
    } finally {
      this.exporting = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async loadMatchingSim(): Promise<void> {
    if (!this.header) {
      this.exportError = 'Load a turn before loading a SIM sheet.';
      return;
    }

    this.loadingSim = true;
    this.exportError = '';
    this.missingSimWarning = null;
    this.savePrompt = null;
    try {
      const names = await this.excelExport.matchingFileNames(this.header);
      if (names.length === 0) {
        this.missingSimWarning = this.excelExport.fileName(this.header);
        return;
      }
      if (names.length === 1) {
        await this.readSimFile(names[0]);
        return;
      }
      this.simFileChoices = names;
    } catch (error) {
      this.exportError = error instanceof Error ? error.message : 'Unable to read this SIM sheet.';
    } finally {
      this.loadingSim = false;
      this.changeDetector.markForCheck();
    }
  }

  protected async loadChosenSim(fileName: string): Promise<void> {
    this.simFileChoices = null;
    this.loadingSim = true;
    this.exportError = '';
    try {
      await this.readSimFile(fileName);
    } catch (error) {
      this.exportError = error instanceof Error ? error.message : 'Unable to read this SIM sheet.';
    } finally {
      this.loadingSim = false;
      this.changeDetector.markForCheck();
    }
  }

  private nextVersion(existing: string[]): number {
    let version = 1;
    while (this.header && existing.includes(this.excelExport.fileName(this.header, version))) {
      version += 1;
    }
    return version;
  }

  private async writeSimSheet(fileName: string): Promise<void> {
    if (!this.selectedArmySide || !this.header) {
      return;
    }
    await this.excelExport.exportSetup(
      this.header,
      this.selectedArmySide,
      this.placements,
      this.fortressEntrenchments,
      fileName,
    );
    this.statusMessage = `SIM sheet saved as ${fileName}.`;
  }

  private async readSimFile(fileName: string): Promise<void> {
    const saved = this.excelExport.readSavedWorkbook(fileName);
    const buffer = saved ?? (await this.fetchWorkbook(fileName));
    if (!buffer) {
      this.missingSimWarning = fileName;
      return;
    }
    const setup = await this.excelExport.readSetup(buffer);
    this.applySimSheet(setup, fileName);
  }

  private async fetchWorkbook(fileName: string): Promise<ArrayBuffer | null> {
    const response = await fetch(`sim-sheets/${encodeURIComponent(fileName)}`);
    if (!response.ok) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    const signature = new Uint8Array(buffer, 0, 2);
    return signature[0] === 0x50 && signature[1] === 0x4b ? buffer : null;
  }

  protected saveDraftNow(): void {
    this.autoSaveDraft();
    this.statusMessage = 'Draft saved.';
  }

  protected getOccupant(x: number, y: number): { unit: FederationUnit; kind: 'own' | 'enemy' } | null {
    if (this.fedsHidden) {
      return null;
    }
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

  protected onZoneEdge(cell: MapCell, edge: 'n' | 's' | 'w' | 'e'): boolean {
    const onMapEdge =
      (edge === 'n' && cell.y === 1) ||
      (edge === 's' && cell.y === this.mapHeight) ||
      (edge === 'w' && cell.x === 1) ||
      (edge === 'e' && cell.x === this.mapWidth);
    if (onMapEdge) {
      return false;
    }
    for (const zone of Object.values(this.setupZones)) {
      if (cell.x < zone.minX || cell.x > zone.maxX || cell.y < zone.minY || cell.y > zone.maxY) {
        continue;
      }
      if (edge === 'n' && cell.y === zone.minY) {
        return true;
      }
      if (edge === 's' && cell.y === zone.maxY) {
        return true;
      }
      if (edge === 'w' && cell.x === zone.minX) {
        return true;
      }
      if (edge === 'e' && cell.x === zone.maxX) {
        return true;
      }
    }
    return false;
  }

  protected cellShadow(cell: MapCell): string {
    const shadows = [this.specialBorderShadow(cell), this.strategicPointShadow(cell)].filter(
      (value) => value.length > 0,
    );
    return shadows.join(', ');
  }

  protected armyChoiceLabel(army: 'Army A' | 'Army B'): string {
    const brief = this.parsedTurn?.battleBrief;
    const name = army === 'Army A' ? brief?.deploymentAreaA.name : brief?.deploymentAreaB.name;
    return name ? `${army} : ${name}` : army;
  }

  protected deploymentAreaLabel(): string {
    const side = this.selectedArmySide ?? (this.header?.army === 'Army B' ? 'B' : 'A');
    return `Deployment Area: ${side}`;
  }

  protected mainTerrainLabel(): string {
    return `Main Terrain: ${this.parsedTurn?.battleBrief.mainTerrain ?? ''}`;
  }

  protected opponentArmyLabel(): string {
    const brief = this.parsedTurn?.battleBrief;
    const selected = this.selectedArmySide ?? (this.header?.army === 'Army B' ? 'B' : 'A');
    const opponentSide = selected === 'A' ? 'B' : 'A';
    const opponent = opponentSide === 'A' ? brief?.deploymentAreaA : brief?.deploymentAreaB;
    const name = opponent?.name ?? 'unknown';
    const count = opponent?.maxFederations ?? 'unknown';
    return `Army ${opponentSide}: ${name} (${count} Federations)`;
  }

  protected toggleMapZoom(): void {
    this.mapZoomed = !this.mapZoomed;
  }

  protected toggleFedsHidden(): void {
    this.fedsHidden = !this.fedsHidden;
  }

  protected isMapZoomed(): boolean {
    return this.sheetView === 'deploy' && this.mapZoomed;
  }

  protected visibleColumns(): number[] {
    const window = this.zoomWindow();
    if (!window) {
      return this.columnNumbers;
    }
    return this.columnNumbers.filter((column) => column >= window.minX && column <= window.maxX);
  }

  protected visibleRows(): MapCell[][] {
    const window = this.zoomWindow();
    if (!window) {
      return this.rows;
    }
    return this.rows
      .filter((row) => {
        const y = row[0]?.y;
        return y !== undefined && y >= window.minY && y <= window.maxY;
      })
      .map((row) => row.filter((cell) => cell.x >= window.minX && cell.x <= window.maxX));
  }

  protected troopFamily(unit: FederationUnit, armyName: string | null | undefined): 'infantry' | 'cavalry' | 'artillery' {
    const battalionNo = this.rules.getBattalionRuleByShortName(armyName, unit.troopCode)?.no;
    if (battalionNo !== undefined && battalionNo >= 41 && battalionNo <= 45) {
      return 'artillery';
    }
    if (battalionNo !== undefined && battalionNo >= 21 && battalionNo <= 39) {
      return 'cavalry';
    }
    return 'infantry';
  }

  protected chipArmyName(kind: 'own' | 'enemy'): string | null {
    if (kind === 'own') {
      return this.selectedArmy?.name ?? null;
    }
    return this.enemyArmy?.name ?? null;
  }

  protected onStrategicPoint(x: number, y: number): boolean {
    const brief = this.parsedTurn?.battleBrief;
    if (!brief) {
      return false;
    }
    const matches = (point: { x: number; y: number }) => point.x === x && point.y === y;
    return brief.deploymentAreaA.strategicPoints.some(matches) || brief.deploymentAreaB.strategicPoints.some(matches);
  }

  private applySimSheet(setup: SimSheetSetup, fileName = 'the SIM sheet'): void {
    if (!this.header || !this.parsedTurn) {
      this.exportError = 'Load a turn before loading a SIM sheet.';
      return;
    }

    if (setup.army) {
      this.pickArmy(setup.army);
    }
    if (!this.selectedArmy || !this.selectedArmySide) {
      this.exportError = 'The SIM sheet army is not available for this turn.';
      return;
    }

    if (setup.generalFederation !== null) {
      this.header.generalFederation = setup.generalFederation;
    }
    if (setup.processDate) {
      this.header.processDate = setup.processDate;
    }

    const occupied = new Set<string>();
    this.placements = new Map<number, Coordinate>();
    let skipped = 0;

    for (const placement of setup.placements) {
      const known = this.selectedArmy.units.some((unit) => unit.id === placement.id);
      const onMap =
        placement.x >= 1 && placement.x <= this.mapWidth && placement.y >= 1 && placement.y <= this.mapHeight;
      const key = this.coordKey(placement.x, placement.y);
      if (!known || !onMap || occupied.has(key)) {
        skipped += 1;
        continue;
      }
      this.placements.set(placement.id, { x: placement.x, y: placement.y });
      occupied.add(key);
    }

    this.fortressEntrenchments = this.emptyFortressEntrenchments().map((slot, index) => {
      const saved = setup.fortressEntrenchments[index];
      return saved ? { x: this.coordValue(saved.x), y: this.coordValue(saved.y) } : slot;
    });
    this.awaitingEntrenchment = false;
    this.highlightedFederationId = null;
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
    const skippedText = skipped > 0 ? ` ${skipped} rows were skipped.` : '';
    this.statusMessage = `Loaded ${this.placements.size} federations from ${fileName}.${skippedText}`;
  }

  protected askClearAll(): void {
    this.clearAllPrompt = true;
  }

  protected confirmClearAll(): void {
    this.clearAllPrompt = false;
    this.placements.clear();
    this.highlightedFederationId = null;
    this.rebuildOccupancyMaps();
    this.statusMessage = 'All federations moved back to tray.';
    this.autoSaveDraft();
  }

  private returnToPool(unitId: number): void {
    if (!unitId || !this.placements.has(unitId)) {
      return;
    }
    this.placements.delete(unitId);
    this.rebuildOccupancyMaps();
    this.statusMessage = `Federation ${unitId} moved back to tray.`;
    this.autoSaveDraft();
  }

  private placeFederation(unitId: number, x: number, y: number): void {
    if (!this.selectedArmySide || !this.selectedArmy) {
      return;
    }
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

    const placementLimit = this.getPlacementLimit();
    if (!source && !occupant && placementLimit !== null && this.placements.size >= placementLimit) {
      this.statusMessage = `Drop rejected: deployment limit of ${placementLimit} reached.`;
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
    this.highlightFollowing(unitId);
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
  }

  private highlightFollowing(placedId: number): void {
    const unplaced = this.getUnplacedUnits().filter((unit) => unit.id !== placedId);
    if (!unplaced.length) {
      this.highlightedFederationId = null;
      return;
    }
    const next = unplaced.find((unit) => unit.id > placedId) ?? unplaced[0];
    this.highlightedFederationId = next?.id ?? null;
  }

  private zoomWindow(): SetupZone | null {
    if (!this.isMapZoomed() || !this.selectedArmySide) {
      return null;
    }
    const zone = this.setupZones[this.selectedArmySide];
    return {
      minX: Math.max(1, zone.minX - 1),
      maxX: Math.min(this.mapWidth, zone.maxX + 1),
      minY: Math.max(1, zone.minY - 1),
      maxY: Math.min(this.mapHeight, zone.maxY + 1),
    };
  }

  protected getPlacementLimit(): number | null {
    if (!this.parsedTurn || !this.selectedArmySide) {
      return null;
    }
    return this.selectedArmySide === 'A'
      ? this.parsedTurn.battleBrief.deploymentAreaA.maxFederations
      : this.parsedTurn.battleBrief.deploymentAreaB.maxFederations;
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
      fortressEntrenchments: this.fortressEntrenchments.map((slot) => ({
        x: this.coordValue(slot.x),
        y: this.coordValue(slot.y),
      })),
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

    if (draft.fortressEntrenchments?.length) {
      this.fortressEntrenchments = this.emptyFortressEntrenchments().map((slot, index) => {
        const saved = draft.fortressEntrenchments?.[index];
        return saved ? { x: this.coordValue(saved.x), y: this.coordValue(saved.y) } : slot;
      });
    }

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

  private normalizeArmySelection(army: BattleHeader['army'] | string | null): BattleHeader['army'] {
    if (!army) {
      return null;
    }
    const value = String(army).trim();
    if (value === 'Army A' || value.endsWith('Army A')) {
      return 'Army A';
    }
    if (value === 'Army B' || value.endsWith('Army B')) {
      return 'Army B';
    }
    return null;
  }

  private specialBorderShadow(cell: MapCell): string {
    if (!cell.token.startsWith('$')) {
      return '';
    }

    const shadows: string[] = [];
    if (!this.isSpecialCoordinate(cell.x - 1, cell.y)) {
      shadows.push('inset 1px 0 0 #000');
    }
    shadows.push('inset -1px 0 0 #000');
    if (!this.isSpecialCoordinate(cell.x, cell.y - 1)) {
      shadows.push('inset 0 1px 0 #000');
    }
    shadows.push('inset 0 -1px 0 #000');
    return shadows.join(', ');
  }

  private isSpecialCoordinate(x: number, y: number): boolean {
    if (x < 1 || x > this.mapWidth || y < 1 || y > this.mapHeight) {
      return false;
    }
    const cell = this.rows[y - 1]?.[x - 1];
    return cell?.x === x && cell.token.startsWith('$');
  }

  private strategicPointShadow(cell: MapCell): string {
    const brief = this.parsedTurn?.battleBrief;
    if (!brief) {
      return '';
    }

    const isA = brief.deploymentAreaA.strategicPoints.some((point) => point.x === cell.x && point.y === cell.y);
    const isB = brief.deploymentAreaB.strategicPoints.some((point) => point.x === cell.x && point.y === cell.y);

    if (isA && isB) {
      return 'inset 0 0 0 4px #ff2d2d, inset 0 0 0 7px #3d8bff';
    }
    if (isA) {
      return 'inset 0 0 0 4px #ff2d2d';
    }
    if (isB) {
      return 'inset 0 0 0 4px #3d8bff';
    }
    return '';
  }

  private emptyFortressEntrenchments(): Array<{ x: number | null; y: number | null }> {
    return Array.from({ length: 10 }, () => ({ x: null, y: null }));
  }

  private placeEntrenchment(x: number, y: number): void {
    if (!this.inSelectedSetup(x, y)) {
      return;
    }
    if (this.entrenchmentIndexAt(x, y) >= 0) {
      this.statusMessage = 'That square already has an entrenchment.';
      return;
    }
    const index = this.firstEmptyEntrenchment();
    if (index < 0) {
      this.awaitingEntrenchment = false;
      this.entrenchmentWarning = 'No free fortress entrenchment. All 10 slots are in use.';
      return;
    }
    this.fortressEntrenchments[index] = { x, y };
    const next = this.firstEmptyEntrenchment();
    if (next < 0) {
      this.awaitingEntrenchment = false;
      this.statusMessage = `Entrenchment ${index + 1} placed at ${x}, ${y}. All entrenchment slots are filled.`;
    } else {
      this.statusMessage = `Entrenchment ${index + 1} placed at ${x}, ${y}.`;
    }
    this.autoSaveDraft();
  }

  protected inSelectedSetup(x: number, y: number): boolean {
    return !!this.selectedArmySide && this.inZone({ x, y }, this.setupZones[this.selectedArmySide]);
  }

  private clearEntrenchmentAt(x: number, y: number): boolean {
    const index = this.entrenchmentIndexAt(x, y);
    if (index < 0) {
      return false;
    }
    this.fortressEntrenchments[index] = { x: null, y: null };
    this.statusMessage = `Entrenchment ${index + 1} cleared.`;
    this.autoSaveDraft();
    return true;
  }

  private firstEmptyEntrenchment(): number {
    return this.fortressEntrenchments.findIndex((slot) => this.coordValue(slot.x) === null && this.coordValue(slot.y) === null);
  }

  private entrenchmentIndexAt(x: number, y: number): number {
    return this.fortressEntrenchments.findIndex((slot) => this.coordValue(slot.x) === x && this.coordValue(slot.y) === y);
  }

  private coordValue(value: number | null): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private parseTurnText(text: string): void {
    this.parsedTurn = this.parser.parse(text);
    this.header = { ...this.parsedTurn.header };
    if (!this.header.processDate) {
      this.header.processDate = new Date().toISOString().slice(0, 10);
    }
    const preferredArmySide: ArmySide = this.header.army === 'Army B' ? 'B' : 'A';
    this.fortressEntrenchments = this.emptyFortressEntrenchments();
    this.awaitingEntrenchment = false;
    this.header.army = preferredArmySide === 'A' ? 'Army A' : 'Army B';
    this.selectedArmySide = preferredArmySide;
    this.selectedArmy = null;
    this.enemyArmy = null;
    this.placements = new Map<number, Coordinate>();
    this.rows = this.buildRows(this.parsedTurn.mapCells);
    this.ownByCoord.clear();
    this.enemyByCoord.clear();
    if (this.parsedTurn.armies.length) {
      this.pickArmy(preferredArmySide);
      return;
    }
    this.statusMessage = `Turn parsed. Army ${preferredArmySide} selected.`;
  }
}
