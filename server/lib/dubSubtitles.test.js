import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTimesForCues } from './dubSubtitles.js';

test('each cue token gets the time its word is said in the dub', () => {
  const cues = [
    { id: 'a', text: 'আমরা বাড়ি যাব।' },
    { id: 'b', text: 'Then, we sleep.' },
  ];
  const words = [
    { text: 'আমরা', start: 0.5, end: 0.9 },
    { text: 'বাড়ি', start: 0.95, end: 1.3 },
    { text: 'যাব', start: 1.35, end: 1.8 },
    { text: 'Then', start: 2.4, end: 2.6 },
    { text: 'we', start: 2.65, end: 2.8 },
    { text: 'sleep', start: 2.85, end: 3.3 },
  ];
  assert.deepEqual(wordTimesForCues(words, cues), [
    {
      id: 'a',
      words: [
        { text: 'আমরা', start: 0.5, end: 0.9 },
        { text: 'বাড়ি', start: 0.95, end: 1.3 },
        { text: 'যাব।', start: 1.35, end: 1.8 },
      ],
    },
    {
      id: 'b',
      words: [
        { text: 'Then,', start: 2.4, end: 2.6 },
        { text: 'we', start: 2.65, end: 2.8 },
        { text: 'sleep.', start: 2.85, end: 3.3 },
      ],
    },
  ]);
});

test('a token with no letters sits where the word before it ended', () => {
  const out = wordTimesForCues(
    [
      { text: 'yes', start: 1, end: 1.4 },
      { text: 'no', start: 2, end: 2.3 },
    ],
    [{ id: 1, text: 'yes — no' }]
  );
  assert.deepEqual(out[0].words[1], { text: '—', start: 1.4, end: 1.4 });
});

test('words that do not spell out the script give no timing at all', () => {
  assert.equal(wordTimesForCues([{ text: 'hello', start: 0, end: 1 }], [{ id: 'a', text: 'goodbye' }]), null);
  assert.equal(wordTimesForCues([{ text: 'one', start: 0, end: 1 }], [{ id: 'a', text: 'one two' }]), null);
});
