import type { AudioSegment } from '../types';

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
  /** Cues whose text is a guess the user should check. */
  estimated?: boolean[];
  /** Something the user should know about how the split went. */
  note?: string;
}

/** The lines of a pasted script, blank lines left out. */
export const scriptLines = (script: string): string[] =>
  script.split('\n').map((l) => l.trim()).filter(Boolean);

// Gale & Church's sentence alignment: how likely each way of pairing lines
// with cues is, and how far a translation's length strays from the original's.
const MOVES: { lines: number; cues: number; cost: number }[] = [
  { lines: 1, cues: 1, cost: -Math.log(0.89) },
  { lines: 2, cues: 1, cost: -Math.log(0.089) },
  { lines: 1, cues: 2, cost: -Math.log(0.089) },
  { lines: 0, cues: 1, cost: -Math.log(0.01) },
  { lines: 3, cues: 1, cost: -Math.log(0.005) },
  { lines: 1, cues: 3, cost: -Math.log(0.005) },
];
const LENGTH_VARIANCE = 6.8;

/** Two-sided tail of the normal distribution, from an erf approximation. */
const normalTail = (z: number) => {
  const t = 1 / (1 + 0.3275911 * (z / Math.SQRT2));
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return Math.max(1e-12, 1 - erf);
};

/** How unlikely `target` characters are as a translation of `english` characters. */
const lengthCost = (english: number, target: number, ratio: number) => {
  if (english === 0 && target === 0) return 0;
  const z = Math.abs(target - english * ratio) / Math.sqrt(Math.max(1, english) * LENGTH_VARIANCE * ratio);
  return -Math.log(normalTail(z));
};

/**
 * Line 1 to cue 1 and so on. When the counts differ, lines are paired with
 * cues by length, so one line too many or too few only moves the lines near
 * it instead of every line after it; the cues around each such place are
 * flagged.
 */
export const splitByLines = (script: string, segments: AudioSegment[]): QuickSplit => {
  const lines = scriptLines(script);
  const n = segments.length;
  if (lines.length === n || lines.length === 0 || n === 0) {
    return { texts: segments.map((_, i) => lines[i] || '') };
  }

  const english = segments.map((s) => englishOf(s).trim().length);
  const target = lines.map((l) => l.length);
  const ratio = (target.reduce((a, b) => a + b, 0) || 1) / (english.reduce((a, b) => a + b, 0) || 1);

  // cost[i][j]: cheapest pairing of the first i lines with the first j cues.
  const cost = Array.from({ length: lines.length + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const step = Array.from({ length: lines.length + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      if (cost[i][j] === Infinity) continue;
      MOVES.forEach((move, m) => {
        const ni = i + move.lines;
        const nj = j + move.cues;
        if (ni > lines.length || nj > n) return;
        let e = 0;
        for (let k = j; k < nj; k += 1) e += english[k];
        let t = 0;
        for (let k = i; k < ni; k += 1) t += target[k];
        // A cue with no speech taking no line is free.
        const c = cost[i][j] + (move.lines === 0 && e === 0 ? 0 : move.cost + lengthCost(e, t, ratio));
        if (c < cost[ni][nj]) {
          cost[ni][nj] = c;
          step[ni][nj] = m;
        }
      });
    }
  }

  const texts = segments.map(() => '');
  const estimated = segments.map(() => false);
  const flagged: string[] = [];
  for (let i = lines.length, j = n; i > 0 || j > 0; ) {
    const move = MOVES[step[i][j]];
    const from = { line: i - move.lines, cue: j - move.cues };
    const pairedLines = lines.slice(from.line, i);
    const cueIndexes = Array.from({ length: move.cues }, (_, k) => from.cue + k);
    if (move.cues === 1) {
      texts[from.cue] = pairedLines.join(' ');
    } else {
      // One line over several cues: its words are shared out by the cues' length.
      const parts = distribute(pairedLines.join(' ').split(/\s+/).filter(Boolean), cueIndexes.map((c) => english[c]));
      cueIndexes.forEach((c, k) => (texts[c] = parts[k]));
    }
    if (move.lines !== 1 || move.cues !== 1) {
      cueIndexes.forEach((c) => (estimated[c] = english[c] > 0));
      if (cueIndexes.some((c) => estimated[c])) flagged.unshift(move.cues > 1 ? `${from.cue + 1}–${j}` : String(j));
    }
    i = from.line;
    j = from.cue;
  }

  const places = flagged.length > 5 ? `${flagged.slice(0, 5).join(', ')} and ${flagged.length - 5} more` : flagged.join(', ');
  const note =
    `Your script has ${lines.length} lines for ${n} cues, so lines were paired with cues by length.` +
    (flagged.length ? ` Check ${flagged.length === 1 && !flagged[0].includes('–') ? 'cue' : 'cues'} ${places}, where lines were joined, split or missing.` : '');
  return { texts, estimated, note };
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
