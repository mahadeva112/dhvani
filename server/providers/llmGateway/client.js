import { config, resolveGateway, gatewayEnabled } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { requestWithRetry } from '../../lib/http.js';
import { cleanGatewayUrl, candidateBases, isLocalGateway, rankModels } from './url.js';

/**
 * Client for a self-hosted LLM gateway.
 *
 * Covers the two shapes a gateway in front of Gemini normally speaks:
 *
 *   openai  — OpenAI Chat Completions (LiteLLM, vLLM, OpenRouter, one-api,
 *             Portkey, LocalAI...). Auth is `Authorization: Bearer sk-...`.
 *   gemini  — Google's own generativelanguage REST shape, for a thin proxy.
 *             Auth is `x-goog-api-key`.
 *
 * It exposes the same `generateContent` signature as the direct Gemini client,
 * so the translation code works against either without changes.
 */

export const PROVIDER_LABEL = 'LLM gateway';

export const hasGatewayConfigured = gatewayEnabled;

/**
 * Validates a resolved gateway config, failing with an actionable message.
 *
 * A bearer token is NOT required for a gateway on this machine or a private
 * network: local LiteLLM and vLLM deployments commonly run without auth, and
 * demanding a key would block a working setup.
 */
const assertUsable = (gateway) => {
  if (!gateway.url) {
    throw new ApiError(
      'No LLM gateway URL is configured. Set LLM_GATEWAY_URL in your .env file and restart.',
      { status: 400, code: 'missing_gateway_url', provider: 'llm-gateway' }
    );
  }

  if (!gateway.apiKey && !isLocalGateway(gateway.url)) {
    throw new ApiError(
      `No bearer token is set for ${gateway.url}, and it is not on a local or private network. ` +
        'Set LLM_GATEWAY_KEY, or use the setup screen.',
      { status: 401, code: 'missing_api_key', provider: 'llm-gateway' }
    );
  }

  return gateway;
};

/** Auth headers for a gateway, omitting the token when there is none. */
const authHeaders = (gateway) =>
  gateway.apiKey
    ? gateway.protocol === 'gemini'
      ? { 'x-goog-api-key': gateway.apiKey }
      : { Authorization: `Bearer ${gateway.apiKey}` }
    : {};

/**
 * Flattens the Gemini-SDK `contents` shape into a plain prompt string.
 *
 * Translation only ever sends text, so this is lossless for that path. A part
 * carrying media is reported rather than silently dropped — see
 * `gatewaySupportsMedia`.
 */
const extractParts = (contents) => {
  const list = Array.isArray(contents) ? contents : [contents];
  const texts = [];
  let hasMedia = false;

  for (const entry of list) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      texts.push(entry);
      continue;
    }
    const parts = entry.parts || (entry.text !== undefined ? [entry] : []);
    for (const part of parts) {
      if (part?.text) texts.push(part.text);
      else if (part?.inlineData || part?.fileData) hasMedia = true;
    }
  }

  return { prompt: texts.join('\n\n').trim(), hasMedia };
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/* ------------------------------------------------------------------ */
/* OpenAI Chat Completions                                             */
/* ------------------------------------------------------------------ */

