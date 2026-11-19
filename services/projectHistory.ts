import type { AudioSegment, BatchJob } from '../types';
import { describeChange } from './reviewHistory.ts';
import type { SyncTake, SyncTakes } from './syncTakes.ts';

/**
 * The project's one undo history: every change to the script and to the dub
 * (Review, Edit timing, the T window, the voice changer, Sync) is a step,
 * from the first change to the last, kept with the project, so Done, closing
 * the window or the app loses nothing. Undo, Redo or a click in the History
 * list puts every one of those things back as it was at that step.
 *
 * A step holds what the project was, not the audio: lines, takes and edits
 * point at samples in the dub's bank. Between two Syncs the bank only grows
 * (takes and voice changes are added after its samples), so the bank of the
 * newest step holds the samples of every older one; all of them are one
 * "sync" (syncEpoch). A Sync makes a new bank: the one before it is kept
 * apart (services/storageService.ts, history banks), for the last
 * KEPT_SYNCS Syncs. A step of a Sync whose bank was let go keeps only its
 * script, which is how undo still goes back to the very first change.
 *
 * Each version of a cue, a bank line, a report line, a line's takes and a
 * line's edits is held once in a pool and steps point at it, so a project
 * keeps a thousand steps without a copy of the dub per step.
 */

/** What a step puts back. */
export const HISTORY_FIELDS = [
  'segments',
  'syncBank',
  'syncBaseReport',
  'syncEdits',
  'syncAudioTracks',
  'syncTakes',
  'syncChangedVoices',
  'syncLineSeeds',
  'syncLineTakes',
  'syncTakeChoices',
  'syncDeclinedTakes',
  'syncPendingLines',
  'syncPendingWords',
  'syncSpeakerLevels',
  'syncMarkers',
  'syncSeed',
  'syncEpoch',
] as const satisfies readonly (keyof BatchJob)[];

export type HistoryField = (typeof HISTORY_FIELDS)[number];
export type HistoryState = Pick<BatchJob, HistoryField>;

/** The small fields kept as one value per step. */
const OTHER_FIELDS = [
  'syncChangedVoices',
  'syncLineSeeds',
  'syncLineTakes',
  'syncTakeChoices',
  'syncDeclinedTakes',
  'syncPendingLines',
  'syncPendingWords',
  'syncSpeakerLevels',
  'syncMarkers',
  'syncAudioTracks',
] as const satisfies readonly HistoryField[];

/** Steps kept; the oldest go first, never the first step. */
export const HISTORY_STEP_LIMIT = 1000;
/** A pause longer than this starts a new step, for changes that say they are one (typing, a slider). */
export const HISTORY_MERGE_MS = 1500;
/** The Syncs before the one playing whose bank is kept, so undo can go back past them. */
export const KEPT_SYNCS = 3;
/** Where undo stops on a project that had no history yet. */
export const FIRST_STEP_LABEL = 'Before your first change';

type Ref = number;

interface PackedDub {
  /** The Sync the step's bank belongs to; null before any. */
  epoch: string | null;
  /**
   * The seed Sync voices with, so a Sync after undo finds the lines that Sync
   * voiced. Not a change of its own: Sync sets it as it starts.
   */
  seed: number | null;
  bank: { rest: Ref; lines: Ref[] } | null;
  base: { rest: Ref; units: Ref[] } | null;
  edits: Record<string, Ref> | null;
  takes: Record<string, Ref> | null;
  other: Ref;
}

export interface ProjectHistoryStep {
  label: string;
  time: number;
  /** Steps with the same key close together are one step. */
  key?: string;
  segments: Ref[];
  /** Null when only the script of this step is kept: its Sync's bank was let go. */
  dub: PackedDub | null;
}

export interface ProjectHistory {
  pool: unknown[];
  /** steps[0] is where undo stops. */
  steps: ProjectHistoryStep[];
  /** The step the project is at now. */
  at: number;
  /** The pool's size when it was last cleared of values no step uses. */
  compactedAt: number;
}

/* ---------- The pool ---------- */

const jsonOf = new WeakMap<object, string>();
const json = (value: unknown) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  let text = jsonOf.get(value);
  if (text === undefined) {
    text = JSON.stringify(value) ?? 'undefined';
    jsonOf.set(value, text);
  }
  return text;
};

