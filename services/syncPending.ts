import type { AudioSegment } from '../types';
import { endsSentence } from '../server/lib/ttsText.js';

/** Just what this needs of a sync report: each line's key and its cues. */
interface ReportLines {
  units: { key: string; cueIds: (string | number)[] }[];
}

/**
 * How a synced line changed since Sync: `words` when only the words of its
 * cues changed (same cues, same times, same original, each cue still ending
 * a sentence or not, as Sync joins cues into lines by that), so the line
 * still sits where Sync put it and a take in its new words can go there;
 * `structure` for anything else (a cut, a join, a retime, a new original).
 */
export type LineChange = 'words' | 'structure';

const dubText = (segment: AudioSegment) => (segment.textTarget || segment.targetText || '').trim();
const sourceText = (segment: AudioSegment) => (segment.textSource || segment.originalText || '').trim();

const sameCue = (a: AudioSegment, b: AudioSegment) =>
  a.startTime === b.startTime && a.endTime === b.endTime && dubText(a) === dubText(b) && sourceText(a) === sourceText(b);

/** Only the words differ: Sync would make the same line of it, in the same place. */
const wordsOnly = (a: AudioSegment, b: AudioSegment) =>
  a.startTime === b.startTime &&
  a.endTime === b.endTime &&
  sourceText(a) === sourceText(b) &&
  Boolean(dubText(a)) === Boolean(dubText(b)) &&
  endsSentence(dubText(a)) === endsSentence(dubText(b));

/**
 * The synced lines an edit of the script touched, by line key, and how: a
 * cue cut, joined, retimed or reworded marks its line; a cue the last Sync
 * never saw (the second half of a cut) marks the line before it, or is named
 * by its own id when it comes first. Empty with no report.
 */
export const changedSyncLineKinds = (before: AudioSegment[], after: AudioSegment[], report: ReportLines | null | undefined): Map<string, LineChange> => {
  const kinds = new Map<string, LineChange>();
  if (!report) return kinds;
  const lineOf = new Map<string, string>();
  for (const unit of report.units) for (const id of unit.cueIds) lineOf.set(String(id), unit.key);
  const old = new Map(before.map((segment) => [String(segment.id), segment]));
  const now = new Map(after.map((segment) => [String(segment.id), segment]));
  const mark = (key: string, kind: LineChange) => {
    if (kinds.get(key) !== 'structure') kinds.set(key, kind);
  };
  // A new cue (the second half of a cut) belongs to the line before it, so one cut counts as one line.
  let lastKey: string | undefined;
  for (const [id, segment] of now) {
    const was = old.get(id);
    const key = lineOf.get(id) ?? lastKey ?? id;
    if (!was || !lineOf.has(id)) {
      if (!was || !sameCue(was, segment)) mark(key, 'structure');
    } else if (!sameCue(was, segment)) mark(key, wordsOnly(was, segment) ? 'words' : 'structure');
    lastKey = key;
  }
  for (const id of old.keys()) if (!now.has(id) && lineOf.has(id)) mark(lineOf.get(id)!, 'structure');
  return kinds;
};

/** The synced lines an edit of the script touched, by line key (see changedSyncLineKinds). */
export const changedSyncLines = (before: AudioSegment[], after: AudioSegment[], report: ReportLines | null | undefined): string[] => [
  ...changedSyncLineKinds(before, after, report).keys(),
];

/** `pending` with `keys` added, or `pending` itself when nothing is new. */
export const withPendingLines = (pending: string[] | null | undefined, keys: string[]): string[] => {
  const list = pending || [];
  const added = keys.filter((key) => !list.includes(key));
  return added.length ? [...list, ...added] : list;
};

interface PendingJob {
  segments: AudioSegment[];
  syncReport?: ReportLines | null;
  syncPendingLines?: string[] | null;
  syncPendingWords?: string[] | null;
}

type PendingFields = { syncPendingLines?: string[]; syncPendingWords?: string[] };

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((key, n) => key === b[n]);

/**
 * What a job's script edit adds to its pending lines, as fields for the job:
 * nothing when the edit touched no synced line. A line that only changed its
 * words, and was not pending for anything else, is also in syncPendingWords:
 * it can be retaken in its new words where it is, without Sync again.
 */
export const syncPendingAfter = (job: PendingJob, segments: AudioSegment[]): PendingFields => {
  const kinds = changedSyncLineKinds(job.segments, segments, job.syncReport);
  const pending = job.syncPendingLines || [];
  const words = job.syncPendingWords || [];
  const nextPending = withPendingLines(pending, [...kinds.keys()]);
  const nextWords = words.filter((key) => kinds.get(key) !== 'structure');
  for (const [key, kind] of kinds) if (kind === 'words' && !pending.includes(key) && !nextWords.includes(key)) nextWords.push(key);
  return {
    ...(!sameList(nextPending, pending) && { syncPendingLines: nextPending }),
    ...(!sameList(nextWords, words) && { syncPendingWords: nextWords }),
  };
};

/**
 * Lines pending for something other than their words (a retake or a take
 * asked for in Review, a take kept or used there), as fields for the job:
 * they wait for Sync again, so none of them can be retaken in place.
 */
export const pendingForSync = (job: Pick<PendingJob, 'syncPendingLines' | 'syncPendingWords'>, keys: string[]): PendingFields => {
  const words = job.syncPendingWords || [];
  const nextWords = words.filter((key) => !keys.includes(key));
  return {
    syncPendingLines: withPendingLines(job.syncPendingLines, keys),
    ...(!sameList(nextWords, words) && { syncPendingWords: nextWords }),
  };
};

/** A line that only changed its words since Sync, and so can be retaken in them where it is. */
export const rewordedOnly = (job: Pick<PendingJob, 'syncPendingLines' | 'syncPendingWords'>, key: string): boolean =>
  Boolean(job.syncPendingLines?.includes(key) && job.syncPendingWords?.includes(key));

/** `job`'s pending fields once `key` is back in step with the dub (a take in its new words was used). */
export const notPending = (job: Pick<PendingJob, 'syncPendingLines' | 'syncPendingWords'>, key: string): PendingFields => ({
  syncPendingLines: (job.syncPendingLines || []).filter((k) => k !== key),
  syncPendingWords: (job.syncPendingWords || []).filter((k) => k !== key),
});

/** A line's words as the script has them now, joined as Sync joins its cues into one line. */
export const lineTextNow = (segments: AudioSegment[], cueIds: (string | number)[]): string => {
  const byId = new Map(segments.map((segment) => [String(segment.id), segment]));
  return cueIds
    .map((id) => byId.get(String(id)))
    .map((segment) => (segment ? dubText(segment) : ''))
    .filter(Boolean)
    .join(' ');
};
