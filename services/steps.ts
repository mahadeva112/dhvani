import type { AudioSegment, BatchJob } from '../types';

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
}

/** The last step: Dub, which voices the script and syncs it to the original in one go. */
export const LAST_STEP = 3;

/**
 * How far into the steps a project may go: a step opens only once the one
 * before it is done, and while a step's work runs every step after it stays
 * locked. `upTo` is the last open step; `why[n]` says why step n is locked.
 *
 *   1 Source & voice   always
 *   2 Review           once the audio is transcribed
 *   3 Dub              once there is a script: translated, or the user's own
 */
export const openSteps = (job: BatchJob | null | undefined, work: ProjectWork = {}): { upTo: number; why: Record<number, string> } => {
  const why: Record<number, string> = {};
  const lockFrom = (step: number, reason: string) => {
    for (let n = step; n <= LAST_STEP; n++) why[n] = reason;
    return { upTo: step - 1, why };
  };
  if (!job) return lockFrom(2, 'Add media first');
  if (work.transcribing) return lockFrom(2, 'Transcription is still running');
  if (!hasTranscript(job.segments)) return lockFrom(2, 'Transcribe the audio first');
  if (work.translating) return lockFrom(3, 'Translation is still running');
  // Projects from before the choice existed have no targetSource and do have a script.
  if (job.targetSource === 'pending') return lockFrom(3, 'Translate the transcript or use your own script first');
  return { upTo: LAST_STEP, why };
};

/**
 * A step kept on a project, in today's steps. Projects saved when Final dub
 * (3) and Sync (4) were two steps land on Dub, which holds both.
 */
export const currentStep = (step: number) => Math.min(step, LAST_STEP);
