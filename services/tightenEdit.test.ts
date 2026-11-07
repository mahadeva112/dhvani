import test from 'node:test';
import assert from 'node:assert/strict';
import { tightenPart, closeUpParts, quietSpans, DEFAULT_TIGHTEN, DEFAULT_SPLIT } from './tightenEdit.ts';
import type { SyncEditPart } from './syncEditModel.ts';

const RATE = 8000;

/** Room tone at about -66 dB, with a 220 Hz word at each `[from, to]` second. */
const line = (seconds: number, words: [number, number][]) => {
  const samples = new Float32Array(Math.round(seconds * RATE));
  let seed = 3;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = ((seed / 2147483647) * 2 - 1) * 0.0005;
  }
  for (const [from, to] of words) for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  return samples;
};

const part = (over: Partial<SyncEditPart> = {}): SyncEditPart => ({ id: 'a#0', start: 10, from: 0, to: 3, rate: 1, gainDb: -2, fadeIn: 0.05, fadeOut: 0.1, muted: false, ...over });
const sounds = (samples: Float32Array) => [...samples].filter((x) => Math.abs(x) > 0.01);
/** The samples the pieces play, in order. */
const played = (samples: Float32Array, parts: SyncEditPart[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...samples.subarray(Math.round(p.from * RATE), Math.round(p.to * RATE)));
  return Float32Array.from(out);
};

test('a long pause and the silence at the ends are cut, the pieces play back to back from the first sound', () => {
  const samples = line(3, [[0.3, 1.0], [2.0, 2.6]]);
  const { parts, removed } = tightenPart(samples, RATE, part(), DEFAULT_TIGHTEN);
  assert.equal(parts.length, 2);
  // The first sound stays where it was on the timeline, less the margin before it.
  assert.ok(Math.abs(parts[0].start - (10 + 0.3 - DEFAULT_TIGHTEN.margin)) < 0.01, `first piece at ${parts[0].start}`);
  // Back to back: each piece starts where the one before ends.
  assert.ok(Math.abs(parts[1].start - (parts[0].start + parts[0].to - parts[0].from)) < 1e-9);
  // The 1 s pause keeps 0.12 s: 0.88 s out, and the 0.4 s tail keeps 0.06 s.
  assert.ok(Math.abs(removed - (0.88 + 0.34)) < 0.01, `removed ${removed}`);
  // Every word sample, in order: nothing said is lost.
  assert.deepEqual(sounds(played(samples, parts)), sounds(samples.subarray(0, 3 * RATE)));
  // The part's own gain and speed stay; its fades stay at its ends.
  assert.equal(parts[0].gainDb, -2);
  assert.equal(parts[0].fadeIn, 0.05);
  assert.equal(parts[0].fadeOut, 0);
  assert.equal(parts[1].fadeOut, 0.1);
});

test('a word forced alignment hears is never cut, however quiet', () => {
  const samples = line(3, [[0.3, 1.0], [2.0, 2.6]]);
  // A whispered word in the pause, below the silence level.
  for (let i = 1.3 * RATE; i < 1.6 * RATE; i++) samples[i] = 0.0008 * Math.sin(i);
  const whisper = samples.slice(1.3 * RATE, 1.6 * RATE);
  const { parts, cuts } = tightenPart(samples, RATE, part(), DEFAULT_TIGHTEN, [{ start: 1.3, end: 1.6 }]);
  for (const cut of cuts) assert.ok(cut.to <= 1.3 - DEFAULT_TIGHTEN.margin + 1e-9 || cut.from >= 1.6 + DEFAULT_TIGHTEN.margin - 1e-9, `cut ${cut.from}-${cut.to}`);
  const out = played(samples, parts);
  assert.ok(out.join(',').includes(whisper.join(',')), 'the whispered word plays whole');
});

test('a stretched part keeps its speed, and a part with nothing to cut comes back as it was', () => {
  const samples = line(3, [[0.3, 1.0], [2.0, 2.6]]);
  const { parts, removed } = tightenPart(samples, RATE, part({ rate: 1.25 }), DEFAULT_TIGHTEN);
  assert.ok(parts.every((p) => p.rate === 1.25));
  assert.ok(Math.abs(removed - (0.88 + 0.34) / 1.25) < 0.01);

  const solid = line(1, [[0, 1]]);
  const same = part({ to: 1 });
  assert.deepEqual(tightenPart(solid, RATE, same, DEFAULT_TIGHTEN).parts, [same]);
  // A higher setting than every pause has: nothing to cut either.
  assert.equal(tightenPart(samples, RATE, part(), { ...DEFAULT_TIGHTEN, minPause: 2 }).cuts.filter((c) => c.from > 1 && c.to < 2).length, 0);
});

