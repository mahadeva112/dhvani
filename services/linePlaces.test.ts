import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatedWords, letterCount, linePartsOf, partEnd, pauseCutsOf, rateOf, rateZone, withCut, withLinePlaces, withLineRate, withLineRates, withPartStart, withPauseSkip } from './linePlaces.ts';
import type { SyncPreview, SyncPreviewUnit } from './syncService.ts';
import type { AudioSegment } from '../types';

const unit = (index: number, srcStart: number, slot: number, estimate: number, text: string): SyncPreviewUnit => ({
  index,
  key: String(index + 1),
  cueIds: [index + 1],
  text,
  sourceText: '',
  srcStart,
  srcEnd: srcStart + slot * 0.8,
  nextStart: null,
  slot,
  spoken: slot * 0.8,
  read: estimate,
  estimate,
  overflow: Math.max(0, estimate - slot),
  underflow: 0,
  status: estimate - slot > 0.3 ? 'long' : estimate > slot * 0.9 ? 'tight' : 'fits',
  targetChars: text.length,
});
const preview = (units: SyncPreviewUnit[]): SyncPreview => ({
  precision: 'phrase',
  charsPerSecond: 14,
  placedShare: 1,
  units,
  summary: { lines: units.length, fits: 0, tight: 0, long: 0, short: 0, maxOverflow: 0 },
});
const cue = (id: number, extra: Partial<AudioSegment> = {}): AudioSegment => ({ id, startTime: 0, endTime: 1, duration: 1, ...extra });

const LINE = 'पर मन को हम बहुत जल्दी, बहुत ज़्यादा भर देते हैं।';

test('a cut is kept by the letters before it, and splits the line where its words fall', () => {
  const u = unit(0, 10, 6, 6.9, LINE);
  const words = estimatedWords(u);
  const afterComma = words.findIndex((w) => w.text.endsWith(','));
  const letters = words.slice(0, afterComma + 1).reduce((sum, w) => sum + letterCount(w.text), 0);
  const place = withCut(null, u, letters, true);
  assert.deepEqual(place, { text: LINE, cuts: [{ letters }] });
  const [a, b] = linePartsOf(u, place);
  assert.equal(a.last, afterComma);
  assert.equal(b.first, afterComma + 1);
  assert.equal(b.atPause, true, 'cut at the comma, where the voice pauses');
  assert.equal(b.start, 10 + words[afterComma + 1].start, 'unplaced, a part sits as far in as its first word');
  assert.equal(b.placed, false);

  // Placed, a part keeps its start; taken out, the cut goes and the line is whole again.
  const moved = withPartStart(place, u, letters, 12.4);
  assert.equal(linePartsOf(u, moved)[1].start, 12.4);
  assert.equal(withCut(moved, u, letters, false), null);

  // A cut made in other words is dropped.
  assert.equal(linePartsOf({ ...u, text: 'पर मन को' }, place).length, 1);
});

test('a placed line is judged where it now starts, and so is the line before it', () => {
  const units = [unit(0, 0, 4, 4.2, 'a b c'), unit(1, 5, 3, 3.6, 'd e f')];
  // Line 2 moves 0.6 s earlier: it gains that room, line 1 loses it.
  const segments = [cue(1), cue(2, { dubPlace: { start: 4.4 } })];
  const placed = withLinePlaces(preview(units), segments)!;
  const [one, two] = placed.units;
  assert.equal(two.dubStart, 4.4);
  assert.ok(Math.abs(two.slot - 3.6) < 1e-9);
  assert.equal(two.status, 'tight');
  assert.ok(Math.abs(one.slot - 3.4) < 1e-9);
  assert.equal(one.status, 'long');
  assert.equal(placed.summary.long, 1);
  assert.equal(placed.summary.tight, 1);

  // Nothing placed: the preview as it was.
  const plain = preview(units);
  assert.equal(withLinePlaces(plain, [cue(1), cue(2)]), plain);
});

test('a part being dragged stands in for its place, and a line split apart loses the time its cut opened up', () => {
  const units = [unit(0, 0, 5, 4, 'one two, three four')];
  const words = estimatedWords(units[0]);
  const letters = letterCount('one') + letterCount('two,');
  const segments = [cue(1, { dubPlace: { text: 'one two, three four', cuts: [{ letters }] } })];
  const dragged = withLinePlaces(preview(units), segments, { key: '1', part: 1, start: words[2].start + 0.8 })!.units[0];
  const parts = dragged.parts!;
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(partEnd(parts[1]) - 4.8) < 1e-9, 'the last part ends 0.8 s later');
  assert.ok(Math.abs(dragged.slot - 4.2) < 1e-9, 'judged in the room left once the 0.8 s it opened up is taken out');
});

// ---- Cut at the original's pauses ----

/** The speaker pauses 0.8 s after "one two,"; translation marked it. */
const PAUSED_TEXT = 'one two, three four';
const pausedCue = (text = PAUSED_TEXT, paused = 'one two, [pause 0.8s] three four') =>
  cue(1, {
    startTime: 0,
    endTime: 4,
    textTarget: text,
    pausedTarget: paused,
    words: [
      { text: 'One', start: 0, end: 0.4 },
      { text: 'two', start: 0.45, end: 0.9 },
      { text: 'three', start: 1.7, end: 2.2 },
      { text: 'four', start: 2.25, end: 2.7 },
    ],
  });
const PAUSES = { minPause: 0.3, maxInsert: 0.4 };

