import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncUnits, minimumGap, unitGapAfter, HARD_ANCHOR_GAP_SECONDS } from './syncUnits.js';
import { DEFAULT_JOIN_SETTINGS, resolveJoinSettings, dbToAmplitude } from './syncSettings.js';
import { pava, placeClips, measureSync } from './syncPlace.js';
import { prepareClip, removeBreaths, shortenPauses, renderTimeline, MIN_INNER_PAUSE_SECONDS } from './syncRender.js';
import { acceptRewrite } from './syncRewrite.js';
import { runSync, clearClipCache, clipHash, MAX_RETAKES, matchPaces } from './syncDub.js';

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

test('a sentence is never cut in two: a cue that leaves it open takes the next one', () => {
  const segments = [cue(1, 0, 1, 'আমি আজ সকালে,'), cue(2, 1.8, 3, 'বাজারে গিয়েছিলাম।'), cue(3, 3.8, 5, 'তারপর ফিরলাম।')];
  // 0.8 s between cues 1 and 2 is past the 0.4 s grouping gap, but the sentence isn't over.
  assert.deepEqual(buildSyncUnits(segments).map((u) => u.cueIds), [[1, 2], [3]]);
  // Past the longest unit too, as long as the sentence is still open.
  const long = [cue(1, 0, 8, 'এক দুই তিন'), cue(2, 8.1, 14, 'চার পাঁচ।'), cue(3, 14.1, 20, 'ছয়।')];
  assert.deepEqual(buildSyncUnits(long).map((u) => u.cueIds), [[1, 2], [3]]);
  // A pause long enough to be a hard anchor still starts a new unit, and so does a new speaker.
  assert.deepEqual(buildSyncUnits([cue(1, 0, 1, 'এক'), cue(2, 1 + HARD_ANCHOR_GAP_SECONDS, 3, 'দুই।')]).map((u) => u.cueIds), [[1], [2]]);
  assert.deepEqual(buildSyncUnits([cue(1, 0, 1, 'এক'), cue(2, 1.5, 3, 'দুই।', { speaker: 'B' })]).map((u) => u.cueIds), [[1], [2]]);
  // A grouping gap of 0 asks for every cue on its own.
  assert.deepEqual(buildSyncUnits(segments, { unitGap: 0, maxUnit: 12 }).map((u) => u.cueIds), [[1], [2], [3]]);
});

test('a long pause makes a hard anchor', () => {
  const units = buildSyncUnits([cue(1, 0, 1, 'a'), cue(2, 1 + HARD_ANCHOR_GAP_SECONDS, 3, 'b')]);
  assert.equal(units[1].hardAnchor, true);
});

test('the minimum gap never drops below the floor, however little the source paused', () => {
  assert.equal(minimumGap(0.05), DEFAULT_JOIN_SETTINGS.minGap);
  assert.equal(minimumGap(0.05, DEFAULT_JOIN_SETTINGS, true), DEFAULT_JOIN_SETTINGS.speakerGap);
  assert.ok(Math.abs(minimumGap(1) - 0.3) < 1e-9, '30% of a 1 s source pause');
  assert.equal(minimumGap(5), 0.6, 'a long pause lends the rest to a line that runs long');
  assert.equal(minimumGap(0.2, { minGap: 0.08, speakerGap: 0.08, gapShare: 0.3 }), 0.08);
  assert.equal(minimumGap(null), 0);
});

test('a speaker change asks for its own gap, and the grouping threshold is the one asked for', () => {
  const segments = [cue(1, 0, 1, 'a'), cue(2, 1.3, 2, 'b'), { ...cue(3, 2.1, 3, 'c'), speaker: 'B' }];
  const units = buildSyncUnits(segments);
  assert.deepEqual(units.map((u) => u.cueIds), [[1, 2], [3]]);
  assert.equal(units[0].speakerChangeAfter, true);
  assert.equal(unitGapAfter(units[0]), DEFAULT_JOIN_SETTINGS.speakerGap);
  assert.deepEqual(buildSyncUnits(segments, { unitGap: 0.2, maxUnit: 12 }).map((u) => u.cueIds), [[1], [2], [3]]);
});

