import type { AudioSegment } from '../types';
import { sourceOf, timingProblems, type TimingProblem } from './transcriptSegments.ts';

/*
 * The transcript as text files, from the transcript screen: running
 * paragraphs to read, or one subtitle per segment. Both say exactly what was
 * transcribed; only line breaks and the spaces around them change.
 *
 * Kept free of browser-only imports so `node --test` can load it as it is.
 */

/** A pause at least this long in the original starts a new paragraph (the Script view's default). */
export const PARAGRAPH_PAUSE_SECONDS = 1.2;

const spoken = (segments: AudioSegment[]) => segments.filter((seg) => sourceOf(seg).trim());

/**
 * The transcript as paragraphs, no timestamps: segments said in one go run on,
 * and a new paragraph starts where the speaker paused or another one spoke.
 */
export const transcriptParagraphs = (segments: AudioSegment[], pause = PARAGRAPH_PAUSE_SECONDS): string => {
  const paragraphs: string[][] = [];
  let previous: AudioSegment | null = null;
  for (const seg of spoken(segments)) {
    const gap = previous ? seg.startTime - previous.endTime : NaN;
    const sameSpeaker = previous && (previous.speaker || '') === (seg.speaker || '');
    // A gap that can't be measured (bad times) starts a paragraph rather than guessing.
    if (!previous || !sameSpeaker || !(gap < pause)) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(sourceOf(seg).trim().replace(/\s*\n\s*/gu, ' '));
    previous = seg;
  }
  return paragraphs.length ? `${paragraphs.map((p) => p.join(' ')).join('\n\n')}\n` : '';
};

/** "Satsang talk" -> "Satsang talk - transcript.srt", safe as a file name everywhere. */
export const transcriptFileName = (name: string, extension: string) =>
  `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'Transcript'} - transcript${extension}`;

/** 3725.5 -> "01:02:05,500" */
export const srtTime = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`;
};

/** The subtitles, or the segments whose times stop them; a problem's index is its place among all segments. */
export type SrtResult =
  | { kind: 'ready'; content: string; count: number }
  | { kind: 'blocked'; problems: TimingProblem[] };

/**
 * One subtitle per spoken segment, numbered in order, on the segments' own
 * times. Times that can't make a subtitle (missing, reversed, no length at
 * millisecond precision, or overlapping the one before) are reported, and
 * nothing is written or moved.
 */
export const transcriptSrt = (segments: AudioSegment[]): SrtResult => {
  const indexOf = new Map(segments.map((seg, i) => [seg, i]));
  const cues = spoken(segments);
  // Checked at the precision the file is written in, so a cue can't round to nothing.
  const asWritten = cues.map((seg) => ({
    ...seg,
    startTime: Math.round(seg.startTime * 1000) / 1000,
    endTime: Math.round(seg.endTime * 1000) / 1000,
  }));
  const problems = timingProblems(asWritten).map((p) => ({
    ...p,
    index: indexOf.get(cues[p.index])!,
    start: cues[p.index].startTime,
    end: cues[p.index].endTime,
  }));
  if (problems.length) return { kind: 'blocked', problems };
  const content = cues
    .map((seg, i) => {
      const text = sourceOf(seg).trim().replace(/\r\n?/gu, '\n').replace(/\n\s*\n+/gu, '\n');
      return `${i + 1}\n${srtTime(seg.startTime)} --> ${srtTime(seg.endTime)}\n${text}\n`;
    })
    .join('\n');
  return { kind: 'ready', content, count: cues.length };
};

/** "05 ends before it starts (0:33.50 → 0:27.90)" */
export const describeTimingProblem = (p: TimingProblem): string => {
  const n = String(p.index + 1).padStart(2, '0');
  const t = (s: number) => {
    if (!Number.isFinite(s)) return 'no time';
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
  };
  const span = `(${t(p.start)} → ${t(p.end)})`;
  switch (p.kind) {
    case 'invalid':
      return `${n} has no usable time ${span}`;
    case 'reversed':
      return `${n} ends before it starts ${span}`;
    case 'zero':
      return `${n} has no length ${span}`;
    case 'overlap':
      return `${n} starts before the one before it ends ${span}`;
  }
};