test("the original's pauses in a dub line are found as Sync finds them, by the letters before each", () => {
  assert.deepEqual(pauseCutsOf([pausedCue()], PAUSED_TEXT), [{ letters: letterCount('one two'), seconds: 0.8, resume: 1.7 }]);
  // Edited, the marks no longer say where the pauses are.
  assert.deepEqual(pauseCutsOf([pausedCue('one two, three five')], 'one two, three five'), []);
  assert.deepEqual(pauseCutsOf([pausedCue()], PAUSED_TEXT, 1), [], 'shorter than asked for');
});

test("a line is cut at the original's pause after a comma, its part starting where the speaker starts again, held to the most it may add", () => {
  const u = unit(0, 0, 4, 2.2, PAUSED_TEXT);
  const words = estimatedWords(u);
  const cut = withLinePlaces(preview([u]), [pausedCue()], null, { minPause: 0.3, maxInsert: 5 })!.units[0];
  const [a, b] = cut.parts!;
  assert.equal(b.byPause, true);
  assert.equal(b.start, 1.7, 'the second part where the speaker starts again');
  assert.equal(cut.pauseMarks![0].state, 'cut');
  // Held to the most silence a cut adds, on top of the pause the voice makes there.
  const held = withLinePlaces(preview([u]), [pausedCue()], null, PAUSES)!.units[0].parts!;
  const voicePause = words[2].start - words[1].end;
  assert.ok(Math.abs(held[1].start - (partEnd(held[0]) + voicePause + 0.4)) < 1e-9, `starts at ${held[1].start}`);
  assert.equal(a.placed, false);
  // Off, the line is as it was.
  assert.equal(withLinePlaces(preview([u]), [pausedCue()], null, null)!.units[0].parts, undefined);
});

test('no comma there, the cut is left to whether the voice pauses; one the user turned off stays off', () => {
  const runOn = 'one two three four';
  const u = unit(0, 0, 4, 2.2, runOn);
  const maybe = withLinePlaces(preview([u]), [pausedCue(runOn, 'one two [pause 0.8s] three four')], null, PAUSES)!.units[0];
  assert.equal(maybe.parts, undefined);
  assert.equal(maybe.pauseMarks![0].state, 'maybe');

  const v = unit(0, 0, 4, 2.2, PAUSED_TEXT);
  const letters = letterCount('one two');
  const place = withPauseSkip(null, v, letters, true);
  assert.deepEqual(place, { text: PAUSED_TEXT, skip: [letters] });
  const skipped = withLinePlaces(preview([v]), [{ ...pausedCue(), dubPlace: place! }], null, PAUSES)!.units[0];
  assert.equal(skipped.parts, undefined);
  assert.equal(skipped.pauseMarks![0].state, 'skipped');
  assert.equal(withPauseSkip(place, v, letters, false), null, 'on again, nothing is left to keep');
});

test('a cut that would run the line later into the next one is not made', () => {
  // The line only just fits: its second part where the speaker starts again would end past its room.
  const u = unit(0, 0, 2.3, 2.2, PAUSED_TEXT);
  const later = withLinePlaces(preview([u]), [pausedCue()], null, { minPause: 0.3, maxInsert: 5 })!.units[0];
  assert.equal(later.parts, undefined);
  assert.equal(later.pauseMarks![0].state, 'later');
});

test('a part cut at a pause, dragged, becomes a cut of the user with the part where they put it', () => {
  const v = unit(0, 0, 4, 2.2, PAUSED_TEXT);
  const letters = letterCount('one two');
  assert.deepEqual(withPartStart(null, v, letters, 1.9), { text: PAUSED_TEXT, cuts: [{ letters, start: 1.9 }] });
});

test('a stretched line is read at its speed in the preview, and judged again against its slot', () => {
  const u = unit(0, 0, 4, 5.2, 'a b c d');
  const place = withLineRate(null, u, 1.3);
  assert.deepEqual(place, { text: 'a b c d', rate: 1.3 });
  const segments = [cue(1, { dubPlace: place! })];
  const rated = withLineRates(preview([u]), segments)!;
  const line = rated.units[0];
  assert.equal(line.rate, 1.3);
  assert.ok(Math.abs(line.estimate - 4) < 1e-9, `5.2 s read 1.3 times as fast is 4 s, got ${line.estimate}`);
  assert.equal(line.status, 'tight', 'it now fills its slot');
  assert.equal(rated.summary.long, 0);

  // A drag in progress counts before it is let go, and 1 takes the stretch off.
  assert.equal(withLineRates(preview([u]), [], { key: u.key, rate: 2 })!.units[0].estimate, 2.6);
  assert.equal(withLineRate(place, u, 1), null);
});

test("a stretch is the line's while it says the same words, and is held to what atempo takes", () => {
  const u = unit(0, 0, 4, 5, 'a b c');
  assert.equal(rateOf(withLineRate(null, u, 3), u), 2);
  assert.equal(rateOf(withLineRate(null, u, 0.2), u), 0.5);
  const place = withLineRate(withPartStart(null, u, 0, 0.4), u, 1.2);
  assert.deepEqual(place, { start: 0.4, text: 'a b c', rate: 1.2 });
  // New words: the stretch no longer counts, and the next change drops it.
  const reworded = { ...u, text: 'a b' };
  assert.equal(rateOf(place, reworded), 1);
  assert.equal(withCut(place, reworded, 1, true)?.rate, undefined);
});

test('how a speed sounds: natural to 1.15×, quick to 1.3×, then rushed; dragged under 0.85×', () => {
  assert.equal(rateZone(1), 'natural');
  assert.equal(rateZone(1.15), 'natural');
  assert.equal(rateZone(1.2), 'quick');
  assert.equal(rateZone(1.31), 'rushed');
  assert.equal(rateZone(0.85), 'natural');
  assert.equal(rateZone(0.8), 'slow');
});
