import test from 'node:test';
import assert from 'node:assert/strict';
import { silenceLevel, tightenSilences, composeCuts, applyCuts } from './syncRender.js';
import { resolveJoinSettings, DEFAULT_JOIN_SETTINGS } from './syncSettings.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;
const db = (amplitude) => 20 * Math.log10(amplitude);

/** Room tone: deterministic noise peaking at `amplitude`. */
const roomTone = (samples, amplitude, from = 0, to = samples.length) => {
  let seed = 7;
  for (let i = from; i < to; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = ((seed / 2147483647) * 2 - 1) * amplitude;
  }
};

/**
 * A line as a cloned voice reads it: room tone at `noise` throughout, `words`
 * of `word` s each with `pause` s between them, `lead` s before and `tail` s
 * after. Each word ends in a sound that dies away over 60 ms. Returns the
 * samples and each word's `{ start, end }` in samples.
 */
const line = ({ words = 2, word = 0.8, pause = 0.8, lead = 0.15, tail = 0.8, noise = 0.0015, level = 0.3 } = {}) => {
  const length = Math.round((lead + words * word + (words - 1) * pause + tail) * RATE);
  const samples = new Float32Array(length);
  roomTone(samples, noise);
  const spans = [];
  for (let w = 0; w < words; w++) {
    const start = Math.round((lead + w * (word + pause)) * RATE);
    const end = start + Math.round(word * RATE);
    const decay = Math.round(0.06 * RATE);
    for (let i = start; i < end; i++) {
      const fade = i >= end - decay ? Math.exp((-5 * (i - (end - decay))) / decay) : 1;
      samples[i] = level * fade * Math.sin((2 * Math.PI * 220 * i) / RATE);
    }
    spans.push({ start, end });
  }
  return { samples, spans };
};

/** Every sample louder than `level`, in order: what a cut must never lose. */
const sounds = (samples, level) => [...samples].filter((sample) => Math.abs(sample) >= level);

test("silence is measured against the line's own room tone, and true silence where it has none to measure", () => {
  const noisy = line({ noise: 0.0015 }).samples;
  const level = silenceLevel(noisy, RATE);
  assert.ok(Math.abs(db(level) - (db(0.0015) + 6)) < 1.5, `about 6 dB over the room tone, got ${db(level).toFixed(1)} dB`);

  // A clean voice pauses on digital silence: only true silence (-60 dB) counts.
  const clean = line({ noise: 0 }).samples;
  assert.equal(silenceLevel(clean, RATE), 0.001);

  // Never louder than -45 dB, however loud the room.
  assert.ok(db(silenceLevel(line({ noise: 0.01, level: 0.9 }).samples, RATE)) <= -45 + 1e-9);

  // A line that never pauses has no floor below its speech: true silence again, so nothing of it is taken for one.
  const solid = line({ words: 1, word: 2, lead: 0, tail: 0 }).samples;
  assert.equal(silenceLevel(solid, RATE), 0.001);
});

test('Tighten silences takes the tail first, then the longest pause, and keeps every sound sample for sample', () => {
  const { samples, spans } = line({ words: 3, pause: 0.5, tail: 0.8 });
  // Lengthen the second pause so "longest first" is visible.
  const long = line({ words: 2, pause: 1.2, tail: 0.8 });
  for (const [clip, ask] of [
    [samples, 0.4],
    [samples, 1.0],
    [long.samples, 1.5],
  ]) {
    const level = silenceLevel(clip, RATE);
    const result = tightenSilences(clip, RATE, ask, { firstWord: spans[0].start, minPause: 0.15, margin: 0.08, blend: 40 });
    assert.ok(result.removed > 0 && result.removed <= ask + 1 / RATE, `took ${result.removed} of ${ask}`);
    assert.equal(result.samples.length, clip.length - Math.round(result.removed * RATE));
    // Every sound, the dying end of each word included, comes through untouched.
    assert.deepEqual(sounds(result.samples, level * 2), sounds(clip, level * 2));
  }

  // 0.4 s: all of it from the tail, which keeps the margin after the last sound.
  const tailOnly = tightenSilences(samples, RATE, 0.4, { firstWord: spans[0].start, minPause: 0.15, margin: 0.08 });
  assert.ok(Math.abs(tailOnly.tail - 0.4) < 1 / RATE && tailOnly.inner === 0, 'the tail goes first');
  // 1.0 s: the tail gives what it has past the margin, the pauses the rest.
  const both = tightenSilences(samples, RATE, 1.0, { firstWord: spans[0].start, minPause: 0.15, margin: 0.08, blend: 40 });
  assert.ok(both.tail > 0.6 && both.tail < 0.8 && both.inner > 0, `tail ${both.tail}, pauses ${both.inner}`);
  for (const cut of both.cuts.filter((cut) => cut.end < samples.length)) assert.equal(cut.blend, 40, 'a cut inside a pause blends');
  assert.equal(both.cuts.at(-1).blend, 0, 'the tail is a plain cut');
});

