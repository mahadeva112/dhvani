import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextForSpeech, contextAround } from './ttsText.js';

test('short text is sent as a single passage', () => {
  assert.deepEqual(splitTextForSpeech('Hello there. How are you?'), ['Hello there. How are you?']);
  assert.deepEqual(splitTextForSpeech('   '), []);
});

test('long text is cut on sentence ends and no passage exceeds the limit', () => {
  const sentence = 'The mind is restless, but you can watch it without judgement. ';
  const text = sentence.repeat(40);
  const chunks = splitTextForSpeech(text, 300);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 300, `passage of ${chunk.length} chars exceeds the limit`);
    assert.ok(chunk.endsWith('.'), `passage should end on a sentence: "${chunk.slice(-20)}"`);
  }
  assert.equal(chunks.join(' '), text.trim(), 'no text is lost or reordered');
});

test('a paragraph break is preferred over a later sentence end', () => {
  const first = 'First paragraph sentence one. First paragraph sentence two.';
  const second = 'Second paragraph that keeps going. And going on further still.';
  const chunks = splitTextForSpeech(`${first}\n\n${second}`, 100);
  assert.equal(chunks[0], first);
});

test('Devanagari danda counts as a sentence end', () => {
  const text = 'मन चंचल है। लेकिन आप इसे देख सकते हैं। '.repeat(20);
  const chunks = splitTextForSpeech(text, 200);
  for (const chunk of chunks) assert.ok(chunk.endsWith('।'));
});

test('text with no punctuation still splits on word gaps', () => {
  const text = 'word '.repeat(500);
  const chunks = splitTextForSpeech(text, 120);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 120);
    assert.ok(!chunk.startsWith(' ') && !chunk.endsWith(' '));
  }
});

test('context comes from the neighbouring passages only', () => {
  const chunks = ['One.', 'Two.', 'Three.'];
  assert.deepEqual(contextAround(chunks, 0), { previousText: undefined, nextText: 'Two.' });
  assert.deepEqual(contextAround(chunks, 1), { previousText: 'One.', nextText: 'Three.' });
  assert.deepEqual(contextAround(chunks, 2), { previousText: 'Two.', nextText: undefined });
});
