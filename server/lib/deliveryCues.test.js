import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCues, buildCuePrompt, splitLike } from './deliveryCues.js';

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

test('cues added to a whole script are cut back into the same passages', () => {
  const passages = ['मन एक अद्भुत साधन है। लेकिन क्या आप इसे इस्तेमाल करना जानते हैं?', 'ज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं।'];
  const cued = '[thoughtful] मन एक अद्भुत साधन है… लेकिन, क्या आप इसे इस्तेमाल करना जानते हैं?\n[chuckles] ज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं!';
  assert.deepEqual(splitLike(cued, passages), [
    '[thoughtful] मन एक अद्भुत साधन है… लेकिन, क्या आप इसे इस्तेमाल करना जानते हैं?',
    '[chuckles] ज़्यादातर लोग बस इसके हाथों इस्तेमाल होते हैं!',
  ]);
});

test('a cut inside a sentence keeps punctuation with the words before it', () => {
  assert.deepEqual(splitLike('[calm] One, two… [sighs] three four!', ['One, two', 'three four.']), [
    '[calm] One, two…',
    '[sighs] three four!',
  ]);
});

test('cued text whose words differ is not cut', () => {
  assert.equal(splitLike('One two three', ['One two', 'three four']), null);
});
