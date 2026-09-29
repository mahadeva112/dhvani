import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncUnits, minimumGap, HARD_ANCHOR_GAP_SECONDS } from './syncUnits.js';
import { pava, placeClips, measureSync } from './syncPlace.js';
import { prepareClip, shortenPauses, renderTimeline, MIN_INNER_PAUSE_SECONDS } from './syncRender.js';
import { acceptRewrite } from './syncRewrite.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;

const cue = (id, startTime, endTime, text, extra = {}) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, ...extra });

/** Silence, then `tone` s of a sine, then silence; optionally a pause of `gap` s in the middle of the tone. */
const clip = ({ lead = 0.2, tone = 1, tail = 0.2, gap = 0, level = 0.3 } = {}) => {
  const samples = new Float32Array(Math.round((lead + tone + gap + tail) * RATE));
  const half = tone / 2;
  const write = (from, seconds) => {
    const a = Math.round(from * RATE);
    const b = a + Math.round(seconds * RATE);
    for (let i = a; i < b; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  };
  if (gap > 0) {
    write(lead, half);
    write(lead + half + gap, half);
  } else write(lead, tone);
  return samples;
};

test('cues spoken as one phrase become one unit; a pause or speaker change starts a new one', () => {
  const units = buildSyncUnits([
    cue(1, 0, 1, 'one'),
    cue(2, 1.1, 2, 'two'),
    cue(3, 3, 4, 'three'),
    cue(4, 4.05, 5, 'four', { speaker: 'B' }),
    cue(5, 5.1, 6, ''),
  ]);
  assert.deepEqual(units.map((u) => u.cueIds), [[1, 2], [3], [4]]);
  assert.equal(units[0].text, 'one two');
  assert.equal(units[0].sourceText, 'src 1 src 2');
  assert.equal(units[0].nextStart, 3);
  assert.equal(units[2].nextStart, null);
  assert.equal(units[1].hardAnchor, false);
  assert.equal(units[2].hardAnchor, true, 'a speaker change is a hard anchor');
});

test('a long pause makes a hard anchor', () => {
  const units = buildSyncUnits([cue(1, 0, 1, 'a'), cue(2, 1 + HARD_ANCHOR_GAP_SECONDS, 3, 'b')]);
  assert.equal(units[1].hardAnchor, true);
});

test('the minimum gap never exceeds the source pause and never drops below a breath', () => {
  assert.equal(minimumGap(0.05), 0.05);
  assert.equal(minimumGap(0.2), 0.08);
  assert.ok(Math.abs(minimumGap(1) - 0.3) < 1e-9);
  assert.equal(minimumGap(5), 0.6);
});

test('pava returns the closest non-decreasing sequence', () => {
  assert.deepEqual(pava([1, 3, 2, 4]), [1, 2.5, 2.5, 4]);
  assert.deepEqual(pava([3, 1], [3, 1]), [2.5, 2.5]);
  assert.deepEqual(pava([1, 2, 3]), [1, 2, 3]);
});

test('clips that fit land exactly where they want to be', () => {
  const positions = placeClips([
    { want: 0, length: 1, gapAfter: 0.2 },
    { want: 2, length: 1, gapAfter: 0.2 },
    { want: 4, length: 1, gapAfter: 0 },
  ]);
  assert.deepEqual(positions, [0, 2, 4]);
});

test('a clip too long for its slot shares the error with its neighbours and never overlaps them', () => {
  const clips = [
    { want: 1, length: 3, gapAfter: 0.2 },
    { want: 2, length: 1, gapAfter: 0.2 },
    { want: 5, length: 1, gapAfter: 0 },
  ];
  const positions = placeClips(clips);
  // Clip 0 wants 1..4 and clip 1 wants 2: a 2.2 s conflict. Clip 0 moves as early as it may (0).
  assert.equal(positions[0], 0);
  assert.ok(Math.abs(positions[1] - 3.2) < 1e-9);
  for (let i = 1; i < clips.length; i++) {
    assert.ok(positions[i] >= positions[i - 1] + clips[i - 1].length + clips[i - 1].gapAfter - 1e-9);
  }
  assert.ok(Math.abs(positions[2] - 5) < 1e-9, 'the clip after the conflict is not dragged along');
});

test('the conflict is split between both clips when neither is held by a bound', () => {
  const positions = placeClips([
    { want: 10, length: 3, gapAfter: 0.2 },
    { want: 12, length: 1, gapAfter: 0 },
  ]);
  // 1.2 s of conflict, shared evenly: clip 0 goes 0.6 s early, clip 1 0.6 s late.
  assert.ok(Math.abs(positions[0] - 9.4) < 1e-9);
  assert.ok(Math.abs(positions[1] - 12.6) < 1e-9);
});

test('a hard anchor gives up less of its position', () => {
  const positions = placeClips([
    { want: 10, length: 3, gapAfter: 0.2 },
    { want: 12, length: 1, gapAfter: 0, weight: 3 },
  ]);
  assert.ok(Math.abs(positions[1] - 12.3) < 1e-9, `got ${positions[1]}`);
});

test('a clip never starts before its earliest allowed position', () => {
  const positions = placeClips([
    { want: 0, length: 4, gapAfter: 0.2, earliest: -0.15 },
    { want: 2, length: 1, gapAfter: 0, earliest: 1.85 },
  ]);
  assert.ok(positions[0] >= 0);
  assert.ok(positions[1] >= positions[0] + 4.2 - 1e-9);
});

test('measureSync reports offsets, overruns and overlaps', () => {
  const units = [
    { srcStart: 1, nextStart: 3 },
    { srcStart: 3, nextStart: null },
  ];
  const clips = [{ lead: 0.03, speech: 2.5, length: 2.6 }, { lead: 0.03, speech: 1, length: 1.1 }];
  const { lines, summary } = measureSync(units, clips.map((c) => ({ ...c, samples: { length: 0 } })), [0.97, 3.2], { tolerance: 0.15 });
  assert.ok(Math.abs(lines[0].offset) < 1e-9);
  assert.ok(Math.abs(lines[0].overrun - 0.5) < 1e-9);
  assert.equal(lines[0].inSync, false);
  assert.ok(Math.abs(lines[1].offset - 0.23) < 1e-9);
  assert.equal(summary.lines, 2);
});

/** A tone ending in a decay that fades from `level` to silence over `decay` seconds, like a word's natural release. */
const decayingClip = ({ lead = 0.2, tone = 0.5, decay = 0.4, tail = 0.3, level = 0.3 } = {}) => {
  const samples = clip({ lead, tone, tail: decay + tail, level });
  const from = Math.round((lead + tone) * RATE);
  const length = Math.round(decay * RATE);
  for (let i = 0; i < length; i++) {
    const n = from + i;
    samples[n] = level * Math.exp((-8 * i) / length) * Math.sin((2 * Math.PI * 220 * n) / RATE);
  }
  return samples;
};

const QUIET = 0.001;
const audible = (samples) => samples.filter((s) => Math.abs(s) >= QUIET).length;

test('prepareClip keeps the silence edges only, and reports where the words are', () => {
  const prepared = prepareClip(clip({ lead: 0.5, tone: 1, tail: 0.6 }), RATE);
  assert.ok(prepared.lead > 0 && prepared.lead < 0.05, `lead ${prepared.lead}`);
  assert.ok(Math.abs(prepared.speech - 1) < 0.01);
  // Starts and ends in silence, so it needs no fade.
  assert.ok(Math.abs(prepared.samples[0]) < QUIET);
  assert.ok(Math.abs(prepared.samples[prepared.samples.length - 1]) < QUIET);
  assert.equal(prepareClip(new Float32Array(RATE), RATE), null);
});

test('prepareClip keeps the whole decay of the last word, however quiet it gets', () => {
  const source = decayingClip();
  const prepared = prepareClip(source, RATE);
  assert.equal(audible(prepared.samples), audible(source));
});

test('prepareClip copies the audio untouched: no fade on either edge', () => {
  const source = clip({ lead: 0.3, tone: 0.5, tail: 0.3 });
  const prepared = prepareClip(source, RATE);
  const firstLoud = source.findIndex((s) => Math.abs(s) > 0.0032);
  const start = firstLoud - Math.round(prepared.lead * RATE);
  for (let i = 0; i < prepared.samples.length; i++) assert.equal(prepared.samples[i], source[start + i]);
});

test('shortenPauses takes time from a silent pause between words and leaves the words alone', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  const { samples: shorter, removed } = shortenPauses(samples, RATE, 0.4);
  assert.ok(Math.abs(removed - 0.4) < 0.02, `removed ${removed}`);
  assert.ok(Math.abs(samples.length - shorter.length - removed * RATE) < 2);
  // The same amount of sound is left: only silence went.
  assert.equal(audible(shorter), audible(samples));

  // Asked for more than the pause can give, it stops at the floor.
  const { removed: most } = shortenPauses(samples, RATE, 5);
  assert.ok(most <= 0.8 - MIN_INNER_PAUSE_SECONDS + 0.02);
  assert.ok(most > 0.5);
});

