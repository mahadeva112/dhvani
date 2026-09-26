/**
 * Progress and cancellation for dubs in flight.
 *
 * A dub is one long HTTP request, so the browser learns how far it has got by
 * polling a job it names up front, and stops it by cancelling that job. Jobs
 * live in memory: they only matter while the request that owns them runs.
 */

/** How long a finished job stays readable, so the last poll still sees it end. */
const KEEP_FINISHED_MS = 60_000;

const jobs = new Map();

const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/** Starts tracking a dub. Returns null for a missing or malformed id. */
export const startDubJob = (id) => {
  if (!isValidId(id)) return null;
  const job = {
    controller: new AbortController(),
    progress: {
      phase: 'preparing',
      passageCount: 0,
      passagesDone: 0,
      totalChars: 0,
      charsDone: 0,
      secondsGenerated: 0,
      streaming: true,
    },
    timer: null,
  };
  jobs.set(id, job);
  return job;
};

export const updateDubJob = (id, patch) => {
  const job = jobs.get(id);
  if (job) Object.assign(job.progress, patch);
};

/** Marks a job over and forgets it after a short grace period. */
export const finishDubJob = (id, phase) => {
  const job = jobs.get(id);
  if (!job) return;
  job.progress.phase = phase;
  clearTimeout(job.timer);
  job.timer = setTimeout(() => jobs.delete(id), KEEP_FINISHED_MS);
  job.timer.unref?.();
};

export const getDubProgress = (id) => jobs.get(id)?.progress || null;

/** Stops a dub. Returns false when no such dub is running. */
export const cancelDubJob = (id) => {
  const job = jobs.get(id);
  if (!job || job.controller.signal.aborted) return false;
  job.controller.abort();
  return true;
};
