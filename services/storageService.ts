import { BatchJob } from "../types";

const DB_NAME = "DhvaniDB";
const STORE_NAME = "jobs";
/** The banks of earlier Syncs, for undo past a Sync (services/projectHistory.ts): written once each, apart from the project. */
const HISTORY_STORE = "historyBanks";
const DB_VERSION = 2;

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
export const saveJobToStorage = async (job: BatchJob): Promise<void> => {
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

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Retrieves all jobs from IndexedDB.
 */
export const getAllJobsFromStorage = async (): Promise<BatchJob[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as BatchJob[]);
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Deletes a specific job by ID, and the banks its history kept.
 */
export const deleteJobFromStorage = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME, HISTORY_STORE], "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.objectStore(HISTORY_STORE).delete(historyRange(id));
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
  await historyRequest("readwrite", (store) => store.put({ id: historyKey(jobId, bank.epoch), jobId, ...bank }));
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
    const transaction = db.transaction([STORE_NAME, HISTORY_STORE], "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(HISTORY_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};