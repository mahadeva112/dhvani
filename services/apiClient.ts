/**
 * Single entry point for every backend call.
 *
 * The browser never talks to ElevenLabs or Gemini directly any more — API keys
 * live only in the backend, saved from the settings screen or seeded from its
 * environment. A key typed into a per-job field is forwarded as an explicit
 * per-request override header and is never required for the app to work.
 */

const API_BASE = '/api';

/** Placeholder shown in the UI when the backend holds the key. */
export const SERVER_MANAGED_KEY = '__server_managed_key__';

export const isServerManagedKey = (key?: string | null): boolean =>
  !key || key === SERVER_MANAGED_KEY;

export class DhvaniApiError extends Error {
  code: string;
  status: number;
  provider: string | null;
  retryable: boolean;
  details: unknown;

  constructor(
    message: string,
    options: { code?: string; status?: number; provider?: string | null; retryable?: boolean; details?: unknown } = {}
  ) {
    super(message);
    this.name = 'DhvaniApiError';
    this.code = options.code || 'unknown_error';
    this.status = options.status ?? 0;
    this.provider = options.provider ?? null;
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? null;
  }
}

/** Builds the optional per-request key override headers. */
const keyHeaders = (keys?: { elevenLabsKey?: string; geminiKey?: string }): Record<string, string> => {
  const headers: Record<string, string> = {};
  if (keys?.elevenLabsKey && !isServerManagedKey(keys.elevenLabsKey)) {
    headers['x-elevenlabs-key'] = keys.elevenLabsKey.trim();
  }
  if (keys?.geminiKey && !isServerManagedKey(keys.geminiKey)) {
    headers['x-gemini-key'] = keys.geminiKey.trim();
  }
  return headers;
};

const toApiError = async (response: Response): Promise<DhvaniApiError> => {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error body (proxy timeout, crash page) — fall through.
  }

  const error = payload?.error;
  if (error?.message) {
    return new DhvaniApiError(error.message, {
      code: error.code,
      status: response.status,
      provider: error.provider,
      retryable: error.retryable,
      details: error.details,
    });
  }

  if (response.status === 502 || response.status === 504) {
    return new DhvaniApiError(
      'The local DHVANI backend is not responding. Make sure it is running (npm run dev) and try again.',
      { code: 'backend_unreachable', status: response.status }
    );
  }

  return new DhvaniApiError(`Request failed with status ${response.status}.`, {
    code: 'http_error',
    status: response.status,
  });
};

const withNetworkGuard = async <T>(action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (err: any) {
    if (err instanceof DhvaniApiError) throw err;
    throw new DhvaniApiError(
      `Could not reach the local DHVANI backend: ${err?.message || 'network error'}. ` +
        'Check that the server is running on the configured port.',
      { code: 'backend_unreachable' }
    );
  }
};

export interface RequestOptions {
  keys?: { elevenLabsKey?: string; geminiKey?: string };
  signal?: AbortSignal;
}

/** JSON request returning parsed JSON. */
export const apiJson = async <T = any>(
  path: string,
  { method = 'POST', body, keys, signal }: RequestOptions & { method?: string; body?: unknown } = {}
): Promise<T> =>
  withNetworkGuard(async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...keyHeaders(keys),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
    });

    if (!response.ok) throw await toApiError(response);
    return response.json() as Promise<T>;
  });

/** GET helper. */
export const apiGet = <T = any>(path: string, options: RequestOptions = {}): Promise<T> =>
  apiJson<T>(path, { ...options, method: 'GET' });

/** Multipart POST returning parsed JSON. */
export const apiUpload = async <T = any>(
  path: string,
  formData: FormData,
  { keys, signal }: RequestOptions = {}
): Promise<T> =>
  withNetworkGuard(async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: keyHeaders(keys),
      body: formData,
      signal,
    });

    if (!response.ok) throw await toApiError(response);
    return response.json() as Promise<T>;
  });

/** POST returning binary audio as a Blob. */
export const apiAudio = async (
  path: string,
  body: unknown,
  { keys, signal }: RequestOptions = {}
): Promise<Blob> =>
  withNetworkGuard(async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeaders(keys) },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) throw await toApiError(response);
    return response.blob();
  });

/** Multipart POST returning binary audio as a Blob. */
export const apiAudioUpload = async (
  path: string,
  formData: FormData,
  { keys, signal }: RequestOptions = {}
): Promise<Blob> =>
  withNetworkGuard(async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: keyHeaders(keys),
      body: formData,
      signal,
    });

    if (!response.ok) throw await toApiError(response);
    return response.blob();
  });

export interface StreamEvent {
  type: 'progress' | 'result' | 'error';
  [key: string]: any;
}

/**
 * Consumes a newline-delimited JSON stream, invoking `onEvent` per line and
 * resolving with the terminal `result` event.
 *
 * Streaming is what lets a ten-minute transcription report real progress rather
 * than sitting on an indeterminate spinner.
 */
