import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { FederationOrder } from './models/battle';

describe('App', () => {
  beforeEach(async () => {
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

  it('should render the load button before a turn is opened', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('button')?.textContent).toContain('Load New Turn');
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
    const chips = app.cellChips((sample!.id % 45) + 1, (sample!.id % 40) + 1);
    expect(chips.some((chip) => chip.unit.id === sample!.id)).toBe(true);
  });
});