test('Split at pauses: cut in the middle of each long pause, every piece where it was, nothing taken out', () => {
  const samples = line(3, [[0.3, 1.0], [1.5, 1.8], [2.0, 2.6]]);
  const { parts, cuts, removed } = tightenPart(samples, RATE, part(), DEFAULT_SPLIT);
  // The 0.5 s pause splits; the 0.2 s one does too (over 0.12 s); the silence at the ends stays on.
  assert.equal(parts.length, 3);
  assert.ok(cuts.every((c) => c.from === c.to));
  assert.ok(Math.abs(cuts[0].from - 1.25) < 0.02, `first split at ${cuts[0].from}`);
  assert.ok(Math.abs(cuts[1].from - 1.9) < 0.02, `second split at ${cuts[1].from}`);
  assert.equal(removed, 0);
  // Back to back in the line and on the timeline: the same samples at the same times.
  assert.equal(parts[0].from, 0);
  assert.equal(parts[2].to, 3);
  for (const [n, p] of parts.entries()) {
    if (n > 0) assert.equal(p.from, parts[n - 1].to);
    assert.ok(Math.abs(p.start - (10 + p.from)) < 1e-9, `piece ${n} at ${p.start}`);
  }
  assert.equal(parts[0].fadeIn, 0.05);
  assert.equal(parts[2].fadeOut, 0.1);
  // A pause shorter than the setting is no pause.
  assert.equal(tightenPart(samples, RATE, part(), { ...DEFAULT_SPLIT, minPause: 0.3 }).parts.length, 2);
  // A word forced alignment hears in the pause is never split.
  const whispered = tightenPart(samples, RATE, part(), DEFAULT_SPLIT, [{ start: 1.0, end: 1.5 }]);
  assert.ok(whispered.cuts.every((c) => c.from < 1.0 || c.from > 1.5));
});

test('Remove with Close up off: the silence goes, every piece stays where it was', () => {
  const samples = line(3, [[0.3, 1.0], [2.0, 2.6]]);
  const packed = tightenPart(samples, RATE, part(), DEFAULT_TIGHTEN);
  const { parts, cuts, removed } = tightenPart(samples, RATE, part(), DEFAULT_TIGHTEN, [], { inPlace: true });
  assert.deepEqual(cuts, packed.cuts);
  assert.equal(removed, 0);
  for (const p of parts) assert.ok(Math.abs(p.start - (10 + p.from)) < 1e-9);
  assert.deepEqual(parts.map((p) => [p.from, p.to]), packed.parts.map((p) => [p.from, p.to]));
});

test('Close up: picked parts play back to back, and the first part after them keeps its place', () => {
  const at = (id: string, start: number, length = 1) => part({ id, start, from: 0, to: length, fadeIn: 0, fadeOut: 0 });
  const lines = [
    { key: '11', parts: [at('11#c0', 0)] },
    { key: '12', parts: [at('12#c0', 2), at('12#c1~0', 4), at('12#c1~1', 5)] },
    { key: '13', parts: [at('13#c0', 9)] },
  ];
  const picked = ['12#c0', '12#c1'];
  const among = (id: string) => picked.some((p) => id === p || id.startsWith(`${p}~`));
  const { parts, moved, shift } = closeUpParts(lines, (p) => among(p.id), 0.12);
  // 12a stays (11 isn't picked), 12b's two pieces move up behind it, 13 stays where it was.
  assert.deepEqual(parts.get('12')?.map((p) => +p.start.toFixed(2)), [2, 3.12, 4.12]);
  assert.equal(parts.has('11'), false);
  assert.equal(parts.has('13'), false);
  assert.equal(moved, 2);
  assert.ok(Math.abs(shift - 0.88) < 1e-9);

  // Every line: each part follows the one before, from the first.
  const all = closeUpParts(lines, () => true, 0.12);
  assert.deepEqual(all.parts.get('12')?.map((p) => +p.start.toFixed(2)), [1.12, 2.24, 3.24]);
  assert.deepEqual(all.parts.get('13')?.map((p) => +p.start.toFixed(2)), [4.36]);
  // A part only ever moves earlier, and one already closer stays.
  assert.equal(closeUpParts([{ key: 'a', parts: [at('a', 0), at('b', 1.05)] }], () => true, 0.12).moved, 0);
});

