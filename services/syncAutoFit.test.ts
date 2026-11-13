import test from 'node:test';
import assert from 'node:assert/strict';
import { autoFitForSync, canUndoAutoFit, GROUPING_KEYS, isOwnCustom, refitRequestFor, refittedOptions, regroupCost, REVOICE_KEYS, undoAutoFit, withRefit, type AutoFitRequest } from './syncAutoFit.ts';
import { presetForRatio, syncJoinPreset } from './syncPresets.ts';
import { LENGTH_BANDS, lengthBandFor } from '../server/lib/lengthBands.js';
import { fitJoinSettings as serverFit } from '../server/lib/syncFit.js';
import { previewSync as serverPreview } from '../server/lib/syncPreview.js';
import type { SyncFit, SyncOptions, SyncPreview } from './syncService';

// The server's plain-JS Fit and preview, typed as the app's calls to them are.
const fitJoinSettings = serverFit as unknown as (body: object) => SyncFit;
const previewSync = serverPreview as unknown as (body: object) => SyncPreview;
import type { AudioSegment } from '../types';

/** `count` cues of one speaker, each spoken for 0.9 s in two words, `pause` apart, each `chars` characters long. */
const cues = (count: number, chars: number, pause = 0.6): AudioSegment[] => {
  let t = 0;
  return Array.from({ length: count }, (_, n) => {
    const start = t;
    t += 0.9 + pause;
    return {
      id: n + 1,
      startTime: start,
      endTime: start + 0.9,
      speaker: 'A',
      textTarget: 'x'.repeat(chars),
      words: [
        { text: 'a', start, end: start + 0.4 },
        { text: 'b', start: start + 0.5, end: start + 0.9 },
      ],
    } as unknown as AudioSegment;
  });
};

const options = (over: Partial<SyncOptions> = {}): SyncOptions => ({
  verifyWords: false,
  timingProtection: 'warn',
  voicing: 'lines',
  precision: 'phrase',
  preset: 'natural',
  screen: 'any',
  join: syncJoinPreset('natural'),
  suggest: false,
  suggestLonger: false,
  matchLoudness: false,
  ...over,
});

/** A request served by the server's own Fit and preview, as the app's calls are; the voice reads 10 characters a second. */
const request = (segments: AudioSegment[], over: Partial<AutoFitRequest> = {}): AutoFitRequest => ({
  options: options(),
  segments,
  source: { charsPerSecond: 10, rateMeasured: true },
  voicedBefore: false,
  fit: async (body) => fitJoinSettings(body),
  preview: async (join) => previewSync({ segments, precision: 'phrase', charsPerSecond: 10, join }),
  ...over,
});

test('one table of bands: Short < 0.95, Natural to 1.05, Long to 1.15, Very long beyond', () => {
  assert.deepEqual(LENGTH_BANDS.map((band) => [band.preset, band.below]), [['short', 0.95], ['natural', 1.05], ['long', 1.15], ['vlong', Infinity]]);
  const ratios = [0.8, 0.949, 0.95, 1, 1.049, 1.05, 1.06, 1.149, 1.15, 1.6];
  assert.deepEqual(ratios.map(lengthBandFor), ['short', 'short', 'natural', 'natural', 'natural', 'long', 'long', 'long', 'vlong', 'vlong']);
  // The suggestion after a sync reads the same table.
  assert.deepEqual(ratios.map(presetForRatio), ratios.map(lengthBandFor));
});

test('Fit and the preset agree: a dub 6% long gets Long from both', () => {
  // 9.5 characters a line at 10 a second: 0.954 s over 0.9 s spoken, about 6% longer.
  const segments = cues(10, 10).map((cue) => ({ ...cue, endTime: cue.startTime + 0.943, words: [{ text: 'a', start: cue.startTime, end: cue.startTime + 0.4 }, { text: 'b', start: cue.startTime + 0.5, end: cue.startTime + 0.943 }] })) as AudioSegment[];
  const fit = fitJoinSettings({ segments, join: syncJoinPreset('natural'), charsPerSecond: 10, rateMeasured: true });
  const ratio = fit.measured.lengthRatio!;
  assert.ok(ratio > 1.05 && ratio < 1.08, `ratio ${ratio}`);
  assert.equal(presetForRatio(ratio), 'long');
  // Before one table, Fit only acted from 8% longer.
  assert.equal(fit.join.maxPauseTake, 0.5);
});

