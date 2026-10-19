/**
 * Voiced clips kept on disk, so a dub that stopped part way (the app closed,
 * crashed, or a request failed) picks up the lines it already paid for when
 * it is run again, after a restart as well as within one session.
 *
 * Each clip is the voice's own bytes, stored as they came back (no re-encode),
 * named by the same key the in-memory cache uses (see syncDub.js). The store
 * is off until `openClipStore` names a folder, so tests never touch disk.
 * Oldest clips are dropped once the folder passes STORE_BYTES_LIMIT.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

const STORE_BYTES_LIMIT = 2 * 1024 * 1024 * 1024;
/** Writes between size checks. */
const PRUNE_EVERY = 200;

let dir = null;
let writes = 0;

const isKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const fileOf = (key) => path.join(dir, `${key}.clip`);

/** Drops the oldest clips until the folder is under `limit` bytes. */
export const pruneClipStore = async (limit = STORE_BYTES_LIMIT) => {
  if (!dir) return;
  try {
    const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.clip'));
    const files = [];
    for (const name of names) {
      try {
        const stat = await fs.promises.stat(path.join(dir, name));
        files.push({ name, size: stat.size, at: stat.mtimeMs });
      } catch {}
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    files.sort((a, b) => a.at - b.at);
    for (const f of files) {
      if (total <= limit) break;
      await fs.promises.rm(path.join(dir, f.name), { force: true });
      total -= f.size;
    }
  } catch (err) {
    logger.warn(`Voiced clip store could not be tidied: ${err.message}`);
  }
};

/** Turns the store on in `folder`; returns false when it can't be written. */
export const openClipStore = (folder) => {
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.accessSync(folder, fs.constants.W_OK);
    dir = folder;
    pruneClipStore().catch(() => {});
    return true;
  } catch (err) {
    logger.warn(`Voiced clips will not be kept on disk (${folder}): ${err.message}`);
    dir = null;
    return false;
  }
};

/** Turns the store off. For tests. */
export const closeClipStore = () => {
  dir = null;
};

/** The clip stored under `key`, or null. */
export const readStoredClip = async (key) => {
  if (!dir || !isKey(key)) return null;
  try {
    const buffer = await fs.promises.readFile(fileOf(key));
    if (buffer.length === 0) return null;
    // Touched, so pruning drops the clips not used for longest.
    const now = new Date();
    fs.promises.utimes(fileOf(key), now, now).catch(() => {});
    return buffer;
  } catch {
    return null;
  }
};

/** Keeps `buffer` under `key`. Written beside and renamed, so a crash never leaves half a clip. */
export const storeClip = async (key, buffer) => {
  if (!dir || !isKey(key) || !Buffer.isBuffer(buffer) || buffer.length === 0) return;
  const file = fileOf(key);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temp, buffer);
    await fs.promises.rename(temp, file);
  } catch (err) {
    fs.promises.rm(temp, { force: true }).catch(() => {});
    logger.warn(`A voiced clip could not be kept on disk: ${err.message}`);
    return;
  }
  if (++writes % PRUNE_EVERY === 0) pruneClipStore().catch(() => {});
};
