import { BatchJob } from "../types";
import { trackSave } from "./pendingSaves";

const DB_NAME = "DhvaniDB";
const STORE_NAME = "jobs";
/** The banks of earlier Syncs, for undo past a Sync (services/projectHistory.ts): written once each, apart from the project. */
const HISTORY_STORE = "historyBanks";
/** The video added for review, one per project: a copy, so it is there after a restart even if the original moves. */
const REVIEW_VIDEO_STORE = "reviewVideos";
const DB_VERSION = 3;

/**
 * Opens the IndexedDB database.
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(REVIEW_VIDEO_STORE)) {
        db.createObjectStore(REVIEW_VIDEO_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

/**
 * Saves or updates a job in IndexedDB.
 * We must strip non-serializable fields like AudioBuffers and object URLs (which are useless after reload).
 */
export const saveJobToStorage = (job: BatchJob): Promise<void> => trackSave(writeJob(job));

const writeJob = async (job: BatchJob): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // Create a clone that only contains serializable data (File, Blob, strings, numbers, objects)
    // We EXCLUDE: audioBuffer, synthAudioBuffer, syncedAudioBuffer, synthesizedAudioUrl, syncedAudioUrl, srtUrl
    const serializableJob = {
      ...job,
      audioBuffer: null, // Cannot store
      synthAudioBuffer: null, // Cannot store
      syncedAudioBuffer: null, // Cannot store
      synthesizedAudioUrl: null, // Revoked on reload
      syncedAudioUrl: null, // Revoked on reload
      srtUrl: null // Revoked on reload
    };

    const request = store.put(serializableJob);

    // Saved only once the transaction completes: a put that succeeded can still be lost if it is cut short.
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
};

/** Every project that can be read, and the ids of any that could not (left on disk untouched). */
export interface StoredJobs {
  jobs: BatchJob[];
  unreadable: string[];
}

/**
 * Retrieves all jobs from IndexedDB. Read together when it can be; when one
 * project cannot be read (a file of its audio lost), all of them would fail
 * together, so they are then read one at a time and only that one is left out.
 * Nothing is ever deleted here.
 */
export const getAllJobsFromStorage = async (): Promise<StoredJobs> => {
  const db = await openDB();
  const read = <T>(run: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const request = run(db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  try {
    return { jobs: await read((store) => store.getAll() as IDBRequest<BatchJob[]>), unreadable: [] };
  } catch (err) {
    console.warn("Projects could not be read together; reading them one at a time:", err);
  }
  const keys = await read((store) => store.getAllKeys());
  const jobs: BatchJob[] = [];
  const unreadable: string[] = [];
  for (const key of keys) {
    try {
      const job = await read((store) => store.get(key) as IDBRequest<BatchJob | undefined>);
      if (job) jobs.push(job);
    } catch (err) {
      console.warn(`Project ${String(key)} could not be read:`, err);
      unreadable.push(String(key));
    }
  }
  return { jobs, unreadable };
};

/**
 * Deletes a specific job by ID, the banks its history kept and its review video.
 */
export const deleteJobFromStorage = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, HISTORY_STORE, REVIEW_VIDEO_STORE], "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.objectStore(HISTORY_STORE).delete(historyRange(id));
    transaction.objectStore(REVIEW_VIDEO_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/** A bank an earlier Sync made (or the dub file the voice changer made), kept for undo. */
export interface HistoryBank {
  epoch: string;
  blob: Blob;
  /** A bank of lines and takes, or a dub that is only a file. */
  kind: "bank" | "file";
}

const historyKey = (jobId: string, epoch: string) => `${jobId}|${epoch}`;
// '|' then '}' : every key `${jobId}|…` sorts between them (epoch ids are letters, digits and dashes).
const historyRange = (jobId: string) => IDBKeyRange.bound(`${jobId}|`, `${jobId}|}`);

const historyRequest = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction([HISTORY_STORE], mode).objectStore(HISTORY_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/** The bank kept for Sync `epoch` of a project, or null. */
export const getHistoryBank = async (jobId: string, epoch: string): Promise<HistoryBank | null> => {
  const row = await historyRequest<{ epoch: string; blob: Blob; kind: "bank" | "file" } | undefined>("readonly", (store) => store.get(historyKey(jobId, epoch)));
  return row ? { epoch: row.epoch, blob: row.blob, kind: row.kind } : null;
};

/**
 * Keeps the bank of Sync `epoch`. Between Syncs a bank only grows, so a bank
 * kept already is replaced only by a longer one: it holds every take of it.
 */
export const saveHistoryBank = async (jobId: string, bank: HistoryBank): Promise<void> => {
  const kept = await getHistoryBank(jobId, bank.epoch);
  if (kept && kept.kind === bank.kind && kept.blob.size >= bank.blob.size) return;
  await trackSave(historyRequest("readwrite", (store) => store.put({ id: historyKey(jobId, bank.epoch), jobId, ...bank })));
};

/** Lets go of the banks of `epochs`. */
export const deleteHistoryBanks = async (jobId: string, epochs: string[]): Promise<void> => {
  for (const epoch of epochs) await historyRequest("readwrite", (store) => store.delete(historyKey(jobId, epoch)));
};

/** Every bank kept for a project's history, for a project file. */
export const getHistoryBanks = async (jobId: string): Promise<HistoryBank[]> => {
  const rows = await historyRequest<{ epoch: string; blob: Blob; kind: "bank" | "file" }[]>("readonly", (store) => store.getAll(historyRange(jobId)));
  return rows.map((row) => ({ epoch: row.epoch, blob: row.blob, kind: row.kind }));
};

/**
 * Clears all jobs.
 */
export const clearAllJobsFromStorage = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, HISTORY_STORE, REVIEW_VIDEO_STORE], "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(HISTORY_STORE).clear();
    transaction.objectStore(REVIEW_VIDEO_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};
const reviewVideoRequest = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([REVIEW_VIDEO_STORE], mode);
    const request = run(transaction.objectStore(REVIEW_VIDEO_STORE));
    // A write is kept only once its transaction completes.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? request.error);
  });
};

/** The video added for review to project `jobId`, or null. Read back from disk; nothing is loaded into memory. */
export const getReviewVideo = async (jobId: string): Promise<File | null> => {
  const row = await reviewVideoRequest<{ file: Blob; name?: string } | undefined>("readonly", (store) => store.get(jobId));
  if (!row || !(row.file instanceof Blob)) return null;
  return row.file instanceof File ? row.file : new File([row.file], row.name || "Review video", { type: row.file.type });
};

/** Keeps a copy of `file` as project `jobId`'s review video, in place of any before. */
export const saveReviewVideo = async (jobId: string, file: File): Promise<void> => {
  await trackSave(reviewVideoRequest("readwrite", (store) => store.put({ id: jobId, file, name: file.name })));
};

/** Lets go of project `jobId`'s review video. */
export const deleteReviewVideo = async (jobId: string): Promise<void> => {
  await reviewVideoRequest("readwrite", (store) => store.delete(jobId));
};
