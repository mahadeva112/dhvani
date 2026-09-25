import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPassages, speechLoudness, DUB_LEAD_IN_SECONDS, DUB_RUN_OUT_SECONDS } from './audioJoin.js';

const RATE = 8000;

/** `lead` s of silence, `tone` s of a sine at `level`, `tail` s of silence. */
const passage = ({ lead = 0, tone = 0.5, tail = 0, level = 0.3 } = {}) => {
  const samples = new Float32Array(Math.round((lead + tone + tail) * RATE));
  const from = Math.round(lead * RATE);
  const to = from + Math.round(tone * RATE);
  for (let i = from; i < to; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return samples;
};

const seconds = (samples) => samples.length / RATE;

const leadingSilence = (samples) => samples.findIndex((s) => Math.abs(s) > 0.0032) / RATE;
const trailingSilence = (samples) => {
  let last = samples.length - 1;
  while (Math.abs(samples[last]) <= 0.0032) last--;
  return (samples.length - 1 - last) / RATE;
};

test('a dub that starts on its first syllable and stops on its last gets a lead-in and run-out', () => {
  const joined = joinPassages([passage({ lead: 0, tail: 0 })], { sampleRate: RATE });
  assert.ok(Math.abs(leadingSilence(joined) - DUB_LEAD_IN_SECONDS) < 0.005);
  assert.ok(trailingSilence(joined) >= DUB_RUN_OUT_SECONDS);
});

test('the lead-in and run-out are the same however much silence a take left', () => {
  const joined = joinPassages(
    [passage({ lead: 1.2, tail: 0 }), passage({ lead: 0, tail: 2 })],
    { sampleRate: RATE, pauses: [0.3] }
  );
  // The lead-in plus the 30 ms kept before the first sound, not the take's 1.2 s.
  assert.ok(Math.abs(leadingSilence(joined) - (DUB_LEAD_IN_SECONDS + 0.03)) < 0.005);
  // The run-out plus the ending's kept decay, not the take's two seconds.
  assert.ok(Math.abs(trailingSilence(joined) - (DUB_RUN_OUT_SECONDS + 0.15)) < 0.005);
});

test('silence at a join is replaced by the requested pause, whatever each take left', () => {
  // One take ends with no tail at all (an abrupt cut), the next starts late.
  const joined = joinPassages(
    [passage({ lead: 0.1, tail: 0 }), passage({ lead: 0.9, tail: 0.1 })],
    { sampleRate: RATE, pauses: [0.35], leadIn: 0, runOut: 0 }
  );
  // 0.03 kept lead + 0.5 tone | 0.35 pause + 0.03 kept lead | 0.5 tone + 0.1 kept ending
  assert.ok(Math.abs(seconds(joined) - (0.03 + 0.5 + 0.35 + 0.03 + 0.5 + 0.1)) < 0.01, `got ${seconds(joined)}s`);
});

test('joins are faded so the waveform never jumps', () => {
  // Takes that start and end mid-waveform, at full level, with no silence.
  const loud = () => passage({ tone: 0.3, level: 0.5 });
  const joined = joinPassages([loud(), loud(), loud()], { sampleRate: RATE, pauses: [0, 0], leadIn: 0, runOut: 0 });
  let biggestStep = 0;
  for (let i = 1; i < joined.length; i++) biggestStep = Math.max(biggestStep, Math.abs(joined[i] - joined[i - 1]));
  // A 220 Hz sine at 0.5 moves at most ~0.087 per sample at 8 kHz.
  assert.ok(biggestStep < 0.1, `step of ${biggestStep}`);
});

test('passages are brought to the same speech loudness', () => {
  const joined = joinPassages(
    [passage({ level: 0.3 }), passage({ level: 0.15 }), passage({ level: 0.3 })],
    { sampleRate: RATE, pauses: [0.5, 0.5], leadIn: 0, runOut: 0 }
  );
  const piece = (n) => joined.subarray(Math.round(n * RATE), Math.round((n + 0.4) * RATE));
  // Passage one fills 0-0.5 s, then a 0.5 s pause; passage two starts at 1.0 s.
  const quiet = speechLoudness(piece(1.05), RATE);
  const reference = speechLoudness(piece(0.03), RATE);
  assert.ok(Math.abs(20 * Math.log10(quiet / reference)) < 0.5, 'middle passage should be lifted to match');
});

test('loudness correction is capped and never clips', () => {
  const joined = joinPassages(
    [passage({ level: 0.9 }), passage({ level: 0.9 }), passage({ level: 0.02 })],
    { sampleRate: RATE, pauses: [0.2, 0.2], leadIn: 0, runOut: 0 }
  );
  const peak = joined.reduce((max, s) => Math.max(max, Math.abs(s)), 0);
  assert.ok(peak <= 0.98 + 1e-6);
  // The near-silent passage gets at most +6 dB, not the ~+33 dB a full match would need.
  const tail = joined.subarray(joined.length - Math.round(0.4 * RATE));
  assert.ok(speechLoudness(tail, RATE) === null || speechLoudness(tail, RATE) < 0.03);
});

test('a passage with no speech contributes only its pause', () => {
  const joined = joinPassages(
    [passage({ tail: 0.2 }), new Float32Array(RATE), passage({ lead: 0.2 })],
    { sampleRate: RATE, pauses: [0.3, 0.3], leadIn: 0, runOut: 0 }
  );
  assert.ok(seconds(joined) < 0.03 + 0.5 + 0.08 + 0.3 + 0.03 + 0.5 + 0.15 + 0.02);
});
