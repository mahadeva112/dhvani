import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENVELOPE_HOP, onsetBefore, snapWordOnsets } from './onsetSnap.js';

/** An envelope that is loud over each [start, end) second range and silent elsewhere. */
const envelopeOf = (seconds, loud) => {
  const env = new Float32Array(Math.round(seconds / ENVELOPE_HOP));
  for (const [start, end] of loud) {
    for (let i = Math.round(start / ENVELOPE_HOP); i < Math.round(end / ENVELOPE_HOP); i += 1) env[i] = 0.8;
  }
  return env;
};

test('a late word start snaps back to the onset in the waveform', () => {
  // Sound begins at 1.00 s; Scribe said 1.07 s.
  const env = envelopeOf(3, [[1.0, 1.6]]);
  assert.ok(Math.abs(onsetBefore(env, 1.07) - 1.0) < 1e-9);
  const [word] = snapWordOnsets([{ text: 'hello', start: 1.07, end: 1.5, type: 'word' }], env);
  assert.equal(word.start, 1);
  assert.equal(word.end, 1.5);
});

test('a start already in silence, or deep in continuous speech, is left alone', () => {
  const env = envelopeOf(3, [[0.2, 2.8]]);
  assert.equal(onsetBefore(env, 0.1), null); // silence
  assert.equal(onsetBefore(env, 2.0), null); // no gap within 0.3 s
  const words = [
    { text: 'a', start: 1.9, end: 2.0, type: 'word' },
    { text: 'b', start: 2.0, end: 2.4, type: 'word' },
  ];
  assert.deepEqual(snapWordOnsets(words, env).map((w) => w.start), [1.9, 2.0]);
});

test('a snapped start never crosses the previous word, and trims its overshoot', () => {
  // Word one is audible to 1.20 s but Scribe ran it to 1.32 s; word two starts at 1.30 s.
  const env = envelopeOf(3, [[0.5, 1.2], [1.3, 1.9]]);
  const out = snapWordOnsets(
    [
      { text: 'one', start: 0.5, end: 1.32, type: 'word' },
      { text: ' ', start: 1.32, end: 1.36, type: 'spacing' },
      { text: 'two', start: 1.36, end: 1.8, type: 'word' },
    ],
    env
  );
  assert.equal(out[2].start, 1.3);
  assert.equal(out[0].end, 1.3);
  assert.deepEqual(out[1], { text: ' ', start: 1.32, end: 1.36, type: 'spacing' }, 'spacing passes through');
});

test('without a waveform, only words after a pause get a fixed lead', () => {
  const out = snapWordOnsets(
    [
      { text: 'a', start: 1.0, end: 1.3, type: 'word' },
      { text: 'b', start: 1.3, end: 1.6, type: 'word' },
      { text: 'c', start: 2.0, end: 2.3, type: 'word' },
    ],
    null
  );
  assert.deepEqual(out.map((w) => w.start), [0.92, 1.3, 1.92]);
});
