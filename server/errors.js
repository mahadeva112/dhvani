/**
 * Error type carried across the whole backend so every route can answer with a
 * consistent, user-presentable shape instead of a raw stack trace.
 */
export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status || 500;
    this.code = options.code || 'internal_error';
    this.provider = options.provider || null;
    this.details = options.details || null;
    this.retryable = Boolean(options.retryable);
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        provider: this.provider,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }
}

export const badRequest = (message, options = {}) =>
  new ApiError(message, { status: 400, code: 'bad_request', ...options });

const PROVIDER_LABELS = { elevenlabs: 'ElevenLabs', gemini: 'Gemini' };
const PROVIDER_ENV_VARS = { elevenlabs: 'ELEVENLABS_API_KEY', gemini: 'GEMINI_API_KEY' };

export const missingKey = (provider) =>
  new ApiError(
    `${PROVIDER_LABELS[provider] || provider} API key is not configured. Add ` +
      `${PROVIDER_ENV_VARS[provider] || 'the API key'} to your .env file and restart the server.`,
    { status: 401, code: 'missing_api_key', provider }
  );

/**
 * Translates a provider HTTP status into a message a user can act on.
 */
export const fromProviderResponse = (provider, status, body) => {
  const detail =
    (body && (body.detail?.message || body.detail || body.error?.message || body.message)) || '';
  const raw = typeof detail === 'string' ? detail : JSON.stringify(detail);

  // Providers are inconsistent about trailing punctuation; normalise it so the
  // sentence we append does not run into theirs.
  const detailText = raw.trim() ? raw.trim().replace(/[.!?]*$/, '.') : '';

  if (status === 401 || status === 403) {
    /*
     * A gateway answers 401 for two very different situations: the credential
     * is wrong, or the credential is fine but not entitled to the model asked
     * for. Conflating them is costly — a bad key should abort immediately, but
     * a model restriction should simply move to the next candidate model.
     *
     * LiteLLM restricts by key AND by user, with a distinct `type` for each
     * ("key_model_access_denied" / "user_model_access_denied"), and helpfully
     * enumerates the models the credential *can* reach.
     */
    const type = body?.error?.type || body?.type || '';
    const modelScoped =
      /_model_access_denied$/.test(type) ||
      /not allowed to access model|can only access models/i.test(raw);

    if (modelScoped) {
      // "This key can only access models=['a', 'b']" — worth surfacing verbatim.
      const allowed = /models\s*=\s*\[([^\]]*)\]/i.exec(raw)?.[1];
      const permitted = allowed
        ? allowed
            .split(',')
            .map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : [];

      return new ApiError(detailText || `${provider} did not permit this model.`, {
        status: 403,
        code: 'model_not_permitted',
        provider,
        details: permitted.length ? { permitted } : detailText || null,
      });
    }

    return new ApiError(
      `${provider} rejected this API key (${status})${detailText ? `: ${detailText}` : '.'} ` +
        'Check that the key is correct and has access to this feature.',
      { status: 401, code: 'invalid_api_key', provider, details: detailText || null }
    );
  }

  if (status === 429) {
    return new ApiError(
      `${provider} rate limit reached. Wait a moment and retry.${detailText ? ` — ${detailText}` : ''}`,
      { status: 429, code: 'rate_limited', provider, retryable: true, details: detailText || null }
    );
  }

  if (status === 413) {
    return new ApiError(`${provider} rejected the upload as too large.`, {
      status: 413,
      code: 'payload_too_large',
      provider,
    });
  }

  if (status >= 500) {
    return new ApiError(
      `${provider} service error (${status}). This is usually temporary.${detailText ? ` — ${detailText}` : ''}`,
      { status: 502, code: 'provider_unavailable', provider, retryable: true, details: detailText || null }
    );
  }

  return new ApiError(
    `${provider} request failed (${status})${detailText ? `: ${detailText}` : '.'}`,
    { status: status >= 400 && status < 500 ? status : 502, code: 'provider_error', provider, details: detailText || null }
  );
};
