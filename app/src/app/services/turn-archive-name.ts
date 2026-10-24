const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

export type TurnSheetKind = 'Setup' | 'Battle';

export function turnNationGame(text: string): { gameNo: string; letter: string } | null {
  const gameMatch = text.match(/Game:\s*([A-Z]{2}-\d+)/i);
  if (!gameMatch) {
    return null;
  }
  const gameNo = gameMatch[1].toUpperCase();
  const gameDigits = gameNo.split('-')[1] ?? '';
  const letters = [...text.matchAll(/\bAU\s+(\d+)\s+([A-Z])\b/g)];
  const letter = letters.find((match) => match[1] === gameDigits)?.[2] ?? letters[0]?.[2];
  return letter ? { gameNo, letter } : null;
}

export function turnArchiveName(text: string, kind: TurnSheetKind): string | null {
  const identity = turnNationGame(text);
  const monthMatch = text.match(/Month:\s*([A-Za-z]+)\s+(\d{4})/i);
  const simMatch = text.match(/Simulated battle No\.\s*(\d+)/i);
  if (!identity || !monthMatch || !simMatch) {
    return null;
  }
  const month = MONTHS[monthMatch[1].toLowerCase()];
  if (!month) {
    return null;
  }
  const year = monthMatch[2].slice(-2);
  return `${identity.gameNo}_${identity.letter}_${month}${year}_Sim${simMatch[1]}_${kind}.txt`;
}

export function turnArchiveFolder(fileName: string): string | null {
  const match = fileName.match(/^([A-Z]{2}-\d+_[A-Z]_\d{4}_Sim\d+)_(?:Setup|Battle)\.txt$/);
  return match?.[1] ?? null;
}