/** A pool being added to: each value found by identity first, then by content. */
const writer = (pool: unknown[]) => {
  const next = [...pool];
  const byValue = new Map<unknown, Ref>();
  let byText: Map<string, Ref> | null = null;
  pool.forEach((value, i) => byValue.set(value, i));
  const ref = (value: unknown): Ref => {
    const known = byValue.get(value);
    if (known !== undefined) return known;
    if (!byText) {
      byText = new Map();
      next.forEach((v, i) => byText!.set(json(v), i));
    }
    const text = json(value);
    let i = byText.get(text);
    if (i === undefined) {
      i = next.length;
      next.push(value);
      byText.set(text, i);
    }
    byValue.set(value, i);
    return i;
  };
  return { pool: next, ref };
};

const packMap = (value: Record<string, unknown> | null | undefined, ref: (v: unknown) => Ref) =>
  value ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, ref(v)])) : null;

const otherOf = (state: HistoryState) => Object.fromEntries(OTHER_FIELDS.map((field) => [field, state[field] ?? null]));

const pack = (state: HistoryState, ref: (v: unknown) => Ref): Omit<ProjectHistoryStep, 'label' | 'time' | 'key'> => {
  const bank = state.syncBank;
  const base = state.syncBaseReport;
  // The bank's id is where the server holds its samples, not what the dub is: the app gives it back.
  const bankRest = bank ? (({ lines: _lines, bankId: _id, ...rest }) => rest)(bank) : null;
  const baseRest = base ? (({ units: _units, ...rest }) => rest)(base) : null;
  return {
    segments: (state.segments || []).map(ref),
    dub: {
      epoch: state.syncEpoch ?? null,
      seed: state.syncSeed ?? null,
      bank: bank ? { rest: ref(bankRest), lines: bank.lines.map(ref) } : null,
      base: base ? { rest: ref(baseRest), units: base.units.map(ref) } : null,
      edits: packMap(state.syncEdits, ref),
      takes: packMap(state.syncTakes, ref),
      other: ref(otherOf(state)),
    },
  };
};

const unpackMap = <T>(value: Record<string, Ref> | null, pool: unknown[]) =>
  value ? (Object.fromEntries(Object.entries(value).map(([key, i]) => [key, pool[i]])) as Record<string, T>) : null;

/** What step `index` puts back, the bank without its id; only the script when its Sync's bank was let go. */
export const stateAt = (history: ProjectHistory, index = history.at): { state: Partial<HistoryState>; scriptOnly: boolean } => {
  const step = history.steps[index];
  const { pool } = history;
  const segments = step.segments.map((i) => pool[i]) as AudioSegment[];
  if (!step.dub) return { state: { segments }, scriptOnly: true };
  const { dub } = step;
  const other = pool[dub.other] as Record<string, unknown>;
  const state: Partial<HistoryState> = {
    segments,
    syncEpoch: dub.epoch,
    syncSeed: dub.seed,
    syncBank: dub.bank ? ({ ...(pool[dub.bank.rest] as object), lines: dub.bank.lines.map((i) => pool[i]) } as HistoryState['syncBank']) : null,
    syncBaseReport: dub.base ? ({ ...(pool[dub.base.rest] as object), units: dub.base.units.map((i) => pool[i]) } as HistoryState['syncBaseReport']) : null,
    syncEdits: unpackMap(dub.edits, pool) as HistoryState['syncEdits'],
    syncTakes: unpackMap(dub.takes, pool) as HistoryState['syncTakes'],
  };
  for (const field of OTHER_FIELDS) (state as Record<string, unknown>)[field] = other[field] ?? null;
  return { state, scriptOnly: false };
};

const sameRefs = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The pool without values no step uses, once enough of them have piled up. */
const compact = (history: ProjectHistory): ProjectHistory => {
  if (history.pool.length <= history.compactedAt * 2 + 256) return history;
  const used = new Map<Ref, Ref>();
  const pool: unknown[] = [];
  const move = (i: Ref) => {
    let j = used.get(i);
    if (j === undefined) {
      j = pool.length;
      used.set(i, j);
      pool.push(history.pool[i]);
    }
    return j;
  };
  const moveMap = (value: Record<string, Ref> | null) => (value ? Object.fromEntries(Object.entries(value).map(([k, i]) => [k, move(i)])) : null);
  const steps = history.steps.map((step) => ({
    ...step,
    segments: step.segments.map(move),
    dub: step.dub && {
      epoch: step.dub.epoch,
      seed: step.dub.seed,
      bank: step.dub.bank && { rest: move(step.dub.bank.rest), lines: step.dub.bank.lines.map(move) },
      base: step.dub.base && { rest: move(step.dub.base.rest), units: step.dub.base.units.map(move) },
      edits: moveMap(step.dub.edits),
      takes: moveMap(step.dub.takes),
      other: move(step.dub.other),
    },
  }));
  return { ...history, pool, steps, compactedAt: pool.length };
};

