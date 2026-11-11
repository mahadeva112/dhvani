import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSyncLineKinds, changedSyncLines, lineTextNow, notPending, pendingForSync, rewordedOnly, syncPendingAfter, withPendingLines } from './syncPending.ts';
import type { AudioSegment } from '../types';

const cue = (id: string | number, startTime: number, endTime: number, textTarget: string, textSource = 'src'): AudioSegment =>
  ({ id, startTime, endTime, duration: endTime - startTime, textTarget, textSource }) as AudioSegment;

const report = { units: [{ key: '1', cueIds: ['1', '2'] }, { key: '3', cueIds: ['3'] }] };

test('a cut marks the one line it was made in', () => {
  const before = [cue(1, 0, 2, 'a b'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  const after = [cue(1, 0, 1, 'a'), cue('1-x', 1, 2, 'b'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  assert.deepEqual(changedSyncLines(before, after, report), ['1']);
});

test('a join marks both lines; numbered ids match the report', () => {
  const before = [cue(1, 0, 2, 'a'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  const after = [cue(1, 0, 2, 'a'), cue(2, 2, 5, 'c d')];
  assert.deepEqual(changedSyncLines(before, after, report).sort(), ['1', '3']);
});

test('nothing changed, or no sync yet, marks nothing', () => {
  const segments = [cue(1, 0, 2, 'a')];
  assert.deepEqual(changedSyncLines(segments, segments.map((s) => ({ ...s })), report), []);
  assert.deepEqual(changedSyncLines(segments, [cue(1, 0, 1, 'a')], null), []);
});

test('withPendingLines adds only new keys', () => {
  const pending = ['1'];
  assert.equal(withPendingLines(pending, ['1']), pending);
  assert.deepEqual(withPendingLines(pending, ['1', '3']), ['1', '3']);
});

test('words only: same cues and times, another wording, is a words change', () => {
  const before = [cue(1, 0, 2, 'চোখ বন্ধ'), cue(2, 2, 3, 'করে বসুন।'), cue(3, 4, 5, 'd')];
  const after = [cue(1, 0, 2, 'চোখ বন্ধ'), cue(2, 2, 3, 'করে আরাম করে বসুন।'), cue(3, 4, 5, 'd')];
  assert.deepEqual([...changedSyncLineKinds(before, after, report)], [['1', 'words']]);
});

test('a retime, a cut, a new original, or a sentence end changed is a structure change', () => {
  const before = [cue(1, 0, 2, 'a b'), cue(2, 2, 3, 'c.'), cue(3, 4, 5, 'd')];
  const retimed = [cue(1, 0.2, 2, 'a b'), cue(2, 2, 3, 'c.'), cue(3, 4, 5, 'd')];
  assert.deepEqual([...changedSyncLineKinds(before, retimed, report)], [['1', 'structure']]);
  const cut = [cue(1, 0, 1, 'a'), cue('1-x', 1, 2, 'b'), cue(2, 2, 3, 'c.'), cue(3, 4, 5, 'd')];
  assert.deepEqual([...changedSyncLineKinds(before, cut, report)], [['1', 'structure']]);
  const source = [cue(1, 0, 2, 'a b', 'other'), cue(2, 2, 3, 'c.'), cue(3, 4, 5, 'd')];
  assert.deepEqual([...changedSyncLineKinds(before, source, report)], [['1', 'structure']]);
  // Sync joins cues into lines by where sentences end: losing the full stop could join line 3 on.
  const open = [cue(1, 0, 2, 'a b'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  assert.deepEqual([...changedSyncLineKinds(before, open, report)], [['1', 'structure']]);
  const emptied = [cue(1, 0, 2, 'a b'), cue(2, 2, 3, 'c.'), cue(3, 4, 5, '')];
  assert.deepEqual([...changedSyncLineKinds(before, emptied, report)], [['3', 'structure']]);
});

test('a words change of a synced line can be retaken in place; a later cut takes that away', () => {
  const synced = [cue(1, 0, 2, 'a'), cue(2, 2, 3, 'b.'), cue(3, 4, 5, 'd')];
  const job = { segments: synced, syncReport: report, syncPendingLines: [] as string[], syncPendingWords: [] as string[] };
  const reworded = [cue(1, 0, 2, 'a'), cue(2, 2, 3, 'bee.'), cue(3, 4, 5, 'd')];
  const first = syncPendingAfter(job, reworded);
  assert.deepEqual(first, { syncPendingLines: ['1'], syncPendingWords: ['1'] });
  const after = { ...job, ...first, segments: reworded };
  assert.equal(rewordedOnly(after, '1'), true);
  // Another wording keeps it so.
  assert.deepEqual(syncPendingAfter(after, [cue(1, 0, 2, 'ay'), cue(2, 2, 3, 'bee.'), cue(3, 4, 5, 'd')]), {});
  // A retime makes it wait for Sync again.
  const retimed = syncPendingAfter(after, [cue(1, 0, 2.5, 'a'), cue(2, 2.5, 3, 'bee.'), cue(3, 4, 5, 'd')]);
  assert.deepEqual(retimed, { syncPendingWords: [] });
  assert.equal(rewordedOnly({ ...after, ...retimed }, '1'), false);
});

test('a line pending for Sync first stays so when its words change too', () => {
  const synced = [cue(1, 0, 2, 'a'), cue(2, 2, 3, 'b.'), cue(3, 4, 5, 'd')];
  const job = { segments: synced, syncReport: report, syncPendingLines: ['1'], syncPendingWords: [] as string[] };
  assert.deepEqual(syncPendingAfter(job, [cue(1, 0, 2, 'ay'), cue(2, 2, 3, 'b.'), cue(3, 4, 5, 'd')]), {});
  // A retake asked in Review on a reworded line: Sync again first.
  assert.deepEqual(pendingForSync({ syncPendingLines: ['1'], syncPendingWords: ['1'] }, ['1']), { syncPendingLines: ['1'], syncPendingWords: [] });
});

test('a take in the new words puts the line back in step; its words are read as Sync joins them', () => {
  assert.deepEqual(notPending({ syncPendingLines: ['1', '3'], syncPendingWords: ['1'] }, '1'), { syncPendingLines: ['3'], syncPendingWords: [] });
  assert.equal(lineTextNow([cue(1, 0, 1, ' a '), cue(2, 1, 2, ''), cue(3, 2, 3, 'c')], ['1', '2', '3']), 'a c');
});
