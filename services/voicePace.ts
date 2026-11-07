import { DEFAULT_PAUSES, pauseKindAfter, syllablesIn, type LinePauses } from './speechTiming.ts';
import { letterCount } from './linePlaces.ts';
import type { SyncReport, SyncUnitReport } from './syncService.ts';

/*
 * A voice's pace, learned from what it really did: every Sync times each
 * voiced line word by word (it needs those times to cut the line), and the
 * report keeps them (SyncUnitReport.readWords). From them: how many syllables
 * a second the voice says while it speaks, and how long it pauses after a
 * comma, after a full stop inside a line, and between two words said in one
 * breath. Nothing is voiced or sent for this: it costs nothing.
 *
 * Kept per voice, model and language, across projects: each project counts
 * with its last Sync (a new Sync of it replaces what it taught), so a voice
 * gets known better with every project it dubs. The Expert estimate reads
 * lines at the learned pace instead of the one sample read and fixed pauses.
 */

/** What one project's last Sync taught about one voice. */
export interface PaceSample {
  syllables: number;
  /** Seconds its words took, pauses left out. */
  seconds: number;
  lines: number;
  words: number;
  /** Pauses after a word, by the mark it ends with, in seconds. */
  comma: number[];
  stop: number[];
  gap: number[];
  /** ISO time it was learned. */
  at: string;
}

/** A voice's pace as learned so far. */
export interface LearnedPace {
  syllablesPerSecond: number;
  pauses: LinePauses;
  /** Lines and projects it was learned from. */
  lines: number;
  projects: number;
}

/** Fewer voiced lines or words than this don't tell a voice's pace. */
export const MIN_PACE_LINES = 8;
const MIN_PACE_WORDS = 40;
/** A pause needs this many samples before it replaces the default. */
const MIN_PAUSE_SAMPLES = 3;
/** A gap longer than this is a breath or a stumble, not the voice's pause. */
const MAX_PAUSE = 1.5;
/** Pauses kept per project and kind, so storage stays small. */
const MAX_PAUSE_SAMPLES = 400;
const MIN_RATE = 2.5;
const MAX_RATE = 9;

/** One key per voice, model and language. */
export const voicePaceKey = (voiceId: string, modelId: string | undefined, language: string) => JSON.stringify([voiceId, modelId || '', language]);

/** The syllables a word says: a hyphenated word (धीरे-धीरे) as its parts. */
const syllablesOfWord = (word: string) =>
  word
    .split('-')
    .filter(Boolean)
    .reduce((sum, part) => sum + syllablesIn(part), 0);

/**
 * Whether a line's read is the voice's own: not read faster to fit, stretched,
 * swapped for a faster take, cut off, or left silent.
 */
const ownRead = (unit: SyncUnitReport) =>
  Boolean(unit.voiceId && unit.readWords?.length) &&
  !unit.silent &&
  !unit.cutOff &&
  !unit.speedFit &&
  !(unit.stretched && unit.stretched !== 1) &&
  !(unit.takeFit?.used && unit.takeFit.kind === 'faster');

/**
 * What a Sync report teaches about each voice in it, by voice id. A line's
 * pauses are told apart by the script's mark where they fall; a gap that
 * falls inside a script word (the voice split it) teaches nothing.
 */
