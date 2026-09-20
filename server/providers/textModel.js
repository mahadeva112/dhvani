import { gatewayEnabled } from '../env.js';
import { generateContent as geminiGenerate } from './gemini/client.js';
import { generateContent as gatewayGenerate } from './llmGateway/client.js';

/**
 * Chooses which text model backend a request should use.
 *
 * A configured gateway takes over every text task; otherwise calls go straight
 * to Google. Both expose the same `generateContent` signature, so callers never
 * branch on which one is active.
 *
 * Transcription is unaffected either way — ElevenLabs remains the sole source
 * of subtitle timing regardless of where translation runs.
 */
export const generateText = (options = {}) =>
  (gatewayEnabled() ? gatewayGenerate : geminiGenerate)(options);

/** Name of the active backend, for logs and /api/health. */
export const activeTextBackend = () => (gatewayEnabled() ? 'gateway' : 'google');