test('shortenPauses never cuts into a breath inside a pause', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  // A soft breath (about -55 dBFS) in the middle of the pause.
  const pauseStart = Math.round(0.5 * RATE);
  for (let i = pauseStart + Math.round(0.3 * RATE); i < pauseStart + Math.round(0.5 * RATE); i++) {
    samples[i] = 0.0018 * Math.sin((2 * Math.PI * 90 * i) / RATE);
  }
  const { samples: shorter } = shortenPauses(samples, RATE, 5);
  assert.equal(audible(shorter), audible(samples), 'every audible sample, the breath included, is kept');
});

test('shortenPauses leaves a clip with no inner pause as it is', () => {
  const samples = prepareClip(clip({ tone: 1 }), RATE).samples;
  const { samples: same, removed } = shortenPauses(samples, RATE, 1);
  assert.equal(removed, 0);
  assert.equal(same, samples);
});

test('renderTimeline puts each clip at its position, copied without fades', () => {
  const a = prepareClip(clip({ tone: 0.5 }), RATE);
  const b = prepareClip(clip({ tone: 0.5 }), RATE);
  const track = renderTimeline([{ samples: a.samples, position: 1 }, { samples: b.samples, position: 3 }], { sampleRate: RATE, length: 10 });
  assert.equal(track.length, 10 * RATE);
  const firstSound = track.findIndex((s) => Math.abs(s) > 0.0032) / RATE;
  assert.ok(Math.abs(firstSound - (1 + a.lead)) < 0.002, `first sound at ${firstSound}`);
  // Equal clips get a gain of 1, so the placed audio is the clip, sample for sample.
  const at = Math.round(1 * RATE);
  for (let i = 0; i < a.samples.length; i++) assert.equal(track[at + i], a.samples[i]);
  let silentBetween = true;
  for (let i = Math.round(2 * RATE); i < Math.round(2.9 * RATE); i++) if (Math.abs(track[i]) > 0.0032) silentBetween = false;
  assert.ok(silentBetween);
});

