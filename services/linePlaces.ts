import type { AudioSegment, DubCut, DubPlace } from '../types';
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
  /** Cut at the original's pause (Cut at the original's pauses), not by the user: it starts where the speaker starts again. */
  byPause?: boolean;
}

/**
 * A cut at the original's pause as Review's dub lane shows it, `t` where it
 * falls on the timeline: made, its part placed where the speaker starts again
 * ('cut'); left to the voice, as no comma or full stop is there to cut at
 * unless it pauses ('maybe'); not made, as the line would run later into the
 * next one ('later'); or turned off by the user ('skipped').
 */
export interface PauseMark {
  letters: number;
  t: number;
  state: 'cut' | 'maybe' | 'later' | 'skipped';
  /** How long the original speaker paused there. */
  seconds: number;
}

/** What Cut at the original's pauses is set to, for the preview: off is null. */
export interface PauseCutOptions {
  minPause: number;
  maxInsert: number;
}

// ---- Cuts at the original's pauses: as server/lib/sourceCuts.js finds them ----

/** A pause mark in a dub line as translation writes it (server/lib/linePauses.js). */
const PAUSE_TAG = /\[pause\s+(\d+(?:\.\d+)?)\s*s\]/gi;
const withoutPauseTags = (text: string) =>
  text.replace(PAUSE_TAG, ' ').replace(/\s+([,.!?;:…])/g, '$1').replace(/\s{2,}/g, ' ').trim();
/** Translation marks the speaker's pauses from this long (server/lib/translationPauses.js). */
const TRANSLATION_PAUSE_SECONDS = 0.3;
const timedWords = (seg: AudioSegment) =>
  (seg.words || []).filter((w) => /[\p{L}\p{N}]/u.test(String(w.text ?? '')) && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
const dubTextOf = (seg: AudioSegment) => String(seg.textTarget || '').trim();

/** A cut at the original's pause: after `letters` letters of the line; `resume`, where the speaker starts again, when known for certain. */
export interface PauseCut {
  letters: number;
  seconds: number;
  resume: number | null;
}

/**
 * The cuts at the original's pauses in a dub line of `cues` saying `text`:
 * between two of its cues, and inside a cue where its translation marked the
 * pause (`pausedTarget`), while the cue still says that translation. As
 * sourcePauseCuts in server/lib/sourceCuts.js, which Sync cuts by.
 */
export const pauseCutsOf = (cues: AudioSegment[], text: string, minPause = TRANSLATION_PAUSE_SECONDS): PauseCut[] => {
  const sorted = cues.filter((c) => dubTextOf(c) && Number.isFinite(c.startTime) && Number.isFinite(c.endTime)).sort((a, b) => a.startTime - b.startTime);
  const total = letterCount(text);
  if (!sorted.length || letterCount(sorted.map(dubTextOf).join(' ')) !== total) return [];
  const cuts: PauseCut[] = [];
  let before = 0;
  sorted.forEach((cue, c) => {
    const previous = sorted[c - 1];
    if (previous) {
      const first = timedWords(cue)[0];
      const last = timedWords(previous).at(-1);
      const resume = first ? first.start : cue.startTime;
      const gap = resume - (last ? last.end : previous.endTime);
      if (gap > 0) cuts.push({ letters: before, seconds: gap, resume });
    }
    const paused = String(cue.pausedTarget || '').trim();
    if (paused && withoutPauseTags(paused) === dubTextOf(cue)) {
      const words = timedWords(cue);
      const resumes: number[] = [];
      for (let w = 1; w < words.length; w++) if (words[w].start - words[w - 1].end >= TRANSLATION_PAUSE_SECONDS) resumes.push(words[w].start);
      const marks = [...paused.matchAll(PAUSE_TAG)];
      marks.forEach((mark, k) => {
        cuts.push({
          letters: before + letterCount(withoutPauseTags(paused.slice(0, mark.index))),
          seconds: Number(mark[1]),
          resume: marks.length === resumes.length ? resumes[k] : null,
        });
      });
    }
    before += letterCount(dubTextOf(cue));
  });
  const seen = new Set<number>();
  return cuts.filter((cut) => {
    if (!(cut.seconds >= minPause - 1e-9) || cut.letters <= 0 || cut.letters >= total || seen.has(cut.letters)) return false;
    seen.add(cut.letters);
    return true;
  });
};

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
 * A line's parts as the user placed and cut it, and as it is cut at the
 * original's `pauses` (each part after one starts where the speaker starts
 * again, opening no more than `maxInsert` of new silence); one part, the whole
 * line, when it isn't cut. `draft` stands in for one part's start while it is
 * dragged.
 */
