import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextForSpeech, splitPassages, contextAround, endsSentence, withSentenceEnd } from './ttsText.js';

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

test('each passage reports the boundary it ends on, so the join can pause to match', () => {
  const para = 'A paragraph that ends here.';
  const line = 'A sentence followed by a breath.';
  const sentence = 'Then another sentence.';
  const text = `${para}\n\n${line}\n${sentence} Then the last one that runs on`;
  const passages = splitPassages(text, 40);
  assert.deepEqual(
    passages.map((p) => p.breakAfter),
    ['paragraph', 'line', 'sentence', null]
  );
  assert.deepEqual(passages.map((p) => p.text), splitTextForSpeech(text, 40));
});

test('a passage cut mid-sentence reports a word break', () => {
  const [first] = splitPassages('word '.repeat(100), 60);
  assert.equal(first.breakAfter, 'word');
});

test('a line voiced on its own always ends a sentence, in the mark of its script', () => {
  assert.equal(withSentenceEnd('আমি বাড়ি যাচ্ছি'), 'আমি বাড়ি যাচ্ছি।');
  assert.equal(withSentenceEnd('मैं घर जा रहा हूँ,'), 'मैं घर जा रहा हूँ।');
  assert.equal(withSentenceEnd('நான் வீட்டுக்குப் போகிறேன்'), 'நான் வீட்டுக்குப் போகிறேன்.');
  assert.equal(withSentenceEnd('I am going home —  '), 'I am going home.');
  // Already ending a sentence: left as it is.
  for (const done of ['আমি যাচ্ছি।', 'Really?', 'He said "go."', 'যাও!']) assert.equal(withSentenceEnd(done), done);
  assert.equal(endsSentence('আমি যাচ্ছি, '), false);
  assert.equal(endsSentence('আমি যাচ্ছি। '), true);
  assert.equal(withSentenceEnd(''), '');
});
