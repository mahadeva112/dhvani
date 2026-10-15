import { silenceLevel } from '../server/lib/syncRender.js';
import type { SyncEditPart } from './syncEditModel.ts';

/**
 * Tighten silences in Edit timing: by hand, on the lines the user picks.
 *
 * A part is split where its line goes quiet and the silence between the
 * pieces is taken out; the pieces then play back to back, the first sound
 * where it was. Only silence is cut: every piece is the line's own samples,
 * at the part's own speed, gain and fades, so nothing the voice said changes.
 * Words forced alignment heard (`protect`) are never cut into, nor `margin`
 * either side of them.
 */

export interface TightenSettings {
  /** Silence is below this (dBFS), or 'auto': a little above the line's own room tone (see silenceLevel). */
  levelDb: number | 'auto';
  /** A pause between sounds keeps at least this, in seconds. */
  minPause: number;
  /** Silence left before and after every sound, in seconds. */
  margin: number;
}

export const DEFAULT_TIGHTEN: TightenSettings = { levelDb: 'auto', minPause: 0.12, margin: 0.06 };

/** Silence shorter than this is a gap inside a word, not a pause. */
const MIN_SILENCE_SECONDS = 0.02;

export interface TightenedPart {
  /** The part's pieces, back to back from where its first sound was. */
  parts: SyncEditPart[];
  /** What is cut, as seconds into the line. */
  cuts: { from: number; to: number }[];
  /** Seconds the part now ends sooner on the timeline. */
  removed: number;
  /** The silence level used, in dBFS. */
  levelDb: number;
}

/** The silence level `settings` asks for on `samples` (a whole line), in dBFS. */
export const tightenLevelDb = (samples: Float32Array, sampleRate: number, settings: TightenSettings) =>
  settings.levelDb === 'auto' ? 20 * Math.log10(silenceLevel(samples, sampleRate)) : settings.levelDb;

/**
 * `part` of a line with its silences taken out. `samples` are the whole
 * line's at `sampleRate`; `protect` the line's words as `{ start, end }`
 * seconds into it. A part with nothing to cut comes back as it was.
 */
export const tightenPart = (
  samples: Float32Array,
  sampleRate: number,
  part: SyncEditPart,
  settings: TightenSettings,
  protect: { start: number; end: number }[] = []
): TightenedPart => {
  const levelDb = tightenLevelDb(samples, sampleRate, settings);
  const level = 10 ** (levelDb / 20);
  const margin = Math.max(0, settings.margin);
  const keep = Math.max(settings.minPause, 2 * margin);
  const from = Math.max(0, Math.round(part.from * sampleRate));
  const to = Math.min(samples.length, Math.round(part.to * sampleRate));
  const guards = protect.map((word) => ({ start: word.start - margin, end: word.end + margin }));

  // Quiet stretches inside the part, in seconds into the line, less any word.
  const quiet: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    const silent = i < to && Math.abs(samples[i]) < level;
    if (silent && start < 0) start = i;
    if (!silent && start >= 0) {
      let pieces = [{ from: start / sampleRate, to: i / sampleRate }];
      for (const guard of guards) {
        pieces = pieces.flatMap((p) =>
          guard.end <= p.from || guard.start >= p.to ? [p] : [{ from: p.from, to: guard.start }, { from: guard.end, to: p.to }].filter((q) => q.to > q.from)
        );
      }
      quiet.push(...pieces.filter((p) => p.to - p.from >= MIN_SILENCE_SECONDS));
      start = -1;
    }
  }

  const head = part.from;
  const tail = part.to;
  const cuts: { from: number; to: number }[] = [];
  for (const q of quiet) {
    const atHead = q.from <= head + 1 / sampleRate;
    const atTail = q.to >= tail - 1 / sampleRate;
    if (atHead && atTail) continue; // all silence: left as it is
    if (atHead) {
      if (q.to - margin > q.from) cuts.push({ from: q.from, to: q.to - margin });
    } else if (atTail) {
      if (q.from + margin < q.to) cuts.push({ from: q.from + margin, to: q.to });
    } else if (q.to - q.from > keep) {
      const take = q.to - q.from - keep;
      const mid = (q.from + q.to) / 2;
      cuts.push({ from: mid - take / 2, to: mid + take / 2 });
    }
  }
  if (cuts.length === 0) return { parts: [part], cuts, removed: 0, levelDb };

  // What is left, back to back from where its first sound was.
  const kept: { from: number; to: number }[] = [];
  let at = head;
  for (const cut of cuts) {
    if (cut.from > at) kept.push({ from: at, to: cut.from });
    at = cut.to;
  }
  if (tail > at) kept.push({ from: at, to: tail });
  let time = part.start + (kept[0].from - head) / part.rate;
  const parts = kept.map((piece, n) => {
    const next: SyncEditPart = {
      ...part,
      id: `${part.id}~${n}`,
      start: time,
      from: piece.from,
      to: piece.to,
      fadeIn: n === 0 ? part.fadeIn : 0,
      fadeOut: n === kept.length - 1 ? part.fadeOut : 0,
    };
    time += (piece.to - piece.from) / part.rate;
    return next;
  });
  const oldEnd = part.start + (tail - head) / part.rate;
  return { parts, cuts, removed: Math.max(0, oldEnd - time), levelDb };
};
