import { config, resolveKey } from '../../env.js';
import { missingKey } from '../../errors.js';
import { requestWithRetry } from '../../lib/http.js';

export const PROVIDER_LABEL = 'ElevenLabs';

/** Resolves the key for a request: env key first, caller override only as fallback. */
export const elevenLabsKey = (overrideKey) => {
  const key = resolveKey(config.elevenlabs.apiKey, overrideKey);
  if (!key) throw missingKey('elevenlabs');
  return key;
};

export const hasElevenLabsKey = () => Boolean(config.elevenlabs.apiKey);

/**
 * Builds a request URL.
 *
 * `baseUrl` overrides the configured endpoint for one call, which is what lets
 * the settings screen check a candidate host before it is saved.
 */
const url = (endpoint, baseUrl) =>
  `${(baseUrl || '').trim().replace(/\/+$/, '') || config.elevenlabs.baseUrl}${endpoint}`;

/** JSON GET/POST against the ElevenLabs REST API. */
export const elevenLabsJson = async (endpoint, { method = 'GET', body, apiKey, baseUrl, timeoutMs } = {}) => {
  const response = await requestWithRetry(
    url(endpoint, baseUrl),
    {
      method,
      headers: {
        'xi-api-key': elevenLabsKey(apiKey),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 60000 }
  );

  return response.json();
};

/** Multipart POST; returns the raw Response so callers can stream binary bodies. */
export const elevenLabsMultipart = async (endpoint, formData, { apiKey, timeoutMs, retries } = {}) =>
  requestWithRetry(
    url(endpoint),
    {
      method: 'POST',
      headers: { 'xi-api-key': elevenLabsKey(apiKey) },
      body: formData,
    },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 600000, retries: retries ?? 1 }
  );

/** JSON POST that returns binary audio. `signal` lets the caller cancel it. */
export const elevenLabsBinary = async (endpoint, body, { apiKey, accept = 'audio/mpeg', timeoutMs, signal } = {}) =>
  requestWithRetry(
    url(endpoint),
    {
      method: 'POST',
      headers: {
        'xi-api-key': elevenLabsKey(apiKey),
        'Content-Type': 'application/json',
        Accept: accept,
      },
      body: JSON.stringify(body),
    },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 300000, retries: 1, signal }
  );