export const paceSamplesOf = (report: Pick<SyncReport, 'units'> | null | undefined, at = new Date().toISOString()): Map<string, PaceSample> => {
  const out = new Map<string, PaceSample>();
  for (const unit of report?.units || []) {
    if (!ownRead(unit)) continue;
    const tokens = unit.text.trim().split(/\s+/).filter((t) => letterCount(t) > 0);
    let sum = 0;
    const tokenEnds = new Map(tokens.map((t, k) => [(sum += letterCount(t)), k] as const));
    const words = (unit.readWords || [])
      .map(([text, start, end]) => ({ text, start, end, letters: letterCount(text) }))
      .filter((w) => w.letters > 0 && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start);
    // Its words must be the script's, letter for letter, or the line taught something else.
    if (!words.length || words.reduce((n, w) => n + w.letters, 0) !== sum) continue;
    const sample = out.get(unit.voiceId!) || { syllables: 0, seconds: 0, lines: 0, words: 0, comma: [], stop: [], gap: [], at };
    let through = 0;
    words.forEach((w, k) => {
      sample.syllables += syllablesOfWord(w.text);
      sample.seconds += w.end - w.start;
      sample.words++;
      through += w.letters;
      const next = words[k + 1];
      const token = tokenEnds.get(through);
      if (!next || token === undefined) return;
      const pause = next.start - w.end;
      if (pause < 0 || pause > MAX_PAUSE) return;
      const list = sample[pauseKindAfter(tokens[token])];
      if (list.length < MAX_PAUSE_SAMPLES) list.push(Math.round(pause * 1000) / 1000);
    });
    sample.lines++;
    out.set(unit.voiceId!, sample);
  }
  return out;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A voice's pace from what its projects taught; null until it has said enough. */
export const paceFrom = (samples: PaceSample[]): LearnedPace | null => {
  const total = samples.reduce(
    (t, s) => ({ syllables: t.syllables + s.syllables, seconds: t.seconds + s.seconds, lines: t.lines + s.lines, words: t.words + s.words }),
    { syllables: 0, seconds: 0, lines: 0, words: 0 }
  );
  if (total.lines < MIN_PACE_LINES || total.words < MIN_PACE_WORDS || !(total.seconds > 0)) return null;
  const pauseOf = (kind: keyof LinePauses) => {
    const all = samples.flatMap((s) => s[kind]);
    return all.length >= MIN_PAUSE_SAMPLES ? Math.round(median(all) * 1000) / 1000 : DEFAULT_PAUSES[kind];
  };
  return {
    syllablesPerSecond: Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, total.syllables / total.seconds)) * 100) / 100,
    pauses: { comma: pauseOf('comma'), stop: pauseOf('stop'), gap: pauseOf('gap') },
    lines: total.lines,
    projects: samples.length,
  };
};

// ---- Kept across projects ----

const STORAGE_KEY = 'dhvani_voice_paces';
/** Projects kept per voice, and voices kept; the oldest go first. */
const MAX_PROJECTS = 40;
const MAX_VOICES = 100;
type Store = Record<string, Record<string, PaceSample>>;

const readStore = (): Store => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Learns from a project's Sync report: what it teaches about each voice
 * replaces what the project's earlier Sync taught. `keyOf` names the voice
 * (voicePaceKey), null to leave one out. True when anything was learned.
 */
export const learnPaceFromSync = (jobId: string, report: Pick<SyncReport, 'units'> | null | undefined, keyOf: (voiceId: string) => string | null): boolean => {
  const samples = paceSamplesOf(report);
  if (!samples.size) return false;
  try {
    const store = readStore();
    let changed = false;
    for (const [voiceId, sample] of samples) {
      const key = keyOf(voiceId);
      if (!key) continue;
      const projects = { ...(store[key] || {}) };
      const was = projects[jobId];
      if (was && was.lines === sample.lines && was.words === sample.words && Math.abs(was.seconds - sample.seconds) < 1e-6) continue;
      delete projects[jobId];
      projects[jobId] = sample;
      const ids = Object.keys(projects);
      for (const old of ids.slice(0, Math.max(0, ids.length - MAX_PROJECTS))) delete projects[old];
      delete store[key];
      store[key] = projects;
      changed = true;
    }
    if (!changed) return false;
    const keys = Object.keys(store);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_VOICES))) delete store[old];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    /* Storage off: nothing is learned this time. */
    return false;
  }
};

/** A voice's learned pace (voicePaceKey), or null until it has said enough. */
export const learnedPace = (key: string | null): LearnedPace | null => {
  if (!key) return null;
  const projects = readStore()[key];
  return projects ? paceFrom(Object.values(projects)) : null;
};