const callOpenAiCompatible = async ({ model, prompt, generationConfig, gateway }) => {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };

  if (typeof generationConfig.temperature === 'number') {
    body.temperature = generationConfig.temperature;
  }
  /*
   * Always send a budget. Left unset, the gateway's own default applies — and
   * a small default starves a reasoning model, which then returns null content
   * with finish_reason "length".
   */
  body.max_tokens =
    typeof generationConfig.maxOutputTokens === 'number'
      ? generationConfig.maxOutputTokens
      : config.llmGateway.maxOutputTokens;

  /*
   * Ask for JSON mode when the caller wants JSON. Some gateways reject the
   * parameter outright; the prompt already demands JSON and parseJsonResponse
   * tolerates fenced output, so a refusal here is recoverable — see the retry
   * below.
   */
  const wantsJson = generationConfig.responseMimeType === 'application/json';
  if (wantsJson) body.response_format = { type: 'json_object' };

  const send = (payload) =>
    requestWithRetry(
      `${gateway.url}/chat/completions`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(gateway),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      { provider: PROVIDER_LABEL, timeoutMs: 180000, retries: 1 }
    );

  let response;
  try {
    response = await send(body);
  } catch (err) {
    // A gateway that does not implement JSON mode answers 400. Retry plain.
    if (wantsJson && err instanceof ApiError && err.status === 400) {
      logger.warn('Gateway rejected response_format; retrying without JSON mode.');
      const { response_format, ...withoutJsonMode } = body;
      response = await send(withoutJsonMode);
    } else {
      throw err;
    }
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;

  if (typeof text !== 'string' || text === '') {
    /*
     * A reasoning model can burn the entire token budget on hidden reasoning
     * and stop before emitting any visible text. The response is a perfectly
     * valid 200 with null content — nothing is wrong except the budget.
     */
    const reasoning = data?.usage?.completion_tokens_details?.reasoning_tokens;
    if (choice?.finish_reason === 'length') {
      throw new ApiError(
        `"${model}" hit its output limit before producing any text` +
          (reasoning ? ` (it spent ${reasoning} tokens reasoning)` : '') +
          '. This is a reasoning model — give it a larger token budget, or pick a non-reasoning model.',
        { status: 502, code: 'output_truncated', provider: 'llm-gateway', retryable: false }
      );
    }

    throw new ApiError(
      `The gateway returned no message content for model "${model}". ` +
        'Check that this model name exists on your gateway.',
      { status: 502, code: 'empty_response', provider: 'llm-gateway', retryable: true }
    );
  }

  return text;
};

/* ------------------------------------------------------------------ */
/* Google generativelanguage REST                                      */
/* ------------------------------------------------------------------ */

const callGeminiRest = async ({ model, contents, generationConfig, gateway }) => {
  const normalized = Array.isArray(contents) ? contents : [contents];

  const response = await requestWithRetry(
    `${gateway.url}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(gateway),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: normalized.map((entry) =>
          typeof entry === 'string'
            ? { role: 'user', parts: [{ text: entry }] }
            : { role: entry.role || 'user', parts: entry.parts || [{ text: entry.text || '' }] }
        ),
        generationConfig,
      }),
    },
    { provider: PROVIDER_LABEL, timeoutMs: 180000, retries: 1 }
  );

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('');

  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new ApiError(
      blocked
        ? `The gateway's model blocked this request (${blocked}).`
        : `The gateway returned no content for model "${model}".`,
      { status: 502, code: 'empty_response', provider: 'llm-gateway', retryable: !blocked }
    );
  }

  return text;
};

/* ------------------------------------------------------------------ */

/** True when the configured protocol can carry audio or image parts. */
export const gatewaySupportsMedia = () => config.llmGateway.protocol === 'gemini';

/**
 * Runs a generation against the gateway, trying each candidate model in turn.
 *
 * Returns the same `{ response: { text }, modelUsed }` shape as the direct
 * Gemini client so callers do not need to know which one they are using.
 */
