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

    const data = await workbook.xlsx.writeBuffer();
    const setup = await service.readSetup(data as ArrayBuffer);

    expect(setup.army).toBe('B');
    expect(setup.generalFederation).toBe(12);
    expect(setup.processDate).toBe('2025-10-16');
    expect(setup.placements).toEqual([
      { id: 4, x: 18, y: 33 },
      { id: 9, x: 19, y: 34 },
    ]);
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

    const filled = await service.fillTemplate(template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength), header, 'A', placements, [
      { x: 12, y: 3 },
      { x: null, y: null },
      { x: null, y: null },
      { x: null, y: null },
      { x: null, y: null },
      { x: 18, y: 8 },
    ]);
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
    expect(sheet?.getCell('D13').value).toBe(11);
    expect(sheet?.getCell('E13').value).toBe(1);
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
    expect(sheet?.getCell('L4').numFmt).toBe('yyyy-mm-dd');
    expect((await service.readSetup(filled)).processDate).toBe('2026-02-17');
    const styles = await JSZip.loadAsync(filled).then((zip) => zip.file('xl/styles.xml')?.async('string'));
    expect(styles).toContain('Sheet1-style');
    expect(styles).toContain('FFEEF7E3');
  });
});
