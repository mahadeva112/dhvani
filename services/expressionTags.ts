import type { AudioSegment } from '../types';
import { groupSections, PERFORMANCE_TAGS, wordsOf } from '../server/lib/sourceSections.js';

/**
 * Voice expression Natural, heard ahead of Dub. The original speaker's
 * delivery tags ([explaining, calm], [sentence-build pause]) are worked out
 * section by section (90 s of the source each, cut as the server cuts them)
 * while the user is still on Review, and kept with the project by line: a
 * line's tags belong to its words, times and language, so an edit only sends
 * its own section to be heard again, and a project opened again, or on
 * another computer, needs none heard. Dub then voices at once.
 *
 * The tags live beside the script, never in it: subtitles and the script
 * never see them, and the words are checked to be the line's own.
 */

export { PERFORMANCE_TAGS, wordsOf };

/** A line's dub text with its tags, and whether the user changed them by hand (kept when its section is heard again). */
export interface ExpressionLine {
  text: string;
  mine?: boolean;
}

/** Each line's tags, by expressionLineKey. */
export type ExpressionTags = Record<string, ExpressionLine>;

export const lineText = (segment: AudioSegment) => String(segment.textTarget || segment.targetText || '').trim();

/** FNV-1a, enough to tell one wording of a line from another. */
const hashOf = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

/** What a line's tags were heard for: its language, times and words. */
export const expressionLineKey = (language: string, segment: AudioSegment) =>
  `${language}|${segment.startTime.toFixed(2)}|${segment.endTime.toFixed(2)}|${hashOf(lineText(segment))}`;

/** A line's saved tags, if they were made for it as it is now. */
export const expressionOf = (tags: ExpressionTags | undefined, language: string, segment: AudioSegment): ExpressionLine | null => {
  const entry = tags?.[expressionLineKey(language, segment)];
  // The words must still be the line's own; anything else is voiced as written.
  return entry && wordsOf(entry.text) === wordsOf(lineText(segment)) ? entry : null;
};

export interface ExpressionSection {
  indexes: number[];
  start: number;
  end: number;
}

export interface ExpressionPlan {
  /** Every section of the script, and those with a line not heard yet. */
  sections: ExpressionSection[];
  toHear: ExpressionSection[];
  keys: string[];
}

export const planExpression = (segments: AudioSegment[], language: string, tags: ExpressionTags | undefined): ExpressionPlan => {
  const sections: ExpressionSection[] = groupSections(segments.map((s) => ({ start: s.startTime, end: s.endTime, text: lineText(s) })));
  const keys = segments.map((s) => expressionLineKey(language, s));
  const heard = (i: number) => Boolean(expressionOf(tags, language, segments[i]));
  return { sections, toHear: sections.filter((section) => !section.indexes.every(heard)), keys };
};

/** Only the lines the script has now: wordings edited away are dropped. */
export const keepCurrent = (tags: ExpressionTags, segments: AudioSegment[], language: string): ExpressionTags => {
  const out: ExpressionTags = {};
  for (const segment of segments) {
    const key = expressionLineKey(language, segment);
    if (tags[key]) out[key] = tags[key];
  }
  return out;
};

/** The segments as the voice reads them: each heard line's text with its tags. */
export const taggedSegments = (segments: AudioSegment[], language: string, tags: ExpressionTags | undefined): AudioSegment[] =>
  segments.map((segment) => {
    const entry = lineText(segment) ? expressionOf(tags, language, segment) : null;
    return entry ? { ...segment, textTarget: entry.text, targetText: undefined } : segment;
  });

/* ---------- Tags of one line, for the chips on Review's open line ---------- */

const TAG = /\[([^\]\n]{1,120})\]/g;

export interface LineTag {
  /** What is inside the brackets. */
  tag: string;
  /** The word it comes before ('' at the end). */
  before: string;
}

export const tagsInLine = (text: string): LineTag[] =>
  [...text.matchAll(TAG)].map((match) => {
    const after = text.slice((match.index ?? 0) + match[0].length).replace(TAG, ' ').trim();
    return { tag: match[1], before: after.split(/\s+/)[0]?.replace(/^[.…]+/, '') || '' };
  });

const tidy = (text: string) => text.replace(/[^\S\n]+/g, ' ').trim();

/** The line without its `index`-th tag. */
export const removeTag = (text: string, index: number) => {
  let n = -1;
  return tidy(text.replace(TAG, (whole) => (++n === index ? ' ' : whole)));
};

/** The line with `tag` added at its start. */
export const addTag = (text: string, tag: string) => tidy(`[${tag}] ${text}`);
