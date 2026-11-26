import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retimeWords, withSourceWords } from './transcriptEdit.ts';
import type { AudioSegment } from '../types';

const words = [
  { text: 'It', start: 1.0, end: 1.2 },
  { text: 'is', start: 1.2, end: 1.4 },
  { text: 'a', start: 1.5, end: 1.6 },
  { text: 'physical', start: 1.6, end: 2.2 },
  { text: 'process.', start: 2.3, end: 3.0 },
];
const seg = (id: string, text: string, extra: Partial<AudioSegment> = {}): AudioSegment => ({
  id,
  startTime: 1,
  endTime: 3,
  duration: 2,
  textSource: text,
  ...extra,
});

test('a typo fixed keeps every word time', () => {
  const out = retimeWords(words, 'It is a physical procces.', 1, 3);
  assert.deepEqual(out.map((w) => [w.start, w.end]), words.map((w) => [w.start, w.end]));
  assert.equal(out[4].text, 'procces.');
});

test('a replaced word takes the time of the word it replaced', () => {
  const out = retimeWords(words, 'It is a very bodily process.', 1, 3);
  assert.deepEqual(out.map((w) => w.text), ['It', 'is', 'a', 'very', 'bodily', 'process.']);
  assert.equal(out[3].start, 1.6);
  assert.equal(out[4].end, 2.2);
  assert.equal(out[5].start, 2.3);
});

test('a removed filler drops its word only', () => {
  const um = [{ text: 'So,', start: 0, end: 0.3 }, { text: 'um,', start: 0.4, end: 0.7 }, { text: 'divorce', start: 0.8, end: 1.3 }];
  const out = retimeWords(um, 'So, divorce', 0, 1.3);
  assert.deepEqual(out, [um[0], um[2]]);
});

test('no measured words: none are made up', () => {
  assert.deepEqual(retimeWords([], 'new words', 0, 1), []);
  const typed = withSourceWords(seg('1', 'old'), 'new');
  assert.equal(typed.words, undefined);
  assert.equal(typed.textSource, 'new');
});

test('legacy text fields follow the edit', () => {
  const out = withSourceWords(seg('1', 'old', { originalText: 'old', text: 'old', words }), 'It is a physical process.');
  assert.equal(out.originalText, 'It is a physical process.');
  assert.equal(out.text, 'It is a physical process.');
});