export const apiStream = async <T = any>(
  path: string,
  formData: FormData,
  {
    keys,
    signal,
    onEvent,
  }: RequestOptions & { onEvent?: (event: StreamEvent) => void } = {}
): Promise<T> =>
  withNetworkGuard(async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: keyHeaders(keys),
      body: formData,
      signal,
    });

    if (!response.ok) throw await toApiError(response);
    if (!response.body) {
      throw new DhvaniApiError('The backend returned an empty response stream.', {
        code: 'empty_stream',
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = '';
    let result: T | null = null;
    let streamError: DhvaniApiError | null = null;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let event: StreamEvent;
      try {
        event = JSON.parse(trimmed);
      } catch {
        return; // Ignore a partial or malformed line rather than failing the run.
      }

      if (event.type === 'result') {
        result = event as unknown as T;
      } else if (event.type === 'error') {
        streamError = new DhvaniApiError(event.message || 'The pipeline failed.', {
          code: event.code,
          provider: event.provider,
          retryable: event.retryable,
          details: event.details,
        });
      } else {
        onEvent?.(event);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    }

    handleLine(buffer);

    if (streamError) throw streamError;
    if (!result) {
      throw new DhvaniApiError('The pipeline ended without returning a result.', {
        code: 'incomplete_stream',
      });
    }

    return result;
  });

export type KeyOrigin = 'env' | 'saved' | 'none';

export interface BackendHealth {
  ok: boolean;
  version: string;
  elevenLabsConfigured: boolean;
  geminiConfigured: boolean;
  keySource: KeyOrigins;
  translation: TranslationSetup;
  ffmpegAvailable: boolean;
  maxUploadMb: number;
  sttModel: string;
  translationModels: string[];
  languages: { name: string; iso: string }[];
}

export interface KeyOrigins {
  elevenLabs: KeyOrigin;
  gemini: KeyOrigin;
  gateway: KeyOrigin;
}

/** Where translation runs, and through which models. */
export interface TranslationSetup {
  mode: 'gateway' | 'google' | 'none';
  gatewayUrl: string | null;
  gatewayProtocol: 'openai' | 'gemini';
  /** True when a bearer token is stored; a local gateway may legitimately have none. */
  gatewayHasKey: boolean;
  models: string[];
}

/** Where a setting's live value came from. */
export type SettingOrigin = 'saved' | 'env' | 'default';

/** The endpoints and model names in force, and where each one came from. */
export interface ServerSettings {
  values: {
    elevenLabsBaseUrl: string;
    elevenLabsSttModel: string;
    elevenLabsTtsModel: string;
    geminiBaseUrl: string;
    geminiTranslationModels: string[];
    geminiTtsModel: string;
  };
  origins: Record<keyof ServerSettings['values'], SettingOrigin>;
}

export interface BackendSettings {
  keys: KeyOrigins;
  /** False when running behind a proxy or with key setup disabled. */
  canSaveKeys: boolean;
  configFile: string | null;
  version: string;
  translation: TranslationSetup;
  /** Absent on an older backend, so callers must tolerate undefined. */
  server?: ServerSettings;
}

export interface SaveKeysResult {
  keys: KeyOrigins;
  validation: {
    elevenLabs: { valid: boolean; tier?: string; charactersRemaining?: number | null; error?: string } | null;
    gemini: { valid: boolean; model?: string; error?: string } | null;
    gateway: { valid: boolean; model?: string; latencyMs?: number; error?: string } | null;
  };
  saved: boolean;
  translation: TranslationSetup;
  server?: ServerSettings;
}

export interface GatewayTestResult {
  valid: boolean;
  /** The base URL that actually worked — may differ from what was typed. */
  url?: string;
  protocol?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
  note?: string;
  requiresKey?: boolean;
  availableModels: string[];
}

export interface DetectionRequest {
  mode?: 'gateway' | 'google';
  elevenLabsApiKey?: string;
  elevenLabsBaseUrl?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
  gateway?: { url?: string; apiKey?: string; protocol?: string; model?: string };
}

/**
 * Checks every credential at once, reporting each in one vocabulary.
 *
 * Values passed here are checked without being saved, so the panel can report
 * on what is currently being typed rather than only on what is stored.
 */
export const detectCredentials = <T = any>(
  body: DetectionRequest = {},
  signal?: AbortSignal
): Promise<T> => apiJson<T>('/settings/detect', { body, signal });

/**
 * Probes a candidate gateway without saving it.
 *
 * Resolves the base URL (with or without `/v1`), lists the models it exposes,
 * and sends one tiny completion to confirm the chosen model answers.
 */
export const testGatewayConnection = (
  gateway: { url: string; apiKey?: string; protocol?: string; model?: string },
  signal?: AbortSignal
): Promise<GatewayTestResult> =>
  apiJson<GatewayTestResult>('/settings/gateway/test', { body: gateway, signal });

/** Reads where the backend's keys come from and whether the UI may change them. */
export const getBackendSettings = async (): Promise<BackendSettings | null> => {
  try {
    return await apiGet<BackendSettings>('/settings');
  } catch {
    return null;
  }
};

/**
 * Validates and saves API keys to the machine's config file.
 *
 * The backend only accepts this from loopback, so keys can never be set
 * remotely. Keys that fail validation are reported but not saved.
 */
export interface SaveKeysPayload {
  elevenLabsApiKey?: string;
  elevenLabsBaseUrl?: string;
  elevenLabsSttModel?: string;
  elevenLabsTtsModel?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiTranslationModels?: string;
  geminiTtsModel?: string;
  llmGatewayUrl?: string;
  llmGatewayKey?: string;
  llmGatewayProtocol?: string;
  llmGatewayModels?: string;
}

export const saveBackendKeys = (keys: SaveKeysPayload): Promise<SaveKeysResult> =>
  apiJson<SaveKeysResult>('/settings/keys', { body: keys });

/**
 * Probes the backend. Returns null when it cannot be reached, so the UI can
 * render a clear "backend offline" state instead of throwing at startup.
 */
export const getBackendHealth = async (): Promise<BackendHealth | null> => {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) return null;
    return (await response.json()) as BackendHealth;
  } catch {
    return null;
  }
};
