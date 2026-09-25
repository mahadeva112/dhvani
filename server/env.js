import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { isLocalGateway } from './providers/llmGateway/url.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');

// Load `.env` first, then let `.env.local` override it (Vite convention).
for (const file of ['.env', '.env.local']) {
  const full = path.join(ROOT_DIR, file);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: file === '.env.local' });
}

const str = (name, fallback = '') => {
  const raw = process.env[name];
  return raw === undefined || raw === null || raw === '' ? fallback : String(raw).trim();
};

const num = (name, fallback) => {
  const parsed = Number(str(name, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const bool = (name, fallback) => {
  const raw = str(name, '').toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
};

const list = (name, fallback) => {
  const raw = str(name, '');
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
};

/** Read the app version from package.json so /api/health can report it. */
const readVersion = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
};

/**
 * Where settings saved from the UI live.
 *
 * The desktop build passes DHVANI_CONFIG_DIR (Electron's userData folder). A
 * plain install falls back to the OS config directory, so keys are never
 * written inside the app folder where they could be zipped up and shared.
 */
const resolveConfigDir = () => {
  const explicit = str('DHVANI_CONFIG_DIR');
  if (explicit) return explicit;

  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'dhvani');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'dhvani');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dhvani');
};

export const CONFIG_DIR = resolveConfigDir();
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** Settings saved through the UI. Loaded at boot, updated by the settings route. */
const loadStoredConfig = () => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
};

let stored = loadStoredConfig();

/* -------------------------------------------------------------------------
 * Precedence: what the user saved in the app wins over the environment.
 *
 * DHVANI is installed per person, and each person has their own keys, their
 * own gateway host and often their own model names. If `.env` won, the copy
 * of the app they were handed would keep running on whoever's keys shipped
 * inside it, and the settings screen could only tell them so — it could not
 * let them fix it. So the environment is the *fallback*: it seeds a fresh
 * install (and keeps Docker and CI deployments working with no config file),
 * and anything saved from the settings screen takes over from there.
 *
 * Operators who genuinely need the environment to be final set
 * ALLOW_KEY_SETUP=false, which refuses UI writes outright.
 * ---------------------------------------------------------------------- */

/** A saved scalar, trimmed; '' when nothing is saved for this field. */
const savedStr = (field) => {
  const raw = stored[field];
  return raw === undefined || raw === null ? '' : String(raw).trim();
};

/** A saved list, accepting either an array or a comma-separated string. */
const savedList = (field) => {
  const raw = stored[field];
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return items.map((item) => String(item).trim()).filter(Boolean);
};

/** Saved value, else environment variable, else built-in default. */
const setting = (field, name, fallback = '') => savedStr(field) || str(name, fallback);

/** The list form of `setting`. */
const settingList = (field, name, fallback) => {
  const saved = savedList(field);
  return saved.length > 0 ? saved : list(name, fallback);
};

/** Where a setting's live value came from, for the settings screen to show. */
const originOf = (field, name) => (savedStr(field) ? 'saved' : str(name) ? 'env' : 'default');

/**
 * Trims a base URL and, for a bare origin, appends the API version path.
 *
 * People paste `https://api.elevenlabs.io` as readily as the full `/v1` form.
 * Appending the default path only when no path was typed keeps the shorthand
 * working without rewriting a proxy that is deliberately mounted elsewhere.
 */
const normalizeBaseUrl = (value, defaultPath = '') => {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw || !defaultPath) return raw;
  try {
    const { pathname } = new URL(raw);
    return pathname === '/' || pathname === '' ? `${raw}${defaultPath}` : raw;
  } catch {
    // Not a parseable URL — the connection check will report it; pass it through.
    return raw;
  }
};

