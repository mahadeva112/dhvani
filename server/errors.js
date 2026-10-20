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

const PROVIDER_LABELS = { elevenlabs: 'ElevenLabs', gemini: 'Gemini', cartesia: 'Cartesia' };
const PROVIDER_ENV_VARS = { elevenlabs: 'ELEVENLABS_API_KEY', gemini: 'GEMINI_API_KEY', cartesia: 'CARTESIA_API_KEY' };

export const missingKey = (provider) =>
  new ApiError(
    `${PROVIDER_LABELS[provider] || provider} API key is not configured. Add it in API settings, or set ` +
      `${PROVIDER_ENV_VARS[provider] || 'the API key'} in your .env file and restart the server.`,
    { status: 401, code: 'missing_api_key', provider }
  );

/**
 * A proxy in front of a provider (Cloudflare, nginx, a hosting panel) answers
 * an outage with a whole HTML page. Its <title> is the only useful part —
 * "example.com | 502: Bad gateway" — so keep that and drop the markup.
 */
export const plainDetail = (text) => {
  if (typeof text !== 'string') return text;
  if (!/<(!doctype|html|head|body|title)\b/i.test(text)) return text;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const words = (title || text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>?/g, ' '))
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return title ? `The server answered with an error page: "${words.slice(0, 160)}"` : words.slice(0, 200);
};

const UPSTREAM_NAMES = {
  gemini: 'Google',
  vertexai: 'Google Vertex AI',
  vertex_ai: 'Google Vertex AI',
  openai: 'OpenAI',
  azure: 'Azure',
  anthropic: 'Anthropic',
  bedrock: 'AWS Bedrock',
};

/**
 * LiteLLM relays the upstream provider's refusal of the gateway's OWN key as
 * "litellm.AuthenticationError: GeminiException - API key not valid", with a
 * 401 — the same status it uses when YOUR key is wrong. Read as a bad user key,
 * it sends people re-pasting a key that works; the fix is on the gateway.
 *
 * Returns who refused and for which model group, or null when it is not that.
 */
export const upstreamKeyFailure = (text) => {
  const raw = typeof text === 'string' ? text : '';
  const wrapped = /litellm\.AuthenticationError:\s*(\w+?)Exception\b/i.exec(raw);
  if (!wrapped) return null;

  const name = wrapped[1];
  return {
    provider: UPSTREAM_NAMES[name.toLowerCase()] || name,
    model: /Received Model Group=([^\s,]+)/i.exec(raw)?.[1] || null,
  };
};

/**
 * Translates a provider HTTP status into a message a user can act on.
 */
export const fromProviderResponse = (provider, status, body) => {
  const detail =
    (body && (body.detail?.message || body.detail || body.error?.message || body.message)) || '';
  const raw = plainDetail(typeof detail === 'string' ? detail : JSON.stringify(detail));

  // Providers are inconsistent about trailing punctuation; normalise it so the
  // sentence we append does not run into theirs.
  const detailText = raw.trim() ? raw.trim().replace(/[.!?]*$/, '.') : '';

  /*
   * ElevenLabs keeps the better output formats (WAV 44.1/48 kHz, MP3 192 kbps)
   * for higher plans and refuses the request before voicing anything, so the
   * app can ask again in a format the plan allows.
   */
  const detailStatus = typeof body?.detail?.status === 'string' ? body.detail.status : '';
  if (status >= 400 && status < 500 && (/output_format/i.test(detailStatus) || /output[_ ]format/i.test(raw))) {
    return new ApiError(detailText || `${provider} did not allow this output format.`, {
      status: 403,
      code: 'output_format_not_allowed',
      provider,
      details: detailText || null,
    });
  }

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

    const upstream = upstreamKeyFailure(raw);
    if (upstream) {
      return new ApiError(
        `Your key is fine, but ${upstream.provider} rejected the key the gateway itself uses` +
          `${upstream.model ? ` for "${upstream.model}"` : ''}. ` +
          'The gateway admin has to replace it. Until then, pick another model.',
        {
          status: 502,
          code: 'upstream_key_invalid',
          provider,
          details: { upstream: upstream.provider, model: upstream.model, raw: detailText || null },
        }
      );
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