test('Tighten silences never touches what comes before the first word, and leaves a pause at least its minimum', () => {
  const { samples, spans } = line({ words: 2, pause: 0.5, lead: 0.4, tail: 0 });
  const result = tightenSilences(samples, RATE, 5, { firstWord: spans[0].start, minPause: 0.25, margin: 0.08 });
  assert.ok(result.cuts.every((cut) => cut.start >= spans[0].end), 'the lead-in is kept');
  assert.ok(Math.abs(result.inner - (0.5 - 0.25)) < 0.05, `the pause keeps 0.25 s, took ${result.inner}`);
  // Asked for nothing, it takes nothing.
  assert.equal(tightenSilences(samples, RATE, 0, { firstWord: spans[0].start }).removed, 0);
});

test('a word too quiet to stand above the room tone is kept when forced alignment says it is there', () => {
  const { samples, spans } = line({ words: 2, pause: 1, tail: 0.3 });
  // A whispered word in the middle of the pause, below the silence level.
  const level = silenceLevel(samples, RATE);
  const whisper = { start: spans[0].end + Math.round(0.35 * RATE), end: spans[0].end + Math.round(0.65 * RATE) };
  for (let i = whisper.start; i < whisper.end; i++) samples[i] = level * 0.6 * Math.sin((2 * Math.PI * 300 * i) / RATE);
  const original = samples.slice(whisper.start, whisper.end);

  const blind = tightenSilences(samples, RATE, 2, { firstWord: spans[0].start, margin: 0.08 });
  assert.ok(blind.cuts.some((cut) => cut.start < whisper.end && cut.end > whisper.start), 'without word timing it would be cut');

  const checked = tightenSilences(samples, RATE, 2, { firstWord: spans[0].start, margin: 0.08, protect: [...spans, whisper] });
  for (const cut of checked.cuts) {
    assert.ok(cut.end <= whisper.start - 0.08 * RATE || cut.start >= whisper.end + 0.08 * RATE, 'every cut keeps the margin clear of the word');
  }
  const removedBefore = checked.cuts.filter((cut) => cut.end <= whisper.start).reduce((sum, cut) => sum + cut.end - cut.start, 0);
  assert.deepEqual(checked.samples.slice(whisper.start - removedBefore, whisper.end - removedBefore), original);
});

test('a short sound after the last word stays, and only the silence after it goes', () => {
  const { samples, spans } = line({ words: 1, tail: 1 });
  // A 25 ms burst 300 ms after the last word, as a voice sometimes ends a take.
  const burst = spans[0].end + Math.round(0.3 * RATE);
  for (let i = burst; i < burst + Math.round(0.025 * RATE); i++) samples[i] = 0.05 * Math.sin(i);
  const level = silenceLevel(samples, RATE);
  const result = tightenSilences(samples, RATE, 0.5, { firstWord: spans[0].start, margin: 0.08 });
  assert.ok(result.tail > 0, 'the silence after the burst goes');
  assert.deepEqual(sounds(result.samples, level * 2), sounds(samples, level * 2), 'the burst is kept');
});

test('cuts made on a shortened clip compose with its earlier cuts into one list on the clip as voiced', () => {
  const samples = Float32Array.from({ length: 1000 }, (_, i) => i);
  const base = [{ start: 100, end: 150 }, { start: 400, end: 420 }];
  const once = applyCuts(samples, base);
  // One cut before the first join, one across the second, one at the very end.
  const added = [{ start: 20, end: 30 }, { start: 370, end: 390 }, { start: once.length - 40, end: once.length }];
  const twice = applyCuts(once, added);
  const composed = composeCuts(base, added);
  assert.deepEqual(applyCuts(samples, composed), twice);
  assert.ok(composed.every((cut, n) => n === 0 || cut.start > composed[n - 1].end), 'in order, none overlapping');
});

test('Tighten silences is on by default and its settings are kept in range', () => {
  assert.equal(DEFAULT_JOIN_SETTINGS.tightenSilences, true);
  assert.equal(DEFAULT_JOIN_SETTINGS.checkCutWords, true);
  const set = resolveJoinSettings({ tightenSilences: false, checkCutWords: false, tightMinPause: 9, tightMargin: 0 });
  assert.equal(set.tightenSilences, false);
  assert.equal(set.checkCutWords, false);
  assert.equal(set.tightMinPause, 0.4);
  assert.equal(set.tightMargin, 0.03);
});