export const config = {
  version: readVersion(),
  isProduction: str('NODE_ENV', 'development') === 'production',
  isDesktop: bool('DHVANI_DESKTOP', false),

  port: num('PORT', 8787),
  clientPort: num('CLIENT_PORT', 3000),
  host: str('HOST', '127.0.0.1'),
  corsOrigins: list('CORS_ORIGIN', [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:4173',
  ]),
  maxUploadBytes: num('MAX_UPLOAD_MB', 1024) * 1024 * 1024,
  extractAudioFromVideo: bool('EXTRACT_AUDIO_FROM_VIDEO', true),
  translationBatchSize: num('TRANSLATION_BATCH_SIZE', 40),

  /**
   * Lets the UI save settings to the local config file. Only ever honoured for
   * requests arriving from loopback; set false to disable it outright, which
   * also makes the environment the last word on every value below.
   */
  allowKeySetup: bool('ALLOW_KEY_SETUP', true),

  /** Requests per minute per IP. Guards against a runaway client loop. */
  rateLimitPerMinute: num('RATE_LIMIT_PER_MINUTE', 120),

  elevenlabs: {
    get apiKey() {
      return setting('elevenLabsApiKey', 'ELEVENLABS_API_KEY');
    },
    get baseUrl() {
      return normalizeBaseUrl(
        setting('elevenLabsBaseUrl', 'ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io/v1'),
        '/v1'
      );
    },
    get sttModel() {
      return setting('elevenLabsSttModel', 'ELEVENLABS_STT_MODEL', 'scribe_v1');
    },
    get ttsModel() {
      return setting('elevenLabsTtsModel', 'ELEVENLABS_TTS_MODEL', 'eleven_v3');
    },
  },

  gemini: {
    get apiKey() {
      return setting('geminiApiKey', 'GEMINI_API_KEY');
    },
    /**
     * An alternative host for Google's own API shape — a corporate proxy or a
     * regional endpoint. Blank means talk to generativelanguage.googleapis.com.
     * This is not the gateway slot below: it still speaks the Gemini API.
     */
    get baseUrl() {
      return normalizeBaseUrl(setting('geminiBaseUrl', 'GEMINI_BASE_URL'));
    },
    get translationModels() {
      return settingList('geminiTranslationModels', 'GEMINI_TRANSLATION_MODELS', [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
      ]);
    },
    get ttsModel() {
      return setting('geminiTtsModel', 'GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts');
    },
  },

  /**
   * A self-hosted LLM gateway used for translation instead of calling Google
   * directly. Once configured it takes over the translation provider slot;
   * ElevenLabs transcription is untouched either way, so subtitle timing is
   * identical whichever translator runs.
   */
  llmGateway: {
    get url() {
      return setting('llmGatewayUrl', 'LLM_GATEWAY_URL');
    },
    get apiKey() {
      return setting('llmGatewayKey', 'LLM_GATEWAY_KEY');
    },
    get protocol() {
      const value = setting('llmGatewayProtocol', 'LLM_GATEWAY_PROTOCOL', 'openai').toLowerCase();
      return value === 'gemini' ? 'gemini' : 'openai';
    },
    /**
     * Output budget for gateway calls.
     *
     * Reasoning models spend tokens thinking before emitting any text, so a
     * small gateway default can return nothing at all. Generous by design;
     * translation output is small, and unused budget costs nothing.
     */
    maxOutputTokens: num('LLM_GATEWAY_MAX_TOKENS', 8192),

    get models() {
      return settingList('llmGatewayModels', 'LLM_GATEWAY_MODELS', ['gemini-2.5-flash']);
    },
  },
};

/**
 * Whether a gateway URL and key pair is usable.
 *
 * A local gateway counts as configured with no bearer token at all — local
 * LiteLLM and vLLM deployments commonly run without auth, and requiring a key
 * would leave a working gateway sitting inactive.
 *
 * Exported as a pure function so it can be tested without depending on what
 * happens to be saved on the machine running the tests.
 */
export const isGatewayUsable = (url, apiKey) => {
  if (!url) return false;
  return Boolean(apiKey) || isLocalGateway(url);
};

/** True when translation should go through the gateway rather than Google. */
export const gatewayEnabled = () =>
  isGatewayUsable(config.llmGateway.url, config.llmGateway.apiKey);

/**
 * Merges a per-request gateway override over the configured values.
 *
 * Used by the connection test so a candidate URL and key can be exercised
 * without mutating shared config, which would race against in-flight requests.
 */
export const resolveGateway = (override = {}) => ({
  url: (override.url ?? config.llmGateway.url ?? '').trim().replace(/\/+$/, ''),
  apiKey: override.apiKey ?? config.llmGateway.apiKey ?? '',
  protocol: (override.protocol ?? config.llmGateway.protocol) === 'gemini' ? 'gemini' : 'openai',
  models:
    override.models?.length > 0
      ? override.models
      : config.llmGateway.models,
});


/**
 * Where each credential's live value comes from.
 *
 * 'saved' means it was entered in the app, 'env' that it is still coming from
 * the environment and nothing has replaced it yet. Both are editable — saving
 * simply takes over — so this drives a hint, not a read-only state.
 *
 * The gateway entry reports the URL's origin rather than the key's, because a
 * local gateway is legitimately keyless: reporting 'none' there would make the
 * setup screen offer to configure something already working.
 */
export const keySource = () => ({
  elevenLabs: savedStr('elevenLabsApiKey') ? 'saved' : str('ELEVENLABS_API_KEY') ? 'env' : 'none',
  gemini: savedStr('geminiApiKey') ? 'saved' : str('GEMINI_API_KEY') ? 'env' : 'none',
  gateway: !gatewayEnabled() ? 'none' : savedStr('llmGatewayUrl') ? 'saved' : 'env',
});

/**
 * The endpoints and model names in force, with where each one came from.
 *
 * These are not secrets, so unlike the keys they are sent back to the settings
 * screen in full and its fields open pre-filled with what is actually running.
 */
