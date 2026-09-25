import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCues, buildCuePrompt } from './deliveryCues.js';

const original = 'मन एक अद्भुत साधन है। लेकिन क्या आप इसे इस्तेमाल करना जानते हैं?\nज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं।';

test('tags and punctuation are accepted when every word is kept', () => {
  const cued = '[thoughtful] मन एक अद्भुत साधन है… लेकिन, क्या आप इसे इस्तेमाल करना जानते हैं?\n[chuckles] ज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं!';
  assert.equal(acceptCues(original, cued), cued);
});

test('a changed, added or dropped word rejects the whole suggestion', () => {
  assert.equal(acceptCues(original, original.replace('अद्भुत', 'शानदार')), original);
  assert.equal(acceptCues(original, `${original} सच में।`), original);
  assert.equal(acceptCues(original, original.replace('बस ', '')), original);
});

test('tags outside the allowed list are removed, known ones normalised', () => {
  const cued = '[Thoughtful] मन एक अद्भुत साधन है। [dramatic music] लेकिन क्या आप इसे इस्तेमाल करना जानते हैं?\nज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं।';
  const accepted = acceptCues(original, cued);
  assert.ok(accepted.startsWith('[thoughtful] '));
  assert.ok(!accepted.includes('dramatic'));
});

test('an empty or missing reply keeps the original', () => {
  assert.equal(acceptCues(original, ''), original);
  assert.equal(acceptCues(original, undefined), original);
});

test('the prompt carries the script and the language', () => {
  const prompt = buildCuePrompt(original, 'Hindi');
  assert.ok(prompt.includes(original));
  assert.ok(prompt.includes('Hindi'));
});
