import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cutNearTime,
  mergeBlocker,
  mergeSegments,
  planSplit,
  resetSegments,
  splitSegment,
  textWords,
  timingProblems,
  transcriptText,
} from './transcriptSegments.ts';
import type { AudioSegment } from '../types';

const timed = (): AudioSegment => ({
  id: 'c1',
  startTime: 0.4,
  endTime: 6.8,
  duration: 6.4,
  speaker: 'A',
  textSource: 'আজ আমরা কথা বলব ধ্যান নিয়ে। এটা খুব সহজ।',
  timingSource: 'elevenlabs',
  words: [
    { text: 'আজ', start: 0.4, end: 0.7 },
    { text: 'আমরা', start: 0.75, end: 1.2 },
    { text: 'কথা', start: 1.25, end: 1.6 },
    { text: 'বলব', start: 1.65, end: 2.1 },
    { text: 'ধ্যান', start: 2.15, end: 2.7 },
    { text: 'নিয়ে।', start: 2.75, end: 3.4 },
    { text: 'এটা', start: 3.81, end: 4.2 },
    { text: 'খুব', start: 4.25, end: 4.9 },
    { text: 'সহজ।', start: 5.0, end: 6.8 },
  ],
});

const untimed = (): AudioSegment => ({
  id: 7,
  startTime: 7.1,
  endTime: 12.9,
  duration: 5.8,
  textSource: 'आप  सब यहाँ बैठिए, and just listen.',
});

test('a split on word timings lands on the measured gap', () => {
  assert.equal(planSplit(timed(), 6).kind, 'measured');
  const { first, second, measured } = splitSegment(timed(), 6, 'c1-a')!;
  assert.equal(measured, true);
  assert.equal(first.id, 'c1');
  assert.equal(second.id, 'c1-a');
  assert.equal(first.endTime, 3.4);
  assert.equal(second.startTime, 3.81);
  assert.equal(first.startTime, 0.4);
  assert.equal(second.endTime, 6.8);
  assert.equal(first.textSource, 'আজ আমরা কথা বলব ধ্যান নিয়ে।');
  assert.equal(second.textSource, 'এটা খুব সহজ।');
  assert.equal(first.words!.length, 6);
  assert.equal(second.words!.length, 3);
  assert.equal(second.speaker, 'A');
  assert.equal(first.timingSource, 'elevenlabs');
});

test('split and merge keep the whole transcript, combining marks included', () => {
  const before = [timed(), untimed()];
  const text = transcriptText(before);
  const { first, second } = splitSegment(timed(), 3, 'n')!;
  const after = [first, second, before[1]];
  assert.equal(transcriptText(after), text);
  const merged = mergeSegments(first, second);
  assert.equal(merged.textSource, timed().textSource);
  assert.equal(transcriptText([merged, before[1]]), text);
  // Every word is whole on one side: nothing was cut inside a word or grapheme.
  for (const seg of after) for (const w of textWords(seg.textSource!)) assert.ok(timed().textSource!.includes(w.text) || untimed().textSource!.includes(w.text));
});

test('a split keeps the text exactly, inner spacing and punctuation too', () => {
  const { first, second } = splitSegment(untimed(), 3, 'n', 9)!;
  assert.equal(first.textSource, 'आप  सब यहाँ');
  assert.equal(second.textSource, 'बैठिए, and just listen.');
});

test('without word timings the time is an estimate, needed and kept in range', () => {
  const plan = planSplit(untimed(), 4);
  if (plan.kind !== 'estimated') return assert.fail('expected an estimate');
  assert.ok(plan.estimate > 7.1 && plan.estimate < 12.9);
  assert.equal(splitSegment(untimed(), 4, 'n'), null, 'no time given');
  assert.equal(splitSegment(untimed(), 4, 'n', 7.1), null, 'zero-length first half');
  assert.equal(splitSegment(untimed(), 4, 'n', 13), null, 'outside the segment');
  const { first, second, measured } = splitSegment(untimed(), 4, 'n', 10.25)!;
  assert.equal(measured, false);
  assert.equal(first.endTime, 10.25);
  assert.equal(second.startTime, 10.25);
  assert.equal(first.timingSource, 'derived');
  assert.equal(second.timingSource, 'derived');
});

test('word timings that no longer match the edited text are not trusted', () => {
  const seg = { ...timed(), textSource: 'আজ আমরা কথা বলব ধ্যান নিয়ে, আর এটা খুব সহজ।' };
  assert.equal(planSplit(seg, 6).kind, 'estimated');
  const { first, second } = splitSegment(seg, 6, 'n', 3.5)!;
  assert.equal(`${first.textSource} ${second.textSource}`, seg.textSource);
});

