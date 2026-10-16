import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appDir, '..');
const destination = join(appDir, 'public', 'sim-sheets');

mkdirSync(destination, { recursive: true });

for (const name of readdirSync(repoRoot)) {
  if (name.startsWith('~$') || !/^SIM Sheet v0\.6-.+\.xlsx$/i.test(name)) {
    continue;
  }
  copyFileSync(join(repoRoot, name), join(destination, name));
}
