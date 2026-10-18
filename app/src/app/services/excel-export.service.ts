import { Injectable } from '@angular/core';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { BattleHeader, FederationOrder } from '../models/battle';
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
  federationOrders: FederationOrder[];
  fortressEntrenchments: Array<{ x: number | null; y: number | null }>;
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  private readonly templateUrl = 'SIM%20Sheet%20v0.6-Template.xlsx';
  private readonly savedPrefix = 'ausim.simsheet.';
  async exportSetup(
    header: BattleHeader,
    army: ArmySide,
    placements: Map<number, Coordinate>,
    federationOrders: Map<number, FederationOrder>,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }> = [],
    downloadName?: string,
  ): Promise<void> {
    const template = await fetch(this.templateUrl);
    if (!template.ok) {
      throw new Error('The SIM sheet template could not be loaded.');
    }
    const out = await this.fillTemplate(
      await template.arrayBuffer(),
      header,
      army,
      placements,
      federationOrders,
      fortressEntrenchments,
    );
    const fileName = downloadName ?? this.fileName(header);
    this.rememberWorkbook(fileName, out);
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    this.downloadBlob(blob, fileName);
  }

  async fillTemplate(
    template: ArrayBuffer,
    header: BattleHeader,
    army: ArmySide,
    placements: Map<number, Coordinate>,
    federationOrders: Map<number, FederationOrder>,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }> = [],
  ): Promise<ArrayBuffer> {
    const zip = await JSZip.loadAsync(template);
    const sheetFile = zip.file('xl/worksheets/sheet1.xml');
    if (!sheetFile) {
      throw new Error('The SIM sheet template has no sheet to fill.');
    }

    let sheetXml = await sheetFile.async('string');
    sheetXml = this.writeHeaderXml(sheetXml, header, army);
    sheetXml = this.writeFortressXml(sheetXml, fortressEntrenchments);
    sheetXml = this.writeFederationOrdersXml(sheetXml, federationOrders);
    sheetXml = this.writePlacementsXml(sheetXml, placements);
    zip.file('xl/worksheets/sheet1.xml', sheetXml);
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  async readSetup(data: ArrayBuffer): Promise<SimSheetSetup> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data);
    const sheet = workbook.getWorksheet('Sheet1') ?? workbook.worksheets[0];
    if (!sheet) {
      throw new Error('This workbook has no sheet to read.');
    }

    const placements: SimSheetPlacement[] = [];
    const federationOrders: FederationOrder[] = [];
    for (let row = 13; row <= 122; row += 1) {
      const id = this.cellNumber(sheet.getCell(`B${row}`).value);
      if (id === null) {
        continue;
      }
      const orderRow = this.readFederationOrderRow(sheet, row, id);
      if (this.hasFederationOrderData(orderRow)) {
        federationOrders.push(orderRow);
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
      federationOrders,
      fortressEntrenchments: this.readFortress(sheet),
    };
  }

  private readFederationOrderRow(sheet: ExcelJS.Worksheet, row: number, id: number): FederationOrder {
    return {
      federation: id,
      battalionGroup: this.cellNumber(sheet.getCell(`C${row}`).value),
      start: {
        x: this.cellNumber(sheet.getCell(`D${row}`).value),
        y: this.cellNumber(sheet.getCell(`E${row}`).value),
      },
      primary: {
        startAttack: this.cellNumber(sheet.getCell(`F${row}`).value),
        order: this.cellNumber(sheet.getCell(`G${row}`).value),
        additionalOrder: this.cellNumber(sheet.getCell(`H${row}`).value),
        formation: this.cellNumber(sheet.getCell(`I${row}`).value),
        destination1: {
          x: this.cellNumber(sheet.getCell(`J${row}`).value),
          y: this.cellNumber(sheet.getCell(`K${row}`).value),
        },
        destination2: {
          x: this.cellNumber(sheet.getCell(`L${row}`).value),
          y: this.cellNumber(sheet.getCell(`M${row}`).value),
        },
      },
      alternative: {
        condition: this.cellNumber(sheet.getCell(`N${row}`).value),
        order: this.cellNumber(sheet.getCell(`O${row}`).value),
        additionalOrder: this.cellNumber(sheet.getCell(`P${row}`).value),
        formation: this.cellNumber(sheet.getCell(`Q${row}`).value),
        destination1: {
          x: this.cellNumber(sheet.getCell(`R${row}`).value),
          y: this.cellNumber(sheet.getCell(`S${row}`).value),
        },
        destination2: {
          x: this.cellNumber(sheet.getCell(`T${row}`).value),
          y: this.cellNumber(sheet.getCell(`U${row}`).value),
        },
      },
    };
  }

  private hasFederationOrderData(orderRow: FederationOrder): boolean {
    return (
      orderRow.battalionGroup !== null ||
      orderRow.start.x !== null ||
      orderRow.start.y !== null ||
      orderRow.primary.startAttack !== null ||
      orderRow.primary.order !== null ||
      orderRow.primary.additionalOrder !== null ||
      orderRow.primary.formation !== null ||
      orderRow.primary.destination1.x !== null ||
      orderRow.primary.destination1.y !== null ||
      orderRow.primary.destination2.x !== null ||
      orderRow.primary.destination2.y !== null ||
      orderRow.alternative.condition !== null ||
      orderRow.alternative.order !== null ||
      orderRow.alternative.additionalOrder !== null ||
      orderRow.alternative.formation !== null ||
      orderRow.alternative.destination1.x !== null ||
      orderRow.alternative.destination1.y !== null ||
      orderRow.alternative.destination2.x !== null ||
      orderRow.alternative.destination2.y !== null
    );
  }

  private readFortress(sheet: ExcelJS.Worksheet): Array<{ x: number | null; y: number | null }> {
    const columns = [
      ['F', 'G'],
      ['I', 'J'],
      ['L', 'M'],
      ['O', 'P'],
      ['R', 'S'],
    ];
    return Array.from({ length: 10 }, (_, index) => {
      const row = index < 5 ? 6 : 8;
      const [xColumn, yColumn] = columns[index % 5];
      return {
        x: this.cellNumber(sheet.getCell(`${xColumn}${row}`).value),
        y: this.cellNumber(sheet.getCell(`${yColumn}${row}`).value),
      };
    });
  }

  private writeHeaderXml(sheetXml: string, header: BattleHeader, army: ArmySide): string {
    let xml = sheetXml;
    xml = this.setTextCell(xml, 'C3', header.state);
    xml = this.setTextCell(xml, 'F3', header.gameId);
    xml = this.setNumberCell(xml, 'L3', header.simulationNumber);
    xml = this.setNumberCell(xml, 'R3', header.generalFederation);
    xml = this.setNumberCell(xml, 'C4', header.accountId);
    xml = this.setTextCell(xml, 'F4', header.playerName?.toUpperCase() ?? null);
    xml = this.setNumberCell(xml, 'L4', this.toExcelDateSerial(header.processDate));
    xml = this.setTextCell(xml, 'R4', army === 'A' ? 'Army A' : 'Army B');
    return xml;
  }

  private writeFortressXml(
    sheetXml: string,
    fortressEntrenchments: Array<{ x: number | null; y: number | null }>,
  ): string {
    const columns = [
      ['F', 'G'],
      ['I', 'J'],
      ['L', 'M'],
      ['O', 'P'],
      ['R', 'S'],
    ];
    let xml = sheetXml;
    fortressEntrenchments.slice(0, 10).forEach((slot, index) => {
      const row = index < 5 ? 6 : 8;
      const [xColumn, yColumn] = columns[index % 5];
      xml = this.setNumberCell(xml, `${xColumn}${row}`, slot.x);
      xml = this.setNumberCell(xml, `${yColumn}${row}`, slot.y);
    });
    return xml;
  }

  private writePlacementsXml(sheetXml: string, placements: Map<number, Coordinate>): string {
    let xml = sheetXml;
    placements.forEach((coord, id) => {
      if (id < 1 || id > 110) {
        return;
      }
      const row = 12 + id;
      xml = this.setNumberCell(xml, `D${row}`, coord.x);
      xml = this.setNumberCell(xml, `E${row}`, coord.y);
    });
    return xml;
  }

  private writeFederationOrdersXml(sheetXml: string, federationOrders: Map<number, FederationOrder>): string {
    let xml = sheetXml;
    federationOrders.forEach((orderRow, id) => {
      if (id < 1 || id > 110) {
        return;
      }
      const row = 12 + id;
      xml = this.setNumberCell(xml, `C${row}`, orderRow.battalionGroup);
      xml = this.setNumberCell(xml, `F${row}`, orderRow.primary.startAttack);
      xml = this.setNumberCell(xml, `G${row}`, orderRow.primary.order);
      xml = this.setNumberCell(xml, `H${row}`, orderRow.primary.additionalOrder);
      xml = this.setNumberCell(xml, `I${row}`, orderRow.primary.formation);
      xml = this.setNumberCell(xml, `J${row}`, orderRow.primary.destination1.x);
      xml = this.setNumberCell(xml, `K${row}`, orderRow.primary.destination1.y);
      xml = this.setNumberCell(xml, `L${row}`, orderRow.primary.destination2.x);
      xml = this.setNumberCell(xml, `M${row}`, orderRow.primary.destination2.y);
      xml = this.setNumberCell(xml, `N${row}`, orderRow.alternative.condition);
      xml = this.setNumberCell(xml, `O${row}`, orderRow.alternative.order);
      xml = this.setNumberCell(xml, `P${row}`, orderRow.alternative.additionalOrder);
      xml = this.setNumberCell(xml, `Q${row}`, orderRow.alternative.formation);
      xml = this.setNumberCell(xml, `R${row}`, orderRow.alternative.destination1.x);
      xml = this.setNumberCell(xml, `S${row}`, orderRow.alternative.destination1.y);
      xml = this.setNumberCell(xml, `T${row}`, orderRow.alternative.destination2.x);
      xml = this.setNumberCell(xml, `U${row}`, orderRow.alternative.destination2.y);
    });
    return xml;
  }

  private setTextCell(sheetXml: string, address: string, value: string | null): string {
    if (!value) {
      return sheetXml;
    }
    return this.replaceCell(sheetXml, address, ` t="inlineStr"><is><t xml:space="preserve">${this.escapeXml(value)}</t></is></c>`);
  }

  private setNumberCell(sheetXml: string, address: string, value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return sheetXml;
    }
    return this.replaceCell(sheetXml, address, `><v>${value}</v></c>`);
  }

  private replaceCell(sheetXml: string, address: string, inner: string): string {
    const pattern = new RegExp(`<c r="${address}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const match = pattern.exec(sheetXml);
    if (!match) {
      return sheetXml;
    }
    const attrs = match[1].replace(/\s+t="[^"]*"/g, '');
    return `${sheetXml.slice(0, match.index)}<c r="${address}"${attrs}${inner}${sheetXml.slice(match.index + match[0].length)}`;
  }

  private escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  fileName(header: BattleHeader, version?: number): string {
    const state = (header.state ?? 'Unknown').replace(/[\\/:*?"<>|]/g, '').trim() || 'Unknown';
    const sim = header.simulationNumber ?? 'Unknown';
    const suffix = version ? `_${version}` : '';
    return `SIM Sheet v0.6-${state} Sim ${sim}${suffix}.xlsx`;
  }

  async matchingFileNames(header: BattleHeader): Promise<string[]> {
    const saved = new Set(this.savedNames(header));
    const names = new Set<string>();
    const base = this.fileName(header);
    if (saved.has(base) || (await this.workbookExists(base))) {
      names.add(base);
    }
    for (let version = 1; version <= 99; version += 1) {
      const name = this.fileName(header, version);
      if (saved.has(name) || (await this.workbookExists(name))) {
        names.add(name);
        continue;
      }
      break;
    }
    return [...names].sort((left, right) => this.versionNumber(base, left) - this.versionNumber(base, right));
  }

  rememberWorkbook(fileName: string, data: ArrayBuffer): void {
    localStorage.setItem(this.savedKey(fileName), this.toBase64(data));
  }

  readSavedWorkbook(fileName: string): ArrayBuffer | null {
    const stored = localStorage.getItem(this.savedKey(fileName));
    if (!stored) {
      return null;
    }
    try {
      return this.fromBase64(stored);
    } catch {
      return null;
    }
  }

  private savedNames(header: BattleHeader): string[] {
    const base = this.fileName(header);
    const stem = base.replace(/\.xlsx$/i, '');
    const names: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(this.savedPrefix)) {
        continue;
      }
      const name = key.slice(this.savedPrefix.length);
      if (name === base || new RegExp(`^${this.escapeRegExp(stem)}_\\d+\\.xlsx$`, 'i').test(name)) {
        names.push(name);
      }
    }
    return names;
  }

  private versionNumber(base: string, fileName: string): number {
    if (fileName === base) {
      return 0;
    }
    const match = fileName.match(/_(\d+)\.xlsx$/i);
    return match ? Number(match[1]) : 0;
  }

  private savedKey(fileName: string): string {
    return `${this.savedPrefix}${fileName}`;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private toBase64(data: ArrayBuffer): string {
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
  }

  private fromBase64(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }

  private async workbookExists(fileName: string): Promise<boolean> {
    const response = await fetch(`sim-sheets/${encodeURIComponent(fileName)}`, { cache: 'no-store' });
    if (!response.ok) {
      return false;
    }
    const buffer = await response.arrayBuffer();
    const signature = new Uint8Array(buffer, 0, 2);
    return signature[0] === 0x50 && signature[1] === 0x4b;
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