test('acceptRewrite rejects lines that are not shorter or that lost most of the line', () => {
  const original = 'this is the original dub line that runs long';
  assert.equal(acceptRewrite(original, original), null);
  assert.equal(acceptRewrite(original, 'this'), null);
  assert.equal(acceptRewrite(original, '"the dub line runs long"'), 'the dub line runs long');
  // A line that must lose most of its length may: it is measured against the length asked for.
  assert.equal(acceptRewrite(original, 'dub runs long', 14), 'dub runs long');
  assert.equal(acceptRewrite(original, 'dub', 14), null);
});

test('a text model that fails leaves the sync finished, with the reason reported', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'x'.repeat(30)), cue(2, 2.6, 3.5, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({
    shorten: async () => {
      throw new Error('Budget has been exceeded');
    },
  });
  const { buffer, report } = await runSync({ segments, sourceDuration: 6, sampleRate: RATE, voice }, deps);
  assert.ok(buffer.length > 0);
  assert.equal(report.units[0].exceeded, true);
  assert.equal(report.units[0].suggestion, null);
  assert.equal(report.summary.suggestionError, 'Budget has been exceeded');
});

/** A fake voice: every character takes 0.08 s to say, with 0.15 s of silence either side. */
const SECONDS_PER_CHAR = 0.08;
const fakeDeps = ({ shorten } = {}) => {
  const voiced = [];
  return {
    voiced,
    deps: {
      voiceLines: async (lines, { onLine }) =>
        lines.map((line, n) => {
          voiced.push(line.text);
          onLine(n + 1);
          return clip({ lead: 0.15, tone: line.text.length * SECONDS_PER_CHAR, tail: 0.15 });
        }),
      decode: async (samples) => samples,
      encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
      shorten,
    },
  };
};

