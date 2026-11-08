import type { AudioSegment, EditedSubtitle } from '../types';
import { GAP_CLOSE_SECONDS, vlen, wrapBalanced } from './subtitleCues.ts';

/*
 * Subtitles edited by hand in Export subtitles. Editing starts from the
 * automatic cuts on screen; from then on the edited list is what that track
 * and timing exports, as .srt, .vtt or a script. Nothing here touches the
 * dub or its script.
 */

/** Which export an edit belongs to: the language track and what it is timed to. */
export const subtitleEditKey = (track: string, timing: string) => `${track}:${timing}`;

/** A short fingerprint of a text, to tell whether the automatic subtitles changed since an edit began. */
export const fingerprint = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** 56.4 -> "00:00:56,400" (".400" for WebVTT). */
export const stamp = (seconds: number, separator: ',' | '.' = ','): string => {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}${separator}${pad(ms, 3)}`;
};

/**
 * Reads a time typed by hand: "00:01:02,500", "1:02.5", "62.5" or "62".
 * Returns null when it isn't a time.
 */
export const parseStampInput = (input: string): number | null => {
  const text = input.trim().replace(',', '.');
  if (!text) return null;
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  // Only the last part may carry a fraction.
  if (parts.slice(0, -1).some((p) => p.includes('.'))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
};

/** Subtitles with text, in time order: an emptied one is left out. */
const kept = (cues: EditedSubtitle[]) =>
  cues.filter((c) => c.text.trim() && c.end > c.start).sort((a, b) => a.start - b.start);

const body = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

export const editedSrt = (cues: EditedSubtitle[]): string =>
  kept(cues)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${body(c.text)}`)
    .join('\n\n');

export const editedVtt = (cues: EditedSubtitle[]): string =>
  `WEBVTT\n\n${kept(cues)
    .map((c, i) => `${i + 1}\n${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${body(c.text)}`)
    .join('\n\n')}`;

/** The subtitles as cues for the script formats: one line of text each, at its time. */
export const subtitlesAsScript = (cues: EditedSubtitle[]): AudioSegment[] =>
  kept(cues).map((c, i) => {
    const text = body(c.text).replace(/\n/g, ' ');
    return {
      id: `subtitle-${i + 1}`,
      startTime: c.start,
      endTime: c.end,
      duration: c.end - c.start,
      textTarget: text,
      targetText: text,
    };
  });

/* ------------------------------------------------------------------ */
/* Split, merge and wrap, as in Srutilekha's review editor            */
/* ------------------------------------------------------------------ */

/** The limits a hand-edited subtitle is checked against and wrapped to. */
export interface SubtitleLimits {
  maxChars: number;
  maxLines: number;
  /** Characters per second above which a subtitle is too fast to read; 0 = off. */
  maxCps: number;
}

export const DEFAULT_MAX_CPS = 20;

/** A word's place in the audio, in seconds. */
export interface WordTime {
  start: number;
  end: number;
}

export interface SubtitleStats {
  /** Each line's visual length, in aksharas. */
  lineChars: number[];
  cps: number;
  overCps: boolean;
  overLines: boolean;
  /** A line runs past the character limit. */
  longLine: boolean;
  issue: boolean;
}

const tokens = (text: string) => text.split(/\s+/).filter(Boolean);

/** How a subtitle reads against the limits: measured from the text a viewer sees. */
export const subtitleStats = (cue: EditedSubtitle, limits: SubtitleLimits): SubtitleStats => {
  const lines = cue.text.split('\n');
  const lineChars = lines.map((line) => vlen(line.trim()));
  const cps = vlen(cue.text.replace(/\s*\n\s*/g, ' ').trim()) / Math.max(0.001, cue.end - cue.start);
  const overCps = limits.maxCps > 0 && cps > limits.maxCps;
  const overLines = lines.length > limits.maxLines;
  const longLine = lineChars.some((n) => n > limits.maxChars);
  return { lineChars, cps, overCps, overLines, longLine, issue: overCps || overLines || longLine };
};

/** Changed by hand since editing began: its text differs, or it was split or merged. */
export const isEditedSubtitle = (cue: EditedSubtitle) => cue.auto === undefined || cue.text !== cue.auto;

/** How many words lie before the caret (a word the caret is inside counts). */
export const wordsBeforeCaret = (text: string, caret: number) => tokens(text.slice(0, Math.max(0, caret))).length;

/**
 * The measured words said inside a subtitle, when there is one for each of
 * its words; otherwise null and a split shares its time out by length.
 */
export const measuredWordsFor = (cue: EditedSubtitle, words: WordTime[]): WordTime[] | null => {
  const inside = words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return mid >= cue.start - 0.02 && mid <= cue.end + 0.02;
  });
  return inside.length > 0 && inside.length === tokens(cue.text).length ? inside : null;
};

