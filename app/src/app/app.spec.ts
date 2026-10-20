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
      onChipContextMenu(event: MouseEvent, unitId: number, kind: 'own'): void;
      confirmValueEntry(event: Event): void;
      keepEnteredValue(): void;
      paintValueToAll(): void;
      paintValueToSameType(): void;
      chipText(unit: { id: number }): string;
      selectedArmy: { units: Array<{ id: number; troopCode: string }> } | null;
      valueEntry: { draft: string; error: string } | null;
      valueAction: { value: number } | null;
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
    expect(app.chipText(first)).toBe('');

    app.selectChipMode('order');
    app.onPaletteUnitClick(click, 2);
    app.valueEntry!.draft = '7';
    app.confirmValueEntry(new Event('submit'));
    expect(app.valueEntry?.error).toContain('not a valid order');
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
      onCellContextMenu(event: MouseEvent, x: number, y: number): void;
      selectChipMode(mode: 'fedType' | 'fedNo' | 'battalionGroup'): void;
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

    app.onCellContextMenu(new MouseEvent('contextmenu'), zone.minX, zone.minY);
    expect(app.federationOrders.has(9)).toBe(false);
    app.selectChipMode('fedNo');
    expect(text(9)).toBe('');

    app.onPaletteUnitClick(click, 4);
    app.onCellClick(click, zone.minX, zone.minY);
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
    expect(app.federationOrders.get(1)?.primary.destination1).toEqual({ x: null, y: null });
    expect(app.statusMessage).toContain('setup area');
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

  it('keeps a placed chip on its start coordinate until a destination is shown', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      onTurnFileSelected(event: Event): Promise<void>;
      selectChipMode(mode: 'order' | 'destination1' | 'destination2'): void;
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
    app.onPaletteUnitClick(click, 1);
    app.onCellClick(click, x, y);
    expect(app.federationOrders.get(1)?.start).toEqual({ x, y });
    app.selectChipMode('order');
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
    const orderRow = app.federationOrders.get(1)!;
    orderRow.primary.destination2 = { x: 4, y: 22 };
    app.selectChipMode('destination2');
    expect(app.cellChips(4, 22).some((chip) => chip.unit.id === 1)).toBe(true);
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(false);
    app.selectChipMode('order');
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
    app.selectChipMode('destination1');
    expect(app.cellChips(x, y).some((chip) => chip.unit.id === 1)).toBe(true);
  });

  it('should render the load button before a turn is opened', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const labels = Array.from(compiled.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');
    expect(labels).toContain('Load New Turn');
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
});