export const linePartsOf = (
  unit: SyncPreviewUnit,
  place: DubPlace | null,
  draft?: { part: number; start: number | null } | null,
  pauses: PauseCut[] = [],
  maxInsert = 0
): LinePart[] => {
  const words = estimatedWords(unit);
  const through = lettersThrough(words);
  const own = cutsOf(place, unit, words).map((c) => ({ ...c, pause: null as PauseCut | null }));
  const byPause = pauses
    .map((pause) => ({ word: through.indexOf(pause.letters), cut: { letters: pause.letters } as DubCut, pause }))
    .filter((c) => c.word >= 0 && c.word < words.length - 1 && !own.some((o) => o.word === c.word));
  const cuts = [...own, ...byPause].sort((a, b) => a.word - b.word);
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
    const previous = parts[index - 1];
    // After the part before it, as far on as the voice pauses there: a part never runs into the one before.
    const after = previous ? partEnd(previous) + Math.max(0, from - (words[first - 1]?.end ?? from)) : -Infinity;
    const pause = index > 0 ? cuts[index - 1].pause : null;
    const auto = pause
      ? Math.min(after + maxInsert, Math.max(after, pause.resume ?? unit.srcStart + from))
      : Math.max(after, unit.srcStart + from);
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
      ...(pause && { byPause: true }),
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
  draft?: { key: string; part: number; start: number | null } | null,
  pauseCuts?: PauseCutOptions | null
): SyncPreview | null => {
  if (!preview) return null;
  const firstCue = new Map(segments.map((seg) => [String(seg.id), seg]));
  /** By line: its cuts at the original's pauses, as the dub lane shows them. */
  const marks: (PauseMark[] | null)[] = preview.units.map(() => null);
  const placed = preview.units.map((unit, i) => {
    const place = firstCue.get(String(unit.cueIds[0]))?.dubPlace ?? null;
    const own = draft?.key === unit.key ? draft : null;
    const cues = unit.cueIds.map((id) => firstCue.get(String(id))).filter((seg): seg is AudioSegment => Boolean(seg));
    const pauses = pauseCuts ? pauseCutsOf(cues, unit.text, pauseCuts.minPause) : [];
    if (!own && !(place && (Number.isFinite(place.start) || place.cuts?.length)) && pauses.length === 0) return null;
    // Sound first, as Sync cuts (server/lib/sourceCuts.js): after a comma or full stop it cuts; elsewhere only if the voice pauses itself.
    const words = estimatedWords(unit);
    const through = lettersThrough(words);
    const skipped = new Set(place?.text === unit.text ? place.skip ?? [] : []);
    const userWords = new Set(cutsOf(place, unit, words).map((c) => c.word));
    const lineMarks: { pause: PauseCut; word: number; state: PauseMark['state'] }[] = [];
    for (const pause of pauses) {
      const word = through.indexOf(pause.letters);
      if (word < 0 || word >= words.length - 1 || userWords.has(word)) continue;
      lineMarks.push({ pause, word, state: skipped.has(pause.letters) ? 'skipped' : PAUSE_MARK.test(words[word].text) ? 'cut' : 'maybe' });
    }
    const cutting = lineMarks.filter((m) => m.state === 'cut').map((m) => m.pause);
    let parts = linePartsOf(unit, place, own, cutting, pauseCuts?.maxInsert ?? 0);
    if (cutting.length) {
      // Never cut so the line runs later into the next one than it would uncut.
      const uncut = linePartsOf(unit, place, own);
      const end = partEnd(parts[parts.length - 1]);
      if (end > partEnd(uncut[uncut.length - 1]) + 0.05 && end > unit.srcStart + unit.slot + 0.05) {
        parts = uncut;
        for (const m of lineMarks) if (m.state === 'cut') m.state = 'later';
      }
    }
    if (lineMarks.length) {
      const timeIn = (t: number) => {
        let part = parts[0];
        for (const p of parts) if (p.from <= t + 1e-9) part = p;
        return part.start + (t - part.from);
      };
      marks[i] = lineMarks.map(({ pause, word, state }) => ({
        letters: pause.letters,
        seconds: pause.seconds,
        state,
        t: timeIn((words[word].end + words[word + 1].start) / 2),
      }));
    }
    return parts.length > 1 || parts[0].placed ? parts : null;
  });
  const withMarks = (units: SyncPreviewUnit[]) => units.map((u, i) => (marks[i] ? { ...u, pauseMarks: marks[i] as PauseMark[] } : u));
  if (placed.every((p) => p === null)) return marks.some(Boolean) ? { ...preview, units: withMarks(preview.units) } : preview;
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
        : // Stretched, a new wording still aims at the line read at 1×.
          Math.max(1, Math.floor(chars * Math.min(1, slot / Math.max(0.1, unit.estimate * (unit.rate ?? 1))) * SUGGESTION_MARGIN));
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
    units: withMarks(units),
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
  else if (next.cuts?.some((c) => c.letters === letters) && next.text === unit.text) {
    next.cuts = next.cuts.map((c) => (c.letters === letters ? { letters, ...(at !== undefined && { start: at }) } : c));
  } else if (at !== undefined) {
    // A part cut at the original's pause, dragged: the cut becomes the user's, with the part where they put it.
    const kept = next.text === unit.text ? next.cuts ?? [] : [];
    if (next.text !== unit.text) next.rate = undefined;
    next.cuts = [...kept, { letters, start: at }].sort((a, b) => a.letters - b.letters);
    next.text = unit.text;
  }
  return tidy(next);
};

