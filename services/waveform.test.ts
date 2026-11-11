import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks, peakRange } from './waveform.ts';

const fakeBuffer = (data: Float32Array, sampleRate = 48000) =>
  ({ getChannelData: () => data, sampleRate, length: data.length }) as unknown as AudioBuffer;

const Q = 32767;

test('peakRange matches the samples for any stretch, to 16-bit precision', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = new Float32Array(200_003);
  for (let i = 0; i < data.length; i++) data[i] = (rnd() * 2 - 1) * (0.2 + 0.8 * Math.abs(Math.sin(i / 5000)));
  const peaks = computePeaks(fakeBuffer(data));
  for (let n = 0; n < 400; n++) {
    const a = Math.floor(rnd() * data.length);
    const b = a + 1 + Math.floor(rnd() * (n % 4 === 0 ? 100_000 : 3000));
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = a; i < Math.min(b, data.length); i++) {
      hi = Math.max(hi, data[i]);
      lo = Math.min(lo, data[i]);
    }
    const r = peakRange(peaks, a, b);
    assert.ok(r);
    assert.ok(Math.abs(r.hi - hi) <= 1 / Q, `hi ${r.hi} vs ${hi} over [${a}, ${b})`);
    assert.ok(Math.abs(r.lo - lo) <= 1 / Q, `lo ${r.lo} vs ${lo} over [${a}, ${b})`);
  }
});

test('peaks keep the real level: a quiet take is not scaled up', () => {
  const data = new Float32Array(48000).map((_, i) => 0.1 * Math.sin(i / 7));
  const peaks = computePeaks(fakeBuffer(data));
  const r = peakRange(peaks, 0, data.length);
  assert.ok(r && r.hi < 0.11 && r.hi > 0.09);
  assert.equal(peaks.seconds, 1);
});

test('an empty or out-of-range stretch has no peak', () => {
  const peaks = computePeaks(fakeBuffer(new Float32Array(1000)));
  assert.equal(peakRange(peaks, 500, 500), null);
  assert.equal(peakRange(peaks, 2000, 3000), null);
});
