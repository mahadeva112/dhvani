/**
 * Progress and cancellation for dubs in flight.
 *
 * A dub is one long HTTP request, so the browser learns how far it has got by
 * polling a job it names up front, and stops it by cancelling that job. Jobs
 * live in memory: they only matter while the request that owns them runs.
 *
 * When that request's connection drops halfway (a sleeping laptop, a VPN or
 * network change, security software cutting loopback) while the app is still
 * open, the job keeps running as long as the app keeps polling it, and its
 * answer is kept so the app can fetch it (GET …/jobs/:id/result) instead of
 * losing a sync that was minutes in.
 */

/** How long a finished job stays readable, so the last poll still sees it end. */
const KEEP_FINISHED_MS = 60_000;
/** A finished job whose request had dropped keeps its answer this long for the app to fetch. */
const KEEP_DETACHED_RESULT_MS = 10 * 60_000;
/** A job whose request dropped is stopped when the app hasn't asked about it for this long. */
export const ORPHAN_MS = 30_000;

const jobs = new Map();

const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/**
 * Starts tracking a dub. Returns null for a missing or malformed id.
 * `progress` replaces the text-to-speech starting report for other kinds of
 * job (a sync reports its own steps).
 */
export const startDubJob = (id, progress) => {
  if (!isValidId(id)) return null;
  const job = {
    controller: new AbortController(),
    progress: progress || {
      phase: 'preparing',
      passageCount: 0,
      passagesDone: 0,
      totalChars: 0,
      charsDone: 0,
      secondsGenerated: 0,
      streaming: true,
    },
    timer: null,
    lastSeen: Date.now(),
    detached: false,
    orphanTimer: null,
    /** What the request would have answered: { status, body }. */
    outcome: null,
  };
  jobs.set(id, job);
  return job;
};

export const updateDubJob = (id, patch) => {
  const job = jobs.get(id);
  if (job) Object.assign(job.progress, patch);
};

/**
 * Marks a job over and forgets it after a short grace period. `outcome`
 * ({ status, body }) is the answer its request was given, kept so the app can
 * still fetch it when that request's connection had dropped.
 */
export const finishDubJob = (id, phase, outcome = null) => {
  const job = jobs.get(id);
  if (!job) return;
  job.progress.phase = phase;
  if (outcome) job.outcome = outcome;
  clearTimeout(job.orphanTimer);
  clearTimeout(job.timer);
  job.timer = setTimeout(() => jobs.delete(id), job.detached ? KEEP_DETACHED_RESULT_MS : KEEP_FINISHED_MS);
  job.timer.unref?.();
};

/** A poll: also tells a job whose request dropped that the app is still there. */
export const getDubProgress = (id) => {
  const job = jobs.get(id);
  if (!job) return null;
  job.lastSeen = Date.now();
  return job.progress;
};

/**
 * The request that owns a job closed before answering. The job runs on while
 * the app keeps polling it, and is stopped once the app has been silent for
 * ORPHAN_MS (the window was closed, or the app gave up). Returns false when
 * there is no such running job, so the caller stops the work itself.
 */
export const detachDubJob = (id, { now = Date.now, orphanMs = ORPHAN_MS, onOrphan } = {}) => {
  const job = jobs.get(id);
  if (!job || job.controller.signal.aborted || job.outcome) return false;
  job.detached = true;
  job.lastSeen = now();
  const check = () => {
    if (job.outcome || job.controller.signal.aborted) return;
    const silent = now() - job.lastSeen;
    if (silent >= orphanMs) {
      onOrphan?.();
      job.controller.abort();
      return;
    }
    job.orphanTimer = setTimeout(check, Math.max(1000, orphanMs - silent));
    job.orphanTimer.unref?.();
  };
  job.orphanTimer = setTimeout(check, orphanMs);
  job.orphanTimer.unref?.();
  return true;
};

/**
 * What a finished job answered, for the app whose request dropped:
 * { status, body } once it is over, { running: true } while it still runs,
 * null when no such job is known.
 */
export const dubJobOutcome = (id) => {
  const job = jobs.get(id);
  if (!job) return null;
  job.lastSeen = Date.now();
  return job.outcome || { running: true };
};

/** Stops a dub. Returns false when no such dub is running. */
export const cancelDubJob = (id) => {
  const job = jobs.get(id);
  if (!job || job.controller.signal.aborted) return false;
  job.controller.abort();
  return true;
};
