import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lipClosuresIn, matchedLips, sourceLipTimes, syllableRate, syllablesIn, timeLine } from './speechTiming.ts';

test('counts Hindi syllables: joined letters, vowel signs and the dropped final "a"', () => {
  assert.equal(syllablesIn('साफ'), 1);
  assert.equal(syllablesIn('आँतें'), 2);
  assert.equal(syllablesIn('अच्छी'), 2);
  assert.equal(syllablesIn('सेहत'), 2);
  assert.equal(syllablesIn('प्रतिशत'), 3);
  assert.equal(syllablesIn('नमस्ते'), 3);
  assert.equal(syllablesIn('हैं'), 1);
  assert.equal(syllablesIn('ज़रूर'), 2);
});

test('counts Bengali and English syllables', () => {
  assert.equal(syllablesIn('ভালো'), 2);
  assert.equal(syllablesIn('স্বাস্থ্য'), 2);
  assert.equal(syllablesIn('health'), 1);
  assert.equal(syllablesIn('together'), 3);
  assert.equal(syllablesIn('time'), 1);
  assert.equal(syllablesIn('...'), 0);
});

test('a real line from a sync: 20 syllables, near its synced 4.7 s at a typical rate', () => {
  const line = timeLine('साफ आँतें और अच्छी सेहत, ये दोनों सौ प्रतिशत जुड़े हुए हैं।', 4.6);
  assert.equal(line.syllables, 20);
  assert.ok(Math.abs(line.seconds - 4.7) < 0.4, `estimated ${line.seconds.toFixed(2)} s`);
  // The comma's pause sits between सेहत and ये.
  const [, , , , sehat, ye] = line.words;
  assert.ok(ye.start - sehat.end >= 0.25 - 1e-9);
});

test('a hyphenated word is said as its parts', () => {
  assert.equal(timeLine('धीरे-धीरे', 4).syllables, 4);
});

test('finds lip closures in Indian scripts and English, but not f sounds', () => {
  assert.equal(lipClosuresIn('बदलाव').length, 1);
  assert.equal(lipClosuresIn('পেট').length, 1);
  assert.equal(lipClosuresIn('फ़ायदा').length, 0);
  assert.equal(lipClosuresIn('phone').length, 0);
  assert.equal(lipClosuresIn('member').length, 3);
});

test('times the original closures from word timings and matches them to the dub', () => {
  const source = sourceLipTimes([{ text: 'bad', start: 10, end: 10.4 }]);
  assert.deepEqual(source, [10]);
  assert.equal(matchedLips(source, [10.2]), 1);
  assert.equal(matchedLips(source, [10.5]), 0);
});

test('the syllable rate makes the whole script take as long as the character rate says', () => {
  const lines = ['आज हम पेट की सेहत की बात करेंगे।', 'खाना धीरे-धीरे चबाकर खाइए।'];
  const cps = 14;
  const rate = syllableRate(lines, cps);
  const total = lines.reduce((sum, t) => sum + timeLine(t, rate).seconds, 0);
  const byCharacters = lines.reduce((sum, t) => sum + t.length / cps, 0);
  assert.ok(Math.abs(total - byCharacters) < 0.05, `${total.toFixed(2)} vs ${byCharacters.toFixed(2)}`);
});
