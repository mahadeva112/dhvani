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

test('prepareClip trims to the speech and reports where it starts', () => {
  const prepared = prepareClip(clip({ lead: 0.5, tone: 1, tail: 0.6 }), RATE);
  assert.ok(Math.abs(prepared.lead - 0.03) < 0.002);
  assert.ok(Math.abs(prepared.speech - 1) < 0.01);
  assert.ok(Math.abs(prepared.samples.length / RATE - (0.03 + 1 + 0.08)) < 0.01);
  assert.equal(prepareClip(new Float32Array(RATE), RATE), null);
});

test('shortenPauses takes time from a pause between words and leaves the words alone', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  const { samples: shorter, removed } = shortenPauses(samples, RATE, 0.4);
  assert.ok(Math.abs(removed - 0.4) < 0.02, `removed ${removed}`);
  assert.ok(Math.abs(samples.length - shorter.length - removed * RATE) < 2);

  // Asked for more than the pause can give, it stops at the floor.
  const { removed: most } = shortenPauses(samples, RATE, 5);
  assert.ok(most <= 0.8 - MIN_INNER_PAUSE_SECONDS + 0.02);
  assert.ok(most > 0.5);
});

test('shortenPauses leaves a clip with no inner pause as it is', () => {
  const samples = prepareClip(clip({ tone: 1 }), RATE).samples;
  const { samples: same, removed } = shortenPauses(samples, RATE, 1);
  assert.equal(removed, 0);
  assert.equal(same, samples);
});

test('renderTimeline puts each clip at its position in a track at least the source long', () => {
  const a = prepareClip(clip({ tone: 0.5 }), RATE).samples;
  const b = prepareClip(clip({ tone: 0.5 }), RATE).samples;
  const track = renderTimeline([{ samples: a, position: 1 }, { samples: b, position: 3 }], { sampleRate: RATE, length: 10 });
  assert.equal(track.length, 10 * RATE);
  const firstSound = track.findIndex((s) => Math.abs(s) > 0.0032) / RATE;
  assert.ok(Math.abs(firstSound - (1 + 0.03)) < 0.01, `first sound at ${firstSound}`);
  let silentBetween = true;
  for (let i = Math.round(2 * RATE); i < Math.round(2.9 * RATE); i++) if (Math.abs(track[i]) > 0.0032) silentBetween = false;
  assert.ok(silentBetween);
});

test('acceptRewrite rejects lines that are not shorter or that lost most of the line', () => {
  const original = 'this is the original dub line that runs long';
  assert.equal(acceptRewrite(original, original), null);
  assert.equal(acceptRewrite(original, 'this'), null);
  assert.equal(acceptRewrite(original, '"the dub line runs long"'), 'the dub line runs long');
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

test('a line too long for its slot is rewritten shorter and voiced again', async () => {
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

  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceText, 'src 1');
  assert.ok(requests[0].targetChars < 30);
  assert.equal(voiced.length, 4, 'three lines, plus the rewritten one again');
  assert.equal(report.units[0].rewritten, true);
  assert.equal(report.units[0].originalText, 'x'.repeat(30));
  assert.equal(report.summary.inSync, 3);
  assert.equal(report.summary.overlaps, 0);
  assert.deepEqual([...new Set(progress.map((p) => p.step))], [1, 2, 3, 4, 5, 6, 7]);
});

test('with rewriting off, a long line is still placed without overlapping and is flagged', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'x'.repeat(30)), cue(2, 2.6, 3.5, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({ shorten: async () => assert.fail('should not rewrite') });
  const { report } = await runSync({ segments, sourceDuration: 6, sampleRate: RATE, rewrite: false, voice }, deps);
  assert.equal(report.summary.overlaps, 0);
  assert.ok(report.summary.inSync < 2);
  assert.equal(report.units[0].rewritten, false);
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