/* ---------- Steps ---------- */

/** A history whose one step is `state`, where undo stops. */
export const startProjectHistory = (state: HistoryState, label = FIRST_STEP_LABEL, now = Date.now()): ProjectHistory => {
  const { pool, ref } = writer([]);
  const step = { ...pack(state, ref), label, time: now };
  return { pool, steps: [step], at: 0, compactedAt: pool.length };
};

/**
 * The history of a project that kept only the script's (Review's): its steps
 * as script steps, the one it was at with the dub as it is now.
 */
export const fromReviewHistory = (
  review: { pool: AudioSegment[]; steps: { cues: number[]; label: string; time: number; key?: string }[]; at: number },
  state: HistoryState
): ProjectHistory => {
  const { pool, ref } = writer([]);
  const steps: ProjectHistoryStep[] = review.steps.map((step, n) => {
    const segments = step.cues.map((i) => review.pool[i]);
    return n === review.at
      ? { ...pack({ ...state, segments }, ref), label: step.label, time: step.time, ...(step.key ? { key: step.key } : {}) }
      : { segments: segments.map(ref), dub: null, label: step.label, time: step.time, ...(step.key ? { key: step.key } : {}) };
  });
  return { pool, steps, at: Math.min(review.at, steps.length - 1), compactedAt: pool.length };
};

/** Whether the project is still as step `history.at` left it. */
const isAt = (history: ProjectHistory, state: HistoryState) => {
  const { pool, ref } = writer(history.pool);
  const packed = pack(state, ref);
  const step = history.steps[history.at];
  const same =
    pool.length === history.pool.length &&
    sameRefs(packed.segments, step.segments) &&
    (!step.dub || sameRefs({ ...packed.dub, seed: null }, { ...step.dub, seed: null }));
  return same;
};

/** The history with the project as it is now as a step of its own ("Other changes") when no step has it yet. */
export const catchUpProject = (history: ProjectHistory, state: HistoryState, now = Date.now()): ProjectHistory =>
  isAt(history, state) ? history : push(history, state, { label: 'Other changes', now });

/**
 * A new step with `after`, after the one the project is at; steps undone
 * before it are dropped. A change made where the history didn't see it (the
 * project differs from the step it is at) first becomes a step of its own,
 * "Other changes", so undo never loses it. With `key`, a step right after one
 * with the same key, while nothing is undone, joins it.
 */
export const recordProjectStep = (
  history: ProjectHistory | null | undefined,
  before: HistoryState,
  after: HistoryState,
  { label, key, now = Date.now() }: { label: string; key?: string; now?: number }
): ProjectHistory => {
  let h = history ?? startProjectHistory(before, FIRST_STEP_LABEL, now);
  if (history && !isAt(history, before)) h = push(h, before, { label: 'Other changes', now });
  return push(h, after, { label, key, now });
};

const push = (history: ProjectHistory, state: HistoryState, { label, key, now }: { label: string; key?: string; now: number }): ProjectHistory => {
  const { pool, ref } = writer(history.pool);
  const packed = pack(state, ref);
  const steps = history.steps.slice(0, history.at + 1);
  const last = steps[steps.length - 1];
  const nothingUndone = history.at === history.steps.length - 1;
  if (key && nothingUndone && steps.length > 1 && last.key === key && now - last.time < HISTORY_MERGE_MS) {
    steps[steps.length - 1] = { ...last, ...packed, time: now };
  } else {
    steps.push({ ...packed, label, time: now, ...(key ? { key } : {}) });
  }
  if (steps.length > HISTORY_STEP_LIMIT) steps.splice(1, steps.length - HISTORY_STEP_LIMIT);
  return compact({ pool, steps, at: steps.length - 1, compactedAt: history.compactedAt });
};

/** The history at step `index`, or null when there is no such step or it is there already. */
export const moveTo = (history: ProjectHistory, index: number): ProjectHistory | null =>
  index < 0 || index >= history.steps.length || index === history.at ? null : { ...history, at: index };

