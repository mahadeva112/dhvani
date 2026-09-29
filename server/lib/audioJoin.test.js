import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPassages, DUB_LEAD_IN_SECONDS, DUB_RUN_OUT_SECONDS } from './audioJoin.js';
import { speechLoudness } from './loudness.js';

const RATE = 8000;

/** `lead` s of silence, `tone` s of a sine at `level`, `tail` s of silence. */
const passage = ({ lead = 0, tone = 0.5, tail = 0, level = 0.3 } = {}) => {
  const samples = new Float32Array(Math.round((lead + tone + tail) * RATE));
  const from = Math.round(lead * RATE);
  const to = from + Math.round(tone * RATE);
  for (let i = from; i < to; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return samples;
};

/** Speech-like audio: partials under a slow envelope, with a soft breath and a decay into silence either side. */
const voiced = ({ seconds = 0.6, level = 0.4, seed = 1 } = {}) => {
  let state = seed;
  const noise = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.05;
  const lead = Math.round(0.2 * RATE);
  const body = Math.round(seconds * RATE);
  const out = new Float32Array(lead + body + Math.round(0.4 * RATE));
  // A breath at about -52 dBFS before the first word: above silence, below speech.
  for (let i = Math.round(0.1 * RATE); i < lead; i++) out[i] = 0.0025 * Math.sin(i * 0.9);
  for (let i = 0; i < body; i++) {
    const t = i / RATE;
    const env = Math.sin((Math.PI * i) / body) ** 0.3;
    out[lead + i] = level * env * (0.6 * Math.sin(2 * Math.PI * 190 * t) + 0.3 * Math.sin(2 * Math.PI * 520 * t + 1) + noise());
  }
  // The last word's decay, fading well below -60 dBFS.
  const decayFrom = lead + body;
  for (let i = 0; i < Math.round(0.3 * RATE); i++) out[decayFrom + i] = 0.02 * Math.exp(-i / 180) * Math.sin(i * 0.7);
  return out;
};

const seconds = (samples) => samples.length / RATE;
const firstSound = (samples, threshold = 0.0032) => samples.findIndex((s) => Math.abs(s) > threshold);
const lastSound = (samples, threshold = 0.0032) => {
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]) <= threshold) last--;
  return last;
};
const leadingSilence = (samples) => firstSound(samples) / RATE;
const trailingSilence = (samples) => (samples.length - 1 - lastSound(samples)) / RATE;
const audible = (samples) => samples.filter((s) => Math.abs(s) >= 0.001).length;

/** Where `needle` sits inside `haystack`, sample for sample, or -1. */
const indexOfRun = (haystack, needle) => {
  outer: for (let at = 0; at <= haystack.length - needle.length; at++) {
    for (let i = 0; i < needle.length; i++) if (haystack[at + i] !== needle[i]) continue outer;
    return at;
  }
  return -1;
};

test('a dub that starts on its first syllable and stops on its last gets a lead-in and run-out', () => {
  const joined = joinPassages([passage({ lead: 0, tail: 0 })], { sampleRate: RATE });
  assert.ok(Math.abs(leadingSilence(joined) - (DUB_LEAD_IN_SECONDS + 0.03)) < 0.005);
  assert.ok(trailingSilence(joined) >= DUB_RUN_OUT_SECONDS);
});

test('the lead-in and run-out are the same however much silence a take left', () => {
  const joined = joinPassages([passage({ lead: 1.2, tail: 0 }), passage({ lead: 0, tail: 2 })], { sampleRate: RATE, pauses: [0.3] });
  // The lead-in plus a breath of room before the first sound, not the take's 1.2 s.
  assert.ok(Math.abs(leadingSilence(joined) - (DUB_LEAD_IN_SECONDS + 0.03)) < 0.005);
  // The run-out plus room for the last word, not the take's two seconds.
  assert.ok(Math.abs(trailingSilence(joined) - (DUB_RUN_OUT_SECONDS + 0.15)) < 0.005);
});

test('the pause between passages runs from the last word of one to the first word of the next', () => {
  const a = passage({ lead: 0.1, tail: 0 });
  const b = passage({ lead: 0.9, tail: 0.1 });
  const joined = joinPassages([a, b], { sampleRate: RATE, pauses: [0.35], leadIn: 0, runOut: 0 });
  // Find the gap between the two tones: 0.35 s asked for, plus the room either side of the words.
  const firstEnd = firstSound(joined) + 0.5 * RATE;
  let nextStart = firstEnd;
  while (Math.abs(joined[nextStart]) <= 0.0032) nextStart++;
  assert.ok(Math.abs((nextStart - firstEnd) / RATE - (0.35 + 0.08 + 0.03)) < 0.005, `gap ${(nextStart - firstEnd) / RATE}`);
});

