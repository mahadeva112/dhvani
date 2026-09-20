import { config, gatewayEnabled } from '../env.js';
import { ApiError } from '../errors.js';
import { requestWithRetry } from './http.js';
import { discoverGateway } from '../providers/llmGateway/client.js';
import { candidateBases } from '../providers/llmGateway/url.js';

/**
 * Credential checks, reported in a single vocabulary.
 *
 * Every row answers the same three questions: is this reachable, is the key
 * accepted, and is the model the user named actually there. Distinguishing
 * those is what turns "it doesn't work" into something fixable — a wrong URL
 * and a wrong model produce very different next steps.
 */

/** Maps an HTTP status onto a status word and a sentence that names the fix. */
const readStatus = (code, label) => {
  if (code === 0) {
    return ['unverified', `No reply from ${label}. Check the URL and that the service is running.`];
  }
  if (code === 401 || code === 403) return ['invalid_key', `${label} rejected this key.`];
  if (code === 404) return ['not_found', `That endpoint does not exist — check the base URL.`];
  if (code === 429) return ['rate_limited', 'The key works, but it is rate-limited right now.'];
  if (code >= 500) return ['provider_down', `${label} answered ${code}.`];
  if (code !== 200) return ['unverified', `Unexpected reply (${code}).`];
  return ['ok', ''];
};

/** One GET that reports its HTTP status rather than throwing. */
const probe = async (url, headers, { timeoutMs = 12000 } = {}) => {
  try {
    const response = await requestWithRetry(url, { method: 'GET', headers }, {
      provider: 'probe',
      timeoutMs,
      retries: 0,
    });
    return { code: response.status, body: await response.json().catch(() => ({})) };
  } catch (err) {
    if (err instanceof ApiError) {
      // requestWithRetry maps provider statuses onto its own codes; recover the
      // HTTP status where it kept one, otherwise treat it as unreachable.
      const code =
        err.code === 'invalid_api_key' ? 401
        : err.code === 'rate_limited' ? 429
        : err.code === 'provider_unavailable' ? 503
        : err.status >= 400 && err.status < 600 ? err.status
        : 0;
      return { code, body: {}, error: err.message };
    }
    return { code: 0, body: {}, error: err?.message };
  }
};

/**
 * Checks the ElevenLabs key.
 *
 * Deliberately does not assert a model: `/v1/models` lists the speech models
 * and the Scribe STT family is not always among them, so demanding it would
 * report a false failure on a perfectly good key.
 */
export const checkElevenLabs = async ({ apiKey, baseUrl } = {}) => {
  const key = (apiKey || '').trim() || config.elevenlabs.apiKey || '';
  // A base URL still being typed is checked as given; blank means "what is saved".
  const base = (baseUrl || '').trim().replace(/\/+$/, '') || config.elevenlabs.baseUrl;

  if (!key) {
    return { id: 'elevenlabs', label: 'ElevenLabs', status: 'missing', message: 'No key set.', models: [] };
  }

  const { code, body, error } = await probe(`${base}/models`, {
    'xi-api-key': key,
  });

  const [status, message] = readStatus(code, 'ElevenLabs');
  const models = Array.isArray(body?.models ?? body)
    ? (body.models ?? body).map((m) => m?.model_id || m?.id).filter(Boolean).sort()
    : [];

  if (status !== 'ok') {
    return { id: 'elevenlabs', label: 'ElevenLabs', status, message: message || error || '', models };
  }

  return {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    status: 'ok',
    message: models.length
      ? `${models.length} ${models.length === 1 ? 'model' : 'models'} available.`
      : 'Key accepted.',
    models,
  };
};

