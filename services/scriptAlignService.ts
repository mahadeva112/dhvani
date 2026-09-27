import { AudioSegment } from '../types';

/**
 * Local helpers for fitting a pasted script onto cues: cleaning up what was
 * pasted and the quick split methods that need no model. Placing by meaning
 * runs on the backend (`alignCustomScriptWithGemini`).
 */

const TIMING_LINE =
  /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?.*$/;

export interface CleanedScript {
  /** The script with subtitle numbering and timings removed. */
  text: string;
  /** Number of subtitle blocks when the paste was an SRT/VTT file, else null. */
  subtitleBlocks: number | null;
}

/**
 * Strips SRT/VTT scaffolding from a paste. Each subtitle block becomes one
 * line, so "one line per cue" still lines up block for block. Plain text is
 * returned as it is.
 */
export const cleanPastedScript = (raw: string): CleanedScript => {
  const text = String(raw ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (!lines.some((line) => TIMING_LINE.test(line))) return { text: text.trim(), subtitleBlocks: null };

  const blocks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) blocks.push(current.join(' '));
    current = [];
  };
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return flush();
    if (TIMING_LINE.test(line)) return flush();
    if (/^WEBVTT\b/i.test(line) && blocks.length === 0 && current.length === 0) return;
    // A cue number or VTT cue id sits on the line right before its timing.
    if (current.length === 0 && TIMING_LINE.test(lines[i + 1] ?? '')) return;
    current.push(line.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\{\\[^}]*\}/g, ''));
  });
  flush();
  const kept = blocks.map((b) => b.trim()).filter(Boolean);
  return { text: kept.join('\n'), subtitleBlocks: kept.length };
};

const englishOf = (segment: AudioSegment) => segment.textSource || segment.originalText || '';

/** How much of the script a cue should take, from the length of its English. */
const cueWeights = (segments: AudioSegment[]) =>
  segments.map((segment) => {
    const text = englishOf(segment).trim();
    return text ? Math.max(1, text.length) : 0;
  });

/**
 * Gives each unit to the cue that covers its midpoint when the script and the
 * cues are both laid end to end by length. Units stay in order, cues with no
 * English get nothing, and the last cue never collects a pile-up.
 */
const distribute = (units: string[], weights: number[], joiner = ' '): string[] => {
  const out = weights.map(() => [] as string[]);
  if (units.length === 0 || weights.length === 0) return out.map(() => '');
  const hasWeight = weights.some((w) => w > 0);
  const w = hasWeight ? weights : weights.map(() => 1);
  const totalWeight = w.reduce((a, b) => a + b, 0);
  const cueEnds: number[] = [];
  w.reduce((acc, value, i) => (cueEnds[i] = acc + value), 0);

  const sizes = units.map((u) => u.length + 1);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  let before = 0;
  let cue = 0;
  units.forEach((unit, i) => {
    const mid = ((before + sizes[i] / 2) / totalSize) * totalWeight;
    before += sizes[i];
    while (cue < w.length - 1 && cueEnds[cue] <= mid) cue += 1;
    out[cue].push(unit);
  });
  return out.map((parts) => parts.join(joiner));
};

export interface QuickSplit {
  texts: string[];
  /** Something the user should know about how the split went. */
  note?: string;
}

/** Line 1 to cue 1 and so on. Extra lines join the last cue. */
export const splitByLines = (script: string, segments: AudioSegment[]): QuickSplit => {
  const lines = script.split('\n').map((l) => l.trim()).filter(Boolean);
  const n = segments.length;
  const texts = segments.map((_, i) => (i < n - 1 ? lines[i] || '' : lines.slice(i).join(' ')));
  let note: string | undefined;
  if (lines.length > n) note = `Your script has ${lines.length} lines for ${n} cues, so the last ${lines.length - n + 1} lines are all in the last cue.`;
  else if (lines.length < n) note = `Your script has ${lines.length} lines for ${n} cues, so the last ${n - lines.length} cues are empty.`;
  return { texts, note };
};

/** Whole sentences, shared out by the length of each cue's English. */
export const splitBySentences = (script: string, segments: AudioSegment[]): QuickSplit => {
  const sentences = script
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?।॥。！？…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const texts = distribute(sentences, cueWeights(segments));
  const note =
    sentences.length < segments.length
      ? `Your script has ${sentences.length} sentences for ${segments.length} cues, so some cues are empty. "By meaning" can split a sentence across cues.`
      : undefined;
  return { texts, note };
};

/** Words shared out by the length of each cue's English. */
export const splitByLength = (script: string, segments: AudioSegment[]): QuickSplit => ({
  texts: distribute(script.split(/\s+/).filter(Boolean), cueWeights(segments)),
});

/** Moves the last word of cue `index` to the start of the next cue, or the first word to the end of the previous one. */
export const shiftWord = (texts: string[], index: number, direction: 'next' | 'previous'): string[] => {
  const target = direction === 'next' ? index + 1 : index - 1;
  if (target < 0 || target >= texts.length) return texts;
  const words = texts[index].trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return texts;
  const copy = [...texts];
  if (direction === 'next') {
    const word = words.pop()!;
    copy[target] = `${word} ${copy[target].trim()}`.trim();
  } else {
    const word = words.shift()!;
    copy[target] = `${copy[target].trim()} ${word}`.trim();
  }
  copy[index] = words.join(' ');
  return copy;
};

/** Whether the cues, read in order, still hold exactly the pasted script. */
export const holdsWholeScript = (texts: string[], script: string): boolean =>
  texts.join('').replace(/\s+/g, '') === script.replace(/\s+/g, '');

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