test('Sync picks the length preset and applies Fit when the preview has no fewer cues in sync', async () => {
  // 11 characters at 10 a second over 0.9 s spoken: about 22% longer, Very long.
  const segments = cues(12, 11);
  const result = (await autoFitForSync(request(segments)))!;
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.outcome.presetTo, 'vlong');
  assert.equal(result.outcome.changes[0].key, 'preset');
  assert.ok(result.outcome.changes.every((change) => change.reason));
  assert.ok(result.outcome.inSync!.after >= result.outcome.inSync!.before);
  assert.deepEqual(result.options.fitted?.join, result.options.join);
  assert.equal(result.options.fitted?.preset, 'vlong');
  // Fit's settings sit on top of the preset, and Fit's own Very long move is in.
  assert.equal(result.options.join.gapShare, 0.25);
  assert.equal(result.options.join.endByVideo, true);
  // Only settings: the words stay.
  assert.deepEqual(segments.map((s) => s.textTarget), cues(12, 11).map((s) => s.textTarget));
});

test("settings that voice lines again are never changed by Sync's own fit", async () => {
  const join = { ...syncJoinPreset('natural'), speedFit: 'auto' as const, maxVoiceSpeed: 1.1, bestTakes: 'ask' as const, maxRevoice: 5 };
  const own = options({ preset: 'custom', join, fitted: { preset: 'natural', join } });
  const result = (await autoFitForSync({ ...request(cues(12, 11)), options: own }))!;
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.outcome.presetTo, 'vlong');
  for (const key of REVOICE_KEYS) assert.equal(result.options.join[key], join[key], key);
  assert.ok(result.outcome.changes.every((change) => !(REVOICE_KEYS as readonly string[]).includes(change.key)));
});

test('a proposal the preview judges worse is not applied', async () => {
  const segments = cues(12, 11);
  const req = request(segments);
  let calls = 0;
  const result = (await autoFitForSync({
    ...req,
    // The settings as they are: all in sync; the proposal: every line long.
    preview: async (join) => {
      const preview = previewSync({ segments, precision: 'phrase', charsPerSecond: 10, join });
      return calls++ === 0 ? { units: preview.units.map((u) => ({ ...u, status: 'fits' as const })) } : { units: preview.units.map((u) => ({ ...u, status: 'long' as const })) };
    },
  }))!;
  assert.equal(result.outcome.status, 'kept');
  assert.match(result.outcome.keptBecause!, /cues in sync/);
  assert.equal(result.options, req.options);
  assert.ok(result.outcome.changes.length > 0, 'what it would have changed is still listed');
});

test("the user's own Custom settings are never touched", async () => {
  const join = { ...syncJoinPreset('natural'), minGap: 0.22 };
  let fitted = 0;
  const own = options({ preset: 'custom', join });
  const result = (await autoFitForSync({ ...request(cues(12, 11)), options: own, fit: async (body) => (fitted++, fitJoinSettings(body)) }))!;
  assert.equal(result.outcome.status, 'custom');
  assert.equal(result.options, own);
  assert.equal(fitted, 0, 'not even measured');
  assert.ok(isOwnCustom(own));
});

test("Fit's own Custom is fitted again; once the user changes a value it is theirs", async () => {
  const first = (await autoFitForSync(request(cues(12, 11))))!;
  assert.equal(first.options.preset, 'custom');
  assert.equal(isOwnCustom(first.options), false);
  const again = (await autoFitForSync({ ...request(cues(12, 11)), options: first.options }))!;
  assert.equal(again.outcome.status, 'fits');
  const edited = { ...first.options, join: { ...first.options.join, minGap: 0.2 } };
  assert.ok(isOwnCustom(edited));
});