test('quietSpans finds the pause between two words, where a cut moved by hand snaps', () => {
  const samples = line(3, [[0.3, 1.0], [1.6, 2.6]]);
  const pauses = quietSpans(samples, RATE, 0.5, 2.2);
  const between = pauses.find((p) => p.from >= 0.95 && p.to <= 1.65);
  assert.ok(between, `pauses ${JSON.stringify(pauses)}`);
  // The pause is the gap between the words, and its middle is the cut's place.
  assert.ok(Math.abs((between.from + between.to) / 2 - 1.3) < 0.03, `middle ${(between.from + between.to) / 2}`);
  // Nothing inside a word is called a pause, and nothing outside what was asked.
  const words = [[0.3, 1.0], [1.6, 2.6]];
  for (const p of pauses) {
    assert.ok(p.from >= 0.5 - 1e-9 && p.to <= 2.2 + 1e-9, `pause ${p.from}–${p.to} outside what was asked`);
    assert.ok(words.every(([from, to]) => p.to <= from + 0.01 || p.from >= to - 0.01), `pause ${p.from}–${p.to} runs into a word`);
  }
});

/* ---------- More pauses ---------- */

const OFF = { ...DEFAULT_TIGHTEN, more: 'off' as const };
const NORMAL = { ...DEFAULT_TIGHTEN, more: 'normal' as const };
const STRONG = { ...DEFAULT_TIGHTEN, more: 'strong' as const };
const inner = (cuts: { from: number; to: number }[], from: number, to: number) => cuts.filter((c) => c.from >= from && c.to <= to);
/** Noise at `amplitude` over `[from, to]` seconds of `samples`. */
const noise = (samples: Float32Array, from: number, to: number, amplitude: number, seed = 11) => {
  for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) {
    seed = (seed * 16807) % 2147483647;
    samples[i] = ((seed / 2147483647) * 2 - 1) * amplitude;
  }
  return samples;
};

test('More pauses Off reads silence exactly as before', () => {
  const samples = noise(line(3, [[0.3, 1.0], [2.0, 2.6]]), 1.2, 1.8, 0.008);
  const { more: _more, breaths: _breaths, ...before } = DEFAULT_TIGHTEN;
  for (const silence of ['remove', 'keep'] as const) {
    assert.deepEqual(tightenPart(samples, RATE, part(), { ...OFF, silence }), tightenPart(samples, RATE, part(), { ...before, silence }));
  }
});