test('every passage is copied sample for sample: no gain, no fade, and no breath or decay trimmed', () => {
  const parts = [voiced({ level: 0.1, seed: 1 }), voiced({ level: 0.6, seed: 2 }), voiced({ level: 0.3, seed: 3 })];
  const joined = joinPassages(parts, { sampleRate: RATE, pauses: [0.35, 0.8] });
  for (const [n, part] of parts.entries()) {
    // The whole audible part of each passage, breath and decay included, is in the dub unchanged.
    const from = firstSound(part, 0.001);
    const to = lastSound(part, 0.001) + 1;
    assert.ok(indexOfRun(joined, part.subarray(from, to)) >= 0, `passage ${n + 1} is not in the dub as it was voiced`);
  }
  assert.equal(audible(joined), parts.reduce((sum, part) => sum + audible(part), 0));
});

test('what the join did to each passage is reported', () => {
  const log = [];
  joinPassages([voiced({ seed: 1 }), voiced({ seed: 2 })], { sampleRate: RATE, pauses: [0.35], log: (entry) => log.push(entry) });
  assert.equal(log.length, 2);
  for (const entry of log) {
    assert.equal(entry.gain, 1);
    assert.equal(entry.microFade, false, 'passages that start and end in silence need no fade');
  }
});

test('a take that stops mid-waveform gets no step, and at most a few milliseconds of edge treatment', () => {
  // Takes that start and end at full level, with no silence at all.
  const loud = () => passage({ tone: 0.3, level: 0.5 });
  const log = [];
  const joined = joinPassages([loud(), loud(), loud()], { sampleRate: RATE, pauses: [0, 0], leadIn: 0, runOut: 0, log: (e) => log.push(e) });
  let biggestStep = 0;
  for (let i = 1; i < joined.length; i++) biggestStep = Math.max(biggestStep, Math.abs(joined[i] - joined[i - 1]));
  // A 220 Hz sine at 0.5 moves at most ~0.087 per sample at 8 kHz.
  assert.ok(biggestStep < 0.1, `step of ${biggestStep}`);
  for (const entry of log) {
    assert.ok(entry.fadeInSamples <= Math.round(0.003 * RATE) && entry.fadeOutSamples <= Math.round(0.003 * RATE));
    assert.ok(entry.edgeTrimStartSamples <= Math.round(0.005 * RATE) && entry.edgeTrimEndSamples <= Math.round(0.005 * RATE));
  }
});

test('passages keep their own loudness unless evening it out is asked for', () => {
  const parts = [passage({ level: 0.3 }), passage({ level: 0.15 }), passage({ level: 0.3 })];
  const piece = (joined, n) => joined.subarray(Math.round(n * RATE), Math.round((n + 0.4) * RATE));
  const at = (joined, k) => (firstSound(joined) + k * (0.5 + 0.5 + 0.11) * RATE) / RATE;

  const kept = joinPassages(parts, { sampleRate: RATE, pauses: [0.5, 0.5], leadIn: 0, runOut: 0 });
  const keptRatio = speechLoudness(piece(kept, at(kept, 1)), RATE) / speechLoudness(piece(kept, at(kept, 0)), RATE);
  assert.ok(Math.abs(20 * Math.log10(keptRatio) + 6.02) < 0.3, 'the quieter passage stays 6 dB quieter');

  const matched = joinPassages(parts, { sampleRate: RATE, pauses: [0.5, 0.5], leadIn: 0, runOut: 0, matchLoudness: true });
  const matchedRatio = speechLoudness(piece(matched, at(matched, 1)), RATE) / speechLoudness(piece(matched, at(matched, 0)), RATE);
  assert.ok(Math.abs(20 * Math.log10(matchedRatio)) < 0.5, 'asked for, the middle passage is lifted to match');
});

test('evened-out loudness is capped and never clips', () => {
  const joined = joinPassages([passage({ level: 0.9 }), passage({ level: 0.9 }), passage({ level: 0.02 })], {
    sampleRate: RATE,
    pauses: [0.2, 0.2],
    leadIn: 0,
    runOut: 0,
    matchLoudness: true,
  });
  const peak = joined.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  assert.ok(peak <= 0.98 + 1e-6);
  // The near-silent passage gets at most +6 dB, not the ~+33 dB a full match would need.
  const tail = joined.subarray(joined.length - Math.round(0.4 * RATE));
  assert.ok(speechLoudness(tail, RATE) === null || speechLoudness(tail, RATE) < 0.03);
});

test('a passage with no speech contributes only its pause', () => {
  const joined = joinPassages([passage({ tail: 0.2 }), new Float32Array(RATE), passage({ lead: 0.2 })], {
    sampleRate: RATE,
    pauses: [0.3, 0.3],
    leadIn: 0,
    runOut: 0,
  });
  assert.ok(seconds(joined) < 0.03 + 0.5 + 0.3 + 0.11 + 0.5 + 0.15 + 0.02);
});
