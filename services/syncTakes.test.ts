import test from 'node:test';
import assert from 'node:assert/strict';
import { appendManyToBank, appendToBank, carryTakes, compactBank, fitTakeToParts, knownWords, sayWords, syncTakeOf, syncTakeWords, phraseLine, phraseOf, pickedTakes, placeTakeChunks, putTake, takeFit, takeWav, takesOf, type SyncTake } from './syncTakes.ts';
import type { SyncBank, SyncBankLine } from './syncEditModel.ts';
import type { SyncReport, SyncUnitReport } from './syncService.ts';
import { measureEdits, partEnd, partsOf, spokenSpan, type SyncEditPart } from './syncEditModel.ts';

const RATE = 1000;

test('an Alt + drag copy plays but the line is still measured where its own part speaks', () => {
  const own: SyncEditPart = { id: '1#0', start: 2, from: 0, to: 1, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false };
  const copy: SyncEditPart = { ...own, id: '1#copy', start: 9, copy: true };
  assert.deepEqual(spokenSpan(line('1'), [own, copy]), { start: 2.1, end: 2.9 });
  // Only the copy speaks (its own part muted): the line is where the copy is.
  assert.deepEqual(spokenSpan(line('1'), [{ ...own, muted: true }, copy]), { start: 9.1, end: 9.9 });
});

test('a changed take invalidates previous word verification instead of retaining stale measurements', () => {
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [line('1')], speakerGains: {} };
  const base = { tolerance: 0.15, join: { maxLateStart: 1, flagJoin: 0.05 },
    units: [unit('1', 2.1, 3, { wordTiming: { status: 'measured', boundaryMismatch: true } })],
    summary: { wordTimingMeasured: 1, boundaryMismatches: 1 } } as unknown as SyncReport;
  const report = measureEdits(base, bank, null, ['1']);
  assert.equal(report.units[0].wordTiming?.status, 'unavailable');
  assert.equal(report.summary.wordTimingMeasured, 0);
  assert.equal(report.summary.wordTimingUnavailable, 1);
  assert.equal(report.summary.boundaryMismatches, 0);
});

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

test('voice-changed lines go after the bank in order, its own bytes untouched', async () => {
  const bank = wav([1, 2, 3, 4]);
  const next = await appendManyToBank(bank, [wav([9, 8]), wav([7])], { sampleRate: RATE, float: false, baseLength: 4 });
  assert.deepEqual(await samplesOf(next), [1, 2, 3, 4, 9, 8, 7]);
  const head = new DataView(await next.slice(0, 44).arrayBuffer());
  assert.equal(head.getUint32(40, true), 14, 'the header counts every sample');
  await assert.rejects(appendManyToBank(bank, [wav([9])], { sampleRate: RATE, float: false, baseLength: 3 }), /match/);
});

