import test from 'node:test';
import assert from 'node:assert/strict';
import { stripTags, tagProblems, tagsOf } from './lineTags.js';
import { cleanTextForNaturalSpeech } from '../providers/elevenlabs/speech.js';

test('the script keeps the words of a tagged line, without its tags', () => {
  assert.equal(stripTags('[calm] এই মুহূর্তে আমরা যা করছি, [sighs] সেটাই আসল সাধনা।'), 'এই মুহূর্তে আমরা যা করছি, সেটাই আসল সাধনা।');
  assert.equal(stripTags('Wait [speaking softly] , listen.'), 'Wait, listen.');
  assert.equal(stripTags('That is all [pause 0.4s] there is.'), 'That is all [pause 0.4s] there is.');
  assert.deepEqual(tagsOf('[calm] one [clears throat] two [pause 0.4s]'), ['calm', 'clears throat']);
});

test('brackets the voice would read aloud are flagged', () => {
  assert.deepEqual(tagProblems('[calm] fine [pause 0.4s] too'), { foreign: [], unclosed: false });
  assert.deepEqual(tagProblems('[রাগ] আর'), { foreign: ['রাগ'], unclosed: false });
  assert.equal(tagProblems('[softly এখানেই শেষ।').unclosed, true);
  assert.equal(tagProblems('[softly [calm] done').unclosed, true);
});

test('typed tags reach v3 only when kept, and closing tags never do', () => {
  const line = '[speaking softly] Hello [sighs] there [/fast]';
  assert.equal(cleanTextForNaturalSpeech(line, { keepAudioTags: true }), 'Hello [sighs] there');
  assert.equal(cleanTextForNaturalSpeech(line, { keepAudioTags: true, keepOwnTags: true }), '[speaking softly] Hello [sighs] there');
  assert.equal(cleanTextForNaturalSpeech(line), 'Hello there');
});
