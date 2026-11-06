import { breathSpans, lineLevelsDb, silenceLevel, quietStretches } from '../server/lib/syncRender.js';
import { partEnd, type SyncEditPart } from './syncEditModel.ts';

/**
 * Tighten silences in Edit timing: by hand, on the lines the user picks.
 *
 * A part is split where its line goes quiet and the silence between the
 * pieces is taken out; the pieces then play back to back, the first sound
 * where it was. Only silence is cut: every piece is the line's own samples,
 * at the part's own speed, gain and fades, so nothing the voice said changes.
 * Words forced alignment heard (`protect`) are never cut into, nor `margin`
 * either side of them. Silence is read in short windows (quietStretches, as
 * Sync reads it), so a pause on room tone with a little hiss or a click in it
 * is still one pause.
 *
 * Split at pauses (D) uses the same reading but takes nothing out: the part is
 * cut in the middle of every pause longer than `minPause`, and each piece
 * stays where it was, as REAPER's Dynamic split does without "Remove silent
 * areas".
 *
 * More pauses (`more`: Off, Normal or Strong) finds the pauses that reading
 * misses, on top of every one it finds: on Auto the silence level follows the
 * line's own room tone without the -45 dBFS ceiling, and once a pause has
 * started it lasts while the audio stays a little above that (a second, close
 * level, as REAPER's gate has); a breath counts as silence (`breaths`, by the
 * rule Sync silences breaths with, so an "s" or "sh" never does); and, with
 * the words checked, a gap after a comma or a danda counts when it is quiet
 * next to the speech. Off reads silence exactly as before.
 */

/** More pauses: Off reads silence as before; Normal and Strong find the pauses that misses. */
export type MorePauses = 'off' | 'normal' | 'strong';

/**
 * The silence level More pauses reads with on Auto, in dB: `lift` above the
 * line's room tone, at least `belowSpeech` under its speech, never louder
 * than CEILING_DB. A started pause lasts while the audio stays within
 * HOLD_DB of that, and HOLD_BELOW_SPEECH_DB under the speech.
 */
