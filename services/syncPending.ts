import type { AudioSegment } from '../types';

/** Just what this needs of a sync report: each line's key and its cues. */
interface ReportLines {
  units: { key: string; cueIds: (string | number)[] }[];
}

const dubText = (segment: AudioSegment) => (segment.textTarget || segment.targetText || '').trim();
const sourceText = (segment: AudioSegment) => (segment.textSource || segment.originalText || '').trim();

const sameCue = (a: AudioSegment, b: AudioSegment) =>
  a.startTime === b.startTime && a.endTime === b.endTime && dubText(a) === dubText(b) && sourceText(a) === sourceText(b);

/**
 * The synced lines an edit of the script touched, by line key: a cue cut,
 * joined, retimed or reworded marks its line; a cue the last Sync never saw
 * (the second half of a cut) marks the line before it, or is named by its own
 * id when it comes first. Empty with no report.
 */
export const changedSyncLines = (before: AudioSegment[], after: AudioSegment[], report: ReportLines | null | undefined): string[] => {
  if (!report) return [];
  const lineOf = new Map<string, string>();
  for (const unit of report.units) for (const id of unit.cueIds) lineOf.set(String(id), unit.key);
  const old = new Map(before.map((segment) => [String(segment.id), segment]));
  const now = new Map(after.map((segment) => [String(segment.id), segment]));
  const keys = new Set<string>();
  // A new cue (the second half of a cut) belongs to the line before it, so one cut counts as one line.
  let lastKey: string | undefined;
  for (const [id, segment] of now) {
    const was = old.get(id);
    const key = lineOf.get(id) ?? lastKey ?? id;
    if (!was || !sameCue(was, segment)) keys.add(key);
    lastKey = key;
  }
  for (const id of old.keys()) if (!now.has(id) && lineOf.has(id)) keys.add(lineOf.get(id)!);
  return [...keys];
};

/** `pending` with `keys` added, or `pending` itself when nothing is new. */
export const withPendingLines = (pending: string[] | null | undefined, keys: string[]): string[] => {
  const list = pending || [];
  const added = keys.filter((key) => !list.includes(key));
  return added.length ? [...list, ...added] : list;
};

/**
 * What a job's script edit adds to its pending lines, as fields for the job:
 * nothing when the edit touched no synced line.
 */
export const syncPendingAfter = (
  job: { segments: AudioSegment[]; syncReport?: ReportLines | null; syncPendingLines?: string[] | null },
  segments: AudioSegment[]
): { syncPendingLines?: string[] } => {
  const keys = changedSyncLines(job.segments, segments, job.syncReport);
  const next = withPendingLines(job.syncPendingLines, keys);
  return next.length === (job.syncPendingLines?.length ?? 0) ? {} : { syncPendingLines: next };
};
