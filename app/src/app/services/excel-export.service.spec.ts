import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { BattleHeader } from '../models/battle';
import { ExcelExportService } from './excel-export.service';

describe('ExcelExportService.readSetup', () => {
  const service = new ExcelExportService();

  it('names the saved workbook from the state and simulation number', () => {
    expect(
      service.fileName({
        state: 'Denmark',
        accountId: null,
        gameId: null,
        playerName: null,
        simulationNumber: 201,
        processDate: null,
        generalFederation: null,
        validationStatus: null,
        army: null,
      }),
    ).toBe('SIM Sheet v0.6-Denmark Sim 201.xlsx');
    expect(
      service.fileName(
        {
          state: 'Denmark',
          accountId: null,
          gameId: null,
          playerName: null,
          simulationNumber: 201,
          processDate: null,
          generalFederation: null,
          validationStatus: null,
          army: null,
        },
        2,
      ),
    ).toBe('SIM Sheet v0.6-Denmark Sim 201_2.xlsx');
  });

  it('treats a saved version as a match when the server does not have it', async () => {
    const header = {
      state: 'Denmark',
      accountId: null,
      gameId: null,
      playerName: null,
      simulationNumber: 201,
      processDate: null,
      generalFederation: null,
      validationStatus: null,
      army: null,
    } as const;
    const version = service.fileName(header, 1);
    service.rememberWorkbook(version, new Uint8Array([1, 2, 3]).buffer);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    try {
      await expect(service.matchingFileNames(header)).resolves.toEqual([version]);
      expect(new Uint8Array(service.readSavedWorkbook(version) ?? new ArrayBuffer(0))).toEqual(
        new Uint8Array([1, 2, 3]),
      );
    } finally {
      globalThis.fetch = originalFetch;
      localStorage.removeItem(`ausim.simsheet.${version}`);
    }
  });

  it('reads army, general federation, and start coordinates', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.getCell('R3').value = 12;
    sheet.getCell('R4').value = 'Army B';
    sheet.getCell('L4').value = 45946;
    sheet.getCell('B13').value = 4;
    sheet.getCell('D13').value = 18;
    sheet.getCell('E13').value = 33;
    sheet.getCell('B14').value = 9;
    sheet.getCell('D14').value = 19;
    sheet.getCell('E14').value = 34;
    sheet.getCell('C13').value = 1;
    sheet.getCell('F13').value = 0;
    sheet.getCell('G13').value = 33;
    sheet.getCell('H13').value = 0;
    sheet.getCell('I13').value = 2;
    sheet.getCell('J13').value = 12;
    sheet.getCell('K13').value = 39;
    sheet.getCell('N13').value = 30;
    sheet.getCell('O13').value = 21;
    sheet.getCell('P13').value = 4;
    sheet.getCell('Q13').value = 3;

    const data = await workbook.xlsx.writeBuffer();
    const setup = await service.readSetup(data as ArrayBuffer);

    expect(setup.army).toBe('B');
    expect(setup.generalFederation).toBe(12);
    expect(setup.processDate).toBe('2025-10-16');
    expect(setup.placements).toEqual([
      { id: 4, x: 18, y: 33 },
      { id: 9, x: 19, y: 34 },
    ]);
    expect(setup.federationOrders).toContainEqual(
      expect.objectContaining({
        federation: 4,
        battalionGroup: 1,
        primary: expect.objectContaining({
          startAttack: 0,
          order: 33,
          additionalOrder: 0,
          formation: 2,
          destination1: { x: 12, y: 39 },
        }),
        alternative: expect.objectContaining({
          condition: 30,
          order: 21,
          additionalOrder: 4,
          formation: 3,
        }),
      }),
    );
    expect(setup.fortressEntrenchments).toEqual(Array.from({ length: 10 }, () => ({ x: null, y: null })));
  });

  it('fills the official template header and only the deployed coordinates', async () => {
    const template = readFileSync(resolve(process.cwd(), 'public/SIM Sheet v0.6-Template.xlsx'));
    const header: BattleHeader = {
      state: 'Conf. of the Rhine',
      accountId: 10008,
      gameId: 'AU-124',
      playerName: 'Christos Karas',
      simulationNumber: 204,
      processDate: '2026-02-17',
      generalFederation: 12,
      validationStatus: null,
      army: 'Army A',
    };
    const placements = new Map([
      [1, { x: 11, y: 1 }],
      [56, { x: 20, y: 4 }],
    ]);

    const federationOrders = new Map([
      [
        1,
        {
          federation: 1,
          battalionGroup: 1,
          start: { x: 11, y: 1 },
          primary: {
            startAttack: 0,
            order: 33,
            additionalOrder: 0,
            formation: 2,
            destination1: { x: 12, y: 2 },
            destination2: { x: null, y: null },
          },
          alternative: {
            condition: 30,
            order: 21,
            additionalOrder: 6,
            formation: 3,
            destination1: { x: 13, y: 3 },
            destination2: { x: null, y: null },
          },
        },
      ],
    ]);
    const filled = await service.fillTemplate(
      template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
      header,
      'A',
      placements,
      federationOrders,
      [
        { x: 12, y: 3 },
        { x: null, y: null },
        { x: null, y: null },
        { x: null, y: null },
        { x: null, y: null },
        { x: 18, y: 8 },
      ],
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(filled);
    const sheet = workbook.getWorksheet('Sheet1');

    expect(sheet?.getCell('C3').value).toBe('Conf. of the Rhine');
    expect(sheet?.getCell('C4').value).toBe(10008);
    expect(sheet?.getCell('F3').value).toBe('AU-124');
    expect(sheet?.getCell('L3').value).toBe(204);
    expect(sheet?.getCell('F4').value).toBe('CHRISTOS KARAS');
    expect(sheet?.getCell('R4').value).toBe('Army A');
    expect(sheet?.getCell('B13').value).toBe(1);
    expect(sheet?.getCell('C13').value).toBe(1);
    expect(sheet?.getCell('D13').value).toBe(11);
    expect(sheet?.getCell('E13').value).toBe(1);
    expect(sheet?.getCell('F13').value).toBe(0);
    expect(sheet?.getCell('G13').value).toBe(33);
    expect(sheet?.getCell('H13').value).toBe(0);
    expect(sheet?.getCell('I13').value).toBe(2);
    expect(sheet?.getCell('J13').value).toBe(12);
    expect(sheet?.getCell('K13').value).toBe(2);
    expect(sheet?.getCell('N13').value).toBe(30);
    expect(sheet?.getCell('O13').value).toBe(21);
    expect(sheet?.getCell('P13').value).toBe(6);
    expect(sheet?.getCell('Q13').value).toBe(3);
    expect(sheet?.getCell('B68').value).toBe(56);
    expect(sheet?.getCell('D68').value).toBe(20);
    expect(sheet?.getCell('E68').value).toBe(4);
    expect(sheet?.getCell('D14').value).toBeNull();
    expect(sheet?.getCell('F6').value).toBe(12);
    expect(sheet?.getCell('G6').value).toBe(3);
    expect(sheet?.getCell('F8').value).toBe(18);
    expect(sheet?.getCell('G8').value).toBe(8);
    const processDate = sheet?.getCell('L4').value;
    expect(processDate).toBeInstanceOf(Date);
    expect((processDate as Date).toISOString()).toBe('2026-02-17T00:00:00.000Z');
    expect(sheet?.getCell('L4').numFmt).toBe('mm-dd-yy');
    const loaded = await service.readSetup(filled);
    expect(loaded.processDate).toBe('2026-02-17');
    expect(loaded.federationOrders).toContainEqual(
      expect.objectContaining({
        federation: 1,
        battalionGroup: 1,
        primary: expect.objectContaining({
          startAttack: 0,
          order: 33,
          additionalOrder: 0,
          formation: 2,
        }),
      }),
    );
    expect(loaded.fortressEntrenchments[0]).toEqual({ x: 12, y: 3 });
    expect(loaded.fortressEntrenchments[1]).toEqual({ x: null, y: null });
    expect(loaded.fortressEntrenchments[5]).toEqual({ x: 18, y: 8 });
    const filledZip = await JSZip.loadAsync(filled);
    const styles = await filledZip.file('xl/styles.xml')?.async('string');
    const templateStyles = await JSZip.loadAsync(template).then((zip) => zip.file('xl/styles.xml')?.async('string'));
    const filledSheet = await filledZip.file('xl/worksheets/sheet1.xml')?.async('string');
    expect(styles).toBe(templateStyles);
    expect(filledSheet).toContain('<c r="C3" s="53" t="inlineStr">');
    expect(filledSheet).toContain('<c r="D13" s="37"><v>11</v></c>');
    expect(filledSheet).toMatch(/<c r="D68" s="\d+"><v>20<\/v><\/c>/);
    const filledTable = await filledZip.file('xl/tables/table1.xml')?.async('string');
    const templateTable = await JSZip.loadAsync(template).then((zip) => zip.file('xl/tables/table1.xml')?.async('string'));
    expect(filledTable).toBe(templateTable);
  });
});
