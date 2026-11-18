/**
 * A sync is one long request. When its connection drops while the engine
 * stays up (a sleeping laptop, a VPN or network change, security software
 * cutting loopback), the engine carries on with the run while the app polls
 * it, and this picks up the answer instead of failing a sync minutes in.
 */
import { apiGet, DhvaniApiError } from './apiClient.ts';

const abortError = (signal?: AbortSignal) => signal?.reason ?? new DOMException('The sync was stopped.', 'AbortError');

/**
 * Waits for a sync whose request lost its connection while the engine stayed
 * up (a sleeping laptop, a VPN or network change), and returns what that
 * request would have answered. The engine keeps such a run going while the
 * app polls it. Throws `lost` when the engine no longer knows the run (it
 * restarted), and the run's own error when it failed.
 */
export const awaitSyncResult = async <T>(
  jobId: string,
  lost: Error,
  {
    signal,
    pollMs = 1000,
    unreachableMs = 120_000,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    get = (path: string) => apiGet<T | { running: true }>(path, { retry: false, signal }),
  }: {
    signal?: AbortSignal;
    pollMs?: number;
    unreachableMs?: number;
    wait?: (ms: number) => Promise<void>;
    get?: (path: string) => Promise<T | { running: true }>;
  } = {}
): Promise<T> => {
  const path = `/sync/jobs/${encodeURIComponent(jobId)}/result`;
  let unreachableSince = 0;
  for (;;) {
    if (signal?.aborted) throw abortError(signal);
    try {
      const answer = await get(path);
      unreachableSince = 0;
      if (!(answer && typeof answer === 'object' && (answer as { running?: boolean }).running === true)) return answer as T;
    } catch (err) {
      if (signal?.aborted) throw abortError(signal);
      if (!(err instanceof DhvaniApiError)) throw err;
      if (err.code === 'sync_not_found') throw lost;
      if (err.code !== 'backend_unreachable') throw err;
      unreachableSince ||= Date.now();
      if (Date.now() - unreachableSince > unreachableMs) throw lost;
    }
    await wait(pollMs);
  }
};

/** Runs a sync request; when only its connection was lost, picks up the run's answer from the engine instead of failing. */
export const withJobRecovery = async <T>(jobId: string | undefined, signal: AbortSignal | undefined, request: () => Promise<T>): Promise<T> => {
  try {
    return await request();
  } catch (err) {
    if (!jobId || signal?.aborted || !(err instanceof DhvaniApiError) || err.code !== 'backend_unreachable') throw err;
    console.info('The sync lost its connection; waiting for the engine to finish it.');
    return awaitSyncResult<T>(jobId, err, { signal });
  }
};