const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };

test('a dub whose lines fit is placed exactly on the source phrases', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbb'), cue(3, 7, 8, 'cccccccccc')];
  const { deps } = fakeDeps();
  const { report } = await runSync({ segments, sourceDuration: 10, sampleRate: RATE, voice }, deps);
  assert.equal(report.summary.lines, 3);
  assert.equal(report.summary.inSync, 3);
  assert.equal(report.summary.overlaps, 0);
  for (const unit of report.units) assert.ok(Math.abs(unit.offset) < 0.01, `offset ${unit.offset}`);
  assert.ok(Math.abs(report.duration - 10) < 0.01, 'the dub is as long as the source');
});

test('a line that starts at 0:00 still starts on time', async () => {
  clearClipCache();
  const { deps } = fakeDeps();
  const { report } = await runSync({ segments: [cue(1, 0, 1, 'aaaaaaaaaa')], sourceDuration: 3, sampleRate: RATE, voice }, deps);
  assert.ok(Math.abs(report.units[0].offset) < 0.002, `offset ${report.units[0].offset}`);
  assert.ok(Math.abs(report.duration - 3) < 0.01, 'no run-out past the source when the dub ends in time');
});

/** A voice whose clips open with `breath` s of soft breath (about -54 dBFS) before the words. */
const breathyDeps = (breath) => {
  const { deps, voiced } = fakeDeps();
  deps.voiceLines = async (lines, { onLine }) =>
    lines.map((line, n) => {
      voiced.push(line.text);
      onLine(n + 1);
      const samples = clip({ lead: 0.1 + breath, tone: line.text.length * SECONDS_PER_CHAR, tail: 0.15 });
      for (let i = Math.round(0.1 * RATE); i < Math.round((0.1 + breath) * RATE); i++) samples[i] = 0.002 * Math.sin((2 * Math.PI * 90 * i) / RATE);
      return samples;
    });
  return { deps, voiced };
};

test('a soft breath before the first word does not delay a line at 0:00', async () => {
  clearClipCache();
  const { deps } = breathyDeps(0.8);
  const { report } = await runSync({ segments: [cue(1, 0, 1, 'aaaaaaaaaa')], sourceDuration: 3, sampleRate: RATE, voice }, deps);
  assert.ok(Math.abs(report.units[0].offset) < 0.01, `offset ${report.units[0].offset}`);
});

test("a soft breath may overlap the silent end of the line before, and the first word still lands on time", async () => {
  clearClipCache();
  const { deps } = breathyDeps(0.6);
  // A 0.5 s source pause: less than the 0.6 s breath.
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 2.5, 3.5, 'bbbbbbbbbb')];
  const { report } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice }, deps);
  for (const unit of report.units) assert.ok(Math.abs(unit.offset) < 0.01, `offset ${unit.offset}`);
  assert.equal(report.summary.overlaps, 0, 'breath over silence is not an overlap');
  assert.equal(report.summary.inSync, 2);
});

