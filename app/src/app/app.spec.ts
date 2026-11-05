import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { FederationOrder } from './models/battle';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('offers a file picker when the SIM sheet is not found', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as { missingSimWarning: string | null };
    app.missingSimWarning = 'SIM Sheet v0.6-Denmark Sim 1.xlsx';
    fixture.detectChanges();
    const picker = fixture.nativeElement.querySelector('#simFile') as HTMLInputElement;
    const findFile = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Find file'),
    ) as HTMLButtonElement | undefined;
    expect(picker?.accept).toContain('.xlsx');
    expect(findFile).toBeTruthy();
  });

  it('toggles Ty between the troop code and a rounded effectiveness', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'fedType'): void;
      chipText(unit: { id: number; troopCode: string; effectiveness: number | null }): string;
      selectedArmy: { units: Array<{ id: number; troopCode: string; effectiveness: number | null }> } | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const unit = app.selectedArmy?.units.find((item) => item.id === 9);
    const whole = app.selectedArmy?.units.find((item) => item.id === 1);
    expect(unit?.effectiveness).toBe(8.5);
    expect(app.chipText(unit!)).toBe('GR');
    expect(app.chipText(whole!)).toBe('GR');
    app.selectChipMode('fedType');
    expect(app.chipText(unit!)).toBe('GR 9');
    expect(app.chipText(whole!)).toBe('GR 8');
    app.selectChipMode('fedType');
    expect(app.chipText(unit!)).toBe('GR');
  });

  it('edits a start-attack value and paints it onto empty federations', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'startAttack' | 'order'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      changeValue(): void;
      onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own'): void;
      chipModeMenu: { unitId: number; group?: boolean } | null;
      confirmValueEntry(event: Event): void;
      keepEnteredValue(): void;
      paintValueToAll(): void;
      paintValueToSameType(): void;
      chipText(unit: { id: number }): string;
      selectedArmy: { units: Array<{ id: number; troopCode: string }> } | null;
      valueEntry: { draft: string; error: string } | null;
      valueAction: { unitId: number; mode: string; value: number; fresh?: boolean } | null;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.selectChipMode('startAttack');
    const click = new MouseEvent('click');
    app.onPaletteUnitClick(click, 1);
    expect(app.valueEntry).toBeTruthy();
    app.valueEntry!.draft = '0';
    app.confirmValueEntry(new Event('submit'));
    const first = app.selectedArmy!.units[0];
    expect(app.valueAction?.value).toBe(0);
    expect(app.chipText(first)).toBe('');
    app.keepEnteredValue();
    expect(app.chipText(first)).toBe('0');

    app.onPaletteUnitClick(click, 1);
    expect(app.valueAction?.value).toBe(0);
    app.paintValueToAll();
    expect(app.selectedArmy!.units.every((unit) => app.chipText(unit) === '0')).toBe(true);

    app.onChipContextMenu(new MouseEvent('contextmenu'), 1, 'own');
    expect(app.chipModeMenu).toEqual(expect.objectContaining({ unitId: 1 }));
    expect(app.chipText(first)).toBe('0');
    app.chipModeMenu = null;

    app.selectChipMode('order');
    app.onPaletteUnitClick(click, 2);
    app.changeValue();
    app.valueEntry!.draft = '7';
    app.confirmValueEntry(new Event('submit'));
    expect(app.valueEntry?.error).toContain('not a valid order');

    app.valueEntry!.draft = '11';
    app.confirmValueEntry(new Event('submit'));
    expect(app.valueEntry).toBeNull();
    expect(app.valueAction).toEqual({ unitId: 2, mode: 'order', value: 11, fresh: false });
  });

  it('paints the next battalion group onto later federations', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'battalionGroup'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      confirmValueEntry(event: Event): void;
      keepEnteredValue(): void;
      paintNextIncrement(): void;
      paintNextIncrementToAll(): void;
      paintNextIncrementToSameType(): void;
      chipText(unit: { id: number }): string;
      selectedArmy: { units: Array<{ id: number; troopCode: string }> } | null;
      valueEntry: { draft: string } | null;
      valueAction: { unitId: number; mode: string; value: number } | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.selectChipMode('battalionGroup');
    const click = new MouseEvent('click');
    const text = (id: number) => app.chipText(app.selectedArmy!.units.find((unit) => unit.id === id)!);
    app.onPaletteUnitClick(click, 1);
    app.valueEntry!.draft = '4';
    app.confirmValueEntry(new Event('submit'));
    app.keepEnteredValue();
    app.onPaletteUnitClick(click, 1);
    expect(app.valueAction).toEqual({ unitId: 1, mode: 'battalionGroup', value: 4 });
    app.paintNextIncrement();
    app.onPaletteUnitClick(click, 2);
    app.onPaletteUnitClick(click, 3);
    expect(text(2)).toBe('5');
    expect(text(3)).toBe('6');

    app.onPaletteUnitClick(click, 1);
    app.paintNextIncrementToSameType();
    const troopCode = app.selectedArmy!.units.find((unit) => unit.id === 1)!.troopCode;
    const sameType = app.selectedArmy!.units
      .filter((unit) => unit.troopCode === troopCode)
      .sort((left, right) => left.id - right.id);
    let nextGroup = 4;
    const sameTypeValues = new Map<number, string>([[1, '4']]);
    for (const unit of sameType.filter((unit) => unit.id > 1)) {
      nextGroup += 1;
      sameTypeValues.set(unit.id, String(nextGroup));
    }
    for (const unit of sameType.filter((unit) => unit.id < 1)) {
      nextGroup += 1;
      sameTypeValues.set(unit.id, String(nextGroup));
    }
    for (const [id, value] of sameTypeValues) {
      expect(text(id)).toBe(value);
    }

    app.onPaletteUnitClick(click, 1);
    app.paintNextIncrementToAll();
    const ordered = [...app.selectedArmy!.units].sort((left, right) => left.id - right.id);
    let nextAll = 4;
    const allValues = new Map<number, string>([[1, '4']]);
    for (const unit of [...ordered.filter((unit) => unit.id > 1), ...ordered.filter((unit) => unit.id < 1)]) {
      nextAll += 1;
      if (nextAll > 99) {
        break;
      }
      allValues.set(unit.id, String(nextAll));
    }
    for (const [id, value] of allValues) {
      expect(text(id)).toBe(value);
    }
  });

  it('assigns the next federation number on first placement and clears it when removed', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      selectChipMode(mode: 'fedType' | 'fedNo' | 'battalionGroup' | 'xy'): void;
      chipText(unit: { id: number }): string;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      selectedArmy: { units: Array<{ id: number }> } | null;
      federationOrders: Map<number, FederationOrder>;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const text = (id: number) => app.chipText(app.selectedArmy!.units.find((unit) => unit.id === id)!);

    app.selectChipMode('battalionGroup');
    expect(text(9)).toBe('');
    expect(text(1)).toBe('');
    app.selectChipMode('fedType');

    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 9);
    app.onCellClick(click, zone.minX, zone.minY);
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, zone.minX + 1, zone.minY);
    app.selectChipMode('fedNo');
    expect(text(9)).toBe('1');
    expect(text(1)).toBe('2');
    app.selectChipMode('battalionGroup');
    expect(text(9)).toBe('9');
    expect(text(1)).toBe('1');

    app.onChipClick(new MouseEvent('click', { detail: 2 }), 9, 'own');
    expect(app.federationOrders.has(9)).toBe(false);
    app.selectChipMode('fedNo');
    expect(text(9)).toBe('');

    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 4);
    app.onCellClick(click, zone.minX, zone.minY);
    app.selectChipMode('fedNo');
    expect(text(4)).toBe('1');
    expect(app.federationOrders.get(4)?.battalionGroup).toBe(4);
  });

  it('sets destination 1 inside the setup area and advances to the next federation', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'xy' | 'destination1'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      cellChips(x: number, y: number): Array<{ unit: { id: number } }>;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      highlightedFederationId: number | null;
      federationOrders: Map<number, FederationOrder>;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    app.selectChipMode('xy');
    for (const [id, column] of [
      [1, 0],
      [2, 1],
      [4, 2],
    ] as const) {
      app.onPaletteUnitClick(click, id);
      app.onCellClick(click, zone.minX + column, zone.minY + 1);
    }
    app.selectChipMode('destination1');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, 2, 20);
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: 2, y: 20 });
    expect(app.highlightedFederationId).toBe(2);
    app.onPaletteUnitClick(click, 1);
    const d1x = zone.minX + 4;
    const d1y = zone.minY + 2;
    app.onCellClick(click, d1x, d1y);
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: d1x, y: d1y });
    expect(app.cellChips(d1x, d1y).some((chip) => chip.unit.id === 1)).toBe(true);
    expect(app.highlightedFederationId).toBe(2);
    const nextX = zone.minX + 5;
    const nextY = zone.minY + 3;
    app.onCellClick(click, nextX, nextY);
    expect(app.federationOrders.get(2)?.primary.destination1).toEqual({ x: nextX, y: nextY });
    expect(app.highlightedFederationId).toBe(4);
  });

  it('still places federations by drag or click while a destination mode is selected', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'altDestination2'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onCellDrop(event: { preventDefault(): void; dataTransfer: { getData(format: string): string } }, x: number, y: number): void;
      chipDragEnabled(unit: { id: number }): boolean;
      placements: Map<number, { x: number; y: number }>;
      federationOrders: Map<number, FederationOrder>;
      statusMessage: string;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      selectedArmy: { units: Array<{ id: number }> } | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const unit = (id: number) => app.selectedArmy!.units.find((item) => item.id === id)!;

    for (const mode of ['destination1', 'destination2', 'altDestination1', 'altDestination2'] as const) {
      app.selectChipMode(mode);
      expect(app.chipDragEnabled(unit(3))).toBe(true);
    }

    app.selectChipMode('destination2');
    app.onPaletteUnitClick(click, 5);
    app.onCellClick(click, zone.minX + 1, zone.minY);
    expect(app.placements.get(5)).toEqual({ x: zone.minX + 1, y: zone.minY });

    app.selectChipMode('destination2');
    app.onPaletteUnitClick(click, 3);
    app.onCellClick(click, zone.minX, zone.minY);
    expect(app.placements.get(3)).toEqual({ x: zone.minX, y: zone.minY });
    app.onPaletteUnitClick(click, 3);
    app.onCellClick(click, 2, 20);
    expect(app.federationOrders.get(3)?.primary.destination2).toEqual({ x: 2, y: 20 });
    expect(app.placements.get(3)).toEqual({ x: zone.minX, y: zone.minY });

    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 7);
    app.onCellClick(click, 2, 20);
    expect(app.placements.has(7)).toBe(false);
    expect(app.statusMessage).toContain('outside setup area');

    app.onCellDrop(
      { preventDefault() {}, dataTransfer: { getData: () => '8' } },
      zone.minX + 2,
      zone.minY,
    );
    expect(app.placements.get(8)).toEqual({ x: zone.minX + 2, y: zone.minY });
  });

  it('drags a federation to a destination anywhere on the battlefield and leaves it still in other modes', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'xy' | 'destination1' | 'order'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onCellDrop(event: { preventDefault(): void; dataTransfer: { getData(format: string): string } }, x: number, y: number): void;
      chipDragEnabled(unit: { id: number }): boolean;
      cellChips(x: number, y: number): Array<{ unit: { id: number } }>;
      placements: Map<number, { x: number; y: number }>;
      federationOrders: Map<number, FederationOrder>;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      selectedArmy: { units: Array<{ id: number }> } | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const unit = app.selectedArmy!.units.find((item) => item.id === 6)!;
    app.onPaletteUnitClick(click, 6);
    app.onCellClick(click, zone.minX, zone.minY);
    expect(app.placements.get(6)).toEqual({ x: zone.minX, y: zone.minY });

    app.selectChipMode('order');
    expect(app.chipDragEnabled(unit)).toBe(false);
    app.onCellDrop(
      { preventDefault() {}, dataTransfer: { getData: () => '6' } },
      zone.minX + 3,
      zone.minY,
    );
    expect(app.placements.get(6)).toEqual({ x: zone.minX, y: zone.minY });
    app.onCellDrop(
      { preventDefault() {}, dataTransfer: { getData: () => '8' } },
      zone.minX + 1,
      zone.minY,
    );
    expect(app.placements.get(8)).toEqual({ x: zone.minX + 1, y: zone.minY });

    app.selectChipMode('destination1');
    app.onCellDrop(
      { preventDefault() {}, dataTransfer: { getData: () => '6' } },
      3,
      18,
    );
    expect(app.federationOrders.get(6)?.primary.destination1).toEqual({ x: 3, y: 18 });
    expect(app.federationOrders.get(6)?.primary.order).toBe(0);
    expect(app.federationOrders.get(6)?.primary.formation).toBe(1);
    expect(app.cellChips(3, 18).some((chip) => chip.unit.id === 6)).toBe(true);
    app.selectChipMode('order');
    expect(app.cellChips(3, 18).some((chip) => chip.unit.id === 6)).toBe(true);
    expect(app.cellChips(zone.minX, zone.minY).some((chip) => chip.unit.id === 6)).toBe(false);
  });

  it('keeps a placed chip on its start coordinate until a destination is shown', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'xy' | 'order' | 'fedType' | 'destination1' | 'destination2'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      cellChips(x: number, y: number): Array<{ unit: { id: number } }>;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      federationOrders: Map<number, FederationOrder>;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const x = zone.minX;
    const y = zone.minY + 1;
    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, x, y);
    expect(app.federationOrders.get(1)?.start).toEqual({ x, y });
    expect(app.federationOrders.get(1)?.primary.order).toBe(0);
    expect(app.federationOrders.get(1)?.primary.formation).toBe(1);
    app.selectChipMode('order');
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
    const orderRow = app.federationOrders.get(1)!;
    orderRow.primary.destination2 = { x: 4, y: 22 };
    app.selectChipMode('destination2');
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(true);
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(false);
    app.selectChipMode('fedType');
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(true);
    app.selectChipMode('order');
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(true);
    app.selectChipMode('destination1');
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(true);
    app.selectChipMode('xy');
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(false);
  });

  it('should render the load button before a turn is opened', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const labels = Array.from(compiled.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');
    expect(labels).toContain('Load New Turn');
    expect(labels).not.toContain('Replay Battle');
  });

  it('keeps a second turn load from scanning every federation on every cell', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      cellChips(x: number, y: number): Array<{ unit: { id: number } }>;
      rows: Array<Array<{ x: number; y: number }>>;
      selectedArmy: { units: Array<{ id: number }> } | null;
      federationOrders: Map<unknown, FederationOrder>;
      layoutRevision: number;
      parseError: string;
      placements: Map<number, { x: number; y: number }>;
      selectChipMode(mode: 'xy'): void;
    };
    const openTurn = async (name: string) => {
      const body = readFileSync(resolve(process.cwd(), '..', name), 'utf8');
      const file = new File([body], name, { type: 'text/plain' });
      await app.onTurnFileSelected({ target: { files: [file], value: name } } as unknown as Event);
    };

    await openTurn('124D1012.txt');
    await openTurn('124D1112.txt');
    expect(app.parseError).toBe('');
    expect(app.rows).toHaveLength(40);
    expect(app.selectedArmy?.units.length).toBeGreaterThan(20);

    const blank = { x: null, y: null };
    for (const unit of app.selectedArmy?.units ?? []) {
      app.federationOrders.set(String(unit.id), {
        federation: unit.id,
        battalionGroup: 1,
        start: { x: (unit.id % 45) + 1, y: (unit.id % 40) + 1 },
        primary: {
          startAttack: 1,
          order: 2,
          additionalOrder: null,
          formation: 0,
          destination1: blank,
          destination2: blank,
        },
        alternative: {
          condition: null,
          order: null,
          additionalOrder: null,
          formation: null,
          destination1: blank,
          destination2: blank,
        },
      });
    }
    app.selectChipMode('xy');
    app.layoutRevision += 1;

    const started = performance.now();
    for (let pass = 0; pass < 30; pass += 1) {
      for (const row of app.rows) {
        for (const cell of row) {
          app.cellChips(cell.x, cell.y);
        }
      }
    }
    expect(performance.now() - started).toBeLessThan(400);

    const sample = app.selectedArmy?.units[0];
    expect(sample).toBeTruthy();
    const sampleX = (sample!.id % 45) + 1;
    const sampleY = (sample!.id % 40) + 1;
    app.placements.set(sample!.id, { x: sampleX, y: sampleY });
    app.layoutRevision += 1;
    const chips = app.cellChips(sampleX, sampleY);
    expect(chips.some((chip) => chip.unit.id === sample!.id)).toBe(true);
  });

  it('opens the setting menu on right-click and removes a deployed federation on double-click', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      chooseChipModeMenu(mode: 'order' | 'fedNo'): void;
      chipModeMenu: { unitId: number; group?: boolean } | null;
      chipSettingModes: Array<{ value: string }>;
      chipDisplayMode: string;
      valueEntry: { unitId: number; mode: string } | null;
      placements: Map<number, { x: number; y: number }>;
      highlightedFederationId: number | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.placements.set(9, { x: 12, y: 2 });

    app.onChipContextMenu(new MouseEvent('contextmenu'), 9, 'own');

    expect(app.placements.has(9)).toBe(true);
    expect(app.chipModeMenu).toEqual(expect.objectContaining({ unitId: 9 }));
    expect(app.chipSettingModes.map((mode) => mode.value)).toEqual([
      'startAttack',
      'order',
      'additionalOrder',
      'formation',
      'altCondition',
      'altOrder',
      'altAdditionalOrder',
      'altFormation',
    ]);

    app.chooseChipModeMenu('order');
    expect(app.chipModeMenu).toBeNull();
    expect(app.chipDisplayMode).toBe('order');
    expect(app.highlightedFederationId).toBe(9);
    expect(app.valueEntry).toEqual(expect.objectContaining({ unitId: 9, mode: 'order' }));

    app.onChipClick(new MouseEvent('click', { detail: 2 }), 9, 'own');
    expect(app.placements.has(9)).toBe(false);
    expect(app.valueEntry).toBeNull();
  });

  it('removes a federation from the board or clears the selected destination from the right-click menu', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own'): void;
      selectChipMode(mode: 'xy' | 'destination1' | 'destination2' | 'altDestination1' | 'order'): void;
      boardRemovalLabel(): string | null;
      removeFederationFromMenu(): void;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      placements: Map<number, { x: number; y: number }>;
      federationOrders: Map<number, FederationOrder>;
      cellChips(x: number, y: number): Array<{ unit: { id: number } }>;
      chipModeMenu: { unitId: number } | null;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const x = zone.minX;
    const y = zone.minY + 1;
    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, x, y);

    app.onChipContextMenu(new MouseEvent('contextmenu'), 1, 'own');
    expect(app.boardRemovalLabel()).toBe('Remove federation from board');
    app.removeFederationFromMenu();
    expect(app.placements.has(1)).toBe(false);
    expect(app.chipModeMenu).toBeNull();

    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, x, y);
    const orderRow = app.federationOrders.get(1)!;
    orderRow.primary.destination1 = { x: 4, y: 22 };
    orderRow.primary.destination2 = { x: 6, y: 24 };
    orderRow.alternative.destination1 = { x: 8, y: 26 };
    app.selectChipMode('destination2');
    app.onChipContextMenu(new MouseEvent('contextmenu'), 1, 'own');
    expect(app.boardRemovalLabel()).toBe('Remove federation from current Destination x/y');
    app.removeFederationFromMenu();

    expect(app.placements.get(1)).toEqual({ x, y });
    expect(app.federationOrders.get(1)?.primary.destination2).toEqual({ x: null, y: null });
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: 4, y: 22 });
    expect(app.federationOrders.get(1)?.alternative.destination1).toEqual({ x: 8, y: 26 });
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
    expect(app.cellChips(6, 24).some((chip) => chip.unit.id === 1)).toBe(false);
  });

  it('clears the right-clicked coordinate and leaves the other destinations', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'xy'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onCoordinateModeContextMenu(event: MouseEvent, mode: 'xy' | 'destination1' | 'destination2' | 'order'): void;
      clearCoordinateMenuValue(): void;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      federationOrders: Map<number, FederationOrder>;
      coordinateClearMenu: string | null;
      highlightedFederationId: number | null;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, zone.minX, zone.minY + 1);
    const orderRow = app.federationOrders.get(1)!;
    orderRow.primary.destination1 = { x: 4, y: 22 };
    orderRow.primary.destination2 = { x: 6, y: 24 };
    const menuEvent = new MouseEvent('contextmenu', { cancelable: true });

    app.onCoordinateModeContextMenu(menuEvent, 'order');
    expect(menuEvent.defaultPrevented).toBe(false);
    expect(app.coordinateClearMenu).toBeNull();

    app.onCoordinateModeContextMenu(menuEvent, 'destination1');
    expect(app.coordinateClearMenu).toBe('destination1');
    app.coordinateClearMenu = null;

    app.onCoordinateModeContextMenu(new MouseEvent('contextmenu', { cancelable: true }), 'destination1');
    app.clearCoordinateMenuValue();
    expect(app.coordinateClearMenu).toBeNull();
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: null, y: null });
    expect(app.federationOrders.get(1)?.primary.destination2).toEqual({ x: 6, y: 24 });
    expect(app.federationOrders.get(1)?.start).toEqual({ x: zone.minX, y: zone.minY + 1 });

    app.highlightedFederationId = null;
    app.onCoordinateModeContextMenu(new MouseEvent('contextmenu', { cancelable: true }), 'destination2');
    app.clearCoordinateMenuValue();
    expect(app.statusMessage).toContain('Select a federation');
    expect(app.federationOrders.get(1)?.primary.destination2).toEqual({ x: 6, y: 24 });
  });

  it('shift-selects a federation range and copies it into a deployment rectangle', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      getUnplacedUnits(): Array<{ id: number }>;
      inDeployGroup(unitId: number): boolean;
      isDeployAnchor(x: number, y: number): boolean;
      inDeployPreview(x: number, y: number): boolean;
      onDeployPreviewMove(event: MouseEvent, x: number, y: number): void;
      onDeployPreviewKey(event: KeyboardEvent): void;
      cellShadow(cell: { x: number; y: number; token: string; feature: 'open'; height: number }): string;
      cellChips(x: number, y: number): unknown[];
      setupZones: { A: { minX: number; maxX: number; minY: number; maxY: number }; B: { minX: number; maxX: number; minY: number; maxY: number } };
      selectedArmySide: 'A' | 'B';
      placements: Map<number, { x: number; y: number }>;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const shift = new MouseEvent('click', { shiftKey: true });
    const click = new MouseEvent('click');
    const zone = app.setupZones[app.selectedArmySide];
    const unplaced = () => app.getUnplacedUnits().map((unit) => unit.id).sort((left, right) => left - right);
    const selectRange = (low: number, high: number) => {
      app.onPaletteUnitClick(click, high);
      app.onPaletteUnitClick(shift, low);
    };

    const ids = unplaced();
    const selected = ids.slice(0, 6);
    selectRange(selected[0], selected[5]);
    expect(app.statusMessage).toBe(
      '6 units selected, click the beginning of the area, then shift-click the other corner to deploy.',
    );
    expect(selected.every((id) => app.inDeployGroup(id))).toBe(true);
    expect(app.inDeployGroup(ids[6])).toBe(false);

    const endX = Math.min(zone.maxX, zone.minX + 2);
    const endY = Math.min(zone.maxY, zone.minY + 1);
    app.onCellClick(shift, zone.minX, zone.minY);
    expect(app.isDeployAnchor(zone.minX, zone.minY)).toBe(true);
    app.onDeployPreviewMove(shift, endX, endY);
    expect(app.inDeployPreview(zone.minX, zone.minY)).toBe(true);
    expect(app.inDeployPreview(endX, endY)).toBe(true);
    expect(app.inDeployPreview(endX + 1, endY)).toBe(false);
    const plain = (x: number, y: number) => ({ x, y, token: '.', feature: 'open' as const, height: 1 });
    expect(app.cellShadow(plain(zone.minX, zone.minY))).toBe('inset 0 3px 0 #fff, inset 3px 0 0 #fff');
    expect(app.cellShadow(plain(zone.minX + 1, endY))).not.toContain('inset 3px 0 0 #fff');
    expect(app.cellShadow(plain(endX + 1, endY))).toBe('');
    app.onDeployPreviewKey(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(app.isDeployAnchor(zone.minX, zone.minY)).toBe(true);
    expect(app.inDeployPreview(endX, endY)).toBe(false);
    app.onDeployPreviewKey(new KeyboardEvent('keydown', { key: 'Shift' }));
    expect(app.inDeployPreview(endX, endY)).toBe(true);

    app.onCellClick(click, 1, 20);
    expect(app.statusMessage).toBe('Selection cleared.');
    expect(app.inDeployGroup(selected[0])).toBe(false);
    expect(app.placements.has(selected[0])).toBe(false);

    selectRange(selected[0], selected[5]);
    app.onCellClick(shift, zone.minX, zone.minY);
    app.onCellClick(shift, 1, 20);
    expect(app.statusMessage).toBe('Selection cleared. Both shift-clicks must be inside the deployment area.');
    expect(app.placements.has(selected[0])).toBe(false);

    selectRange(selected[0], selected[5]);
    app.onCellClick(click, zone.minX, zone.maxY);
    expect(app.isDeployAnchor(zone.minX, zone.maxY)).toBe(true);
    expect(app.placements.has(selected[0])).toBe(false);
    app.onCellClick(click, zone.minX, zone.maxY);
    expect(app.placements.get(selected[0])).toEqual({ x: zone.minX, y: zone.maxY });
    expect(app.placements.has(selected[1])).toBe(false);
    expect(app.inDeployGroup(selected[1])).toBe(false);

    const rest = unplaced().slice(0, 6);
    selectRange(rest[0], rest[5]);
    const rowY = zone.minY;
    let rowX = zone.minX;
    while (rowX + 2 <= zone.maxX && [0, 1, 2].some((offset) => app.cellChips(rowX + offset, rowY).length)) {
      rowX += 1;
    }
    app.onCellClick(shift, rowX + 2, rowY);
    app.onCellClick(shift, rowX, rowY);
    expect(app.placements.get(rest[0])).toEqual({ x: rowX, y: rowY });
    expect(app.placements.get(rest[1])).toEqual({ x: rowX + 1, y: rowY });
    expect(app.placements.get(rest[2])).toEqual({ x: rowX + 2, y: rowY });
    expect(app.placements.has(rest[3])).toBe(false);
    expect(app.statusMessage).toBe('3 fed selected, click the beginning of the area, then shift-click the other corner to deploy.');

    const box = unplaced().slice(0, 6);
    selectRange(box[5], box[0]);
    let boxX = zone.minX;
    let boxY = zone.minY + 2;
    const blocked = (x: number, y: number) =>
      app.cellChips(x, y).length > 0 || app.cellChips(x + 1, y).length > 0 || app.cellChips(x, y + 1).length > 0 || app.cellChips(x + 1, y + 1).length > 0;
    while (boxY + 1 <= zone.maxY && blocked(boxX, boxY)) {
      boxX += 2;
      if (boxX + 1 > zone.maxX) {
        boxX = zone.minX;
        boxY += 2;
      }
    }
    app.onCellClick(shift, boxX + 1, boxY + 1);
    app.onCellClick(shift, boxX, boxY);
    expect(app.placements.get(box[0])).toEqual({ x: boxX, y: boxY });
    expect(app.placements.get(box[1])).toEqual({ x: boxX + 1, y: boxY });
    expect(app.placements.get(box[2])).toEqual({ x: boxX, y: boxY + 1 });
    expect(app.placements.get(box[3])).toEqual({ x: boxX + 1, y: boxY + 1 });
    expect(app.placements.has(box[4])).toBe(false);
    expect(app.statusMessage).toBe('2 fed selected, click the beginning of the area, then shift-click the other corner to deploy.');
  });

  it('drag-selects map federations and applies one setting to the whole selection', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      confirmClearAll(): void;
      selectChipMode(mode: 'xy' | 'order'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      onCellMouseEnter(event: MouseEvent, x: number, y: number): void;
      onDeployPreviewKey(event: KeyboardEvent): void;
      cellShadow(cell: { x: number; y: number; token: string; feature: 'open'; height: number }): string;
      inMapFederationGroup(unitId: number, kind: 'own' | 'enemy'): boolean;
      onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      chooseChipModeMenu(mode: 'order'): void;
      confirmValueEntry(event: Event): void;
      chipModeMenu: { unitId: number; group?: boolean } | null;
      valueEntry: { draft: string; mode: string; unitIds: number[] | null } | null;
      valueAction: unknown;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      federationOrders: Map<number, FederationOrder>;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.confirmClearAll();
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const shift = new MouseEvent('click', { shiftKey: true });
    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, zone.minX, zone.minY);
    app.onPaletteUnitClick(click, 2);
    app.onCellClick(click, zone.minX + 1, zone.minY);
    app.onPaletteUnitClick(click, 3);
    app.onCellClick(click, zone.minX + 2, zone.minY);

    app.selectChipMode('order');
    app.onChipClick(click, 1, 'own');
    app.onCellMouseEnter({ shiftKey: true } as unknown as MouseEvent, zone.minX + 1, zone.minY);
    app.onDeployPreviewKey(new KeyboardEvent('keydown', { key: 'Shift' }));
    const plain = (x: number, y: number) => ({ x, y, token: '.', feature: 'open' as const, height: 1 });
    expect(app.cellShadow(plain(zone.minX, zone.minY))).toContain('inset 0 3px 0 #fff');
    app.onCellClick(shift, zone.minX + 1, zone.minY);
    expect(app.inMapFederationGroup(1, 'own')).toBe(true);
    expect(app.inMapFederationGroup(2, 'own')).toBe(true);
    expect(app.inMapFederationGroup(3, 'own')).toBe(false);

    app.onChipContextMenu(new MouseEvent('contextmenu'), 1, 'own');
    expect(app.chipModeMenu).toEqual(expect.objectContaining({ unitId: 1, group: true }));
    app.chooseChipModeMenu('order');
    expect(app.valueEntry).toEqual(expect.objectContaining({ mode: 'order', unitIds: [1, 2] }));
    app.valueEntry!.draft = '11';
    app.confirmValueEntry(new Event('submit'));
    expect(app.valueAction).toBeNull();
    expect(app.federationOrders.get(1)?.primary.order).toBe(11);
    expect(app.federationOrders.get(2)?.primary.order).toBe(11);
    expect(app.federationOrders.get(3)?.primary.order).toBe(0);
  });

  it('deploys a drag-selected group in XY and destination modes and clears outside actions', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      confirmClearAll(): void;
      selectChipMode(mode: 'xy' | 'destination1' | 'order'): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      cancelEntrenchmentOnClickElsewhere(event: MouseEvent): void;
      inMapFederationGroup(unitId: number, kind: 'own' | 'enemy'): boolean;
      setupZones: { A: { minX: number; minY: number }; B: { minX: number; minY: number } };
      selectedArmySide: 'A' | 'B';
      placements: Map<number, { x: number; y: number }>;
      federationOrders: Map<number, FederationOrder>;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.confirmClearAll();
    const zone = app.setupZones[app.selectedArmySide];
    const click = new MouseEvent('click');
    const shift = new MouseEvent('click', { shiftKey: true });
    app.selectChipMode('xy');
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, zone.minX, zone.minY);
    app.onPaletteUnitClick(click, 2);
    app.onCellClick(click, zone.minX + 1, zone.minY);
    app.onPaletteUnitClick(click, 3);
    app.onCellClick(click, zone.minX + 2, zone.minY);

    app.selectChipMode('order');
    app.onChipClick(click, 1, 'own');
    app.onCellClick(shift, zone.minX + 2, zone.minY);
    app.onCellClick(click, zone.minX + 5, zone.minY + 1);
    app.onCellClick(shift, zone.minX + 6, zone.minY + 2);
    expect(app.placements.get(1)).toEqual({ x: zone.minX + 5, y: zone.minY + 1 });
    expect(app.placements.get(2)).toEqual({ x: zone.minX + 6, y: zone.minY + 1 });
    expect(app.placements.get(3)).toEqual({ x: zone.minX + 5, y: zone.minY + 2 });

    app.onChipClick(click, 1, 'own');
    app.onCellClick(shift, zone.minX + 6, zone.minY + 2);
    app.onCellClick(click, 1, 20);
    expect(app.statusMessage).toContain('This is not allowed.');
    expect(app.statusMessage).toContain('setup area');
    expect(app.placements.get(1)).toEqual({ x: zone.minX + 5, y: zone.minY + 1 });
    expect(app.inMapFederationGroup(1, 'own')).toBe(true);
    app.cancelEntrenchmentOnClickElsewhere(new MouseEvent('click'));

    app.onChipClick(click, 1, 'own');
    app.onCellClick(shift, zone.minX + 6, zone.minY + 2);
    app.selectChipMode('destination1');
    app.onCellClick(click, 3, 18);
    app.onCellClick(shift, 4, 18);
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: 3, y: 18 });
    expect(app.federationOrders.get(2)?.primary.destination1).toEqual({ x: 4, y: 18 });
    expect(app.federationOrders.get(3)?.primary.destination1).toEqual({ x: null, y: null });
    expect(app.statusMessage).toBe('1 fed selected, click the beginning of the area, then shift-click the other corner to deploy.');

    app.cancelEntrenchmentOnClickElsewhere(new MouseEvent('click'));
    expect(app.statusMessage).toBe('Selection cleared.');
    expect(app.inMapFederationGroup(1, 'own')).toBe(false);

    app.selectChipMode('xy');

    app.onChipClick(click, 1, 'own');
    app.onCellClick(shift, zone.minX + 6, zone.minY + 2);
    app.selectChipMode('order');
    expect(app.statusMessage).toBe('Selection cleared.');
    expect(app.inMapFederationGroup(2, 'own')).toBe(false);
  });

  it('allows one federation inside the fortress and none on the wall', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onArmySelected(army: string): void;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onChipClick(event: MouseEvent, unitId: number, kind: 'own' | 'enemy'): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      getUnplacedUnits(): Array<{ id: number }>;
      selectedArmySide: 'A' | 'B';
      placements: Map<number, { x: number; y: number }>;
      statusMessage: string;
    };
    const body = readFileSync(resolve(process.cwd(), '../124W0213.txt'), 'utf8');
    const file = new File([body], '124W0213.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    app.onArmySelected('Army A');
    const click = new MouseEvent('click');
    const [first, second, third] = app.getUnplacedUnits();

    app.onPaletteUnitClick(click, first.id);
    app.onCellClick(click, 20, 1);
    expect(app.statusMessage).toBe('Drop rejected: a federation cannot be placed on a fortress wall.');
    expect(app.placements.has(first.id)).toBe(false);

    app.onCellClick(click, 22, 2);
    expect(app.placements.get(first.id)).toEqual({ x: 22, y: 2 });

    app.onPaletteUnitClick(click, second.id);
    app.onCellClick(click, 24, 3);
    expect(app.statusMessage).toBe('Drop rejected: the fortress already holds a federation.');
    expect(app.placements.has(second.id)).toBe(false);

    app.onCellClick(click, 22, 4);
    expect(app.statusMessage).toBe('Drop rejected: a federation cannot be placed on a fortress wall.');
    expect(app.placements.has(second.id)).toBe(false);

    app.onChipClick(new MouseEvent('click', { detail: 2 }), first.id, 'own');
    expect(app.placements.has(first.id)).toBe(false);
    app.onPaletteUnitClick(click, second.id);
    app.onCellClick(click, 22, 4);
    expect(app.placements.has(second.id)).toBe(false);
    app.onCellClick(click, 23, 3);
    expect(app.placements.get(second.id)).toEqual({ x: 23, y: 3 });

    app.onPaletteUnitClick(click, first.id);
    app.onCellClick(click, 22, 1);
    expect(app.statusMessage).toBe('Drop rejected: the fortress already holds a federation.');
    expect(app.placements.has(first.id)).toBe(false);

    app.onPaletteUnitClick(click, third.id);
    app.onCellClick(click, 23, 5);
    expect(app.placements.get(third.id)).toEqual({ x: 23, y: 5 });
  });

  it('marks the next deploy federation in white and the last placed federation in red', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      onPaletteUnitClick(event: MouseEvent, unitId: number): void;
      onCellClick(event: MouseEvent, x: number, y: number): void;
      getUnplacedUnits(): Array<{ id: number }>;
      isNextDeploy(unitId: number): boolean;
      isLastPlaced(unitId: number): boolean;
      setupZones: { A: { minX: number; minY: number; maxX: number; maxY: number }; B: { minX: number; minY: number; maxX: number; maxY: number } };
      selectedArmySide: 'A' | 'B';
    };
    const body = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    const file = new File([body], '124D0113.txt', { type: 'text/plain' });
    await app.onTurnFileSelected({ target: { files: [file], value: '' } } as unknown as Event);
    const click = new MouseEvent('click');
    const [first, second] = app.getUnplacedUnits();
    const zone = app.setupZones[app.selectedArmySide];

    app.onPaletteUnitClick(click, first.id);
    expect(app.isNextDeploy(first.id)).toBe(true);
    expect(app.isNextDeploy(second.id)).toBe(false);
    expect(app.isLastPlaced(first.id)).toBe(false);

    app.onCellClick(click, zone.minX, zone.minY);
    expect(app.isLastPlaced(first.id)).toBe(true);
    expect(app.isNextDeploy(first.id)).toBe(false);
    expect(app.isNextDeploy(second.id)).toBe(true);

    app.onCellClick(click, zone.minX + 1, zone.minY);
    expect(app.isLastPlaced(second.id)).toBe(true);
    expect(app.isLastPlaced(first.id)).toBe(false);
    expect(app.isNextDeploy(second.id)).toBe(false);
  });
});
