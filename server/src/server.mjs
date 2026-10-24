import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const appDist = path.resolve(repoRoot, process.env.APP_DIST ?? 'app/dist/ausim-battle/browser');
const dataRoot = path.resolve(repoRoot, process.env.DATA_ROOT ?? 'server/data/battles');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

const sessions = new Map();
const sessionCookie = 'ausim_session';
const cookieSecure = process.env.COOKIE_SECURE !== 'false';
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS ?? 24) * 60 * 60 * 1000;

const users = [
  {
    username: 'autest',
    isAdmin: false,
    password: requiredEnv('AUTH_AUTEST_PASSWORD'),
  },
  {
    username: 'auAdmin',
    isAdmin: true,
    password: requiredEnv('AUTH_AUADMIN_PASSWORD'),
  },
].map((user) => ({
  ...user,
  salt: crypto.randomBytes(16),
}));

async function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

async function validatePassword(password, user) {
  const expected = await hashPassword(user.password, user.salt);
  const candidate = await hashPassword(password, user.salt);
  return crypto.timingSafeEqual(expected, candidate);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function jsonError(response, status, message) {
  response.status(status).json({ error: message });
}

function parseCookie(header) {
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim().split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value)]),
  );
}

function setSessionCookie(response, token) {
  const attrs = [
    `${sessionCookie}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  ];
  if (cookieSecure) {
    attrs.push('Secure');
  }
  response.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(response) {
  const attrs = [
    `${sessionCookie}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (cookieSecure) {
    attrs.push('Secure');
  }
  response.setHeader('Set-Cookie', attrs.join('; '));
}

function readSession(request) {
  const cookies = parseCookie(request.headers.cookie);
  const token = cookies[sessionCookie];
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionTtlMs;
  return { token, ...session };
}

function requireAuth(request, response, next) {
  const session = readSession(request);
  if (!session) {
    jsonError(response, 401, 'Sign in required.');
    return;
  }
  request.session = session;
  next();
}

function requireAdmin(request, response, next) {
  if (!request.session?.isAdmin) {
    jsonError(response, 403, 'Admin access required.');
    return;
  }
  next();
}

function battleDir(id) {
  const name = String(id);
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error('Invalid battle id.');
  }
  return path.join(dataRoot, name);
}

function battleFile(id, name) {
  return path.join(battleDir(id), name);
}

async function readBattleMeta(id) {
  const text = await fs.readFile(battleFile(id, 'meta.json'), 'utf8');
  return JSON.parse(text);
}

