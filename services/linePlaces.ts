import type { AudioSegment, DubPlace } from '../types';
import { ALLOWED_OVERFLOW, LENGTHEN_FILL, SUGGESTION_MARGIN, TIGHT_SHARE, isShortSpeech } from './fitThresholds.ts';
import type { SyncPreview, SyncPreviewUnit } from './syncService.ts';

/**
 * Placing dub lines by hand, before anything is voiced: on Review's dub lane a
 * line can be dragged to where its first word should be heard, and cut between
 * two words into parts that are each placed on their own. What the user did is
 * kept on the line's first cue (AudioSegment.dubPlace); Sync places the line
 * there (server/lib/syncDub.js), and the preview is judged as it will be placed
 * (withLinePlaces).
 */

/** A mark a voice is likely to pause at, ending a word. */
export const PAUSE_MARK = /[,.;:!?।॥–—]$/;

/**
 * Where each word of a line is likely to fall, in seconds from its start,
 * stretched to the line's estimate. An Expert line has its own timed words; a
 * Quick one shares the estimate out by characters, with a short pause after a
 * mark. A guess drawn from the text: nothing has been voiced yet.
 */
export const estimatedWords = (u: Pick<SyncPreviewUnit, 'estimate' | 'text' | 'expert'>): { text: string; start: number; end: number }[] => {
  const length = u.estimate;
  if (length <= 0) return [];
  const timed = u.expert?.words;
  if (timed?.length) {
    const last = timed[timed.length - 1].end;
    const k = last > 0 ? length / last : 1;
    return timed.map((w) => ({ text: w.text, start: w.start * k, end: w.end * k }));
  }
  const tokens = u.text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const gaps = tokens.slice(0, -1).map((t) => (PAUSE_MARK.test(t) ? 0.25 : 0.04));
  const gapTotal = gaps.reduce((a, b) => a + b, 0);
  // Pauses never take more than a third of the line.
  const squeeze = gapTotal > length / 3 ? length / 3 / gapTotal : 1;
  const speech = length - gapTotal * squeeze;
  const chars = tokens.reduce((a, t) => a + Math.max(1, t.length), 0);
  let at = 0;
  return tokens.map((text, i) => {
    const d = (speech * Math.max(1, text.length)) / chars;
    const word = { text, start: at, end: at + d };
    at += d + (gaps[i] ?? 0) * squeeze;
    return word;
  });
};

/** A word's letters and digits, as Sync counts them to find a cut in the voiced line (clean in server/lib/chunkSync.js). */
export const letterCount = (text: string) => text.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').length;

/** The least gap kept between two parts of one line, and before another line's part, when one is moved. */
export const PART_GAP_SECONDS = 0.05;
export const LINE_GAP_SECONDS = 0.3;

/** A part of a dub line: the whole line, or what lies between its cuts. */
export interface LinePart {
  /** 0 for the line's first part. */
  index: number;
  /** Letters of the line said before the part: 0 for the first. */
  letters: number;
  /** Its first and last word, by index into the line's estimated words. */
  first: number;
  last: number;
  /** Seconds into the line's estimate its first word starts and its last ends. */
  from: number;
  to: number;
  /** Where its first word is heard. */
  start: number;
  /** Where Sync would put it: the first part with the original line, a later one as far in as its first word. */
  auto: number;
  /** The user placed it. */
  placed: boolean;
  /** The voice is likely to pause before it: a cut after a mark. False for a cut between words said in one go. */
  atPause: boolean;
}

/** The line's place, from its first cue. */
export const placeOf = (segments: AudioSegment[], unit: Pick<SyncPreviewUnit, 'cueIds'>): DubPlace | null =>
  segments.find((seg) => String(seg.id) === String(unit.cueIds[0]))?.dubPlace ?? null;

/** Each word's letters summed up to and including it. */
const lettersThrough = (words: { text: string }[]) => {
  let sum = 0;
  return words.map((w) => (sum += letterCount(w.text)));
};

/**
 * The cuts of `place` that still fit the line, as `{ word, cut }`: `word` the
 * last word before the cut. A cut is dropped once the line's words changed,
 * or when it doesn't fall between two words.
 */
