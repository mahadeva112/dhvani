import test from 'node:test';
import assert from 'node:assert/strict';
import { runSync, clearClipCache } from './syncDub.js';
import { placeTake } from './placeTake.js';
import { buildSyncUnits } from './syncUnits.js';

const RATE = 8000;
const tone = (samples, from, to, level = 0.3) => {
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) samples[i] = level * Math.sin(i * 0.3);
};
const cue = (id, startTime, endTime, text, words) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, words });
const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };

/** A voice that reads each word as 0.08 s a letter, with `pause` s after each word and after the line. */
const voiceOf = (pause) => (text) => {
  const words = text.replace(/[.।]$/u, '').split(' ');
  const length = 0.15 + words.reduce((sum, w) => sum + w.replace(/[^a-z]/g, '').length * 0.08 + pause, 0);
  const samples = new Float32Array(Math.round(length * RATE));
  let at = 0.15;
  for (const w of words) {
    const seconds = w.replace(/[^a-z]/g, '').length * 0.08;
    tone(samples, at, at + seconds);
    at += seconds + pause;
  }
  return samples;
};

/** Forced alignment for the fake voice: each stretch of sound is the next word. */
const align = ({ samples, text, sampleRate }) => {
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

const deps = (pause) => ({
  voiceLines: async (lines, { onLine }) =>
    lines.map((line, n) => {
      onLine(n + 1);
      return voiceOf(pause)(line.text);
    }),
  decode: async (samples) => samples,
  encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))), contentType: 'audio/test' }),
  align: async (request) => align(request),
});

/** Three lines; the middle one's speaker says three words with short pauses, where the voice pauses longer. */
const SEGMENTS = [
  cue(1, 0.2, 0.8, 'eeeee', [{ text: 'E', start: 0.2, end: 0.6 }]),
  cue(2, 1.8, 4.2, 'aaaaaaa bbbbbbb ccccccc', [
    { text: 'A', start: 1.8, end: 2.36 },
    { text: 'B', start: 2.72, end: 3.28 },
    { text: 'C', start: 3.64, end: 4.2 },
  ]),
  cue(3, 5.2, 5.8, 'ddddddd', [{ text: 'D', start: 5.2, end: 5.76 }]),
];

/** Where line `index` plays in `bank`, in timeline seconds. */
const spanOf = (bank, index) => {
  const chunks = bank.lines[index].chunks;
  return { start: chunks[0].startSample / RATE, end: Math.max(...chunks.map((c) => (c.startSample + c.to - c.from) / RATE)) };
};

/** The middle line's take put back by placeTake, with the lines either side where Sync put them. */
const placeMiddle = (report, bank, bankSamples, overrides = {}) => {
  const units = buildSyncUnits(SEGMENTS, report.join);
  const line = bank.lines[1];
  const samples = bankSamples.subarray(line.bankStart, line.bankStart + line.length);
  return placeTake({
    samples,
    sampleRate: RATE,
    lead: line.lead,
    speech: line.speech,
    unit: units[1],
    prevUnit: units[0],
    nextUnit: units[2],
    cues: [SEGMENTS[1]],
    nextPlacedStart: units[2].srcStart,
    words: align({ samples, text: units[1].text, sampleRate: RATE }).words,
    prev: spanOf(bank, 0),
    next: spanOf(bank, 2),
    join: report.join,
    tolerance: report.tolerance,
    sourceDuration: 7,
    ...overrides,
  });
};

test('a take put in the dub is cut and placed exactly as Sync cut and placed that line, its neighbours where they are', async () => {
  clearClipCache();
  const { report, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 7, sampleRate: RATE, voice }, deps(0.9));
  assert.equal(bank.lines[1].chunks.length, 3, 'Sync cut the middle line into its three words');
  const placed = placeMiddle(report, bank, bank.samples);
  assert.equal(placed.fits, true);
  assert.deepEqual(placed.chunks, bank.lines[1].chunks);
});

test('a take read with other pauses is cut at its own and its words land on the original, between lines that stay put', async () => {
  clearClipCache();
  const { report, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 7, sampleRate: RATE, voice }, deps(0.9));
  // A new take of the middle line: the same words with shorter pauses than Sync's take, as a retake might read them.
  const take = voiceOf(0.6)('aaaaaaa bbbbbbb ccccccc');
  const words = align({ samples: take, text: 'aaaaaaa bbbbbbb ccccccc', sampleRate: RATE }).words;
  const lead = words[0].start;
  const speech = words.at(-1).end - lead;
  const placed = placeMiddle(report, bank, bank.samples, { samples: take, lead, speech, words });
  assert.equal(placed.chunks.length, 3);
  for (const [n, target] of [1.8, 2.72, 3.64].entries()) {
    const first = placed.chunks[n].startSample / RATE + (words[n].start - placed.chunks[n].from / RATE);
    assert.ok(Math.abs(first - target) <= report.tolerance, `word ${n + 1} at ${first.toFixed(3)} s, the original at ${target} s`);
  }
  // The take's own samples, at its own speed: each chunk is a stretch of the take, in order.
  for (const chunk of placed.chunks) assert.ok(chunk.from >= 0 && chunk.to <= take.length && chunk.to > chunk.from);
  const prev = spanOf(bank, 0);
  const next = spanOf(bank, 2);
  assert.ok(placed.chunks[0].startSample / RATE >= prev.end, 'it starts after the line before it ends');
  const end = Math.max(...placed.chunks.map((c) => (c.startSample + c.to - c.from) / RATE));
  assert.ok(end <= next.start, 'it ends before the line after it starts');
});

test('without its words, and asked to check against them, a take is not cut blind: it stays one part', async () => {
  clearClipCache();
  const { report, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 7, sampleRate: RATE, voice }, deps(0.9));
  const placed = placeMiddle(report, bank, bank.samples, { words: null });
  assert.equal(placed.chunks.length, 1);
});

test('a take too long for the room between its neighbours is placed as well as it can be and says it does not fit', async () => {
  clearClipCache();
  const { report, bank } = await runSync({ segments: SEGMENTS, sourceDuration: 7, sampleRate: RATE, voice }, deps(0.9));
  const take = voiceOf(1.2)('aaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbb ccccccc');
  const text = 'aaaaaaa bbbbbbb ccccccc';
  const words = align({ samples: take, text, sampleRate: RATE }).words;
  const placed = placeMiddle(report, bank, bank.samples, { samples: take, lead: words[0].start, speech: words.at(-1).end - words[0].start, words });
  assert.equal(placed.fits, false);
});
