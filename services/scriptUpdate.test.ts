import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksTranscribedAgain, mergeScriptUpdate } from './scriptUpdate.ts';
import type { AudioSegment } from '../types';

const cue = (id: string | number, startTime: number, endTime: number, textTarget: string, textSource = 'src'): AudioSegment =>
  ({ id, startTime, endTime, duration: endTime - startTime, textTarget, textSource }) as AudioSegment;

const base = [cue(1, 0, 2, 'a'), cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c')];
const ids = (list: AudioSegment[]) => list.map((s) => String(s.id));

test("the script's change is put on; a change made here to another cue is kept", () => {
  const here = [cue(1, 0, 2, 'a'), cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c reworded here')];
  const incoming = [cue(1, 0, 2.5, 'a fixed'), cue(2, 2.5, 4, 'b'), cue(3, 4, 6, 'c')];
  const update = mergeScriptUpdate(here, base, incoming);
  assert.deepEqual(update.segments.map((s) => s.textTarget), ['a fixed', 'b', 'c reworded here']);
  assert.equal(update.segments[1].startTime, 2.5);
  assert.deepEqual(update.changed, ['1', '2']);
  assert.deepEqual(update.keptHere, ['3']);
  assert.deepEqual(update.conflicts, []);
});

test('a cue changed on both sides takes the script and is named', () => {
  const here = [cue(1, 0, 2, 'a mine'), cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c')];
  const incoming = [cue(1, 0, 2, 'a theirs'), cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c')];
  const update = mergeScriptUpdate(here, base, incoming);
  assert.equal(update.segments[0].textTarget, 'a theirs');
  assert.deepEqual(update.conflicts, ['1']);
});

test("the script's cut and join land; a cut made here stays", () => {
  const here = [cue(1, 0, 2, 'a'), cue(2, 2, 3, 'b1'), cue('2-x', 3, 4, 'b2'), cue(3, 4, 6, 'c')];
  // The script cuts 1 in two and joins 3 into nothing (removed).
  const incoming = [cue(1, 0, 1, 'a1'), cue('1-y', 1, 2, 'a2'), cue(2, 2, 4, 'b')];
  const update = mergeScriptUpdate(here, [...base], incoming);
  assert.deepEqual(ids(update.segments), ['1', '1-y', '2', '2-x']);
  assert.deepEqual(update.added, ['1-y']);
  assert.deepEqual(update.removed, ['3']);
  assert.deepEqual(update.keptHere.sort(), ['2', '2-x']);
});

test('a script change to a cue joined away here is left for a person', () => {
  const here = [cue(1, 0, 4, 'a b'), cue(3, 4, 6, 'c')];
  const incoming = [cue(1, 0, 2, 'a'), cue(2, 2, 4, 'b fixed'), cue(3, 4, 6, 'c')];
  const update = mergeScriptUpdate(here, base, incoming);
  assert.deepEqual(ids(update.segments), ['1', '3']);
  assert.equal(update.segments[0].textTarget, 'a b');
  assert.deepEqual(update.notApplied, ['2']);
});

test("the dub's trim stays with its cue, never the script's copy of it", () => {
  const here = [{ ...cue(1, 0, 2, 'a'), dubTargetSeconds: 1.8 }, cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c')];
  const incoming = [cue(1, 0, 2, 'a fixed'), { ...cue(2, 2, 4, 'b fixed'), dubTargetSeconds: 9 }, cue(3, 4, 6, 'c')];
  const update = mergeScriptUpdate(here, base, incoming);
  assert.equal(update.segments[0].dubTargetSeconds, 1.8);
  assert.equal('dubTargetSeconds' in update.segments[1], false);
});

test('without a base the file is taken as it is', () => {
  const here = [cue(1, 0, 2, 'a mine'), cue(2, 2, 4, 'b')];
  const incoming = [cue(1, 0, 2, 'a'), cue(2, 2, 4, 'b'), cue(3, 4, 6, 'c')];
  const update = mergeScriptUpdate(here, null, incoming);
  assert.deepEqual(update.segments.map((s) => s.textTarget), ['a', 'b', 'c']);
  assert.deepEqual(update.changed, ['1']);
  assert.deepEqual(update.added, ['3']);
  assert.equal(update.noBase, true);
});

test('a transcript made again reads as one', () => {
  const incoming = [cue(1, 0, 1.5, 'x'), cue(2, 1.5, 3.8, 'y'), cue(3, 3.8, 6, 'z'), cue(4, 6, 7, 'w')];
  const update = mergeScriptUpdate(base, base, incoming);
  assert.equal(looksTranscribedAgain(update, incoming.length), true);
  assert.equal(looksTranscribedAgain(mergeScriptUpdate(base, base, base), base.length), false);
});
