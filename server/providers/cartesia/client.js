import { config, resolveKey } from '../../env.js';
import { missingKey } from '../../errors.js';
import { requestWithRetry } from '../../lib/http.js';
import { LANGUAGES } from '../../lib/languages.js';

export const PROVIDER_LABEL = 'Cartesia';

/**
 * Voice IDs Cartesia hands out are bare UUIDs, which could collide with an
 * ElevenLabs ID in the shared voice list. DHVANI prefixes them everywhere
 * outside this provider, so a voice always says which engine speaks it.
 */
export const VOICE_PREFIX = 'cartesia:';

export const toDhvaniVoiceId = (id) => `${VOICE_PREFIX}${id}`;
export const toCartesiaVoiceId = (voiceId) => String(voiceId || '').trim().replace(/^cartesia:/, '');

/** Resolves the key for a request: configured key first, caller override only as fallback. */
export const cartesiaKey = (overrideKey) => {
  const key = resolveKey(config.cartesia.apiKey, overrideKey);
  if (!key) throw missingKey('cartesia');
  return key;
};

export const hasCartesiaKey = () => Boolean(config.cartesia.apiKey);

/** Cartesia wants ISO 639-1 codes ("hi"); DHVANI's names map to them through their BCP-47 tag. */
export const toCartesiaLanguage = (displayName) => {
  const entry = LANGUAGES.find((language) => language.name.toLowerCase() === String(displayName || '').trim().toLowerCase());
  return entry?.bcp47 ? entry.bcp47.split('-')[0].toLowerCase() : '';
};

const headers = (apiKey, extra = {}) => ({
  Authorization: `Bearer ${cartesiaKey(apiKey)}`,
  'Cartesia-Version': config.cartesia.apiVersion,
  ...extra,
});

/** `baseUrl` overrides the configured endpoint for one call, so settings can be checked before saving. */
const url = (endpoint, baseUrl) =>
  `${(baseUrl || '').trim().replace(/\/+$/, '') || config.cartesia.baseUrl}${endpoint}`;

/** JSON GET/POST against the Cartesia REST API. */
export const cartesiaJson = async (endpoint, { method = 'GET', body, apiKey, baseUrl, timeoutMs } = {}) => {
  const response = await requestWithRetry(
    url(endpoint, baseUrl),
    {
      method,
      headers: headers(apiKey, body ? { 'Content-Type': 'application/json' } : {}),
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 60000 }
  );
  return response.json();
};

/** Multipart POST; returns the raw Response. */
export const cartesiaMultipart = async (endpoint, formData, { apiKey, timeoutMs, retries, signal } = {}) =>
  requestWithRetry(
    url(endpoint),
    { method: 'POST', headers: headers(apiKey), body: formData },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 600000, retries: retries ?? 1, signal }
  );

/** JSON POST that returns binary audio. `signal` lets the caller cancel it. */
export const cartesiaBinary = async (endpoint, body, { apiKey, timeoutMs, signal } = {}) =>
  requestWithRetry(
    url(endpoint),
    {
      method: 'POST',
      headers: headers(apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 300000, retries: 1, signal }
  );

/** An authenticated GET of an absolute URL, e.g. a voice's preview file. */
export const cartesiaFetch = async (absoluteUrl, { apiKey, timeoutMs } = {}) =>
  requestWithRetry(
    absoluteUrl,
    { method: 'GET', headers: headers(apiKey) },
    { provider: PROVIDER_LABEL, timeoutMs: timeoutMs || 30000, retries: 1 }
  );

/**
 * Credits used since `since`, summed over Cartesia's usage buckets.
 *
 * The usage route is an admin route: Cartesia refuses a standard sk_car_ key
 * there, so this takes the separate admin key and never falls back to the
 * voice key. It reports spend only; Cartesia's API has no balance or plan size.
 */
export const getCreditsUsed = async ({ adminKey, since, baseUrl } = {}) => {
  if (!adminKey) throw missingKey('cartesia');
  const response = await requestWithRetry(
    url(`/usage/credits?start_ts=${encodeURIComponent(since.toISOString())}`, baseUrl),
    { method: 'GET', headers: { Authorization: `Bearer ${adminKey}`, 'Cartesia-Version': config.cartesia.apiVersion } },
    { provider: PROVIDER_LABEL, timeoutMs: 15000, retries: 0 }
  );
  const data = await response.json();
  return (data?.data || []).reduce((sum, bucket) => sum + (Number(bucket.credits) || 0), 0);
};
