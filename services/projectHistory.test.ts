import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeProjectChange,
  epochsIn,
  fromReviewHistory,
  HISTORY_STEP_LIMIT,
  historyEntries,
  historyLabels,
  keepRecentSyncs,
  moveTo,
  recordProjectStep,
  stateAt,
  type HistoryState,
} from './projectHistory.ts';
import type { AudioSegment } from '../types';
import type { SyncBank, SyncBankLine } from './syncEditModel.ts';
import type { SyncReport } from './syncService.ts';
import type { SyncTake } from './syncTakes.ts';

const cue = (id: string, text: string, extra: Partial<AudioSegment> = {}): AudioSegment =>
  ({ id, startTime: 0, endTime: 1, duration: 1, textSource: '', textTarget: text, ...extra }) as AudioSegment;

const line = (key: string, bankStart: number, hash = `h${key}`): SyncBankLine =>
  ({ key, speaker: 'Speaker', bankStart, length: 10, startSample: 0, lead: 0, speech: 0.5, gain: 1, hash, cuts: [], crossfade: 0, dropped: 0, locked: false }) as SyncBankLine;

const bankOf = (lines: SyncBankLine[], bankId = 'b1'): SyncBank => ({ bankId, sampleRate: 1000, float: false, lines, speakerGains: {} });

const reportOf = (keys: string[]): SyncReport => ({ tolerance: 0.15, units: keys.map((key) => ({ key, text: `t${key}` })), summary: { lines: keys.length } }) as unknown as SyncReport;

const take = (id: string, bankStart: number, extra: Partial<SyncTake> = {}): SyncTake => ({
  id,
  kind: id === 'sync' ? 'sync' : 'line',
  bankStart,
  length: 10,
  lead: 0,
  speech: 0.5,
  gain: 1,
  hash: id,
  cutOff: false,
  cuts: [],
  crossfade: 0,
  dropped: 0,
  text: 't1',
  ...extra,
});

const synced = (epoch: string, extra: Partial<HistoryState> = {}): HistoryState => ({
  segments: [cue('1', 'one'), cue('2', 'two')],
  syncEpoch: epoch,
  syncBank: bankOf([line('1', 0), line('2', 10)]),
  syncBaseReport: reportOf(['1', '2']),
  syncEdits: null,
  syncTakes: null,
  ...extra,
});

test('every change is a step: undo and redo put the script and the dub back exactly', () => {
  const s0 = synced('e1');
  const s1: HistoryState = { ...s0, syncTakes: { '1': { takes: [take('sync', 0), take('t1', 20)], active: 'sync' } } };
  const s2: HistoryState = { ...s1, syncTakes: { '1': { takes: s1.syncTakes!['1'].takes, active: 't1' } }, syncBank: bankOf([line('1', 20, 't1'), line('2', 10)], 'b2') };
  const s3: HistoryState = { ...s2, segments: [cue('1', 'one!'), s2.segments![1]] };
  let h = recordProjectStep(null, s0, s1, { label: 'New take of line 1' });
  h = recordProjectStep(h, s1, s2, { label: 'Line 1: Take 1 in the dub' });
  h = recordProjectStep(h, s2, s3, { label: 'Edit line 1' });
  assert.deepEqual(historyEntries(h).map((e) => e.label), ['Before your first change', 'New take of line 1', 'Line 1: Take 1 in the dub', 'Edit line 1']);
  assert.deepEqual(historyLabels(h), { undo: 'Edit line 1', redo: null });

  const back = moveTo(h, 1)!;
  const { state, scriptOnly } = stateAt(back);
  assert.equal(scriptOnly, false);
  assert.deepEqual(state.syncTakes, s1.syncTakes);
  assert.deepEqual(state.segments, s1.segments);
  // The bank is put back without its id: the app gives it the id the server holds its samples under.
  assert.deepEqual({ ...state.syncBank, bankId: 'b1' }, s1.syncBank);
  assert.equal(state.syncBank?.bankId, undefined);
  assert.deepEqual(historyLabels(back), { undo: 'New take of line 1', redo: 'Line 1: Take 1 in the dub' });
  assert.deepEqual(stateAt(moveTo(back, 3)!).state.segments, s3.segments);
  assert.equal(moveTo(h, 3), null, 'already there');
  assert.equal(moveTo(h, 9), null);
});

test('a new change after undo drops the steps undone; one the history missed becomes "Other changes"', () => {
  const s0 = synced('e1');
  const s1 = { ...s0, segments: [cue('1', 'a'), s0.segments![1]] };
  const s2 = { ...s0, segments: [cue('1', 'b'), s0.segments![1]] };
  let h = recordProjectStep(null, s0, s1, { label: 'Edit line 1' });
  h = moveTo(h, 0)!;
  h = recordProjectStep(h, s0, s2, { label: 'Edit line 1 again' });
  assert.deepEqual(historyEntries(h).map((e) => e.label), ['Before your first change', 'Edit line 1 again']);
  const elsewhere = { ...s2, syncEdits: { '2': { locked: true, parts: [] } } };
  const s3 = { ...elsewhere, syncMarkers: [] };
  h = recordProjectStep(h, elsewhere, s3, { label: 'Markers' });
  assert.deepEqual(historyEntries(h).map((e) => e.label), ['Before your first change', 'Edit line 1 again', 'Other changes', 'Markers']);
  assert.deepEqual(stateAt(h, 2).state.syncEdits, elsewhere.syncEdits);
});

