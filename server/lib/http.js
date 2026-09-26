import { ApiError, fromProviderResponse } from '../errors.js';
import { logger } from '../logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The error a request stopped by its caller ends with; never retried. */
export const cancelledError = (provider) =>
  new ApiError('The request was cancelled.', { status: 499, code: 'cancelled', provider });

const parseBody = async (response) => {
  const type = response.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) return await response.json();
    const text = await response.text();
    return text ? { message: text.slice(0, 500) } : {};
  } catch {
    return {};
  }
};

/**
 * fetch() with timeout, bounded exponential backoff and provider-aware error
 * mapping. Retries only on 429 / 5xx / network faults so a bad key or a bad
 * request fails fast instead of burning quota.
 */
export const requestWithRetry = async (
  url,
  init = {},
  { provider = 'Provider', retries = 2, timeoutMs = 180000, baseDelayMs = 900, signal } = {}
) => {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw cancelledError(provider);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // `signal` is the caller's: aborting it stops this request and any retry.
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);

      if (response.ok) return response;

      const body = await parseBody(response);
      const error = fromProviderResponse(provider, response.status, body);

      if (!error.retryable || attempt === retries) throw error;
      lastError = error;
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
      if (signal?.aborted) throw cancelledError(provider);

      if (err instanceof ApiError) {
        if (!err.retryable || attempt === retries) throw err;
        lastError = err;
      } else if (err?.name === 'AbortError') {
        lastError = new ApiError(
          `${provider} request timed out after ${Math.round(timeoutMs / 1000)}s.`,
          { status: 504, code: 'timeout', provider, retryable: true }
        );
        if (attempt === retries) throw lastError;
      } else {
        lastError = new ApiError(
          `Could not reach ${provider}: ${err?.message || 'network error'}. Check your internet connection.`,
          { status: 503, code: 'network_error', provider, retryable: true }
        );
        if (attempt === retries) throw lastError;
      }
    }

    const delay = baseDelayMs * 2 ** attempt;
    logger.warn(`${provider} attempt ${attempt + 1} failed (${lastError.code}); retrying in ${delay}ms`);
    await sleep(delay);
  }

  throw lastError || new ApiError(`${provider} request failed.`, { provider });
};
