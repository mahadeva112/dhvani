import type { AudioSegment } from '../types';

/**
 * A script saved to be opened on another computer: every cue's time, speaker,
 * source line and target line. Opening it there puts each line back on the
 * cue at the same time, so the lines keep the meaning they were written for
 * even when that computer's transcript cut the audio into different cues.
 *
 * Kept free of runtime imports so `node --test` can load it as it is.
 */

export const SCRIPT_FILE_KIND = 'dhvani-script';
export const SCRIPT_FILE_VERSION = 1;

export interface ScriptFileCue {
  start: number;
  end: number;
  speaker?: string;
  source: string;
  target: string;
}

export interface ScriptFile {
  kind: typeof SCRIPT_FILE_KIND;
  version: number;
  title?: string;
  /** The audio the cues were timed on. */
  sourceFile?: { name?: string; duration?: number };
  sourceLanguage?: string;
  targetLanguage: string;
  exportedAt: string;
  cues: ScriptFileCue[];
}

const sourceOf = (seg: AudioSegment) => (seg.textSource || seg.originalText || seg.text || '').trim();
const targetOf = (seg: AudioSegment) => (seg.textTarget || seg.targetText || '').trim();

export const buildScriptFile = (
  segments: AudioSegment[],
  meta: { targetLanguage: string; sourceLanguage?: string; title?: string; fileName?: string; audioDuration?: number }
): ScriptFile => ({
  kind: SCRIPT_FILE_KIND,
  version: SCRIPT_FILE_VERSION,
  ...(meta.title ? { title: meta.title } : {}),
  sourceFile: {
    ...(meta.fileName ? { name: meta.fileName } : {}),
    ...(meta.audioDuration ? { duration: Number(meta.audioDuration.toFixed(3)) } : {}),
  },
  ...(meta.sourceLanguage ? { sourceLanguage: meta.sourceLanguage } : {}),
  targetLanguage: meta.targetLanguage,
  exportedAt: new Date().toISOString(),
  cues: segments.map((seg) => ({
    start: Number(seg.startTime.toFixed(3)),
    end: Number(seg.endTime.toFixed(3)),
    ...(seg.speaker ? { speaker: seg.speaker } : {}),
    source: sourceOf(seg),
    target: targetOf(seg),
  })),
});

/** What a paste or an opened file turned out to be, when it came from Dhvani. */
export type DhvaniScript =
  /** Lines with their times: a script file, or a timecoded or bilingual export. `coarse` when times are to the second. */
  | { kind: 'cues'; file: ScriptFile; coarse: boolean }
  /** The dialogue export: one line per cue, no times. */
  | { kind: 'lines'; lines: string[] };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const fromJson = (raw: string): ScriptFile | null => {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  // This format, or the JSON script export from before it.
  const list: any[] | null = Array.isArray(data.cues) ? data.cues : Array.isArray(data.segments) ? data.segments : null;
  if (!list) return null;
  const cues = list
    .map((c) => ({
      start: num(c?.start ?? c?.startTime),
      end: num(c?.end ?? c?.endTime),
      speaker: str(c?.speaker) || undefined,
      source: str(c?.source ?? c?.sourceText).trim(),
      target: str(c?.target ?? c?.targetText).trim(),
    }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end >= c.start);
  if (cues.length === 0) return null;
  const duration = num(data.sourceFile?.duration);
  return {
    kind: SCRIPT_FILE_KIND,
    version: num(data.version) || 0,
    title: str(data.title) || undefined,
    sourceFile: {
      name: str(data.sourceFile?.name) || undefined,
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    },
    sourceLanguage: str(data.sourceLanguage) || undefined,
    targetLanguage: str(data.targetLanguage ?? data.language),
    exportedAt: str(data.exportedAt),
    cues,
  };
};

const RULE = /^\s*={8,}\s*$/;
const DIVIDER = /^\s*-{8,}\s*$/;
const TIME = String.raw`(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})`;
const TIMECODED_HEAD = new RegExp(String.raw`^\s*CUE #\d+ \[${TIME}\s*(?:➔|->|-->)\s*${TIME}\]`);
const BILINGUAL_HEAD = /^\s*\[#\d+ \| (\d{1,3}):(\d{2}) - (\d{1,3}):(\d{2})\]\s*(.*)$/;

const seconds = (h: string, m: string, s: string, ms: string) => +h * 3600 + +m * 60 + +s + +ms.padEnd(3, '0') / 1000;

/** The header Dhvani puts on its text exports: a rule, a few lines, a rule. Returns the lines after it, or null. */
const afterHeader = (lines: string[]): { header: string[]; body: string[] } | null => {
  const first = lines.findIndex((l) => l.trim());
  if (first < 0 || !RULE.test(lines[first])) return null;
  const close = lines.findIndex((l, i) => i > first && RULE.test(l));
  if (close < 0 || close - first > 6) return null;
  const header = lines.slice(first + 1, close).map((l) => l.trim());
  if (!header.some((l) => /^(Target )?Language:/i.test(l) || /^Total Cues:/i.test(l))) return null;
  return { header, body: lines.slice(close + 1) };
};

/** Blocks of non-blank lines, with divider lines dropped. */
const blocksOf = (lines: string[]) => {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line.trim() || DIVIDER.test(line)) {
      if (current.length) blocks.push(current);
      current = [];
    } else current.push(line.trim());
  }
  if (current.length) blocks.push(current);
  return blocks;
};

