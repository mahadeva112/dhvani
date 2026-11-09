import test from 'node:test';
import assert from 'node:assert/strict';
import { refineWords, sayWords, splicedWords, wordsFromAlignment } from './takeWords.js';

/** The voice's character timing for `text`, each character `step` seconds, from `at`. */
const timing = (text, { at = 0, step = 0.05 } = {}) => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => at + i * step),
    character_end_times_seconds: characters.map((_, i) => at + (i + 1) * step),
  };
};

test("a take's words come from the voice's own timing, with tags, SSML pauses and lone punctuation left out", () => {
  const words = wordsFromAlignment(timing('[softly] one two <break time="0.4s" /> three … four.'), 'one two [pause 0.4s] three … four.');
  assert.equal(words.length, 4);
  assert.equal(sayWords('one two [pause 0.4s] three … four.').length, 4, 'the text says four words');
  // "one" is characters 9-11 after "[softly] ".
  assert.ok(Math.abs(words[0].start - 9 * 0.05) < 1e-9 && Math.abs(words[0].end - 12 * 0.05) < 1e-9);
  assert.equal(wordsFromAlignment(timing('one two'), 'one two three'), null, 'words that are not the text are not used');
  assert.equal(wordsFromAlignment(null, 'one'), null);
});

test('the cut between two words is in the silence between them, and each word starts and ends on its sound', () => {
  const RATE = 1000;
  const samples = new Float32Array(3000);
  // Sound from 0.2 to 0.9 s and from 1.5 to 2.6 s.
  for (let i = 200; i < 900; i++) samples[i] = 0.3;
  for (let i = 1500; i < 2600; i++) samples[i] = 0.3;
  // The voice's timing is off by up to 70 ms.
  const { words, gaps } = refineWords(samples, RATE, [{ start: 0.25, end: 0.83 }, { start: 1.43, end: 2.55 }], { lead: 0.2, speech: 2.4 });
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0] >= 0.9 && gaps[0] <= 1.5, `cut at ${gaps[0]} s, in the silence`);
  assert.deepEqual(words, [[0.2, 0.9], [1.5, 2.6]]);
});

test("a phrase take's words are the old take's either side and the new reading's between, as the splice put them", () => {
  const RATE = 1000;
  // Old take: four words; words 2-3 read again in a clip 0.5 s longer than what it replaces.
  const oldWords = [[0.1, 0.3], [0.5, 0.7], [0.9, 1.1], [1.4, 1.6]];
  const words = splicedWords({
    oldWords,
    before: 1,
    after: 1,
    cut: { from: 400, to: 1250 },
    phraseWords: [{ start: 0.05, end: 0.4 }, { start: 0.6, end: 1.0 }],
    phraseLength: 1350,
    start: 0,
    sampleRate: RATE,
  });
  assert.deepEqual(words.map((w) => [+w.start.toFixed(3), +w.end.toFixed(3)]), [[0.1, 0.3], [0.45, 0.8], [1.0, 1.4], [1.9, 2.1]]);
  assert.equal(splicedWords({ oldWords: null, before: 1, after: 1, cut: { from: 0, to: 1 }, phraseWords: [], phraseLength: 1, start: 0, sampleRate: RATE }), null);
});