export const cutsOf = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, words: { text: string }[]) => {
  if (!place?.cuts?.length || place.text !== unit.text) return [];
  const through = lettersThrough(words);
  const byWord = new Map<number, (typeof place.cuts)[number]>();
  for (const cut of place.cuts) {
    const word = through.indexOf(cut.letters);
    if (word >= 0 && word < words.length - 1 && !byWord.has(word)) byWord.set(word, cut);
  }
  return [...byWord].map(([word, cut]) => ({ word, cut })).sort((a, b) => a.word - b.word);
};

/**
 * A line's parts as the user placed and cut it; one part, the whole line,
 * when it isn't cut. `draft` stands in for one part's start while it is dragged.
 */
export const linePartsOf = (unit: SyncPreviewUnit, place: DubPlace | null, draft?: { part: number; start: number | null } | null): LinePart[] => {
  const words = estimatedWords(unit);
  const cuts = cutsOf(place, unit, words);
  const through = lettersThrough(words);
  const startOf = (index: number, own: number | undefined) => {
    if (draft && draft.part === index) return draft.start;
    return Number.isFinite(own) ? (own as number) : null;
  };
  const bounds = [-1, ...cuts.map((c) => c.word), Math.max(0, words.length - 1)];
  const parts: LinePart[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const first = bounds[index] + 1;
    const last = bounds[index + 1];
    const from = index === 0 || !words[first] ? 0 : words[first].start;
    const to = index === bounds.length - 2 || !words[last] ? unit.estimate : words[last].end;
    const own = startOf(index, index === 0 ? place?.start : cuts[index - 1].cut.start);
    const auto = unit.srcStart + from;
    parts.push({
      index,
      letters: index === 0 ? 0 : through[first - 1],
      first,
      last,
      from,
      to,
      start: own ?? auto,
      auto,
      placed: own !== null,
      atPause: index === 0 || PAUSE_MARK.test(words[first - 1]?.text ?? ''),
    });
  }
  return parts;
};

/** Where a part's last word ends. */
export const partEnd = (part: LinePart) => part.start + (part.to - part.from);

/** A line's parts as withLinePlaces left them: one, the whole line where Sync puts it, unless it was placed or cut. */
export const lanePartsOf = (unit: SyncPreviewUnit): LinePart[] =>
  unit.parts ?? [
    {
      index: 0,
      letters: 0,
      first: 0,
      last: Math.max(0, estimatedWords(unit).length - 1),
      from: 0,
      to: unit.estimate,
      start: unit.dubStart ?? unit.srcStart,
      auto: unit.srcStart,
      placed: unit.dubStart !== undefined,
      atPause: true,
    },
  ];

/** Where `t` seconds into a line's estimate is heard, in whichever part it falls. */
export const lineTimeAt = (unit: SyncPreviewUnit, t: number) => {
  const parts = lanePartsOf(unit);
  let part = parts[0];
  for (const p of parts) if (p.from <= t + 1e-9) part = p;
  return part.start + (t - part.from);
};

/**
 * Where a line's room ends on the timeline: its last part's end less the time
 * it runs over (withLinePlaces keeps `estimate - slot` at that), so a word past
 * it is late.
 */
export const roomEnd = (unit: SyncPreviewUnit) => {
  const parts = lanePartsOf(unit);
  return partEnd(parts[parts.length - 1]) - unit.estimate + unit.slot;
};

/**
 * The preview with the user's places and cuts: each placed or cut line gets
 * `dubStart` (where its first word is heard) and `parts`, and is judged where
 * it now starts, as is the line before it, whose room ends where it starts. A
 * line split apart is judged by its last part against its room, less the time
 * its cuts were opened up by. `draft` is a part being dragged.
 */
