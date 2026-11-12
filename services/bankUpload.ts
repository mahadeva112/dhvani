import { apiPutBlob } from './apiClient.ts';

/** Banks being sent to the server, by id. */
const sending = new Map<string, Promise<unknown>>();

const untilAborted = <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

/**
 * Sends a sync's bank again (PUT /sync/edit/banks/:bankId) when the server no
 * longer has it. One upload per bank runs at a time, and callers share it. It
 * is not tied to the caller's signal: a long dub's bank takes seconds to
 * send, and a newer edit cancelling the render used to cut the upload off
 * each time, so the bank never arrived. `signal` only stops the wait.
 */
export const sendBankAgain = (bankId: string, blob: Blob, { signal }: { signal?: AbortSignal } = {}): Promise<unknown> => {
  let upload = sending.get(bankId);
  if (!upload) {
    upload = apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bankId)}`, blob).finally(() => sending.delete(bankId));
    // A failure reaches the callers waiting; nobody waiting is not an unhandled rejection.
    upload.catch(() => {});
    sending.set(bankId, upload);
  }
  return untilAborted(upload, signal);
};