test('a phrase splits the line around the words picked, in either order', () => {
  assert.deepEqual(phraseOf('one two three four', 1, 2), { before: 'one', words: 'two three', after: 'four' });
  assert.deepEqual(phraseOf('one two three four', 3, 0), { before: '', words: 'one two three four', after: '' });
  assert.equal(phraseLine('one two three four', 1, 2, ' [softly] new words '), 'one [softly] new words four', 'other words go in place of the picked ones');
  assert.equal(phraseLine('one two three four', 0, 0, 'zero'), 'zero two three four');
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

test("a take plays whole at its own length, not cut at the old take's chunks; Sync's own take gets them back", () => {
  // Chunk sync placed line 1 as two chunks, a pause cut between them; line 2 follows at 3 s.
  const chunks = [
    { from: 0, to: 400, startSample: 2000 },
    { from: 500, to: 1000, startSample: 2400 },
  ];
  const synced = line('1', { chunks });
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [synced, line('2', { bankStart: 1000, startSample: 3000 })], speakerGains: {} };
  const base = { tolerance: 0.15, join: { maxLateStart: 1, flagJoin: 0.05 }, units: [unit('1', 2.1, 3), unit('2', 3.1, 4)], summary: {} } as unknown as SyncReport;
  const own = takesOf(null, synced, base.units[0]).takes[0];
  assert.deepEqual(own.chunks, chunks, "Sync's own take keeps its chunks");

  // A word left out: a shorter take is drawn and rendered over its own 0.6 s, nothing past it.
  const short = putTake({ bank, edits: null, baseReport: base, key: '1', take: take({ length: 600 }) });
  assert.equal(short.bank.lines[0].chunks, undefined);
  assert.deepEqual(partsOf(short.edits, short.bank.lines[0], RATE).map((p) => [p.from, p.to]), [[0, 0.6]]);

  // A word added: a longer take plays to its end, over the next line, as an overlap to fix.
  const long = putTake({ bank, edits: null, baseReport: base, key: '1', take: take({ length: 1500, speech: 1.4 }) });
  const longParts = partsOf(long.edits, long.bank.lines[0], RATE);
  assert.deepEqual(longParts.map((p) => [p.from, p.to]), [[0, 1.5]]);
  assert.ok(partEnd(longParts[0]) > 3, 'it runs past where line 2 starts');

  // Back to Sync's take, with the line moved 0.5 s later meanwhile: its chunks come back, moved with it.
  const moved = { '1': { locked: false, parts: [{ ...partsOf(short.edits, short.bank.lines[0], RATE)[0], start: 2.55 }] } };
  const back = putTake({ bank: short.bank, edits: moved, baseReport: short.baseReport, key: '1', take: own });
  assert.deepEqual(
    back.bank.lines[0].chunks,
    chunks.map((c) => ({ ...c, startSample: c.startSample + 500 }))
  );
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

test('a compacted bank keeps only the playing samples, bit for bit, and points everything at them', async () => {
  const blob = wav(Array.from({ length: 80 }, (_, i) => i));
  const bank: SyncBank = {
    bankId: 'old-bank-id',
    sampleRate: RATE,
    float: false,
    lines: [line('a', { bankStart: 40, length: 10 }), line('b', { bankStart: 10, length: 10 }), line('o', { bankStart: 0, length: 999, original: true })],
    speakerGains: {},
  };
  const takes = {
    a: { takes: [take({ id: 'sync', bankStart: 0, length: 10 }), take({ id: 't2', bankStart: 40, length: 10 })], active: 't2' },
    b: { takes: [take({ id: 'sync', bankStart: 10, length: 10 }), take({ id: 't3', bankStart: 60, length: 20 })], active: 'sync' },
  };
  const out = await compactBank(bank, blob, takes, 'new-bank-id');
  assert.deepEqual(await samplesOf(out.bankBlob), [...Array.from({ length: 10 }, (_, i) => 10 + i), ...Array.from({ length: 10 }, (_, i) => 40 + i)]);
  assert.equal(out.bank.bankId, 'new-bank-id');
  assert.deepEqual(out.bank.lines.map((l) => l.bankStart), [10, 0, 0], 'the original clip line is left alone');
  assert.deepEqual(out.takes, {
    a: { takes: [take({ id: 't2', bankStart: 10, length: 10 })], active: 't2' },
    b: { takes: [take({ id: 'sync', bankStart: 0, length: 10 })], active: 'sync' },
  });
  const head = new DataView(await out.bankBlob.slice(0, 44).arrayBuffer());
  assert.equal(head.getUint32(40, true), 40, 'the header counts the kept samples');
});

test('after a Sync every line keeps its takes: copied bit for bit to the end of the new bank, the picked one still playing', async () => {
  // The last bank: line a's Sync take at 0, its retakes at 20 and 30; line b's Sync take at 10, a retake at 40.
  const priorBlob = wav(Array.from({ length: 50 }, (_, i) => 100 + i));
  const priorBank: SyncBank = {
    bankId: 'old',
    sampleRate: RATE,
    float: false,
    lines: [line('a', { bankStart: 30, length: 10 }), line('b', { bankStart: 10, length: 10, hash: 'hb' })],
    speakerGains: {},
  };
  const priorTakes = {
    a: {
      takes: [
        take({ id: 'sync', kind: 'sync', bankStart: 0, length: 10, hash: 'ha' }),
        take({ id: '5-k', bankStart: 20, length: 10, hash: 'r1' }),
        take({ id: 'voice-u', bankStart: 30, length: 10, hash: 'r2', voice: 'Asha', voiceId: 'new' }),
        take({ id: '6-z', bankStart: 45, length: 5, hash: 'r3', text: 'other words' }),
      ],
      active: 'voice-u',
    },
    b: { takes: [take({ id: 'sync', kind: 'sync', bankStart: 10, length: 10, hash: 'hb' }), take({ id: '7-14', bankStart: 40, length: 5, hash: 'r4' })], active: 'sync' },
  };
  // The new bank: a kept as picked (same samples, at 0), b voiced again by Sync just as it was (at 10), and a clip of the original.
  const newBlob = wav(Array.from({ length: 20 }, (_, i) => i));
  const bank: SyncBank = {
    bankId: 'synced',
    sampleRate: RATE,
    float: false,
    lines: [line('a', { bankStart: 0, length: 10, hash: 'r2' }), line('b', { bankStart: 10, length: 10, hash: 'hb' }), line('o', { bankStart: 0, length: 999, original: true })],
    speakerGains: {},
  };
  const report = { units: [unit('a', 0, 1, { picked: true }), unit('b', 2, 3)] } as unknown as SyncReport;
  const out = (await carryTakes({ priorBank, priorBankBlob: priorBlob, priorTakes, bank, bankBlob: newBlob, report, bankId: 'grown' }))!;

  assert.equal(out.bank.bankId, 'grown', 'a grown bank goes under a new id');
  assert.deepEqual(out.bank.lines, bank.lines, 'the lines play exactly what Sync placed');
  // New bank, then a's old Sync take and its first retake, then b's retake; the take in other words is let go.
  assert.deepEqual(await samplesOf(out.bankBlob), [
    ...Array.from({ length: 20 }, (_, i) => i),
    ...Array.from({ length: 10 }, (_, i) => 100 + i),
    ...Array.from({ length: 10 }, (_, i) => 120 + i),
    ...Array.from({ length: 5 }, (_, i) => 140 + i),
  ]);
  const a = out.takes!.a;
  assert.deepEqual(a.takes.map((t) => [t.id, t.kind, t.bankStart]), [['sync', 'sync', 20], ['5-u', 'line', 30], ['voice-0', 'line', 0]]);
  assert.equal(a.active, 'voice-0', 'the picked take still plays, at the line');
  const playing = a.takes.find((t) => t.id === a.active)!;
  assert.equal(playing.voiceId, 'new', 'a voice-changed take stays in its voice');
  assert.equal(playing.hash, 'r2');
  const b = out.takes!.b;
  assert.deepEqual(b.takes.map((t) => [t.id, t.bankStart]), [['sync', 10], ['7-14', 40]], "Sync's take again is not kept twice");
  assert.equal(b.active, 'sync');
  assert.equal(out.takes!.o, undefined);
});

test('after a Sync, a line voiced anew keeps its old Sync take only when it sounds different, as a take of its own', async () => {
  const priorBlob = wav(Array.from({ length: 10 }, (_, i) => 50 + i));
  const priorBank: SyncBank = { bankId: 'old', sampleRate: RATE, float: false, lines: [line('a', { bankStart: 0, length: 10, hash: 'old' })], speakerGains: {} };
  const priorTakes = {
    a: { takes: [take({ id: 'sync', kind: 'sync', bankStart: 0, length: 10, hash: 'old', chunks: [{ from: 0, to: 10, startSample: 5 }], maxStartShift: 3 })], active: 'sync' },
  };
  const bank: SyncBank = { bankId: 'synced', sampleRate: RATE, float: false, lines: [line('a', { bankStart: 0, length: 4, hash: 'fresh' })], speakerGains: {} };
  const report = { units: [unit('a', 0, 1)] } as unknown as SyncReport;
  const out = (await carryTakes({ priorBank, priorBankBlob: priorBlob, priorTakes, bank, bankBlob: wav([1, 2, 3, 4]), report, bankId: 'grown' }))!;
  const kept = out.takes!.a;
  assert.equal(kept.active, 'sync');
  assert.deepEqual(kept.takes.map((t) => [t.id, t.kind, t.bankStart]), [['sync', 'sync', 0], ['was-sync-4', 'line', 4]]);
  assert.equal(kept.takes[1].chunks, undefined, 'played whole, as any take');
  assert.equal(kept.takes[1].maxStartShift, undefined);
  assert.deepEqual(await samplesOf(out.bankBlob), [1, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => 50 + i)]);
});

test('after a Sync nothing is carried across formats, and a line with only Sync take needs no list', async () => {
  const priorBank: SyncBank = { bankId: 'old', sampleRate: 2000, float: false, lines: [line('a')], speakerGains: {} };
  const bank: SyncBank = { bankId: 'synced', sampleRate: RATE, float: false, lines: [line('a', { hash: 'x' })], speakerGains: {} };
  const report = { units: [unit('a', 0, 1)] } as unknown as SyncReport;
  const priorTakes = { a: { takes: [take({ id: 'sync', kind: 'sync', bankStart: 0, length: 4, hash: 'x' })], active: 'sync' } };
  assert.equal(await carryTakes({ priorBank, priorBankBlob: wav([1, 2, 3, 4]), priorTakes, bank, bankBlob: wav([1]), report, bankId: 'g' }), null);
  assert.equal(await carryTakes({ priorBank: { ...priorBank, sampleRate: RATE }, priorBankBlob: wav([1, 2, 3, 4]), priorTakes, bank, bankBlob: wav([1]), report, bankId: 'g' }), null);
});

test('a used take is cut and placed as Chunk sync placed it, its gain on every part, the other lines untouched', () => {
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [line('1'), line('2', { bankStart: 1000, startSample: 5000 })], speakerGains: {} };
  const base = { tolerance: 0.15, join: { maxLateStart: 1, flagJoin: 0.05 }, units: [unit('1', 2.1, 3), unit('2', 5.1, 6)], summary: {} } as unknown as SyncReport;
  const used = take({ length: 900, lead: 0.05, speech: 0.7 });
  const gained = { '1': { locked: false, parts: [{ id: '1#0', start: 2, from: 0, to: 1, rate: 1, gainDb: -3, fadeIn: 0, fadeOut: 0, muted: false }] } };
  const put = putTake({ bank, edits: gained, baseReport: base, key: '1', take: used });
  // The server cut it in two at its pause and put each part on the original.
  const chunks = [
    { from: 0, to: 400, startSample: 2050 },
    { from: 500, to: 900, startSample: 2600 },
  ];
  const placed = placeTakeChunks({ bank: put.bank, edits: put.edits, baseReport: put.baseReport, key: '1', take: used, chunks });
  assert.ok(placed);
  assert.deepEqual(placed.bank.lines[0].chunks, chunks);
  assert.equal(placed.bank.lines[0].startSample, 2050);
  assert.deepEqual(placed.bank.lines[1], bank.lines[1], 'the other line stays where it is');
  const parts = partsOf(placed.edits, placed.bank.lines[0], RATE);
  assert.deepEqual(parts.map((p) => [p.start, p.from, p.to, p.gainDb]), [[2.05, 0, 0.4, -3], [2.6, 0.5, 0.9, -3]]);
  // Its first word is 0.05 s into the first part.
  assert.ok(Math.abs((placed.baseReport.units[0].placedStart ?? 0) - 2.1) < 1e-9);

  // With no gain there is nothing to keep in the edits: the line plays its chunks.
  const plain = putTake({ bank, edits: null, baseReport: base, key: '1', take: used });
  assert.equal(placeTakeChunks({ bank: plain.bank, edits: plain.edits, baseReport: plain.baseReport, key: '1', take: used, chunks })?.edits, null);
});

test('a used take is not cut once the line was changed, moved or locked meanwhile', () => {
  const bank: SyncBank = { bankId: 'b', sampleRate: RATE, float: false, lines: [line('1')], speakerGains: {} };
  const base = { tolerance: 0.15, join: { maxLateStart: 1, flagJoin: 0.05 }, units: [unit('1', 2.1, 3)], summary: {} } as unknown as SyncReport;
  const used = take({});
  const chunks = [{ from: 0, to: 900, startSample: 2050 }];
  const put = putTake({ bank, edits: null, baseReport: base, key: '1', take: used });
  const args = { bank: put.bank, baseReport: put.baseReport, key: '1', take: used, chunks };
  const part = partsOf(null, put.bank.lines[0], RATE)[0];
  assert.equal(placeTakeChunks({ ...args, edits: { '1': { locked: true, parts: [part] } } }), null, 'locked');
  assert.equal(placeTakeChunks({ ...args, edits: { '1': { locked: false, parts: [{ ...part, to: 0.5 }] } } }), null, 'trimmed');
  assert.equal(placeTakeChunks({ ...args, edits: { '1': { locked: false, parts: [part, { ...part, id: 'x', start: 5 }] } } }), null, 'split');
  assert.equal(placeTakeChunks({ ...args, edits: null, take: take({ bankStart: 9000 }) }), null, 'another take in the dub now');
  assert.equal(placeTakeChunks({ ...args, edits: null, chunks: [{ from: 0, to: 5000, startSample: 0 }] }), null, 'chunks past the take');
});

/* A line the user cut in two (words 1-3, words 4-6) and placed under the original by hand. */
const handPart = (n: number, start: number, from: number, to: number, extra: Partial<SyncEditPart> = {}): SyncEditPart => ({
  id: `1#${n}`, start, from, to, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false, ...extra,
});
/** Six words of `w` seconds with `g` seconds between, from `lead` into the take. */
const wordsAt = (w: number, g: number, lead = 0.2) => Array.from({ length: 6 }, (_, i) => ({ start: lead + i * (w + g), end: lead + i * (w + g) + w }));
const OLD_WORDS = wordsAt(0.4, 0.1);
// Part 1 plays words 1-3 with word 1 at 1.0 s; part 2 words 4-6 with word 4 at 3.4 s, a little quieter, faded in.
const OLD_PARTS = [handPart(0, 0.9, 0.1, 1.5), handPart(1, 3.35, 1.65, 3.2, { gainDb: -2, fadeIn: 0.05 })];
const firstWordOf = (part: SyncEditPart, word: { start: number }) => part.start + (word.start - part.from);

test('a used take is cut at the same words as the old parts and each part plays its first word where the old one did', () => {
  for (const [name, words] of [['same', wordsAt(0.4, 0.1)], ['shorter', wordsAt(0.3, 0.05)], ['longer', wordsAt(0.5, 0.15)]] as const) {
    const fit = fitTakeToParts({ key: '1', oldParts: OLD_PARTS, oldWords: OLD_WORDS, newWords: words, takeSeconds: words[5].end + 0.2, prevEnd: 0.5, nextStart: 6 });
    assert.ok(fit, name);
    assert.equal(fit.parts.length, 2, `${name}: two parts, as before`);
    const [one, two] = fit.parts;
    assert.ok(Math.abs(firstWordOf(one, words[0]) - 1.0) < 1e-9, `${name}: word 1 at ${firstWordOf(one, words[0])}`);
    assert.ok(Math.abs(firstWordOf(two, words[3]) - 3.4) < 1e-9, `${name}: word 4 at ${firstWordOf(two, words[3])}`);
    // Cut between words 3 and 4, never inside one.
    assert.ok(one.from <= words[0].start && one.to >= words[2].end && one.to <= words[3].start, `${name}: part 1 holds words 1-3 whole`);
    assert.ok(two.from >= words[2].end && two.from <= words[3].start && two.to >= words[5].end, `${name}: part 2 holds words 4-6 whole`);
    assert.equal(two.gainDb, -2, 'the gain carries over');
    assert.equal(two.fadeIn, 0.05, 'and the fade');
    assert.ok(fit.parts.every((p) => p.rate === 1), 'at the speed it was voiced');
    assert.deepEqual(fit.over, [0, 0]);
  }
});

test('a take too long for its place moves into the room before it, and what still does not fit is flagged, never cut', () => {
  // Words 0.7 s long: part 1 would run into part 2.
  const long = wordsAt(0.7, 0.2);
  const fit = fitTakeToParts({ key: '1', oldParts: OLD_PARTS, oldWords: OLD_WORDS, newWords: long, takeSeconds: long[5].end + 0.2, prevEnd: 0.5, nextStart: 6 });
  assert.ok(fit);
  const [one, two] = fit.parts;
  assert.ok(fit.moved[0] > 0, 'part 1 moved earlier');
  assert.ok(one.start + one.to - one.from <= two.start - 0.05 + 1e-9 || fit.over[0] > 0);
  assert.ok(one.start >= 0.5 + 0.05 - 1e-9, 'not into the line before');
  // Every word is still whole in its part.
  assert.ok(one.from <= long[0].start && one.to >= long[2].end && two.to >= long[5].end);

  // With no room before it either, it stays and says how far it runs over.
  const tight = fitTakeToParts({ key: '1', oldParts: OLD_PARTS, oldWords: OLD_WORDS, newWords: wordsAt(1.2, 0.3), takeSeconds: 10, prevEnd: 0.9, nextStart: 6 });
  assert.ok(tight && tight.over[0] > 0);
});

test('a take in other words does not pair with the old parts', () => {
  assert.equal(fitTakeToParts({ key: '1', oldParts: OLD_PARTS, oldWords: OLD_WORDS, newWords: OLD_WORDS.slice(0, 5), takeSeconds: 4 }), null);
});

test("Sync's take knows its words from Sync's own alignment, less what was dropped before 0:00, and a kept take from its own", () => {
  const synced = line('1', { dropped: 100, length: 1000 });
  const readWords: [string, number, number][] = [['one', 0.2, 0.4], ['—', 0.4, 0.45], ['two', 0.5, 0.8]];
  assert.deepEqual(syncTakeWords(synced, readWords, RATE), [[0.1, 0.3], [0.4, 0.7]], 'lone punctuation is not a word');
  const own = syncTakeOf(synced, 'one — two', syncTakeWords(synced, readWords, RATE));
  assert.deepEqual(knownWords(own, undefined, RATE), [{ start: 0.1, end: 0.3 }, { start: 0.4, end: 0.7 }]);
  // An older project kept Sync's take without words: the report still has them.
  const older = syncTakeOf(synced, 'one — two');
  assert.deepEqual(knownWords(older, unit('1', 2, 3, { readWords }), RATE), [{ start: 0.1, end: 0.3 }, { start: 0.4, end: 0.7 }]);
  assert.equal(knownWords(take({}), undefined, RATE), null, 'a take with none has to be aligned');
  assert.deepEqual(sayWords('one — two'), ['one', 'two']);
});

test('a take is cut where its own sound is quietest between the words, when that is known', () => {
  const words = wordsAt(0.4, 0.3);
  // The quiet point after word 3 is early in the pause, not halfway.
  const cuts = [0.65, 1.35, 1.92, 2.75, 3.45];
  const fit = fitTakeToParts({ key: '1', oldParts: OLD_PARTS, oldWords: OLD_WORDS, newWords: words, takeSeconds: 4.6, cuts });
  assert.ok(fit);
  assert.ok(fit.parts[0].to <= 1.92 + 1e-9, `part 1 ends by the cut, at ${fit.parts[0].to}`);
  assert.ok(fit.parts[1].from >= 1.92 - 1e-9, `part 2 starts after it, at ${fit.parts[1].from}`);
});