test('changes with the same key close together are one step, apart they are two', () => {
  const s0 = synced('e1');
  const at = (text: string) => ({ ...s0, segments: [cue('1', text), s0.segments![1]] });
  let h = recordProjectStep(null, s0, at('o'), { label: 'Edit line 1', key: 'text:1', now: 1000 });
  h = recordProjectStep(h, at('o'), at('on'), { label: 'Edit line 1', key: 'text:1', now: 1500 });
  h = recordProjectStep(h, at('on'), at('one'), { label: 'Edit line 1', key: 'text:1', now: 5000 });
  assert.equal(h.steps.length, 3);
  assert.equal((stateAt(h, 1).state.segments![0] as AudioSegment).textTarget, 'on');
});

test('a thousand steps keep the first one, and the pool holds each version once', () => {
  let state = synced('e1');
  let h = recordProjectStep(null, state, state, { label: 'nothing' });
  for (let n = 0; n < HISTORY_STEP_LIMIT + 20; n++) {
    const next = { ...state, segments: [cue('1', `v${n}`), state.segments![1]] };
    h = recordProjectStep(h, state, next, { label: `Edit ${n}` });
    state = next;
  }
  assert.equal(h.steps.length, HISTORY_STEP_LIMIT);
  assert.equal(h.steps[0].label, 'Before your first change');
  assert.equal(h.steps.at(-1)!.label, `Edit ${HISTORY_STEP_LIMIT + 19}`);
  // Two cues per step, but the second is the same cue every time: about one new value per step.
  assert.ok(h.pool.length < HISTORY_STEP_LIMIT * 1.5 + 300, `pool ${h.pool.length}`);
  assert.deepEqual(stateAt(h, 0).state.segments, synced('e1').segments);
});

test('the Syncs before the last three keep only their script', () => {
  let state = synced('e1');
  let h = recordProjectStep(null, state, { ...state, syncMarkers: [] }, { label: 'Markers' });
  state = { ...state, syncMarkers: [] };
  for (const epoch of ['e2', 'e3', 'e4', 'e5']) {
    const next = { ...synced(epoch), syncMarkers: [] };
    h = recordProjectStep(h, state, next, { label: 'Sync again' });
    state = next;
  }
  assert.deepEqual(epochsIn(h), ['e1', 'e2', 'e3', 'e4', 'e5']);
  const kept = keepRecentSyncs(h, 'e5');
  assert.deepEqual(kept.dropped, ['e1']);
  assert.deepEqual(epochsIn(kept.history), ['e2', 'e3', 'e4', 'e5']);
  const old = stateAt(kept.history, 0);
  assert.equal(old.scriptOnly, true);
  assert.deepEqual(old.state, { segments: synced('e1').segments });
  assert.equal(historyEntries(kept.history)[0].scriptOnly, true);
  assert.equal(keepRecentSyncs(kept.history, 'e5').dropped.length, 0);
});

test("a project with only Review's history keeps its steps as script steps", () => {
  const a = [cue('1', 'x'), cue('2', 'y')];
  const b = [cue('1', 'x2'), a[1]];
  const review = { pool: [...a, b[0]], steps: [{ cues: [0, 1], label: 'the AI translation', time: 1 }, { cues: [2, 1], label: 'Edit line 1', time: 2 }], at: 1 };
  const h = fromReviewHistory(review, synced('e1', { segments: b }));
  assert.deepEqual(historyEntries(h).map((e) => [e.label, e.scriptOnly]), [['the AI translation', true], ['Edit line 1', false]]);
  assert.deepEqual(stateAt(h, 0).state.segments, a);
  assert.equal(stateAt(h, 1).state.syncEpoch, 'e1');
});

test('a change is named by what it did', () => {
  const s0 = synced('e1');
  assert.equal(describeProjectChange(s0, { ...s0 }), null);
  assert.equal(describeProjectChange(s0, synced('e2'))?.label, 'Sync again');
  assert.equal(describeProjectChange({ ...s0, syncBank: null, syncEpoch: null }, s0)?.label, 'Sync');
  const listed = { ...s0, syncTakes: { '2': { takes: [take('sync', 10), take('t1', 30)], active: 'sync' } } };
  assert.equal(describeProjectChange(s0, listed)?.label, 'New take of line 2');
  const picked = { ...listed, syncTakes: { '2': { takes: listed.syncTakes['2'].takes, active: 't1' } } };
  assert.equal(describeProjectChange(listed, picked)?.label, 'Line 2: Take 1 in the dub');
  const voiced = { ...picked, syncTakes: { '2': { takes: [...picked.syncTakes['2'].takes, take('voice-1', 40, { voiceId: 'v' })], active: 'voice-1' } } };
  assert.equal(describeProjectChange(picked, voiced)?.label, 'Voice change on line 2');
  const placed = { ...s0, segments: [s0.segments![0], cue('2', 'two', { dubPlace: { start: 3 } as AudioSegment['dubPlace'] })] };
  assert.deepEqual(describeProjectChange(s0, placed), { label: 'Move line 2 on the dub lane', key: 'place:2' });
  assert.deepEqual(describeProjectChange(s0, { ...s0, segments: [cue('1', 'uno'), s0.segments![1]] }), { label: 'Edit line 1', key: 'text:1' });
  assert.equal(describeProjectChange(s0, { ...s0, syncLineSeeds: { '1': 5 } })?.label, 'Retake line 1 at the next Sync');
  assert.equal(describeProjectChange(s0, { ...s0, syncEdits: { '1': { locked: true, parts: [] } } })?.label, 'Edit timing');
  assert.deepEqual(describeProjectChange(s0, { ...s0, syncSpeakerLevels: { Speaker: -2 } }), { label: 'Speaker level', key: 'levels' });
});