test('join settings fall back to Natural and are kept inside their ranges', () => {
  assert.deepEqual(resolveJoinSettings(undefined), DEFAULT_JOIN_SETTINGS);
  const settings = resolveJoinSettings({ minGap: 5, spliceCrossfade: -1, breathClear: false, tailFloorDb: 'x', flagJoin: null });
  assert.equal(settings.minGap, 0.6);
  assert.equal(settings.spliceCrossfade, 0);
  assert.equal(settings.breathClear, false);
  assert.equal(settings.tailFloorDb, DEFAULT_JOIN_SETTINGS.tailFloorDb);
  assert.equal(settings.flagJoin, DEFAULT_JOIN_SETTINGS.flagJoin);
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

test('prepareClip reports a clip the voice cut off before its last sound died away', () => {
  assert.equal(prepareClip(clip({ tone: 1, tail: 0.2 }), RATE).cutOff, false);
  // Stopped mid-word: loud to the very end, or with only a few ms of quiet after.
  assert.equal(prepareClip(clip({ tone: 1, tail: 0 }), RATE).cutOff, true);
  assert.equal(prepareClip(clip({ tone: 1, tail: 0.005 }), RATE).cutOff, true);
  // Kept whole either way.
  assert.equal(prepareClip(clip({ lead: 0, tone: 1, tail: 0 }), RATE).samples.length, RATE);
  // Trailing off in breath or room noise (about -60 dBFS) to the end is not a cut.
  const breathy = clip({ tone: 1, tail: 0.2 });
  for (let i = breathy.length - Math.round(0.2 * RATE); i < breathy.length; i++) breathy[i] = 0.0012 * Math.sin((2 * Math.PI * 90 * i) / RATE);
  assert.equal(prepareClip(breathy, RATE).cutOff, false);
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

test('shortenPauses takes no more of a pause than asked, and no less of it than the floor asked', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  const { removed: capped } = shortenPauses(samples, RATE, 5, { maxTake: 0.25 });
  assert.ok(capped <= 0.8 * 0.25 + 0.01, `removed ${capped}`);
  const { removed: floored } = shortenPauses(samples, RATE, 5, { minPause: 0.5 });
  assert.ok(floored <= 0.8 - 0.5 + 0.02, `removed ${floored}`);
});

test('a splice crossfade removes as much as a plain cut, and only touches the samples at the join', () => {
  const samples = prepareClip(clip({ lead: 0, tone: 1, gap: 0.8, tail: 0 }), RATE).samples;
  // Room tone either side of the pause, quieter than silence.
  for (let i = 0; i < samples.length; i++) if (samples[i] === 0) samples[i] = 0.0004 * Math.sin(i);
  const plain = shortenPauses(samples, RATE, 0.4);
  const faded = shortenPauses(samples, RATE, 0.4, { crossfade: 0.01 });
  assert.equal(faded.samples.length, plain.samples.length);
  const join = plain.cuts[0].start;
  let changed = 0;
  for (let i = 0; i < plain.samples.length; i++) if (plain.samples[i] !== faded.samples[i]) changed++;
  assert.ok(changed > 0 && changed <= Math.round(0.01 * RATE));
  for (let i = 0; i < join - Math.round(0.01 * RATE); i++) assert.equal(faded.samples[i], plain.samples[i]);
});

test('a deeper tail floor and a tail hold keep more of what follows the last word, never past the clip', () => {
  const source = clip({ lead: 0.1, tone: 0.5, tail: 0.5 });
  const toneEnd = Math.round(0.6 * RATE);
  // A decay between -60 and -70 dBFS for 0.1 s after the tone.
  for (let i = toneEnd; i < toneEnd + Math.round(0.1 * RATE); i++) source[i] = 0.0006 * Math.sin(i);
  const plain = prepareClip(source, RATE);
  const deep = prepareClip(source, RATE, { tailQuiet: 0.0003 });
  assert.ok(deep.end - plain.end >= Math.round(0.09 * RATE), 'the soft decay is kept');
  const held = prepareClip(source, RATE, { tailQuiet: 0.0003, tailHold: 0.04 });
  assert.equal(held.end - deep.end, Math.round(0.04 * RATE));
  assert.equal(prepareClip(source, RATE, { tailHold: 10 }).end, source.length);
  assert.equal(held.speech, plain.speech, 'where the words are does not move');
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

/** A fake voice: every character takes 0.08 s to say (the closing mark the sync adds takes none), with 0.15 s of silence either side. */
const SECONDS_PER_CHAR = 0.08;
const fakeDeps = ({ shorten, lengthen, canPace } = {}) => {
  const voiced = [];
  const paces = [];
  return {
    voiced,
    paces,
    deps: {
      // A line's pace speeds it up or slows it down exactly.
      voiceLines: async (lines, { onLine }) =>
        lines.map((line, n) => {
          voiced.push(line.text);
          paces.push(line.pace ?? 1);
          onLine(n + 1);
          return clip({ lead: 0.15, tone: (line.text.replace(/[.।]$/u, '').length * SECONDS_PER_CHAR) / (line.pace ?? 1), tail: 0.15 });
        }),
      canPace,
      decode: async (samples) => samples,
      encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
      shorten,
      lengthen,
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

test("with breaths not kept clear, a soft breath may overlap the silent end of the line before, and the first word still lands on time", async () => {
  clearClipCache();
  const { deps } = breathyDeps(0.6);
  // A 0.5 s source pause: less than the 0.6 s breath.
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 2.5, 3.5, 'bbbbbbbbbb')];
  const join = { breathClear: false, minGap: 0.08, gapShare: 0.3, tailFloorDb: -60, tailHold: 0 };
  const { report } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice, join }, deps);
  for (const unit of report.units) assert.ok(Math.abs(unit.offset) < 0.01, `offset ${unit.offset}`);
  assert.equal(report.summary.overlaps, 0, 'breath over silence is not an overlap');
  assert.equal(report.summary.inSync, 2);
});

test('with breaths kept clear, a breath never plays over the line before', async () => {
  clearClipCache();
  const { deps } = breathyDeps(0.6);
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 2.5, 3.5, 'bbbbbbbbbb')];
  const { report } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice, debug: true }, deps);
  const [first, second] = report.audioDebug.lines;
  const gap = (second.timelineStartSample - first.timelineEndSample) / RATE;
  assert.ok(gap >= minimumGap(0.5) - 2 / RATE, `gap ${gap}`);
  assert.equal(report.join.breathClear, true);
});

