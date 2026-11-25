import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTranscriptDraft, draftChanges, retimeWords, withSourceWords } from './transcriptEdit.ts';
import { speakerOf } from './speakers.ts';
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

test('saving drops removed lines, keeps times, sets speakers', () => {
  const segments = [seg('1', 'one'), { ...seg('2', 'two'), startTime: 4, endTime: 5 }, { ...seg('3', 'three'), startTime: 6, endTime: 7 }];
  const draft = [
    { id: '1', text: 'one!', speaker: speakerOf(segments[0]), removed: false },
    { id: '2', text: 'two', speaker: 'Speaker 2', removed: false },
    { id: '3', text: 'three', speaker: speakerOf(segments[2]), removed: true },
  ];
  assert.deepEqual(draftChanges(segments, draft, speakerOf), { edited: 1, removed: 1, speakers: 1, total: 3 });
  const out = applyTranscriptDraft(segments, draft, speakerOf);
  assert.equal(out.length, 2);
  assert.equal(out[0].textSource, 'one!');
  assert.equal(out[0].speaker, undefined);
  assert.equal(out[1].speaker, 'Speaker 2');
  assert.equal(out[1].startTime, 4);
});

test('nothing changed: the same lines come back', () => {
  const segments = [seg('1', 'one', { words })];
  const draft = [{ id: '1', text: 'one', speaker: speakerOf(segments[0]), removed: false }];
  assert.equal(draftChanges(segments, draft, speakerOf).total, 0);
  assert.equal(applyTranscriptDraft(segments, draft, speakerOf)[0], segments[0]);
});
