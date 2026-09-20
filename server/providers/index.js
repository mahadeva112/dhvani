import { hasElevenLabsKey } from './elevenlabs/client.js';
import { hasGeminiKey } from './gemini/client.js';
import { hasGatewayConfigured } from './llmGateway/client.js';
import { transcribeFile } from './elevenlabs/transcription.js';
import { translateCueTexts } from './gemini/translation.js';
import { gatewayEnabled } from '../env.js';

/**
 * Provider registry.
 *
 * Transcription and translation are addressed through capability names rather
 * than imported directly by the pipeline, so a new backend (Whisper, Deepgram,
 * a local model, another LLM) is added by registering it here and pointing the
 * relevant `active` entry at it — no route or pipeline code changes.
 */
const registry = {
  transcription: new Map(),
  translation: new Map(),
};

export const registerProvider = (capability, name, definition) => {
  if (!registry[capability]) {
    throw new Error(`Unknown provider capability "${capability}".`);
  }
  registry[capability].set(name, { name, ...definition });
};

export const getProvider = (capability, name) => {
  const provider = registry[capability]?.get(name);
  if (!provider) {
    throw new Error(`No "${name}" provider is registered for ${capability}.`);
  }
  return provider;
};

export const listProviders = (capability) => [...(registry[capability]?.values() || [])];

/* --------------------------------------------------------------------- */
/* Built-in providers                                                     */
/* --------------------------------------------------------------------- */

registerProvider('transcription', 'elevenlabs', {
  label: 'ElevenLabs Scribe',
  /** Word-level timestamps are what make this provider the timing authority. */
  providesWordTimestamps: true,
  isConfigured: hasElevenLabsKey,
  transcribe: transcribeFile,
});

registerProvider('translation', 'gemini', {
  label: 'Google Gemini',
  isConfigured: hasGeminiKey,
  translate: translateCueTexts,
});

/*
 * The same translation logic pointed at a self-hosted gateway.
 *
 * `translateCueTexts` does not know or care which backend runs the prompt —
 * `providers/textModel.js` picks that — so this entry only changes the label
 * and the "configured" test that /api/health reports.
 */
registerProvider('translation', 'gateway', {
  label: 'Self-hosted LLM gateway',
  isConfigured: hasGatewayConfigured,
  translate: translateCueTexts,
});

/**
 * Capability defaults, overridable per request via the `provider` field.
 *
 * `translation` is a getter because the gateway can be configured at runtime
 * through the setup screen, not only at boot.
 */
export const activeProviders = {
  transcription: 'elevenlabs',
  get translation() {
    return gatewayEnabled() ? 'gateway' : 'gemini';
  },
};
