import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BattleHeader, FederationOrder } from './models/battle';
import { ReplayLaunch } from './models/replay';
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
import { ReplayHandoffService } from './services/replay-handoff.service';
import { ReplayParserService } from './services/replay-parser.service';
import { TurnParserService } from './services/turn-parser.service';
import { turnArchiveName } from './services/turn-archive-name';

type ChipLabelMode =
  | 'fedType'
  | 'fedNo'
  | 'battalionGroup'
  | 'startAttack'
  | 'order'
  | 'additionalOrder'
  | 'formation'
  | 'troopSpec'
  | 'altCondition'
  | 'altOrder'
  | 'altAdditionalOrder'
  | 'altFormation';

type EditableChipMode = Exclude<ChipLabelMode, 'fedType' | 'fedNo' | 'troopSpec'>;

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
    { value: 'troopSpec', label: 'Troop spec', short: 'TS', row: 1 },
    { value: 'destination1', label: 'Destination 1', short: 'D1', row: 1 },
    { value: 'destination2', label: 'Destination 2', short: 'D2', row: 1 },
    { value: 'altCondition', label: 'Alternative Condition', short: 'ACond', row: 2 },
    { value: 'altOrder', label: 'Alternative Order', short: 'AOrd', row: 2 },
    { value: 'altAdditionalOrder', label: 'Alternative Additional Order', short: 'AAdd', row: 2 },
    { value: 'altFormation', label: 'Alternative Formation', short: 'AForm', row: 2 },
    { value: 'altDestination1', label: 'Alternative Destination 1', short: 'AD1', row: 2 },
    { value: 'altDestination2', label: 'Alternative Destination 2', short: 'AD2', row: 2 },
  ] as const;
  protected readonly setupZones: Record<ArmySide, SetupZone> = {
    A: { minX: 11, maxX: 35, minY: 1, maxY: 10 },
    B: { minX: 11, maxX: 35, minY: 31, maxY: 40 },
  };
  protected readonly mapWidth = 45;
  protected readonly mapHeight = 40;
  protected parsedTurn: ParsedTurn | null = null;
  protected fileKindChoice = false;
  private loadedTurnText: string | null = null;
  private pendingTurnText: string | null = null;
  private pendingTurnName = '';
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
  protected chipModeMenu: { unitId: number } | null = null;
  protected coordinateClearMenu: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' | null = null;
  protected readonly chipSettingModes = this.chipDisplayModes.filter(
    (mode) =>
      mode.value !== 'fedType' &&
      mode.value !== 'fedNo' &&
      mode.value !== 'battalionGroup' &&
      mode.value !== 'xy' &&
      mode.value !== 'troopSpec' &&
      mode.value !== 'destination1' &&
      mode.value !== 'destination2' &&
      mode.value !== 'altDestination1' &&
      mode.value !== 'altDestination2',
  );
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
  private lastPlacedFederationId: number | null = null;
  private deployRangeAnchor: number | null = null;
  private deployGroup: number[] | null = null;
  private deployAreaAnchor: { x: number; y: number } | null = null;
  private deployAreaHover: { x: number; y: number } | null = null;
  private deployPointer: { x: number; y: number } | null = null;
  private sheetFedNo = new Map<number, number>();
  private layoutRevision = 0;
  private readonly chipPositionOverride = new Map<number, Coordinate>();
  private viewCoordinate: 'start' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' = 'start';
  private readonly heldPosition = new Map<number, Coordinate>();
  private turnLoadGeneration = 0;
  private chipIndexKey = '';
  private readonly chipsByCell = new Map<string, Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }>>();
  private readonly noChips: Array<{ unit: FederationUnit; kind: 'own' | 'enemy' }> = [];
  private lastDropAt = 0;
  private armedClickAt = 0;
  private lastPaletteDragAt = 0;
  private draggingUnitId: number | null = null;
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
    private readonly replayHandoff: ReplayHandoffService,
    private readonly replayParser: ReplayParserService,
  ) {
    const orders = this.rules.getSimBattleStore().orders;
    orders.formationOrders.forEach((item) => {
      this.formationByCode.set(item.code, item.formation);
      this.formationCodes.add(item.code);
    });
    for (const group of [orders.movementAttack, orders.pioneerOnly, orders.detachmentOrders, orders.swapDetachmentOrders]) {
      group.forEach((item) => this.orderCodes.add(item.code));
    }
    this.orderCodes.add(0);
    orders.additionalOrders.troopTypeFilters.forEach((item) => this.additionalOrderCodes.add(item.code));
    orders.additionalOrders.strategicPointSequence.forEach((item) => this.additionalOrderCodes.add(item.code));
    const rounds = orders.alternativeConditions.roundStartRange;
    for (let round = rounds.min; round <= rounds.max; round += 1) {
      this.conditionCodes.add(round);
    }
    orders.alternativeConditions.headcountDropBelowCodes.forEach((item) => this.conditionCodes.add(item.code));
    orders.alternativeConditions.other.forEach((item) => this.conditionCodes.add(item.code));
    const freshSetup = this.replayHandoff.freshSetup;
    this.replayHandoff.freshSetup = null;
    if (freshSetup) {
      void this.loadSetupFile(freshSetup.text, freshSetup.fileName);
    } else if (this.replayHandoff.turnText) {
      try {
        this.parseTurnText(this.replayHandoff.turnText);
      } catch {
        this.parseError = 'The setup turn could not be restored.';
      }
    }
  }

  protected async onTurnFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.loading = true;
    this.parseError = '';
    this.exportError = '';
    this.statusMessage = '';
    this.betaStoreWarning = '';
    this.changeDetector.markForCheck();

    try {
      const text = await file.text();
      const kinds = this.turnFileKinds(text);
      if (kinds.setup && kinds.results) {
        this.pendingTurnText = text;
        this.pendingTurnName = file.name;
        this.fileKindChoice = true;
        return;
      }
      if (kinds.results) {
        await this.openResultsReplay(text, null, file.name);
        return;
      }
      if (!kinds.setup) {
        this.parseError = 'That file has neither a sim setup nor a sim result.';
        return;
      }
      await this.loadSetupFile(text, file.name);
    } catch (error) {
      this.parseError = error instanceof Error ? error.message : 'Unable to parse this turn file.';
      this.parsedTurn = null;
      this.rows = [];
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected chooseBattleField(): void {
    const text = this.pendingTurnText;
    const fileName = this.pendingTurnName;
    this.clearFileKindChoice();
    if (!text) {
      return;
    }
    void this.loadSetupFile(text, fileName);
  }

  protected chooseBattleResults(): void {
    const text = this.pendingTurnText;
    const fileName = this.pendingTurnName;
    this.clearFileKindChoice();
    if (!text) {
      return;
    }
    void this.openResultsReplay(text, text, fileName);
  }

  protected cancelFileKindChoice(): void {
    this.clearFileKindChoice();
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
    this.heldPosition.clear();
    this.highlightedFederationId = null;
    this.clearDeploySelection();
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
    if (event.shiftKey) {
      event.preventDefault();
      return;
    }
    this.draggingUnitId = unitId;
    event.dataTransfer?.setData('text/plain', String(unitId));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  protected onUnitDragEnd(): void {
    this.draggingUnitId = null;
    this.lastPaletteDragAt = performance.now();
  }

  protected onPaletteUnitClick(event: MouseEvent, unitId: number): void {
    if (event.shiftKey) {
      this.shiftSelectDeployUnit(unitId);
      return;
    }
    if (performance.now() - this.lastPaletteDragAt < 400) {
      return;
    }
    this.clearDeploySelection();
    if (this.beginValueEdit(unitId, event.detail)) {
      return;
    }
    this.selectFederation(unitId, 'own');
    this.armedFederationId = unitId;
  }

  protected inDeployGroup(unitId: number): boolean {
    return this.deployRangeAnchor === unitId || (this.deployGroup?.includes(unitId) ?? false);
  }

  protected isNextDeploy(unitId: number): boolean {
    return this.nextDeployUnitId() === unitId;
  }

  protected isLastPlaced(unitId: number): boolean {
    return this.lastPlacedFederationId === unitId;
  }

  private nextDeployUnitId(): number | null {
    if (this.deployGroup?.length) {
      return this.deployGroup[0];
    }
    if (this.deployRangeAnchor !== null) {
      return this.deployRangeAnchor;
    }
    const armed = this.armedFederationId;
    if (armed !== null && this.getUnplacedUnits().some((unit) => unit.id === armed)) {
      return armed;
    }
    const highlighted = this.highlightedFederationKind === 'own' ? this.highlightedFederationId : null;
    if (highlighted !== null && this.getUnplacedUnits().some((unit) => unit.id === highlighted)) {
      return highlighted;
    }
    return null;
  }

  protected onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void {
    event.stopPropagation();
    if (this.deployGroup?.length) {
      const coord = this.coordinateOfChip(unitId, kind);
      if (coord) {
        this.onDeployAreaClick(event, coord.x, coord.y);
      } else {
        this.clearDeploySelection();
        this.statusMessage = 'Selection cleared.';
      }
      return;
    }
    if (this.deployRangeAnchor !== null) {
      this.deployRangeAnchor = null;
    }
    if (kind === 'own' && event.detail >= 2) {
      this.closeUnitMenus();
      this.returnToPool(unitId);
      return;
    }
    if (kind === 'own' && this.beginValueEdit(unitId, event.detail)) {
      return;
    }
    this.selectFederation(unitId, kind);
    if (kind === 'own') {
      this.armedFederationId = unitId;
    }
  }

  protected chooseChipModeMenu(mode: (typeof this.chipDisplayModes)[number]['value']): void {
    const unitId = this.chipModeMenu?.unitId;
    this.chipModeMenu = null;
    if (!unitId) {
      return;
    }
    this.selectChipMode(mode);
    this.selectFederation(unitId, 'own');
    this.armedFederationId = unitId;
    this.beginValueEdit(unitId, 1);
  }

  private openChipModeMenu(unitId: number): void {
    this.valueEntry = null;
    this.valueAction = null;
    this.selectFederation(unitId, 'own');
    this.armedFederationId = unitId;
    this.chipModeMenu = { unitId };
  }

  private closeUnitMenus(): void {
    this.valueEntry = null;
    this.valueAction = null;
    this.chipModeMenu = null;
    this.coordinateClearMenu = null;
  }

  protected onCoordinateModeContextMenu(
    event: MouseEvent,
    mode: (typeof this.chipDisplayModes)[number]['value'],
  ): void {
    if (mode !== 'xy' && !this.isDestinationMode(mode)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.closeUnitMenus();
    this.coordinateClearMenu = mode;
  }

  protected clearCoordinateMenuValue(): void {
    const mode = this.coordinateClearMenu;
    this.coordinateClearMenu = null;
    if (!mode) {
      return;
    }
    const id = this.highlightedFederationId;
    if (id === null || this.highlightedFederationKind !== 'own') {
      this.statusMessage = `Select a federation before clearing ${this.coordinateLabel(mode)}.`;
      return;
    }
    this.writeCoordinate(id, mode, null);
    this.statusMessage = `Cleared ${this.coordinateLabel(mode)} on federation ${id}.`;
  }

  protected onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void {
    event.preventDefault();
    event.stopPropagation();
    if (kind !== 'own') {
      return;
    }
    this.openChipModeMenu(unitId);
  }

  protected boardRemovalLabel(): string | null {
    const unitId = this.chipModeMenu?.unitId;
    if (!unitId || !this.placements.has(unitId)) {
      return null;
    }
    return this.sitsOnStart(unitId)
      ? 'Remove federation from board'
      : 'Remove federation from current Destination x/y';
  }

  protected removeFederationFromMenu(): void {
    const unitId = this.chipModeMenu?.unitId;
    const onStart = unitId ? this.sitsOnStart(unitId) : true;
    this.chipModeMenu = null;
    if (!unitId || !this.placements.has(unitId)) {
      return;
    }
    if (onStart) {
      this.returnToPool(unitId);
      return;
    }
    if (!this.isDestinationMode(this.chipDisplayMode)) {
      return;
    }
    this.writeCoordinate(unitId, this.chipDisplayMode, null);
    this.statusMessage = `Cleared ${this.coordinateLabel(this.chipDisplayMode)} on federation ${unitId}.`;
  }

  private sitsOnStart(unitId: number): boolean {
    const unit = this.federationUnit(unitId, 'own');
    const placed = this.placements.get(unitId);
    if (!unit || !placed) {
      return true;
    }
    const displayed = this.displayedOwnCoordinate(unit);
    const start = this.orderCoordinate(unit, 'start') ?? placed;
    if (!displayed) {
      return true;
    }
    return displayed.x === start.x && displayed.y === start.y;
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
    if (mode === 'troopSpec') {
      return this.troopSpecLabel(unit);
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
      if ((mode === 'formation' || mode === 'altFormation') && this.columnFormationOnly(unit)) {
        return 'Co';
      }
      if (mode === 'formation') {
        return 'Co';
      }
      if (mode === 'order') {
        return '0';
      }
      return '';
    }
    switch (mode) {
      case 'battalionGroup':
        return this.displayNumber(row.battalionGroup);
      case 'startAttack':
        return this.displayNumber(row.primary.startAttack);
      case 'order':
        return this.displayNumber(row.primary.order ?? 0);
      case 'additionalOrder':
        return this.displayNumber(row.primary.additionalOrder);
      case 'formation':
        return this.shownFormation(unit, row.primary.formation ?? 1);
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
        return this.shownFormation(unit, row.alternative.formation);
      case 'altDestination1':
        return this.formatCoordinate(row.alternative.destination1);
      case 'altDestination2':
        return this.formatCoordinate(row.alternative.destination2);
      default:
        return '';
    }
  }

  protected selectedModeEditable(mode: (typeof this.chipDisplayModes)[number]['value']): boolean {
    return this.highlightedFederationKind === 'own' && this.highlightedFederationId !== null && mode !== 'fedType' && mode !== 'fedNo' && mode !== 'troopSpec';
  }

  protected commitSelectedModeValue(mode: (typeof this.chipDisplayModes)[number]['value'], event: Event): void {
    const input = event.target as HTMLInputElement;
    const id = this.highlightedFederationId;
    if (id === null || this.highlightedFederationKind !== 'own' || mode === 'fedType' || mode === 'fedNo' || mode === 'troopSpec') {
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
      if (!coord || (mode === 'xy' && !this.inSelectedSetup(coord.x, coord.y))) {
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

  protected coordinateLabel(mode: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2'): string {
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
      this.heldPosition.delete(unitId);
    }
    this.layoutRevision += 1;
    this.autoSaveDraft();
  }

  protected keepShiftClickFromSelectingText(event: MouseEvent): void {
    if (!event.shiftKey) {
      return;
    }
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
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
    const unitId = this.droppedUnitId(event);
    if (!unitId) {
      return;
    }
    const placed = this.placements.has(unitId);
    if (this.isDestinationMode(this.chipDisplayMode)) {
      if (this.setDestination(unitId, this.chipDisplayMode, x, y)) {
        this.selectFederation(unitId, 'own');
        this.armedFederationId = unitId;
        this.statusMessage = `Set ${this.coordinateLabel(this.chipDisplayMode)} for federation ${unitId} to ${x}/${y}.`;
      }
      if (!placed && this.inSelectedSetup(x, y)) {
        this.placeFederation(unitId, x, y);
      }
      return;
    }
    if (!placed || this.chipDisplayMode === 'xy') {
      this.placeFederation(unitId, x, y);
    }
  }

  private droppedUnitId(event: DragEvent): number {
    const fromEvent = Number(event.dataTransfer?.getData('text/plain') ?? '');
    if (fromEvent) {
      return fromEvent;
    }
    return this.draggingUnitId ?? 0;
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
    if (this.deployGroup?.length) {
      this.onDeployAreaClick(event, x, y);
      return;
    }
    if (this.deployRangeAnchor !== null) {
      this.deployRangeAnchor = null;
    }
    if (this.isDestinationMode(this.chipDisplayMode) && !(this.armedUnitNeedsPlacement() && this.inSelectedSetup(x, y))) {
      this.placeDestination(this.chipDisplayMode, x, y);
      return;
    }
    const own = this.ownSetupUnitAt(x, y);
    if (event.detail >= 2 && own) {
      this.closeUnitMenus();
      if (performance.now() - this.armedClickAt > 500) {
        this.returnToPool(own.id);
      }
      return;
    }
    if (!this.coordinateMoveEnabled() && !this.armedUnitNeedsPlacement()) {
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
    const own = this.ownSetupUnitAt(x, y);
    if (!own) {
      return;
    }
    this.openChipModeMenu(own.id);
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

  protected getAvailableCount(): number {
    return this.selectedArmy?.units.length ?? 0;
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

  private clearFileKindChoice(): void {
    this.fileKindChoice = false;
    this.pendingTurnText = null;
    this.pendingTurnName = '';
  }

  private turnFileKinds(text: string): { setup: boolean; results: boolean } {
    return {
      setup: /The Battle field/i.test(text),
      results: /Simulated battle No\.\s*\d+\s+Initial Deployment/i.test(text),
    };
  }

  private async loadSetupFile(text: string, fileName: string): Promise<void> {
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
      const storedName = turnArchiveName(text, 'Setup') ?? fileName;
      await this.storeTurnForBeta(storedName, text, parseError, gameId, simulationNumber, army);
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
        this.changeDetector.markForCheck();
      }
    }
  }

  private async openResultsReplay(text: string, setupText: string | null, fileName = 'battle.txt'): Promise<void> {
    const storedName = turnArchiveName(text, 'Battle') ?? fileName;
    await this.storeTurnForBeta(storedName, text, null, null, null, null);
    let battles;
    try {
      battles = this.replayParser.parse(text);
    } catch {
      this.parseError = 'That results file could not be read.';
      this.changeDetector.markForCheck();
      return;
    }
    if (!battles.length) {
      this.parseError = 'No simulated battle was found in that file.';
      this.changeDetector.markForCheck();
      return;
    }

    this.replayHandoff.resultsText = text;
    const setup = setupText ? this.readSetupLaunch(setupText) : null;
    if (setup) {
      this.replayHandoff.turnText = setupText;
      this.replayHandoff.launch = setup;
    } else {
      this.replayHandoff.turnText = this.loadedTurnText;
      this.replayHandoff.launch = {
        mode: 'different',
        simNumber: null,
        label: null,
        mapCells: null,
        strategicPoints: [],
      };
    }
    await this.router.navigate(['/replay']);
  }

  private readSetupLaunch(text: string): ReplayLaunch | null {
    try {
      const turn = this.parser.parse(text);
      const brief = turn.battleBrief;
      return {
        mode: 'this',
        simNumber: turn.simNumber,
        label: `${turn.header.state ?? 'Sim'} ${turn.simNumber}`,
        mapCells: turn.mapCells.map((cell) => ({ ...cell })),
        strategicPoints: [...brief.deploymentAreaA.strategicPoints, ...brief.deploymentAreaB.strategicPoints].map((point) => ({
          ...point,
        })),
      };
    } catch {
      return null;
    }
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

  protected async onSimFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.missingSimWarning = null;
    this.loadingSim = true;
    this.exportError = '';
    this.changeDetector.markForCheck();
    try {
      const setup = await this.excelExport.readSetup(await file.arrayBuffer());
      this.applySimSheet(setup, file.name);
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
    const buffer = await this.fetchWorkbook(fileName);
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
    return this.coordinateMoveEnabled() && this.isOwnUnit(unit);
  }

  protected chipHighlight(unitId: number, kind: 'own' | 'enemy'): 'current' | 'next' | null {
    if (unitId === this.highlightedFederationId && kind === this.highlightedFederationKind) {
      return 'current';
    }
    if (kind === 'own' && unitId === this.nextHighlightedFederationId()) {
      return 'next';
    }
    return null;
  }

  private nextHighlightedFederationId(): number | null {
    const current = this.highlightedFederationKind === 'own' ? this.highlightedFederationId : null;
    if (current === null) {
      return null;
    }
    if (this.valuePaint) {
      return this.nextEmptyForPaint(current);
    }
    if (this.isDestinationMode(this.chipDisplayMode)) {
      return this.nextBattlefieldFederation(current)?.id ?? null;
    }
    if (this.deployGroup?.length) {
      return null;
    }
    if (this.armedFederationId !== null && this.armedFederationId !== current) {
      return this.armedFederationId;
    }
    const unplaced = this.getUnplacedUnits();
    const next = unplaced.find((unit) => unit.id > current) ?? unplaced[0];
    return next && next.id !== current ? next.id : null;
  }

  private nextEmptyForPaint(afterId: number): number | null {
    const mode = this.valuePaint?.mode;
    const units = this.selectedArmy?.units;
    if (!mode || !units?.length) {
      return null;
    }
    const ordered = [...units.filter((unit) => unit.id > afterId), ...units.filter((unit) => unit.id < afterId)];
    return ordered.find((unit) => this.fieldValue(unit.id, mode) === null)?.id ?? null;
  }

  private coordinateMoveEnabled(): boolean {
    return this.chipDisplayMode === 'xy' || this.isDestinationMode(this.chipDisplayMode);
  }

  private armedUnitNeedsPlacement(): boolean {
    const unitId = this.armedFederationId;
    return unitId !== null && !this.placements.has(unitId);
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

  private positionSource(): 'start' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' {
    return this.viewCoordinate;
  }

  private coordinateView(
    mode: (typeof this.chipDisplayModes)[number]['value'],
  ): 'start' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' | null {
    if (mode === 'xy') {
      return 'start';
    }
    return this.isDestinationMode(mode) ? mode : null;
  }

  private rememberShownPositions(): void {
    for (const unit of this.selectedArmy?.units ?? []) {
      const coord = this.displayedOwnCoordinate(unit);
      if (coord) {
        this.heldPosition.set(unit.id, { x: coord.x, y: coord.y });
      }
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

  private displayedOwnCoordinate(unit: FederationUnit): Coordinate | null {
    const override = this.chipPositionOverride.get(unit.id);
    if (override) {
      return override;
    }
    const viewed =
      this.orderCoordinate(unit, this.viewCoordinate) ??
      (this.viewCoordinate === 'start' ? (this.placements.get(unit.id) ?? null) : null);
    if (viewed) {
      return viewed;
    }
    const held = this.heldPosition.get(unit.id);
    if (held) {
      return held;
    }
    if (this.viewCoordinate === 'start') {
      return null;
    }
    const placed = this.placements.get(unit.id);
    if (!placed) {
      return null;
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
    return [this.specialBorderShadow(cell), this.deployBoxShadow(cell.x, cell.y)].filter(Boolean).join(', ');
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
    if (mode === 'troopSpec') {
      return [...(this.selectedArmy?.units ?? []), ...(this.enemyArmy?.units ?? [])].some((unit) => this.troopSpecLabel(unit) !== '');
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
    const nextView = this.coordinateView(mode);
    if (nextView && nextView !== this.viewCoordinate) {
      this.rememberShownPositions();
      this.viewCoordinate = nextView;
      this.layoutRevision += 1;
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
    if (this.chipLabelMode === 'troopSpec') {
      return this.troopSpecLabel(unit);
    }
    if (!this.isOwnUnit(unit) || this.chipLabelMode === 'fedType') {
      return this.fedTypeLabel(unit);
    }
    if (this.chipLabelMode === 'fedNo') {
      return this.fedNoLabel(unit.id);
    }
    if ((this.chipLabelMode === 'formation' || this.chipLabelMode === 'altFormation') && this.columnFormationOnly(unit)) {
      return 'Co';
    }
    const orderRow = this.orderRowFor(unit.id);
    if (!orderRow) {
      if (this.chipLabelMode === 'order') {
        return '0';
      }
      if (this.chipLabelMode === 'formation') {
        return 'Co';
      }
      return '';
    }
    switch (this.chipLabelMode) {
      case 'battalionGroup':
        return this.displayNumber(orderRow.battalionGroup);
      case 'startAttack':
        return this.displayNumber(orderRow.primary.startAttack);
      case 'order':
        return this.displayNumber(orderRow.primary.order ?? 0);
      case 'additionalOrder':
        return this.displayNumber(orderRow.primary.additionalOrder);
      case 'formation':
        return this.shownFormation(unit, orderRow.primary.formation ?? 1);
      case 'altCondition':
        return this.displayNumber(orderRow.alternative.condition);
      case 'altOrder':
        return this.displayNumber(orderRow.alternative.order);
      case 'altAdditionalOrder':
        return this.displayNumber(orderRow.alternative.additionalOrder);
      case 'altFormation':
        return this.shownFormation(unit, orderRow.alternative.formation);
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
    this.valueAction = { unitId: entry.unitId, mode: entry.mode, value: parsed, fresh: false };
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
        order: 0,
        additionalOrder: null,
        formation: 1,
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
    this.clearDeploySelection();
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
    if (this.lastPlacedFederationId === unitId) {
      this.lastPlacedFederationId = null;
    }
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
    this.heldPosition.delete(unitId);
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

  private placeFederation(unitId: number, x: number, y: number, quiet = false): boolean {
    const reject = (message: string): boolean => {
      this.statusMessage = message;
      return false;
    };
    if (!this.selectedArmySide || !this.selectedArmy) {
      return false;
    }
    if (!unitId || !this.selectedArmy.units.some((unit) => unit.id === unitId)) {
      return false;
    }

    if (!this.inZone({ x, y }, this.setupZones[this.selectedArmySide])) {
      return reject('Drop rejected: outside setup area.');
    }

    const fortressMessage = this.fortressPlacementRejection(unitId, x, y);
    if (fortressMessage?.includes('fortress wall')) {
      return reject(fortressMessage);
    }

    if (this.enemyHasCoord(x, y)) {
      return reject('Drop rejected: enemy federation occupies that coordinate.');
    }

    if (fortressMessage) {
      return reject(fortressMessage);
    }

    const source = this.placements.get(unitId) ?? null;
    const occupant = this.ownByCoord.get(this.coordKey(x, y));
    if (occupant && occupant.id === unitId) {
      return false;
    }

    const placementLimit = this.getPlacementLimit();
    if (!source && !occupant && placementLimit !== null && this.placements.size >= placementLimit) {
      return reject(`Drop rejected: deployment limit of ${placementLimit} reached.`);
    }

    let replacedId: number | null = null;
    if (occupant) {
      if (source) {
        this.placements.set(occupant.id, source);
        this.syncSetupCoordinate(occupant.id, source);
        if (!quiet) {
          this.statusMessage = `Swapped federation ${unitId} with ${occupant.id}.`;
        }
      } else {
        replacedId = occupant.id;
        this.releaseFederation(occupant.id);
      }
    }

    const fedNo = this.assignSheetFedNo(unitId);
    if (fedNo === null) {
      return reject('Drop rejected: no free federation number.');
    }
    if (!quiet && replacedId !== null) {
      this.statusMessage = `Replaced federation ${replacedId} with ${unitId} as Fed No ${fedNo}.`;
    } else if (!quiet && !occupant) {
      this.statusMessage = `Placed federation ${unitId} as Fed No ${fedNo} at ${x}/${y}.`;
    }

    this.placements.set(unitId, { x, y });
    this.syncSetupCoordinate(unitId, { x, y });
    this.chipPositionOverride.delete(unitId);
    this.lastPlacedFederationId = unitId;
    if (!quiet) {
      this.selectFederation(unitId, 'own');
      this.armNextUnplaced(unitId);
    }
    this.rebuildOccupancyMaps();
    this.autoSaveDraft();
    return true;
  }

  private shiftSelectDeployUnit(unitId: number): void {
    if (!this.getUnplacedUnits().some((unit) => unit.id === unitId)) {
      return;
    }
    const startId = this.nextDeployUnitId();
    this.clearDeployAreaMark();
    this.deployRangeAnchor = null;
    if (startId === null || startId === unitId) {
      this.deployGroup = null;
      this.selectFederation(unitId, 'own');
      this.armedFederationId = unitId;
      return;
    }
    const ids = this.unplacedIdsBetween(startId, unitId);
    this.deployGroup = ids;
    this.selectFederation(ids[0], 'own');
    this.armedFederationId = ids[0];
    this.statusMessage = `${ids.length} units selected, click the beginning of the area, then shift-click the other corner to deploy.`;
  }

  private unplacedIdsBetween(startId: number, endId: number): number[] {
    const low = Math.min(startId, endId);
    const high = Math.max(startId, endId);
    return this.getUnplacedUnits()
      .map((unit) => unit.id)
      .filter((id) => id >= low && id <= high)
      .sort((left, right) => left - right);
  }

  private onDeployAreaClick(event: MouseEvent, x: number, y: number): void {
    const group = this.deployGroup;
    if (!group?.length) {
      return;
    }
    if (!this.inSelectedSetup(x, y)) {
      const started = this.deployAreaAnchor !== null;
      this.clearDeploySelection();
      this.statusMessage = event.shiftKey && started
        ? 'Selection cleared. Both shift-clicks must be inside the deployment area.'
        : 'Selection cleared.';
      return;
    }
    if (!this.deployAreaAnchor) {
      this.deployAreaAnchor = { x, y };
      this.deployPointer = { x, y };
      this.deployAreaHover = event.shiftKey ? { x, y } : null;
      this.statusMessage = `${group.length} units selected, shift-click the other corner to deploy the group, or click to place the next federation.`;
      return;
    }
    if (!event.shiftKey) {
      const first = group[0];
      this.clearDeploySelection();
      this.selectFederation(first, 'own');
      this.armedFederationId = first;
      this.placeFederation(first, x, y);
      return;
    }
    const start = this.deployAreaAnchor;
    this.clearDeployAreaMark();
    this.placeDeployGroup(start, { x, y });
  }

  protected isDeployAnchor(x: number, y: number): boolean {
    return this.deployAreaAnchor?.x === x && this.deployAreaAnchor?.y === y;
  }

  protected inDeployPreview(x: number, y: number): boolean {
    const anchor = this.deployAreaAnchor;
    const hover = this.deployAreaHover;
    if (!anchor || !hover || !this.inSelectedSetup(x, y)) {
      return false;
    }
    const minX = Math.min(anchor.x, hover.x);
    const maxX = Math.max(anchor.x, hover.x);
    const minY = Math.min(anchor.y, hover.y);
    const maxY = Math.max(anchor.y, hover.y);
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  private deployBoxShadow(x: number, y: number): string {
    const anchor = this.deployAreaAnchor;
    if (!anchor || x < 1 || y < 1) {
      return '';
    }
    const end = this.deployAreaHover ?? anchor;
    const minX = Math.min(anchor.x, end.x);
    const maxX = Math.max(anchor.x, end.x);
    const minY = Math.min(anchor.y, end.y);
    const maxY = Math.max(anchor.y, end.y);
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return '';
    }
    const shadows: string[] = [];
    if (y === minY) {
      shadows.push('inset 0 3px 0 #fff');
    }
    if (y === maxY) {
      shadows.push('inset 0 -3px 0 #fff');
    }
    if (x === minX) {
      shadows.push('inset 3px 0 0 #fff');
    }
    if (x === maxX) {
      shadows.push('inset -3px 0 0 #fff');
    }
    return shadows.join(', ');
  }

  protected onDeployPreviewMove(event: MouseEvent, x: number, y: number): void {
    if (!this.deployGroup?.length || !this.deployAreaAnchor) {
      return;
    }
    if (!this.inSelectedSetup(x, y)) {
      this.setDeployPreview(null, event.shiftKey);
      return;
    }
    this.setDeployPreview({ x, y }, event.shiftKey);
  }

  protected onDeployPreviewLeave(): void {
    if (!this.deployAreaHover && !this.deployPointer) {
      return;
    }
    this.setDeployPreview(null, false);
  }

  @HostListener('document:keydown', ['$event'])
  @HostListener('document:keyup', ['$event'])
  protected onDeployPreviewKey(event: KeyboardEvent): void {
    if (event.key !== 'Shift' || !this.deployAreaAnchor || !this.deployGroup?.length) {
      return;
    }
    this.setDeployPreview(this.deployPointer, event.type === 'keydown');
  }

  private setDeployPreview(pointer: { x: number; y: number } | null, shift: boolean): void {
    const hover = shift && pointer ? pointer : null;
    if (this.sameCell(this.deployPointer, pointer) && this.sameCell(this.deployAreaHover, hover)) {
      return;
    }
    this.deployPointer = pointer;
    this.deployAreaHover = hover;
    this.changeDetector.markForCheck();
  }

  private sameCell(left: { x: number; y: number } | null, right: { x: number; y: number } | null): boolean {
    return left?.x === right?.x && left?.y === right?.y;
  }

  private clearDeployAreaMark(): void {
    this.deployAreaAnchor = null;
    this.deployAreaHover = null;
    this.deployPointer = null;
  }

  private placeDeployGroup(start: { x: number; y: number }, end: { x: number; y: number }): void {
    const group = this.deployGroup;
    if (!group?.length) {
      return;
    }
    let placed = 0;
    for (const cell of this.deploymentCells(start, end)) {
      if (!group.length) {
        break;
      }
      if (
        this.enemyHasCoord(cell.x, cell.y) ||
        this.ownByCoord.has(this.coordKey(cell.x, cell.y)) ||
        this.fortressPlacementRejection(group[0], cell.x, cell.y)
      ) {
        continue;
      }
      const unitId = group[0];
      if (!this.placeFederation(unitId, cell.x, cell.y, true)) {
        const reason = this.statusMessage || 'Could not place the next federation.';
        this.selectFederation(group[0], 'own');
        this.armedFederationId = group[0];
        this.statusMessage = `${reason} ${group.length} fed selected, click the beginning of the area, then shift-click the other corner to deploy.`;
        return;
      }
      group.shift();
      placed += 1;
    }
    if (!group.length) {
      this.clearDeploySelection();
      this.armedFederationId = null;
      this.statusMessage = `Placed ${placed} federations.`;
      return;
    }
    this.selectFederation(group[0], 'own');
    this.armedFederationId = group[0];
    this.statusMessage = placed
      ? `${group.length} fed selected, click the beginning of the area, then shift-click the other corner to deploy.`
      : `No empty squares in that area. ${group.length} fed selected, click the beginning of the area, then shift-click the other corner to deploy.`;
  }

  private deploymentCells(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): Array<{ x: number; y: number }> {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.inSelectedSetup(x, y)) {
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  private coordinateOfChip(unitId: number, kind: 'own' | 'enemy'): { x: number; y: number } | null {
    if (kind === 'own') {
      return this.placements.get(unitId) ?? null;
    }
    return this.enemyArmy?.units.find((unit) => unit.id === unitId)?.start ?? null;
  }

  private clearDeploySelection(): void {
    this.deployRangeAnchor = null;
    this.deployGroup = null;
    this.clearDeployAreaMark();
  }

  private isDestinationMode(
    mode: (typeof this.chipDisplayModes)[number]['value'],
  ): mode is 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2' {
    return mode === 'destination1' || mode === 'destination2' || mode === 'altDestination1' || mode === 'altDestination2';
  }

  private placeDestination(mode: 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2', x: number, y: number): void {
    const unitId = this.highlightedFederationId;
    const label = this.coordinateLabel(mode);
    if (
      unitId === null ||
      this.highlightedFederationKind !== 'own' ||
      !this.setDestination(unitId, mode, x, y)
    ) {
      if (unitId === null || this.highlightedFederationKind !== 'own') {
        this.statusMessage = `Select a federation, then click the battlefield to set ${label}.`;
      }
      return;
    }
    const next = this.nextBattlefieldFederation(unitId);
    if (next) {
      this.selectFederation(next.id, 'own');
      this.statusMessage = `Set ${label} for federation ${unitId} to ${x}/${y}. Federation ${next.id} is next.`;
    } else {
      this.highlightedFederationId = null;
      this.statusMessage = `Set ${label} for federation ${unitId} to ${x}/${y}.`;
    }
  }

  private setDestination(
    unitId: number,
    mode: 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2',
    x: number,
    y: number,
  ): boolean {
    if (!this.selectedArmy?.units.some((unit) => unit.id === unitId)) {
      return false;
    }
    if (!this.onMap(x, y)) {
      this.statusMessage = 'Coordinate must be on the battlefield.';
      return false;
    }
    const orderRow = this.ensureOrderRow(unitId);
    if (mode === 'destination1') {
      orderRow.primary.destination1 = { x, y };
    } else if (mode === 'destination2') {
      orderRow.primary.destination2 = { x, y };
    } else if (mode === 'altDestination1') {
      orderRow.alternative.destination1 = { x, y };
    } else {
      orderRow.alternative.destination2 = { x, y };
    }
    this.chipPositionOverride.delete(unitId);
    this.layoutRevision += 1;
    this.autoSaveDraft();
    return true;
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

  private fortressRoleRows: MapCell[][] | null = null;
  private fortressRoleCache: Map<string, { role: 'wall' | 'interior'; zone: string }> | null = null;

  private fortressPlacementRejection(unitId: number, x: number, y: number): string | null {
    if (!this.parsedTurn?.battleBrief.fortress) {
      return null;
    }
    const role = this.fortressRoles().get(this.coordKey(x, y));
    if (!role || !this.fortressZoneHasInterior(role.zone)) {
      return null;
    }
    const occupant = this.ownByCoord.get(this.coordKey(x, y));
    const others = this.fortressHolders(role.zone).filter((holder) => !(holder.kind === 'own' && holder.id === unitId));
    if (others.length === 0) {
      return null;
    }
    if (others.length === 1 && occupant && others[0].kind === 'own' && others[0].id === occupant.id) {
      return null;
    }
    return 'Drop rejected: the fortress already holds a federation.';
  }

  private fortressZoneHasInterior(zone: string): boolean {
    let found = false;
    this.fortressRoles().forEach((role) => {
      if (role.zone === zone && role.role === 'interior') {
        found = true;
      }
    });
    return found;
  }

  private fortressHolders(zone: string): Array<{ id: number; kind: 'own' | 'enemy' }> {
    const holders: Array<{ id: number; kind: 'own' | 'enemy' }> = [];
    this.fortressRoles().forEach((role, key) => {
      if (role.zone !== zone) {
        return;
      }
      const own = this.ownByCoord.get(key);
      if (own) {
        holders.push({ id: own.id, kind: 'own' });
      }
      const enemy = this.enemyByCoord.get(key);
      if (enemy) {
        holders.push({ id: enemy.id, kind: 'enemy' });
      }
    });
    return holders;
  }

  private fortressRoles(): Map<string, { role: 'wall' | 'interior'; zone: string }> {
    if (this.fortressRoleCache && this.fortressRoleRows === this.rows) {
      return this.fortressRoleCache;
    }
    const roles = new Map<string, { role: 'wall' | 'interior'; zone: string }>();
    const seen = new Set<string>();
    for (const row of this.rows) {
      for (const cell of row) {
        const key = this.coordKey(cell.x, cell.y);
        if (!cell.token.startsWith('$') || seen.has(key)) {
          continue;
        }
        const walls = this.fortressWallsFrom(cell.x, cell.y, seen);
        const zone = walls.map((wall) => this.coordKey(wall.x, wall.y)).sort()[0] ?? key;
        for (const wall of walls) {
          roles.set(this.coordKey(wall.x, wall.y), { role: 'wall', zone });
        }
        for (const inside of this.fortressInterior(walls)) {
          roles.set(this.coordKey(inside.x, inside.y), { role: 'interior', zone });
        }
      }
    }
    this.fortressRoleRows = this.rows;
    this.fortressRoleCache = roles;
    return roles;
  }

  private fortressWallsFrom(x: number, y: number, seen: Set<string>): Array<{ x: number; y: number }> {
    const walls: Array<{ x: number; y: number }> = [];
    const pending = [{ x, y }];
    while (pending.length) {
      const current = pending.pop();
      if (!current || !this.isFortressSquare(current.x, current.y)) {
        continue;
      }
      const key = this.coordKey(current.x, current.y);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      walls.push(current);
      pending.push(
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
      );
    }
    return walls;
  }

  private fortressInterior(walls: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const blocked = new Set(walls.map((wall) => this.coordKey(wall.x, wall.y)));
    const minX = Math.min(...walls.map((wall) => wall.x));
    const maxX = Math.max(...walls.map((wall) => wall.x));
    const minY = Math.min(...walls.map((wall) => wall.y));
    const maxY = Math.max(...walls.map((wall) => wall.y));
    const reached = new Set<string>();
    const pending: Array<{ x: number; y: number }> = [];
    for (let y = minY - 1; y <= maxY + 1; y += 1) {
      for (let x = minX - 1; x <= maxX + 1; x += 1) {
        const outside = x < minX || x > maxX || y < minY || y > maxY;
        if (outside && this.onMap(x, y) && !blocked.has(this.coordKey(x, y))) {
          pending.push({ x, y });
        }
      }
    }
    while (pending.length) {
      const current = pending.pop();
      if (!current || !this.onMap(current.x, current.y)) {
        continue;
      }
      const key = this.coordKey(current.x, current.y);
      if (reached.has(key) || blocked.has(key)) {
        continue;
      }
      reached.add(key);
      pending.push(
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 },
      );
    }
    const interior: Array<{ x: number; y: number }> = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = this.coordKey(x, y);
        if (!blocked.has(key) && !reached.has(key)) {
          interior.push({ x, y });
        }
      }
    }
    return interior;
  }

  private isFortressSquare(x: number, y: number): boolean {
    return this.rows[y - 1]?.[x - 1]?.token.startsWith('$') ?? false;
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

  private shownFormation(unit: FederationUnit, value: number | null): string {
    if (this.columnFormationOnly(unit)) {
      return 'Co';
    }
    return this.displayFormation(value);
  }

  private columnFormationOnly(unit: FederationUnit): boolean {
    if (unit.troopCode.trim().toLowerCase() === 'pi') {
      return true;
    }
    const armyName = this.isOwnUnit(unit) ? this.selectedArmy?.name : this.enemyArmy?.name;
    return this.troopFamily(unit, armyName) === 'artillery';
  }

  private troopSpecLabel(unit: FederationUnit): string {
    const armyName = this.isOwnUnit(unit) ? this.selectedArmy?.name : this.enemyArmy?.name;
    return this.rules.getBattalionRuleByShortName(armyName, unit.troopCode)?.troopSpecs.join(' ') ?? '';
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
        order: this.coordValue(value.primary?.order ?? null) ?? 0,
        additionalOrder: this.coordValue(value.primary?.additionalOrder ?? null),
        formation: this.coordValue(value.primary?.formation ?? null) ?? 1,
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
    this.loadedTurnText = text;
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
    this.viewCoordinate = 'start';
    this.heldPosition.clear();
    this.showFedEffectiveness = false;
    this.valueEntry = null;
    this.valueAction = null;
    this.valuePaint = null;
    this.chipModeMenu = null;
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
