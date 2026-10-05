import { AudioSegment, BatchJob, ProcessingStatus } from '../types';

/**
 * Whether the cues hold a transcript. A file's cues are cut from its pauses as
 * soon as it is added, empty until it is transcribed.
 */
export const hasTranscript = (segments: AudioSegment[]) =>
  segments.some((s) => (s.textSource || s.originalText || '').trim());

/** What is running on a project right now, for openSteps. */
export interface ProjectWork {
  transcribing?: boolean;
  translating?: boolean;
  dubbing?: boolean;
}

/**
 * How far into the steps a project may go: a step opens only once the one
 * before it is done, and while a step's work runs every step after it stays
 * locked. `upTo` is the last open step; `why[n]` says why step n is locked.
 *
 *   1 Source & voice   always
 *   2 Review           once the audio is transcribed
 *   3 Final dub        once there is a script: translated, or the user's own
 *   4 Sync             once there is a dub
 */
export const openSteps = (job: BatchJob | null | undefined, work: ProjectWork = {}): { upTo: number; why: Record<number, string> } => {
  const why: Record<number, string> = {};
  const lockFrom = (step: number, reason: string) => {
    for (let n = step; n <= 4; n++) why[n] = reason;
    return { upTo: step - 1, why };
  };
  if (!job) return lockFrom(2, 'Add media first');
  if (work.transcribing) return lockFrom(2, 'Transcription is still running');
  if (!hasTranscript(job.segments)) return lockFrom(2, 'Transcribe the audio first');
  if (work.translating) return lockFrom(3, 'Translation is still running');
  // Projects from before the choice existed have no targetSource and do have a script.
  if (job.targetSource === 'pending') return lockFrom(3, 'Translate the transcript or use your own script first');
  if (work.dubbing) return lockFrom(4, 'The dub is still being made');
  if (!job.synthesizedAudioUrl && !job.syncedAudioUrl) return lockFrom(4, 'Make the dub in Final dub first');
  return { upTo: 4, why };
};

/** What a project is called: the name the user gave it, else its file's name without the extension. */
export const projectName = (job: BatchJob): string => {
  const named = job.name?.trim();
  if (named) return named;
  const file = job.file?.name;
  if (file) return file.replace(/\.[^.]+$/, '') || file;
  return 'Untitled dub';
};

/** When a project was last worked on: "Today, 10:42", "Yesterday", "2 Oct". Empty for projects saved before dates were kept. */
export const projectWhen = (job: BatchJob, now = new Date()): string => {
  const ms = job.updatedAt ?? job.createdAt;
  if (!ms) return '';
  const at = new Date(ms);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return `Today, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  if (ms >= startOfToday - 86_400_000) return 'Yesterday';
  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
};

/** Newest first. Projects saved before dates were kept go last, in the order they came. */
export const byNewest = (a: BatchJob, b: BatchJob) => (b.createdAt ?? 0) - (a.createdAt ?? 0);

export type StageKind = 'dubbed' | 'review' | 'working' | 'waiting' | 'error';

/** Where a project has got to, read from its status and what it already holds. */
export const jobStage = (job: BatchJob): { kind: StageKind; label?: string; dubbing?: boolean } => {
  switch (job.status) {
    case ProcessingStatus.ERROR:
      return { kind: 'error' };
    case ProcessingStatus.SYNTHESIZING_AUDIO:
      return { kind: 'working', label: 'Dubbing', dubbing: true };
    case ProcessingStatus.UPLOADING:
      return { kind: 'working', label: 'Uploading' };
    case ProcessingStatus.ANALYZING_AUDIO:
      return { kind: 'working', label: 'Reading audio' };
    case ProcessingStatus.GENERATING_XML:
    case ProcessingStatus.VALIDATING_XML:
      return { kind: 'working', label: 'Preparing' };
  }
  if (job.status === ProcessingStatus.COMPLETED || job.synthesizedAudioUrl || job.syncedAudioUrl) return { kind: 'dubbed' };
  if (hasTranscript(job.segments)) return { kind: 'review' };
  return { kind: 'waiting' };
};
