import test from 'node:test';
import assert from 'node:assert/strict';
import { speechLevelDb, medianPitch, takeDiffers } from './takeChecks.js';

const RATE = 16000;
/** A voiced read: a tone at `pitch` Hz with harmonics, at `level`, with pauses of silence. */
const read = ({ pitch = 140, level = 0.3, seconds = 1.5 } = {}) => {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    if (t % 0.5 > 0.4) continue; // a short pause every half second
    samples[i] = level * (Math.sin(2 * Math.PI * pitch * t) + 0.5 * Math.sin(4 * Math.PI * pitch * t) + 0.25 * Math.sin(6 * Math.PI * pitch * t)) / 1.75;
  }
  return samples;
};

test("a take's speech level and pitch are measured from its voiced frames", () => {
  const take = read({ pitch: 140, level: 0.3 });
  assert.ok(Math.abs(medianPitch(take, RATE) - 140) < 4, `pitch ${medianPitch(take, RATE)}`);
  const louder = speechLevelDb(read({ level: 0.6 }), RATE) - speechLevelDb(take, RATE);
  assert.ok(Math.abs(louder - 6.02) < 0.2, `twice the level is 6 dB louder: ${louder}`);
  assert.equal(speechLevelDb(new Float32Array(RATE), RATE), null);
  assert.equal(medianPitch(new Float32Array(RATE), RATE), null);
});

test('a new take is offered only when it sounds like the same read', () => {
  const before = read({ pitch: 140, level: 0.3 });
  assert.equal(takeDiffers(before, read({ pitch: 142, level: 0.32, seconds: 1.3 }), RATE), null, 'a little higher, a little louder, shorter: fine');
  assert.match(takeDiffers(before, read({ level: 0.45 }), RATE), /3\.5 dB louder/);
  assert.match(takeDiffers(before, read({ level: 0.2 }), RATE), /softer/);
  assert.match(takeDiffers(before, read({ pitch: 155 }), RATE), /11% higher/);
});
