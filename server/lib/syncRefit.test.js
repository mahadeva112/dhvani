import test from 'node:test';
import assert from 'node:assert/strict';
import { KEPT_KEYS, readLengthRatio, refitAfterVoicing, withBandMoves } from './syncRefit.js';
import { DEFAULT_JOIN_SETTINGS } from './syncSettings.js';
import { buildSyncUnits } from './syncUnits.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;
const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, textTarget: text, textSource: `src ${id}` });

/** `count` cues, each said in 1 s, starting `every` s apart. */
const cues = (count, text, every = 2) => Array.from({ length: count }, (_, n) => cue(n + 1, 1 + n * every, 2 + n * every, text));

// The bands' settings as the app sends them: Short keeps every pause, Natural is the default.
const SHORT = { ...DEFAULT_JOIN_SETTINGS, chunkGapShare: 1, minGap: 0.25, gapShare: 0.5, stopGap: 0.4 };
const NATURAL = { ...DEFAULT_JOIN_SETTINGS };
const LONG = { ...DEFAULT_JOIN_SETTINGS, chunkGapShare: 0.35, minGap: 0.12, maxPauseTake: 0.6, endByVideo: true, tailHold: 0.025 };
const candidates = { short: SHORT, natural: NATURAL, long: LONG, vlong: LONG };

test('the voiced length against the original, line by line', () => {
  const units = [{ srcStart: 0, srcEnd: 1 }, { srcStart: 2, srcEnd: 4 }, { srcStart: 5, srcEnd: 6 }];
  assert.equal(readLengthRatio(units, [1.2, 2.1, 0]), 3.3 / 3);
  assert.equal(readLengthRatio(units, [0, 0, 0]), null);
});

test("a band's pause moves never go the other way", () => {
  assert.equal(withBandMoves({ ...NATURAL, maxPauseTake: 0.7 }, 'long').maxPauseTake, 0.7);
  assert.equal(withBandMoves(NATURAL, 'long').maxPauseTake, 0.5);
  assert.equal(withBandMoves(NATURAL, 'vlong').gapShare, 0.25);
  assert.equal(withBandMoves(NATURAL, 'short').gapShare, 0.4);
  assert.equal(withBandMoves({ ...NATURAL, gapShare: 0.5 }, 'short').gapShare, 0.5);
});

test('the voice read in another band: its settings go in, grouping and re-voicing settings stay', () => {
  const segments = cues(6, 'x'.repeat(12));
  const join = { ...SHORT, unitGap: 0.3, maxUnit: 9, speedFit: 'ask', maxVoiceSpeed: 1.1 };
  const units = buildSyncUnits(segments, join);
  // Read in 0.97 s against 1 s said: Natural, not the Short the settings were made for.
  const result = refitAfterVoicing({ refit: { from: 'short', candidates }, join, units, reads: units.map(() => 0.97), segments, precision: 'phrase' });
  assert.equal(result.status, 'applied');
  assert.equal(result.to, 'natural');
  assert.equal(result.join.chunkGapShare, NATURAL.chunkGapShare);
  assert.equal(result.join.minGap, NATURAL.minGap);
  for (const key of KEPT_KEYS) assert.equal(result.join[key], join[key], key);
  assert.ok(result.inSync.after >= result.inSync.before);
});

test('the band it was made for, or no request, changes nothing', () => {
  const segments = cues(6, 'x'.repeat(12));
  const units = buildSyncUnits(segments, NATURAL);
  const reads = units.map(() => 0.97);
  assert.equal(refitAfterVoicing({ refit: { from: 'natural', candidates }, join: NATURAL, units, reads, segments, precision: 'phrase' }).status, 'same');
  assert.equal(refitAfterVoicing({ refit: null, join: NATURAL, units, reads, segments, precision: 'phrase' }), null);
  assert.equal(refitAfterVoicing({ refit: { from: 'natural', candidates }, join: NATURAL, units, reads: reads.map(() => 0), segments, precision: 'phrase' }).status, 'unmeasured');
});

test('settings the preview judges worse are not swapped in', () => {
  // Lines 1.15 s apart, each read in 0.97 s: a 0.6 s minimum gap would leave no room for them.
  const segments = cues(6, 'x'.repeat(12), 1.15);
  const join = { ...SHORT, unitGap: 0.1, minGap: 0.1 };
  const units = buildSyncUnits(segments, join);
  const cramped = { ...NATURAL, minGap: 0.6, speakerGap: 0.6 };
  const result = refitAfterVoicing({
    refit: { from: 'short', candidates: { ...candidates, natural: cramped } },
    join,
    units,
    reads: units.map(() => 0.97),
    segments,
    precision: 'phrase',
  });
  assert.equal(result.status, 'worse');
  assert.equal(result.join, null);
  assert.ok(result.inSync.after < result.inSync.before);
});

/** A fake voice: 0.08 s a character, with 0.15 s of silence either side; counts what it voices. */
const fakeVoice = () => {
  const voiced = [];
  const tone = (seconds) => {
    const samples = new Float32Array(Math.round((0.3 + seconds) * RATE));
    for (let i = Math.round(0.15 * RATE); i < Math.round((0.15 + seconds) * RATE); i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
    return samples;
  };
  return {
    voiced,
    deps: {
      voiceLines: async (lines, { onLine }) =>
        lines.map((line, n) => {
          voiced.push(line.text);
          onLine(n + 1);
          return tone(line.text.replace(/[.।]$/u, '').length * 0.08);
        }),
      decode: async (samples) => samples,
      encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
    },
  };
};
const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };

test('the first Sync places the dub with the band the voice really read in, voicing nothing twice', async () => {
  clearClipCache();
  // 12 characters at 0.08 s: 0.96 s against 1 s said, Natural; the settings were made for Short.
  const segments = cues(6, 'x'.repeat(12));
  const { deps, voiced } = fakeVoice();
  const { report } = await runSync(
    { segments, sourceDuration: 14, sampleRate: RATE, voice, join: SHORT, refit: { from: 'short', candidates } },
    deps
  );
  assert.equal(report.refit.status, 'applied');
  assert.equal(report.refit.from, 'short');
  assert.equal(report.refit.to, 'natural');
  assert.ok(Math.abs(report.refit.ratio - 0.96) < 0.02, `ratio ${report.refit.ratio}`);
  assert.equal(report.join.chunkGapShare, NATURAL.chunkGapShare, 'the sync ran with the swapped settings');
  assert.equal(voiced.length, 6, 'each line voiced once');
  for (const unit of report.units) assert.ok(Math.abs(unit.read - 0.96) < 0.02, `read ${unit.read}`);
});

test('without a request, Sync runs with the settings as sent', async () => {
  clearClipCache();
  const segments = cues(6, 'x'.repeat(12));
  const { deps } = fakeVoice();
  const { report } = await runSync({ segments, sourceDuration: 14, sampleRate: RATE, voice, join: SHORT }, deps);
  assert.equal(report.refit, undefined);
  assert.equal(report.join.chunkGapShare, SHORT.chunkGapShare);
});
