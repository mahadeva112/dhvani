import type { AudioSegment } from '../types';

/**
 * The Review step's undo history: every change to the cues, back to where the
 * script came from (the AI translation, or a pasted script). Each step is the
 * whole cue list, held as indexes into a pool where each version of a cue is
 * kept once, so a saved project keeps hundreds of steps without a copy of the
 * script per step. Typing in one line, or dragging one cut, is one step until
 * it rests for a moment.
 */

export interface ReviewStep {
  /** The cue list after this step, as indexes into the pool. */
  cues: number[];
  /** What the step did, e.g. "Edit line 12"; for the first step, where undo stops. */
  label: string;
  time: number;
  /** Steps with the same key close together are one step. */
  key?: string;
}

export interface ReviewHistory {
  pool: AudioSegment[];
  /** steps[0] is where undo stops. */
  steps: ReviewStep[];
  /** The step the cues are at now. */
  at: number;
  /** The pool's size after it was last cleared of versions no step uses. */
  compactedAt: number;
}

/** A pause in typing longer than this starts a new step. */
export const MERGE_MS = 1500;
/** Steps kept; the oldest edits go first, never the first step. */
export const STEP_LIMIT = 300;

/** Where undo stops, as the button says it: "Back to the AI translation". */
export const BASE_LABELS = {
  translation: 'the AI translation',
  transcript: 'the original text',
  script: 'your pasted script',
  firstEdit: 'before your first edit',
} as const;

const textOf = (seg: AudioSegment) => seg.textTarget || seg.targetText || '';

const sameCue = (a: AudioSegment, b: AudioSegment) => a === b || JSON.stringify(a) === JSON.stringify(b);

const sameList = (a: AudioSegment[], b: AudioSegment[]) => a.length === b.length && a.every((seg, i) => sameCue(seg, b[i]));

const cuesAt = (history: ReviewHistory, step = history.at) => history.steps[step].cues.map((i) => history.pool[i]);

export const startReviewHistory = (segments: AudioSegment[], label: string, now = Date.now()): ReviewHistory => ({
  pool: [...segments],
  steps: [{ cues: segments.map((_, i) => i), label, time: now }],
  at: 0,
  compactedAt: segments.length,
});

/** What a change did, in words, and the key that joins it with the next one like it. */
export const describeChange = (before: AudioSegment[], after: AudioSegment[]): { label: string; key?: string } | null => {
  const sameIds = before.length === after.length && before.every((seg, i) => String(seg.id) === String(after[i].id));
  if (sameIds) {
    const changed = after.map((_, i) => i).filter((i) => !sameCue(before[i], after[i]));
    if (changed.length === 0) return null;
    if (changed.length === 1) {
      const i = changed[0];
      const id = String(after[i].id);
      if (textOf(before[i]) !== textOf(after[i])) return { label: `Edit line ${i + 1}`, key: `text:${id}` };
      if ((before[i].speaker || '') !== (after[i].speaker || '')) return { label: `Speaker of line ${i + 1}` };
      return { label: `Change line ${i + 1}`, key: `cue:${id}` };
    }
    if (changed.length === 2 && changed[1] === changed[0] + 1) {
      const i = changed[0];
      const timesMoved = before[i].endTime !== after[i].endTime || before[i + 1].startTime !== after[i + 1].startTime;
      if (timesMoved) return { label: `Move cut ${i + 1} | ${i + 2}`, key: `cut:${after[i].id}` };
    }
    return { label: `Edit ${changed.length} lines` };
  }
  // A split or join keeps the first cue's id, so the ids part just after the line it was.
  const idAt = (list: AudioSegment[], i: number) => (list[i] ? String(list[i].id) : null);
  let d = 0;
  while (d < Math.max(before.length, after.length) && idAt(before, d) === idAt(after, d)) d++;
  const n = Math.max(1, d);
  if (after.length === before.length + 1) return { label: `Split line ${n}` };
  if (after.length === before.length - 1) return { label: `Join lines ${n} and ${n + 1}` };
  return { label: 'Change the cues' };
};

/** The pool without versions no step uses, once enough of them have piled up. */
const compact = (history: ReviewHistory): ReviewHistory => {
  if (history.pool.length <= history.compactedAt * 2 + 64) return history;
  const used = new Map<number, number>();
  const pool: AudioSegment[] = [];
  const steps = history.steps.map((step) => ({
    ...step,
    cues: step.cues.map((i) => {
      let j = used.get(i);
      if (j === undefined) {
        j = pool.length;
        used.set(i, j);
        pool.push(history.pool[i]);
      }
      return j;
    }),
  }));
  return { ...history, pool, steps, compactedAt: pool.length };
};

