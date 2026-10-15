import test from 'node:test';
import assert from 'node:assert/strict';
import { tightenPart, DEFAULT_TIGHTEN } from './tightenEdit.ts';
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
