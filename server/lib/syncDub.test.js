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
  // Every clip goes in at a gain of 1, so the placed audio is the clip, sample for sample.
  const at = Math.round(1 * RATE);
  for (let i = 0; i < a.samples.length; i++) assert.equal(track[at + i], a.samples[i]);
  let silentBetween = true;
  for (let i = Math.round(2 * RATE); i < Math.round(2.9 * RATE); i++) if (Math.abs(track[i]) > 0.0032) silentBetween = false;
  assert.ok(silentBetween);
});

/**
 * Speech-like audio with no silence anywhere: a few partials under a slow
 * envelope, plus noise, at peak `level`. Cutting it anywhere lands mid-waveform.
 */
const voiceLike = (seconds, level = 0.5, seed = 1) => {
  let state = seed;
  const noise = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.1;
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t);
    samples[i] = level * env * (0.5 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 410 * t + 1) + 0.15 * Math.sin(2 * Math.PI * 1300 * t + 2) + noise());
  }
  return samples;
};

/** `samples` with 50 ms of silence either side, as a recording starts and ends. */
const inSilence = (samples) => {
  const pad = Math.round(0.05 * RATE);
  const out = new Float32Array(samples.length + 2 * pad);
  out.set(samples, pad);
  return out;
};

const peakOf = (samples) => samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0);

/** Splits `source` at `cuts` (sample indices) into regions that reference it, never copy it. */
const split = (source, cuts) => {
  const edges = [0, ...cuts, source.length];
  return edges.slice(0, -1).map((start, i) => ({ start, samples: source.subarray(start, edges[i + 1]) }));
};

test('Test A: a split played straight through is the original, sample for sample', () => {
  const source = inSilence(voiceLike(2));
  const regions = split(source, [7001]); // mid-waveform, far from any zero crossing
  const track = renderTimeline(
    regions.map((r) => ({ samples: r.samples, startSample: r.start })),
    { sampleRate: RATE, runOut: 0 }
  );
  assert.equal(track.length, source.length);
  for (let i = 0; i < source.length; i++) assert.equal(track[i], source[i], `sample ${i}`);
});

test('Test B: a moved region sounds exactly as it did; only its place changes', () => {
  const source = voiceLike(2);
  const [a, b] = split(source, [8000]);
  const moved = Math.round(3.25 * RATE);
  const log = [];
  const track = renderTimeline(
    [
      { samples: a.samples, startSample: a.start },
      { samples: b.samples, startSample: moved },
    ],
    { sampleRate: RATE, length: 5, log: (entry) => log.push(entry) }
  );
  // Away from its edges, the moved region is its source samples at a gain of exactly 1.
  const edge = Math.round(0.005 * RATE);
  for (let i = edge; i < b.samples.length - edge; i++) assert.equal(track[moved + i], b.samples[i]);
  assert.equal(log[1].gain, 1);
  // Between the regions there is nothing but silence: no samples were added.
  for (let i = a.samples.length + edge; i < moved - edge; i++) assert.equal(track[i], 0);
});

test('Test C: split then joined back is identical to the original', () => {
  const source = inSilence(voiceLike(1.5));
  const regions = split(source, [3333, 3334, 9000]); // one region a single sample long
  const log = [];
  const track = renderTimeline(
    regions.map((r) => ({ samples: r.samples, startSample: r.start })),
    { sampleRate: RATE, runOut: 0, log: (entry) => log.push(entry) }
  );
  assert.deepEqual([...track], [...source]);
  for (const entry of log) {
    assert.equal(entry.microFade, false);
    assert.equal(entry.edgeTrimStartSamples + entry.edgeTrimEndSamples, 0, 'a join is never trimmed');
  }
});

test('Test D and E: many splits, moves and joins leave no trace, and the source is never touched', () => {
  const source = inSilence(voiceLike(3, 0.5, 7));
  const original = Float32Array.from(source);
  // Split, split, split, move, move, join: every region ends up back where it came from.
  const regions = split(source, [4000, 9999, 15000]);
  let placed = regions.map((r) => ({ samples: r.samples, startSample: r.start }));
  for (let round = 0; round < 20; round++) {
    placed = placed.map((clip, i) => ({ ...clip, startSample: clip.startSample + (i % 2 ? 777 : -333) }));
    renderTimeline(placed, { sampleRate: RATE, length: 4 });
    placed = placed.map((clip, i) => ({ ...clip, startSample: clip.startSample - (i % 2 ? 777 : -333) }));
  }
  const track = renderTimeline(placed, { sampleRate: RATE, runOut: 0 });
  assert.deepEqual([...track], [...original]);
  assert.deepEqual([...source], [...original], 'the source samples are exactly as they were');
});