test('a join tighter than the review limit, and a line pushed late, are flagged', async () => {
  clearClipCache();
  const { deps } = fakeDeps();
  // 20 characters take 1.6 s; line 1 has 0:01 to 0:02.5 before line 2.
  const segments = [cue(1, 1, 2, 'x'.repeat(20)), cue(2, 2.5, 3.5, 'yyyyy')];
  const join = { minGap: 0.04, gapShare: 0, tailFloorDb: -60, tailHold: 0, flagJoin: 0.4, maxLateStart: 0.05 };
  const { report } = await runSync({ segments, sourceDuration: 5, sampleRate: RATE, voice, suggest: false, join }, deps);
  assert.equal(report.units[0].tightJoin, true);
  assert.ok(report.units[0].joinAfter < 0.4);
  assert.equal(report.units[1].joinAfter, null);
  assert.equal(report.units[1].late, true);
  assert.equal(report.summary.tightJoins, 1);
  assert.equal(report.summary.late, 1);
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

  assert.deepEqual(voiced, ['x'.repeat(30) + '.', 'yyyyyyyyyy.', 'zzzzzzzzzz.'], 'each line voiced once, as written and ending a sentence');
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
  assert.deepEqual(retake.voiced, ['aaaaaaaaaa.']);
  assert.equal(lines[0].seed, 99);
  assert.equal(report.units[0].key, '1');

  // The same retake again is already voiced; a changed line 3 is the only new take.
  const changed = fakeDeps();
  const edited = [segments[0], segments[1], cue(3, 7, 8, 'cccc')];
  await runSync({ segments: edited, sourceDuration: 9, sampleRate: RATE, voice, lineSeeds: { 1: 99 } }, changed.deps);
  assert.deepEqual(changed.voiced, ['cccc.']);
});

