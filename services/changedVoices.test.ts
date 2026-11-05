import test from 'node:test';
import assert from 'node:assert/strict';
import { keptVoiceTakes, lineVoiceIds, linesOutOfVoice, takeIsIn, type ChangedVoices } from './changedVoices.ts';
import { syncTakeOf, type SyncTake, type SyncTakes } from './syncTakes.ts';
import type { SyncBank, SyncBankLine } from './syncEditModel.ts';
import type { SyncReport, SyncUnitReport } from './syncService.ts';

const line = (key: string, speaker = 'A', extra: Partial<SyncBankLine> = {}): SyncBankLine => ({
  key,
  speaker,
  bankStart: Number(key) * 1000,
  length: 1000,
  startSample: Number(key) * 2000,
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

const unit = (key: string, extra: Partial<SyncUnitReport> = {}) => ({ key, text: `line ${key}`, silent: false, ...extra }) as SyncUnitReport;

const bankOf = (lines: SyncBankLine[]): SyncBank => ({ bankId: 'b', sampleRate: 1000, float: false, lines, speakerGains: {} }) as SyncBank;
const reportOf = (units: SyncUnitReport[]) => ({ units }) as unknown as SyncReport;

const SETTINGS = { modelId: 'eleven_multilingual_sts_v2', voiceSettings: {}, removeBackgroundNoise: false } as any;
const VOICES: ChangedVoices = { A: { voiceId: 'new', name: 'Asha', settings: SETTINGS, over: 'tts' } };

const changedTake = (l: SyncBankLine, voiceId = 'new', voice = 'Asha'): SyncTake => ({
  ...syncTakeOf(l, `line ${l.key}`),
  id: `voice-${l.key}`,
  kind: 'line',
  bankStart: 9000 + Number(l.key),
  voice,
  voiceId,
});

test('a take is in a voice by its id, or by name for a take changed before ids were kept', () => {
  const l = line('1');
  assert.equal(takeIsIn(changedTake(l), VOICES.A), true);
  assert.equal(takeIsIn(changedTake(l, 'other', 'Asha'), VOICES.A), false);
  assert.equal(takeIsIn({ ...changedTake(l), voiceId: undefined }, VOICES.A), true);
  assert.equal(takeIsIn(syncTakeOf(l, 'line 1'), VOICES.A), false);
  assert.equal(takeIsIn(undefined, VOICES.A), false);
});

test('lines out of voice: a retake in the dub voice is, a changed line and other speakers are not', () => {
  const lines = [line('1'), line('2'), line('3', 'B'), line('4')];
  const bank = bankOf(lines);
  const report = reportOf([unit('1'), unit('2'), unit('3'), unit('4', { silent: true })]);
  const retake: SyncTake = { ...syncTakeOf(lines[1], 'line 2'), id: 'r1', kind: 'line', bankStart: 7000 };
  const takes: SyncTakes = {
    '1': { takes: [syncTakeOf(lines[0], 'line 1'), changedTake(lines[0])], active: 'voice-1' },
    '2': { takes: [syncTakeOf(lines[1], 'line 2'), changedTake(lines[1]), retake], active: 'r1' },
  };
  assert.deepEqual(
    linesOutOfVoice(bank, report, takes, VOICES).map((l) => l.key),
    ['2']
  );
  // After a Sync with no takes kept, every line of the speaker is out of voice but the silent one.
  assert.deepEqual(
    linesOutOfVoice(bank, report, null, VOICES).map((l) => l.key),
    ['1', '2']
  );
});

test('the voice of each line in the dub, for the voice changer to skip', () => {
  const lines = [line('1'), line('2')];
  const takes: SyncTakes = {
    '1': { takes: [syncTakeOf(lines[0], 'line 1'), changedTake(lines[0])], active: 'voice-1' },
    '2': { takes: [syncTakeOf(lines[1], 'line 2'), changedTake(lines[1])], active: 'sync' },
  };
  assert.deepEqual(lineVoiceIds(bankOf(lines), takes), { '1': 'new' });
  assert.deepEqual(lineVoiceIds(bankOf(lines), null), {});
});

test('after a Sync, lines kept as a voice-changed take keep it as their take; voiced-again lines do not', () => {
  const prior = [line('1'), line('2')];
  const priorTakes: SyncTakes = {
    '1': { takes: [syncTakeOf(prior[0], 'line 1'), changedTake(prior[0])], active: 'voice-1' },
    '2': { takes: [syncTakeOf(prior[1], 'line 2'), changedTake(prior[1])], active: 'voice-2' },
  };
  // The new bank: line 1 kept (picked) at new samples, line 2 voiced again (pending).
  const next = [line('1', 'A', { bankStart: 50 }), line('2', 'A', { bankStart: 1050 })];
  const report = reportOf([unit('1', { picked: true }), unit('2', { picked: false })]);
  const kept = keptVoiceTakes(bankOf(next), report, priorTakes)!;
  assert.deepEqual(Object.keys(kept), ['1']);
  const take = kept['1'].takes[0];
  assert.equal(kept['1'].active, take.id);
  assert.equal(take.kind, 'line');
  assert.equal(take.bankStart, 50);
  assert.equal(take.voiceId, 'new');
  assert.equal(take.voice, 'Asha');
  // Kept as a picked take, so the line stays in voice and line 2 is the one to change.
  assert.deepEqual(
    linesOutOfVoice(bankOf(next), report, kept, VOICES).map((l) => l.key),
    ['2']
  );
  assert.equal(keptVoiceTakes(bankOf(next), report, null), null);
});
