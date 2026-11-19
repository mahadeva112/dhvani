import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks, peakRange, peaksBuilder, type StreamedAudio } from './waveform.ts';

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

test('peaks of one buffer are read once and shared by every view that draws it', () => {
  const buffer = fakeBuffer(new Float32Array(5000).map((_, i) => Math.sin(i / 7)));
  assert.equal(computePeaks(buffer), computePeaks(buffer));
  assert.notEqual(computePeaks(buffer), computePeaks(fakeBuffer(new Float32Array(5000))));
});

test('peaks built from a file a slice at a time are the same as from the whole buffer', () => {
  let seed = 9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = new Float32Array(300_017).map((_, i) => (rnd() * 2 - 1) * Math.abs(Math.sin(i / 3000)));
  const whole = computePeaks(fakeBuffer(data));
  // Slices of uneven sizes, none on a block's edge.
  const builder = peaksBuilder(48000, data.length);
  for (let at = 0, n = 0; at < data.length; n++) {
    const size = [4999, 77, 65_537, 1][n % 4];
    builder.add(data.subarray(at, at + size));
    at += size;
  }
  const sliced = builder.done();
  assert.equal(sliced.data, null);
  assert.equal(sliced.seconds, whole.seconds);
  assert.equal(sliced.levels.length, whole.levels.length);
  sliced.levels.forEach((level, k) => {
    assert.deepEqual(level.max, whole.levels[k].max);
    assert.deepEqual(level.min, whole.levels[k].min);
  });
});

test('without its samples held, a stretch reads from the finest blocks it touches and never misses a peak', () => {
  const data = new Float32Array(100_000).map((_, i) => 0.3 * Math.sin(i / 11));
  data[50_010] = 0.9;
  const builder = peaksBuilder(48000, data.length);
  builder.add(data);
  const peaks = builder.done();
  const streamed: StreamedAudio = { kind: 'streamed', blob: new Blob([]), duration: data.length / 48000, sampleRate: 48000, length: data.length, numberOfChannels: 1, peaks };
  assert.equal(computePeaks(streamed), peaks);
  // A stretch inside one block, and one across many: both see the loud sample.
  assert.ok(Math.abs((peakRange(peaks, 50_000, 50_020)?.hi ?? 0) - 0.9) <= 1 / Q);
  assert.ok(Math.abs((peakRange(peaks, 10_000, 90_000)?.hi ?? 0) - 0.9) <= 1 / Q);
  assert.equal(peakRange(peaks, 200_000, 300_000), null);
});