/** What Undo and Redo would do, by the steps' names; null where there is nothing to do. */
export const historyLabels = (history: ProjectHistory | null | undefined) => ({
  undo: history && history.at > 0 ? history.steps[history.at].label : null,
  redo: history && history.at < history.steps.length - 1 ? history.steps[history.at + 1].label : null,
});

/** The steps as the History list shows them. */
export const historyEntries = (history: ProjectHistory | null | undefined) =>
  (history?.steps || []).map((step) => ({ label: step.label, time: step.time, scriptOnly: !step.dub }));

/* ---------- On disk ---------- */

/** Refs a stored list is cut into: a piece the step before has the same is that step's piece. */
const PIECE = 64;
type Pieces = Int32Array[];

const piecesOf = (refs: Ref[], before: Pieces | undefined): Pieces => {
  const out: Pieces = [];
  for (let at = 0, k = 0; at < refs.length; at += PIECE, k++) {
    const end = Math.min(refs.length, at + PIECE);
    const prev = before?.[k];
    let same = prev !== undefined && prev.length === end - at;
    for (let i = at; same && i < end; i++) if (prev![i - at] !== refs[i]) same = false;
    out.push(same ? prev! : Int32Array.from(refs.slice(at, end)));
  }
  return out;
};

/** A step's takes or edits (key to ref): the step before's own object when they are the same. */
const mapLike = (refs: Record<string, Ref> | null, before: Record<string, Ref> | null | undefined) => {
  if (!refs || !before || refs === before) return refs;
  const keys = Object.keys(refs);
  if (keys.length !== Object.keys(before).length) return refs;
  for (const key of keys) if (before[key] !== refs[key]) return refs;
  return before;
};

const refsOf = (pieces: Pieces): Ref[] => {
  const out: Ref[] = [];
  for (const piece of pieces) for (let i = 0; i < piece.length; i++) out.push(piece[i]);
  return out;
};

/**
 * A history as it is written to disk. Each step's lists of refs (a cue, bank
 * line and report line each) are cut into pieces, and a piece that is the
 * same as the step before's is that very piece, as are its takes and edits
 * when they are the same: IndexedDB writes an object held twice once. A thousand steps of a 1500-line synced project hold four
 * and a half million refs, nearly all repeats of the step before, and wrote
 * them all with every save; now about one piece a step is new.
 */
export interface StoredProjectHistory {
  stored: 1;
  pool: unknown[];
  steps: (Omit<ProjectHistoryStep, 'segments' | 'dub'> & {
    segments: Pieces;
    dub: (Omit<PackedDub, 'bank' | 'base'> & { bank: { rest: Ref; lines: Pieces } | null; base: { rest: Ref; units: Pieces } | null }) | null;
  })[];
  at: number;
  compactedAt: number;
}

type StoredStep = StoredProjectHistory['steps'][number];

/** Steps already in their stored form: a step never changes, so each is cut once. */
const storedSteps = new WeakMap<ProjectHistoryStep, StoredStep>();

export const toStoredHistory = (history: ProjectHistory): StoredProjectHistory => {
  let before: StoredStep | undefined;
  const steps = history.steps.map((step) => {
    let out = storedSteps.get(step);
    if (!out) {
      const prev = before;
      out = {
        ...step,
        segments: piecesOf(step.segments, prev?.segments),
        dub: step.dub && {
          ...step.dub,
          bank: step.dub.bank && { rest: step.dub.bank.rest, lines: piecesOf(step.dub.bank.lines, prev?.dub?.bank?.lines) },
          base: step.dub.base && { rest: step.dub.base.rest, units: piecesOf(step.dub.base.units, prev?.dub?.base?.units) },
          edits: mapLike(step.dub.edits, prev?.dub?.edits),
          takes: mapLike(step.dub.takes, prev?.dub?.takes),
        },
      };
      storedSteps.set(step, out);
    }
    before = out;
    return out;
  });
  return { stored: 1, pool: history.pool, steps, at: history.at, compactedAt: history.compactedAt };
};

export const isStoredHistory = (value: unknown): value is StoredProjectHistory =>
  Boolean(value) && typeof value === 'object' && (value as StoredProjectHistory).stored === 1 && Array.isArray((value as StoredProjectHistory).steps);

