import test from 'node:test';
import assert from 'node:assert/strict';
import { fitToLength, needsCheck, toLength } from './voiceChange.js';

/** A stand-in for atempo: `rate` times faster, same pitch, a few samples off as atempo is. */
const fakeStretch = (calls) => async (samples, rate) => {
  calls.push(rate);
  return new Float32Array(Math.round(samples.length / rate) + 3).fill(0.5);
};

test('a changed line comes back exactly as long as the old one, whichever way it was off', async () => {
  for (const got of [1100, 900]) {
    const calls = [];
    const { samples, change } = await fitToLength(new Float32Array(got).fill(0.5), 1000, fakeStretch(calls));
    assert.equal(samples.length, 1000);
    assert.equal(calls.length, 1);
    assert.ok(Math.abs(calls[0] - got / 1000) < 1e-9);
    assert.ok(Math.abs(change - (got / 1000 - 1)) < 1e-9);
  }
});

test('a take within a few samples is only padded or cut, never stretched', async () => {
  const calls = [];
  const { samples, change } = await fitToLength(new Float32Array(48000).fill(0.25), 48010, fakeStretch(calls));
  assert.equal(calls.length, 0);
  assert.equal(samples.length, 48010);
  assert.equal(samples[47999], 0.25);
  assert.equal(samples[48005], 0);
  assert.ok(change < 0);
});

test('the stretch stays inside what atempo takes, and the rest is padded', async () => {
  const calls = [];
  const { samples } = await fitToLength(new Float32Array(300).fill(0.5), 1000, fakeStretch(calls));
  assert.equal(calls[0], 0.5);
  assert.equal(samples.length, 1000);
});

test('only a line more than 5% off is flagged for the user', () => {
  assert.equal(needsCheck(0.04), false);
  assert.equal(needsCheck(-0.049), false);
  assert.equal(needsCheck(0.06), true);
  assert.equal(needsCheck(-0.08), true);
});

test('toLength keeps the samples it has and pads with silence', () => {
  const out = toLength(new Float32Array([1, 2, 3]), 5);
  assert.deepEqual([...out], [1, 2, 3, 0, 0]);
  assert.deepEqual([...toLength(new Float32Array([1, 2, 3]), 2)], [1, 2]);
});
