import test from 'node:test';
import assert from 'node:assert/strict';
import { placeClips } from './syncPlace.js';
import { runSync, clearClipCache, clipHash } from './syncDub.js';
import { prepareClip, shortenPauses, removeBreaths } from './syncRender.js';
import { buildSyncUnits } from './syncUnits.js';
import { previewSync } from './syncPreview.js';
import { fitJoinSettings } from './syncFit.js';
import { validateAlignedWords, measureWordTiming } from './syncWordTiming.js';

const RATE = 8000;
const cue = (id, startTime, endTime, textTarget, speaker = 'A') => ({ id, startTime, endTime, textTarget, speaker });
const tone = (seconds = 1, pause = 0) => {
  const out = new Float32Array(Math.round((seconds + pause + 0.4) * RATE));
  for (let i = Math.round(0.2 * RATE); i < out.length - Math.round(0.2 * RATE); i++) {
    const t = i / RATE - 0.2;
    if (t >= seconds / 2 && t < seconds / 2 + pause) continue;
    out[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / RATE);
  }
  return out;
};
const run = (segments, params = {}, extra = {}, audio = tone()) => {
  clearClipCache();
  return runSync({ segments, sampleRate: RATE, sourceDuration: 10, voice: { voiceId: 'v', modelId: 'm' }, suggest: false, suggestLonger: false, ...params }, {
    voiceLines: async (lines, { onLine }) => lines.map((_, i) => { onLine(i + 1); return audio; }),
    decode: async (samples) => samples,
    encode: async (samples) => ({ buffer: Buffer.from(samples.buffer), contentType: 'audio/test' }),
    ...extra,
  });
};

test('bounded placement keeps exact locks and shares remaining movement around them', () => {
  const clips = [{ want: 0, length: 1, gapAfter: 0 }, { want: 2, length: 1, gapAfter: 0, fixed: true }, { want: 2.5, length: 1, gapAfter: 0, latest: 4 }];
  assert.deepEqual(placeClips(clips), [0, 2, 3]);
  assert.deepEqual(placeClips([{ want: 3, length: 1, gapAfter: 0, floor: -10, latest: 2 }, { want: 1, length: 1, gapAfter: 0, floor: -10, latest: 4 }]), [1.5, 2.5]);
});

test('a lock that can not be held is moved only as far as the lines before it need, and flagged', () => {
  const conflicts = [];
  assert.deepEqual(placeClips([{ want: 1, length: 3, gapAfter: 0, fixed: true }, { want: 2, length: 1, gapAfter: 0, fixed: true }], { conflicts }), [1, 4]);
  assert.deepEqual(conflicts, [1]);
});

test('an impossible latest start places the line as early as it can go, and flags it', () => {
  const conflicts = [];
  const positions = placeClips([{ want: 0, length: 4, gapAfter: 0, earliest: 0, latest: 0.1 }, { want: 2, length: 1, gapAfter: 0, earliest: 1.9, latest: 2.1 }], { conflicts });
  assert.deepEqual(positions, [0, 4]);
  assert.deepEqual(conflicts, [1]);
});

test('Strict Sync still makes an impossible dub and flags the late line', async () => {
  const segments = [cue(1, 1, 2, 'one.'), cue(2, 2.1, 3.1, 'two.')];
  const warn = await run(segments, { join: { unitGap: 0 } }, {}, tone(3));
  assert.ok(warn.report.summary.late > 0);
  assert.equal(warn.report.summary.timingConflicts, 0, 'Warn reports late lines, not conflicts');
  const strict = await run(segments, { timingProtection: 'strict', join: { unitGap: 0 } }, {}, tone(3));
  assert.ok(strict.buffer, 'the dub is made');
  assert.ok(strict.report.summary.timingConflicts > 0);
  assert.match(strict.report.units[1].timingConflict, /Strict limit|timing limit/);
});

test('a fitting Strict dub meets the start limit and is reported as Strict', async () => {
  const result = await run([cue(1, 1, 2, 'one.'), cue(2, 4, 5, 'two.')], { timingProtection: 'strict' });
  assert.equal(result.report.timingProtection, 'strict');
  assert.equal(result.report.summary.late, 0);
});

test('long-pause protection blocks grouping and pause borrowing in preview and Sync', async () => {
  const segments = [cue(1, 1, 2, 'one'), cue(2, 2.8, 4, 'two.')];
  const join = { preserveLongPauses: true, protectedPause: 0.5 };
  assert.equal(buildSyncUnits(segments).length, 1, 'open sentence normally joins');
  assert.equal(buildSyncUnits(segments, join).length, 2);
  assert.equal(previewSync({ segments, join, charsPerSecond: 10 }).units[0].slot, 1);
  const protectedRun = await run(segments, { join }, {}, tone(2));
  assert.ok(protectedRun.buffer, 'a line that runs into a protected pause is flagged, not refused');
  assert.match(protectedRun.report.units[0].timingConflict, /timing limit/);
  assert.equal(protectedRun.report.units[1].timingConflict, null);
});

