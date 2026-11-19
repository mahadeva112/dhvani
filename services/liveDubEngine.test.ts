import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveDubEngine, liveClips, stretchSamples, type LiveClip } from './liveDubEngine.ts';
import type { StreamedAudio } from './waveform.ts';
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

/** Enough of an AudioContext for the engine: buffers, sources and gains, on a clock the test moves. */
const fakeContext = () => {
  const started: { length: number; when: number }[] = [];
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {} });
  const ctx = {
    currentTime: 0,
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, sampleRate, numberOfChannels: channels, duration: length / sampleRate, copyToChannel: (d: Float32Array, ch: number) => data[ch].set(d), getChannelData: (ch: number) => data[ch] };
    },
    createBufferSource: () => {
      const source = { buffer: null as any, connect() {}, start: (when: number) => started.push({ length: source.buffer.length, when }), stop() {} };
      return source;
    },
    createGain: () => ({ gain: param(), connect() {} }),
  };
  return { ctx, started };
};

const clipAt = (start: number, seconds: number, bankFrom: number): LiveClip => ({
  id: `c${start}`,
  stretchKey: `${bankFrom}:${bankFrom + seconds}:1`,
  bankFrom,
  bankTo: bankFrom + seconds,
  start,
  rate: 1,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
  cutIn: false,
  cutOut: false,
});

test('a bank held as peaks plays its parts read from the file around the playhead, and lets the old ones go', async () => {
  const rate = 1000;
  const reads: [number, number][] = [];
  const bankAudio: StreamedAudio = {
    kind: 'streamed',
    blob: new Blob([]),
    duration: 1000,
    sampleRate: rate,
    length: 1000 * rate,
    numberOfChannels: 1,
    peaks: { data: null, rate, seconds: 1000, levels: [] },
    samples: {
      sampleRate: rate,
      length: 1000 * rate,
      numberOfChannels: 1,
      read: async (from, to) => {
        reads.push([from, to]);
        return [new Float32Array(to - from).fill(0.5)];
      },
    },
  };
  const { ctx, started } = fakeContext();
  const engine = new LiveDubEngine(ctx as unknown as AudioContext, {} as AudioNode, bankAudio);
  engine.setClips([clipAt(1, 2, 0), clipAt(5, 2, 2), clipAt(40, 2, 4), clipAt(100, 2, 6)]);
  engine.follow(0);
  await new Promise((done) => setTimeout(done, 0));
  // The parts within reach are read, each only its own stretch; the far ones are not.
  assert.deepEqual(reads, [
    [0, 2000],
    [2000, 4000],
  ]);
  // Read, they play where they belong.
  assert.deepEqual(
    started.map((s) => s.length),
    [2000, 2000]
  );
  // Far on, the old parts are let go and the near one is read.
  ctx.currentTime = 99;
  engine.follow(99);
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(reads.at(-1), [6000, 8000]);
  assert.deepEqual([...(engine as any).read.keys()], ['6:8:1']);
  engine.dispose();
});