export const fromStoredHistory = (stored: StoredProjectHistory): ProjectHistory => ({
  pool: stored.pool,
  steps: stored.steps.map((step) => ({
    ...step,
    segments: refsOf(step.segments),
    dub: step.dub && {
      ...step.dub,
      bank: step.dub.bank && { rest: step.dub.bank.rest, lines: refsOf(step.dub.bank.lines) },
      base: step.dub.base && { rest: step.dub.base.rest, units: refsOf(step.dub.base.units) },
    },
  })),
  at: stored.at,
  compactedAt: stored.compactedAt,
});

/**
 * The project's cues, bank lines, report lines, takes and edits as the very
 * objects the step it is at holds, where they are the same: read from a
 * .dhvani file (JSON) they are copies, and a copy is written to disk a second
 * time with every save and found in the history by its text, not by itself.
 * Only the fields that change are returned.
 */
export const shareWithHistory = (state: Partial<HistoryState>, history: ProjectHistory): Partial<HistoryState> => {
  const step = history.steps[history.at];
  if (!step) return {};
  const { pool } = history;
  const same = (value: unknown, ref: Ref | undefined) => {
    const kept = ref === undefined ? undefined : pool[ref];
    return kept !== undefined && kept !== value && json(kept) === json(value) ? kept : value;
  };
  const list = <T>(values: T[] | null | undefined, refs: Ref[] | undefined) => {
    if (!values || !refs || values.length !== refs.length) return null;
    let changed = false;
    const out = values.map((value, i) => {
      const next = same(value, refs[i]) as T;
      if (next !== value) changed = true;
      return next;
    });
    return changed ? out : null;
  };
  const map = <T>(values: Record<string, T> | null | undefined, refs: Record<string, Ref> | null | undefined) => {
    if (!values || !refs) return null;
    let changed = false;
    const out = Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const next = same(value, refs[key]) as T;
        if (next !== value) changed = true;
        return [key, next];
      })
    );
    return changed ? out : null;
  };
  const out: Partial<HistoryState> = {};
  const segments = list(state.segments, step.segments);
  if (segments) out.segments = segments;
  const dub = step.dub;
  if (!dub || (state.syncEpoch ?? null) !== dub.epoch) return out;
  const lines = list(state.syncBank?.lines, dub.bank?.lines);
  if (lines && state.syncBank) out.syncBank = { ...state.syncBank, lines };
  const units = list(state.syncBaseReport?.units, dub.base?.units);
  if (units && state.syncBaseReport) out.syncBaseReport = { ...state.syncBaseReport, units } as HistoryState['syncBaseReport'];
  const takes = map(state.syncTakes, dub.takes);
  if (takes) out.syncTakes = takes as HistoryState['syncTakes'];
  const edits = map(state.syncEdits, dub.edits);
  if (edits) out.syncEdits = edits as HistoryState['syncEdits'];
  return out;
};

/* ---------- Syncs ---------- */

/** The Syncs the steps' banks belong to, newest last (by the last step of each). */
export const epochsIn = (history: ProjectHistory): string[] => {
  const last = new Map<string, number>();
  history.steps.forEach((step, n) => {
    if (step.dub?.epoch) last.set(step.dub.epoch, n);
  });
  return [...last.entries()].sort((a, b) => a[1] - b[1]).map(([epoch]) => epoch);
};

/**
 * Lets go of the Syncs before the KEPT_SYNCS newest besides `current`: their
 * steps keep only their script. Returns the history and the Syncs let go,
 * whose banks can be deleted.
 */
export const keepRecentSyncs = (history: ProjectHistory, current: string | null | undefined, keep = KEPT_SYNCS) => {
  const others = epochsIn(history).filter((epoch) => epoch !== current);
  const dropped = others.slice(0, Math.max(0, others.length - keep));
  if (dropped.length === 0) return { history, dropped };
  const gone = new Set(dropped);
  const steps = history.steps.map((step) => (step.dub?.epoch && gone.has(step.dub.epoch) ? { ...step, dub: null } : step));
  return { history: compact({ ...history, steps }), dropped };
};

/* ---------- What a step did, in words ---------- */

const activeOf = (line: { takes: SyncTake[]; active: string } | undefined) => line?.takes.find((take) => take.id === line.active);

