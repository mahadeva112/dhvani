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
 * Each is made when its project opens and deleted when it closes; any left
 * by an app that quit are swept when the server starts. They live in the
 * temp folder, never beside the user's files.
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

/** Removes originals older than `maxAgeMs` (left by an app that quit with a project open). */
export const sweepOriginals = async ({ maxAgeMs = 12 * 3600_000, dir = DIR, now = Date.now() } = {}) => {
  let names = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const { mtimeMs } = await fs.promises.stat(file);
      if (now - mtimeMs > maxAgeMs) {
        await fs.promises.rm(file, { force: true });
        removed++;
      }
    } catch {
      // Gone already.
    }
  }
  return removed;
};