test('a pause on room tone above -45 dB is found by More pauses, and missed with it Off', () => {
  // A voice on room tone near -43 dB RMS everywhere it is quiet: louder than the -45 dB ceiling Off reads with.
  const samples = noise(new Float32Array(3 * RATE), 0, 3, 0.012);
  for (const [a, b] of [[0.3, 1.0], [1.8, 2.6]]) for (let i = a * RATE; i < b * RATE; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  assert.equal(inner(tightenPart(samples, RATE, part(), OFF).cuts, 1.0, 1.8).length, 0);
  const found = inner(tightenPart(samples, RATE, part(), NORMAL).cuts, 1.0, 1.8);
  assert.equal(found.length, 1);
  assert.ok(found[0].to - found[0].from > 0.5, `cut ${found[0].to - found[0].from}`);
});

test('More pauses never loses a cut Off makes, and never cuts into a word', () => {
  for (let n = 0; n < 12; n++) {
    const pause = 0.2 + n * 0.07;
    const samples = noise(line(4, [[0.3, 1.0], [1.0 + pause, 2.2], [2.6, 3.6]]), 1.0, 1.0 + pause, 0.0005 + n * 0.0008, 5 + n);
    const words = [{ start: 0.3, end: 1.0 }, { start: 1.0 + pause, end: 2.2 }, { start: 2.6, end: 3.6 }];
    const off = tightenPart(samples, RATE, part({ to: 4 }), OFF, words).cuts;
    for (const settings of [NORMAL, STRONG]) {
      const more = tightenPart(samples, RATE, part({ to: 4 }), settings, words).cuts;
      for (const cut of off) assert.ok(more.some((m) => m.to >= cut.from && m.from <= cut.to), `pause ${pause}: cut ${cut.from}-${cut.to} kept`);
      for (const cut of more) for (const w of words) assert.ok(cut.to <= w.start || cut.from >= w.end, `cut ${cut.from}-${cut.to} into a word`);
    }
  }
});

test('a little hiss inside a pause does not break it in two with More pauses', () => {
  const samples = line(3, [[0.3, 1.0], [2.0, 2.6]]);
  // A soft click halfway through the pause, just above the line's silence level.
  noise(samples, 1.48, 1.52, 0.0035);
  const split = { ...NORMAL, silence: 'keep' as const };
  const offSplits = inner(tightenPart(samples, RATE, part(), { ...split, more: 'off' }).cuts, 1.0, 2.0);
  const moreSplits = inner(tightenPart(samples, RATE, part(), split).cuts, 1.0, 2.0);
  assert.equal(moreSplits.length, 1, 'one pause, one split');
  assert.ok(offSplits.length >= moreSplits.length);
});

test('a breath in a pause counts as silence, unless that is turned off; an "s" never does', () => {
  // A breath: 0.25 s of soft noise alone in the pause, room tone either side.
  const samples = noise(line(3, [[0.3, 1.0], [2.0, 2.6]]), 1.35, 1.6, 0.01);
  const withBreath = inner(tightenPart(samples, RATE, part(), NORMAL).cuts, 1.0, 2.0);
  assert.equal(withBreath.length, 1);
  assert.ok(withBreath[0].from < 1.35 && withBreath[0].to > 1.6, 'the cut runs through the breath');
  const kept = inner(tightenPart(samples, RATE, part(), { ...NORMAL, breaths: false }).cuts, 1.0, 2.0);
  assert.ok(kept.every((c) => c.to <= 1.35 || c.from >= 1.6), 'the breath stays');
  // A loud "s" (noise near speech level) running into a word is never taken for a breath.
  const s = noise(line(3, [[0.3, 1.0], [2.0, 2.6]]), 1.85, 2.0, 0.2);
  for (const cut of tightenPart(s, RATE, part(), NORMAL).cuts) assert.ok(cut.to <= 1.85 || cut.from >= 2.0, `cut ${cut.from}-${cut.to} into the "s"`);
});

test('with the words checked, a quiet gap after a comma or a danda is a pause; one with no mark is not', () => {
  const samples = line(3, [[0.3, 1.0], [1.1, 1.9], [2.0, 2.8]]);
  // Room noise in both gaps, louder than the silence level: only the marks tell them apart.
  noise(samples, 1.0, 1.1, 0.004, 7);
  noise(samples, 1.9, 2.0, 0.004, 9);
  const words = [
    { start: 0.3, end: 1.0, text: 'जन्म,' },
    { start: 1.1, end: 1.9, text: 'से' },
    { start: 2.0, end: 2.8, text: 'लेकर।' },
  ];
  const settings = { ...NORMAL, silence: 'keep' as const, minPause: 0.04, margin: 0.02 };
  const splits = tightenPart(samples, RATE, part(), settings, words).cuts;
  assert.equal(inner(splits, 1.0, 1.1).length, 1, 'split after the comma');
  assert.equal(inner(splits, 1.9, 2.0).length, 0, 'no split between words with no mark');
  assert.equal(inner(tightenPart(samples, RATE, part(), { ...settings, more: 'off' }, words).cuts, 1.0, 1.1).length, 0);
});

test('split only needs no margin: a short gap between checked words is split, and the split never falls in a word', () => {
  // Words 0.1 s apart: too close for 60 ms either side of each word, but a pause of its own.
  const samples = line(3, [[0.3, 1.0], [1.15, 1.9], [2.05, 2.8]]);
  const words = [{ start: 0.3, end: 1.0 }, { start: 1.15, end: 1.9 }, { start: 2.05, end: 2.8 }];
  for (const more of ['off', 'normal'] as const) {
    const settings = { ...DEFAULT_SPLIT, more, minPause: 0.08 };
    const splits = tightenPart(samples, RATE, part(), settings, words).cuts.filter((c) => c.from > 0.3 && c.to < 2.8);
    assert.equal(splits.length, 2, `${more}: a split in each gap`);
    for (const split of splits) for (const w of words) assert.ok(split.from <= w.start || split.from >= w.end, `${more}: split ${split.from} in a word`);
  }
  // Remove still keeps the margin either side of every word.
  for (const cut of tightenPart(samples, RATE, part(), { ...DEFAULT_TIGHTEN, minPause: 0.04 }, words).cuts) {
    for (const w of words) assert.ok(cut.to <= w.start - DEFAULT_TIGHTEN.margin + 1e-9 || cut.from >= w.end + DEFAULT_TIGHTEN.margin - 1e-9, `cut ${cut.from}-${cut.to}`);
  }
});