export const MORE_PAUSES: Record<Exclude<MorePauses, 'off'>, { lift: number; belowSpeech: number }> = {
  normal: { lift: 10, belowSpeech: 30 },
  strong: { lift: 14, belowSpeech: 25 },
};
const CEILING_DB = -30;
const HOLD_DB = 6;
const HOLD_BELOW_SPEECH_DB = 20;
/** A gap after a comma or a danda counts as a pause when it is at least this long and this far (dB) below the speech. */
const PUNCTUATION_GAP_SECONDS = 0.06;
const PUNCTUATION_GAP_BELOW_SPEECH_DB = 25;
/** A word that ends a clause: a comma, stop, danda (। ॥), Arabic comma, dash, colon or semicolon, then any closing quote. */
const PAUSE_MARK = /[,.;:!?।॥،—–-]["'’”)]*$/u;

export interface TightenSettings {
  /** Silence is below this (dBFS), or 'auto': a little above the line's own room tone (see silenceLevel). */
  levelDb: number | 'auto';
  /** A pause between sounds keeps at least this, in seconds. */
  minPause: number;
  /** Silence left before and after every sound, in seconds. */
  margin: number;
  /** 'remove': the silence is taken out; 'keep': the part is only split, in the middle of each pause. */
  silence: 'remove' | 'keep';
  /** More pauses (see above); absent is Off. */
  more?: MorePauses;
  /** With More pauses: a breath counts as silence. */
  breaths?: boolean;
}

export const DEFAULT_TIGHTEN: TightenSettings = { levelDb: 'auto', minPause: 0.12, margin: 0.06, silence: 'remove', more: 'normal', breaths: true };
/** Split at pauses: a pause is one when it runs longer than `minPause`, and nothing is taken out. */
export const DEFAULT_SPLIT: TightenSettings = { ...DEFAULT_TIGHTEN, silence: 'keep' };

/** Silence shorter than this is a gap inside a word, not a pause. */
const MIN_SILENCE_SECONDS = 0.02;

export interface TightenedPart {
  /** The part's pieces, back to back from where its first sound was. */
  parts: SyncEditPart[];
  /**
   * What is cut, as seconds into the line; a split that takes nothing out has
   * `from` equal to `to`. `pause` is the quiet stretch it was made in;
   * `extra` marks one found by More pauses only (see markExtraCuts).
   */
  cuts: { from: number; to: number; pause?: { from: number; to: number }; extra?: boolean }[];
  /** Seconds the part now ends sooner on the timeline. */
  removed: number;
  /** The silence level used, in dBFS. */
  levelDb: number;
}

type LineLevels = { floor: number; speech: number } | null;
const moreOf = (settings: TightenSettings): Exclude<MorePauses, 'off'> | null =>
  settings.more === 'normal' || settings.more === 'strong' ? settings.more : null;

/**
 * The silence level `settings` asks for on `samples` (a whole line), in dBFS.
 * With More pauses on Auto: above the line's room tone (MORE_PAUSES), and
 * never under the level Off reads with, so every pause Off finds is found.
 */
export const tightenLevelDb = (samples: Float32Array, sampleRate: number, settings: TightenSettings) => {
  if (settings.levelDb !== 'auto') return settings.levelDb;
  const plain = 20 * Math.log10(silenceLevel(samples, sampleRate));
  const more = moreOf(settings);
  const levels = more ? (lineLevelsDb(samples, sampleRate) as LineLevels) : null;
  if (!more || !levels) return plain;
  const { lift, belowSpeech } = MORE_PAUSES[more];
  return Math.max(plain, Math.min(levels.floor + lift, levels.speech - belowSpeech, CEILING_DB));
};

/** The level a started pause lasts below with More pauses, in dBFS; null without. */
const holdLevelDb = (samples: Float32Array, sampleRate: number, settings: TightenSettings, levelDb: number) => {
  if (!moreOf(settings)) return null;
  const levels = lineLevelsDb(samples, sampleRate) as LineLevels;
  const hold = Math.min(levelDb + HOLD_DB, levels ? levels.speech - HOLD_BELOW_SPEECH_DB : levelDb + HOLD_DB);
  return hold > levelDb ? hold : null;
};

/** Spans (seconds) joined where they touch or overlap, in order. */
const union = (spans: { from: number; to: number }[]) => {
  const out: { from: number; to: number }[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ ...span });
  }
  return out;
};

/**
 * What More pauses adds to the quiet stretches, as seconds into the line:
 * breaths, and gaps after a comma or a danda (between `words`, as forced
 * alignment heard them) that are quiet next to the speech.
 */
const extraPauses = (samples: Float32Array, sampleRate: number, settings: TightenSettings, words: { start: number; end: number; text?: string }[]) => {
  if (!moreOf(settings)) return [];
  const spans: { from: number; to: number }[] = [];
  if (settings.breaths !== false) {
    for (const breath of breathSpans(samples, sampleRate) as { start: number; end: number }[]) spans.push({ from: breath.start / sampleRate, to: breath.end / sampleRate });
  }
  const levels = lineLevelsDb(samples, sampleRate) as LineLevels;
  if (!levels) return spans;
  const limit = 10 ** ((levels.speech - PUNCTUATION_GAP_BELOW_SPEECH_DB) / 20);
  const sorted = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  sorted.slice(1).forEach((next, n) => {
    const prev = sorted[n];
    if (typeof prev.text !== 'string' || !PAUSE_MARK.test(prev.text.trim()) || next.start - prev.end < PUNCTUATION_GAP_SECONDS) return;
    const a = Math.max(0, Math.round(prev.end * sampleRate));
    const b = Math.min(samples.length, Math.round(next.start * sampleRate));
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    if (b > a && Math.sqrt(sum / (b - a)) < limit) spans.push({ from: prev.end, to: next.start });
  });
  return spans;
};

