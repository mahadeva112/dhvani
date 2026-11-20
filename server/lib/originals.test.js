import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHolds, isPlainWav, originalPath, storeOriginal, dropOriginal, sweepOriginals } from './originals.js';

const wavHead = ({ format = 1, bits = 16, channels = 2 } = {}) => {
  const b = Buffer.alloc(44 + 400);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(format, 20);
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(48000 * channels * (bits / 8), 28);
  b.writeUInt16LE(channels * (bits / 8), 32);
  b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(400, 40);
  return b;
};

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-originals-test-'));

test('only the WAVs the app reads as they are count as plain', () => {
  assert.equal(isPlainWav(wavHead()), true);
  assert.equal(isPlainWav(wavHead({ format: 3, bits: 32, channels: 1 })), true);
  assert.equal(isPlainWav(wavHead({ bits: 24 })), false);
  assert.equal(isPlainWav(wavHead({ format: 0xfffe })), false);
  assert.equal(isPlainWav(Buffer.from('ftypisom not a wav')), false);
});

test('a plain WAV is kept as it is; nothing is extracted', async () => {
  const dir = tempDir();
  const wav = wavHead();
  let extracted = false;
  const { id, bytes } = await storeOriginal(Readable.from([wav]), { dir, extract: async () => (extracted = true) });
  assert.equal(extracted, false);
  assert.equal(bytes, wav.length);
  assert.deepEqual(fs.readFileSync(originalPath(id, dir)), wav);
  assert.deepEqual(fs.readdirSync(dir), [`${id}.wav`], 'the upload is not left behind');
  await dropOriginal(id, dir);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a video has its audio extracted, and the upload is deleted', async () => {
  const dir = tempDir();
  const { id } = await storeOriginal(Readable.from([Buffer.from('a video, as far as this test cares')]), {
    dir,
    extract: async (input, output) => {
      assert.ok(fs.existsSync(input));
      fs.writeFileSync(output, wavHead());
      return output;
    },
  });
  assert.deepEqual(fs.readdirSync(dir), [`${id}.wav`]);
});

test('without ffmpeg a video is refused in plain words, and nothing is left', async () => {
  const dir = tempDir();
  await assert.rejects(storeOriginal(Readable.from([Buffer.from('a video')]), { dir, extract: async () => null }), (err) => err.code === 'ffmpeg_missing' && err.status === 503);
  assert.deepEqual(fs.readdirSync(dir), []);
});

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

test('only ids make paths', () => {
  assert.equal(originalPath('../../etc/passwd', tempDir()), null);
});

test('an original goes a grace after the last page holding it lets go, and stays while one holds it', async () => {
  const dropped = [];
  const holds = createHolds({ graceMs: 30, drop: (id) => dropped.push(id) });
  const first = holds.hold('a');
  const second = holds.hold('a');
  first();
  first(); // letting go twice counts once
  await wait(60);
  assert.deepEqual(dropped, [], 'still held by the second page');
  second();
  assert.ok(holds.isWaiting('a'));
  await wait(60);
  assert.deepEqual(dropped, ['a']);
});

test('held again within the grace (a reload, a server restart), an original is kept', async () => {
  const dropped = [];
  const holds = createHolds({ graceMs: 30, drop: (id) => dropped.push(id) });
  holds.dropLater('b'); // just stored, or found when the server started
  await wait(10);
  const release = holds.hold('b');
  await wait(60);
  assert.deepEqual(dropped, []);
  assert.ok(holds.isHeld('b'));
  release();
  await holds.dropNow('b'); // its project closed: gone at once, no second drop later
  await wait(60);
  assert.deepEqual(dropped, ['b']);
});

test('when the server starts, cut-short uploads go at once and originals after the grace', async () => {
  const dir = tempDir();
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  fs.writeFileSync(path.join(dir, `${id}.wav`), 'x');
  fs.writeFileSync(path.join(dir, 'c9a646d3-9c61-4cb7-bfcd-ee2522c8f633.in'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const holds = createHolds({ graceMs: 30, drop: (gone) => dropOriginal(gone, dir) });
  assert.deepEqual(await sweepOriginals({ dir, using: holds }), { uploads: 1, originals: 1 });
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${id}.wav`, 'notes.txt']);
  await wait(80);
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']);
});