/** A voice that cuts off the takes whose seed is in `cutSeeds` (no seed counts as -1). */
const cuttingDeps = (cutSeeds) => {
  const { deps } = fakeDeps();
  const requests = [];
  deps.voiceLines = async (lines, { onLine }) =>
    lines.map((line, n) => {
      requests.push({ text: line.text, seed: line.seed });
      onLine(n + 1);
      const cut = cutSeeds.includes(Number.isInteger(line.seed) ? line.seed : -1);
      return clip({ lead: 0.15, tone: (line.text.length - 1) * SECONDS_PER_CHAR, tail: cut ? 0 : 0.15 });
    });
  return { deps, requests };
};

test('a take the voice cut off mid-word is voiced again with another seed, and the good take is used', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbb')];
  const { deps, requests } = cuttingDeps([-1]);
  // Line 2 has its own seed, which the voice doesn't cut off.
  const { report } = await runSync({ segments, sourceDuration: 7, sampleRate: RATE, voice, lineSeeds: { 2: 5 } }, deps);
  assert.deepEqual(requests.map((r) => r.text), ['aaaaaaaaaa.', 'bbbbbbbbbb.', 'aaaaaaaaaa.']);
  assert.ok(Number.isInteger(requests[2].seed) && requests[2].seed !== 5);
  assert.equal(report.units[0].retakes, 1);
  assert.equal(report.units[0].cutOff, false);
  assert.equal(report.units[1].retakes, 0);
  assert.equal(report.summary.retaken, 1);
  assert.equal(report.summary.cutOff, 0);

  // A second sync finds the retake in the cache: nothing is voiced again.
  const again = cuttingDeps([-1]);
  const second = await runSync({ segments, sourceDuration: 7, sampleRate: RATE, voice, lineSeeds: { 2: 5 } }, again.deps);
  assert.equal(again.requests.length, 0);
  assert.equal(second.report.units[0].cutOff, false);
});

test('a line cut off in every take is retaken MAX_RETAKES times, then reported', async () => {
  clearClipCache();
  const { deps, requests } = cuttingDeps([-1, 7919, 15838]);
  const { report } = await runSync({ segments: [cue(1, 1, 2, 'aaaaaaaaaa')], sourceDuration: 4, sampleRate: RATE, voice }, deps);
  assert.equal(requests.length, 1 + MAX_RETAKES);
  assert.equal(report.units[0].retakes, MAX_RETAKES);
  assert.equal(report.units[0].cutOff, true);
  assert.equal(report.summary.cutOff, 1);
});

