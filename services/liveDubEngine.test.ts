import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveClips, stretchSamples } from './liveDubEngine.ts';
import type { SyncBank } from './syncEditService';

const bank: SyncBank = {
  bankId: 'b',
  sampleRate: 1000,
  float: true,
  speakerGains: { A: 0.5 },
  lines: [
    { key: 'l1', speaker: 'A', bankStart: 0, length: 2000, startSample: 3000, lead: 0, speech: 2, gain: 2, hash: 'h', cuts: [], crossfade: 0, dropped: 0, locked: false },
    { key: 'l2', speaker: 'A', bankStart: 2000, length: 1000, startSample: 6000, lead: 0, speech: 1, gain: 1, hash: 'h', cuts: [], crossfade: 0, dropped: 0, locked: false },
  ],
};

test('a line nobody edited plays whole, where Sync put it', () => {
  const [a, b] = liveClips(bank, null, false);
  assert.deepEqual([a.bankFrom, a.bankTo, a.start, a.rate, a.gain, a.cutIn, a.cutOut], [0, 2, 3, 1, 2, false, false]);
  assert.deepEqual([b.bankFrom, b.bankTo, b.start], [2, 3, 6]);
});

test('edited parts play from their stretch of the bank, with speaker gains in a mix', () => {
  const clips = liveClips(
    bank,
    {
      l1: { locked: true, parts: [{ id: 'p', start: 1, from: 0.5, to: 1.5, rate: 1, gainDb: -6, fadeIn: 0.1, fadeOut: 0, muted: false }] },
      l2: { locked: true, parts: [{ id: 'm', start: 6, from: 0, to: 1, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: true }] },
    },
    true
  );
  assert.equal(clips.length, 1, 'a muted part does not play');
  const [c] = clips;
  assert.deepEqual([c.bankFrom, c.bankTo, c.start, c.cutIn, c.cutOut], [0.5, 1.5, 1, true, true]);
  assert.ok(Math.abs(c.gain - 2 * 0.5 * 10 ** (-6 / 20)) < 1e-9);
});

test('moving a part changes its id but keeps its stretched copy', () => {
  const at = (start: number) =>
    liveClips(bank, { l1: { locked: true, parts: [{ id: 'p', start, from: 0, to: 2, rate: 1.2, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false }] } }, false)[0];
  assert.notEqual(at(1).id, at(2).id);
  assert.equal(at(1).stretchKey, at(2).stretchKey);
});

test('a clip of the original plays from the original, at its own gain, among the lines', () => {
  const original = { id: 'o', start: 4.5, from: 10, to: 11, rate: 1, gainDb: -6, fadeIn: 0, fadeOut: 0, muted: false };
  const clips = liveClips(bank, null, true, [original]);
  assert.deepEqual(
    clips.map((c) => [c.start, Boolean(c.original)]),
    [
      [3, false],
      [4.5, true],
      [6, false],
    ]
  );
  const clip = clips[1];
  assert.deepEqual([clip.bankFrom, clip.bankTo], [10, 11], 'seconds of the original, not of the bank');
  assert.ok(Math.abs(clip.gain - 10 ** (-6 / 20)) < 1e-9, 'no line or speaker gain');
});

test('a stretch keeps the pitch and changes the length', () => {
  const sr = 16000;
  const tone = new Float32Array(sr);
  for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 220 * i) / sr);
  for (const rate of [0.8, 1.25]) {
    const [out] = stretchSamples([tone], sr, rate);
    assert.equal(out.length, Math.round(sr / rate));
    // Zero crossings per second in the middle stay those of a 220 Hz tone.
    const mid = out.subarray(Math.floor(out.length * 0.25), Math.floor(out.length * 0.75));
    let crossings = 0;
    for (let i = 1; i < mid.length; i++) if (mid[i - 1] < 0 !== mid[i] < 0) crossings++;
    const hz = crossings / 2 / (mid.length / sr);
    assert.ok(Math.abs(hz - 220) < 6, `rate ${rate}: ${hz.toFixed(1)} Hz`);
    let peak = 0;
    for (const v of mid) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.8 && peak < 1.2, `rate ${rate}: peak ${peak}`);
  }
});
