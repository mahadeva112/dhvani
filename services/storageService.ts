import { BatchJob } from "../types";

const DB_NAME = "DhvaniDB";
const STORE_NAME = "jobs";
const DB_VERSION = 1;

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
    // We EXCLUDE: audioBuffer, synthAudioBuffer, synthesizedAudioUrl, srtUrl
    const serializableJob = {
      ...job,
      audioBuffer: null, // Cannot store
      synthAudioBuffer: null, // Cannot store
      synthesizedAudioUrl: null, // Revoked on reload
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
 * Deletes a specific job by ID.
 */
export const deleteJobFromStorage = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Clears all jobs.
 */
export const clearAllJobsFromStorage = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};