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

test('a word said differently costs only its own cue its timing', () => {
  const cues = [
    { id: 'a', text: 'we went home' },
    { id: 'b', text: 'the dog barked loudly' },
    { id: 'c', text: 'then everyone slept' },
  ];
  const words = [
    { text: 'we', start: 0, end: 0.2 },
    { text: 'went', start: 0.2, end: 0.5 },
    { text: 'home', start: 0.5, end: 0.9 },
    { text: 'the', start: 1, end: 1.1 },
    { text: 'cat', start: 1.1, end: 1.4 },
    { text: 'barked', start: 1.4, end: 1.8 },
    { text: 'loudly', start: 1.8, end: 2.2 },
    { text: 'then', start: 2.5, end: 2.7 },
    { text: 'everyone', start: 2.7, end: 3.1 },
    { text: 'slept', start: 3.1, end: 3.5 },
  ];
  const out = wordTimesForCues(words, cues);
  assert.equal(out[0].words.length, 3);
  assert.deepEqual(out[1].words, []);
  assert.deepEqual(out[2].words.map((word) => word.start), [2.5, 2.7, 3.1]);
});
