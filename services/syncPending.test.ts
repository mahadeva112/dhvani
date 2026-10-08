import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedSyncLines, withPendingLines } from './syncPending.ts';
import type { AudioSegment } from '../types';

const cue = (id: string | number, startTime: number, endTime: number, textTarget: string, textSource = 'src'): AudioSegment =>
  ({ id, startTime, endTime, duration: endTime - startTime, textTarget, textSource }) as AudioSegment;

const report = { units: [{ key: '1', cueIds: ['1', '2'] }, { key: '3', cueIds: ['3'] }] };

test('a cut marks the line it was made in, and names the new half by its id', () => {
  const before = [cue(1, 0, 2, 'a b'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  const after = [cue(1, 0, 1, 'a'), cue('1-x', 1, 2, 'b'), cue(2, 2, 3, 'c'), cue(3, 4, 5, 'd')];
  assert.deepEqual(changedSyncLines(before, after, report).sort(), ['1', '1-x']);
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
