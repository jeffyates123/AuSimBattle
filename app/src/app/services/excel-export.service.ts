import { Injectable } from '@angular/core';
import ExcelJS from 'exceljs';
import { BattleHeader } from '../models/battle';
import { ArmySide, Coordinate, FederationUnit } from '../models/turn';

@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  async exportSetup(
    header: BattleHeader,
    army: ArmySide,
    units: FederationUnit[],
    placements: Map<number, Coordinate>,
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    this.seedHeaders(sheet);
    this.writeHeader(sheet, header, army);
    this.writeFederations(sheet, units, placements);

    const out = await workbook.xlsx.writeBuffer();
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileName = this.buildFileName(header, army);
    this.downloadBlob(blob, fileName);
  }

  private writeHeader(sheet: ExcelJS.Worksheet, header: BattleHeader, army: ArmySide): void {
    sheet.getCell('C3').value = header.state ?? '';
    sheet.getCell('F3').value = header.gameId ?? '';
    sheet.getCell('L3').value = header.simulationNumber ?? '';
    sheet.getCell('R3').value = header.generalFederation ?? '';

    sheet.getCell('C4').value = header.accountId ?? '';
    sheet.getCell('F4').value = header.playerName ?? '';
    sheet.getCell('L4').value = this.toExcelSerial(header.processDate ?? null);
    sheet.getCell('R4').value = army === 'A' ? 'Army A' : 'Army B';
  }

  private writeFederations(
    sheet: ExcelJS.Worksheet,
    units: FederationUnit[],
    placements: Map<number, Coordinate>,
  ): void {
    // 110 rows covers all known battle sizes and clears sample rows.
    for (let row = 13; row <= 122; row += 1) {
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'].forEach(
        (col) => {
          sheet.getCell(`${col}${row}`).value = null;
        },
      );
    }

    const sorted = [...units].sort((a, b) => a.id - b.id);
    sorted.forEach((unit, index) => {
      const row = 13 + index;
      const placement = placements.get(unit.id);
      sheet.getCell(`B${row}`).value = unit.id;
      sheet.getCell(`C${row}`).value = null;
      sheet.getCell(`D${row}`).value = placement?.x ?? null;
      sheet.getCell(`E${row}`).value = placement?.y ?? null;
    });
  }

  private seedHeaders(sheet: ExcelJS.Worksheet): void {
    sheet.getCell('B3').value = 'State:';
    sheet.getCell('E3').value = 'Game:';
    sheet.getCell('J3').value = 'SimNumber';
    sheet.getCell('N3').value = 'General is in Federation (7.2.3.1):';
    sheet.getCell('B4').value = 'Account:';
    sheet.getCell('E4').value = 'Player:';
    sheet.getCell('J4').value = 'Process Date';
    sheet.getCell('N4').value = 'Army A or Army B?';
    sheet.getCell('B11').value = 'Battalion';
    sheet.getCell('F11').value = 'Start';
    sheet.getCell('N11').value = 'Alt';
    sheet.getCell('B12').value = 'Fed';
    sheet.getCell('C12').value = 'Group';
    sheet.getCell('D12').value = 'x';
    sheet.getCell('E12').value = 'y';
    sheet.getCell('F12').value = 'Attack';
    sheet.getCell('G12').value = 'Order';
    sheet.getCell('H12').value = 'Order';
    sheet.getCell('I12').value = 'Formation';

    sheet.columns = [
      { width: 4 },
      { width: 9 },
      { width: 9 },
      { width: 6 },
      { width: 6 },
      { width: 8 },
      { width: 8 },
      { width: 10 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
    ];
  }

  private buildFileName(header: BattleHeader, army: ArmySide): string {
    const game = (header.gameId ?? 'AU-Unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
    const sim = header.simulationNumber ?? 0;
    return `${game}_Sim_${sim}_Army_${army}.xlsx`;
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toExcelSerial(isoDate: string | null): number | null {
    if (!isoDate) {
      return null;
    }
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)).getTime();
    return Math.floor((date.getTime() - excelEpoch) / 86_400_000);
  }
}