test('Test F: a quiet voice stays as quiet as it was, even next to a loud one', () => {
  const quiet = voiceLike(1, 0.01); // about -40 dBFS
  const loud = voiceLike(1, 0.5, 3);
  const track = renderTimeline(
    [
      { samples: quiet, startSample: 0 },
      { samples: loud, startSample: 2 * RATE },
    ],
    { sampleRate: RATE, length: 4 }
  );
  const edge = Math.round(0.005 * RATE);
  for (let i = edge; i < quiet.length - edge; i++) assert.equal(track[i], quiet[i]);
  for (let i = edge; i < loud.length - edge; i++) assert.equal(track[2 * RATE + i], loud[i]);
});

test('Test G: a loud voice near full scale is neither turned down nor clipped', () => {
  const loud = voiceLike(1, 1, 5);
  const top = peakOf(loud);
  const scale = 0.99 / top;
  for (let i = 0; i < loud.length; i++) loud[i] *= scale; // peaks at 0.99, above the old 0.98 ceiling
  const track = renderTimeline([{ samples: loud, startSample: RATE }], { sampleRate: RATE, length: 3 });
  assert.ok(Math.abs(peakOf(track) - peakOf(loud)) < 1e-7, `peak ${peakOf(track)}`);
  assert.ok(peakOf(track) <= 1);
});

test('Test H: an edge cut through a consonant does not click, and a hard attack after silence is kept whole', () => {
  // A plosive burst: silence, then a sudden loud transient.
  const burst = new Float32Array(Math.round(0.3 * RATE));
  const onset = Math.round(0.1 * RATE);
  for (let i = onset; i < burst.length; i++) burst[i] = 0.8 * Math.exp(-(i - onset) / 200) * Math.sin(i * 1.3) + 0.2 * Math.sin(i * 0.37);
  // Cut exactly on the burst's loudest samples, so both new edges start at full level.
  const cut = onset + 3;
  const [head, tail] = split(burst, [cut]);
  const log = [];
  const track = renderTimeline(
    [
      { samples: head.samples, startSample: 0 },
      { samples: tail.samples, startSample: RATE }, // moved away: both cut edges now face silence
    ],
    { sampleRate: RATE, length: 2, log: (entry) => log.push(entry) }
  );
  const limit = Math.round(0.005 * RATE);
  for (const [n, entry] of log.entries()) {
    const s = entry.timelineStartSample;
    const e = entry.timelineEndSample;
    // Each edge either lands on a quiet sample or ramps in over a few milliseconds: never a step.
    const startStep = entry.fadeInSamples > 0 ? Math.abs(track[s]) : Math.abs(track[s] - (track[s - 1] ?? 0));
    const endStep = entry.fadeOutSamples > 0 ? Math.abs(track[e - 1]) : Math.abs(track[e - 1] - track[e]);
    assert.ok(startStep < 0.01 && endStep < 0.01, `clip ${n}: steps ${startStep} / ${endStep}`);
    assert.ok(entry.edgeTrimStartSamples <= limit && entry.edgeTrimEndSamples <= limit, 'at most 5 ms moved');
    assert.ok(entry.fadeInSamples <= Math.round(0.003 * RATE) && entry.fadeOutSamples <= Math.round(0.003 * RATE), 'a micro-fade only');
  }
  // The head starts in silence, so the attack of its burst is untouched, sample for sample.
  assert.equal(log[0].fadeInSamples, 0);
  assert.equal(log[0].edgeTrimStartSamples, 0);
  for (let i = 0; i < cut - limit; i++) assert.equal(track[i], burst[i]);
});

test('an edge already in silence is never faded or moved', () => {
  const samples = prepareClip(clip({ tone: 0.5 }), RATE).samples;
  const log = [];
  renderTimeline([{ samples, position: 1 }], { sampleRate: RATE, length: 3, log: (entry) => log.push(entry) });
  assert.deepEqual(
    [log[0].fadeInSamples, log[0].fadeOutSamples, log[0].edgeTrimStartSamples, log[0].edgeTrimEndSamples, log[0].microFade],
    [0, 0, 0, 0, false]
  );
});