const fileOf = (cues: ScriptFileCue[], targetLanguage: string): ScriptFile => ({
  kind: SCRIPT_FILE_KIND,
  version: 0,
  targetLanguage,
  exportedAt: '',
  cues,
});

/**
 * Reads a script Dhvani wrote: the script file, the old JSON export, or one of
 * the text exports pasted back in. Anything else returns null and is treated
 * as an ordinary pasted script.
 */
export const readDhvaniScript = (raw: string): DhvaniScript | null => {
  const text = String(raw ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    const file = fromJson(text);
    return file ? { kind: 'cues', file, coarse: false } : null;
  }

  const parts = afterHeader(text.split('\n'));
  if (!parts) return null;
  const language = (parts.header.find((l) => /Language:/i.test(l)) ?? '').replace(/^.*Language:\s*/i, '').trim();
  const blocks = blocksOf(parts.body);
  if (blocks.length === 0) return null;

  if (blocks.every((b) => TIMECODED_HEAD.test(b[0]))) {
    const cues = blocks.map((b) => {
      const m = b[0].match(TIMECODED_HEAD)!;
      // "Speaker: line", where the speaker is never empty.
      const body = b.slice(1).join(' ');
      const colon = body.indexOf(': ');
      const speaker = colon > 0 ? body.slice(0, colon) : undefined;
      const target = (colon > 0 ? body.slice(colon + 2) : body).trim();
      return {
        start: seconds(m[1], m[2], m[3], m[4]),
        end: seconds(m[5], m[6], m[7], m[8]),
        speaker,
        source: '',
        target: target === '(No translation)' ? '' : target,
      };
    });
    return { kind: 'cues', file: fileOf(cues, language), coarse: false };
  }

  if (blocks.every((b) => BILINGUAL_HEAD.test(b[0]))) {
    const cues = blocks.map((b) => {
      const m = b[0].match(BILINGUAL_HEAD)!;
      // "ORIGINAL: …" then "<LANGUAGE>: …"; either may run over several lines.
      const label = `${language.toUpperCase()}:`;
      const at = b.findIndex((l, i) => i > 1 && (language ? l.startsWith(label) : /^[^:]{1,40}:/.test(l)));
      const targetAt = at > 0 ? at : b.length - 1;
      return {
        start: +m[1] * 60 + +m[2],
        end: +m[3] * 60 + +m[4],
        speaker: m[5].trim() || undefined,
        source: b.slice(1, targetAt).join(' ').replace(/^ORIGINAL:\s?/, '').trim(),
        target: b.slice(targetAt).join(' ').replace(/^[^:]{1,40}:\s?/, '').trim(),
      };
    });
    return { kind: 'cues', file: fileOf(cues, language), coarse: true };
  }

  // The dialogue export: "[Speaker] line", a blank line between cues.
  return { kind: 'lines', lines: blocks.map((b) => b.join(' ').replace(/^\[[^\]\n]{1,60}\]\s+/, '').trim()).filter(Boolean) };
};

/** How the lines of a script file were put on this project's cues. */
export interface ScriptMapping {
  /** 'same': the file has these very cues. 'timed': the cues differ and lines were placed by time. */
  match: 'same' | 'timed';
  /** One per cue of this project. */
  texts: string[];
  /** Cues whose text came from a line split over several cues by length; check them, or place them by meaning. */
  estimated: boolean[];
  /**
   * Runs of cues that share lines of the file which were split over them by
   * length. Each can be placed again by meaning on its own: `text` is the
   * lines, in order, and `cues` the indexes of this project's cues.
   */
  windows: { cues: number[]; text: string }[];
  /** Set when the file was timed on audio of another length. */
  audioMismatch: { file: number; here: number } | null;
}

/** Overlap in seconds above which a line of the file and a cue here are taken to say the same thing. */
const linkedBy = (a: { start: number; end: number }, b: { start: number; end: number }) => {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const shorter = Math.max(0.01, Math.min(a.end - a.start, b.end - b.start));
  return { overlap, linked: overlap >= Math.max(0.12, shorter * 0.2) };
};