export const withLinePlaces = (
  preview: SyncPreview | null,
  segments: AudioSegment[],
  draft?: { key: string; part: number; start: number | null } | null
): SyncPreview | null => {
  if (!preview) return null;
  const firstCue = new Map(segments.map((seg) => [String(seg.id), seg]));
  const placed = preview.units.map((unit) => {
    const place = firstCue.get(String(unit.cueIds[0]))?.dubPlace ?? null;
    const own = draft?.key === unit.key ? draft : null;
    if (!own && !(place && (Number.isFinite(place.start) || place.cuts?.length))) return null;
    const parts = linePartsOf(unit, place, own);
    return parts.length > 1 || parts[0].placed ? parts : null;
  });
  if (placed.every((p) => p === null)) return preview;
  const allowed = ALLOWED_OVERFLOW[preview.precision] ?? ALLOWED_OVERFLOW.phrase;
  const share = preview.placedShare > 0 ? preview.placedShare : 1;
  const startOf = (i: number) => placed[i]?.[0].start ?? preview.units[i].srcStart;
  const units = preview.units.map((unit, i): SyncPreviewUnit => {
    const parts = placed[i];
    const nextMoved = i + 1 < preview.units.length && placed[i + 1] !== null;
    if (!parts && !nextMoved) return unit;
    const start = startOf(i);
    const slotEnd = unit.srcStart + unit.slot + (nextMoved ? startOf(i + 1) - preview.units[i + 1].srcStart : 0);
    const end = parts ? partEnd(parts[parts.length - 1]) : start + unit.estimate;
    // The time the cuts were opened up by is the line's no longer.
    const slot = Math.max(0.05, unit.estimate - (end - slotEnd));
    const overflow = unit.estimate - slot;
    const short = isShortSpeech(unit.estimate, unit.spoken);
    const status = overflow > allowed ? 'long' : unit.estimate > slot * TIGHT_SHARE ? 'tight' : short ? 'short' : 'fits';
    const chars = unit.text.length;
    const rate = unit.read > 0 && chars > 0 ? chars / unit.read : preview.charsPerSecond;
    const targetChars =
      status === 'short'
        ? Math.max(chars + 1, Math.floor((rate / share) * Math.min(unit.spoken * LENGTHEN_FILL, slot * SUGGESTION_MARGIN)))
        : Math.max(1, Math.floor(chars * Math.min(1, slot / Math.max(0.1, unit.estimate)) * SUGGESTION_MARGIN));
    return {
      ...unit,
      slot,
      overflow: Math.max(0, overflow),
      underflow: status === 'short' ? Math.max(0, unit.spoken - unit.estimate) : 0,
      status,
      targetChars,
      ...(parts && { dubStart: start, parts }),
    };
  });
  const count = (status: SyncPreviewUnit['status']) => units.filter((u) => u.status === status).length;
  return {
    ...preview,
    units,
    summary: {
      ...preview.summary,
      fits: count('fits') + count('short'),
      tight: count('tight'),
      long: count('long'),
      short: count('short'),
      maxOverflow: units.reduce((max, u) => (u.status === 'long' ? Math.max(max, u.overflow) : max), 0),
    },
  };
};

/**
 * The line's place with one part's start set, or cleared with null: the part
 * after `letters` letters of the line (LinePart.letters; 0 is the first part).
 * Empty, it is null: the line goes back to Sync.
 */
export const withPartStart = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, letters: number, start: number | null): DubPlace | null => {
  const next: DubPlace = { ...place };
  const at = start === null ? undefined : Math.round(start * 1000) / 1000;
  if (letters === 0) next.start = at;
  else if (next.cuts && next.text === unit.text) {
    next.cuts = next.cuts.map((c) => (c.letters === letters ? { letters, ...(at !== undefined && { start: at }) } : c));
  }
  return tidy(next);
};

/** The line's place with a cut after `letters`, or that cut taken out (the parts either side joined). */
export const withCut = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, letters: number, on: boolean): DubPlace | null => {
  const kept = place?.text === unit.text ? place.cuts ?? [] : [];
  const others = kept.filter((c) => c.letters !== letters);
  const cuts = on ? [...others, { letters }].sort((a, b) => a.letters - b.letters) : others;
  return tidy({ ...place, text: unit.text, cuts });
};

const tidy = (place: DubPlace): DubPlace | null => {
  const out: DubPlace = {};
  if (Number.isFinite(place.start)) out.start = place.start;
  if (place.cuts?.length) {
    out.text = place.text;
    out.cuts = place.cuts;
  }
  return out.start === undefined && !out.cuts ? null : out;
};
