import { Injectable } from '@angular/core';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { BattleHeader } from '../models/battle';
import { ArmySide, Coordinate } from '../models/turn';

export interface SimSheetPlacement {
  id: number;
  x: number;
  y: number;
}

export interface SimSheetSetup {
  army: ArmySide | null;
  generalFederation: number | null;
  processDate: string | null;
  placements: SimSheetPlacement[];
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  private readonly templateUrl = 'SIM%20Sheet%20v0.6-Template.xlsx';
  async exportSetup(
    header: BattleHeader,
    army: ArmySide,
    placements: Map<number, Coordinate>,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }> = [],
  ): Promise<void> {
    const template = await fetch(this.templateUrl);
    if (!template.ok) {
      throw new Error('The SIM sheet template could not be loaded.');
    }
    const out = await this.fillTemplate(await template.arrayBuffer(), header, army, placements, fortressEntrenchments);
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    this.downloadBlob(blob, this.fileName(header));
  }

  async fillTemplate(
    template: ArrayBuffer,
    header: BattleHeader,
    army: ArmySide,
    placements: Map<number, Coordinate>,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }> = [],
  ): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template);
    const sheet = workbook.getWorksheet('Sheet1') ?? workbook.worksheets[0];
    if (!sheet) {
      throw new Error('The SIM sheet template has no sheet to fill.');
    }

    this.writeHeader(sheet, header, army);
    this.writeFortress(sheet, fortressEntrenchments);
    this.writePlacements(sheet, placements);

    const out = await workbook.xlsx.writeBuffer();
    return this.preserveTemplateFormatting(out as ArrayBuffer, template);
  }

  async readSetup(data: ArrayBuffer): Promise<SimSheetSetup> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data);
    const sheet = workbook.getWorksheet('Sheet1') ?? workbook.worksheets[0];
    if (!sheet) {
      throw new Error('This workbook has no sheet to read.');
    }

    const placements: SimSheetPlacement[] = [];
    for (let row = 13; row <= 122; row += 1) {
      const id = this.cellNumber(sheet.getCell(`B${row}`).value);
      if (id === null) {
        continue;
      }
      const x = this.cellNumber(sheet.getCell(`D${row}`).value);
      const y = this.cellNumber(sheet.getCell(`E${row}`).value);
      if (x === null || y === null) {
        continue;
      }
      placements.push({ id, x, y });
    }

    return {
      army: this.armySide(sheet.getCell('R4').value),
      generalFederation: this.cellNumber(sheet.getCell('R3').value),
      processDate: this.cellDate(sheet.getCell('L4').value),
      placements,
    };
  }

  private writeHeader(sheet: ExcelJS.Worksheet, header: BattleHeader, army: ArmySide): void {
    this.writeText(sheet, 'C3', header.state);
    this.writeText(sheet, 'F3', header.gameId);
    this.writeNumber(sheet, 'L3', header.simulationNumber);
    this.writeNumber(sheet, 'R3', header.generalFederation);

    this.writeNumber(sheet, 'C4', header.accountId);
    this.writeText(sheet, 'F4', header.playerName?.toUpperCase() ?? null);
    const processDate = this.toExcelDateSerial(header.processDate);
    if (processDate !== null) {
      const cell = sheet.getCell('L4');
      cell.value = processDate;
      cell.numFmt = 'yyyy-mm-dd';
    }
    sheet.getCell('R4').value = army === 'A' ? 'Army A' : 'Army B';
  }

  private writeFortress(
    sheet: ExcelJS.Worksheet,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }>,
  ): void {
    const columns = [
      ['F', 'G'],
      ['I', 'J'],
      ['L', 'M'],
      ['O', 'P'],
      ['R', 'S'],
    ];
    fortressEntrenchments.slice(0, 10).forEach((slot, index) => {
      const row = index < 5 ? 6 : 8;
      const [xColumn, yColumn] = columns[index % 5];
      this.writeNumber(sheet, `${xColumn}${row}`, slot.x);
      this.writeNumber(sheet, `${yColumn}${row}`, slot.y);
    });
  }

  private writePlacements(sheet: ExcelJS.Worksheet, placements: Map<number, Coordinate>): void {
    placements.forEach((coord, id) => {
      if (id < 1 || id > 110) {
        return;
      }
      const row = 12 + id;
      sheet.getCell(`D${row}`).value = coord.x;
      sheet.getCell(`E${row}`).value = coord.y;
    });
  }

  private async preserveTemplateFormatting(output: ArrayBuffer, template: ArrayBuffer): Promise<ArrayBuffer> {
    const [templateZip, outputZip] = await Promise.all([JSZip.loadAsync(template), JSZip.loadAsync(output)]);
    const templateStyles = await templateZip.file('xl/styles.xml')?.async('string');
    const outputStyles = await outputZip.file('xl/styles.xml')?.async('string');
    if (!templateStyles || !outputStyles) {
      return output;
    }

    const dxfs = templateStyles.match(/<dxfs[\s\S]*?<\/dxfs>|<dxfs[^>]*\/>/)?.[0];
    const tableStyles = templateStyles
      .match(/<tableStyles[\s\S]*?<\/tableStyles>/)?.[0]
      ?.replace(/\s+xr9:uid="[^"]*"/g, '');
    let styles = outputStyles;
    if (dxfs) {
      styles = styles.replace(/<dxfs[\s\S]*?<\/dxfs>|<dxfs[^>]*\/>/, dxfs);
    }
    if (tableStyles) {
      if (/<tableStyles[\s\S]*?<\/tableStyles>/.test(styles)) {
        styles = styles.replace(/<tableStyles[\s\S]*?<\/tableStyles>/, tableStyles);
      } else {
        styles = styles.replace('</styleSheet>', `${tableStyles}</styleSheet>`);
      }
    }

    outputZip.file('xl/styles.xml', styles);
    return outputZip.generateAsync({ type: 'arraybuffer' });
  }

  private writeText(sheet: ExcelJS.Worksheet, address: string, value: string | null): void {
    if (value) {
      sheet.getCell(address).value = value;
    }
  }

  private writeNumber(sheet: ExcelJS.Worksheet, address: string, value: number | null): void {
    if (value !== null && value !== undefined) {
      sheet.getCell(address).value = value;
    }
  }

  fileName(header: BattleHeader): string {
    const state = (header.state ?? 'Unknown').replace(/[\\/:*?"<>|]/g, '').trim() || 'Unknown';
    const sim = header.simulationNumber ?? 'Unknown';
    return `SIM Sheet v0.6-${state} Sim ${sim}.xlsx`;
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toExcelDateSerial(isoDate: string | null): number | null {
    const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      return null;
    }
    const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const excelEpoch = Date.UTC(1899, 11, 30);
    return Math.round((utc - excelEpoch) / 86_400_000);
  }

  private cellNumber(value: ExcelJS.CellValue): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
    if (value && typeof value === 'object' && 'result' in value) {
      return this.cellNumber(value.result as ExcelJS.CellValue);
    }
    return null;
  }

  private armySide(value: ExcelJS.CellValue): ArmySide | null {
    const text = typeof value === 'string' ? value : value && typeof value === 'object' && 'result' in value ? String(value.result ?? '') : '';
    if (text.includes('Army B')) {
      return 'B';
    }
    if (text.includes('Army A')) {
      return 'A';
    }
    return null;
  }

  private cellDate(value: ExcelJS.CellValue): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${value.getFullYear()}-${month}-${day}`;
    }
    const serial = this.cellNumber(value);
    if (serial === null) {
      return null;
    }
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  }

}