async function writeBattleMeta(id, meta) {
  await fs.writeFile(battleFile(id, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function listBattleIds() {
  try {
    const entries = await fs.readdir(dataRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function buildBattleRecord(body, session) {
  const createdAt = new Date().toISOString();
  return {
    id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    createdAt,
    account: session.username,
    isAdmin: session.isAdmin,
    displayName: session.displayName,
    turnFileName: body.fileName,
    gameId: body.gameId ?? null,
    simulationNumber: body.simulationNumber ?? null,
    army: body.army ?? null,
    parseError: body.parseError ?? null,
    sheetFileName: null,
    sheetStoredAt: null,
  };
}

app.post('/api/login', async (request, response) => {
  const { username, password, displayName, consent } = request.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    jsonError(response, 400, 'Username and password are required.');
    return;
  }
  if (typeof displayName !== 'string' || !displayName.trim()) {
    jsonError(response, 400, 'Display name is required.');
    return;
  }
  if (consent !== true) {
    jsonError(response, 400, 'Consent is required.');
    return;
  }
  const user = users.find((item) => item.username === username);
  if (!user || !(await validatePassword(password, user))) {
    jsonError(response, 401, 'Invalid username or password.');
    return;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, {
    username: user.username,
    isAdmin: user.isAdmin,
    displayName: displayName.trim(),
    consentedAt: new Date().toISOString(),
    expiresAt: Date.now() + sessionTtlMs,
  });
  setSessionCookie(response, token);
  response.json({
    username: user.username,
    isAdmin: user.isAdmin,
    displayName: displayName.trim(),
  });
});

app.post('/api/logout', requireAuth, (request, response) => {
  sessions.delete(request.session.token);
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get('/api/me', (request, response) => {
  const session = readSession(request);
  if (!session) {
    jsonError(response, 401, 'Sign in required.');
    return;
  }
  response.json({
    username: session.username,
    isAdmin: session.isAdmin,
    displayName: session.displayName,
  });
});

app.get('/api/setup-terrain', requireAuth, async (request, response) => {
  const game = firstQuery(request.query.game);
  const letter = firstQuery(request.query.letter).toUpperCase();
  const sim = firstQuery(request.query.sim);
  if (!/^[A-Z]{2}-\d+$/.test(game) || !/^[A-Z]$/.test(letter) || !/^\d+$/.test(sim)) {
    jsonError(response, 400, 'Game, nation, and sim are required.');
    return;
  }
  const setup = await findSetupTurn(game, letter, sim);
  if (!setup) {
    jsonError(response, 404, 'No setup turn stored for that nation, game, and sim.');
    return;
  }
  response.json(setup);
});

app.post('/api/battles', requireAuth, async (request, response) => {
  const { fileName, turnText } = request.body ?? {};
  if (typeof fileName !== 'string' || !fileName.trim()) {
    jsonError(response, 400, 'fileName is required.');
    return;
  }
  if (typeof turnText !== 'string') {
    jsonError(response, 400, 'turnText is required.');
    return;
  }

  const record = buildBattleRecord(request.body, request.session);
  const folder = archiveFolderName(record.turnFileName);
  if (folder) {
    record.id = folder;
    try {
      const existing = await readBattleMeta(folder);
      record.createdAt = existing.createdAt || record.createdAt;
      record.sheetFileName = existing.sheetFileName ?? null;
      record.sheetStoredAt = existing.sheetStoredAt ?? null;
    } catch {
      // First copy for this game and sim.
    }
  }
  const dir = battleDir(record.id);
  const storedTurnFile = storedTurnFileName(record.turnFileName);
  record.turnStoredFile = storedTurnFile;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, storedTurnFile), turnText, 'utf8');
  await writeBattleMeta(record.id, record);
  response.json({ id: record.id });
});

app.post('/api/battles/:id/sheet', requireAuth, async (request, response) => {
  const { id } = request.params;
  const { fileName, sheetBase64 } = request.body ?? {};
  if (typeof fileName !== 'string' || !fileName.trim()) {
    jsonError(response, 400, 'fileName is required.');
    return;
  }
  if (typeof sheetBase64 !== 'string' || !sheetBase64.trim()) {
    jsonError(response, 400, 'sheetBase64 is required.');
    return;
  }
  let meta;
  try {
    meta = await readBattleMeta(id);
  } catch {
    jsonError(response, 404, 'Battle not found.');
    return;
  }
  const isOwner = meta.account === request.session.username;
  if (!isOwner && !request.session.isAdmin) {
    jsonError(response, 403, 'This battle belongs to another account.');
    return;
  }
  const bytes = Buffer.from(sheetBase64, 'base64');
  const storedSheetFile = storedSheetFileName(id, fileName);
  await fs.writeFile(battleFile(id, storedSheetFile), bytes);
  meta.sheetFileName = storedSheetFile;
  meta.sheetStoredFile = storedSheetFile;
  meta.sheetStoredAt = new Date().toISOString();
  await writeBattleMeta(id, meta);
  response.json({ ok: true });
});

app.get('/api/admin/battles', requireAuth, requireAdmin, async (_request, response) => {
  const ids = await listBattleIds();
  const battles = [];
  for (const id of ids) {
    try {
      const meta = await readBattleMeta(id);
      battles.push(meta);
    } catch {
      // Skip folders with broken metadata.
    }
  }
  battles.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  response.json({ battles });
});

app.get('/api/admin/battles/:id/turn', requireAuth, requireAdmin, async (request, response) => {
  const { id } = request.params;
  try {
    const meta = await readBattleMeta(id);
    const turn = await readStoredTurn(id, meta);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${safeName(meta.turnFileName ?? 'turn.txt')}"`);
    response.send(turn);
  } catch {
    jsonError(response, 404, 'Turn not found.');
  }
});

app.get('/api/admin/battles/:id/sheet', requireAuth, requireAdmin, async (request, response) => {
  const { id } = request.params;
  try {
    const meta = await readBattleMeta(id);
    const sheet = await readStoredSheet(id, meta);
    if (!meta.sheetFileName && !meta.sheetStoredFile) {
      jsonError(response, 404, 'Sheet not stored yet.');
      return;
    }
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${safeName(meta.sheetStoredFile ?? meta.sheetFileName)}"`);
    response.send(sheet);
  } catch {
    jsonError(response, 404, 'Sheet not found.');
  }
});

app.use('/api', (_request, response) => {
  jsonError(response, 404, 'Unknown API route.');
});

app.use(express.static(appDist));
app.get(/.*/, async (_request, response, next) => {
  try {
    response.sendFile(path.join(appDist, 'index.html'));
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  jsonError(response, 500, 'Server error.');
});

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function firstQuery(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  return String(picked ?? '').trim();
}

async function findSetupTurn(game, letter, sim) {
  const folder = new RegExp(`^${game}_${letter}_\\d{4}_Sim${sim}$`);
  const ids = await listBattleIds();
  let best = null;
  for (const id of ids) {
    if (!folder.test(id)) {
      continue;
    }
    const fileName = `${id}_Setup.txt`;
    try {
      const stat = await fs.stat(battleFile(id, fileName));
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { id, fileName, mtimeMs: stat.mtimeMs };
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  if (!best) {
    return null;
  }
  return {
    fileName: best.fileName,
    turnText: await fs.readFile(battleFile(best.id, best.fileName), 'utf8'),
  };
}

function archiveFolderName(fileName) {
  const match = String(fileName).match(/^([A-Z]{2}-\d+_[A-Z]_\d{4}_Sim\d+)_(?:Setup|Battle)\.txt$/);
  return match ? match[1] : null;
}

function storedSheetFileName(id, requestedName) {
  if (/^[A-Z]{2}-\d+_[A-Z]_\d{4}_Sim\d+$/.test(String(id))) {
    return `${id}_Setup.xlsx`;
  }
  const safe = safeName(requestedName);
  if (safe.toLowerCase().endsWith('.xlsx') && safe !== '.xlsx') {
    return safe;
  }
  return 'sheet.xlsx';
}

async function readStoredSheet(id, meta) {
  const named = meta.sheetStoredFile || meta.sheetFileName;
  if (named) {
    try {
      return await fs.readFile(battleFile(id, storedSheetFileName(id, named)));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return fs.readFile(battleFile(id, 'sheet.xlsx'));
}

function storedTurnFileName(name) {
  const safe = safeName(name);
  if (!safe.toLowerCase().endsWith('.txt') || safe === '.txt') {
    return 'turn.txt';
  }
  return safe;
}

async function readStoredTurn(id, meta) {
  const named = meta.turnStoredFile;
  if (named) {
    try {
      return await fs.readFile(battleFile(id, storedTurnFileName(named)));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return fs.readFile(battleFile(id, 'turn.txt'));
}

const port = Number(process.env.PORT ?? 8080);
await fs.mkdir(dataRoot, { recursive: true });
app.listen(port, () => {
  console.log(`AuSim beta server listening on ${port}`);
  console.log(`Serving app dist from ${appDist}`);
});