/** The line's place with its cut at the original's pause after `letters` turned off, or back on. */
export const withPauseSkip = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, letters: number, skip: boolean): DubPlace | null => {
  const same = place?.text === unit.text;
  const kept = same ? place?.skip ?? [] : [];
  const others = kept.filter((n) => n !== letters);
  return tidy({ ...place, ...(!same && { cuts: undefined, rate: undefined }), text: unit.text, skip: skip ? [...others, letters].sort((a, b) => a - b) : others });
};

/** The line's place with a cut after `letters`, or that cut taken out (the parts either side joined). */
export const withCut = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, letters: number, on: boolean): DubPlace | null => {
  const kept = place?.text === unit.text ? place.cuts ?? [] : [];
  const others = kept.filter((c) => c.letters !== letters);
  const cuts = on ? [...others, { letters }].sort((a, b) => a.letters - b.letters) : others;
  const same = place?.text === unit.text;
  return tidy({ ...place, text: unit.text, cuts, skip: same ? place?.skip : undefined, rate: same ? place?.rate : undefined });
};

const tidy = (place: DubPlace): DubPlace | null => {
  const out: DubPlace = {};
  if (Number.isFinite(place.start)) out.start = place.start;
  if (place.cuts?.length) {
    out.text = place.text;
    out.cuts = place.cuts;
  }
  if (place.skip?.length) {
    out.text = place.text;
    out.skip = place.skip;
  }
  if (place.rate !== undefined && Number.isFinite(place.rate) && Math.abs(place.rate - 1) >= 0.005) {
    out.text = place.text;
    out.rate = place.rate;
  }
  return out.start === undefined && !out.cuts && !out.skip && out.rate === undefined ? null : out;
};