test('a cut-off take the user locked in Edit timing is kept as it is', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa')];
  const { deps, requests } = cuttingDeps([-1]);
  // The take as the sync fits it, cut off, is the one the user locked.
  const take = prepareClip(clip({ lead: 0.15, tone: 10 * SECONDS_PER_CHAR, tail: 0 }), RATE, {
    tailQuiet: dbToAmplitude(DEFAULT_JOIN_SETTINGS.tailFloorDb),
    tailHold: DEFAULT_JOIN_SETTINGS.tailHold,
  });
  const locked = { 1: { hash: clipHash(take.samples), cuts: [], crossfade: 0, start: 1, end: 2.5 } };
  const { report } = await runSync({ segments, sourceDuration: 4, sampleRate: RATE, voice, locked }, deps);
  assert.equal(requests.length, 1, 'no retake');
  assert.equal(report.units[0].retakes, 0);
  assert.equal(report.units[0].cutOff, true);
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

test('a line that ends well before the original speaker stops is flagged short and given a fuller wording', async () => {
  clearClipCache();
  // The speaker talks for 3 s; 10 characters take 0.8 s, leaving 2.2 s unsaid.
  const segments = [cue(1, 1, 4, 'x'.repeat(10)), cue(2, 6, 7, 'yyyyyyyyyy')];
  const requests = [];
  const { deps, voiced } = fakeDeps({
    shorten: async () => assert.fail('nothing runs long'),
    lengthen: async (req) => {
      requests.push(req);
      return 'x'.repeat(req.targetChars);
    },
  });
  const { report } = await runSync({ segments, sourceDuration: 8, sampleRate: RATE, voice }, deps);

  assert.deepEqual(voiced, ['x'.repeat(10) + '.', 'yyyyyyyyyy.'], 'voiced as written, ending a sentence');
  const line = report.units[0];
  assert.equal(line.short, true);
  assert.equal(line.exceeded, false);
  assert.ok(Math.abs(line.shortBy - 2.2) < 0.01, `short by ${line.shortBy}`);
  assert.ok(Math.abs(line.speech - 0.8) < 0.01, `speech ${line.speech}`);
  // Fill 95% of the 3 s at the voice's own 12.5 chars/s: 35 characters.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourceText, 'src 1');
  assert.equal(requests[0].targetChars, 35);
  assert.equal(line.targetChars, 35);
  assert.equal(line.suggestion, 'x'.repeat(35));
  assert.equal(report.units[1].short, false);
  assert.equal(report.summary.short, 1);
  assert.equal(report.summary.suggestionsAsked, 1);
  assert.equal(report.summary.suggested, 1);
});

test('a fuller wording never aims past the time the line has before the next one', async () => {
  clearClipCache();
  // 11.5 s spoken and the next line 0.4 s later: filling 95% of the speech would leave no breath before it.
  const segments = [cue(1, 0.2, 11.7, 'x'.repeat(10)), cue(2, 12.1, 13, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({ lengthen: async (req) => 'x'.repeat(req.targetChars) });
  const { report } = await runSync({ segments, sourceDuration: 14, sampleRate: RATE, voice }, deps);
  assert.equal(report.units.length, 2);
  const line = report.units[0];
  assert.equal(line.short, true);
  const fill = Math.floor((10 * 11.5 * 0.95) / line.speech);
  assert.ok(line.targetChars > 10 && line.targetChars < fill, `target ${line.targetChars}, fill ${fill}: the slot sets the limit`);
  // Voiced at the same rate, the fuller line ends before the next one starts, less the breath kept there.
  assert.ok(0.2 + line.targetChars * SECONDS_PER_CHAR < 12.1 - minimumGap(0.4));
});

test('with fuller lines off, a short line is still flagged but nothing is asked', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 4, 'x'.repeat(10)), cue(2, 6, 7, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({ lengthen: async () => assert.fail('should not ask for fuller lines') });
  const { report } = await runSync({ segments, sourceDuration: 8, sampleRate: RATE, suggestLonger: false, voice }, deps);
  assert.equal(report.units[0].short, true);
  assert.equal(report.units[0].suggestion, null);
  assert.equal(report.summary.suggestionsAsked, 0);
});

test('a line only a little quicker than the original is not short', async () => {
  clearClipCache();
  // 2.4 s of speech for 3 s spoken: 80%.
  const { deps } = fakeDeps({ lengthen: async () => assert.fail('not short') });
  const { report } = await runSync({ segments: [cue(1, 1, 4, 'x'.repeat(30))], sourceDuration: 6, sampleRate: RATE, voice }, deps);
  assert.equal(report.units[0].short, false);
  assert.equal(report.units[0].shortBy, 0);
  assert.equal(report.units[0].targetChars, null);
});

test('a suggestion held back for changing the meaning is counted, and none is shown', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 4, 'x'.repeat(10)), cue(2, 6, 7, 'yyyyyyyyyy')];
  const { deps } = fakeDeps({ lengthen: async () => ({ line: null, reason: 'meaning' }) });
  const { report } = await runSync({ segments, sourceDuration: 8, sampleRate: RATE, voice }, deps);
  assert.equal(report.units[0].short, true);
  assert.equal(report.units[0].suggestion, null);
  assert.equal(report.summary.meaningRejected, 1);
  assert.equal(report.summary.suggestionError, null);
});

