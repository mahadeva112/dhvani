import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePauseCuts, soundFirstCut, levelDb, nearestResume } from './sourceCuts.js';
import { wordKinds } from './chunkSync.js';
import { stripPauses } from './linePauses.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;
const letters = (text) => text.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').length;
const cue = (id, startTime, endTime, text, words, extra = {}) => ({ id, startTime, endTime, textTarget: text, textSource: `src ${id}`, words, ...extra });

test("a line's cuts at pauses: between its cues, and inside a cue where its translation marked the speaker's pause", () => {
  const one = cue(1, 1, 3, 'नमस्ते दोस्तों, आज हम', [
    { text: 'Hello', start: 1, end: 1.4 },
    { text: 'friends,', start: 1.45, end: 1.9 },
    { text: 'today', start: 2.5, end: 2.8 },
    { text: 'we', start: 2.85, end: 3 },
  ], { pausedTarget: 'नमस्ते दोस्तों, [pause 0.6s] आज हम' });
  const two = cue(2, 3.35, 4.2, 'कुछ नया लाए हैं।', [{ text: 'bring', start: 3.35, end: 3.7 }, { text: 'something', start: 3.75, end: 4.2 }]);
  const text = 'नमस्ते दोस्तों, आज हम कुछ नया लाए हैं।';
  const cuts = sourcePauseCuts([two, one], text);
  assert.deepEqual(cuts, [
    { letters: letters('नमस्ते दोस्तों'), seconds: 0.6, resume: 2.5 },
    { letters: letters('नमस्ते दोस्तों आज हम'), seconds: 3.35 - 3, resume: 3.35 },
  ]);
  // Pauses shorter than asked for, and cuts the user turned off, are left out.
  assert.deepEqual(sourcePauseCuts([one, two], text, { minPause: 0.5 }).map((c) => c.letters), [letters('नमस्ते दोस्तों')]);
  assert.deepEqual(sourcePauseCuts([one, two], text, { skip: [letters('नमस्ते दोस्तों')] }).map((c) => c.letters), [letters('नमस्ते दोस्तों आज हम')]);
  // Edited, the cue's marks no longer say where its pauses are; the pause between the cues still stands.
  const edited = { ...one, textTarget: 'नमस्ते साथियों, आज हम' };
  assert.deepEqual(sourcePauseCuts([edited, two], 'नमस्ते साथियों, आज हम कुछ नया लाए हैं।').map((c) => c.letters), [letters('नमस्ते साथियों आज हम')]);
  // A line that isn't its cues' words has none.
  assert.deepEqual(sourcePauseCuts([one, two], 'कुछ और'), []);
  // Marks fewer than the cue's pauses: where the speaker starts again isn't known for certain.
  const fewer = { ...one, words: [...one.words.slice(0, 3), { text: 'we', start: 3.4, end: 3.6 }], endTime: 3.6 };
  assert.equal(sourcePauseCuts([fewer], 'नमस्ते दोस्तों, आज हम')[0].resume, null);
});

const tone = (samples, from, to, level = 0.3) => {
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
};

test('sound first: at the voice own pause, else only after a comma where the sound dips, never where it runs on', () => {
  const samples = new Float32Array(RATE * 2);
  tone(samples, 0.1, 0.6);
  tone(samples, 0.6, 0.62, 0.02); // the sound dips to a murmur between the first two words
  tone(samples, 0.62, 1.1);
  tone(samples, 1.1, 1.6); // the last two run straight on
  const words = [
    { text: 'aaaa,', start: 0.1, end: 0.6 },
    { text: 'bbbb', start: 0.62, end: 1.1 },
    { text: 'cccc', start: 1.1, end: 1.6 },
  ];
  const text = 'aaaa, bbbb cccc';
  const kinds = wordKinds(text, words);
  const speechDb = levelDb(samples, 0.1 * RATE, 1.6 * RATE);
  const at = (n, chunks = [{ from: 0, to: RATE * 2 }]) => soundFirstCut({ samples, sampleRate: RATE, words, kinds, chunks, letters: n, speechDb });
  const quiet = at(4);
  assert.equal(quiet.how, 'quiet');
  assert.ok(quiet.at >= 0.6 * RATE && quiet.at <= 0.62 * RATE, `cut in the dip, at ${quiet.at / RATE}`);
  assert.deepEqual(at(8), { why: 'runs-on' }, 'no comma there, and no pause of its own');
  assert.deepEqual(at(5), { why: 'words' }, 'not between two words');
  // Where the voice went quiet itself, its own pause is used, comma or not.
  assert.deepEqual(at(8, [{ from: 0, to: 1.1 * RATE }, { from: 1.1 * RATE, to: 2 * RATE }]), { at: 1.1 * RATE, how: 'voice' });
  // A comma where the sound doesn't dip is no place to cut.
  const loud = new Float32Array(samples);
  tone(loud, 0.6, 0.62);
  assert.deepEqual(soundFirstCut({ samples: loud, sampleRate: RATE, words, kinds, chunks: [{ from: 0, to: RATE * 2 }], letters: 4, speechDb }), { why: 'runs-on' });
});

test('a part without a known place to start again starts at the nearest end of a pause of the original', () => {
  assert.equal(nearestResume([[1, 1.5], [3, 3.6]], 3.2), 3.6);
  assert.equal(nearestResume([[1, 1.5]], 4), null);
});

// ---- In a sync ----

