/**
 * Subtitle cue builder — Srutilekha's splitter, ported.
 *
 * Takes the ElevenLabs word stream and decides where each subtitle starts and
 * stops. Boundaries are scored on what the language and the audio say about
 * them rather than on where a character budget happened to run out:
 *   • punctuation (Latin, the danda ।/॥, Urdu ۔/؟) and, for the verb-final
 *     Dravidian languages, finite-verb endings;
 *   • silence, measured against this speaker's own rhythm (pauseProfile);
 *   • grammar — a cue never opens with a phrase-completing word (है, ছিল, में,
 *     থেকে …) and avoids closing on a clause-opening one (और, কিন্তু, and …).
 *
 * Word order and word timings are never altered here: every input word lands
 * in exactly one cue, and a cue's start/end are its first and last word's.
 * sanitizeCues then makes the list screen-ready (no overlaps, a readable
 * minimum, short silences bridged so captions do not flicker).
 */
import { BIND_BACK, BIND_FWD, VERB_END } from './subtitleGrammarData.ts';

export interface TimedWord {
  /** Text as it will be displayed (casing / punctuation options applied). */
  text: string;
  /** The word with its punctuation, for boundary decisions. */
  raw: string;
  start: number;
  end: number;
  speaker?: string | null;
}

export interface CueBudget {
  maxCharsPerLine: number;
  maxLines: number;
  /** 0 = no per-line word limit. */
  maxWordsPerLine: number;
  maxSecs: number;
  /** Reading-speed cap in characters per second; 0 = off. */
  cps?: number;
}