export const generateContent = async (
  { contents, generationConfig = {}, models, apiKey, retriesPerModel = 0, gateway: override } = {}
) => {
  const gateway = assertUsable(
    resolveGateway({
      ...override,
      apiKey: override?.apiKey ?? apiKey,
      // A top-level `models` is the caller's per-request choice; fall back to
      // the override's own list before the configured default. Assigning
      // `models` unconditionally here would clobber it with undefined.
      models: models?.length ? models : override?.models,
    })
  );
  const candidates = gateway.models;
  const { prompt, hasMedia } = extractParts(contents);

  if (hasMedia && gateway.protocol !== 'gemini') {
    throw new ApiError(
      'This feature sends audio to the model, which an OpenAI-compatible gateway cannot carry. ' +
        'Set a direct GEMINI_API_KEY to enable it, or switch LLM_GATEWAY_PROTOCOL to "gemini". ' +
        'Transcription, translation and subtitles are unaffected.',
      { status: 501, code: 'media_unsupported', provider: 'llm-gateway' }
    );
  }

  let lastError = null;
  /** Models the key is entitled to, if the gateway told us. */
  let permitted = null;

  for (const model of candidates) {
    for (let attempt = 0; attempt <= retriesPerModel; attempt += 1) {
      try {
        const text =
          gateway.protocol === 'gemini'
            ? await callGeminiRest({ model, contents, generationConfig, gateway })
            : await callOpenAiCompatible({ model, prompt, generationConfig, gateway });

        return { response: { text }, modelUsed: model };
      } catch (err) {
        lastError = err;

        /*
         * "This key may not use that model" is a per-model verdict, not a
         * verdict on the key — so it must fall through to the next candidate
         * rather than aborting. Treating it as a bad key meant one restricted
         * model at the head of the list hid every working model behind it.
         */
        if (err instanceof ApiError && err.code === 'model_not_permitted') {
          if (Array.isArray(err.details?.permitted)) permitted = err.details.permitted;
          logger.warn(`Gateway key may not use ${model}; trying the next candidate.`);
          break;
        }

        // A bad bearer key will fail identically on every model, so stop now.
        if (err instanceof ApiError && err.code === 'invalid_api_key') throw err;
        if (err instanceof ApiError && err.code === 'missing_api_key') throw err;
        if (err instanceof ApiError && err.code === 'missing_gateway_url') throw err;

        const retryable = err instanceof ApiError && RETRYABLE_STATUS.has(err.status);
        if (retryable && attempt < retriesPerModel) continue;

        logger.warn(
          `Gateway model ${model} failed (${err?.message?.slice(0, 160) || err}); trying the next candidate.`
        );
        break;
      }
    }
  }

  /*
   * Every candidate was refused on model grounds. The gateway told us what the
   * key IS allowed to use, which is the entire answer — say it.
   */
  if (permitted) {
    throw new ApiError(
      `This gateway key may not use ${candidates.length === 1 ? `"${candidates[0]}"` : `any of: ${candidates.join(', ')}`}. ` +
        (permitted.length
          ? `It can use: ${permitted.join(', ')}.`
          : 'Ask whoever issued the key which models it covers.'),
      {
        status: 403,
        code: 'model_not_permitted',
        provider: 'llm-gateway',
        details: { permitted },
      }
    );
  }

  if (lastError instanceof ApiError) throw lastError;

  throw new ApiError(
    `Every model failed on the LLM gateway (tried: ${candidates.join(', ')}). ` +
      `Last error: ${lastError?.message || 'unknown'}`,
    { status: 502, code: 'provider_unavailable', provider: 'llm-gateway', retryable: true }
  );
};

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

/**
 * Asks one candidate base URL for its model list.
 *
 * Distinguishes "nothing is listening here" from "this endpoint exists but
 * rejected the credential" — collapsing the two into a single null made an
 * auth failure read as an unreachable host, which sends people hunting for a
 * network problem that is not there.
 */
