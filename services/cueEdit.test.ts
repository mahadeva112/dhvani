import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cueTokens, joinCues, moveCut, moveDubBreak, nearestCut, splitCue, suggestDubBreak } from './cueEdit.ts';
import type { AudioSegment } from '../types';

const timedCue = (): AudioSegment => ({
  id: 7,
  startTime: 4.6,
  endTime: 8.2,
  duration: 3.6,
  speaker: 'A',
  emotion: '[calm]',
  dubTargetSeconds: 3.2,
  textSource: 'Do not fight your thoughts, just watch them.',
  textTarget: 'চিন্তার সঙ্গে লড়বেন না, শুধু তাদের দেখুন।',
  targetText: 'চিন্তার সঙ্গে লড়বেন না, শুধু তাদের দেখুন।',
  timingSource: 'elevenlabs',
  words: [
    { text: 'Do', start: 4.6, end: 4.8 },
    { text: 'not', start: 4.85, end: 5.0 },
    { text: 'fight', start: 5.05, end: 5.4 },
    { text: 'your', start: 5.45, end: 5.6 },
    { text: 'thoughts,', start: 5.65, end: 6.1 },
    { text: 'just', start: 6.6, end: 6.8 },
    { text: 'watch', start: 6.85, end: 7.2 },
    { text: 'them.', start: 7.25, end: 8.2 },
  ],
});

test('a split lands on the measured word gap and keeps the outer times', () => {
  const result = splitCue(timedCue(), 5, 'new')!;
  assert.equal(result.first.id, 7);
  assert.equal(result.second.id, 'new');
  assert.equal(result.first.startTime, 4.6);
  assert.equal(result.first.endTime, 6.1);
  assert.equal(result.second.startTime, 6.6);
  assert.equal(result.second.endTime, 8.2);
  assert.equal(result.first.textSource, 'Do not fight your thoughts,');
  assert.equal(result.second.textSource, 'just watch them.');
  assert.equal(result.first.words!.length, 5);
  assert.equal(result.second.words!.length, 3);
  assert.equal(result.first.timingSource, 'elevenlabs');
  assert.equal(result.second.timingSource, 'elevenlabs');
  assert.ok(Math.abs(result.pause - 0.5) < 1e-9);
});

test('the dub breaks after the punctuation nearest the cut, and both fields agree', () => {
  const { first, second, clean } = splitCue(timedCue(), 5, 'new')!;
  assert.equal(first.textTarget, 'চিন্তার সঙ্গে লড়বেন না,');
  assert.equal(second.textTarget, 'শুধু তাদের দেখুন।');
  assert.equal(first.targetText, first.textTarget);
  assert.equal(second.targetText, second.textTarget);
  assert.equal(clean, true);
});

test('the trim stays with the line’s first cue; speaker and tone go to both', () => {
  const { first, second } = splitCue(timedCue(), 3, 'new')!;
  assert.equal(first.dubTargetSeconds, 3.2);
  assert.equal(second.dubTargetSeconds, undefined);
  assert.equal(second.speaker, 'A');
  assert.equal(second.emotion, '[calm]');
});

test('a cut mid-phrase has no pause and is not clean', () => {
  const result = splitCue(timedCue(), 7, 'new')!;
  assert.ok(result.pause < 0.1);
  assert.equal(result.clean, false);
});

test('a cut outside the words is refused', () => {
  assert.equal(splitCue(timedCue(), 0, 'new'), null);
  assert.equal(splitCue(timedCue(), 8, 'new'), null);
  assert.equal(splitCue(timedCue(), 2.5, 'new'), null);
});

test('a cue with no word timings is cut by word length and marked derived', () => {
  const cue: AudioSegment = { id: 1, startTime: 10, endTime: 14, duration: 4, textSource: 'aaaa bbbb cccc dddd', textTarget: 'w x y z' };
  const { first, second } = splitCue(cue, 2, 2)!;
  assert.equal(first.endTime, 12);
  assert.equal(second.startTime, 12);
  assert.equal(first.timingSource, 'derived');
  assert.equal(second.timingSource, 'derived');
  assert.deepEqual(first.words, []);
});

test('join puts a split back as it was', () => {
  const cue = timedCue();
  const { first, second } = splitCue(cue, 5, 'new')!;
  const joined = joinCues(first, second);
  assert.equal(joined.id, 7);
  assert.equal(joined.startTime, cue.startTime);
  assert.equal(joined.endTime, cue.endTime);
  assert.equal(joined.textSource, cue.textSource);
  assert.equal(joined.textTarget, cue.textTarget);
  assert.deepEqual(joined.words, cue.words);
  assert.equal(joined.dubTargetSeconds, 3.2);
});

test('moving the cut shifts whole words and keeps each dub text', () => {
  const { first, second } = splitCue(timedCue(), 5, 'new')!;
  const [a, b] = moveCut(first, second, 6)!;
  assert.equal(a.textSource, 'Do not fight your thoughts, just');
  assert.equal(b.textSource, 'watch them.');
  assert.equal(a.endTime, 6.8);
  assert.equal(b.startTime, 6.85);
  assert.equal(a.textTarget, first.textTarget);
  assert.equal(b.textTarget, second.textTarget);
  assert.equal(moveCut(first, second, 5), null);
  assert.equal(moveCut(first, second, 0), null);
});

test('moving the dub break re-divides the joined dub text', () => {
  const { first, second } = splitCue(timedCue(), 5, 'new')!;
  const [a, b] = moveDubBreak(first, second, 2);
  assert.equal(a.textTarget, 'চিন্তার সঙ্গে');
  assert.equal(b.textTarget, 'লড়বেন না, শুধু তাদের দেখুন।');
});

test('the nearest cut follows the playhead to a word gap', () => {
  const { tokens } = cueTokens(timedCue());
  assert.equal(nearestCut(tokens, 6.3), 5);
  assert.equal(nearestCut(tokens, 7.21), 7);
});

test('the dub break falls back to the same share when there is no punctuation nearby', () => {
  assert.equal(suggestDubBreak(['a', 'b', 'c', 'd', 'e', 'f'], 0.5), 3);
  assert.equal(suggestDubBreak(['a', 'b,', 'c', 'd', 'e', 'f'], 0.5), 2);
  assert.equal(suggestDubBreak(['one'], 0.5), 1);
});
