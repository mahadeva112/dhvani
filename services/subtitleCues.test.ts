import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindsBack, bindsFwd, buildCues, sanitizeCues, vlen, type CueBudget, type TimedWord } from './subtitleCues.ts';

/** Words spoken back to back, `step` seconds each, with an optional pause after given indices. */
const stream = (texts: string[], { step = 0.3, pauses = {} as Record<number, number> } = {}): TimedWord[] => {
  let t = 1;
  return texts.map((raw, i) => {
    const word = { text: raw, raw, start: t, end: t + step - 0.02 };
    t += step + (pauses[i] ?? 0);
    return word;
  });
};

const budget = (over: Partial<CueBudget> = {}): CueBudget => ({
  maxCharsPerLine: 22,
  maxLines: 1,
  maxWordsPerLine: 3,
  maxSecs: 2.2,
  ...over,
});

test('vlen counts aksharas, not code points', () => {
  assert.equal(vlen('hello'), 5);
  assert.equal(vlen('কথা'), 2);
  assert.equal(vlen('क्या'), 2); // horizontal conjunct is wide
  assert.equal(vlen('ತ್ತ'), 1); // stacked conjunct is not
});

test('function words come from the Srutilekha tables, punctuation and nukta ignored', () => {
  assert.ok(bindsBack('है'));
  assert.ok(bindsBack('ছিল।'));
  assert.ok(bindsBack('থেকে,'));
  assert.ok(bindsFwd('কিন্তু'));
  assert.ok(bindsFwd('And'));
  assert.ok(!bindsBack('আমি'));
});

test('every word lands in exactly one cue, in order, on its own timestamps', () => {
  const words = stream('this is a long sentence that keeps going without any punctuation at all here'.split(' '));
  const cues = buildCues(words, budget());
  assert.equal(cues.map((cue) => cue.text).join(' '), words.map((word) => word.text).join(' '));
  const starts = new Set(words.map((word) => word.start));
  const ends = new Set(words.map((word) => word.end));
  for (const cue of cues) {
    assert.ok(starts.has(cue.start), `start ${cue.start} is a word start`);
    assert.ok(ends.has(cue.end), `end ${cue.end} is a word end`);
  }
});

test('a cue never opens with a phrase-completing word', () => {
  // "আমি বাড়ি যাচ্ছিলাম ছিল" style: the auxiliary must stay with its head.
  const words = stream(['আমরা', 'সবাই', 'ওখানে', 'ছিলাম', 'কাল', 'রাতে', 'ঘুমিয়ে', 'ছিল']);
  const cues = buildCues(words, budget());
  for (const cue of cues) assert.ok(!bindsBack(cue.text.split(/\s+/)[0]), `"${cue.text}" opens with a bind-back word`);
});

test('a measured pause closes the cue there', () => {
  const words = stream(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'], { pauses: { 1: 0.7 } });
  const cues = buildCues(words, budget({ maxWordsPerLine: 5, maxSecs: 5 }));
  assert.equal(cues[0].text, 'alpha bravo');
});

test('sentence punctuation beats the budget as a cut point', () => {
  const words = stream(['We', 'went', 'home.', 'Then', 'we', 'slept', 'well']);
  const cues = buildCues(words, budget({ maxWordsPerLine: 4, maxSecs: 5 }));
  assert.equal(cues[0].text, 'We went home.');
});

test('sanitizeCues bridges short gaps, keeps long silences, and enforces a readable minimum', () => {
  const out = sanitizeCues([
    { start: 1, end: 1.1, text: 'a' },
    { start: 1.8, end: 2.5, text: 'b' },
    { start: 5, end: 6, text: 'c' },
  ]);
  assert.ok(Math.abs(out[0].end - 1.799) < 1e-9); // 0.1s cue stretched, then the 0.7s gap bridged
  assert.equal(out[1].end, 2.5); // 2.5s of silence stays blank
  assert.equal(out[2].start, 5);
});

test('sanitizeCues removes overlaps', () => {
  const out = sanitizeCues([
    { start: 1, end: 3, text: 'a' },
    { start: 2, end: 4, text: 'b' },
  ]);
  assert.equal(out[0].end, 2);
  assert.equal(out[1].start, 2);
});
