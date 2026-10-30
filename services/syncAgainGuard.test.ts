import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLineEdit, lockLines, pickedTakeName, unlockedEdits } from './syncAgainGuard.ts';
import type { SyncTake, SyncTakes } from './syncTakes.ts';
import { basePart, syncedParts, type SyncBank, type SyncBankLine, type SyncEdits } from './syncEditModel.ts';

const RATE = 1000;

const line = (key: string, start: number, extra: Partial<SyncBankLine> = {}): SyncBankLine => ({
  key,
  speaker: 'A',
  bankStart: 0,
  length: 2 * RATE,
  startSample: start * RATE,
  lead: 0.1,
  speech: 1.8,
  gain: 1,
  hash: `h${key}`,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  locked: false,
  ...extra,
});

const bank = (lines: SyncBankLine[]): SyncBank => ({ bankId: 'b', sampleRate: RATE, float: false, lines, speakerGains: {} });

test('a line moved and trimmed by hand says so', () => {
  const l = line('1', 4);
  const part = basePart(l, RATE);
  const changes = describeLineEdit(l, { locked: false, parts: [{ ...part, start: 3.6, to: 1.4 }] }, RATE);
  assert.deepEqual(changes, ['Moved 0.40 s earlier', 'Trimmed by 0.60 s']);
});

test('speed, level, fades and a split are each named', () => {
  const l = line('1', 0);
  const part = basePart(l, RATE);
  const changes = describeLineEdit(
    l,
    { locked: false, parts: [{ ...part, to: 1, rate: 1.1, gainDb: 2 }, { ...part, id: 'b', from: 1, start: 1.2, fadeOut: 0.1 }] },
    RATE
  );
  assert.ok(changes.includes('Split into 2 parts'));
  assert.ok(changes.includes('Speed 1.10×'));
  assert.ok(changes.includes('Level +2.0 dB'));
  assert.ok(changes.includes('Fades'));
});

test('a removed line, and an edit that leaves the line as placed', () => {
  const l = line('1', 0);
  assert.deepEqual(describeLineEdit(l, { locked: false, parts: [] }, RATE), ['Removed']);
  assert.deepEqual(describeLineEdit(l, { locked: false, parts: syncedParts(l, RATE) }, RATE), []);
});

test('only unlocked, edited lines not voiced again are listed, in play order', () => {
  const lines = [line('1', 0), line('2', 3), line('3', 6), line('4', 9)];
  const moved = (l: SyncBankLine) => ({ locked: false, parts: [{ ...basePart(l, RATE), start: l.startSample / RATE + 0.5 }] });
  const edits: SyncEdits = {
    '4': moved(lines[3]),
    '1': moved(lines[0]),
    '2': { ...moved(lines[1]), locked: true },
    '3': moved(lines[2]),
    'original:1': { locked: false, parts: [] },
  };
  assert.deepEqual(
    unlockedEdits(bank(lines), edits, ['3']).map((e) => e.key),
    ['1', '4']
  );
  assert.deepEqual(unlockedEdits(bank(lines), null), []);
});

test('locking keeps every other edit as it was', () => {
  const l = line('1', 0);
  const edits: SyncEdits = { '1': { locked: false, parts: [basePart(l, RATE)] }, '2': { locked: false, parts: [] } };
  const locked = lockLines(edits, ['1', 'missing'], bank([l]));
  assert.equal(locked['1'].locked, true);
  assert.equal(locked['2'].locked, false);
  assert.equal(locked.missing, undefined);
  assert.equal(edits['1'].locked, false);
});

const take = (id: string): SyncTake => ({
  id,
  kind: id === 'sync' ? 'sync' : 'line',
  bankStart: 0,
  length: RATE,
  lead: 0,
  speech: 1,
  gain: 1,
  hash: `t${id}`,
  cutOff: false,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  text: 'words',
});

test('a take picked in the T window is listed by the name the T window gives it', () => {
  const lines = [line('1', 0), line('2', 3), line('3', 6), line('4', 9)];
  const takes: SyncTakes = {
    '1': { takes: [take('sync'), take('a'), take('b')], active: 'b' },
    '2': { takes: [take('sync'), take('a')], active: 'sync' },
    '3': { takes: [take('sync'), take('a')], active: 'a' },
    '4': { takes: [take('sync'), take('a')], active: 'a' },
  };
  assert.equal(pickedTakeName(takes, '1'), 'Take 2');
  assert.equal(pickedTakeName(takes, '2'), null);
  const edits: SyncEdits = {
    '3': { locked: false, parts: [{ ...basePart(lines[2], RATE), start: 6.5 }] },
    '4': { locked: true, parts: syncedParts(lines[3], RATE) },
  };
  assert.deepEqual(unlockedEdits(bank(lines), edits, [], takes), [
    { key: '1', changes: ['Take 2 picked in the T window'] },
    { key: '3', changes: ['Take 1 picked in the T window', 'Moved 0.50 s later'] },
  ]);
  assert.deepEqual(unlockedEdits(bank(lines), edits, ['1', '3'], takes), []);
});

test('locking a line with no edit locks it where Sync placed it', () => {
  const l = line('1', 2);
  const locked = lockLines(null, ['1'], bank([l]));
  assert.deepEqual(locked['1'], { parts: syncedParts(l, RATE), locked: true });
});
