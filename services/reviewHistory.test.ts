import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_LABELS,
  MERGE_MS,
  STEP_LIMIT,
  backToFirstStep,
  describeChange,
  recordReviewStep,
  redoReviewStep,
  reviewHistoryLabels,
  startReviewHistory,
  undoReviewStep,
  type ReviewHistory,
} from './reviewHistory.ts';
import type { AudioSegment } from '../types';

const cue = (id: number, text: string, start = id * 2): AudioSegment => ({
  id,
  startTime: start,
  endTime: start + 1.5,
  duration: 1.5,
  textSource: `src ${id}`,
  textTarget: text,
  targetText: text,
});

const translated = () => [cue(1, 'एक'), cue(2, 'दो'), cue(3, 'तीन')];
const withText = (cues: AudioSegment[], i: number, text: string) =>
  cues.map((c, k) => (k === i ? { ...c, textTarget: text, targetText: text } : c));
const texts = (cues: AudioSegment[]) => cues.map((c) => c.textTarget);

/** Applies edits one after another, as the app does, each a few seconds apart. */
const edit = (history: ReviewHistory, live: AudioSegment[], next: AudioSegment[], now: number) =>
  recordReviewStep(history, live, next, { now });

test('undo steps back through every edit to the AI translation, and no further', () => {
  let segments = translated();
  let history = startReviewHistory(segments, BASE_LABELS.translation, 0);
  for (const [n, text] of ['एक!', 'एक!!', 'एक!!!'].entries()) {
    // Different lines, so each edit is its own step.
    const r = edit(history, segments, withText(segments, n, text), (n + 1) * 10_000);
    history = r.history;
    segments = r.segments;
  }
  assert.deepEqual(texts(segments), ['एक!', 'एक!!', 'एक!!!']);
  const seen: string[][] = [];
  for (;;) {
    const r = undoReviewStep(history, segments, 99_000);
    if (!r) break;
    history = r.history;
    segments = r.segments;
    seen.push(texts(segments) as string[]);
  }
  assert.equal(seen.length, 3);
  assert.deepEqual(texts(segments), ['एक', 'दो', 'तीन']);
  assert.equal(reviewHistoryLabels(history).undo, null);
  // Redo goes all the way forward again.
  for (let i = 0; i < 3; i++) {
    const r = redoReviewStep(history, segments)!;
    history = r.history;
    segments = r.segments;
  }
  assert.deepEqual(texts(segments), ['एक!', 'एक!!', 'एक!!!']);
  assert.equal(redoReviewStep(history, segments), null);
});

test('typing in one line is one step until it pauses; another line is a new step', () => {
  let segments = translated();
  let history = startReviewHistory(segments, BASE_LABELS.translation, 0);
  let now = 10_000;
  for (const text of ['द', 'दो ', 'दो भ', 'दो भी']) {
    const r = edit(history, segments, withText(segments, 1, text), (now += 200));
    history = r.history;
    segments = r.segments;
  }
  assert.equal(history.steps.length, 2);
  assert.equal(reviewHistoryLabels(history).undo, 'Edit line 2');
  // After a pause, the same line is a new step.
  let r = edit(history, segments, withText(segments, 1, 'दो भी हैं'), now + MERGE_MS + 1);
  assert.equal(r.history.steps.length, 3);
  // Straight away in another line, too.
  r = edit(r.history, r.segments, withText(r.segments, 2, 'तीन!'), now + MERGE_MS + 100);
  assert.equal(r.history.steps.length, 4);
});

test('an edit after undo drops the steps undone', () => {
  let segments = translated();
  let history = startReviewHistory(segments, BASE_LABELS.translation, 0);
  let r = edit(history, segments, withText(segments, 0, 'A'), 10_000);
  r = edit(r.history, r.segments, withText(r.segments, 1, 'B'), 20_000);
  const back = undoReviewStep(r.history, r.segments, 30_000)!;
  const after = edit(back.history, back.segments, withText(back.segments, 2, 'C'), 30_100);
  assert.equal(after.history.steps.length, 3);
  assert.equal(redoReviewStep(after.history, after.segments), null);
  assert.deepEqual(texts(after.segments), ['A', 'दो', 'C']);
});

