import test from 'node:test';
import assert from 'node:assert/strict';
import { addTag, expressionLineKey, expressionOf, keepCurrent, planExpression, removeTag, taggedSegments, tagsInLine } from './expressionTags.ts';
import type { AudioSegment } from '../types';

const cue = (id: number, start: number, end: number, text: string) =>
  ({ id, startTime: start, endTime: end, duration: end - start, textTarget: text }) as AudioSegment;

// Three sections: 0–80 s, 100–170 s, 200–260 s (each under 90 s of audio).
const script = [
  cue(1, 0, 40, 'जब आप किसी चीज़ को समझना चाहते हैं'),
  cue(2, 40, 80, 'तो पहले आपको उसे ध्यान से देखना होगा'),
  cue(3, 100, 170, 'यह कोई विचार नहीं है, यह अनुभव है'),
  cue(4, 200, 260, 'क्या आपने कभी इस पर ध्यान दिया है?'),
];

const heardAll = (segments: AudioSegment[], language: string) =>
  Object.fromEntries(segments.map((s) => [expressionLineKey(language, s), { text: `[calm] ${s.textTarget}` }]));

test('nothing heard: every section is to hear', () => {
  const plan = planExpression(script, 'hi', {});
  assert.equal(plan.sections.length, 3);
  assert.equal(plan.toHear.length, 3);
});

test('a heard script needs no listening, and the voice reads its tags', () => {
  const tags = heardAll(script, 'hi');
  assert.equal(planExpression(script, 'hi', tags).toHear.length, 0);
  assert.equal(taggedSegments(script, 'hi', tags)[2].textTarget, `[calm] ${script[2].textTarget}`);
});

test('an edited line sends only its own section to be heard again', () => {
  const tags = heardAll(script, 'hi');
  const edited = script.map((s) => (s.id === 3 ? { ...s, textTarget: 'यह विचार नहीं, यह अनुभव है' } : s));
  const plan = planExpression(edited, 'hi', tags);
  assert.deepEqual(plan.toHear.map((section) => section.indexes), [[2]]);
  // Until then the edited line is voiced as written.
  assert.equal(taggedSegments(edited, 'hi', tags)[2].textTarget, 'यह विचार नहीं, यह अनुभव है');
});

test('another language or moved times are not the same line', () => {
  const tags = heardAll(script, 'hi');
  assert.equal(planExpression(script, 'bn', tags).toHear.length, 3);
  const moved = script.map((s) => (s.id === 1 ? { ...s, endTime: 41 } : s));
  assert.equal(planExpression(moved, 'hi', tags).toHear.length, 1);
});

test('tags whose words are not the line are never used', () => {
  const tags = { [expressionLineKey('hi', script[0])]: { text: '[calm] कुछ और ही शब्द' } };
  assert.equal(expressionOf(tags, 'hi', script[0]), null);
});

test('wordings edited away are dropped from what is kept', () => {
  const tags = heardAll(script, 'hi');
  const kept = keepCurrent(tags, script.slice(0, 2), 'hi');
  assert.equal(Object.keys(kept).length, 2);
});

test('a line\'s tags as chips, removed and added', () => {
  const text = '[explaining, calm] तो पहले आपको उसे ... [sentence-build pause] ध्यान से देखना होगा';
  assert.deepEqual(tagsInLine(text), [
    { tag: 'explaining, calm', before: 'तो' },
    { tag: 'sentence-build pause', before: 'ध्यान' },
  ]);
  assert.equal(removeTag(text, 1), '[explaining, calm] तो पहले आपको उसे ... ध्यान से देखना होगा');
  assert.equal(addTag('तो पहले', 'slow'), '[slow] तो पहले');
});