/** The subtitle's words spread over its span by visual length. */
const estimatedWords = (cue: EditedSubtitle): WordTime[] => {
  const ws = tokens(cue.text);
  const weights = ws.map((w) => vlen(w) + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0, cue.end - cue.start);
  let at = cue.start;
  return weights.map((weight) => {
    const start = at;
    at += (weight / total) * span;
    return { start, end: at };
  });
};

export interface SubtitleSplit {
  first: EditedSubtitle;
  second: EditedSubtitle;
  /** The cut was shared out by word length: no measured word times for this subtitle. */
  estimated: boolean;
  /** Seconds of silence between the two halves. */
  pause: number;
  /** The word the first half now ends on. */
  lastWord: string;
}

/**
 * Srutilekha's split: one new boundary before word `nLeft`, outer edges
 * unchanged. The second half starts where its first word is said; the first
 * runs up to it when the silence between is short, so the captions don't
 * flicker. Each half is wrapped again to the limits. Null when the cut isn't
 * between two words.
 */
export const splitSubtitle = (
  cue: EditedSubtitle,
  nLeft: number,
  limits: SubtitleLimits,
  words: WordTime[]
): SubtitleSplit | null => {
  const ws = tokens(cue.text);
  if (ws.length < 2 || nLeft < 1 || nLeft >= ws.length) return null;
  const measured = measuredWordsFor(cue, words);
  const times = measured ?? estimatedWords(cue);
  const cut = times[nLeft].start;
  let leftEnd = times[nLeft - 1].end;
  if (cut - leftEnd > 0 && cut - leftEnd <= GAP_CLOSE_SECONDS) leftEnd = cut - 0.001;
  leftEnd = Math.max(cue.start + 0.001, Math.min(leftEnd, cut - 0.001));
  const estimated = !measured || Boolean(cue.estimated);
  const half = (text: string, start: number, end: number): EditedSubtitle => ({
    start,
    end,
    text: wrapBalanced(text, limits.maxChars, limits.maxLines),
    ...(estimated ? { estimated: true } : {}),
  });
  return {
    first: half(ws.slice(0, nLeft).join(' '), cue.start, leftEnd),
    second: half(ws.slice(nLeft).join(' '), cut, Math.max(cue.end, cut + 0.001)),
    estimated: !measured,
    pause: Math.max(0, cut - times[nLeft - 1].end),
    lastWord: ws[nLeft - 1],
  };
};

/** Srutilekha's merge: the first subtitle takes in the next, wrapped again to the limits. */
export const mergeSubtitles = (a: EditedSubtitle, b: EditedSubtitle, limits: SubtitleLimits): EditedSubtitle => ({
  start: a.start,
  end: Math.max(a.end, b.end),
  text: wrapBalanced(`${a.text} ${b.text}`, limits.maxChars, limits.maxLines),
  ...(a.estimated || b.estimated ? { estimated: true } : {}),
});

/** The subtitle's words set again in balanced lines. */
export const wrapSubtitle = (cue: EditedSubtitle, limits: SubtitleLimits): EditedSubtitle => ({
  ...cue,
  text: wrapBalanced(cue.text, limits.maxChars, limits.maxLines),
});
