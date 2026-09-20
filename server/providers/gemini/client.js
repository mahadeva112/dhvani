import { GoogleGenAI } from '@google/genai';
import { config, resolveKey } from '../../env.js';
import { ApiError, missingKey } from '../../errors.js';
import { logger } from '../../logger.js';

export const PROVIDER_LABEL = 'Gemini';

export const hasGeminiKey = () => Boolean(config.gemini.apiKey);

/**
 * Builds a client for the Gemini API.
 *
 * This talks to the public `generativelanguage` endpoint directly — there is no
 * AI Studio project, workspace or platform binding involved. A base URL set in
 * the settings screen points the same API shape at a proxy or regional host
 * instead; `overrideBaseUrl` is for checking a candidate one before it is saved.
 */
export const geminiClient = (overrideKey, overrideBaseUrl) => {
  const apiKey = resolveKey(config.gemini.apiKey, overrideKey);
  if (!apiKey) throw missingKey('gemini');

  const baseUrl = String(overrideBaseUrl ?? config.gemini.baseUrl ?? '').trim().replace(/\/+$/, '');
  return new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
};

const RETRYABLE = /(429|RESOURCE_EXHAUSTED|500|503|INTERNAL|UNAVAILABLE|deadline|ETIMEDOUT|fetch failed)/i;
const FATAL_KEY = /(401|403|PERMISSION_DENIED|API key not valid|API_KEY_INVALID)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pulls the human-readable sentence out of a Gemini error.
 *
 * The SDK stringifies the whole error envelope, which is several hundred
 * characters of nested JSON — useless in a dialog box.
 */
const readableGeminiError = (message) => {
  const raw = String(message || '').trim();

  const jsonStart = raw.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const detail = parsed?.error?.message || parsed?.message;
      if (detail) return String(detail);
    } catch {
      // Not parseable — fall through to the trimmed raw text.
    }
  }

  return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw;
};

/**
 * Runs generateContent against each candidate model until one succeeds.
 *
 * A model that is missing or gated for the key falls through to the next
 * candidate; an invalid key stops immediately rather than retrying four times.
 */
export const generateContent = async (
  { contents, generationConfig = {}, models, apiKey, baseUrl, retriesPerModel = 1 } = {}
) => {
  const client = geminiClient(apiKey, baseUrl);
  const candidates = models?.length ? models : config.gemini.translationModels;
  let lastError = null;

  for (const model of candidates) {
    for (let attempt = 0; attempt <= retriesPerModel; attempt += 1) {
      try {
        const response = await client.models.generateContent({
          model,
          contents,
          config: generationConfig,
        });
        return { response, modelUsed: model };
      } catch (err) {
        const message = err?.message || String(err);
        lastError = err;

        if (FATAL_KEY.test(message)) {
          throw new ApiError(`Gemini rejected this API key: ${readableGeminiError(message)}`, {
            status: 401,
            code: 'invalid_api_key',
            provider: 'gemini',
          });
        }

        if (RETRYABLE.test(message) && attempt < retriesPerModel) {
          const delay = 1200 * 2 ** attempt;
          logger.warn(`Gemini model ${model} attempt ${attempt + 1} failed; retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }

        logger.warn(`Gemini model ${model} unavailable (${message.slice(0, 160)}); trying next candidate`);
        break;
      }
    }
  }

  const message = readableGeminiError(lastError?.message || 'unknown error');

  if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
    throw new ApiError(
      `Gemini quota exhausted: ${message} Wait for your quota to reset, or lower ` +
        'TRANSLATION_BATCH_SIZE to send fewer requests.',
      { status: 429, code: 'rate_limited', provider: 'gemini', retryable: true }
    );
  }

  throw new ApiError(
    `All Gemini models failed (${candidates.join(', ')}). Last error: ${message}`,
    { status: 502, code: 'provider_unavailable', provider: 'gemini', retryable: true }
  );
};

/** Parses a JSON response, tolerating markdown fences the model sometimes adds. */
export const parseJsonResponse = (text, context = 'Gemini') => {
  const raw = String(text || '').trim();
  if (!raw) throw new ApiError(`${context} returned an empty response.`, { status: 502, provider: 'gemini' });

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
    throw new ApiError(`${context} returned malformed JSON.`, {
      status: 502,
      code: 'bad_model_output',
      provider: 'gemini',
      retryable: true,
      details: cleaned.slice(0, 400),
    });
  }
};