export const serverSettings = () => ({
  values: {
    elevenLabsBaseUrl: config.elevenlabs.baseUrl,
    elevenLabsSttModel: config.elevenlabs.sttModel,
    elevenLabsTtsModel: config.elevenlabs.ttsModel,
    geminiBaseUrl: config.gemini.baseUrl,
    geminiTranslationModels: config.gemini.translationModels,
    geminiTtsModel: config.gemini.ttsModel,
  },
  origins: {
    elevenLabsBaseUrl: originOf('elevenLabsBaseUrl', 'ELEVENLABS_BASE_URL'),
    elevenLabsSttModel: originOf('elevenLabsSttModel', 'ELEVENLABS_STT_MODEL'),
    elevenLabsTtsModel: originOf('elevenLabsTtsModel', 'ELEVENLABS_TTS_MODEL'),
    geminiBaseUrl: originOf('geminiBaseUrl', 'GEMINI_BASE_URL'),
    geminiTranslationModels:
      savedList('geminiTranslationModels').length > 0
        ? 'saved'
        : str('GEMINI_TRANSLATION_MODELS')
          ? 'env'
          : 'default',
    geminiTtsModel: originOf('geminiTtsModel', 'GEMINI_TTS_MODEL'),
  },
});

/** What the translation side is currently set up to use. */
export const translationSetup = () => ({
  mode: gatewayEnabled() ? 'gateway' : config.gemini.apiKey ? 'google' : 'none',
  gatewayUrl: config.llmGateway.url || null,
  gatewayProtocol: config.llmGateway.protocol,
  /*
   * Whether a bearer token is actually stored, as distinct from whether the
   * gateway is configured — a local gateway is legitimately keyless, and the
   * settings screen must not claim a key is saved when none is.
   */
  gatewayHasKey: Boolean(config.llmGateway.apiKey),
  models: gatewayEnabled() ? config.llmGateway.models : config.gemini.translationModels,
});

/**
 * Secrets the settings form cannot display, so its fields open blank.
 *
 * For these a blank submission means "leave it alone": treating it as a clear
 * meant that changing a gateway URL without retyping the bearer token silently
 * wiped the token. Every other field is shown pre-filled with its live value,
 * so emptying one is a deliberate reset and does clear it.
 */
const SECRET_FIELDS = new Set(['elevenLabsApiKey', 'geminiApiKey', 'llmGatewayKey']);

const TEXT_FIELDS = [
  'elevenLabsApiKey',
  'elevenLabsBaseUrl',
  'elevenLabsSttModel',
  'elevenLabsTtsModel',
  'geminiApiKey',
  'geminiBaseUrl',
  'geminiTtsModel',
  'llmGatewayKey',
  'llmGatewayUrl',
  'llmGatewayProtocol',
];

const LIST_FIELDS = ['geminiTranslationModels', 'llmGatewayModels'];

/**
 * Persists settings supplied through the setup screen, with owner-only file
 * permissions where the platform supports them.
 *
 * Clearing a field — `null`, or an empty string for anything but a secret —
 * removes it from the file, so the value falls back to the environment or the
 * built-in default rather than being pinned to an empty string.
 */
export const saveStoredKeys = async (updates) => {
  const next = { ...stored };

  for (const field of TEXT_FIELDS) {
    const value = updates[field];
    if (value === undefined) continue;

    if (value === null) {
      delete next[field];
      continue;
    }

    const trimmed = String(value).trim();
    if (trimmed) next[field] = trimmed;
    else if (!SECRET_FIELDS.has(field)) delete next[field];
  }

  for (const field of LIST_FIELDS) {
    const value = updates[field];
    if (value === undefined) continue;

    if (value === null) {
      delete next[field];
      continue;
    }

    const models = (Array.isArray(value) ? value : String(value).split(','))
      .map((model) => String(model).trim())
      .filter(Boolean);

    if (models.length > 0) next[field] = models;
    else delete next[field];
  }

  await fs.promises.mkdir(CONFIG_DIR, { recursive: true });
  await fs.promises.writeFile(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });

  // Re-apply the mode explicitly: writeFile only honours `mode` when creating.
  await fs.promises.chmod(CONFIG_FILE, 0o600).catch(() => {});

  stored = next;
  return keySource();
};

/** Every field the settings screen owns, for the "forget everything" route. */
export const STORED_FIELDS = [...TEXT_FIELDS, ...LIST_FIELDS];

/**
 * Resolves the key to use for a request.
 *
 * The configured key — saved in the app, or from the environment when nothing
 * is saved — always wins. A caller-supplied key is honoured only as an
 * explicit override, so it can never become the app's default credential.
 */
export const resolveKey = (configuredKey, overrideKey) => {
  const override = (overrideKey || '').trim();
  const configured = (configuredKey || '').trim();
  if (configured) return configured;
  if (override && override !== SERVER_MANAGED_KEY) return override;
  return '';
};

/** Sentinel the frontend shows in place of a real key held by the backend. */
export const SERVER_MANAGED_KEY = '__server_managed_key__';