const takeName = (line: { takes: SyncTake[]; active: string }) => {
  if (line.active === 'sync') return 'Sync take';
  const n = line.takes.filter((take) => take.id !== 'sync').findIndex((take) => take.id === line.active);
  return n < 0 ? 'a take' : `Take ${n + 1}`;
};

const changedKeys = (a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) =>
  [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((key) => a?.[key] !== b?.[key] && json(a?.[key]) !== json(b?.[key]));

/**
 * What a change did, in a few words, and the key that joins it with the next
 * one like it; null when it changed nothing a step puts back.
 */
export const describeProjectChange = (before: HistoryState, after: HistoryState): { label: string; key?: string } | null => {
  const changed = HISTORY_FIELDS.filter((field) => field !== 'syncSeed' && before[field] !== after[field] && json(before[field]) !== json(after[field]));
  if (changed.length === 0) return null;
  const segments = after.segments || [];
  const lineOf = (key: string) => {
    const i = segments.findIndex((seg) => String(seg.id) === key);
    return i < 0 ? `line ${key}` : `line ${i + 1}`;
  };
  const Line = (key: string) => lineOf(key).replace(/^l/, 'L');
  const lines = (keys: string[]) => (keys.length === 1 ? lineOf(keys[0]) : `${keys.length} lines`);

  if (changed.includes('syncEpoch') && after.syncBank && before.syncBank) return { label: 'Sync again' };
  if (changed.includes('syncEpoch') && after.syncBank) return { label: 'Sync' };
  if (changed.includes('syncEpoch') && !after.syncBank && before.syncBank) return { label: 'Voice changer: the whole dub' };

  if (changed.includes('syncTakes')) {
    const keys = changedKeys(before.syncTakes as SyncTakes, after.syncTakes as SyncTakes);
    const voiced = keys.filter((key) => {
      const was = activeOf(before.syncTakes?.[key]);
      const now = activeOf(after.syncTakes?.[key]);
      return Boolean(now?.voiceId && now.voiceId !== was?.voiceId);
    });
    if (voiced.length > 0 && voiced.length === keys.length) return { label: `Voice change on ${lines(voiced)}` };
    const picked = keys.filter((key) => (before.syncTakes?.[key]?.active ?? 'sync') !== (after.syncTakes?.[key]?.active ?? 'sync'));
    if (picked.length === 1) return { label: `${Line(picked[0])}: ${takeName(after.syncTakes![picked[0]])} in the dub` };
    if (picked.length > 1) return { label: `Takes in the dub on ${picked.length} lines` };
    const grew = keys.filter((key) => (after.syncTakes?.[key]?.takes.length ?? 0) > (before.syncTakes?.[key]?.takes.length ?? 0));
    if (grew.length > 0) return { label: `New take of ${lines(grew)}` };
    return { label: `Takes of ${lines(keys)}` };
  }
  if (changed.includes('segments')) {
    const a = before.segments || [];
    const moved = a.length === segments.length ? segments.map((_, i) => i).filter((i) => json(a[i]?.dubPlace) !== json(segments[i]?.dubPlace)) : [];
    if (moved.length > 0 && moved.every((i) => json({ ...a[i], dubPlace: null }) === json({ ...segments[i], dubPlace: null }))) {
      return moved.length === 1
        ? { label: `Move line ${moved[0] + 1} on the dub lane`, key: `place:${segments[moved[0]].id}` }
        : { label: `Move ${moved.length} lines on the dub lane` };
    }
    const change = describeChange(a, segments);
    if (change) return change;
  }
  if (changed.includes('syncLineSeeds')) {
    const keys = changedKeys(before.syncLineSeeds, after.syncLineSeeds).filter((key) => after.syncLineSeeds?.[key] !== undefined);
    if (keys.length > 0) return { label: `Retake ${lines(keys)} at the next Sync` };
  }
  if (changed.includes('syncTakeChoices')) return { label: `Take chosen for ${lines(changedKeys(before.syncTakeChoices, after.syncTakeChoices))}` };
  if (changed.includes('syncEdits')) return { label: 'Edit timing' };
  if (changed.includes('syncSpeakerLevels')) return { label: 'Speaker level', key: 'levels' };
  if (changed.includes('syncMarkers')) return { label: 'Markers', key: 'markers' };
  if (changed.includes('syncAudioTracks')) return { label: 'Tracks' };
  if (changed.includes('syncChangedVoices')) return { label: 'Voice changer' };
  return { label: 'Change' };
};