/** Splits text over cues by their length, on word boundaries, in order. */
export const splitOverCues = (text: string, durations: number[]): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const total = durations.reduce((a, b) => a + Math.max(0.01, b), 0);
  const out = durations.map(() => [] as string[]);
  const sizes = words.map((w) => w.length + 1);
  const size = sizes.reduce((a, b) => a + b, 0);
  let before = 0;
  let cue = 0;
  let end = Math.max(0.01, durations[0] ?? 0);
  words.forEach((word, i) => {
    const mid = ((before + sizes[i] / 2) / size) * total;
    before += sizes[i];
    while (cue < durations.length - 1 && end <= mid) {
      cue += 1;
      end += Math.max(0.01, durations[cue]);
    }
    out[cue].push(word);
  });
  return out.map((w) => w.join(' '));
};

/**
 * Puts each line of a script file on this project's cues. When the cues are
 * the ones the file was saved from, each line goes back to its cue. Otherwise
 * each line goes to the cues it overlaps in time: lines that fall inside one
 * cue join it whole, and a line that runs over several cues is split over
 * them by length and returned as a window to place by meaning. Every line of
 * the file lands somewhere, in order.
 */
export const mapScriptToCues = (
  file: ScriptFile,
  segments: AudioSegment[],
  { audioDuration, coarse = false }: { audioDuration?: number; coarse?: boolean } = {}
): ScriptMapping => {
  const lines = file.cues.filter((c) => c.target.trim());
  const fileDuration = file.sourceFile?.duration;
  const audioMismatch =
    fileDuration && audioDuration && Math.abs(fileDuration - audioDuration) > Math.max(1.5, audioDuration * 0.01)
      ? { file: fileDuration, here: audioDuration }
      : null;
  const n = segments.length;
  const empty = { texts: segments.map(() => ''), estimated: segments.map(() => false), windows: [], audioMismatch };

  const tolerance = coarse ? 1.01 : 0.25;
  if (
    file.cues.length === n &&
    file.cues.every((c, i) => Math.abs(c.start - segments[i].startTime) <= tolerance && Math.abs(c.end - segments[i].endTime) <= tolerance)
  ) {
    return { ...empty, match: 'same', texts: file.cues.map((c) => c.target.trim()) };
  }
  if (n === 0 || lines.length === 0) return { ...empty, match: 'timed' };

  const cues = segments.map((s) => ({ start: s.startTime, end: s.endTime }));
  // Lines and cues joined by overlap; each connected group is placed together.
  const parent = Array.from({ length: lines.length + n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  lines.forEach((line, li) => {
    let best = -1;
    let bestOverlap = 0;
    let linkedAny = false;
    cues.forEach((cue, ci) => {
      const { overlap, linked } = linkedBy(line, cue);
      if (linked) {
        join(li, lines.length + ci);
        linkedAny = true;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = ci;
      }
    });
    if (linkedAny) return;
    if (best < 0) {
      // Touches no cue at all: the cue nearest in time takes it.
      const mid = (line.start + line.end) / 2;
      best = cues.reduce((b, cue, ci) => (Math.abs((cue.start + cue.end) / 2 - mid) < Math.abs((cues[b].start + cues[b].end) / 2 - mid) ? ci : b), 0);
    }
    join(li, lines.length + best);
  });

  const groups = new Map<number, { lines: number[]; cues: number[] }>();
  const groupOf = (i: number) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { lines: [], cues: [] });
    return groups.get(root)!;
  };
  lines.forEach((_, li) => groupOf(li).lines.push(li));
  cues.forEach((_, ci) => groups.get(find(lines.length + ci))?.cues.push(ci));

  // Each group as a run of cues; runs that cross (a very short cue between two
  // a line spans) become one, so no cue is filled by two groups.
  const runs: { from: number; to: number; lines: number[] }[] = [];
  [...groups.values()]
    .map((g) => ({ from: Math.min(...g.cues), to: Math.max(...g.cues), lines: g.lines }))
    .sort((a, b) => a.from - b.from)
    .forEach((run) => {
      const last = runs[runs.length - 1];
      if (last && run.from <= last.to) {
        last.to = Math.max(last.to, run.to);
        last.lines.push(...run.lines);
      } else runs.push({ ...run, lines: [...run.lines] });
    });

  const texts = segments.map(() => '');
  const estimated = segments.map(() => false);
  const windows: { cues: number[]; text: string }[] = [];
  for (const run of runs) {
    const text = run.lines
      .sort((a, b) => a - b)
      .map((li) => lines[li].target.trim())
      .join(' ');
    if (run.from === run.to) {
      texts[run.from] = text;
      continue;
    }
    const indexes = Array.from({ length: run.to - run.from + 1 }, (_, i) => run.from + i);
    const split = splitOverCues(text, indexes.map((ci) => cues[ci].end - cues[ci].start));
    indexes.forEach((ci, i) => {
      texts[ci] = split[i];
      estimated[ci] = true;
    });
    windows.push({ cues: indexes, text });
  }
  return { match: 'timed', texts, estimated, windows, audioMismatch };
};
