import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
import { AuthService } from './services/auth.service';
import { BetaDataService } from './services/beta-data.service';
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

type EditableChipMode = Exclude<ChipLabelMode, 'fedType' | 'fedNo'>;

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
  protected turnLoadChoice: { simFiles: string[]; hasDraft: boolean } | null = null;
  protected clearAllPrompt = false;
  protected statusMessage = '';
  protected sheetView: 'header' | 'deploy' = 'header';
  protected chipDisplayMode: (typeof this.chipDisplayModes)[number]['value'] = 'fedType';
  protected chipLabelMode: ChipLabelMode = 'fedType';
  protected showFedEffectiveness = false;
  protected valueEntry: { unitId: number; mode: EditableChipMode; draft: string; error: string; hint: string; fresh: boolean } | null = null;
  protected valueAction: { unitId: number; mode: EditableChipMode; value: number; fresh?: boolean } | null = null;
  protected betaStoreWarning = '';
  private valuePaint: { mode: EditableChipMode; value: number; increment: boolean } | null = null;
  private readonly orderCodes = new Set<number>();
  private readonly additionalOrderCodes = new Set<number>();
  private readonly formationCodes = new Set<number>([0]);
  private readonly conditionCodes = new Set<number>();
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
  private armedFederationId: number | null = null;
  private sheetFedNo = new Map<number, number>();
  private layoutRevision = 0;
  private readonly chipPositionOverride = new Map<number, Coordinate>();
  private turnLoadGeneration = 0;
  private chipIndexKey = '';
  private readonly chipsByCell = new Map<string, Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }>>();
  private readonly noChips: Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }> = [];
  private lastDropAt = 0;
  private armedClickAt = 0;
  private lastPaletteDragAt = 0;
  private activeBattleId: string | null = null;
  protected rows: MapCell[][] = [];
  protected ownByCoord = new Map<string, FederationUnit>();
  protected enemyByCoord = new Map<string, FederationUnit>();
  private readonly formationByCode = new Map<number, string>();

  constructor(
    private readonly parser: TurnParserService,
    private readonly draft: DraftService,
    private readonly auth: AuthService,
    private readonly betaData: BetaDataService,
    private readonly excelExport: ExcelExportService,
    private readonly rules: RulesService,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    const orders = this.rules.getSimBattleStore().orders;
    orders.formationOrders.forEach((item) => {
      this.formationByCode.set(item.code, item.formation);
      this.formationCodes.add(item.code);
    });
    for (const group of [orders.movementAttack, orders.pioneerOnly, orders.detachmentOrders, orders.swapDetachmentOrders]) {
      group.forEach((item) => this.orderCodes.add(item.code));
    }
    orders.additionalOrders.troopTypeFilters.forEach((item) => this.additionalOrderCodes.add(item.code));
    orders.additionalOrders.strategicPointSequence.forEach((item) => this.additionalOrderCodes.add(item.code));
    const rounds = orders.alternativeConditions.roundStartRange;
    for (let round = rounds.min; round <= rounds.max; round += 1) {
      this.conditionCodes.add(round);
    }
    orders.alternativeConditions.headcountDropBelowCodes.forEach((item) => this.conditionCodes.add(item.code));
    orders.alternativeConditions.other.forEach((item) => this.conditionCodes.add(item.code));
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
    this.betaStoreWarning = '';
    this.turnLoadChoice = null;
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
      let parseError: string | null = null;
      let gameId: string | null = null;
      let simulationNumber: number | null = null;
      let army: ArmySide | null = null;
      try {
        this.parseTurnText(text);
        gameId = this.header?.gameId ?? null;
        simulationNumber = this.header?.simulationNumber ?? null;
        army = this.selectedArmySide;
        await this.offerMatchingSim(generation);
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Unable to parse this turn file.';
        this.parseError = parseError;
        this.parsedTurn = null;
        this.rows = [];
      }
      await this.storeTurnForBeta(file.name, text, parseError, gameId, simulationNumber, army);
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

  protected pickArmy(side: ArmySide, options?: { restoreDraft?: boolean; saveDraft?: boolean }): void {
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
    this.sheetFedNo = new Map<number, number>();
    this.highlightedFederationId = null;
    this.fortressEntrenchments = this.emptyFortressEntrenchments();
    this.awaitingEntrenchment = false;

    const zone = this.setupZones[side];
    own.units.forEach((unit) => {
      if (unit.start && this.inZone(unit.start, zone) && !this.enemyHasCoord(unit.start.x, unit.start.y)) {
        this.placements.set(unit.id, { ...unit.start });
      }
    });

    if (options?.restoreDraft !== false) {
      this.tryRestoreDraft();
    }
    this.ensureSheetNumbersForPlaced();
    this.rebuildOccupancyMaps();
    if (options?.saveDraft !== false) {
      this.autoSaveDraft();
    }
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

  protected onPaletteUnitClick(event: MouseEvent, unitId: number): void {
    if (performance.now() - this.lastPaletteDragAt < 400) {
      return;
    }
    if (this.beginValueEdit(unitId, event.detail)) {
      return;
    }
    this.selectFederation(unitId, 'own');
    this.armedFederationId = unitId;
  }

  protected onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void {
    event.stopPropagation();
    if (kind === 'own' && this.beginValueEdit(unitId, event.detail)) {
      return;
    }
    this.selectFederation(unitId, kind);
    if (kind === 'own') {
      this.armedFederationId = unitId;
    }
    if (kind === 'own' && this.setupEditingEnabled() && event.detail >= 2 && performance.now() - this.armedClickAt > 500) {
      this.returnToPool(unitId);
    }
  }

  protected onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void {
    const mode = this.editableChipMode();
    if (!mode || kind !== 'own') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.fieldValue(unitId, mode) === null) {
      return;
    }
    this.writeField(unitId, mode, null);
    this.statusMessage = `Cleared ${this.fieldLabel(mode)} on federation ${unitId}.`;
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

  protected selectedModeValue(mode: (typeof this.chipDisplayModes)[number]['value']): string {
    const id = this.highlightedFederationId;
    if (id === null) {
      return '';
    }
    const unit = this.federationUnit(id, this.highlightedFederationKind);
    if (!unit) {
      return '';
    }
    if (mode === 'fedType') {
      return unit.troopCode;
    }
    if (mode === 'fedNo') {
      return this.fedNoLabel(unit.id);
    }
    if (this.highlightedFederationKind !== 'own') {
      return mode === 'xy' && unit.start ? `${unit.start.x}/${unit.start.y}` : '';
    }
    const row = this.orderRowFor(id);
    if (mode === 'xy') {
      if (row && (row.start.x !== null || row.start.y !== null)) {
        return this.formatCoordinate(row.start);
      }
      const placed = this.placements.get(id);
      return placed ? `${placed.x}/${placed.y}` : '';
    }
    if (!row) {
      return '';
    }
    switch (mode) {
      case 'battalionGroup':
        return this.displayNumber(row.battalionGroup);
      case 'startAttack':
        return this.displayNumber(row.primary.startAttack);
      case 'order':
        return this.displayNumber(row.primary.order);
      case 'additionalOrder':
        return this.displayNumber(row.primary.additionalOrder);
      case 'formation':
        return this.displayFormation(row.primary.formation);
      case 'destination1':
        return this.formatCoordinate(row.primary.destination1);
      case 'destination2':
        return this.formatCoordinate(row.primary.destination2);
      case 'altCondition':
        return this.displayNumber(row.alternative.condition);
      case 'altOrder':
        return this.displayNumber(row.alternative.order);
      case 'altAdditionalOrder':
        return this.displayNumber(row.alternative.additionalOrder);
      case 'altFormation':
        return this.displayFormation(row.alternative.formation);
      case 'altDestination1':
        return this.formatCoordinate(row.alternative.destination1);
      case 'altDestination2':
        return this.formatCoordinate(row.alternative.destination2);
      default:
        return '';
    }
  }

  protected selectedModeEditable(mode: (typeof this.chipDisplayModes)[number]['value']): boolean {
    return this.highlightedFederationKind === 'own' && this.highlightedFederationId !== null && mode !== 'fedType' && mode !== 'fedNo';
  }

  protected commitSelectedModeValue(mode: (typeof this.chipDisplayModes)[number]['value'], event: Event): void {
    const input = event.target as HTMLInputElement;
    const id = this.highlightedFederationId;
    if (id === null || this.highlightedFederationKind !== 'own' || mode === 'fedType' || mode === 'fedNo') {
      input.value = this.selectedModeValue(mode);
      return;
    }
    const text = input.value.trim();
    if (mode === 'xy' || mode === 'destination1' || mode === 'destination2' || mode === 'altDestination1' || mode === 'altDestination2') {
      if (!text) {
        this.writeCoordinate(id, mode, null);
        input.value = '';
        this.statusMessage = `Cleared ${this.coordinateLabel(mode)} on federation ${id}.`;
        return;
      }
      const coord = this.parseCoordinate(text);
      if (!coord || !this.inSelectedSetup(coord.x, coord.y)) {
        this.statusMessage = coord
          ? this.setupAreaMessage()
          : 'Enter a coordinate as x/y.';
        input.value = this.selectedModeValue(mode);
        return;
      }
      this.writeCoordinate(id, mode, coord);
      input.value = `${coord.x}/${coord.y}`;
      this.statusMessage = `Saved ${this.coordinateLabel(mode)} ${coord.x}/${coord.y} on federation ${id}.`;
      return;
    }
    if (!text) {
      this.writeField(id, mode, null);
      this.statusMessage = `Cleared ${this.fieldLabel(mode)} on federation ${id}.`;
      return;
    }
    const parsed = this.parseFieldInput(mode, text);
    if (parsed === null || !this.fieldValueAllowed(mode, parsed)) {
      this.statusMessage = this.fieldInvalidMessage(mode);
      input.value = this.selectedModeValue(mode);
      this.changeDetector.markForCheck();
      return;
    }
    this.writeField(id, mode, parsed);
    input.value = this.displayFieldValue(mode, parsed);
    this.statusMessage = `Saved ${this.fieldLabel(mode)} ${this.displayFieldValue(mode, parsed)} on federation ${id}.`;
  }

  private formatCoordinate(value: { x: number | null; y: number | null }): string {
    if (value.x === null && value.y === null) {
      return '';
    }
    if (value.x === null) {
      return String(value.y);
    }
    if (value.y === null) {
      return String(value.x);
    }
    return `${value.x}/${value.y}`;
  }

  private parseCoordinate(text: string): Coordinate | null {
    const match = text.match(/^(\d{1,2})\s*[/,\s]\s*(\d{1,2})$/);
    if (!match) {
      return null;
    }
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < 1 || x > this.mapWidth || y < 1 || y > this.mapHeight) {
      return null;
    }
    return { x, y };
  }

  private setupAreaMessage(): string {
    if (!this.selectedArmySide) {
      return 'Coordinate must be inside the setup area.';
    }
    const zone = this.setupZones[this.selectedArmySide];
    return `Coordinate must be inside the setup area (x ${zone.minX}–${zone.maxX}, y ${zone.minY}–${zone.maxY}).`;
  }

  private coordinateLabel(mode: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2'): string {
    return this.chipDisplayModes.find((item) => item.value === mode)?.label ?? mode;
  }

  private writeCoordinate(
    unitId: number,
    mode: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2',
    coord: Coordinate | null,
  ): void {
    const orderRow = this.ensureOrderRow(unitId);
    const value = coord ? { x: coord.x, y: coord.y } : { x: null, y: null };
    if (mode === 'xy') {
      orderRow.start = value;
    } else if (mode === 'destination1') {
      orderRow.primary.destination1 = value;
    } else if (mode === 'destination2') {
      orderRow.primary.destination2 = value;
    } else if (mode === 'altDestination1') {
      orderRow.alternative.destination1 = value;
    } else {
      orderRow.alternative.destination2 = value;
    }
    if (coord) {
      this.chipPositionOverride.set(unitId, { x: coord.x, y: coord.y });
      if (mode === 'xy') {
        this.placements.set(unitId, { x: coord.x, y: coord.y });
        this.rebuildOccupancyMaps();
      }
    } else {
      this.chipPositionOverride.delete(unitId);
    }
    this.layoutRevision += 1;
    this.autoSaveDraft();
  }

  protected onCellDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  protected onCellDrop(event: DragEvent, x: number, y: number): void {
    event.preventDefault();
    if (!this.setupEditingEnabled()) {
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
    if (this.chipDisplayMode === 'destination1') {
      this.placeDestination1(x, y);
      return;
    }
    if (!this.setupEditingEnabled()) {
      return;
    }
    const own = this.ownSetupUnitAt(x, y);
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
    const unitId = this.armedFederationId ?? this.highlightedFederationId;
    this.placeFederation(unitId, x, y);
  }

  protected onCellContextMenu(event: MouseEvent, x: number, y: number): void {
    event.preventDefault();
    if (this.clearEntrenchmentAt(x, y)) {
      return;
    }
    if (!this.setupEditingEnabled()) {
      return;
    }
    const own = this.ownSetupUnitAt(x, y);
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
    if (!this.setupEditingEnabled()) {
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

  protected sessionUser(): { username: string; isAdmin: boolean; displayName: string } | null {
    return this.auth.currentUser();
  }

  protected isAdminUser(): boolean {
    return this.auth.currentUser()?.isAdmin === true;
  }

  protected async goToAdmin(): Promise<void> {
    await this.router.navigateByUrl('/admin');
  }

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
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

  protected async confirmTurnSim(fileName: string): Promise<void> {
    this.turnLoadChoice = null;
    await this.loadChosenSim(fileName);
  }

  protected restoreTurnDraft(): void {
    this.turnLoadChoice = null;
    this.applyStoredDraft();
  }

  protected declineTurnSim(): void {
    this.turnLoadChoice = null;
  }

  private async offerMatchingSim(generation: number): Promise<void> {
    if (!this.header || generation !== this.turnLoadGeneration) {
      return;
    }
    let names: string[] = [];
    try {
      names = await this.excelExport.matchingFileNames(this.header);
    } catch (error) {
      if (generation !== this.turnLoadGeneration) {
        return;
      }
      this.exportError = error instanceof Error ? error.message : 'Unable to look for a SIM sheet.';
    }
    if (generation !== this.turnLoadGeneration) {
      return;
    }
    const hasDraft = this.storedDraftExists();
    if (names.length === 0 && !hasDraft) {
      return;
    }
    this.turnLoadChoice = { simFiles: names, hasDraft };
  }

  private storedDraftExists(): boolean {
    if (!this.header || !this.selectedArmySide) {
      return false;
    }
    const gameId = this.header.gameId ?? 'unknown';
    const sim = this.header.simulationNumber ?? 0;
    return this.draft.load(gameId, sim, this.selectedArmySide) !== null;
  }

  private applyStoredDraft(): void {
    this.tryRestoreDraft();
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
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
    this.ensureSheetNumbersForPlaced();
    const exported = this.sheetExportMaps();
    await this.excelExport.exportSetup(
      this.header,
      this.selectedArmySide,
      exported.placements,
      exported.orders,
      this.keptFortressEntrenchments(),
      fileName,
    );
    this.statusMessage = `SIM sheet saved as ${fileName}.`;
    await this.storeSheetForBeta(fileName);
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
    for (const unit of this.selectedArmy.units) {
      const coord = this.displayedOwnCoordinate(unit);
      if (!coord) {
        continue;
      }
      this.addOwnChip(occupied, coord.x, coord.y, unit);
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
    return this.setupEditingEnabled() && this.isOwnUnit(unit);
  }

  private setupEditingEnabled(): boolean {
    const source = this.positionSource();
    return source === 'deployment' || source === 'start';
  }

  private ownSetupUnitAt(x: number, y: number): FederationUnit | undefined {
    if (!this.selectedArmy) {
      return undefined;
    }
    if (this.highlightedFederationKind === 'own' && this.highlightedFederationId !== null) {
      const highlighted = this.selectedArmy.units.find((unit) => unit.id === this.highlightedFederationId);
      const highlightedCoord = highlighted ? this.displayedOwnCoordinate(highlighted) : null;
      if (highlightedCoord?.x === x && highlightedCoord.y === y) {
        return highlighted;
      }
    }
    return this.selectedArmy.units.find((unit) => {
      const coord = this.displayedOwnCoordinate(unit);
      return coord?.x === x && coord.y === y;
    });
  }

  private syncSetupCoordinate(unitId: number, coord: Coordinate | null): void {
    if (!coord) {
      const orderRow = this.orderRowFor(unitId);
      if (!orderRow) {
        return;
      }
      orderRow.start = { x: null, y: null };
      return;
    }
    const orderRow = this.ensureOrderRow(unitId);
    if (orderRow.battalionGroup === null) {
      orderRow.battalionGroup = unitId;
    }
    orderRow.start = { x: coord.x, y: coord.y };
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
    if (source === 'deployment' || source === 'start') {
      return null;
    }
    return this.orderCoordinate(unit, source);
  }

  private displayedOwnCoordinate(unit: FederationUnit): Coordinate | null {
    const override = this.chipPositionOverride.get(unit.id);
    if (override) {
      return override;
    }
    const placed = this.placements.get(unit.id);
    if (!placed) {
      return null;
    }
    const source = this.positionSource();
    if (source !== 'deployment' && source !== 'start') {
      const destination = this.overlayCoordinate(unit);
      if (destination) {
        return destination;
      }
    }
    return this.orderCoordinate(unit, 'start') ?? placed;
  }

  private orderCoordinate(
    unit: FederationUnit,
    source: 'start' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2',
  ): Coordinate | null {
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

  protected cellFeatureClass(cell: MapCell): string {
    return `feature-${cell.feature}`;
  }

  protected heightColor(height: number): string {
    const stops = [
      '#000000',
      '#D7F7AE',
      '#6ED63A',
      '#1F8A3C',
      '#FFE14A',
      '#C9A04A',
      '#A6A6A6',
      '#7F7F7F',
      '#545454',
      '#2A2A2A',
    ];
    return stops[height] ?? stops[0];
  }

  protected cellLabel(cell: MapCell): string {
    const feature = cell.feature === 'open' ? '' : cell.token[0];
    return feature ? `${feature}${cell.height}` : String(cell.height);
  }

  protected glyphIsLight(height: number): boolean {
    return height === 0 || (height >= 8 && height <= 9);
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
    if (mode !== this.chipDisplayMode) {
      this.valuePaint = null;
      this.valueEntry = null;
      this.valueAction = null;
    }
    if (this.chipPositionOverride.size) {
      this.chipPositionOverride.clear();
      this.layoutRevision += 1;
    }
    if (mode === 'fedType' && this.chipDisplayMode === 'fedType') {
      this.showFedEffectiveness = !this.showFedEffectiveness;
    } else {
      this.showFedEffectiveness = false;
    }
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
      return this.fedTypeLabel(unit);
    }
    if (this.chipLabelMode === 'fedNo') {
      return this.fedNoLabel(unit.id);
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

  private fedTypeLabel(unit: FederationUnit): string {
    if (!this.showFedEffectiveness || unit.effectiveness === null) {
      return unit.troopCode;
    }
    return `${unit.troopCode} ${Math.round(unit.effectiveness)}`;
  }

  protected valueActionType(): string {
    const action = this.valueAction;
    if (!action || !this.selectedArmy) {
      return '';
    }
    return this.selectedArmy.units.find((unit) => unit.id === action.unitId)?.troopCode ?? '';
  }

  protected valueActionText(): string {
    return this.valueAction ? this.displayFieldValue(this.valueAction.mode, this.valueAction.value) : '';
  }

  protected confirmValueEntry(event: Event): void {
    event.preventDefault();
    const entry = this.valueEntry;
    if (!entry) {
      return;
    }
    const parsed = this.parseFieldInput(entry.mode, entry.draft);
    if (parsed === null || !this.fieldValueAllowed(entry.mode, parsed)) {
      entry.error = this.fieldInvalidMessage(entry.mode);
      this.changeDetector.markForCheck();
      return;
    }
    this.valueEntry = null;
    this.valuePaint = null;
    if (entry.fresh) {
      this.valueAction = { unitId: entry.unitId, mode: entry.mode, value: parsed, fresh: true };
      this.statusMessage = `Entered ${this.fieldLabel(entry.mode)} ${this.displayFieldValue(entry.mode, parsed)} on federation ${entry.unitId}.`;
      return;
    }
    this.writeField(entry.unitId, entry.mode, parsed);
    this.statusMessage = `Saved ${this.fieldLabel(entry.mode)} ${this.displayFieldValue(entry.mode, parsed)} on federation ${entry.unitId}.`;
  }

  protected keepEnteredValue(): void {
    const action = this.valueAction;
    if (!action) {
      return;
    }
    this.writeField(action.unitId, action.mode, action.value);
    this.valueAction = null;
    this.statusMessage = `Saved ${this.fieldLabel(action.mode)} ${this.displayFieldValue(action.mode, action.value)} on federation ${action.unitId}.`;
  }

  protected paintSameValue(): void {
    const action = this.valueAction;
    if (!action) {
      return;
    }
    this.commitFreshValue();
    this.valuePaint = { mode: action.mode, value: action.value, increment: false };
    this.valueAction = null;
    this.statusMessage = `Painting ${this.fieldLabel(action.mode)} ${this.displayFieldValue(action.mode, action.value)}. Click an empty federation.`;
  }

  protected paintNextIncrement(): void {
    const action = this.valueAction;
    if (!action || action.mode !== 'battalionGroup') {
      return;
    }
    this.commitFreshValue();
    this.valuePaint = { mode: action.mode, value: action.value, increment: true };
    this.valueAction = null;
    this.statusMessage = `Painting the next battalion group after ${action.value}. Click an empty federation.`;
  }

  protected paintNextIncrementToAll(): void {
    this.paintIncrementSequence();
  }

  protected paintNextIncrementToSameType(): void {
    const troopCode = this.valueActionType();
    if (!troopCode) {
      return;
    }
    this.paintIncrementSequence(troopCode);
  }

  private paintIncrementSequence(troopCode?: string): void {
    const action = this.valueAction;
    if (!action || action.mode !== 'battalionGroup' || !this.selectedArmy) {
      return;
    }
    this.commitFreshValue();
    const later: FederationUnit[] = [];
    const earlier: FederationUnit[] = [];
    for (const unit of this.selectedArmy.units) {
      if (unit.id === action.unitId) {
        continue;
      }
      if (troopCode && unit.troopCode !== troopCode) {
        continue;
      }
      if (unit.id > action.unitId) {
        later.push(unit);
      } else {
        earlier.push(unit);
      }
    }
    later.sort((left, right) => left.id - right.id);
    earlier.sort((left, right) => left.id - right.id);
    let next = action.value;
    let count = 0;
    for (const unit of [...later, ...earlier]) {
      next += 1;
      if (!this.fieldValueAllowed(action.mode, next)) {
        break;
      }
      this.writeField(unit.id, action.mode, next, false);
      count += 1;
    }
    this.autoSaveDraft();
    this.valuePaint = null;
    this.valueAction = null;
    const scope = troopCode ? `${troopCode} federations` : 'federations';
    this.statusMessage = `Set battalion group ${action.value + 1} onward on ${count} ${scope}.`;
  }

  protected paintValueToAll(): void {
    const action = this.valueAction;
    if (!action || !this.selectedArmy) {
      return;
    }
    this.commitFreshValue();
    let count = 0;
    for (const unit of this.selectedArmy.units) {
      if (this.fieldValue(unit.id, action.mode) === null) {
        this.writeField(unit.id, action.mode, action.value, false);
        count += 1;
      }
    }
    this.autoSaveDraft();
    this.valuePaint = null;
    this.valueAction = null;
    this.statusMessage = `Painted ${this.fieldLabel(action.mode)} ${this.displayFieldValue(action.mode, action.value)} onto ${count} empty federations.`;
  }

  protected paintValueToSameType(): void {
    const action = this.valueAction;
    const troopCode = this.valueActionType();
    if (!action || !this.selectedArmy || !troopCode) {
      return;
    }
    this.commitFreshValue();
    let count = 0;
    for (const unit of this.selectedArmy.units) {
      if (unit.troopCode !== troopCode) {
        continue;
      }
      this.writeField(unit.id, action.mode, action.value, false);
      count += 1;
    }
    this.autoSaveDraft();
    this.valuePaint = null;
    this.valueAction = null;
    this.statusMessage = `Set ${this.fieldLabel(action.mode)} ${this.displayFieldValue(action.mode, action.value)} on ${count} ${troopCode} federations.`;
  }

  protected changeValue(): void {
    const action = this.valueAction;
    if (!action) {
      return;
    }
    this.valuePaint = null;
    this.valueAction = null;
    this.openValueEntry(action.unitId, action.mode, String(action.value), false);
  }

  private commitFreshValue(): void {
    const action = this.valueAction;
    if (!action?.fresh) {
      return;
    }
    this.writeField(action.unitId, action.mode, action.value, false);
    action.fresh = false;
  }

  private beginValueEdit(unitId: number, detail: number): boolean {
    const mode = this.editableChipMode();
    if (!mode) {
      return false;
    }
    if (detail > 1) {
      return true;
    }
    this.selectFederation(unitId, 'own');
    const current = this.fieldValue(unitId, mode);
    if (current === null) {
      if (this.valuePaint?.mode === mode) {
        const nextValue = this.valuePaint.increment ? this.valuePaint.value + 1 : this.valuePaint.value;
        if (!this.fieldValueAllowed(mode, nextValue)) {
          this.statusMessage = this.fieldInvalidMessage(mode);
          return true;
        }
        this.writeField(unitId, mode, nextValue);
        if (this.valuePaint.increment) {
          this.valuePaint = { mode, value: nextValue, increment: true };
        }
        this.statusMessage = `Saved ${this.fieldLabel(mode)} ${this.displayFieldValue(mode, nextValue)} on federation ${unitId}.`;
        return true;
      }
      this.openValueEntry(unitId, mode, '', true);
      return true;
    }
    this.valueAction = { unitId, mode, value: current };
    return true;
  }

  private openValueEntry(unitId: number, mode: EditableChipMode, draft: string, fresh: boolean): void {
    this.valueEntry = { unitId, mode, draft, error: '', hint: this.fieldHint(mode), fresh };
  }

  private editableChipMode(): EditableChipMode | null {
    switch (this.chipDisplayMode) {
      case 'battalionGroup':
      case 'startAttack':
      case 'order':
      case 'additionalOrder':
      case 'formation':
      case 'altCondition':
      case 'altOrder':
      case 'altAdditionalOrder':
      case 'altFormation':
        return this.chipDisplayMode;
      default:
        return null;
    }
  }

  private fieldValue(unitId: number, mode: EditableChipMode): number | null {
    const orderRow = this.orderRowFor(unitId);
    if (!orderRow) {
      return null;
    }
    switch (mode) {
      case 'battalionGroup':
        return orderRow.battalionGroup;
      case 'startAttack':
        return orderRow.primary.startAttack;
      case 'order':
        return orderRow.primary.order;
      case 'additionalOrder':
        return orderRow.primary.additionalOrder;
      case 'formation':
        return orderRow.primary.formation;
      case 'altCondition':
        return orderRow.alternative.condition;
      case 'altOrder':
        return orderRow.alternative.order;
      case 'altAdditionalOrder':
        return orderRow.alternative.additionalOrder;
      case 'altFormation':
        return orderRow.alternative.formation;
    }
  }

  private writeField(unitId: number, mode: EditableChipMode, value: number | null, save = true): void {
    const orderRow = this.ensureOrderRow(unitId);
    switch (mode) {
      case 'battalionGroup':
        orderRow.battalionGroup = value;
        break;
      case 'startAttack':
        orderRow.primary.startAttack = value;
        break;
      case 'order':
        orderRow.primary.order = value;
        break;
      case 'additionalOrder':
        orderRow.primary.additionalOrder = value;
        break;
      case 'formation':
        orderRow.primary.formation = value;
        break;
      case 'altCondition':
        orderRow.alternative.condition = value;
        break;
      case 'altOrder':
        orderRow.alternative.order = value;
        break;
      case 'altAdditionalOrder':
        orderRow.alternative.additionalOrder = value;
        break;
      case 'altFormation':
        orderRow.alternative.formation = value;
        break;
    }
    if (save) {
      this.autoSaveDraft();
    }
  }

  private ensureOrderRow(unitId: number): FederationOrder {
    const existing = this.orderRowFor(unitId);
    if (existing) {
      return existing;
    }
    const blank = { x: null, y: null };
    const orderRow: FederationOrder = {
      federation: unitId,
      battalionGroup: null,
      start: { ...blank },
      primary: {
        startAttack: null,
        order: null,
        additionalOrder: null,
        formation: null,
        destination1: { ...blank },
        destination2: { ...blank },
      },
      alternative: {
        condition: null,
        order: null,
        additionalOrder: null,
        formation: null,
        destination1: { ...blank },
        destination2: { ...blank },
      },
    };
    this.federationOrders.set(unitId, orderRow);
    return orderRow;
  }

  private parseFieldInput(mode: EditableChipMode, raw: string): number | null {
    const text = raw.trim();
    if (mode === 'formation' || mode === 'altFormation') {
      for (const [code, name] of this.formationByCode) {
        if (name.toLowerCase() === text.toLowerCase()) {
          return code;
        }
      }
    }
    if (!/^\d+$/.test(text)) {
      return null;
    }
    return Number(text);
  }

  private fieldValueAllowed(mode: EditableChipMode, value: number): boolean {
    switch (mode) {
      case 'battalionGroup':
        return value >= 0 && value <= 110;
      case 'startAttack':
        return value >= 0 && value <= 25;
      case 'order':
      case 'altOrder':
        return this.orderCodes.has(value);
      case 'additionalOrder':
      case 'altAdditionalOrder':
        return this.additionalOrderCodes.has(value);
      case 'formation':
      case 'altFormation':
        return this.formationCodes.has(value);
      case 'altCondition':
        return this.conditionCodes.has(value);
    }
  }

  protected fieldLabel(mode: EditableChipMode): string {
    return this.chipDisplayModes.find((item) => item.value === mode)?.label ?? mode;
  }

  private fieldHint(mode: EditableChipMode): string {
    switch (mode) {
      case 'battalionGroup':
        return 'Enter a battalion group from 0 to 110.';
      case 'startAttack':
        return 'Enter a start-attack round from 0 to 25.';
      case 'order':
      case 'altOrder':
        return 'Enter an order code, such as 11, 21, or 41.';
      case 'additionalOrder':
      case 'altAdditionalOrder':
        return 'Enter an additional-order code, such as 0 or 1.';
      case 'formation':
      case 'altFormation':
        return 'Enter 0, 1 (Co), 2 (Li), 3 (Sk), or 4 (Sq).';
      case 'altCondition':
        return 'Enter a round from 1 to 25, or a condition code such as 30 or 41.';
    }
  }

  private fieldInvalidMessage(mode: EditableChipMode): string {
    switch (mode) {
      case 'battalionGroup':
        return 'Enter a whole number from 0 to 110.';
      case 'startAttack':
        return 'Enter a whole number from 0 to 25.';
      case 'order':
      case 'altOrder':
        return 'That is not a valid order code.';
      case 'additionalOrder':
      case 'altAdditionalOrder':
        return 'That is not a valid additional-order code.';
      case 'formation':
      case 'altFormation':
        return 'Enter 0, 1, 2, 3, 4, or Co, Li, Sk, Sq.';
      case 'altCondition':
        return 'That is not a valid condition.';
    }
  }

  private displayFieldValue(mode: EditableChipMode, value: number): string {
    if (mode === 'formation' || mode === 'altFormation') {
      return this.displayFormation(value);
    }
    return String(value);
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
    const usedFedNos = new Set<number>();
    this.placements = new Map<number, Coordinate>();
    this.sheetFedNo = new Map<number, number>();
    let skipped = 0;
    const orderBySheetNo = new Map(setup.federationOrders.map((orderRow) => [orderRow.federation, orderRow]));

    for (const placement of setup.placements) {
      const orderRow = orderBySheetNo.get(placement.id);
      const unitId = this.unitIdForSheetRow(placement.id, orderRow?.battalionGroup ?? null);
      const onMap =
        placement.x >= 1 && placement.x <= this.mapWidth && placement.y >= 1 && placement.y <= this.mapHeight;
      const key = this.coordKey(placement.x, placement.y);
      const fedNoFree = placement.id >= 1 && placement.id <= 110 && !usedFedNos.has(placement.id);
      if (unitId === null || !onMap || occupied.has(key) || !fedNoFree || this.placements.has(unitId)) {
        skipped += 1;
        continue;
      }
      this.placements.set(unitId, { x: placement.x, y: placement.y });
      this.sheetFedNo.set(unitId, placement.id);
      usedFedNos.add(placement.id);
      occupied.add(key);
    }

    this.federationOrders = new Map<number, FederationOrder>();
    setup.federationOrders.forEach((orderRow) => {
      const unitId = this.unitIdForSheetRow(orderRow.federation, orderRow.battalionGroup);
      if (unitId === null || !this.placements.has(unitId)) {
        return;
      }
      const stored = this.normalizeFederationOrder(orderRow);
      stored.federation = unitId;
      if (stored.battalionGroup === null) {
        stored.battalionGroup = unitId;
      }
      this.federationOrders.set(unitId, stored);
    });
    this.ensureSheetNumbersForPlaced();

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
    this.sheetFedNo.clear();
    this.highlightedFederationId = null;
    this.rebuildOccupancyMaps();
    this.statusMessage = 'All federations moved back to tray and their orders were cleared.';
    this.autoSaveDraft();
  }

  private returnToPool(unitId: number): void {
    if (!unitId || !this.placements.has(unitId)) {
      return;
    }
    const fedNo = this.sheetFedNo.get(unitId);
    this.releaseFederation(unitId);
    this.rebuildOccupancyMaps();
    this.statusMessage = fedNo
      ? `Federation ${unitId} moved back to tray. Fed No ${fedNo} was cleared.`
      : `Federation ${unitId} moved back to tray.`;
    this.autoSaveDraft();
  }

  private fedNoLabel(unitId: number): string {
    const fedNo = this.sheetFedNo.get(unitId);
    return fedNo ? String(fedNo) : '';
  }

  private nextSheetFedNo(): number | null {
    const used = new Set(this.sheetFedNo.values());
    const limit = Math.min(110, this.getPlacementLimit() ?? 110);
    for (let fedNo = 1; fedNo <= limit; fedNo += 1) {
      if (!used.has(fedNo)) {
        return fedNo;
      }
    }
    return null;
  }

  private assignSheetFedNo(unitId: number): number | null {
    const existing = this.sheetFedNo.get(unitId);
    if (existing) {
      return existing;
    }
    const fedNo = this.nextSheetFedNo();
    if (fedNo === null) {
      return null;
    }
    this.sheetFedNo.set(unitId, fedNo);
    this.ensureOrderRow(unitId).battalionGroup = unitId;
    return fedNo;
  }

  private ensureSheetNumbersForPlaced(): void {
    const placedIds = [...this.placements.keys()].sort((left, right) => left - right);
    for (const unitId of placedIds) {
      if (!this.sheetFedNo.has(unitId)) {
        const fedNo = this.nextSheetFedNo();
        if (fedNo === null) {
          break;
        }
        this.sheetFedNo.set(unitId, fedNo);
      }
      const orderRow = this.ensureOrderRow(unitId);
      if (orderRow.battalionGroup === null) {
        orderRow.battalionGroup = unitId;
      }
    }
  }

  private releaseFederation(unitId: number): void {
    this.placements.delete(unitId);
    this.federationOrders.delete(unitId);
    this.sheetFedNo.delete(unitId);
    this.chipPositionOverride.delete(unitId);
  }

  private unitIdForSheetRow(sheetNo: number, battalionGroup: number | null): number | null {
    const units = this.selectedArmy?.units ?? [];
    if (battalionGroup !== null && units.some((unit) => unit.id === battalionGroup)) {
      return battalionGroup;
    }
    if (units.some((unit) => unit.id === sheetNo)) {
      return sheetNo;
    }
    return null;
  }

  private sheetExportMaps(): { placements: Map<number, Coordinate>; orders: Map<number, FederationOrder> } {
    const placements = new Map<number, Coordinate>();
    const orders = new Map<number, FederationOrder>();
    this.placements.forEach((coord, unitId) => {
      const fedNo = this.sheetFedNo.get(unitId);
      if (!fedNo) {
        return;
      }
      placements.set(fedNo, coord);
      const orderRow = this.orderRowFor(unitId);
      if (!orderRow) {
        return;
      }
      orders.set(fedNo, { ...this.normalizeFederationOrder(orderRow), federation: fedNo });
    });
    return { placements, orders };
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

    let replacedId: number | null = null;
    if (occupant) {
      if (source) {
        this.placements.set(occupant.id, source);
        this.syncSetupCoordinate(occupant.id, source);
        this.statusMessage = `Swapped federation ${unitId} with ${occupant.id}.`;
      } else {
        replacedId = occupant.id;
        this.releaseFederation(occupant.id);
      }
    }

    const fedNo = this.assignSheetFedNo(unitId);
    if (fedNo === null) {
      this.statusMessage = 'Drop rejected: no free federation number.';
      return;
    }
    if (replacedId !== null) {
      this.statusMessage = `Replaced federation ${replacedId} with ${unitId} as Fed No ${fedNo}.`;
    } else if (!occupant) {
      this.statusMessage = `Placed federation ${unitId} as Fed No ${fedNo} at ${x}/${y}.`;
    }

    this.placements.set(unitId, { x, y });
    this.syncSetupCoordinate(unitId, { x, y });
    this.chipPositionOverride.delete(unitId);
    this.selectFederation(unitId, 'own');
    this.armNextUnplaced(unitId);
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
  }

  private placeDestination1(x: number, y: number): void {
    const unitId = this.highlightedFederationId;
    if (
      unitId === null ||
      this.highlightedFederationKind !== 'own' ||
      !this.selectedArmy?.units.some((unit) => unit.id === unitId)
    ) {
      this.statusMessage = 'Select a federation, then click the battlefield to set destination 1.';
      return;
    }
    if (!this.inSelectedSetup(x, y)) {
      this.statusMessage = this.setupAreaMessage();
      return;
    }
    const orderRow = this.ensureOrderRow(unitId);
    orderRow.primary.destination1 = { x, y };
    this.layoutRevision += 1;
    const next = this.nextBattlefieldFederation(unitId);
    if (next) {
      this.selectFederation(next.id, 'own');
      this.statusMessage = `Set destination 1 for federation ${unitId} to ${x}/${y}. Federation ${next.id} is next.`;
    } else {
      this.highlightedFederationId = null;
      this.statusMessage = `Set destination 1 for federation ${unitId} to ${x}/${y}.`;
    }
    this.autoSaveDraft();
  }

  private nextBattlefieldFederation(afterId: number): FederationUnit | undefined {
    return this.selectedArmy?.units
      .filter((unit) => unit.id > afterId && this.onBattlefieldInXy(unit.id))
      .sort((left, right) => left.id - right.id)[0];
  }

  private onBattlefieldInXy(unitId: number): boolean {
    const start = this.orderRowFor(unitId)?.start;
    if (start && this.onMap(start.x, start.y)) {
      return true;
    }
    const placed = this.placements.get(unitId);
    return !!placed && this.onMap(placed.x, placed.y);
  }

  private onMap(x: number | null, y: number | null): boolean {
    return x !== null && y !== null && x >= 1 && x <= this.mapWidth && y >= 1 && y <= this.mapHeight;
  }

  private armNextUnplaced(placedId: number): void {
    const unplaced = this.getUnplacedUnits().filter((unit) => unit.id !== placedId);
    if (!unplaced.length) {
      this.armedFederationId = null;
      return;
    }
    const next = unplaced.find((unit) => unit.id > placedId) ?? unplaced[0];
    this.armedFederationId = next?.id ?? null;
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
    const sheetFedNos: Record<number, number> = {};
    this.sheetFedNo.forEach((fedNo, unitId) => {
      sheetFedNos[unitId] = fedNo;
    });
    this.draft.save(gameId, sim, this.selectedArmySide, {
      header: this.header,
      placements: placementsRecord,
      fortressEntrenchments: this.keptFortressEntrenchments(),
      federationOrders: this.federationOrdersRecord(),
      sheetFedNos,
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
    this.sheetFedNo = new Map<number, number>();
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
    if (draft.sheetFedNos) {
      Object.entries(draft.sheetFedNos).forEach(([unitId, fedNo]) => {
        const id = Number(unitId);
        const number = Number(fedNo);
        if (this.placements.has(id) && number >= 1 && number <= 110) {
          this.sheetFedNo.set(id, number);
        }
      });
    }
    this.ensureSheetNumbersForPlaced();
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
      shadows.push('inset 3px 0 0 #000');
    }
    shadows.push('inset -3px 0 0 #000');
    if (!this.isSpecialCoordinate(cell.x, cell.y - 1)) {
      shadows.push('inset 0 3px 0 #000');
    }
    shadows.push('inset 0 -3px 0 #000');
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
    this.showFedEffectiveness = false;
    this.valueEntry = null;
    this.valueAction = null;
    this.valuePaint = null;
    if (this.parsedTurn.armies.length) {
      this.pickArmy(preferredArmySide, { restoreDraft: false, saveDraft: false });
      return;
    }
    this.statusMessage = `Turn parsed. Army ${preferredArmySide} selected.`;
  }

  private async storeTurnForBeta(
    fileName: string,
    turnText: string,
    parseError: string | null,
    gameId: string | null,
    simulationNumber: number | null,
    army: ArmySide | null,
  ): Promise<void> {
    const result = await this.betaData.createBattle({
      fileName,
      turnText,
      gameId,
      simulationNumber,
      army,
      parseError,
    });
    if (result.result === 'stored') {
      this.activeBattleId = result.id;
      return;
    }
    this.activeBattleId = null;
    if (result.result === 'failed') {
      this.betaStoreWarning = 'Beta copy could not be stored on the server.';
      this.changeDetector.markForCheck();
    }
  }

  private async storeSheetForBeta(fileName: string): Promise<void> {
    if (!this.activeBattleId) {
      return;
    }
    const workbook = this.excelExport.readSavedWorkbook(fileName);
    if (!workbook) {
      return;
    }
    const stored = await this.betaData.attachSheet(this.activeBattleId, fileName, workbook);
    if (stored === 'failed') {
      this.betaStoreWarning = 'SIM sheet download worked, but the beta copy could not be stored.';
    }
  }
}