test('pause shortening preserves long internal silence and can still trim shorter pauses', () => {
  const audio = tone(1, 1.5);
  assert.equal(shortenPauses(audio, RATE, 1, { protectAbove: 1 }).removed, 0);
  assert.ok(shortenPauses(audio, RATE, 1).removed > 0.9);
  assert.ok(shortenPauses(tone(1, 0.6), RATE, 0.3, { protectAbove: 1 }).removed > 0.25);
});

test('actual word alignment replaces acoustic onset estimates and reports internal boundaries', async () => {
  const segments = [cue(1, 1, 1.4, 'one'), cue(2, 1.5, 2, 'two.')];
  const result = await run(segments, { verifyWords: true }, { align: async () => ({ words: [
    { text: 'one', start: 0.02, end: 0.3 }, { text: 'two.', start: 0.8, end: 0.98 },
  ] }) });
  const timing = result.report.units[0].wordTiming;
  assert.equal(timing.status, 'measured');
  assert.ok(Math.abs(timing.startError) < 0.001);
  assert.ok(timing.boundaryMaxError > 0.2);
  assert.equal(result.report.summary.boundaryMismatches, 1);
  assert.equal(timing.words.length, 2);
});

test('alignment failure stays explicit without failing or falsely verifying the dub', async () => {
  const result = await run([cue(1, 1, 2, 'one.')], { verifyWords: true }, { align: async () => { throw new Error('Alignment service unavailable'); } });
  assert.equal(result.report.summary.wordTimingMeasured, 0);
  assert.equal(result.report.summary.wordTimingUnavailable, 1);
  assert.match(result.report.units[0].wordTiming.reason, /unavailable/);
  const off = await run([cue(1, 1, 2, 'one.')], {}, { align: () => assert.fail('verification is opt-in') });
  assert.equal(off.report.units[0].wordTiming, undefined);
});

test('cancellation during alignment cancels Sync', async () => {
  clearClipCache();
  const controller = new AbortController();
  await assert.rejects(runSync({ segments: [cue(1, 1, 2, 'one.')], sampleRate: RATE, voice: { voiceId: 'cancel' }, verifyWords: true }, {
    voiceLines: async () => [tone()], decode: async (audio) => audio,
    encode: () => assert.fail('a cancelled run must not encode'),
    align: async () => { controller.abort(); throw new Error('aborted'); },
  }, { signal: controller.signal }), /cancel/i);
});

test('invalid, out-of-order and incomplete aligned words are rejected', () => {
  assert.throws(() => validateAlignedWords([], 'one', 1));
  assert.throws(() => validateAlignedWords([{ text: 'one', start: 0, end: 2 }], 'one', 1));
  assert.throws(() => validateAlignedWords([{ text: 'two', start: 0, end: 0.5 }], 'one', 1));
  assert.throws(() => validateAlignedWords([{ text: 'one', start: 0.5, end: 0.8 }, { text: 'two', start: 0.2, end: 0.4 }], 'one two', 1));
});

test('translated cue boundaries use script coverage and source word timings', () => {
  const cues = [{ ...cue(1, 2, 3, 'আমি'), words: [{ start: 2.2, end: 2.8 }] }, cue(2, 3, 4, 'যাই।')];
  const words = [{ text: 'আমি', start: 0.1, end: 0.6 }, { text: 'যাই।', start: 0.9, end: 1.6 }];
  validateAlignedWords(words, 'আমি যাই।', 2);
  const result = measureWordTiming(words, { srcStart: 2, srcEnd: 4 }, cues, 2.1, 0.15);
  assert.ok(Math.abs(result.anchors[0].startError) < 1e-9);
  assert.equal(result.anchors[1].cueId, '2');
  const single = measureWordTiming(words, { srcStart: 2, srcEnd: 4 }, [cue(1, 2, 4, 'আমি যাই।')], 2, 0.15);
  assert.equal(single.boundaryMaxError, null, 'no fabricated word correspondence across languages');
});

test('Fit uses sufficiently sampled speaker rates and reports mixed estimates', () => {
  const segments = Array.from({ length: 10 }, (_, i) => cue(i, i * 3, i * 3 + 1, 'abcdefghij.', i < 5 ? 'A' : 'B'));
  const result = fitJoinSettings({ segments, charsPerSecond: 10, speakerRates: { A: { charsPerSecond: 20, lines: 5 }, B: { charsPerSecond: 5, lines: 2 } } });
  assert.equal(result.measured.measuredLines, 5);
  assert.equal(result.measured.estimatedLines, 5);
  assert.equal(result.measured.rateBasis, 'mixed');
});

test('a locked line crossing a protected source pause is kept where it is, and flagged', async () => {
  const audio = tone();
  const prepared = prepareClip(removeBreaths(audio, RATE).samples, RATE, { tailQuiet: 10 ** (-70 / 20), tailHold: 0.04 });
  const result = await run([cue(1, 1, 2, 'one.'), cue(2, 5, 6, 'two.')], {
    join: { preserveLongPauses: true }, locked: { '1': { hash: clipHash(prepared.samples), cuts: [], start: 1, end: 3 } },
  }, {}, audio);
  assert.match(result.report.units[0].timingConflict, /protected pause/);
  assert.equal(result.bank.lines[0].startSample, RATE, 'the lock is held at 1 s');
  assert.equal(result.report.summary.timingConflicts, 1);
});
