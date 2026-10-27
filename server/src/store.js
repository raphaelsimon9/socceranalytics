import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultStorePath = fileURLToPath(new URL('../data/matchlab-store.json', import.meta.url));
const file = process.env.DATA_STORE_PATH?.trim() ? resolve(process.env.DATA_STORE_PATH.trim()) : defaultStorePath;
let current = { updatedAt: null, footballMatches: [], basketballGames: [] };
let ready = false;
let writeQueue = Promise.resolve();

export async function loadStore() {
  if (ready) return current;
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    current = { ...current, ...parsed };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read data store:', e.message);
  }
  ready = true;
  return current;
}

export async function snapshotSport(sport, rows) {
  await loadStore();
  const key = sport === 'football' ? 'footballMatches' : 'basketballGames';
  const map = new Map(current[key].map(row => [String(row.id), row]));
  for (const row of rows) map.set(String(row.id), row);
  current[key] = [...map.values()].sort((a, b) => new Date(a.utcDate || a.date) - new Date(b.utcDate || b.date)).slice(-10000);
  current.updatedAt = new Date().toISOString();
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(current), 'utf8');
    await rename(temp, file);
  });
  await writeQueue;
  return { stored: rows.length, total: current[key].length, updatedAt: current.updatedAt };
}

export async function getStore() { return loadStore(); }