test('splits are refused at the edges and on unusable timing', () => {
  assert.deepEqual(planSplit(timed(), 0), { kind: 'refused', reason: 'edge' });
  assert.deepEqual(planSplit(timed(), 9), { kind: 'refused', reason: 'edge' });
  assert.deepEqual(planSplit(timed(), 1.5), { kind: 'refused', reason: 'edge' });
  const zero = { ...untimed(), endTime: 7.1 };
  assert.deepEqual(planSplit(zero, 2), { kind: 'refused', reason: 'timing' });
  const reversed = { ...untimed(), endTime: 5 };
  assert.deepEqual(planSplit(reversed, 2), { kind: 'refused', reason: 'timing' });
});

test('an untranslated segment stays untranslated; a translated one is divided, not lost', () => {
  const { first, second } = splitSegment(timed(), 6, 'n')!;
  assert.equal(first.textTarget, undefined);
  assert.equal(second.textTarget, undefined);
  const translated = { ...timed(), textTarget: 'आज हम ध्यान के बारे में बात करेंगे। यह बहुत सरल है।', targetText: 'आज हम ध्यान के बारे में बात करेंगे। यह बहुत सरल है।' };
  const halves = splitSegment(translated, 6, 'n')!;
  assert.equal(halves.first.textTarget, 'आज हम ध्यान के बारे में बात करेंगे।');
  assert.equal(halves.second.textTarget, 'यह बहुत सरल है।');
  assert.equal(halves.first.targetText, halves.first.textTarget);
  assert.equal(mergeSegments(halves.first, halves.second).textTarget, translated.textTarget);
});

test('merge spans both segments, keeps the first id, and joins word timings only when both have them', () => {
  const { first, second } = splitSegment(timed(), 6, 'n')!;
  const merged = mergeSegments(first, second);
  assert.equal(merged.id, 'c1');
  assert.equal(merged.startTime, 0.4);
  assert.equal(merged.endTime, 6.8);
  assert.deepEqual(merged.words, timed().words);
  const mixed = mergeSegments(timed(), untimed());
  assert.deepEqual(mixed.words, []);
  assert.equal(mixed.endTime, 12.9);
  assert.equal(mergeBlocker(timed(), { ...untimed(), speaker: 'B' }), 'These segments have different speakers.');
  assert.equal(mergeBlocker(timed(), { ...untimed(), speaker: 'A' }), null);
});

test('timing problems are found and named, never fixed', () => {
  const segs: AudioSegment[] = [
    { id: 1, startTime: 0, endTime: 2, duration: 2, textSource: 'a' },
    { id: 2, startTime: 3, endTime: 2.5, duration: 0, textSource: 'b' },
    { id: 3, startTime: 4, endTime: 4, duration: 0, textSource: 'c' },
    { id: 4, startTime: 3.9, endTime: 5, duration: 1, textSource: 'd' },
    { id: 5, startTime: NaN, endTime: 6, duration: 0, textSource: 'e' },
  ];
  assert.deepEqual(
    timingProblems(segs).map((p) => [p.id, p.kind]),
    [
      [2, 'reversed'],
      [3, 'zero'],
      [4, 'overlap'],
      [5, 'invalid'],
    ]
  );
  assert.equal(segs[1].endTime, 2.5);
});

test('reset puts the cuts back and keeps work on segments that did not change', () => {
  const before = [timed(), untimed()];
  const { first, second } = splitSegment(timed(), 6, 'n')!;
  const now = [first, second, { ...untimed(), speaker: 'B' }];
  const reset = resetSegments(before, now);
  assert.equal(reset.length, 2);
  assert.equal(reset[0].textSource, timed().textSource);
  assert.equal(reset[1].speaker, 'B');
});

test('the playhead picks the nearest word gap, measured or by word length', () => {
  // The pause after "নিয়ে।" (3.4 to 3.81) is the gap before word 6.
  assert.equal(cutNearTime(timed(), 3.6), 6);
  assert.equal(cutNearTime(timed(), 0.73), 1);
  assert.equal(cutNearTime(timed(), 99), 8);
  const k = cutNearTime(untimed(), 10)!;
  assert.ok(k >= 1 && k < textWords(untimed().textSource!).length);
  assert.equal(cutNearTime({ ...untimed(), textSource: 'one' }, 9), null);
});
