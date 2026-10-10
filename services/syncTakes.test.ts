import test from 'node:test';
import assert from 'node:assert/strict';
import { appendToBank, phraseOf, pickedTakes, putTake, takeFit, takeWav, takesOf, type SyncTake } from './syncTakes.ts';
import type { SyncBank, SyncBankLine } from './syncEditModel.ts';
import type { SyncReport, SyncUnitReport } from './syncService.ts';

const RATE = 1000;

/** A 16-bit mono WAV as the server writes it: the 44-byte header, then the samples. */
const wav = (values: number[]) => {
  const view = new DataView(new ArrayBuffer(44 + values.length * 2));
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + values.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, values.length * 2, true);
  values.forEach((v, i) => view.setInt16(44 + i * 2, v, true));
  return new Blob([view.buffer], { type: 'audio/wav' });
};
const samplesOf = async (blob: Blob) => Array.from(new Int16Array((await blob.arrayBuffer()).slice(44)));

const line = (key: string, extra: Partial<SyncBankLine> = {}): SyncBankLine => ({
  key,
  speaker: 'Speaker',
  bankStart: 0,
  length: 1000,
  startSample: 2000,
  lead: 0.1,
  speech: 0.8,
  gain: 1,
  hash: `h${key}`,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  locked: false,
  ...extra,
});

const unit = (key: string, srcStart: number, srcEnd: number, extra: Partial<SyncUnitReport> = {}): SyncUnitReport =>
  ({
    index: 0,
    key,
    cueIds: [key],
    speaker: null,
    text: 'one two three four',
    sourceText: '',
    srcStart,
    srcEnd,
    placedStart: srcStart,
    placedEnd: srcStart + 0.8,
    offset: 0,
    overrun: 0,
    inSync: true,
    silent: false,
    exceeded: false,
    exceededBy: 0,
    short: false,
    shortBy: 0,
    speech: 0.8,
    targetChars: null,
    suggestion: null,
    deepCut: false,
    pauseTrimmed: 0,
    late: false,
    joinAfter: null,
    tightJoin: false,
    ...extra,
  }) as SyncUnitReport;

const take = (extra: Partial<SyncTake>): SyncTake => ({
  id: 't1',
  kind: 'line',
  bankStart: 2000,
  length: 900,
  lead: 0.05,
  speech: 0.7,
  gain: 1,
  hash: 'new',
  cutOff: false,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  text: 'one two three four',
  ...extra,
});

test('takes are added after the bank, its own bytes untouched', async () => {
  const bank = wav([1, 2, 3, 4]);
  const added = wav([9, 8]);
  const next = await appendToBank(bank, added, { sampleRate: RATE, float: false, baseLength: 4 });
  assert.deepEqual(await samplesOf(next), [1, 2, 3, 4, 9, 8]);
  const head = new DataView(await next.slice(0, 44).arrayBuffer());
  assert.equal(head.getUint32(40, true), 12, 'the header counts every sample');
  await assert.rejects(appendToBank(bank, added, { sampleRate: RATE, float: false, baseLength: 5 }), /match/);
  assert.deepEqual(await samplesOf(takeWav(next, { bankStart: 4, length: 2 }, { sampleRate: RATE, float: false })), [9, 8]);
});

test('a phrase splits the line around the words picked, in either order', () => {
  assert.deepEqual(phraseOf('one two three four', 1, 2), { before: 'one', words: 'two three', after: 'four' });
  assert.deepEqual(phraseOf('one two three four', 3, 0), { before: '', words: 'one two three four', after: '' });
});

test("a take is put in the dub with its first word where the line's is, and the report follows it", () => {
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [line('1'), line('2', { bankStart: 1000, startSample: 5000 })], speakerGains: {} };
  const base = { tolerance: 0.15, join: { maxLateStart: 1, flagJoin: 0.05 }, units: [unit('1', 2.1, 3), unit('2', 5.1, 6)], summary: {} } as unknown as SyncReport;
  const edits = { '1': { locked: true, parts: [{ id: '1#0', start: 2.5, from: 0, to: 1, rate: 1, gainDb: -3, fadeIn: 0, fadeOut: 0, muted: false }] } };
  const out = putTake({ bank, edits, baseReport: base, key: '1', take: take({ speech: 3, length: 3100 }) });
  const placed = out.bank.lines[0];
  // The line's first word was at 2.5 + 0.1 s; the take's lead is 0.05 s.
  assert.equal(placed.startSample, Math.round((2.6 - 0.05) * RATE));
  assert.equal(placed.bankStart, 2000);
  assert.equal(placed.hash, 'new');
  assert.deepEqual(out.bank.lines[1], bank.lines[1], 'other lines are untouched');
  assert.equal(out.edits?.['1'].locked, true, 'the lock carries over');
  assert.equal(out.edits?.['1'].parts[0].gainDb, -3, 'and the gain');
  assert.equal(out.edits?.['1'].parts[0].to, 3.1, 'the part covers the new take');
  const measured = out.baseReport.units[0];
  assert.ok(Math.abs((measured.placedStart ?? 0) - 2.6) < 1e-9);
  assert.equal(measured.exceeded, true, 'a take that runs past the next line is too long');
  assert.equal(measured.picked, true);
  assert.equal(out.baseReport.units[1], base.units[1]);
});

test('how a take fits: cut off first, then too long, then ending early', () => {
  const u = unit('1', 2, 4);
  assert.equal(takeFit(take({ cutOff: true }), u, 2, 5, 0.15).tone, 'cut');
  assert.equal(takeFit(take({ speech: 3.5 }), u, 2, 5, 0.15).tone, 'over');
  assert.equal(takeFit(take({ speech: 0.5 }), u, 2, 5, 0.15).tone, 'short');
  assert.equal(takeFit(take({ speech: 1.8 }), u, 2, 5, 0.15).tone, 'fits');
  assert.ok(takeFit(take({ speech: 1.9 }), u, 2, 5, 0.15).score < takeFit(take({ speech: 1.2 }), u, 2, 5, 0.15).score);
});

test('Sync is sent only the takes the user picked, and none whose words changed', () => {
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [line('1'), line('2')], speakerGains: {} };
  const kept = takesOf(null, bank.lines[0], unit('1', 0, 1));
  assert.equal(kept.takes.length, 1);
  assert.equal(kept.active, 'sync');
  assert.equal(pickedTakes(bank, { '1': kept }), undefined, "Sync's own take needs no keeping");
  const picked = { '1': { takes: [...kept.takes, take({})], active: 't1' }, '2': { takes: [take({ id: 't2' })], active: 't2' } };
  assert.deepEqual(Object.keys(pickedTakes(bank, picked, ['2'])?.lines ?? {}), ['1']);
  assert.equal(pickedTakes(bank, picked)?.bankId, 'b');
});