/**
 * The pauses between `from` and `to` (seconds into the line), at the line's
 * own silence level, as seconds into the line: where a cut goes through no
 * sound. Split at pauses reads silence the same way.
 */
export const quietSpans = (samples: Float32Array, sampleRate: number, from: number, to: number): { from: number; to: number }[] => {
  // Where a cut goes through no sound: read as before, without More pauses.
  const level = 10 ** (tightenLevelDb(samples, sampleRate, { ...DEFAULT_SPLIT, more: 'off' }) / 20);
  return quietStretches(samples, sampleRate, level, { from: from * sampleRate, to: to * sampleRate })
    .map((stretch: { start: number; end: number }) => ({ from: stretch.start / sampleRate, to: stretch.end / sampleRate }))
    .filter((pause: { from: number; to: number }) => pause.to - pause.from >= MIN_SILENCE_SECONDS);
};

/**
 * `part` of a line with its silences taken out (or, with `silence: 'keep'`,
 * split at them). `samples` are the whole line's at `sampleRate`; `protect`
 * the line's words as `{ start, end }` seconds into it. The pieces play back
 * to back from the first sound, or with `inPlace` (and always when only
 * split) each where it was. A part with nothing to cut comes back as it was.
 */
export const tightenPart = (
  samples: Float32Array,
  sampleRate: number,
  part: SyncEditPart,
  settings: TightenSettings,
  protect: { start: number; end: number; text?: string }[] = [],
  { inPlace = false }: { inPlace?: boolean } = {}
): TightenedPart => {
  const splitOnly = settings.silence === 'keep';
  const levelDb = tightenLevelDb(samples, sampleRate, settings);
  const level = 10 ** (levelDb / 20);
  const holdDb = holdLevelDb(samples, sampleRate, settings, levelDb);
  const margin = Math.max(0, settings.margin);
  const keep = Math.max(settings.minPause, 2 * margin);
  const from = Math.max(0, Math.round(part.from * sampleRate));
  const to = Math.min(samples.length, Math.round(part.to * sampleRate));
  const guards = protect.map((word) => ({ start: word.start - margin, end: word.end + margin }));

  // Quiet stretches inside the part, in seconds into the line, with what More pauses adds; less any word.
  const read = (quietStretches(samples, sampleRate, level, { from, to, ...(holdDb !== null && { close: 10 ** (holdDb / 20) }) }) as { start: number; end: number }[]).map(
    (stretch) => ({ from: stretch.start / sampleRate, to: stretch.end / sampleRate })
  );
  const extra = extraPauses(samples, sampleRate, settings, protect)
    .map((span) => ({ from: Math.max(span.from, from / sampleRate), to: Math.min(span.to, to / sampleRate) }))
    .filter((span) => span.to > span.from);
  const quiet: { from: number; to: number }[] = [];
  for (const stretch of extra.length > 0 ? union([...read, ...extra]) : read) {
    let pieces = [{ from: stretch.from, to: stretch.to }];
    for (const guard of guards) {
      pieces = pieces.flatMap((p) =>
        guard.end <= p.from || guard.start >= p.to ? [p] : [{ from: p.from, to: guard.start }, { from: guard.end, to: p.to }].filter((q) => q.to > q.from)
      );
    }
    quiet.push(...pieces.filter((p) => p.to - p.from >= MIN_SILENCE_SECONDS));
  }

  const head = part.from;
  const tail = part.to;
  // Each cut keeps the pause it was made in (`pause`), so one reading's cuts can be matched to another's.
  const cuts: TightenedPart['cuts'] = [];
  for (const q of quiet) {
    const atHead = q.from <= head + 1 / sampleRate;
    const atTail = q.to >= tail - 1 / sampleRate;
    if (atHead && atTail) continue; // all silence: left as it is
    const pause = { from: q.from, to: q.to };
    if (splitOnly) {
      const mid = (q.from + q.to) / 2;
      if (!atHead && !atTail && q.to - q.from > settings.minPause) cuts.push({ from: mid, to: mid, pause });
    } else if (atHead) {
      if (q.to - margin > q.from) cuts.push({ from: q.from, to: q.to - margin, pause });
    } else if (atTail) {
      if (q.from + margin < q.to) cuts.push({ from: q.from + margin, to: q.to, pause });
    } else if (q.to - q.from > keep) {
      const take = q.to - q.from - keep;
      const mid = (q.from + q.to) / 2;
      cuts.push({ from: mid - take / 2, to: mid + take / 2, pause });
    }
  }
  if (cuts.length === 0) return { parts: [part], cuts, removed: 0, levelDb };

  // What is left, back to back from where its first sound was (or where it was).
  const kept: { from: number; to: number }[] = [];
  let at = head;
  for (const cut of cuts) {
    if (cut.from > at) kept.push({ from: at, to: cut.from });
    at = cut.to;
  }
  if (tail > at) kept.push({ from: at, to: tail });
  const stay = inPlace || splitOnly;
  let time = part.start + (kept[0].from - head) / part.rate;
  const parts = kept.map((piece, n) => {
    if (stay) time = part.start + (piece.from - head) / part.rate;
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
  return { parts, cuts, removed: stay ? 0 : Math.max(0, oldEnd - time), levelDb };
};

/**
 * `cuts` (read with More pauses) with `extra` set on each one in a pause no
 * cut of `plain` (read with it Off) is in: what More pauses found.
 */
export const markExtraCuts = (cuts: TightenedPart['cuts'], plain: TightenedPart['cuts']) =>
  cuts.map((cut) => {
    const span = cut.pause ?? cut;
    return { ...cut, extra: !plain.some((p) => { const other = p.pause ?? p; return other.to >= span.from && other.from <= span.to; }) };
  });

/**
 * Close up: parts that follow one another play back to back. Going through
 * every part that plays, in timeline order, a part `joins` says may move
 * starts `gap` seconds after everything before it (or as far after as it
 * was, when that was less), when the part just before it may move too; it
 * only ever moves earlier. A part that may not
 * move (a line not picked, a clip of the original) stays where it is, and
 * so does the first part after it, which is where the next scene starts.
 * Returns each line's parts that changed, by key, how many parts moved and
 * the most any one moved, in seconds.
 */
export const closeUpParts = (
  lines: { key: string; parts: SyncEditPart[] }[],
  joins: (part: SyncEditPart, key: string) => boolean,
  gap: number
) => {
  const playing = lines
    .flatMap(({ key, parts }) => parts.filter((part) => !part.muted).map((part) => ({ key, part })))
    .sort((a, b) => a.part.start - b.part.start);
  const starts = new Map<string, number>();
  // Where everything so far ends, as it was and as it is now.
  let endBefore = -Infinity;
  let end = -Infinity;
  let follows = false;
  let moved = 0;
  let shift = 0;
  for (const { key, part } of playing) {
    const joined = joins(part, key);
    let start = part.start;
    // A pause already shorter than `gap` (the pieces of one tightened part: none) stays as it was.
    const wanted = end + Math.min(gap, Math.max(0, part.start - endBefore));
    if (joined && follows && wanted < start - 1e-6) {
      start = wanted;
      starts.set(part.id, start);
      moved++;
      shift = Math.max(shift, part.start - start);
    }
    endBefore = Math.max(endBefore, partEnd(part));
    end = Math.max(end, partEnd({ ...part, start }));
    follows = joined;
  }
  const parts = new Map<string, SyncEditPart[]>();
  for (const line of lines) {
    if (line.parts.some((part) => starts.has(part.id))) parts.set(line.key, line.parts.map((part) => (starts.has(part.id) ? { ...part, start: starts.get(part.id) as number } : part)));
  }
  return { parts, moved, shift };
};
