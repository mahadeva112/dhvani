import type { AudioSegment, EditedSubtitle } from '../types';

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
