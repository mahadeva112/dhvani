import { BatchJob, ProcessingStatus } from '../types';
import { hasTranscript } from './steps';

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
