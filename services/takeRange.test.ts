import test from 'node:test';
import assert from 'node:assert/strict';
import { wordsInTakeRange } from './takeRange.ts';
import type { SyncEditPart } from './syncEditModel.ts';

const words = [
  { index: 0, text: 'one', start: 0.2, end: 0.5 },
  { index: 1, text: 'two', start: 0.6, end: 1 },
  { index: 2, text: 'three', start: 1.2, end: 1.7 },
];
const part: SyncEditPart = { id: 'x', start: 10, from: 0, to: 2, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false };

test('waveform range snaps to measured words, including a reversed drag', () => {
  const result = { from: 1, to: 2, start: 10.6, end: 11.7, text: 'two three' };
  assert.deepEqual(wordsInTakeRange(words, part, 10.8, 11.5), result);
  assert.deepEqual(wordsInTakeRange(words, part, 11.5, 10.8), result);
});
test('moved, slipped, trimmed and stretched parts use their bank-relative word times', () => {
  const edited = { ...part, start: 20, from: 0.6, to: 1.8, rate: 1.2 };
  const result = wordsInTakeRange(words, edited, 20.05, 20.8);
  assert.equal(result?.text, 'two three');
  assert.equal(result?.start, 20);
  assert.equal(result?.end, 20 + (1.7 - 0.6) / 1.2);
});
test('silence, outside the clip and muted parts never guess a phrase', () => {
  assert.equal(wordsInTakeRange(words, part, 10.51, 10.59), null);
  assert.equal(wordsInTakeRange(words, part, 5, 6), null);
  assert.equal(wordsInTakeRange(words, { ...part, muted: true }, 10, 12), null);
  assert.equal(wordsInTakeRange(words, part, NaN, 12), null);
});
test('words cut by a split or trim are excluded, not replaced beyond that part', () => {
  const cut = { ...part, from: 0.3, to: 1.5 };
  assert.equal(wordsInTakeRange(words, cut, 10, 12)?.text, 'two');
  assert.equal(wordsInTakeRange(words, { ...part, from: 0.3, to: 0.4 }, 10, 12), null);
});
