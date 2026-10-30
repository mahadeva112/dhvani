/**
 * Translations that outlive their request.
 *
 * A long script takes many minutes to translate, and the one HTTP request that
 * started it can drop meanwhile (the computer sleeps, the network blips, the
 * page reloads). The work keeps going here, under an id the app
 * names up front, so the app can ask for the outcome again instead of losing
 * it. Jobs live in memory: a backend restart still loses a running one.
 */

/** How long a finished translation stays readable for an app that lost its connection. */
const KEEP_FINISHED_MS = 30 * 60_000;

const jobs = new Map();

const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/** Starts tracking a translation. Returns null for a missing or malformed id. */
export const startTranslationJob = (id) => {
  if (!isValidId(id)) return null;
  const old = jobs.get(id);
  if (old) clearTimeout(old.timer);
  const job = { state: 'running', progress: null, result: null, error: null, timer: null };
  jobs.set(id, job);
  return job;
};

export const updateTranslationJob = (id, progress) => {
  const job = jobs.get(id);
  if (job) job.progress = progress;
};

/** Stores how a translation ended and forgets it after a while. */
export const finishTranslationJob = (id, { result = null, error = null }) => {
  const job = jobs.get(id);
  if (!job) return;
  job.state = error ? 'failed' : 'done';
  job.result = result;
  job.error = error;
  clearTimeout(job.timer);
  job.timer = setTimeout(() => jobs.delete(id), KEEP_FINISHED_MS);
  job.timer.unref?.();
};

/** The job as the app sees it, or null when this backend never ran it. */
export const getTranslationJob = (id) => {
  const job = jobs.get(id);
  if (!job) return null;
  return { state: job.state, progress: job.progress, result: job.result, error: job.error };
};