test('grouping is frozen on a sync after lines were voiced, and offered with what it would voice again', async () => {
  // Cues 0.35 s apart: Natural (0.4 s) voices them together, the speaker's own pauses (0.25 s) would split them.
  const segments = cues(12, 11, 0.35);
  const resync = (await autoFitForSync(request(segments, { voicedBefore: true })))!;
  for (const key of GROUPING_KEYS) assert.equal(resync.options.join[key], options().join[key], key);
  assert.ok(resync.outcome.grouping, 'grouping offered');
  assert.ok(resync.outcome.grouping!.characters > 0);
  assert.ok(resync.outcome.grouping!.lines > 0);
  assert.notEqual(resync.outcome.grouping!.options.join.unitGap, options().join.unitGap);

  const first = (await autoFitForSync(request(segments)))!;
  assert.notEqual(first.options.join.unitGap, options().join.unitGap);
  assert.equal(first.outcome.grouping, null);
  assert.ok(first.outcome.undoRevoices!.characters > 0, 'Undo says it would voice lines again');

  const scratch = (await autoFitForSync(request(segments, { voicedBefore: true, fresh: true })))!;
  assert.notEqual(scratch.options.join.unitGap, options().join.unitGap);
});

test('on a sync after voicing, grouping values that make the same lines go in: nothing is voiced anew', async () => {
  // Cues 0.6 s apart: grouped alone at 400 ms and at 250 ms alike.
  const result = (await autoFitForSync(request(cues(12, 11, 0.6), { voicedBefore: true })))!;
  assert.equal(result.outcome.status, 'applied');
  assert.equal(result.options.join.unitGap, 0.25);
  assert.equal(result.outcome.grouping, null);
});

test('regroupCost counts only the lines a new grouping makes', () => {
  const segments = cues(6, 10, 0.35);
  const natural = syncJoinPreset('natural');
  assert.deepEqual(regroupCost(segments, natural, natural), { lines: 0, characters: 0 });
  const split = regroupCost(segments, natural, { ...natural, unitGap: 0.25 });
  assert.deepEqual(split, { lines: 6, characters: 60 });
});

test('Undo puts the settings back, and the next Sync does not apply the same changes again', async () => {
  const segments = cues(12, 11);
  const applied = (await autoFitForSync(request(segments)))!;
  assert.ok(canUndoAutoFit(applied.options, applied.outcome));
  const undone = undoAutoFit(applied.options, applied.outcome);
  assert.equal(undone.preset, 'natural');
  assert.deepEqual(undone.join, options().join);
  assert.equal(canUndoAutoFit(undone, applied.outcome), false);
  const next = (await autoFitForSync({ ...request(segments), options: undone }))!;
  assert.equal(next.outcome.status, 'kept');
  assert.match(next.outcome.keptBecause!, /undid/);
  assert.equal(next.options, undone);
});

test('a typical rate never switches the length preset', async () => {
  const result = (await autoFitForSync(request(cues(12, 11), { source: { charsPerSecond: 10, rateMeasured: false } })))!;
  assert.equal(result.outcome.presetTo, 'natural');
  assert.equal(result.outcome.ratio, null);
  assert.ok(result.outcome.changes.every((change) => change.key !== 'preset' && change.key !== 'maxPauseTake'));
});

test('a length picked by hand stays: Fit tunes gaps and pauses on it, never the length', async () => {
  // 11 characters at 10 a second over 0.9 s spoken: about 22% longer, which Auto makes Very long.
  const picked = options({ preset: 'long', join: syncJoinPreset('long'), lengthAuto: false });
  const result = (await autoFitForSync(request(cues(12, 11), { options: picked })))!;
  assert.equal(result.outcome.presetTo, 'long');
  assert.ok(result.outcome.changes.every((change) => change.key !== 'preset'));
  assert.ok(result.outcome.ratio! > 1.15, 'the length is still measured and shown');
  assert.equal(result.options.fitted?.preset ?? result.options.preset, 'long');
  assert.notEqual(result.options.join.maxVoiceSpeed, syncJoinPreset('vlong').maxVoiceSpeed);
  // Nor is the length swapped after voicing.
  assert.equal(await refitRequestFor(picked, request(cues(12, 11))), null);
  // Auto (the default, and lengthAuto: true) picks it.
  const auto = (await autoFitForSync(request(cues(12, 11), { options: { ...picked, lengthAuto: true } })))!;
  assert.equal(auto.outcome.presetTo, 'vlong');
});

