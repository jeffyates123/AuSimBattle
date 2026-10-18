import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BattleHeader, FederationOrder } from './models/battle';
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

type ChipLabelMode =
  | 'fedType'
  | 'fedNo'
  | 'battalionGroup'
  | 'startAttack'
  | 'order'
  | 'additionalOrder'
  | 'formation'
  | 'altCondition'
  | 'altOrder'
  | 'altAdditionalOrder'
  | 'altFormation';

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly chipDisplayModes = [
    { value: 'fedType', label: 'Fed type', short: 'Ty', row: 1 },
    { value: 'xy', label: 'Start X/Y', short: 'XY', row: 1 },
    { value: 'fedNo', label: 'Fed no', short: 'No', row: 1 },
    { value: 'battalionGroup', label: 'Battalion Group', short: 'BG', row: 1 },
    { value: 'startAttack', label: 'Start Attack', short: 'Start', row: 1 },
    { value: 'order', label: 'Order', short: 'Ord', row: 1 },
    { value: 'additionalOrder', label: 'Additional Order', short: 'Add', row: 1 },
    { value: 'formation', label: 'Formation', short: 'Form', row: 1 },
    { value: 'destination1', label: 'Destination 1', short: 'D1', row: 1 },
    { value: 'destination2', label: 'Destination 2', short: 'D2', row: 1 },
    { value: 'altCondition', label: 'Alt condition', short: 'ACond', row: 2 },
    { value: 'altOrder', label: 'Alt order', short: 'AOrd', row: 2 },
    { value: 'altAdditionalOrder', label: 'Alt additional order', short: 'AAdd', row: 2 },
    { value: 'altFormation', label: 'Alt formation', short: 'AForm', row: 2 },
    { value: 'altDestination1', label: 'Alt destination 1', short: 'AD1', row: 2 },
    { value: 'altDestination2', label: 'Alt destination 2', short: 'AD2', row: 2 },
  ] as const;
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
  protected chipDisplayMode: (typeof this.chipDisplayModes)[number]['value'] = 'fedType';
  protected chipLabelMode: ChipLabelMode = 'fedType';
  protected mapZoomed = false;
  protected fedsHidden = false;
  protected awaitingEntrenchment = false;
  protected entrenchmentWarning: string | null = null;
  protected readonly columnNumbers = Array.from({ length: 45 }, (_, index) => index + 1);
  protected fortressForSelectedArmy(): { sizeLabel: string; entrenchments: number; wallStrength: number } | null {
    const fortress = this.parsedTurn?.battleBrief.fortress;
    if (!fortress || this.selectedArmySide !== 'A') {
      return null;
    }
    const allowance = this.rules.fortressAllowance(fortress.size);
    if (!allowance) {
      return null;
    }
    return {
      sizeLabel: fortress.size.charAt(0).toUpperCase() + fortress.size.slice(1),
      entrenchments: allowance.entrenchments,
      wallStrength: allowance.wallStrength,
    };
  }

  protected fortressSlotRows(): number[][] {
    const count = this.fortressForSelectedArmy()?.entrenchments ?? 0;
    const slots = Array.from({ length: count }, (_, index) => index + 1);
    const rows: number[][] = [];
    for (let index = 0; index < slots.length; index += 5) {
      rows.push(slots.slice(index, index + 5));
    }
    return rows;
  }

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
  protected federationOrders = new Map<number, FederationOrder>();
  protected highlightedFederationId: number | null = null;
  protected highlightedFederationKind: 'own' | 'enemy' = 'own';
  private layoutRevision = 0;
  private turnLoadGeneration = 0;
  private chipIndexKey = '';
  private readonly chipsByCell = new Map<string, Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }>>();
  private readonly noChips: Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }> = [];
  private lastDropAt = 0;
  private armedClickAt = 0;
  private lastPaletteDragAt = 0;
  protected rows: MapCell[][] = [];
  protected ownByCoord = new Map<string, FederationUnit>();
  protected enemyByCoord = new Map<string, FederationUnit>();
  private readonly formationByCode = new Map<number, string>();

  constructor(
    private readonly parser: TurnParserService,
    private readonly draft: DraftService,
    private readonly excelExport: ExcelExportService,
    private readonly rules: RulesService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.rules
      .getSimBattleStore()
      .orders.formationOrders.forEach((item) => this.formationByCode.set(item.code, item.formation));
  }

  protected async onTurnFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const generation = ++this.turnLoadGeneration;
    this.loading = true;
    this.parseError = '';
    this.exportError = '';
    this.statusMessage = '';
    this.chipIndexKey = '';
    this.chipsByCell.clear();
    this.changeDetector.markForCheck();

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (generation !== this.turnLoadGeneration) {
        return;
      }
      const text = await file.text();
      if (generation !== this.turnLoadGeneration) {
        return;
      }
      this.parseTurnText(text);
    } catch (error) {
      if (generation !== this.turnLoadGeneration) {
        return;
      }
      this.parseError = error instanceof Error ? error.message : 'Unable to parse this turn file.';
      this.parsedTurn = null;
      this.rows = [];
    } finally {
      if (generation === this.turnLoadGeneration) {
        this.loading = false;
        input.value = '';
        this.changeDetector.markForCheck();
      }
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
    this.federationOrders = new Map<number, FederationOrder>();
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
    this.selectFederation(unitId, 'own');
  }

  protected onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void {
    event.stopPropagation();
    this.selectFederation(unitId, kind);
    if (kind === 'own' && !this.viewingOrderPositions() && event.detail >= 2 && performance.now() - this.armedClickAt > 500) {
      this.returnToPool(unitId);
    }
  }

  protected selectedOrderDebug(): string {
    const id = this.highlightedFederationId;
    if (id === null) {
      return 'Selected federation: none';
    }
    const unit = this.federationUnit(id, this.highlightedFederationKind);
    const row = this.highlightedFederationKind === 'own' ? this.orderRowFor(id) : undefined;
    if (!row) {
      const troop = unit?.troopCode ?? '';
      const start = unit?.start ? `${unit.start.x}/${unit.start.y}` : '—';
      const side = this.highlightedFederationKind === 'enemy' ? 'Enemy' : 'Fed';
      return `${side} ${id} ${troop} start ${start}`.replace(/\s+/g, ' ').trim();
    }
    const coord = (value: { x: number | null; y: number | null }): string => {
      if (value.x === null && value.y === null) {
        return '—';
      }
      if (value.x === null) {
        return String(value.y);
      }
      if (value.y === null) {
        return String(value.x);
      }
      return `${value.x}/${value.y}`;
    };
    const num = (value: number | null): string => (value === null ? '—' : String(value));
    const form = (value: number | null): string => this.displayFormation(value) || '—';
    return [
      `Fed ${id}`,
      `BG ${num(row.battalionGroup)}`,
      `XY ${coord(row.start)}`,
      `Start ${num(row.primary.startAttack)}`,
      `Ord ${num(row.primary.order)}`,
      `Add ${num(row.primary.additionalOrder)}`,
      `Form ${form(row.primary.formation)}`,
      `D1 ${coord(row.primary.destination1)}`,
      `D2 ${coord(row.primary.destination2)}`,
      `Cond ${num(row.alternative.condition)}`,
      `AOrd ${num(row.alternative.order)}`,
      `AAdd ${num(row.alternative.additionalOrder)}`,
      `AForm ${form(row.alternative.formation)}`,
      `AD1 ${coord(row.alternative.destination1)}`,
      `AD2 ${coord(row.alternative.destination2)}`,
    ].join('  ');
  }

  protected onCellDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onCellDrop(event: DragEvent, x: number, y: number): void {
    event.preventDefault();
    if (this.viewingOrderPositions()) {
      return;
    }
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
    if (this.viewingOrderPositions()) {
      return;
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
    if (this.viewingOrderPositions()) {
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
    const limit = this.entrenchmentLimit();
    if (limit === 0) {
      return;
    }
    if (this.firstEmptyEntrenchment() < 0) {
      this.entrenchmentWarning = `No free fortress entrenchment. All ${limit} slots are in use.`;
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
    if (this.viewingOrderPositions()) {
      return;
    }
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
    return this.selectedArmy.units.filter((unit) => !this.displayedOwnCoordinate(unit));
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
      this.federationOrders,
      this.keptFortressEntrenchments(),
      fileName,
    );
    this.statusMessage = `SIM sheet saved as ${fileName}.`;
  }

  private async readSimFile(fileName: string): Promise<void> {
    const fetched = await this.fetchWorkbook(fileName);
    const buffer = fetched ?? this.excelExport.readSavedWorkbook(fileName);
    if (!buffer) {
      this.missingSimWarning = fileName;
      return;
    }
    const setup = await this.excelExport.readSetup(buffer);
    this.applySimSheet(setup, fileName);
  }

  private async fetchWorkbook(fileName: string): Promise<ArrayBuffer | null> {
    const response = await fetch(`sim-sheets/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
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

  protected cellChips(x: number, y: number): Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }> {
    if (this.fedsHidden) {
      return this.noChips;
    }
    this.ensureChipIndex();
    return this.chipsByCell.get(this.coordKey(x, y)) ?? this.noChips;
  }

  private ensureChipIndex(): void {
    const key = `${this.layoutRevision}:${this.positionSource()}`;
    if (key === this.chipIndexKey) {
      return;
    }
    this.chipIndexKey = key;
    this.chipsByCell.clear();
    if (!this.selectedArmy) {
      return;
    }

    const occupied = new Set<string>();
    if (this.viewingOrderPositions()) {
      for (const unit of this.selectedArmy.units) {
        const coord = this.displayedOwnCoordinate(unit);
        if (!coord) {
          continue;
        }
        this.addOwnChip(occupied, coord.x, coord.y, unit);
      }
    } else {
      this.ownByCoord.forEach((unit, cellKey) => {
        occupied.add(cellKey);
        this.chipsByCell.set(cellKey, [{ kind: 'own', unit }]);
      });
    }

    this.enemyByCoord.forEach((unit, cellKey) => {
      if (!occupied.has(cellKey)) {
        this.chipsByCell.set(cellKey, [{ kind: 'enemy', unit }]);
      }
    });
  }

  private addOwnChip(occupied: Set<string>, x: number, y: number, unit: FederationUnit): void {
    const cellKey = this.coordKey(x, y);
    occupied.add(cellKey);
    const existing = this.chipsByCell.get(cellKey);
    if (existing) {
      existing.push({ kind: 'own', unit });
      return;
    }
    this.chipsByCell.set(cellKey, [{ kind: 'own', unit }]);
  }

  protected chipDragEnabled(unit: FederationUnit): boolean {
    return !this.overlayCoordinate(unit);
  }

  private viewingOrderPositions(): boolean {
    return this.positionSource() !== 'deployment';
  }

  private positionSource(): 'start' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' | 'deployment' {
    switch (this.chipDisplayMode) {
      case 'xy':
        return 'start';
      case 'destination1':
        return 'destination1';
      case 'destination2':
        return 'destination2';
      case 'altDestination1':
        return 'altDestination1';
      case 'altDestination2':
        return 'altDestination2';
      default:
        return 'deployment';
    }
  }

  private selectFederation(unitId: number, kind: 'own' | 'enemy'): void {
    this.highlightedFederationId = unitId;
    this.highlightedFederationKind = kind;
  }

  private federationUnit(id: number, kind: 'own' | 'enemy'): FederationUnit | undefined {
    const army = kind === 'own' ? this.selectedArmy : this.enemyArmy;
    return army?.units.find((unit) => unit.id === id);
  }

  private isOwnUnit(unit: FederationUnit): boolean {
    return this.selectedArmy?.units.includes(unit) ?? false;
  }

  private orderRowFor(id: number): FederationOrder | undefined {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) {
      return undefined;
    }
    const stored = this.federationOrders as Map<number | string, FederationOrder>;
    return stored.get(numericId) ?? stored.get(String(numericId));
  }

  private overlayCoordinate(unit: FederationUnit): Coordinate | null {
    const source = this.positionSource();
    if (source === 'deployment') {
      return null;
    }
    const orderRow = this.orderRowFor(unit.id);
    if (!orderRow) {
      return null;
    }
    const value =
      source === 'start'
        ? orderRow.start
        : source === 'destination1'
          ? orderRow.primary.destination1
          : source === 'destination2'
            ? orderRow.primary.destination2
            : source === 'altDestination1'
              ? orderRow.alternative.destination1
              : orderRow.alternative.destination2;
    if (value.x === null || value.y === null || value.x < 1 || value.x > this.mapWidth || value.y < 1 || value.y > this.mapHeight) {
      return null;
    }
    return { x: value.x, y: value.y };
  }

  private displayedOwnCoordinate(unit: FederationUnit): Coordinate | null {
    return this.overlayCoordinate(unit) ?? this.placements.get(unit.id) ?? null;
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
    return this.specialBorderShadow(cell);
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
    return this.mapZoomed && !!this.selectedArmySide;
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

  protected chipModeHasValues(mode: (typeof this.chipDisplayModes)[number]['value']): boolean {
    if (mode === 'fedType' || mode === 'fedNo') {
      return (this.selectedArmy?.units.length ?? 0) > 0;
    }
    for (const orderRow of this.federationOrders.values()) {
      if (this.orderFieldHasValue(orderRow, mode)) {
        return true;
      }
    }
    return false;
  }

  private orderFieldHasValue(
    orderRow: FederationOrder,
    mode: (typeof this.chipDisplayModes)[number]['value'],
  ): boolean {
    const coordinate = (value: { x: number | null; y: number | null } | undefined): boolean =>
      !!value && (value.x !== null || value.y !== null);
    switch (mode) {
      case 'xy':
        return coordinate(orderRow.start);
      case 'battalionGroup':
        return orderRow.battalionGroup !== null;
      case 'startAttack':
        return orderRow.primary.startAttack !== null;
      case 'order':
        return orderRow.primary.order !== null;
      case 'additionalOrder':
        return orderRow.primary.additionalOrder !== null;
      case 'formation':
        return orderRow.primary.formation !== null;
      case 'destination1':
        return coordinate(orderRow.primary.destination1);
      case 'destination2':
        return coordinate(orderRow.primary.destination2);
      case 'altCondition':
        return orderRow.alternative.condition !== null;
      case 'altOrder':
        return orderRow.alternative.order !== null;
      case 'altAdditionalOrder':
        return orderRow.alternative.additionalOrder !== null;
      case 'altFormation':
        return orderRow.alternative.formation !== null;
      case 'altDestination1':
        return coordinate(orderRow.alternative.destination1);
      case 'altDestination2':
        return coordinate(orderRow.alternative.destination2);
      default:
        return false;
    }
  }

  protected selectChipMode(mode: (typeof this.chipDisplayModes)[number]['value']): void {
    if (
      mode !== 'xy' &&
      mode !== 'destination1' &&
      mode !== 'destination2' &&
      mode !== 'altDestination1' &&
      mode !== 'altDestination2'
    ) {
      this.chipLabelMode = mode;
    }
    this.chipDisplayMode = mode;
  }

  protected chipText(unit: FederationUnit): string {
    if (!this.isOwnUnit(unit) || this.chipLabelMode === 'fedType') {
      return unit.troopCode;
    }
    if (this.chipLabelMode === 'fedNo') {
      return String(unit.id);
    }
    const orderRow = this.orderRowFor(unit.id);
    if (!orderRow) {
      return '';
    }
    switch (this.chipLabelMode) {
      case 'battalionGroup':
        return this.displayNumber(orderRow.battalionGroup);
      case 'startAttack':
        return this.displayNumber(orderRow.primary.startAttack);
      case 'order':
        return this.displayNumber(orderRow.primary.order);
      case 'additionalOrder':
        return this.displayNumber(orderRow.primary.additionalOrder);
      case 'formation':
        return this.displayFormation(orderRow.primary.formation);
      case 'altCondition':
        return this.displayNumber(orderRow.alternative.condition);
      case 'altOrder':
        return this.displayNumber(orderRow.alternative.order);
      case 'altAdditionalOrder':
        return this.displayNumber(orderRow.alternative.additionalOrder);
      case 'altFormation':
        return this.displayFormation(orderRow.alternative.formation);
    }
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

    this.federationOrders = new Map<number, FederationOrder>();
    const knownIds = new Set(this.selectedArmy.units.map((unit) => unit.id));
    setup.federationOrders.forEach((orderRow) => {
      if (!knownIds.has(orderRow.federation)) {
        return;
      }
      this.federationOrders.set(orderRow.federation, this.normalizeFederationOrder(orderRow));
    });

    this.fortressEntrenchments = this.keptFortressEntrenchments(setup.fortressEntrenchments);
    this.awaitingEntrenchment = false;
    this.highlightedFederationId = null;
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
    const skippedText = skipped > 0 ? ` ${skipped} rows were skipped.` : '';
    const armyLabel = this.header.army === 'Army B' ? 'Army B' : 'Army A';
    this.statusMessage = `Loaded ${this.placements.size} federations for ${armyLabel} from ${fileName}.${skippedText}`;
  }

  protected askClearAll(): void {
    this.clearAllPrompt = true;
  }

  protected confirmClearAll(): void {
    this.clearAllPrompt = false;
    this.placements.clear();
    this.federationOrders.clear();
    this.highlightedFederationId = null;
    this.rebuildOccupancyMaps();
    this.statusMessage = 'All federations moved back to tray and their orders were cleared.';
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
    if (next) {
      this.selectFederation(next.id, 'own');
    }
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
    this.layoutRevision += 1;
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
      fortressEntrenchments: this.keptFortressEntrenchments(),
      federationOrders: this.federationOrdersRecord(),
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
      this.fortressEntrenchments = this.keptFortressEntrenchments(draft.fortressEntrenchments);
    }

    this.placements.clear();
    this.selectedArmy.units.forEach((unit) => {
      const coord = draft.placements[unit.id];
      if (coord && this.inZone(coord, zone) && !this.enemyHasCoord(coord.x, coord.y)) {
        this.placements.set(unit.id, { x: coord.x, y: coord.y });
      }
    });
    this.federationOrders.clear();
    if (draft.federationOrders) {
      Object.values(draft.federationOrders).forEach((orderRow) => {
        if (!orderRow || !this.selectedArmy?.units.some((unit) => unit.id === orderRow.federation)) {
          return;
        }
        this.federationOrders.set(orderRow.federation, this.normalizeFederationOrder(orderRow));
      });
    }
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
    if (/\bArmy B\b/.test(value)) {
      return 'Army B';
    }
    if (/\bArmy A\b/.test(value)) {
      return 'Army A';
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
      this.entrenchmentWarning = `No free fortress entrenchment. All ${this.entrenchmentLimit()} slots are in use.`;
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

  private entrenchmentLimit(): number {
    return this.fortressForSelectedArmy()?.entrenchments ?? 0;
  }

  private keptFortressEntrenchments(
    source: Array<{ x: number | null; y: number | null }> = this.fortressEntrenchments,
  ): Array<{ x: number | null; y: number | null }> {
    const limit = this.entrenchmentLimit();
    return this.emptyFortressEntrenchments().map((slot, index) => {
      if (index >= limit) {
        return slot;
      }
      const saved = source[index];
      return saved ? { x: this.coordValue(saved.x), y: this.coordValue(saved.y) } : slot;
    });
  }

  private firstEmptyEntrenchment(): number {
    const limit = this.entrenchmentLimit();
    for (let index = 0; index < limit; index += 1) {
      const slot = this.fortressEntrenchments[index];
      if (!slot || (this.coordValue(slot.x) === null && this.coordValue(slot.y) === null)) {
        return index;
      }
    }
    return -1;
  }

  private entrenchmentIndexAt(x: number, y: number): number {
    const limit = this.entrenchmentLimit();
    return this.fortressEntrenchments.findIndex(
      (slot, index) => index < limit && this.coordValue(slot.x) === x && this.coordValue(slot.y) === y,
    );
  }

  private coordValue(value: number | null): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  private displayNumber(value: number | null): string {
    return value === null ? '' : String(value);
  }

  private displayFormation(value: number | null): string {
    if (value === null) {
      return '';
    }
    if (value === 0) {
      return '0';
    }
    return this.formationByCode.get(value) ?? String(value);
  }

  private federationOrdersRecord(): Record<number, FederationOrder> {
    const result: Record<number, FederationOrder> = {};
    this.federationOrders.forEach((orderRow, id) => {
      result[id] = this.normalizeFederationOrder(orderRow);
    });
    return result;
  }

  private normalizeFederationOrder(value: FederationOrder): FederationOrder {
    return {
      federation: this.coordValue(value.federation) ?? 0,
      battalionGroup: this.coordValue(value.battalionGroup),
      start: {
        x: this.coordValue(value.start?.x ?? null),
        y: this.coordValue(value.start?.y ?? null),
      },
      primary: {
        startAttack: this.coordValue(value.primary?.startAttack ?? null),
        order: this.coordValue(value.primary?.order ?? null),
        additionalOrder: this.coordValue(value.primary?.additionalOrder ?? null),
        formation: this.coordValue(value.primary?.formation ?? null),
        destination1: {
          x: this.coordValue(value.primary?.destination1?.x ?? null),
          y: this.coordValue(value.primary?.destination1?.y ?? null),
        },
        destination2: {
          x: this.coordValue(value.primary?.destination2?.x ?? null),
          y: this.coordValue(value.primary?.destination2?.y ?? null),
        },
      },
      alternative: {
        condition: this.coordValue(value.alternative?.condition ?? null),
        order: this.coordValue(value.alternative?.order ?? null),
        additionalOrder: this.coordValue(value.alternative?.additionalOrder ?? null),
        formation: this.coordValue(value.alternative?.formation ?? null),
        destination1: {
          x: this.coordValue(value.alternative?.destination1?.x ?? null),
          y: this.coordValue(value.alternative?.destination1?.y ?? null),
        },
        destination2: {
          x: this.coordValue(value.alternative?.destination2?.x ?? null),
          y: this.coordValue(value.alternative?.destination2?.y ?? null),
        },
      },
    };
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
    this.federationOrders = new Map<number, FederationOrder>();
    this.rows = this.buildRows(this.parsedTurn.mapCells);
    this.ownByCoord = new Map<string, FederationUnit>();
    this.enemyByCoord = new Map<string, FederationUnit>();
    this.highlightedFederationId = null;
    this.highlightedFederationKind = 'own';
    this.chipIndexKey = '';
    this.chipsByCell.clear();
    this.chipDisplayMode = 'fedType';
    this.chipLabelMode = 'fedType';
    if (this.parsedTurn.armies.length) {
      this.pickArmy(preferredArmySide);
      return;
    }
    this.statusMessage = `Turn parsed. Army ${preferredArmySide} selected.`;
  }
}