// ---- Stretching a line: its speed, set on Review's dub lane ----

/** How far a line may be stretched, as a share of how fast it is voiced (atempo takes these in one pass). */
export const MIN_LINE_RATE = 0.5;
export const MAX_LINE_RATE = 2;
/** Up to this much faster a stretch still sounds natural; past it, it starts to sound hurried. */
export const QUICK_RATE = 1.15;
/** Faster than this a stretch sounds rushed, and slower than SLOW_RATE dragged: Review offers another wording. */
export const RUSHED_RATE = 1.3;
export const SLOW_RATE = 0.85;

/** How a stretch sounds: natural, a little quick, rushed, or dragged. */
export const rateZone = (rate: number): 'natural' | 'quick' | 'rushed' | 'slow' =>
  rate > RUSHED_RATE + 1e-9 ? 'rushed' : rate > QUICK_RATE + 1e-9 ? 'quick' : rate < SLOW_RATE - 1e-9 ? 'slow' : 'natural';

/** The speed the user stretched a line to, while it says what it said then; 1 when it isn't stretched. */
export const rateOf = (place: DubPlace | null | undefined, unit: Pick<SyncPreviewUnit, 'text'>) =>
  place?.rate !== undefined && place.text === unit.text && Number.isFinite(place.rate)
    ? Math.min(MAX_LINE_RATE, Math.max(MIN_LINE_RATE, place.rate))
    : 1;

/** The line's place stretched to `rate` (1 takes the stretch off), kept while the line says what it says now. */
export const withLineRate = (place: DubPlace | null, unit: Pick<SyncPreviewUnit, 'text'>, rate: number): DubPlace | null => {
  const same = place?.text === unit.text;
  const r = Math.round(Math.min(MAX_LINE_RATE, Math.max(MIN_LINE_RATE, rate)) * 100) / 100;
  return tidy({
    ...place,
    ...(!same && { cuts: undefined, skip: undefined }),
    text: unit.text,
    rate: Math.abs(r - 1) < 0.005 ? undefined : r,
  });
};

/**
 * The preview with each stretched line read at its speed: its estimate, its
 * read's range and its lips at that speed, judged again against its slot.
 * `estimate * rate` stays how long the words take at 1×, which a new wording
 * aims at. `draft` is a stretch being dragged. Runs before withLinePlaces.
 */
export const withLineRates = (
  preview: SyncPreview | null,
  segments: AudioSegment[],
  draft?: { key: string; rate: number } | null
): SyncPreview | null => {
  if (!preview) return null;
  const firstCue = new Map(segments.map((seg) => [String(seg.id), seg]));
  const allowed = ALLOWED_OVERFLOW[preview.precision] ?? ALLOWED_OVERFLOW.phrase;
  let changed = false;
  const units = preview.units.map((unit): SyncPreviewUnit => {
    const rate = draft?.key === unit.key ? draft.rate : rateOf(firstCue.get(String(unit.cueIds[0]))?.dubPlace, unit);
    if (Math.abs(rate - 1) < 0.005) return unit;
    changed = true;
    const estimate = unit.estimate / rate;
    const overflow = estimate - unit.slot;
    const short = isShortSpeech(estimate, unit.spoken);
    const status = overflow > allowed ? 'long' : estimate > unit.slot * TIGHT_SHARE ? 'tight' : short ? 'short' : 'fits';
    return {
      ...unit,
      rate,
      estimate,
      overflow: Math.max(0, overflow),
      underflow: status === 'short' ? Math.max(0, unit.spoken - estimate) : 0,
      status,
      ...(unit.expert && {
        expert: { ...unit.expert, low: unit.expert.low / rate, high: unit.expert.high / rate, dubLips: unit.expert.dubLips.map((t) => t / rate) },
      }),
    };
  });
  if (!changed) return preview;
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
