import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePauses, pauseSeconds, spokenPause, stripPauses } from './linePauses.js';
import { cleanTextForNaturalSpeech } from '../providers/elevenlabs/speech.js';

test('the script keeps the words of a paused line, without its marks', () => {
  assert.equal(stripPauses('That is all [pause 0.4s] there is.'), 'That is all there is.');
  assert.equal(stripPauses("That's all. [pause 0.5s] That is all."), "That's all. That is all.");
  assert.equal(stripPauses('Wait [pause 0.3s], listen.'), 'Wait, listen.');
});

test('pauses are summed, tidied, and never left at the start or end', () => {
  assert.equal(pauseSeconds('a [pause 0.4s] b [pause 1.25s] c'), 1.7);
  assert.equal(pauseSeconds('a [pause 9s] b'), 2);
  assert.equal(normalizePauses('[pause 0.2s] a  [PAUSE 0.35 s]b [pause 1s]'), 'a [pause 0.4s] b');
});

test('each engine hears a pause the way it performs one', () => {
  assert.equal(spokenPause(0.4, 'break'), ' <break time="0.4s" /> ');
  assert.equal(spokenPause(0.4, 'cartesia'), ' <break time="400ms"/> ');
  assert.equal(spokenPause(0.4, 'ellipsis'), '… ');
  const line = 'That is all [pause 0.4s] there is.';
  assert.equal(cleanTextForNaturalSpeech(line, { pauses: 'break' }), 'That is all <break time="0.4s" /> there is.');
  assert.equal(cleanTextForNaturalSpeech(line, { pauses: 'ellipsis' }), 'That is all … there is.');
  // Unasked, a mark is never read aloud, and a break written in the script is still stripped.
  assert.equal(cleanTextForNaturalSpeech(line), 'That is all there is.');
  assert.equal(cleanTextForNaturalSpeech('a <break time="3s"/> b', { pauses: 'break' }), 'a b');
});