// Breath removal works on real-rate audio: a voiced vowel is a low tone, a breath and an "s" are noise.
const BREATH_RATE = 44100;
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 2 - 1;
const sound = (parts) => {
  const total = parts.reduce((sum, part) => sum + Math.round(part.seconds * BREATH_RATE), 0);
  const out = new Float32Array(total);
  const noise = seeded(7);
  let at = 0;
  for (const { seconds, kind, level = 0 } of parts) {
    const n = Math.round(seconds * BREATH_RATE);
    for (let i = 0; i < n; i++) {
      out[at + i] = kind === 'voice' ? level * Math.sin((2 * Math.PI * 180 * i) / BREATH_RATE) : kind === 'noise' ? level * noise() : 0;
    }
    at += n;
  }
  return out;
};
const levelOf = (samples, from, to) => {
  let peak = 0;
  for (let i = Math.round(from * BREATH_RATE); i < Math.round(to * BREATH_RATE); i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
};

test('removeBreaths silences a breath before the first word and in a pause, and leaves the words alone', () => {
  const clip = sound([
    { seconds: 0.05, kind: 'silence' },
    { seconds: 0.3, kind: 'noise', level: 0.02 }, // breath in
    { seconds: 0.1, kind: 'silence' },
    { seconds: 0.5, kind: 'voice', level: 0.3 },
    { seconds: 0.15, kind: 'silence' },
    { seconds: 0.25, kind: 'noise', level: 0.015 }, // breath between words
    { seconds: 0.1, kind: 'silence' },
    { seconds: 0.5, kind: 'voice', level: 0.3 },
    { seconds: 0.1, kind: 'silence' },
  ]);
  const { samples, removed } = removeBreaths(clip, BREATH_RATE);
  assert.equal(removed, 2);
  assert.equal(levelOf(samples, 0.06, 0.34), 0, 'the breath before the line is gone');
  assert.equal(levelOf(samples, 1.11, 1.29), 0, 'the breath in the pause is gone');
  for (const [from, to] of [[0.45, 0.95], [1.4, 1.9]]) {
    for (let i = Math.round(from * BREATH_RATE); i < Math.round(to * BREATH_RATE); i++) assert.equal(samples[i], clip[i]);
  }
  const prepared = prepareClip(samples, BREATH_RATE);
  assert.ok(prepared.lead < 0.12, `the clip now starts at its first word (lead ${prepared.lead.toFixed(3)} s)`);
});

test('removeBreaths keeps an "s" that runs into its word, a loud noise, and a quiet voiced word', () => {
  const clip = sound([
    { seconds: 0.1, kind: 'silence' },
    { seconds: 0.15, kind: 'noise', level: 0.03 }, // "s" straight into the vowel
    { seconds: 0.4, kind: 'voice', level: 0.3 },
    { seconds: 0.2, kind: 'silence' },
    { seconds: 0.2, kind: 'noise', level: 0.2 }, // too loud to be a breath
    { seconds: 0.2, kind: 'silence' },
    { seconds: 0.3, kind: 'voice', level: 0.01 }, // a soft, voiced word
    { seconds: 0.1, kind: 'silence' },
  ]);
  const { samples, removed } = removeBreaths(clip, BREATH_RATE);
  assert.equal(removed, 0);
  assert.equal(samples, clip, 'nothing removed, nothing copied');
});

test('removeBreaths leaves silence and very short clips as they are', () => {
  assert.equal(removeBreaths(new Float32Array(1000), BREATH_RATE).removed, 0);
  assert.equal(removeBreaths(new Float32Array(10), BREATH_RATE).removed, 0);
});

test('removeBreaths finds a breath on a voice with room noise, and keeps an "s" standing on its own', () => {
  const clip = sound([
    { seconds: 0.5, kind: 'voice', level: 0.3 },
    { seconds: 0.15, kind: 'silence' },
    { seconds: 0.2, kind: 'noise', level: 0.012 }, // breath, about -28 dB below the speech
    { seconds: 0.15, kind: 'silence' },
    { seconds: 0.5, kind: 'voice', level: 0.3 },
    { seconds: 0.1, kind: 'silence' },
    { seconds: 0.15, kind: 'noise', level: 0.05 }, // an "s" about -18 dB below, apart from the vowel
    { seconds: 0.1, kind: 'silence' },
    { seconds: 0.5, kind: 'voice', level: 0.3 },
  ]);
  // Room tone under everything, about -50 dBFS: louder than true silence.
  const room = seeded(99);
  for (let i = 0; i < clip.length; i++) clip[i] += 0.003 * room();
  const { samples, removed } = removeBreaths(clip, BREATH_RATE);
  assert.equal(removed, 1);
  assert.ok(levelOf(samples, 0.67, 0.83) < 0.001, 'the breath is gone');
  const s = Math.round(1.66 * BREATH_RATE);
  for (let i = s; i < Math.round(1.79 * BREATH_RATE); i++) assert.equal(samples[i], clip[i], 'the "s" is kept');
});

test('paces follow each speaker, then each line as far as asked, and stay in range', () => {
  const speakers = ['A', 'A', 'A', 'B'];
  const ratios = [1.1, 1.2, 1.3, 0.8];
  assert.deepEqual(matchPaces(ratios, speakers, 0).paces, [1.2, 1.2, 1.2, 0.8], "nothing followed: every line at its speaker's median");
  assert.deepEqual(matchPaces(ratios, speakers, 1).paces, [1.1, 1.2, 1.3, 0.8], 'all followed: every line at its own');
  assert.deepEqual(matchPaces(ratios, speakers, 0).speakers, { A: 1.2, B: 0.8 });
  assert.deepEqual(matchPaces([3, 0.1, 1.01, 0], ['A', 'B', 'C', 'D'], 1).paces, [1.5, 0.6, 1, 1], 'held in range; too close to 1 or unmeasured is left alone');
});

test('matching the original pace voices each line again at the speed of the original speaker', async () => {
  clearClipCache();
  // Each line takes 1.2 s to say where the original speaker took 1 s.
  const segments = [cue(1, 1, 2, 'a'.repeat(15)), cue(2, 4, 5, 'b'.repeat(15))];
  const { deps, paces } = fakeDeps({ canPace: () => true });
  const { report } = await runSync({ segments, sourceDuration: 7, sampleRate: RATE, voice, paceMatch: { follow: 1 } }, deps);
  assert.deepEqual(paces.slice(2), [1.2, 1.2], 'voiced again, faster');
  for (const unit of report.units) {
    assert.equal(unit.pace, 1.2);
    assert.ok(Math.abs(unit.speech - 1) < 0.05, `speech ${unit.speech}`);
  }
  assert.equal(report.summary.paced, 2);
  assert.deepEqual(Object.keys(report.pace.speakers), ['Speaker']);
});

test('without pace matching, or with a voice that takes no speed, every line is voiced once as it is', async () => {
  const segments = [cue(1, 1, 2, 'a'.repeat(15)), cue(2, 4, 5, 'b'.repeat(15))];
  for (const [params, canPace] of [
    [{}, () => true],
    [{ paceMatch: { follow: 1 } }, () => false],
  ]) {
    clearClipCache();
    const { deps, paces } = fakeDeps({ canPace });
    const { report } = await runSync({ segments, sourceDuration: 7, sampleRate: RATE, voice, ...params }, deps);
    assert.deepEqual(paces, [1, 1]);
    assert.equal(report.summary.paced, 0);
    assert.ok(report.units.every((unit) => unit.pace === 1));
  }
});
