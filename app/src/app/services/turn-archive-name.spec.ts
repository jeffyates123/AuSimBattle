import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { turnArchiveFolder, turnArchiveName, turnNationGame } from './turn-archive-name';

describe('turnArchiveName', () => {
  it('names a setup from the game, state letter, month, and sim', () => {
    const text = readFileSync(resolve(process.cwd(), '../124D0113.txt'), 'utf8');
    expect(turnArchiveName(text, 'Setup')).toBe('AU-124_D_0113_Sim196_Setup.txt');
    expect(turnArchiveFolder('AU-124_D_0113_Sim196_Setup.txt')).toBe('AU-124_D_0113_Sim196');
    expect(turnNationGame(text)).toEqual({ gameNo: 'AU-124', letter: 'D' });
  });

  it('names a battle result with the Battle suffix', () => {
    const text = [
      'AUSTERLITZ   Game: AU-102                        Prussia',
      'The Rise of the Eagle   Month: August 1815',
      'Simulated battle No. 2 Initial Deployment',
      'AU 102 P',
    ].join('\n');
    expect(turnArchiveName(text, 'Battle')).toBe('AU-102_P_0815_Sim2_Battle.txt');
  });

  it('keeps the original name when the state letter line is missing', () => {
    const text = 'Game: AU-102\nMonth: July 1809\nSimulated battle No. 1\n';
    expect(turnArchiveName(text, 'Setup')).toBeNull();
  });
});