test('lines keep the level they were voiced at unless loudness matching is asked for', () => {
  const soft = clip({ tone: 0.5, level: 0.1 });
  const hard = clip({ tone: 0.5, level: 0.4 });
  const log = [];
  renderTimeline(
    [
      { samples: soft, position: 0 },
      { samples: hard, position: 2 },
    ],
    { sampleRate: RATE, length: 4, log: (entry) => log.push(entry) }
  );
  assert.deepEqual(log.map((entry) => entry.gain), [1, 1]);
  const matched = [];
  renderTimeline(
    [
      { samples: soft, position: 0 },
      { samples: hard, position: 2 },
    ],
    { sampleRate: RATE, length: 4, matchLoudness: true, log: (entry) => matched.push(entry) }
  );
  assert.ok(matched[0].gain > 1 && matched[1].gain < 1, `gains ${matched.map((entry) => entry.gain)}`);
});

test('shortenPauses joins two silences, so the join has no step', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  const { samples: shorter, cuts } = shortenPauses(samples, RATE, 0.4);
  assert.equal(cuts.length, 1);
  const join = cuts[0].start;
  assert.ok(Math.abs(shorter[join] - shorter[join - 1]) < 2 * QUIET);
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

test('a resync after a retake or a changed line voices only that line', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbb'), cue(3, 7, 8, 'cccccccccc')];
  await runSync({ segments, sourceDuration: 9, sampleRate: RATE, voice }, fakeDeps().deps);

  // A retake of line 1: a new seed for it alone.
  const lines = [];
  const retake = fakeDeps();
  const voiceLines = retake.deps.voiceLines;
  retake.deps.voiceLines = async (batch, options) => {
    lines.push(...batch);
    return voiceLines(batch, options);
  };
  const { report } = await runSync({ segments, sourceDuration: 9, sampleRate: RATE, voice, lineSeeds: { 1: 99 } }, retake.deps);
  assert.deepEqual(retake.voiced, ['aaaaaaaaaa']);
  assert.equal(lines[0].seed, 99);
  assert.equal(report.units[0].key, '1');

  // The same retake again is already voiced; a changed line 3 is the only new take.
  const changed = fakeDeps();
  const edited = [segments[0], segments[1], cue(3, 7, 8, 'cccc')];
  await runSync({ segments: edited, sourceDuration: 9, sampleRate: RATE, voice, lineSeeds: { 1: 99 } }, changed.deps);
  assert.deepEqual(changed.voiced, ['cccc']);
});

test('audio debug accounts for every sample of every line, and the dub is each clip as voiced', async () => {
  clearClipCache();
  // Different levels per line: a sync must not even them out on its own.
  const levels = { aaaaaaaaaa: 0.05, ['x'.repeat(30)]: 0.3, cccccccccc: 0.6 };
  const { deps } = fakeDeps();
  const voiced = [];
  deps.voiceLines = async (lines, { onLine }) =>
    lines.map((line, n) => {
      onLine(n + 1);
      const samples = clip({ lead: 0.15, tone: line.text.length * SECONDS_PER_CHAR, gap: 0.6, tail: 0.15, level: levels[line.text] });
      voiced.push(samples);
      return samples;
    });
  let track;
  deps.encode = async (samples) => {
    track = samples;
    return { buffer: Buffer.alloc(0), contentType: 'audio/wav' };
  };
  // Line 2 is too long for its slot, so its inner pause is shortened.
  const segments = [cue(1, 0, 1, 'aaaaaaaaaa'), cue(2, 3, 4, 'x'.repeat(30)), cue(3, 5.5, 6.5, 'cccccccccc')];
  const { report } = await runSync({ segments, sourceDuration: 10, sampleRate: RATE, voice, suggest: false, debug: true }, deps);
  const { audioDebug } = report;

  assert.equal(audioDebug.sampleRate, RATE);
  assert.equal(audioDebug.resampled, false);
  assert.equal(audioDebug.output.encodes, 1);
  assert.equal(audioDebug.lines.length, 3);
  assert.ok(audioDebug.lines[1].pauseCuts.length > 0, 'the long line lost some pause');
  audioDebug.lines.forEach((line, n) => {
    assert.equal(line.gain, 1);
    assert.equal(line.microFade, false, 'clips that start and end in silence need no fade');
    // Rebuild the line from the voiced clip and the record alone; it must be what the track holds.
    const source = voiced[n];
    const kept = [];
    let at = line.sourceStartSample + line.droppedBeforeZeroSamples;
    for (const cut of line.pauseCuts) {
      for (let i = at; i < cut.sourceStartSample; i++) kept.push(source[i]);
      assert.ok(cut.joinStep < 2 * QUIET);
      at = cut.sourceEndSample;
    }
    for (let i = at; i < line.sourceEndSample; i++) kept.push(source[i]);
    assert.equal(line.timelineEndSample - line.timelineStartSample, kept.length);
    for (let i = 0; i < kept.length; i++) assert.equal(track[line.timelineStartSample + i], kept[i], `line ${n + 1}, sample ${i}`);
  });
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
