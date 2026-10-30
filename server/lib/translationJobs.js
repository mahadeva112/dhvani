/**
 * Translations that outlive their request.
 *
 * A long script takes many minutes to translate, and the one HTTP request that
 * started it can drop meanwhile (the computer sleeps, the network blips, the
 * page reloads). The work keeps going here, under an id the app
 * names up front, so the app can ask for the outcome again instead of losing
 * it.
 *
 * Jobs live in memory, so a backend restart forgets them. What survives is
 * a checkpoint on disk, rewritten after every finished batch: when the app
 * sends the same translation again under the same id, the batches already
 * done are taken from it and only the rest goes to the model.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_DIR } from '../env.js';
import { logger } from '../logger.js';

/** How long a finished translation stays readable for an app that lost its connection. */
const KEEP_FINISHED_MS = 30 * 60_000;

/** Checkpoints older than this belong to runs nobody is coming back for. */
const KEEP_CHECKPOINT_MS = 24 * 60 * 60_000;

export const CHECKPOINT_DIR = path.join(CONFIG_DIR, 'translation-jobs');

const jobs = new Map();

const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

/**
 * What a checkpoint is good for: the same cues, languages, prompt and mode.
 * A checkpoint made for anything else is never resumed from.
 */
export const translationFingerprint = (request) =>
  crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');

const checkpointFile = (id, dir) => path.join(dir, `${id}.json`);

/** Saves the translations so far. A failed write only costs the resume. */
export const saveCheckpoint = (id, fingerprint, { translations, terms, modelUsed }, dir = CHECKPOINT_DIR) => {
  if (!isValidId(id)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = checkpointFile(id, dir);
    const body = JSON.stringify({ fingerprint, savedAt: Date.now(), translations: Object.fromEntries(translations), terms, modelUsed });
    // Written aside and renamed, so a restart mid-write never leaves half a file.
    fs.writeFileSync(`${file}.tmp`, body);
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    logger.warn(`Could not save translation progress: ${err?.message || err}`);
  }
};

/** The saved progress of this translation, or null when there is none that fits. */
export const loadCheckpoint = (id, fingerprint, dir = CHECKPOINT_DIR) => {
  if (!isValidId(id)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(checkpointFile(id, dir), 'utf8'));
    return saved?.fingerprint === fingerprint ? saved : null;
  } catch {
    return null;
  }
};

/** Removes checkpoints too old to be resumed. */
export const pruneCheckpoints = (dir = CHECKPOINT_DIR, now = Date.now()) => {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > KEEP_CHECKPOINT_MS) fs.unlinkSync(file);
    } catch {
      // Gone already, or in use: the next prune tries again.
    }
  }
};

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