const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };
/** A voice that reads each word as 0.08 s a letter and runs straight on, 0.05 s between words; pause marks it doesn't say. */
const runOn = (text) => {
  const words = stripPauses(text).replace(/<break[^>]*>|…/g, ' ').replace(/[.।]$/u, '').split(/\s+/).filter(Boolean);
  const length = 0.15 + words.reduce((sum, w) => sum + w.replace(/[^a-z]/g, '').length * 0.08 + 0.05, 0);
  const samples = new Float32Array(Math.round(length * RATE));
  let at = 0.15;
  for (const w of words) {
    const seconds = w.replace(/[^a-z]/g, '').length * 0.08;
    tone(samples, at, at + seconds);
    at += seconds + 0.05;
  }
  return samples;
};
/** Forced alignment for the fake voice: each stretch of sound is the next word. */
const align = async ({ samples, text, sampleRate }) => {
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
  return { words: text.split(/\s+/).map((word, n) => ({ text: word, start: regions[n].start / sampleRate, end: regions[n].end / sampleRate })) };
};
const deps = {
  voiceLines: async (lines, { onLine }) => lines.map((line, n) => (onLine(n + 1), runOn(line.text))),
  decode: async (samples) => samples,
  encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))), contentType: 'audio/test' }),
  align,
};

/** The speaker pauses 0.8 s after the first word; translation marked it, after a comma; the voice reads straight on. */
const PAUSED = (text = 'aaaaaaa, bbbbbbb ccccccc', mark = 'aaaaaaa, [pause 0.8s] bbbbbbb ccccccc') =>
  cue(1, 1, 4, text, [
    { text: 'A', start: 1, end: 1.6 },
    { text: 'B', start: 2.4, end: 3.2 },
    { text: 'C', start: 3.25, end: 4 },
  ], { pausedTarget: mark });
const sync = async (segments, join = {}) => {
  clearClipCache();
  return runSync({ segments, sourceDuration: 8, sampleRate: RATE, voice, join }, deps);
};
/** Seconds of silence the dub leaves between each two chunks of line `n`. */
const gapsOf = (bank, n = 0) => {
  const chunks = bank.lines[n].chunks;
  return chunks.slice(1).map((chunk, k) => (chunk.startSample - (chunks[k].startSample + chunks[k].to - chunks[k].from)) / RATE);
};

test("a line the voice read straight on is cut at the original's pause, the part after it where the speaker starts again", async () => {
  const off = await sync([PAUSED()], { cutAtSourcePauses: false });
  assert.equal(off.bank.lines[0].chunks.length, 1, 'off, it stays in one piece');

  const { bank, report } = await sync([PAUSED()], { sourceCutMaxInsert: 1 });
  assert.equal(bank.lines[0].chunks.length, 2);
  // The cut is in the 0.05 s between the words, so the part's first word is about 0.025 s in.
  const second = bank.lines[0].chunks[1];
  assert.ok(Math.abs(second.startSample / RATE + 0.025 - 2.4) < 0.02, `the second word at ${(second.startSample / RATE + 0.025).toFixed(3)} s`);
  assert.deepEqual(report.units[0].sourceCuts, { made: [{ letters: 7, how: 'quiet' }], skipped: [] });
  assert.equal(report.summary.sourceCuts, 1);
});

test('a cut at a pause adds no more silence than sourceCutMaxInsert to what the voice left', async () => {
  const { bank, report } = await sync([PAUSED()]);
  assert.equal(bank.lines[0].chunks.length, 2);
  const [gap] = gapsOf(bank);
  assert.ok(Math.abs(gap - 0.4) < 0.02, `0.4 s of new silence: ${gap.toFixed(3)}`);
  assert.equal(report.units[0].timingConflict, null, 'held back by its cap, which is no limit of the user');
});

test('where the voice runs on with no comma, the line is left as it is, and says why', async () => {
  const { bank, report } = await sync([PAUSED('aaaaaaa bbbbbbb ccccccc', 'aaaaaaa [pause 0.8s] bbbbbbb ccccccc')]);
  assert.equal(bank.lines[0].chunks.length, 1);
  assert.deepEqual(report.units[0].sourceCuts, { made: [], skipped: [{ letters: 7, why: 'runs-on' }] });
});

test('a cut that would run a line later into the next one is not made', async () => {
  // After the pause the speaker says the rest quickly, and the next line starts 3.4 s in:
  // started where the speaker starts again, the line's last word would run into it.
  const quick = { ...PAUSED(), endTime: 3.2, words: [{ text: 'A', start: 1, end: 1.6 }, { text: 'B', start: 2.4, end: 2.8 }, { text: 'C', start: 2.85, end: 3.2 }] };
  const next = cue(2, 3.4, 4.2, 'ddddddd', [{ text: 'D', start: 3.4, end: 4.2 }]);
  const { bank, report } = await sync([quick, next], { sourceCutMaxInsert: 1, unitGap: 0 });
  assert.equal(bank.lines[0].chunks.length, 1);
  assert.deepEqual(report.units[0].sourceCuts.skipped, [{ letters: 7, why: 'later' }]);
});

test('a cut the user turned off on the dub lane is not made', async () => {
  const segments = [{ ...PAUSED(), dubPlace: { text: 'aaaaaaa, bbbbbbb ccccccc', skip: [7] } }];
  const { bank } = await sync(segments);
  assert.equal(bank.lines[0].chunks.length, 1);
});