test('turned off, Sync runs with the settings as they are', async () => {
  assert.equal(await autoFitForSync(request(cues(12, 11), { options: options({ fitOnSync: false }) })), null);
});

test('a failed measurement never stops the sync', async () => {
  const req = request(cues(12, 11), { fit: async () => { throw new Error('offline'); } });
  const result = (await autoFitForSync(req))!;
  assert.equal(result.outcome.status, 'error');
  assert.equal(result.options, req.options);
});

test('a sample read alone never makes a dub Short before it is voiced; a rate from a sync may', async () => {
  // 7 characters at 10 a second over 0.9 s said: about 22% shorter.
  const sampled = (await autoFitForSync(request(cues(12, 7), { source: { charsPerSecond: 10, rateMeasured: true, rateSample: true } })))!;
  assert.equal(sampled.outcome.presetTo, 'natural');
  assert.notEqual(sampled.options.join.chunkGapShare, syncJoinPreset('short').chunkGapShare);
  const synced = (await autoFitForSync(request(cues(12, 7), { source: { charsPerSecond: 10, rateMeasured: true } })))!;
  assert.equal(synced.outcome.presetTo, 'short');
});

test("Sync sends each band its settings for after voicing, never for the user's own Custom", async () => {
  const segments = cues(12, 11);
  const req = request(segments);
  const refit = (await refitRequestFor(options(), req))!;
  assert.equal(refit.from, 'natural');
  assert.deepEqual(Object.keys(refit.candidates).sort(), ['long', 'natural', 'short', 'vlong']);
  assert.equal(refit.candidates.short!.chunkGapShare, syncJoinPreset('short').chunkGapShare);
  assert.equal(await refitRequestFor(options({ preset: 'custom', join: { ...syncJoinPreset('natural'), minGap: 0.22 } }), req), null);
  assert.equal(await refitRequestFor(options({ fitOnSync: false }), req), null);
});

test('settings swapped after voicing are kept for the next Sync, shown in the panel, and undone together', async () => {
  const segments = cues(12, 9);
  const pressed = (await autoFitForSync(request(segments, { options: options({ preset: 'short', join: syncJoinPreset('short') }) })))!;
  const natural = { ...syncJoinPreset('natural'), minGap: 0.3 };
  const report = { join: natural, refit: { status: 'applied' as const, from: 'short', to: 'natural', ratio: 0.99, inSync: { before: 5, after: 9 } } };

  const kept = refittedOptions(pressed.options, report)!;
  assert.equal(kept.join, natural);
  assert.equal(kept.fitted?.preset, 'natural');
  assert.equal(isOwnCustom(kept), false);
  assert.equal(refittedOptions(pressed.options, { join: natural, refit: { ...report.refit, status: 'same' } }), null);

  const outcome = withRefit(pressed.outcome, report);
  assert.equal(outcome.status, 'applied');
  assert.deepEqual(outcome.afterVoicing, { from: 'short', to: 'natural', ratio: 0.99 });
  assert.deepEqual(outcome.changes.find((c) => c.key === 'preset'), { key: 'preset', from: 'short', to: 'natural', reason: outcome.changes[0].reason, by: 'preset' });
  assert.match(outcome.changes[0].reason, /once voiced/);
  assert.ok(canUndoAutoFit(kept, outcome));
  const undone = undoAutoFit(kept, outcome);
  assert.equal(undone.preset, 'short');
  assert.deepEqual(undone.join, syncJoinPreset('short'));
});
