/**
 * Instant, offline identification of what has been pasted.
 *
 * Key prefixes are the providers' own convention and they are stable, which is
 * why a credential can be identified the moment it lands in the field — no
 * round trip, no waiting. The network probe then confirms it works; this says
 * what it *is*.
 */

export type ProviderId =
  | 'studio'
  | 'gateway'
  | 'elevenlabs'
  | 'openai'
  | 'anthropic'
  | 'huggingface'
  | 'vertex'
  | 'unknown';

export interface ProviderGuess {
  id: ProviderId;
  /** What to show as the provider name. */
  label: string;
  /** How it was recognised, e.g. "sk-… key". */
  hint: string;
}

/**
 * Identifies the issuer of a key from its prefix.
 *
 * With no key but a base URL present, the endpoint itself is the answer — the
 * common case for a local gateway that needs no token at all.
 */
export const detectProvider = (key?: string, baseUrl?: string): ProviderGuess | null => {
  const value = (key || '').trim();

  if (!value) {
    if ((baseUrl || '').trim()) {
      return { id: 'gateway', label: 'OpenAI-compatible endpoint', hint: 'from the URL — no key' };
    }
    return null;
  }

  if (value.startsWith('AIza')) return { id: 'studio', label: 'Google AI Studio', hint: 'AIza… key' };
  if (value.startsWith('sk_')) return { id: 'elevenlabs', label: 'ElevenLabs', hint: 'sk_… key' };
  if (value.startsWith('sk-ant-')) return { id: 'anthropic', label: 'Anthropic', hint: 'sk-ant-… key' };
  if (value.startsWith('sk-proj-')) return { id: 'openai', label: 'OpenAI', hint: 'sk-proj-… key' };
  if (value.startsWith('sk-')) return { id: 'gateway', label: 'OpenAI-compatible', hint: 'sk-… key' };
  if (value.startsWith('hf_')) return { id: 'huggingface', label: 'Hugging Face', hint: 'hf_… token' };
  if (value.startsWith('ya29.')) return { id: 'vertex', label: 'Google OAuth token', hint: 'ya29.… token' };

  return { id: 'unknown', label: 'Unrecognised', hint: `${value.length} characters` };
};

/**
 * Names the family a model belongs to.
 *
 * A gateway is generic, so its model name is the only thing that says which
 * family is actually being called through it.
 */
export const detectModelFamily = (name?: string): string | null => {
  const id = (name || '').trim().toLowerCase().replace(/^models\//, '').replace(/^[a-z_]+\//, '');
  if (!id) return null;

  if (id.startsWith('gemini')) return 'Google Gemini';
  if (id.startsWith('gpt')) return 'OpenAI GPT';
  if (/^o\d/.test(id)) return 'OpenAI reasoning';
  if (id.startsWith('claude')) return 'Anthropic Claude';
  if (id.startsWith('llama')) return 'Meta Llama';
  if (id.startsWith('mistral') || id.startsWith('mixtral')) return 'Mistral';
  if (id.startsWith('qwen')) return 'Qwen';
  if (id.startsWith('deepseek')) return 'DeepSeek';
  if (id.startsWith('scribe')) return 'ElevenLabs Scribe';

  return null;
};

/** Shows enough of a key to recognise it, never enough to use it. */
export const maskKey = (key?: string): string => {
  const value = (key || '').trim();
  if (!value) return '';
  if (value.length <= 10) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

/** Every outcome a credential check can land on. */
export type ProbeStatus =
  | 'ok'
  | 'checking'
  | 'invalid_key'
  | 'not_found'
  | 'model_missing'
  | 'rate_limited'
  | 'provider_down'
  | 'unverified'
  | 'missing';

/** The one-word badge and its colour, per status. */
export const PROBE_WORDS: Record<ProbeStatus, { word: string; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  ok: { word: 'Working', tone: 'ok' },
  checking: { word: 'Checking', tone: 'muted' },
  invalid_key: { word: 'Key rejected', tone: 'error' },
  not_found: { word: 'Wrong URL', tone: 'error' },
  model_missing: { word: 'Model missing', tone: 'warn' },
  rate_limited: { word: 'Rate limited', tone: 'warn' },
  provider_down: { word: 'Provider down', tone: 'error' },
  unverified: { word: 'Unverified', tone: 'muted' },
  missing: { word: 'Not set', tone: 'muted' },
};