export interface TimedCue {
  start: number;
  end: number;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Text measurement                                                    */
/* ------------------------------------------------------------------ */

// Devanagari and its neighbours join a conjunct horizontally (क्या is wide);
// Kannada and Telugu stack it (ತ್ತ is one akshara wide).
const JOINING_VIRAMA = new Set([0x094d, 0x09cd, 0x0a4d, 0x0acd, 0x0b4d, 0x0d4d]);
const STACKING_VIRAMA = new Set([0x0c4d, 0x0ccd]);
const MARK = /[\p{Mn}\p{Mc}\p{Cf}]/u;
const LETTER = /\p{L}/u;

/** Visual length in aksharas / grapheme clusters, not code points. */
export const vlen = (text: string): number => {
  let n = 0;
  let link = 0; // pending virama: 0 none, 1 horizontal join, 2 vertical stack
  for (const ch of text) {
    if (MARK.test(ch)) {
      const cp = ch.codePointAt(0)!;
      if (JOINING_VIRAMA.has(cp)) link = 1;
      else if (STACKING_VIRAMA.has(cp)) link = 2;
      continue;
    }
    if (link && LETTER.test(ch)) {
      if (link === 1) n += 1;
      link = 0;
      continue;
    }
    link = 0;
    n += 1;
  }
  return n;
};

/* ------------------------------------------------------------------ */
/* Scripts and punctuation                                             */
/* ------------------------------------------------------------------ */

const NEUTRAL_CPS = new Set([0x0964, 0x0965, 0x0951, 0x0952]);

/** Font script: 'dev', 'beng' or null. A cue never mixes the two. */
const wordScript = (token: string): 'dev' | 'beng' | null => {
  let beng = false;
  for (const ch of token) {
    const cp = ch.codePointAt(0)!;
    if (NEUTRAL_CPS.has(cp)) continue;
    if (cp >= 0x0900 && cp <= 0x097f) return 'dev';
    if (cp >= 0x0980 && cp <= 0x09ff) beng = true;
  }
  return beng ? 'beng' : null;
};

const bufScript = (buf: TimedWord[]) => {
  for (const word of buf) {
    const script = wordScript(word.text);
    if (script) return script;
  }
  return null;
};

const VERB_FINAL_RANGES: [string, number, number][] = [
  ['taml', 0x0b80, 0x0bff],
  ['telu', 0x0c00, 0x0c7f],
  ['knda', 0x0c80, 0x0cff],
  ['mlym', 0x0d00, 0x0d7f],
];

const verbFinalScript = (token: string): string | null => {
  for (const ch of token) {
    const cp = ch.codePointAt(0)!;
    for (const [name, lo, hi] of VERB_FINAL_RANGES) if (cp >= lo && cp <= hi) return name;
  }
  return null;
};

const STRONG_END = ['।', '॥', '.', '?', '!', '？', '！', '۔', '؟', '…'];
const WEAK_END = [',', ';', ':', '—', '–', '،', '؛', '，', '、'];
const END_TRIM = /["'”’»)\]}]+$/u;

const endsWith = (token: string, suffixes: string[]) => {
  const t = token.replace(END_TRIM, '');
  return suffixes.some((suffix) => t.endsWith(suffix));
};

/* ------------------------------------------------------------------ */
/* Function words                                                      */
/* ------------------------------------------------------------------ */

const FW_STRIP = /^["“”‘’'()[\]{}«»\-।॥.?!,;:—–…،؛؟۔]+|["“”‘’'()[\]{}«»\-।॥.?!,;:—–…،؛؟۔]+$/gu;
// Zero-width joiners, bidi marks, tatweel, Arabic vowel points and every
// script's nukta: transcripts are inconsistent about all of them.
const FW_IGNORE = /[​-‏؜ـًٰ-़়਼઼଼಼ْ]/gu;

const normFw = (token: string) =>
  token.trim().normalize('NFC').replace(FW_STRIP, '').replace(FW_IGNORE, '').toLowerCase();

// English joins the Indic tables: Scribe transcribes plenty of it, and a cue
// ending on "and" or "the" reads as wrong as one ending on "और".
const ENGLISH_BIND_FWD = [
  'and', 'but', 'or', 'nor', 'so', 'because', 'that', 'which', 'who', 'whose', 'if', 'when',
  'while', 'although', 'though', 'unless', 'until', 'the', 'a', 'an', 'of', 'to', 'in', 'on',
  'at', 'for', 'with', 'from', 'into', 'by', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
];

const BIND_BACK_SET = new Set(BIND_BACK.map(normFw));
const BIND_FWD_SET = new Set([...BIND_FWD, ...ENGLISH_BIND_FWD].map(normFw));
const VERB_END_NFC: Record<string, string[]> = Object.fromEntries(
  Object.entries(VERB_END).map(([script, suffixes]) => [script, suffixes.map((s) => s.normalize('NFC'))])
);

/** Completes the word before it (auxiliary, postposition, clitic). */
export const bindsBack = (token: string) => {
  const t = normFw(token);
  return Boolean(t) && BIND_BACK_SET.has(t);
};

/** Opens the clause after it (conjunction, subordinator, article). */
export const bindsFwd = (token: string) => {
  const t = normFw(token);
  return Boolean(t) && BIND_FWD_SET.has(t);
};

/** A finite verb form closing its clause, in the verb-final languages. */
const endsClause = (token: string) => {
  const t = normFw(token);
  if (!t) return false;
  const script = verbFinalScript(t);
  const suffixes = script ? VERB_END_NFC[script] : null;
  if (!suffixes || bindsFwd(t)) return false;
  return suffixes.some((suffix) => t.endsWith(suffix));
};

/* ------------------------------------------------------------------ */
/* Pauses                                                              */
/* ------------------------------------------------------------------ */

const PAUSE_SPLIT = 0.35;
const PAUSE_MIN = 0.12;
const PAUSE_FLOOR = 0.16;
const PAUSE_CEIL = 0.8;
const PAUSE_MIN_N = 8;
/** A phrase-completing word may lag its head by this much and still belong to it. */
const GLUE_MAX_GAP = 1.2;

interface Pauses {
  /** A gap this wide closes the cue: real silence. */
  split: number;
  /** A gap this wide is worth preferring when a budget forces a cut anyway. */
  hint: number;
}

const percentile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return 0;
  const k = q * (sorted.length - 1);
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
};

/**
 * What a pause means for THIS speaker. The 85th-percentile gap adapts to
 * delivery speed; twice the median guards continuous speech, where every gap
 * is alike and splitting at p85 would be arbitrary.
 */
const pauseProfile = (words: TimedWord[]): Pauses => {
  const gaps: number[] = [];
  for (let i = 1; i < words.length; i += 1) {
    gaps.push(Math.max(0, words[i].start - words[i - 1].end));
  }
  if (gaps.length < PAUSE_MIN_N) return { split: PAUSE_SPLIT, hint: PAUSE_MIN };
  gaps.sort((a, b) => a - b);
  const split = Math.min(
    Math.max(Math.max(percentile(gaps, 0.85), 2 * percentile(gaps, 0.5)), PAUSE_FLOOR),
    PAUSE_CEIL
  );
  return { split, hint: Math.min(Math.max(0.35 * split, 0.04), split) };
};

/* ------------------------------------------------------------------ */
/* Boundary scoring                                                    */
/* ------------------------------------------------------------------ */

const W_SENTENCE = 6;
const W_CLAUSE = 3;
const W_PAUSE = 4;
const W_FILL = 2;
const P_BIND_BACK = 2.5;
const P_BIND_FWD = 1.5;
const P_ARBITRARY = 4;

/** Does punctuation, a clause-ending verb, or an audible gap justify cutting here? */
const cutSupported = (buf: TimedWord[], cut: number, nextStart: number, pauses: Pauses) => {
  const prev = buf[cut - 1];
  const after = cut < buf.length ? buf[cut].start : nextStart;
  return (
    endsWith(prev.raw, STRONG_END) ||
    endsWith(prev.raw, WEAK_END) ||
    endsClause(prev.raw) ||
    after - prev.end >= pauses.hint
  );
};

/**
 * Index of the content word heading the phrase the incoming word completes
 * ("समझा" of "समझा रहा हूँ"), so the phrase can move as one. buf.length when
 * the incoming word does not bind back; 0 when the whole buffer is the chain.
 */
const cliticChainStart = (buf: TimedWord[], nextRaw: string) => {
  if (!bindsBack(nextRaw)) return buf.length;
  let j = buf.length;
  while (j > 0 && bindsBack(buf[j - 1].raw)) j -= 1;
  return Math.max(j - 1, 0);
};

/** Where to close the cue in `buf`: 1..buf.length. Ties go to the later cut. */
const bestCut = (buf: TimedWord[], nextRaw: string, nextStart: number, cap: number, pauses: Pauses) => {
  let bestJ = buf.length;
  let bestScore: number | null = null;
  let chars = 0;
  for (let j = 1; j <= buf.length; j += 1) {
    const prev = buf[j - 1];
    chars += vlen(prev.text) + (chars ? 1 : 0);
    const [nxtRaw, nxtStart] = j < buf.length ? [buf[j].raw, buf[j].start] : [nextRaw, nextStart];
    const gap = Math.max(0, nxtStart - prev.end);

    const strong = endsWith(prev.raw, STRONG_END);
    const weak = endsWith(prev.raw, WEAK_END) || endsClause(prev.raw);
    let score = strong ? W_SENTENCE : weak ? W_CLAUSE : 0;
    score += W_PAUSE * Math.min(gap / pauses.split, 1.5);
    if (!cutSupported(buf, j, nextStart, pauses)) score -= P_ARBITRARY;
    if (bindsBack(nxtRaw)) score -= P_BIND_BACK;
    if (bindsFwd(prev.raw)) score -= P_BIND_FWD;
    if (cap > 0) score += W_FILL * Math.min(chars / cap, 1);

    if (bestScore === null || score >= bestScore) {
      bestScore = score;
      bestJ = j;
    }
  }
  return bestJ;
};

/* ------------------------------------------------------------------ */
/* Line wrapping                                                       */
/* ------------------------------------------------------------------ */

const joinText = (words: TimedWord[]) => words.map((word) => word.text).join(' ');

const lineFits = (line: TimedWord[], budget: CueBudget) =>
  vlen(joinText(line)) <= budget.maxCharsPerLine &&
  (budget.maxWordsPerLine <= 0 || line.length <= budget.maxWordsPerLine);

/**
 * Greedy wrap that never drops a word. A phrase-completing word never opens a
 * line (it overflows the current one instead), and a clause-opening word at a
 * line end is carried down to the clause it introduces.
 */
const wrapWords = (words: TimedWord[], budget: CueBudget): string => {
  const lines: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const word of words) {
    const candidate = [...current, word];
    if (current.length === 0 || lineFits(candidate, budget) || bindsBack(word.raw)) {
      current = candidate;
    } else if (lines.length + 1 < budget.maxLines) {
      if (current.length > 1 && bindsFwd(current[current.length - 1].raw)) {
        const carry = current.pop()!;
        lines.push(current);
        current = [carry, word];
      } else {
        lines.push(current);
        current = [word];
      }
    } else {
      current = candidate; // line budget spent: overflow, never drop
    }
  }
  if (current.length) lines.push(current);
  return lines.map(joinText).join('\n');
};

/** Would these words lay out within the line budget without overflowing? */
const fitsLines = (words: TimedWord[], budget: CueBudget) => {
  let lines = 1;
  let current: TimedWord[] = [];
  for (const word of words) {
    const candidate = [...current, word];
    if (current.length === 0 || lineFits(candidate, budget)) {
      current = candidate;
    } else if (lines < budget.maxLines) {
      lines += 1;
      current = [word];
    } else {
      return false;
    }
  }
  return true;
};

/* ------------------------------------------------------------------ */
/* Cue building                                                        */
/* ------------------------------------------------------------------ */

const RUNT_FRACTION = 0.4;
const RUNT_MAX_CHARS = 8;

interface Limits {
  budget: CueBudget;
  cap: number;
  maxWords: number;
  maxSecs: number;
  pauses: Pauses;
}

/** A cue that opens with a phrase-completing word hands it back to the cue before. */
const reattachClitics = (groups: TimedWord[][], { budget, maxWords, maxSecs, pauses }: Limits) => {
  const out: TimedWord[][] = [];
  for (const group of groups) {
    let words = group;
    while (out.length && words.length && bindsBack(words[0].raw)) {
      const prev = out[out.length - 1];
      const head = words[0];
      const gap = head.start - prev[prev.length - 1].end;
      const limit = words.length === 1 ? GLUE_MAX_GAP : pauses.split;
      if (
        wordScript(head.text) !== wordScript(joinText(prev)) ||
        !(gap >= -0.1 && gap <= limit) ||
        (maxWords > 0 && prev.length >= maxWords) ||
        head.end - prev[0].start > maxSecs ||
        !fitsLines([...prev, head], budget)
      ) {
        break;
      }
      out[out.length - 1] = [...prev, head];
      words = words.slice(1);
    }
    if (words.length) out.push(words);
  }
  return out;
};

const speakerOf = (words: TimedWord[]) => words.find((word) => word.speaker != null)?.speaker ?? null;

/**
 * Evens out a runt cue (one stray word) against its neighbour: merge the pair
 * when nothing justified the boundary, otherwise pull words leftward into a
 * short first cue. Never across a speaker, script or sentence boundary.
 */
const rebalanceCues = (groups: TimedWord[][], { cap, maxWords, maxSecs, pauses }: Limits) => {
  const floor = Math.min(cap * RUNT_FRACTION, RUNT_MAX_CHARS);
  const legal = (words: TimedWord[]) =>
    words.length > 0 &&
    (maxWords <= 0 || words.length <= maxWords) &&
    words[words.length - 1].end - words[0].start <= maxSecs &&
    vlen(joinText(words)) <= cap;

  const out: TimedWord[][] = [];
  for (const group of groups) {
    let words = group;
    if (!out.length) {
      out.push(words);
      continue;
    }
    const prev = out[out.length - 1];
    const aLen = vlen(joinText(prev));
    const bLen = vlen(joinText(words));
    const joined = [...prev, ...words];

    if (Math.min(aLen, bLen) >= floor) {
      out.push(words);
      continue;
    }

    const ps = speakerOf(prev);
    const bs = speakerOf(words);
    const gap = words[0].start - prev[prev.length - 1].end;
    if (
      (ps != null && bs != null && ps !== bs) ||
      wordScript(joinText(prev)) !== wordScript(joinText(words)) ||
      gap > GLUE_MAX_GAP ||
      joined.slice(0, -1).some((word) => endsWith(word.raw, STRONG_END))
    ) {
      out.push(words);
      continue;
    }

    const last = prev[prev.length - 1].raw;
    const justified =
      endsWith(last, STRONG_END) || endsWith(last, WEAK_END) || endsClause(last) || gap >= pauses.split;

    if (!justified && legal(joined)) {
      out[out.length - 1] = joined;
      continue;
    }

    if (aLen >= floor) {
      out.push(words);
      continue;
    }

    let best: [TimedWord[], TimedWord[]] | null = null;
    let bestKey: [number, number, number] = [Math.min(aLen, bLen), 0, Math.min(aLen, bLen)];
    for (let j = prev.length + 1; j < joined.length; j += 1) {
      const left = joined.slice(0, j);
      const right = joined.slice(j);
      if (!legal(left) || !legal(right)) continue;
      if (bindsBack(right[0].raw) || bindsFwd(left[left.length - 1].raw)) continue;
      const lo = Math.min(vlen(joinText(left)), vlen(joinText(right)));
      const supported = right[0].start - left[left.length - 1].end >= pauses.hint ? 1 : 0;
      const key: [number, number, number] = [Math.min(lo, floor), supported, lo];
      const better =
        key[0] !== bestKey[0] ? key[0] > bestKey[0] : key[1] !== bestKey[1] ? key[1] > bestKey[1] : key[2] > bestKey[2];
      if (better) {
        best = [left, right];
        bestKey = key;
      }
    }
    if (best) {
      out[out.length - 1] = best[0];
      words = best[1];
    }
    out.push(words);
  }
  return out;
};

/**
 * Groups a timed word stream into subtitle cues. A speaker change, a script
 * change (Devanagari ↔ Bengali), a measured silence and a sentence terminator
 * each close a cue; when a budget forces a cut, every candidate is scored.
 */
export const buildCues = (words: TimedWord[], budget: CueBudget): TimedCue[] => {
  const spoken = words.filter((word) => word.text);
  if (spoken.length === 0) return [];

  const maxLines = Math.max(1, budget.maxLines);
  const normalized: CueBudget = { ...budget, maxLines };
  const cap = budget.maxCharsPerLine * maxLines;
  const maxWords = budget.maxWordsPerLine > 0 ? budget.maxWordsPerLine * maxLines : 0;
  const maxSecs = budget.maxSecs;
  const cps = budget.cps ?? 0;
  const pauses = pauseProfile(spoken);
  const limits: Limits = { budget: normalized, cap, maxWords, maxSecs, pauses };

  const groups: TimedWord[][] = [];
  let buf: TimedWord[] = [];
  let start: number | null = null;
  let end: number | null = null;
  let currentSpeaker: string | null = null;

  const flushAt = (cut: number) => {
    if (cut <= 0 || buf.length === 0) return buf;
    groups.push(buf.slice(0, cut));
    return buf.slice(cut);
  };
  const phraseCanMove = (at: number, endTime: number) =>
    (maxWords <= 0 || buf.length - at + 1 <= maxWords) && endTime - buf[at].start <= maxSecs;
  const cueFits = (at: number) => buf[at - 1].end - buf[0].start <= maxSecs;

  for (const word of spoken) {
    const { raw, text, start: ws, end: we } = word;
    if (start === null) start = ws;

    const speaker = word.speaker ?? null;
    if (buf.length && speaker !== null && currentSpeaker !== null && speaker !== currentSpeaker) {
      buf = flushAt(buf.length);
      start = ws;
      end = we;
    }
    if (speaker !== null) currentSpeaker = speaker;

    const script = wordScript(text);
    if (buf.length && script) {
      const held = bufScript(buf);
      if (held && held !== script) {
        buf = flushAt(buf.length);
        start = ws;
        end = we;
      }
    }

    // Real silence closes the cue — unless the word completes the phrase
    // before it and the gap is only the speaker's own hesitation.
    if (buf.length && end !== null) {
      const gap = ws - end;
      if (gap >= pauses.split && (!bindsBack(raw) || gap > GLUE_MAX_GAP)) {
        buf = flushAt(buf.length);
        start = ws;
        end = we;
      }
    }

    const prospectiveLen = vlen([...buf.map((entry) => entry.text), text].join(' '));
    const dur = we - (start ?? ws);
    const tooLong = prospectiveLen > cap;
    const tooLongDur = buf.length > 0 && dur > maxSecs;
    const tooFast = cps > 0 && buf.length > 0 && dur >= 0.5 && prospectiveLen / dur > cps;
    const tooManyWords = maxWords > 0 && buf.length >= maxWords;

    if ((tooLong || tooLongDur || tooFast || tooManyWords) && buf.length) {
      let cut = bestCut(buf, raw, ws, cap, pauses);
      const chain = cliticChainStart(buf, raw);

      // A word only moves to the next cue across a boundary that exists.
      if (cut < buf.length && !cutSupported(buf, cut, ws, pauses)) {
        if (!(cut === chain && phraseCanMove(chain, we)) && cueFits(buf.length)) cut = buf.length;
      }

      // Keep a phrase whole: hold the incoming word here (one word over
      // budget), else move the whole phrase forward, else let it open the cue.
      const bufChars = prospectiveLen - vlen(text) - 1;
      const mayDefer = !tooManyWords && !tooLongDur && bufChars <= cap;
      const realBoundary = cut < buf.length && cutSupported(buf, cut, ws, pauses);
      if (bindsBack(raw) && !realBoundary) {
        if (mayDefer) cut = 0;
        else if (cut === buf.length && chain > 0 && phraseCanMove(chain, we)) cut = chain;
      }

      buf = flushAt(cut);
      if (buf.length && we - buf[0].start > maxSecs) buf = flushAt(buf.length);
      start = buf.length ? buf[0].start : ws;
      end = buf.length ? buf[buf.length - 1].end : we;
    }

    buf.push(word);
    end = we;

    // A sentence terminator closes the cue, so sentences are never merged.
    if (endsWith(raw, STRONG_END)) {
      buf = flushAt(buf.length);
      start = null;
      end = null;
    }
  }
  if (buf.length) flushAt(buf.length);

  return rebalanceCues(reattachClitics(groups, limits), limits).map((group) => ({
    start: group[0].start,
    end: Math.max(group[group.length - 1].end, group[0].start),
    text: wrapWords(group, normalized),
  }));
};

/* ------------------------------------------------------------------ */
/* Screen-ready timing                                                 */
/* ------------------------------------------------------------------ */

/** Cues shorter than this stay up into the following silence so they can be read. */
export const MIN_READ_SECONDS = 0.4;
/** Silences up to this long between two cues are bridged, so captions do not flicker. */
export const GAP_CLOSE_SECONDS = 1.0;
const MIN_DURATION = 0.04;

/**
 * Sorted, non-overlapping, positive durations. Overlaps truncate the earlier
 * cue (or nudge the later one when truncating would erase it); short cues are
 * extended into silence up to `readDur`; gaps up to `closeGap` are absorbed by
 * the earlier cue, 1 ms short so the SRT stays non-overlapping. Longer
 * silences stay blank.
 */
export const sanitizeCues = <T extends TimedCue>(
  cues: T[],
  { readDur = MIN_READ_SECONDS, closeGap = GAP_CLOSE_SECONDS } = {}
): T[] => {
  const cleaned: T[] = [];
  for (const cue of [...cues].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (!cue.text.trim()) continue;
    let { start, end } = cue;
    if (end <= start) end = start + MIN_DURATION;
    const prev = cleaned[cleaned.length - 1];
    if (prev && start < prev.end) {
      if (start - prev.start >= MIN_DURATION) {
        cleaned[cleaned.length - 1] = { ...prev, end: start };
      } else {
        start = prev.end;
        if (end < start + MIN_DURATION) end = start + MIN_DURATION;
      }
    }
    cleaned.push({ ...cue, start, end });
  }

  if (readDur > MIN_DURATION) {
    cleaned.forEach((cue, i) => {
      if (cue.end - cue.start >= readDur) return;
      const limit = i + 1 < cleaned.length ? cleaned[i + 1].start - 0.001 : cue.start + readDur;
      cleaned[i] = { ...cue, end: Math.max(cue.end, Math.min(cue.start + readDur, limit)) };
    });
  }

  if (closeGap > 0) {
    for (let i = 0; i < cleaned.length - 1; i += 1) {
      const gap = cleaned[i + 1].start - cleaned[i].end;
      if (gap > 0 && gap <= closeGap) {
        cleaned[i] = { ...cleaned[i], end: Math.max(cleaned[i].end, cleaned[i + 1].start - 0.001) };
      }
    }
  }

  return cleaned;
};