test('measureSync counts clips that overlap', () => {
  const units = [{ srcStart: 0, nextStart: 1 }, { srcStart: 1, nextStart: null }];
  const clips = [{ lead: 0, speech: 1.5, length: 1.6 }, { lead: 0, speech: 1, length: 1 }];
  assert.equal(measureSync(units, clips, [0, 1], { tolerance: 0.15 }).summary.overlaps, 1);
  assert.equal(measureSync(units, clips, [0, 1.7], { tolerance: 0.15 }).summary.overlaps, 0);
});

test('a line too long for its slot is voiced as written, flagged, and given a suggestion', async () => {
  clearClipCache();
  // 30 characters take 2.4 s, but the slot is 1.5 s.
  const segments = [cue(1, 1, 2, 'x'.repeat(30)), cue(2, 2.6, 3.5, 'yyyyyyyyyy'), cue(3, 6, 7, 'zzzzzzzzzz')];
  const requests = [];
  const { deps, voiced } = fakeDeps({
    shorten: async (req) => {
      requests.push(req);
      return 'x'.repeat(req.targetChars);
    },
  });
  const progress = [];
  const { report } = await runSync({ segments, sourceDuration: 8, sampleRate: RATE, voice }, deps, { onProgress: (p) => progress.push(p) });

  assert.deepEqual(voiced, ['x'.repeat(30), 'yyyyyyyyyy', 'zzzzzzzzzz'], 'each line voiced once, exactly as written');
  assert.equal(report.units[0].text, 'x'.repeat(30));
  assert.equal(report.units[0].exceeded, true);
  assert.ok(report.units[0].exceededBy > 0.5, `exceeded by ${report.units[0].exceededBy}`);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceText, 'src 1');
  assert.ok(requests[0].targetChars < 30);
  assert.equal(report.units[0].suggestion, 'x'.repeat(requests[0].targetChars));
  assert.equal(report.units[2].exceeded, false);
  assert.equal(report.units[2].suggestion, null);
  assert.equal(report.summary.exceeded, 1);
  assert.equal(report.summary.overlaps, 0);
  assert.deepEqual([...new Set(progress.map((p) => p.step))], [1, 2, 3, 4, 5, 6, 7]);
});

test('with suggestions off, a long line is still placed without overlapping and is flagged', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'x'.repeat(30)), cue(2, 2.6, 3.5, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({ shorten: async () => assert.fail('should not ask for suggestions') });
  const { report } = await runSync({ segments, sourceDuration: 6, sampleRate: RATE, suggest: false, voice }, deps);
  assert.equal(report.summary.overlaps, 0);
  assert.ok(report.summary.inSync < 2);
  assert.equal(report.units[0].exceeded, true);
  assert.equal(report.units[0].suggestion, null);
});

test('a second sync reuses the clips it already voiced', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbb')];
  const first = fakeDeps();
  await runSync({ segments, sourceDuration: 6, sampleRate: RATE, voice }, first.deps);
  const second = fakeDeps();
  await runSync({ segments, sourceDuration: 6, sampleRate: RATE, voice, precision: 'lipsync' }, second.deps);
  assert.equal(first.voiced.length, 2);
  assert.equal(second.voiced.length, 0);
});

test('a sync with nothing translated is refused', async () => {
  const { deps } = fakeDeps();
  await assert.rejects(runSync({ segments: [cue(1, 0, 1, '')], sampleRate: RATE, voice }, deps), { code: 'no_lines' });
});

test('a cancelled sync stops', async () => {
  clearClipCache();
  const controller = new AbortController();
  const { deps } = fakeDeps();
  const voiceLines = deps.voiceLines;
  deps.voiceLines = async (...args) => {
    const out = await voiceLines(...args);
    controller.abort();
    return out;
  };
  await assert.rejects(
    runSync({ segments: [cue(1, 0, 1, 'aaaa')], sampleRate: RATE, voice }, deps, { signal: controller.signal }),
    { code: 'cancelled' }
  );
});