const probeModels = async (base, apiKey, protocol) => {
  try {
    const response = await requestWithRetry(
      `${base}/models`,
      { method: 'GET', headers: authHeaders({ apiKey, protocol }) },
      { provider: PROVIDER_LABEL, timeoutMs: 10000, retries: 0 }
    );

    const data = await response.json();
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    const names = list
      .map((item) => (typeof item === 'string' ? item : item?.id || item?.model || item?.name))
      .filter(Boolean)
      // Gemini REST returns "models/gemini-2.5-flash"; trim the prefix.
      .map((name) => String(name).replace(/^models\//, ''));

    return { ok: true, models: names };
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    const rejected = err instanceof ApiError && err.code === 'invalid_api_key';
    return { ok: false, status, rejected, error: err?.message };
  }
};

/**
 * Budget for the connection probe.
 *
 * Reasoning models (gemini-2.5-pro, o-series, and friends) spend tokens
 * thinking before they emit a single visible character. A tight budget makes
 * them stop at `finish_reason: "length"` with null content, which reads as a
 * broken model when the model is fine. 512 is ample for "OK" and still trivial.
 */
const PROBE_MAX_TOKENS = 512;

/** Sends a small completion to prove the model actually answers. */
const probeChat = async (base, apiKey, protocol, model) => {
  const gateway = { url: base, apiKey, protocol };

  try {
    const started = Date.now();
    const text =
      protocol === 'gemini'
        ? await callGeminiRest({
            model,
            contents: { role: 'user', parts: [{ text: 'Reply with the single word OK.' }] },
            generationConfig: { maxOutputTokens: PROBE_MAX_TOKENS, temperature: 0 },
            gateway,
          })
        : await callOpenAiCompatible({
            model,
            prompt: 'Reply with the single word OK.',
            generationConfig: { maxOutputTokens: PROBE_MAX_TOKENS, temperature: 0 },
            gateway,
          });

    return { ok: true, latencyMs: Date.now() - started, sample: String(text).trim().slice(0, 40) };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Request failed.',
      status: err?.status,
      // A model the key is not entitled to, distinct from a bad key.
      notPermitted: err?.code === 'model_not_permitted',
      permitted: Array.isArray(err?.details?.permitted) ? err.details.permitted : null,
    };
  }
};

/**
 * Asks the gateway which models this credential is actually entitled to.
 *
 * `/v1/models` lists what the GATEWAY hosts, which is not the same as what YOUR
 * account may call — a LiteLLM user can be scoped to a handful of a 65-model
 * catalog. Showing the full catalog in a picker is worse than showing nothing,
 * because every restricted entry looks like a working choice.
 *
 * There is no endpoint for "my entitlements", but a restriction error
 * enumerates them. So ask for a model that cannot plausibly exist: a restricted
 * credential answers with its permitted list, an unrestricted one just says the
 * model is unknown.
 */
const probeEntitlement = async (base, apiKey, protocol) => {
  if (!apiKey) return null; // Nothing to be scoped to.

  const outcome = await probeChat(base, apiKey, protocol, '__dhvani_entitlement_probe__');
  return outcome.permitted?.length ? outcome.permitted : null;
};

/**
 * Works out how to talk to a gateway from whatever the user pasted.
 *
 * Tries each plausible base URL (`.../v1` and the bare host), asks for the
 * model list, and sends one tiny completion to confirm the chosen model really
 * answers. Returns the resolved settings so the UI can fill them in rather than
 * making the user work out why `http://host:4000` needed `/v1` appended.
 */
export const discoverGateway = async ({ url, apiKey = '', protocol = 'openai', model } = {}) => {
  const bases = candidateBases(url, protocol);

  if (bases.length === 0) {
    return { valid: false, error: 'Enter your gateway URL, for example http://10.0.0.5:4000' };
  }

  const attempts = [];
  let bestListing = null;
  let rejectedAt = null;

  // Pass 1: find a base URL that can list models.
  for (const base of bases) {
    const outcome = await probeModels(base, apiKey, protocol);
    if (outcome.ok) {
      bestListing = { base, models: outcome.models };
      break;
    }
    // A 401 proves something IS listening here — it just wants a credential.
    if (outcome.rejected && !rejectedAt) rejectedAt = base;
    attempts.push(base);
  }

  if (!bestListing && rejectedAt) {
    return {
      valid: false,
      url: rejectedAt,
      protocol,
      availableModels: [],
      rejected: true,
      requiresKey: true,
      error: apiKey
        ? `The gateway at ${rejectedAt} rejected this key.`
        : `The gateway at ${rejectedAt} requires an API key. Enter the bearer token it expects.`,
    };
  }

  // Pass 2: confirm a model actually completes.
  if (bestListing) {
    const ranked = rankModels(bestListing.models);
    // Honour the user's choice when it exists on the gateway, or when the
    // gateway lists nothing useful but the user knows the name anyway.
    const chosen =
      (model && (bestListing.models.includes(model) || ranked.length === 0) && model) ||
      model ||
      ranked[0];

    if (!chosen) {
      return {
        valid: false,
        url: bestListing.base,
        availableModels: [],
        error:
          `Reached the gateway at ${bestListing.base}, but it lists no usable chat models. ` +
          'Enter a model name manually.',
      };
    }

    let chat = await probeChat(bestListing.base, apiKey, protocol, chosen);
    let usedModel = chosen;
    let switchedFrom = null;

    /*
     * The key is valid but scoped away from the model that was asked for, and
     * the gateway named the models it CAN use. Rather than stopping at "no",
     * take the best one it offered — the user wants a working configuration,
     * not a lecture about the one they guessed.
     */
    if (!chat.ok && chat.notPermitted && chat.permitted?.length) {
      const fallback = rankModels(chat.permitted)[0] || chat.permitted[0];
      if (fallback && fallback !== chosen) {
        const retry = await probeChat(bestListing.base, apiKey, protocol, fallback);
        if (retry.ok) {
          chat = retry;
          switchedFrom = chosen;
          usedModel = fallback;
        }
      }
    }

    /*
     * Prefer what this credential may actually use. Intersecting with the
     * gateway's own listing keeps out names the entitlement mentions but the
     * gateway does not serve.
     */
    const entitled = await probeEntitlement(bestListing.base, apiKey, protocol);
    const usable = entitled
      ? entitled.filter((name) => bestListing.models.includes(name))
      : null;

    const catalog = usable?.length ? usable : bestListing.models;
    const rankedCatalog = rankModels(catalog);
    const available = rankedCatalog.length > 0 ? rankedCatalog : catalog;

    /*
     * A model the gateway does not list is the single most common setup
     * mistake — people carry a model name over from another tool. Say so
     * directly and name what this gateway actually has, rather than relaying
     * the provider's 404.
     */
    const notListed =
      !chat.ok && bestListing.models.length > 0 && !bestListing.models.includes(usedModel);

    /*
     * The key is valid but scoped to a subset of the gateway's models. That is
     * a different fix from a wrong key or a wrong URL, and the gateway usually
     * names the models the key CAN reach — which is the whole answer.
     */
    const permitted = chat.permitted;

    return {
      valid: chat.ok,
      url: bestListing.base,
      protocol,
      model: usedModel,
      // Prefer what this key may actually use over the gateway's full catalog.
      availableModels: permitted?.length ? permitted : available,
      latencyMs: chat.latencyMs,
      requiresKey: Boolean(apiKey) || !isLocalGateway(bestListing.base),
      notPermitted: chat.notPermitted || undefined,
      permittedModels: permitted || undefined,
      switchedFrom: switchedFrom || undefined,
      note: switchedFrom
        ? `This key may not use "${switchedFrom}", so "${usedModel}" was selected instead.`
        : undefined,
      error: chat.ok
        ? undefined
        : chat.notPermitted
          ? `This key may not use "${usedModel}".` +
            (permitted?.length ? ` It can use: ${permitted.join(', ')}.` : '')
          : notListed
            ? `Connected to the gateway, but it does not offer "${usedModel}". ` +
              `Available here: ${available.slice(0, 5).join(', ')}` +
              `${available.length > 5 ? `, and ${available.length - 5} more` : ''}.`
            : `Reached the gateway at ${bestListing.base}, but "${usedModel}" did not answer: ${chat.error}`,
    };
  }

  /*
   * No base exposed /models. Plenty of gateways do not implement it, so fall
   * back to trying the completion endpoint directly with the model the user
   * supplied.
   */
  if (model) {
    for (const base of bases) {
      const chat = await probeChat(base, apiKey, protocol, model);
      if (chat.ok) {
        return {
          valid: true,
          url: base,
          protocol,
          model,
          availableModels: [],
          latencyMs: chat.latencyMs,
          requiresKey: Boolean(apiKey) || !isLocalGateway(base),
          note: 'This gateway does not publish a model list, so the model name was not verified against it.',
        };
      }
      attempts.push(`${base} (${chat.error})`);
    }
  }

  return {
    valid: false,
    availableModels: [],
    error:
      `Could not reach a ${protocol === 'gemini' ? 'Gemini-compatible' : 'OpenAI-compatible'} gateway at ` +
      `${cleanGatewayUrl(url)}. Tried: ${bases.join(', ')}. ` +
      (model
        ? 'Check the URL, the model name and that the gateway is running.'
        : 'Enter a model name so the connection can be tested directly.'),
  };
};

/**
 * Round-trips a tiny prompt so setup can confirm the gateway before the user
 * uploads a two-hour recording.
 *
 * Thin wrapper over discovery, kept for callers that only want a yes/no.
 */
export const testGateway = async ({ url, apiKey, protocol, model } = {}) => {
  const result = await discoverGateway({ url, apiKey, protocol, model });
  return {
    valid: result.valid,
    model: result.model,
    url: result.url,
    latencyMs: result.latencyMs,
    error: result.error,
    note: result.note,
  };
};

/** Asks an OpenAI-compatible gateway which models it exposes. */
export const listGatewayModels = async (override = {}) => {
  const gateway = resolveGateway(override);
  if (!gateway.url) return [];

  for (const base of candidateBases(gateway.url, gateway.protocol)) {
    const outcome = await probeModels(base, gateway.apiKey, gateway.protocol);
    if (outcome.ok) return rankModels(outcome.models);
  }

  return [];
};
