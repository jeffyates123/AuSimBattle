import { ChangeDetectorRef, Component, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { ReplayBattle, ReplayFrame, ReplayLaunch, ReplayUnit } from './models/replay';
import { ArmySide, MapCell, SetupZone } from './models/turn';
import { ReplayHandoffService } from './services/replay-handoff.service';
import { ReplayParserService } from './services/replay-parser.service';
import { RulesService } from './services/rules.service';
import { TurnParserService } from './services/turn-parser.service';

type ChipMode = 'fedNo' | 'fedType' | 'effectiveness' | 'order' | 'formation' | 'troopSpec';
type TroopFamily = 'infantry' | 'cavalry' | 'artillery';

@Component({
  selector: 'app-replay',
  templateUrl: './replay.html',
  styleUrls: ['./app.css', './replay.css'],
  encapsulation: ViewEncapsulation.None,
})
export class ReplayComponent implements OnDestroy {
  protected readonly columns = Array.from({ length: 45 }, (_, index) => index + 1);
  protected readonly setupZones: Record<ArmySide, SetupZone> = {
    A: { minX: 11, maxX: 35, minY: 1, maxY: 10 },
    B: { minX: 11, maxX: 35, minY: 31, maxY: 40 },
  };
  protected launch: ReplayLaunch | null = null;
  protected message = '';
  protected battle: ReplayBattle | null = null;
  protected battleChoices: ReplayBattle[] = [];
  protected frames: ReplayFrame[] = [];
  protected frameIndex = 0;
  protected playing = false;
  protected chipMode: ChipMode = 'fedNo';
  protected rows: MapCell[][] = [];
  protected loading = false;
  protected fileKindChoice = false;
  private readonly unitsByCell = new Map<string, ReplayUnit[]>();
  private readonly families = new Map<string, TroopFamily>();
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private strategicPoints: Array<{ x: number; y: number }> = [];
  private parsedBattles: ReplayBattle[] = [];
  private baseCells: MapCell[] = [];
  private knownHeights = false;
  private pendingTurnText: string | null = null;
  private pendingTurnName = '';

  constructor(
    private readonly handoff: ReplayHandoffService,
    private readonly parser: ReplayParserService,
    private readonly rules: RulesService,
    private readonly turnParser: TurnParserService,
    private readonly router: Router,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.launch = this.handoff.launch;
    this.handoff.launch = null;
    const resultsText = this.handoff.resultsText;
    this.handoff.resultsText = null;
    if (resultsText) {
      this.loadResultsText(resultsText);
      return;
    }
    this.message = 'Choose a file with a sim setup or a sim result.';
  }

  ngOnDestroy(): void {
    this.stopPlay();
  }

  protected async onTurnFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.loading = true;
    this.message = '';
    this.changeDetector.markForCheck();
    try {
      const text = await file.text();
      const setup = /The Battle field/i.test(text);
      const results = /Simulated battle No\.\s*\d+\s+Initial Deployment/i.test(text);
      if (setup && results) {
        this.pendingTurnText = text;
        this.pendingTurnName = file.name;
        this.fileKindChoice = true;
        return;
      }
      if (results) {
        this.showResults(text, null);
        return;
      }
      if (!setup) {
        this.message = 'That file has neither a sim setup nor a sim result.';
        return;
      }
      this.openSetup(text, file.name);
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'Unable to read that file.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  protected chooseBattleField(): void {
    const text = this.pendingTurnText;
    const fileName = this.pendingTurnName;
    this.clearFileKindChoice();
    if (text) {
      this.openSetup(text, fileName);
    }
  }

  protected chooseBattleResults(): void {
    const text = this.pendingTurnText;
    this.clearFileKindChoice();
    if (text) {
      this.showResults(text, text);
    }
  }

  protected cancelFileKindChoice(): void {
    this.clearFileKindChoice();
  }

  private clearFileKindChoice(): void {
    this.fileKindChoice = false;
    this.pendingTurnText = null;
    this.pendingTurnName = '';
  }

  private openSetup(text: string, fileName: string): void {
    this.handoff.freshSetup = { text, fileName };
    this.handoff.resultsText = null;
    void this.router.navigate(['/planner']);
  }

  private showResults(text: string, setupText: string | null): void {
    this.stopPlay();
    this.battle = null;
    this.battleChoices = [];
    this.frames = [];
    this.frameIndex = 0;
    this.unitsByCell.clear();
    const setup = setupText ? this.readSetupLaunch(setupText) : null;
    if (setup) {
      this.handoff.turnText = setupText;
      this.launch = setup;
    } else {
      this.launch = {
        mode: 'different',
        simNumber: null,
        label: null,
        mapCells: null,
        strategicPoints: [],
      };
    }
    this.loadResultsText(text);
    this.changeDetector.markForCheck();
  }

  private readSetupLaunch(text: string): ReplayLaunch | null {
    try {
      const turn = this.turnParser.parse(text);
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

  private loadResultsText(text: string): void {
    try {
      this.parsedBattles = this.parser.parse(text);
    } catch {
      this.message = 'That results file could not be read.';
      return;
    }
    if (!this.parsedBattles.length) {
      this.message = 'No simulated battle was found in that file.';
      return;
    }
    if (!this.launch) {
      this.launch = {
        mode: 'different',
        simNumber: null,
        label: null,
        mapCells: null,
        strategicPoints: [],
      };
    }
    this.message = '';
    if (this.launch.mode === 'this') {
      const match = this.parsedBattles.find((battle) => battle.battleNo === this.launch?.simNumber);
      if (match) {
        this.startBattle(match, true);
        return;
      }
    }
    if (this.parsedBattles.length > 1) {
      this.battleChoices = this.parsedBattles;
      return;
    }
    this.startBattle(this.parsedBattles[0], false);
  }

  protected chooseBattle(battleNo: number): void {
    const battle = this.parsedBattles.find((item) => item.battleNo === battleNo);
    this.battleChoices = [];
    if (battle) {
      this.startBattle(battle, false);
    }
  }

  protected frameLabel(): string {
    const frame = this.frames[this.frameIndex];
    if (!frame || frame.round === null) {
      return 'Initial deployment';
    }
    return `Round ${frame.round}`;
  }

  protected moraleLabel(): string {
    const morale = this.frames[this.frameIndex]?.morale;
    if (!morale) {
      return '';
    }
    return `Morale ${morale[0].letter}: ${morale[0].percent}%  ${morale[1].letter}: ${morale[1].percent}%`;
  }

  protected chipText(unit: ReplayUnit): string {
    if (this.chipMode === 'fedType') {
      return unit.troopCode;
    }
    if (this.chipMode === 'effectiveness') {
      return unit.effectiveness === null ? '' : unit.effectiveness.toFixed(1);
    }
    if (this.chipMode === 'order') {
      return String(unit.order);
    }
    if (this.chipMode === 'formation') {
      return this.formationLabel(unit);
    }
    if (this.chipMode === 'troopSpec') {
      return this.battalionRule(unit)?.troopSpecs.join(' ') ?? '';
    }
    return String(unit.id);
  }

  protected unitsAt(x: number, y: number): ReplayUnit[] {
    return this.unitsByCell.get(`${x},${y}`) ?? [];
  }

  protected family(unit: ReplayUnit): TroopFamily {
    return this.families.get(`${unit.armyName}:${unit.troopCode}`) ?? 'infantry';
  }

  protected step(delta: number): void {
    this.stopPlay();
    this.setFrame(this.frameIndex + delta);
  }

  protected togglePlay(): void {
    if (this.playing) {
      this.stopPlay();
      return;
    }
    if (this.frameIndex >= this.frames.length - 1) {
      this.setFrame(0);
    }
    this.playing = true;
    this.playTimer = setInterval(() => {
      if (this.frameIndex >= this.frames.length - 1) {
        this.stopPlay();
        this.changeDetector.markForCheck();
        return;
      }
      this.setFrame(this.frameIndex + 1);
      this.playing = true;
      this.changeDetector.markForCheck();
    }, 1000);
  }

  protected setFrame(index: number): void {
    this.frameIndex = Math.max(0, Math.min(Math.max(this.frames.length - 1, 0), index));
    this.paintFrame();
  }

  protected rangeValue(event: Event): number {
    this.stopPlay();
    return Number((event.target as HTMLInputElement).value);
  }

  protected heightColor(height: number): string {
    const stops = ['#000000', '#D7F7AE', '#6ED63A', '#1F8A3C', '#FFE14A', '#C9A04A', '#A6A6A6', '#7F7F7F', '#545454', '#2A2A2A'];
    return stops[height] ?? stops[0];
  }

  protected cellLabel(cell: MapCell): string {
    if (cell.token === '##' || cell.token === 'WW' || cell.token === 'bb' || cell.token === '$$') {
      return cell.token;
    }
    if (!this.knownHeights) {
      return '';
    }
    const feature = cell.feature === 'open' ? '' : cell.token[0];
    return feature ? `${feature}${cell.height}` : String(cell.height);
  }

  protected glyphIsLight(height: number): boolean {
    return height === 0 || (height >= 8 && height <= 9);
  }

  protected onZoneEdge(cell: MapCell, edge: 'n' | 's' | 'w' | 'e'): boolean {
    if ((edge === 'n' && cell.y === 1) || (edge === 's' && cell.y === 40) || (edge === 'w' && cell.x === 1) || (edge === 'e' && cell.x === 45)) {
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

  protected onStrategicPoint(x: number, y: number): boolean {
    return this.strategicPoints.some((point) => point.x === x && point.y === y);
  }

  protected cellShadow(cell: MapCell): string {
    if (!cell.token.startsWith('$')) {
      return '';
    }
    const shadows: string[] = [];
    if (!this.isSpecial(cell.x - 1, cell.y)) {
      shadows.push('inset 3px 0 0 #000');
    }
    shadows.push('inset -3px 0 0 #000');
    if (!this.isSpecial(cell.x, cell.y - 1)) {
      shadows.push('inset 0 3px 0 #000');
    }
    shadows.push('inset 0 -3px 0 #000');
    return shadows.join(', ');
  }

  private startBattle(battle: ReplayBattle, useSetup: boolean): void {
    this.battle = battle;
    this.frames = battle.frames;
    this.frameIndex = 0;
    this.strategicPoints = useSetup ? (this.launch?.strategicPoints ?? []) : [];
    this.knownHeights = useSetup && !!this.launch?.mapCells?.length;
    const cells = this.knownHeights && this.launch?.mapCells ? this.launch.mapCells : this.greenMap();
    this.baseCells = cells.map((cell) => ({ ...cell }));
    this.families.clear();
    this.paintFrame();
    this.message = '';
    this.changeDetector.markForCheck();
  }

  private paintFrame(): void {
    const terrain = new Map(
      (this.frames[this.frameIndex]?.terrain ?? []).map((mark) => [`${mark.x},${mark.y}`, mark.token]),
    );
    const cells = this.baseCells.map((cell) => {
      const token = terrain.get(`${cell.x},${cell.y}`);
      if (!token) {
        return cell;
      }
      return { ...cell, token, feature: this.terrainFeature(token) };
    });
    this.rows = this.buildRows(cells);
    this.rebuildUnits();
  }

  private terrainFeature(token: string): MapCell['feature'] {
    if (token === '##') {
      return 'woods';
    }
    if (token === 'WW') {
      return 'water';
    }
    if (token === 'bb') {
      return 'builtup';
    }
    if (token === '$$') {
      return 'special';
    }
    return 'open';
  }

  private rebuildUnits(): void {
    this.unitsByCell.clear();
    for (const unit of this.frames[this.frameIndex]?.units ?? []) {
      const key = `${unit.x},${unit.y}`;
      const occupants = this.unitsByCell.get(key) ?? [];
      occupants.push(unit);
      this.unitsByCell.set(key, occupants);
      const familyKey = `${unit.armyName}:${unit.troopCode}`;
      if (!this.families.has(familyKey)) {
        this.families.set(familyKey, this.troopFamily(unit));
      }
    }
  }

  private troopFamily(unit: ReplayUnit): TroopFamily {
    const rule = this.battalionRule(unit);
    if (rule && rule.no >= 41 && rule.no <= 45) {
      return 'artillery';
    }
    if (rule && rule.no >= 21 && rule.no <= 39) {
      return 'cavalry';
    }
    return 'infantry';
  }

  private battalionRule(unit: ReplayUnit) {
    return (
      this.rules.getBattalionRuleByShortName(unit.armyName, unit.troopCode) ??
      this.rules
        .getArmyStore()
        .nations.map((nation) => this.rules.getBattalionRuleByShortName(nation.name, unit.troopCode))
        .find((item) => item !== null) ??
      null
    );
  }

  private formationLabel(unit: ReplayUnit): string {
    if (unit.troopCode.trim().toLowerCase() === 'pi' || this.family(unit) === 'artillery') {
      return 'Co';
    }
    const letter = unit.formation?.toLowerCase();
    if (letter === 'k') {
      return 'Co';
    }
    if (letter === 'l') {
      return 'Li';
    }
    if (letter === 'p') {
      return 'Sk';
    }
    if (letter === 'f') {
      return 'flight';
    }
    if (unit.formation === '#') {
      return 'square';
    }
    return unit.formation ?? '';
  }

  private greenMap(): MapCell[] {
    const cells: MapCell[] = [];
    for (let y = 1; y <= 40; y += 1) {
      for (let x = 1; x <= 45; x += 1) {
        cells.push({ x, y, token: '.2', feature: 'open', height: 2 });
      }
    }
    return cells;
  }

  private buildRows(cells: MapCell[]): MapCell[][] {
    const rows: MapCell[][] = [];
    for (let y = 1; y <= 40; y += 1) {
      rows.push(cells.filter((cell) => cell.y === y).sort((left, right) => left.x - right.x));
    }
    return rows;
  }

  private isSpecial(x: number, y: number): boolean {
    return this.rows[y - 1]?.[x - 1]?.token.startsWith('$') ?? false;
  }

  private stopPlay(): void {
    this.playing = false;
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }
}
