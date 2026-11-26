import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPauseMarks, withPauseMarks } from './pauseMarks.ts';
import type { AudioSegment } from '../types';

const words = [
  { text: 'But', start: 0.3, end: 0.5 }, { text: 'these', start: 0.55, end: 0.8 }, { text: 'beings,', start: 0.85, end: 1.3 },
  { text: 'being', start: 1.8, end: 2.1 }, { text: 'here', start: 2.15, end: 2.4 },
];
const seg = (extra: Partial<AudioSegment> = {}): AudioSegment =>
  ({ id: 'c1', startTime: 0, endTime: 3, duration: 3, textSource: 'But these beings, being here', textTarget: 'लेकिन ये विभूतियाँ, यहाँ आकर', words, ...extra }) as AudioSegment;

test('a cue needs marks when its original pauses inside it and its line has none for that', () => {
  assert.equal(needsPauseMarks(seg()), true);
  assert.equal(needsPauseMarks(seg({ pausedTarget: 'लेकिन ये विभूतियाँ, [pause 0.5s] यहाँ आकर' })), false);
  // Marks from an older wording no longer count.
  assert.equal(needsPauseMarks(seg({ pausedTarget: 'लेकिन ये लोग, [pause 0.5s] यहाँ आकर' })), true);
  // No pause, no dub line, or words that don't match the original: nothing to mark.
  assert.equal(needsPauseMarks(seg({ words: words.map((w, i) => (i >= 3 ? { ...w, start: w.start - 0.3, end: w.end - 0.3 } : w)) })), false);
  assert.equal(needsPauseMarks(seg({ textTarget: '' })), false);
  assert.equal(needsPauseMarks(seg({ textSource: 'But these beings' })), false);
});

test('marks go only on a cue that still says the line they were made for', () => {
  const marked = [{ id: 'c1', line: 'लेकिन ये विभूतियाँ, यहाँ आकर', pausedTarget: 'लेकिन ये विभूतियाँ, [pause 0.5s] यहाँ आकर' }];
  assert.equal(withPauseMarks([seg()], marked)?.[0].pausedTarget, marked[0].pausedTarget);
  assert.equal(withPauseMarks([seg({ textTarget: 'बदली हुई लाइन' })], marked), null);
});
