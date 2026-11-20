import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ApiError } from '../errors.js';
import { extractOriginalWav } from './media.js';

/**
 * The originals of open projects, as WAVs the app reads a stretch at a time
 * (GET with a Range) instead of decoding a long video whole in the page.
 * Each is made when its project opens and kept while a page holds it open
 * (createHolds); it is deleted when the project closes, or a minute after
 * the last page holding it is gone, however it went. They live in the temp
 * folder, never beside the user's files.
 */
const DIR = path.join(os.tmpdir(), 'dhvani-originals');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where the original `id` is kept; null for anything that isn't an id. */
export const originalPath = (id, dir = DIR) => (typeof id === 'string' && ID.test(id) ? path.join(dir, `${id}.wav`) : null);

/**
 * True for a WAV the app reads as it is: 16-bit integer or 32-bit float PCM
 * (services/audioService.ts pcmWavLayout reads exactly these).
 */
export const isPlainWav = (head) => {
  if (!Buffer.isBuffer(head) || head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return false;
  for (let at = 12; at + 8 <= head.length; ) {
    const id = head.toString('latin1', at, at + 4);
    const size = head.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 24 <= head.length) {
      const format = head.readUInt16LE(at + 8);
      const channels = head.readUInt16LE(at + 10);
      const align = head.readUInt16LE(at + 20);
      const bits = head.readUInt16LE(at + 22);
      const plain = (format === 1 && bits === 16) || (format === 3 && bits === 32);
      return plain && channels >= 1 && align === channels * (bits / 8);
    }
    at += 8 + size + (size % 2);
  }
  return false;
};

const readHead = async (file, bytes = 64 * 1024) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/**
 * Keeps the media in `stream` as the original of a project being opened: a
 * plain PCM WAV as it is, anything else (a video, an MP3) as its first audio
 * track in 16-bit WAV (extractOriginalWav). A 503 with code `ffmpeg_missing`
 * when that needs ffmpeg and there is none.
 */
export const storeOriginal = async (stream, { signal, dir = DIR, extract = extractOriginalWav } = {}) => {
  await fs.promises.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const input = path.join(dir, `${id}.in`);
  const output = originalPath(id, dir);
  try {
    await pipeline(stream, fs.createWriteStream(input), { signal });
    if (isPlainWav(await readHead(input))) {
      await fs.promises.rename(input, output);
    } else {
      const made = await extract(input, output, { signal });
      if (!made) throw new ApiError('Reading a long video a little at a time needs ffmpeg.', { status: 503, code: 'ffmpeg_missing' });
    }
    const { size } = await fs.promises.stat(output);
    if (size < 64) throw new ApiError('The media has no audio track.', { status: 422, code: 'no_audio' });
    return { id, bytes: size };
  } catch (err) {
    await fs.promises.rm(output, { force: true }).catch(() => {});
    throw err;
  } finally {
    await fs.promises.rm(input, { force: true }).catch(() => {});
  }
};

export const dropOriginal = async (id, dir = DIR) => {
  const file = originalPath(id, dir);
  if (file) await fs.promises.rm(file, { force: true });
};

/** How long an original nothing holds is kept: a page reloading, or a server restarting, holds it again well within this. */
export const HOLD_GRACE_MS = 60_000;

/**
 * Which originals pages hold open. A page holds its project's original by
 * keeping a request open (GET /api/media/originals/:id/hold), so a page that
 * is closed, reloaded or killed lets go of it without having to say so; the
 * original is deleted HOLD_GRACE_MS after nothing holds it.
 */
export const createHolds = ({ graceMs = HOLD_GRACE_MS, drop = (id) => dropOriginal(id) } = {}) => {
  const count = new Map();
  const timers = new Map();
  const cancel = (id) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  /** Deletes `id` after the grace, unless something holds it by then. */
  const dropLater = (id) => {
    if (count.get(id)) return;
    cancel(id);
    const timer = setTimeout(() => {
      timers.delete(id);
      if (!count.get(id)) void Promise.resolve(drop(id)).catch(() => {});
    }, graceMs);
    timer.unref?.();
    timers.set(id, timer);
  };
  /** Holds `id`; the function returned lets go (once). */
  const hold = (id) => {
    cancel(id);
    count.set(id, (count.get(id) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const left = (count.get(id) ?? 1) - 1;
      if (left > 0) count.set(id, left);
      else {
        count.delete(id);
        dropLater(id);
      }
    };
  };
  /** Deletes `id` now, held or not: its project closed. */
  const dropNow = async (id) => {
    cancel(id);
    count.delete(id);
    await drop(id);
  };
  return { hold, dropLater, dropNow, isHeld: (id) => Boolean(count.get(id)), isWaiting: (id) => timers.has(id) };
};

export const holds = createHolds();

/**
 * When the server starts: uploads cut short are deleted, and every original
 * left is deleted after the grace unless a page still open holds it again
 * (the server restarted under it). Returns how many of each.
 */
export const sweepOriginals = async ({ dir = DIR, using = holds } = {}) => {
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return { uploads: 0, originals: 0 };
  }
  let uploads = 0;
  let originals = 0;
  for (const name of names) {
    const id = name.replace(/\.wav$/, '');
    if (name.endsWith('.wav') && originalPath(id, dir)) {
      using.dropLater(id);
      originals++;
    } else if (name.endsWith('.in')) {
      await fs.promises.rm(path.join(dir, name), { force: true }).catch(() => {});
      uploads++;
    }
  }
  return { uploads, originals };
};