/**
 * A new step with `segments`, after the one the cues are at; any steps undone
 * before it are dropped. Returns the cues as the history holds them, which the
 * project keeps so the next step finds them by identity.
 */
const push = (
  history: ReviewHistory,
  segments: AudioSegment[],
  { label, key, now, merge }: { label: string; key?: string; now: number; merge: boolean }
): { history: ReviewHistory; segments: AudioSegment[] } => {
  const indexOf = new Map(history.pool.map((seg, i) => [seg, i] as const));
  // A cue read back from a file is a copy: matched by content to the version the steps hold.
  const current = history.steps[history.at].cues;
  const byId = new Map(current.map((i) => [String(history.pool[i].id), i] as const));
  const pool = [...history.pool];
  const cues = segments.map((seg) => {
    let i = indexOf.get(seg);
    if (i === undefined) {
      const same = byId.get(String(seg.id));
      if (same !== undefined && sameCue(pool[same], seg)) i = same;
    }
    if (i === undefined) {
      i = pool.length;
      pool.push(seg);
      indexOf.set(seg, i);
    }
    return i;
  });
  const steps = history.steps.slice(0, history.at + 1);
  const last = steps[steps.length - 1];
  const nothingUndone = history.at === history.steps.length - 1;
  if (merge && key && nothingUndone && steps.length > 1 && last.key === key && now - last.time < MERGE_MS) {
    steps[steps.length - 1] = { ...last, cues, time: now };
  } else {
    steps.push({ cues, label, time: now, ...(key ? { key } : {}) });
  }
  if (steps.length > STEP_LIMIT) steps.splice(1, steps.length - STEP_LIMIT);
  const next = compact({ pool, steps, at: steps.length - 1, compactedAt: history.compactedAt });
  return { history: next, segments: cuesAt(next) };
};

/** A change made where the history didn't see it becomes a step of its own, so undo never loses it. */
const catchUp = (history: ReviewHistory, live: AudioSegment[], now: number) =>
  sameList(cuesAt(history), live) ? history : push(history, live, { label: 'Other changes', now, merge: false }).history;

/**
 * Records a change to the cues. With no history yet, it starts at the cues
 * before the change. `label` names the step when the change itself can't say,
 * e.g. "Translate missing lines".
 */
export const recordReviewStep = (
  history: ReviewHistory | null | undefined,
  before: AudioSegment[],
  after: AudioSegment[],
  { now = Date.now(), label }: { now?: number; label?: string } = {}
): { history: ReviewHistory; segments: AudioSegment[] } => {
  const base = history ? catchUp(history, before, now) : startReviewHistory(before, BASE_LABELS.firstEdit, now);
  const change = describeChange(before, after);
  if (!change) return { history: base, segments: after };
  return push(base, after, { label: label ?? change.label, key: label ? undefined : change.key, now, merge: true });
};

/** One step back, or null when the cues are where undo stops. */
export const undoReviewStep = (history: ReviewHistory, live: AudioSegment[], now = Date.now()) => {
  const h = catchUp(history, live, now);
  if (h.at === 0) return null;
  const next = { ...h, at: h.at - 1 };
  return { history: next, segments: cuesAt(next) };
};

/** The step undone last, again; null when there is none, or the cues changed since. */
export const redoReviewStep = (history: ReviewHistory, live: AudioSegment[]) => {
  if (history.at >= history.steps.length - 1 || !sameList(cuesAt(history), live)) return null;
  const next = { ...history, at: history.at + 1 };
  return { history: next, segments: cuesAt(next) };
};

/** The cues as they were at the first step, as a new step that can be undone. */
export const backToFirstStep = (history: ReviewHistory, live: AudioSegment[], now = Date.now()) => {
  const h = catchUp(history, live, now);
  if (sameList(cuesAt(h), cuesAt(h, 0))) return null;
  return push(h, cuesAt(h, 0), { label: `Back to ${h.steps[0].label}`, now, merge: false });
};

/** What the Undo, Redo and Back buttons would do; null where there is nothing to do. */
export const reviewHistoryLabels = (history: ReviewHistory | null | undefined) => ({
  undo: history && history.at > 0 ? history.steps[history.at].label : null,
  redo: history && history.at < history.steps.length - 1 ? history.steps[history.at + 1].label : null,
  base: history && history.at > 0 ? history.steps[0].label : null,
});
