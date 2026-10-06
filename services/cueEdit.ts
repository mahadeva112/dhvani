import type { AudioSegment, WordTimestamp } from '../types';

/*
 * Splitting and joining cues by hand on the Review step.
 *
 * A cut always lands between two words. When the cue carries ElevenLabs word
 * timings, the new boundary is exactly where the first half's last word ends
 * and the second half's first word starts, so nothing is invented. A cue with
 * no word data (typed or pasted) is cut in proportion to its words' lengths
 * and marked 'derived', as the QA check expects.
 *
 * The dub text is never re-timed here: it is only divided between the two
 * cues, at the punctuation nearest the cut when there is some. Sync groups
 * cues the speaker ran together into one spoken line on its own, so a cut
 * with no pause in it still plays as one line in the dub.
 */

/** One word of a cue and where it was said, in seconds. */
export interface CueToken {
  text: string;
  start: number;
  end: number;
}

/** A pause at least this long at a cut means the speaker stopped there. */
export const PAUSE_SECONDS = 0.3;

/** Punctuation a dub line can be broken after, across the scripts DHVANI dubs into. */
const BREAK_AFTER = /[,.;:!?…।॥，。！？؟]["'”’)\]]*$/u;

export const sourceTextOf = (segment: AudioSegment) => String(segment.textSource || segment.originalText || '').trim();
export const targetTextOf = (segment: AudioSegment) => String(segment.textTarget || segment.targetText || '').trim();

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * The cue's words with their times: the measured ones when the cue has word
 * timings, otherwise its source words spread over the cue by length.
 */
export const cueTokens = (segment: AudioSegment): { tokens: CueToken[]; measured: boolean } => {
  const measured = (segment.words || []).filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
  if (measured.length > 0) return { tokens: measured.map(({ text, start, end }) => ({ text, start, end })), measured: true };

  const words = wordsOf(sourceTextOf(segment));
  const total = words.reduce((sum, word) => sum + word.length, 0) || 1;
  const span = Math.max(0, segment.endTime - segment.startTime);
  let at = segment.startTime;
  const tokens = words.map((text) => {
    const start = at;
    at += (text.length / total) * span;
    return { text, start, end: at };
  });
  return { tokens, measured: false };
};

/**
 * The cue's source words, one per token. The edited source text is kept when
 * it still has one word per measured word; otherwise the words as transcribed.
 */
const sourceWords = (segment: AudioSegment, tokens: CueToken[]) => {
  const words = wordsOf(sourceTextOf(segment));
  return words.length === tokens.length ? words : tokens.map((token) => token.text);
};

/** Seconds of silence before word `k`. */
export const pauseBefore = (tokens: CueToken[], k: number) => Math.max(0, tokens[k].start - tokens[k - 1].end);

/** The cut (1 to tokens.length - 1) whose word gap is nearest `time`. */
export const nearestCut = (tokens: CueToken[], time: number): number => {
  let best = 1;
  let bestDistance = Infinity;
  for (let k = 1; k < tokens.length; k++) {
    const distance = Math.abs((tokens[k - 1].end + tokens[k].start) / 2 - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k;
    }
  }
  return best;
};

/**
 * Where to break a dub line that is cut at `share` (0 to 1) of its original:
 * after the punctuation nearest that point, within three words, or else at the
 * same share of its words. Returns how many words go to the first half.
 */
export const suggestDubBreak = (words: string[], share: number): number => {
  if (words.length < 2) return words.length;
  const aim = Math.min(words.length - 1, Math.max(1, Math.round(words.length * share)));
  let best = aim;
  let bestDistance = Infinity;
  words.forEach((word, i) => {
    if (i === words.length - 1 || !BREAK_AFTER.test(word)) return;
    const distance = Math.abs(i + 1 - aim);
    if (distance <= 3 && distance < bestDistance) {
      bestDistance = distance;
      best = i + 1;
    }
  });
  return best;
};

const withText = (segment: AudioSegment, source: string, target: string): AudioSegment => {
  const out: AudioSegment = { ...segment, textSource: source, textTarget: target, targetText: target };
  if (segment.originalText !== undefined) out.originalText = source;
  return out;
};

const timed = (segment: AudioSegment, tokens: CueToken[], measured: boolean, startTime: number, endTime: number): AudioSegment => ({
  ...segment,
  startTime,
  endTime,
  duration: Math.max(0, endTime - startTime),
  words: measured ? tokens.map((token): WordTimestamp => ({ ...token })) : [],
  timingSource: measured ? segment.timingSource || 'elevenlabs' : 'derived',
});

export interface SplitResult {
  first: AudioSegment;
  second: AudioSegment;
  /** Seconds of silence at the cut. */
  pause: number;
  /** Both the original and the dub break after punctuation, so the halves read as whole phrases. */
  clean: boolean;
  /** The cut is on measured word timings; false when it was estimated from word lengths. */
  measured: boolean;
}

/**
 * Splits a cue before its word `k`. The first half keeps the cue's id and the
 * line's trim; the second half gets `newId`. Returns null when `k` is not
 * between two words.
 */
export const splitCue = (segment: AudioSegment, k: number, newId: string | number): SplitResult | null => {
  const { tokens, measured } = cueTokens(segment);
  if (!Number.isInteger(k) || k < 1 || k >= tokens.length) return null;
  const source = sourceWords(segment, tokens);
  const dub = wordsOf(targetTextOf(segment));
  const dubCut = suggestDubBreak(dub, k / tokens.length);

  const firstTokens = tokens.slice(0, k);
  const secondTokens = tokens.slice(k);
  const firstEnd = firstTokens[firstTokens.length - 1].end;
  const secondStart = measured ? secondTokens[0].start : firstEnd;

  const first = timed(
    withText(segment, source.slice(0, k).join(' '), dub.slice(0, dubCut).join(' ')),
    firstTokens,
    measured,
    segment.startTime,
    firstEnd
  );
  const { dubTargetSeconds: _trim, ...rest } = segment;
  const second = timed(
    withText({ ...rest, id: newId }, source.slice(k).join(' '), dub.slice(dubCut).join(' ')),
    secondTokens,
    measured,
    secondStart,
    segment.endTime
  );

  return {
    first,
    second,
    pause: pauseBefore(tokens, k),
    clean: BREAK_AFTER.test(source[k - 1]) && (dub.length === 0 || BREAK_AFTER.test(dub[dubCut - 1] || '')),
    measured,
  };
};

/** Joins a cue with the one after it, under the first cue's id. */
export const joinCues = (first: AudioSegment, second: AudioSegment): AudioSegment => {
  const join = (a: string, b: string) => [a, b].filter(Boolean).join(' ');
  // Word timings are kept only when both cues have them; a half-timed list would mislead.
  const measured = (first.words?.length ?? 0) > 0 && (second.words?.length ?? 0) > 0;
  return {
    ...withText(first, join(sourceTextOf(first), sourceTextOf(second)), join(targetTextOf(first), targetTextOf(second))),
    startTime: first.startTime,
    endTime: second.endTime,
    duration: Math.max(0, second.endTime - first.startTime),
    words: measured ? [...(first.words || []), ...(second.words || [])] : [],
    timingSource: second.timingSource === 'derived' ? 'derived' : first.timingSource,
  };
};

/**
 * Moves the cut between two neighbouring cues so the first has `k` of their
 * words. Each cue keeps its own dub text. Null when nothing would change.
 */
export const moveCut = (first: AudioSegment, second: AudioSegment, k: number): [AudioSegment, AudioSegment] | null => {
  const a = cueTokens(first);
  const b = cueTokens(second);
  const tokens = [...a.tokens, ...b.tokens];
  if (!Number.isInteger(k) || k < 1 || k >= tokens.length || k === a.tokens.length) return null;
  const measured = a.measured && b.measured;
  const source = [...sourceWords(first, a.tokens), ...sourceWords(second, b.tokens)];
  const firstEnd = tokens[k - 1].end;
  const secondStart = measured ? tokens[k].start : firstEnd;
  return [
    timed(withText(first, source.slice(0, k).join(' '), targetTextOf(first)), tokens.slice(0, k), measured, first.startTime, firstEnd),
    timed(withText(second, source.slice(k).join(' '), targetTextOf(second)), tokens.slice(k), measured, secondStart, second.endTime),
  ];
};

/** Re-divides the dub text of two neighbouring cues so the first has `k` of its words. */
export const moveDubBreak = (first: AudioSegment, second: AudioSegment, k: number): [AudioSegment, AudioSegment] => {
  const dub = [...wordsOf(targetTextOf(first)), ...wordsOf(targetTextOf(second))];
  const cut = Math.min(dub.length, Math.max(0, k));
  return [
    withText(first, sourceTextOf(first), dub.slice(0, cut).join(' ')),
    withText(second, sourceTextOf(second), dub.slice(cut).join(' ')),
  ];
};
