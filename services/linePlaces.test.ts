import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatedWords, letterCount, linePartsOf, partEnd, withCut, withLinePlaces, withPartStart } from './linePlaces.ts';
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
