/**
 * How much room is left on the drive the app keeps its data on.
 *
 * On a nearly full drive Chromium cannot write big audio to its own storage:
 * a WAV the app downloads fails at once with "Failed to fetch" and opening a
 * project fails with "Failed to write blobs (IOError)", while the engine is
 * fine. Knowing the free space lets the app say that plainly.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Below this the drive counts as almost full: a long dub's WAV alone can be hundreds of MB. */
export const LOW_DISK_BYTES = 2 * 1024 ** 3;

/**
 * { freeBytes, totalBytes, drive, low } for the drive holding `dir`, or null
 * when it cannot be read. `drive` is "C:" on Windows and "/" elsewhere.
 */
export const diskSpace = async (dir, { statfs = fs.promises.statfs } = {}) => {
  try {
    const stats = await statfs(dir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const root = path.parse(path.resolve(dir)).root;
    const drive = /^[A-Za-z]:/.test(root) ? root.slice(0, 2).toUpperCase() : root || '/';
    return { freeBytes, totalBytes, drive, low: freeBytes < LOW_DISK_BYTES };
  } catch {
    return null;
  }
};