test('a change the history did not see is kept as a step, so undo never loses it', () => {
  const segments = translated();
  const history = startReviewHistory(segments, BASE_LABELS.translation, 0);
  const outside = withText(segments, 0, 'from elsewhere');
  const r = edit(history, outside, withText(outside, 1, 'typed'), 10_000);
  assert.equal(r.history.steps.length, 3);
  const once = undoReviewStep(r.history, r.segments, 20_000)!;
  assert.deepEqual(texts(once.segments), ['from elsewhere', 'दो', 'तीन']);
});

test('a project read back from a file (copies of the cues) adds no versions for unchanged lines', () => {
  const segments = translated();
  let r = edit(startReviewHistory(segments, BASE_LABELS.translation, 0), segments, withText(segments, 0, 'A'), 10_000);
  const copy = (x: unknown) => JSON.parse(JSON.stringify(x));
  const history: ReviewHistory = copy(r.history);
  const live: AudioSegment[] = copy(r.segments);
  const poolBefore = history.pool.length;
  r = edit(history, live, withText(live, 1, 'B'), 20_000);
  assert.equal(r.history.pool.length, poolBefore + 1);
  assert.equal(r.history.steps.length, 3);
});

test('back to the first step is one step, and Undo brings the edits back', () => {
  const segments = translated();
  let r = edit(startReviewHistory(segments, BASE_LABELS.translation, 0), segments, withText(segments, 0, 'A'), 10_000);
  r = edit(r.history, r.segments, withText(r.segments, 1, 'B'), 20_000);
  assert.equal(reviewHistoryLabels(r.history).base, 'the AI translation');
  const base = backToFirstStep(r.history, r.segments, 30_000)!;
  assert.deepEqual(texts(base.segments), ['एक', 'दो', 'तीन']);
  assert.equal(reviewHistoryLabels(base.history).undo, 'Back to the AI translation');
  const again = undoReviewStep(base.history, base.segments, 40_000)!;
  assert.deepEqual(texts(again.segments), ['A', 'B', 'तीन']);
});

test('with no history yet, it starts at the cues before the first edit', () => {
  const segments = translated();
  const r = recordReviewStep(null, segments, withText(segments, 0, 'A'), { now: 1 });
  assert.equal(r.history.steps[0].label, BASE_LABELS.firstEdit);
  assert.deepEqual(texts(undoReviewStep(r.history, r.segments, 2)!.segments), ['एक', 'दो', 'तीन']);
});

test('the oldest edits go past the step limit, never the first step; the pool stays small', () => {
  let segments = translated();
  let history = startReviewHistory(segments, BASE_LABELS.translation, 0);
  for (let n = 0; n < STEP_LIMIT + 50; n++) {
    const r = edit(history, segments, withText(segments, n % 3, `v${n}`), (n + 1) * 10_000);
    history = r.history;
    segments = r.segments;
  }
  assert.equal(history.steps.length, STEP_LIMIT);
  assert.equal(history.steps[0].label, 'the AI translation');
  assert.deepEqual(history.steps[0].cues.map((i) => history.pool[i].textTarget), ['एक', 'दो', 'तीन']);
  assert.ok(history.pool.length < STEP_LIMIT * 2 + 100);
});

test('split, join and a moved cut are named; a dragged cut is one step', () => {
  const a = cue(1, 'a b'), b = cue(2, 'c');
  // The first half keeps the cue's id, the second gets a new one.
  assert.equal(describeChange([a, b], [a, b, { ...b, id: '2-x' }])!.label, 'Split line 2');
  assert.equal(describeChange([a, b], [a, { ...a, id: '1-x' }, b])!.label, 'Split line 1');
  assert.equal(describeChange([a, b], [{ ...a, endTime: 9 }])!.label, 'Join lines 1 and 2');
  assert.equal(describeChange([a, b, cue(3, 'd')], [a, { ...b, endTime: 9 }])!.label, 'Join lines 2 and 3');
  const moved = describeChange([a, b], [{ ...a, endTime: a.endTime + 0.2 }, { ...b, startTime: b.startTime + 0.2 }])!;
  assert.equal(moved.label, 'Move cut 1 | 2');
  assert.equal(moved.key, 'cut:1');
  assert.equal(describeChange([a, b], [a, b]), null);
});