// ---- In a sync ----

const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}` });

/** A cloned voice on room tone too loud for Shorten pauses to call silence: each word 0.08 s a character, 0.8 s between words and after the last. */
const voiceOf = (text) => line({ words: text.split(' ').length, word: text.split(' ')[0].length * 0.08, pause: 0.8, tail: 0.8 }).samples;

/** Forced alignment for the fake voice: each stretch of sound is the next word. */
const alignOf = (asked) => async ({ samples, text, sampleRate }) => {
  asked.push(text);
  const hop = Math.round(0.01 * sampleRate);
  const regions = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let peak = 0;
    for (let j = i; j < i + hop; j++) peak = Math.max(peak, Math.abs(samples[j]));
    const last = regions.at(-1);
    if (peak > 0.01) {
      if (last && i - last.end <= 3 * hop) last.end = i + hop;
      else regions.push({ start: i, end: i + hop });
    }
  }
  const words = text.replace(/[.।]$/u, '').split(' ');
  return { words: words.map((word, n) => ({ text: word, start: regions[n].start / sampleRate, end: regions[n].end / sampleRate })) };
};

const syncDeps = ({ align } = {}) => ({
  voiceLines: async (lines, { onLine }) =>
    lines.map((entry, n) => {
      onLine(n + 1);
      return voiceOf(entry.text.replace(/[.।]$/u, ''));
    }),
  decode: async (samples) => samples,
  encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))), contentType: 'audio/test' }),
  ...(align && { align }),
});

const SEGMENTS = [cue(1, 1, 2.5, 'aaaaaaaaaa aaaaaaaaaa'), cue(2, 3.5, 4.5, 'bbbbbbbbbb')];
const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };
/** Tighten silences is Line sync's: Chunk sync leaves the silence out between chunks instead. */
const run = (deps, params = {}) => {
  clearClipCache();
  return runSync({ segments: SEGMENTS, sourceDuration: 6, sampleRate: RATE, voice, ...params, join: { chunkSync: false, ...params.join } }, deps);
};

test('a line too long because its voice pauses on room tone is tightened to fit, its words timed first', async () => {
  const off = await run(syncDeps(), { join: { tightenSilences: false } });
  assert.equal(off.report.units[0].exceeded, true, 'Shorten pauses alone cannot fit it: the room tone is not true silence');

  const asked = [];
  const { report, bank } = await run(syncDeps({ align: alignOf(asked) }));
  const unit = report.units[0];
  assert.deepEqual(asked, ['aaaaaaaaaa aaaaaaaaaa'], 'only the line that runs long is aligned');
  assert.ok(unit.silenceTightened > 0.8, `tightened ${unit.silenceTightened} s`);
  assert.equal(unit.exceeded, false);
  assert.equal(unit.inSync, true);
  assert.equal(unit.cutCheckError, null);
  assert.equal(report.units[1].silenceTightened, 0, 'a line that fits is left as voiced');
  assert.equal(report.summary.silenceTightened, 1);
  assert.ok(bank.lines[0].cuts.length > 0 && bank.lines[0].cuts.every((cut) => Number.isInteger(cut.blend)));
});

test('a line whose words cannot be timed is left as it is, and says why', async () => {
  const { report } = await run(syncDeps({ align: async () => { throw new Error('No ElevenLabs key.'); } }));
  assert.equal(report.units[0].silenceTightened, 0);
  assert.equal(report.units[0].exceeded, true);
  assert.equal(report.units[0].cutCheckError, 'No ElevenLabs key.');
  assert.equal(report.summary.cutChecksFailed, 1);
});

test('with Check cuts against word timing off, a line is tightened without asking for its words', async () => {
  const { report } = await run(syncDeps(), { join: { checkCutWords: false } });
  assert.ok(report.units[0].silenceTightened > 0.8);
  assert.equal(report.units[0].exceeded, false);
});

test('a tightened line locked in Edit timing is rebuilt sample for sample in the next sync', async () => {
  const first = await run(syncDeps({ align: alignOf([]) }));
  const line = first.bank.lines[0];
  const start = line.startSample / RATE;
  const locked = { 1: { hash: line.hash, cuts: line.cuts, crossfade: line.crossfade, start, end: start + line.length / RATE } };
  const asked = [];
  const second = await run(syncDeps({ align: alignOf(asked) }), { locked });
  const kept = second.bank.lines[0];
  assert.equal(kept.locked, true);
  assert.deepEqual(asked, [], 'a locked line is cut as before, not aligned again');
  assert.deepEqual(
    second.bank.samples.subarray(kept.bankStart, kept.bankStart + kept.length),
    first.bank.samples.subarray(line.bankStart, line.bankStart + line.length)
  );
});
