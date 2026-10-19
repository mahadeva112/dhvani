import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSpeechSegments, gateFromSensitivity, getSensitivityProfile } from './audioService.ts';

const RATE = 8000;

/** A mono AudioBuffer stand-in: a 200 Hz tone at each [start, end, dB] second range, silence elsewhere. */
const bufferOf = (seconds: number, ranges: [number, number, number][]) => {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (const [start, end, db] of ranges) {
    const gain = 10 ** (db / 20);
    for (let i = Math.round(start * RATE); i < Math.round(end * RATE); i++) data[i] = gain * Math.sin((2 * Math.PI * 200 * i) / RATE);
  }
  return { numberOfChannels: 1, sampleRate: RATE, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};

const natural = { openDb: -36, hysteresisDb: 12, minSilence: 0.13, minSlice: 0.14, leadPad: 0.01, trailPad: 0.02 };

test('a sensitivity sets a gate 6 dB either side of its old single level', () => {
  const level = 20 * Math.log10(getSensitivityProfile(50).silenceThreshold);
  const gate = gateFromSensitivity(50);
  assert.ok(Math.abs(gate.openDb - (level + 6)) <= 0.5);
  assert.ok(Math.abs(gate.openDb - gate.hysteresisDb - (level - 6)) <= 0.5);
});

test('two phrases with a real pause become two padded segments', () => {
  const segments = detectSpeechSegments(bufferOf(3, [[0.5, 1.2, -12], [1.6, 2.4, -12]]), { gate: natural });
  assert.equal(segments.length, 2);
  assert.ok(Math.abs(segments[0].startTime - 0.49) < 0.011);
  assert.ok(Math.abs(segments[0].endTime - 1.22) < 0.011);
  assert.ok(Math.abs(segments[1].startTime - 1.59) < 0.011);
});

test('a soft breath between the two levels does not split a phrase', () => {
  // -44 dB sits under the -36 dB open level but over the -48 dB close level.
  const buffer = bufferOf(3, [[0.5, 1.2, -12], [1.2, 1.5, -44], [1.5, 2.4, -12]]);
  assert.equal(detectSpeechSegments(buffer, { gate: natural }).length, 1);
  assert.equal(detectSpeechSegments(buffer, { gate: { ...natural, hysteresisDb: 0 } }).length, 2);
});

test('a click shorter than the shortest cue is not a segment', () => {
  const segments = detectSpeechSegments(bufferOf(3, [[0.5, 0.52, -6], [1.0, 2.0, -12]]), { gate: natural });
  assert.equal(segments.length, 1);
  assert.ok(segments[0].startTime > 0.9);
});