/** Checks Google AI Studio directly, and whether it serves the chosen model. */
export const checkGoogle = async ({ apiKey, model, baseUrl } = {}) => {
  const key = (apiKey || '').trim() || config.gemini.apiKey || '';
  const want = (model || config.gemini.translationModels[0] || '').replace(/^models\//, '');
  /*
   * A custom Gemini host is checked at the same path the SDK would use, so the
   * row reports on the endpoint translation will actually call rather than on
   * Google's public one.
   */
  const base =
    ((baseUrl || '').trim() || config.gemini.baseUrl || 'https://generativelanguage.googleapis.com')
      .replace(/\/+$/, '');

  if (!key) {
    return { id: 'translation', label: 'Google Gemini', status: 'missing', message: 'No key set.', models: [] };
  }

  const { code, body, error } = await probe(`${base}/v1beta/models`, { 'x-goog-api-key': key });

  const [status, message] = readStatus(code, 'Google');
  const models = Array.isArray(body?.models)
    ? body.models.map((m) => String(m?.name || '').replace(/^models\//, '')).filter(Boolean).sort()
    : [];

  if (status !== 'ok') {
    return { id: 'translation', label: 'Google Gemini', status, message: message || error || '', models };
  }

  if (want && models.length > 0 && !models.includes(want)) {
    return {
      id: 'translation',
      label: 'Google Gemini',
      status: 'model_missing',
      message: `"${want}" is not among the ${models.length} models this key can reach.`,
      models,
      model: want,
    };
  }

  return {
    id: 'translation',
    label: 'Google Gemini',
    status: 'ok',
    message: want
      ? `${want} is live · ${models.length} models available.`
      : `${models.length} models available.`,
    models,
    model: want,
  };
};

/** Checks a self-hosted gateway, reusing the URL/model discovery. */
export const checkGateway = async ({ url, apiKey, protocol, model } = {}) => {
  const base = url ?? config.llmGateway.url;

  if (!base) {
    return { id: 'translation', label: 'LLM gateway', status: 'missing', message: 'No gateway URL set.', models: [] };
  }

  // A blank key means "use what is stored" — the form never receives secrets.
  const result = await discoverGateway({
    url: base,
    apiKey: (apiKey || '').trim() || config.llmGateway.apiKey || '',
    protocol: protocol ?? config.llmGateway.protocol,
    model: model ?? config.llmGateway.models[0],
  });

  if (result.valid) {
    return {
      id: 'translation',
      label: 'LLM gateway',
      status: 'ok',
      message:
        `${result.model} is live` +
        (result.availableModels.length
          ? ` · ${result.availableModels.length} ${result.availableModels.length === 1 ? 'model' : 'models'} available.`
          : '.'),
      models: result.availableModels,
      model: result.model,
      url: result.url,
      latencyMs: result.latencyMs,
    };
  }

  /*
   * Discovery reports one sentence; classify it so the badge matches. The
   * distinction that matters most is "reachable but the model is wrong",
   * which is one click from fixed via the model list.
   */
  const error = result.error || '';

  /** First match wins; ordered most specific to least. */
  const status =
    result.notPermitted || /does not offer|not among|may not use/i.test(error)
      ? 'model_missing'
      : result.rejected || /rejected|401|403|unauthor|requires an API key/i.test(error)
        ? 'invalid_key'
        : /does not exist|404/i.test(error)
          ? 'not_found'
          : 'unverified';

  return {
    id: 'translation',
    label: 'LLM gateway',
    status,
    message: error,
    models: result.availableModels || [],
    model: model ?? config.llmGateway.models[0],
    // What was actually tried, so a wrong URL is obvious.
    attempted: candidateBases(base, protocol ?? config.llmGateway.protocol),
  };
};

/**
 * Checks everything at once.
 *
 * Both rows run together because a user debugging their setup wants the whole
 * picture, not one answer at a time.
 */
export const detectAll = async (overrides = {}) => {
  const useGateway =
    overrides.mode === 'gateway' ||
    (overrides.mode === undefined && gatewayEnabled()) ||
    Boolean(overrides.gateway?.url);

  const [elevenlabs, translation] = await Promise.all([
    checkElevenLabs({
      apiKey: overrides.elevenLabsApiKey,
      baseUrl: overrides.elevenLabsBaseUrl,
    }),
    useGateway
      ? checkGateway(overrides.gateway || {})
      : checkGoogle({
          apiKey: overrides.geminiApiKey,
          model: overrides.geminiModel,
          baseUrl: overrides.geminiBaseUrl,
        }),
  ]);

  return {
    elevenlabs,
    translation,
    mode: useGateway ? 'gateway' : 'google',
    checkedAt: new Date().toISOString(),
  };
};
