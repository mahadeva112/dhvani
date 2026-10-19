import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbToGain, gateSounds, peakLevels } from './silenceGate.js';

/** Levels (one per frame) that sit at each [from, to, dB] frame range and at -90 dB elsewhere. */
const levelsOf = (frames, ranges) => {
  const levels = new Float32Array(frames).fill(dbToGain(-90));
  for (const [from, to, db] of ranges) levels.fill(dbToGain(db), from, to);
  return levels;
};

const gate = { openDb: -40, hysteresisDb: 15, minSilenceFrames: 10 };

test('the gate opens above the open level and closes only below the close level', () => {
  // Loud, then a dip to -50 dB (under open, over close -55 dB), then loud again: one sound.
  const levels = levelsOf(200, [[20, 60, -20], [60, 90, -50], [90, 120, -20]]);
  assert.deepEqual(gateSounds(levels, gate), [{ from: 20, to: 120 }]);
  // Without hysteresis the same dip is a pause.
  assert.deepEqual(gateSounds(levels, { ...gate, hysteresisDb: 0 }), [{ from: 20, to: 60 }, { from: 90, to: 120 }]);
});

test('a sound between the two levels never opens the gate on its own', () => {
  assert.deepEqual(gateSounds(levelsOf(100, [[20, 80, -50]]), gate), []);
});

test('a pause shorter than the shortest pause does not split', () => {
  const levels = levelsOf(200, [[20, 60, -20], [60, 68, -90], [68, 120, -20]]);
  assert.deepEqual(gateSounds(levels, gate), [{ from: 20, to: 120 }]);
  assert.equal(gateSounds(levels, { ...gate, minSilenceFrames: 5 }).length, 2);
});

test('a soft onset reaches back over frames above the close level, never into the sound before', () => {
  const levels = levelsOf(200, [[20, 40, -20], [70, 80, -50], [80, 120, -20]]);
  assert.deepEqual(gateSounds(levels, { ...gate, softOnsetFrames: 20 }), [{ from: 20, to: 40 }, { from: 70, to: 120 }]);
  assert.deepEqual(gateSounds(levels, { ...gate, softOnsetFrames: 4 }).at(-1), { from: 76, to: 120 });
});

test('peak levels read every sample in each frame', () => {
  const samples = new Float32Array(25);
  samples[7] = -0.5;
  samples[24] = 0.25;
  const { levels, hop } = peakLevels(samples, 1000, 0.01);
  assert.equal(hop, 10);
  assert.deepEqual([...levels], [0.5, 0, 0.25]);
});
