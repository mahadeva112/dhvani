import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Key,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Radio,
  Terminal,
  Server,
  Cloud,
  Info,
  X,
} from 'lucide-react';
import {
  saveBackendKeys,
  KeyOrigins,
  SaveKeysPayload,
  SaveKeysResult,
  GatewayTestResult,
  ServerSettings,
  TranslationSetup,
} from '../services/apiClient';
import { detectCredentials } from '../services/apiClient';
import { GatewayFields, GatewayValues } from './GatewayFields';
import { DetectionCard, DetectionResult } from './DetectionCard';
import { ServerSettingsFields, ServerField } from './ServerSettingsFields';

interface SetupWizardProps {
  /** Where each credential currently comes from. */
  keySource: KeyOrigins;
  /** Called once everything is in place so the app can re-probe the backend. */
  onComplete: () => void;
  /** Lets the user dismiss and configure via environment variables instead. */
  onSkip: () => void;
  configFile: string | null;
  /**
   * 'welcome' is the first-run screen with no way out but finishing or
   * skipping. 'settings' is the same form reopened later to change things,
   * so it gets a close button and reflects what is already configured.
   */
  variant?: 'welcome' | 'settings';
  /** Where translation currently runs, shown in the settings variant. */
  translation?: TranslationSetup | null;
  /** Endpoints and model names in force, used to pre-fill the server fields. */
  server?: ServerSettings | null;
}

/** The server-settings form, flattened to strings the inputs can hold. */
type ServerValues = Record<string, string>;

/**
 * Seeds the endpoint fields from what the backend reports is running.
 *
 * Unlike the keys, none of these is a secret, so the form opens showing the
 * live configuration rather than blank boxes — what you see is what the next
 * job will use.
 */
const seedServerValues = (server?: ServerSettings | null): ServerValues => ({
  elevenLabsBaseUrl: server?.values.elevenLabsBaseUrl || '',
  elevenLabsSttModel: server?.values.elevenLabsSttModel || '',
  elevenLabsTtsModel: server?.values.elevenLabsTtsModel || '',
  geminiBaseUrl: server?.values.geminiBaseUrl || '',
  geminiTranslationModels: (server?.values.geminiTranslationModels || []).join(', '),
  geminiTtsModel: server?.values.geminiTtsModel || '',
});

type FieldState = { valid: boolean; message: string } | null;

/** Which backend handles translation. Transcription is always ElevenLabs. */
type TranslationMode = 'google' | 'gateway';

/**
 * Credential setup, used both on first run and from Advanced Settings.
 *
 * This is what makes the packaged builds usable without a terminal: values go
 * to the machine's config directory, validated before they are written.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({
  keySource,
  onComplete,
  onSkip,
  configFile,
  variant = 'welcome',
  translation = null,
  server = null,
}) => {
  const isSettings = variant === 'settings';
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');

  // Endpoints and model names, pre-filled with the running configuration.
  const [serverValues, setServerValues] = useState<ServerValues>(() => seedServerValues(server));

  /*
   * What the fields held when the form opened.
   *
   * Only fields the user actually changed are sent. Re-submitting an untouched
   * default would save it, pinning today's model name into the config file and
   * quietly opting the install out of any future change to that default.
   */
  const serverBaseline = useRef<ServerValues>(seedServerValues(server));

  const setServerValue = useCallback((key: string, value: string) => {
    setServerValues((current) => ({ ...current, [key]: value }));
  }, []);

  /** Blanks a group so it falls back to the environment or the built-in default. */
  const resetServerGroup = useCallback((keys: string[]) => {
    setServerValues((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, ''])),
    }));
  }, []);

  // Self-hosted gateway settings, validated live by GatewayFields.
  const [mode, setMode] = useState<TranslationMode>(
    translation?.mode === 'gateway' || keySource.gateway !== 'none' ? 'gateway' : 'google'
  );
  const [gateway, setGateway] = useState<GatewayValues>({
    // Reopened from settings, start from the live configuration so the user
    // edits what is running rather than a blank form. The key is never sent
    // back by the server, so it stays blank until they type a new one.
    url: translation?.gatewayUrl || '',
    apiKey: '',
    protocol: translation?.gatewayProtocol || 'openai',
    model: translation?.models?.[0] || '',
  });
  const [gatewayStatus, setGatewayStatus] = useState<GatewayTestResult | null>(null);

  // Live credential detection, mirroring what is typed rather than what is saved.
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const detectAbort = useRef<AbortController | null>(null);
  const detectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [elevenLabsState, setElevenLabsState] = useState<FieldState>(null);
  const [geminiState, setGeminiState] = useState<FieldState>(null);
  const [translationState, setTranslationState] = useState<FieldState>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  /*
   * A value still coming from the environment is a starting point, not a lock.
   *
   * DHVANI is installed per person, and the copy someone is handed may carry
   * whatever `.env` shipped with it. Saving here writes to this computer's own
   * config and takes over, so these flags drive a hint rather than a read-only
   * state — the environment is only what seeds a fresh install.
   */
  const elevenLabsFromEnv = keySource.elevenLabs === 'env';
  const geminiFromEnv = keySource.gemini === 'env';
  const gatewayFromEnv = keySource.gateway === 'env';

  const needsElevenLabs = keySource.elevenLabs === 'none';

  /*
   * The gateway is ready when its live probe succeeded. Requiring a verified
   * connection rather than just a filled-in URL means a typo cannot be saved.
   */
  const translationReady =
    mode === 'google'
      ? keySource.gemini !== 'none' || geminiKey.trim().length > 0
      : keySource.gateway !== 'none' || gatewayStatus?.valid === true;

  /** True when an endpoint or model field was edited but no key was retyped. */
  const serverValuesChanged = Object.keys(serverValues).some(
    (key) => serverValues[key].trim() !== (serverBaseline.current[key] || '').trim()
  );

  const canSubmit =
    !isSaving &&
    ((needsElevenLabs && elevenLabsKey.trim().length > 0) ||
      translationReady ||
      serverValuesChanged);

  /**
   * Re-checks every credential against what is currently in the fields.
   *
   * Blank fields fall through to whatever the backend has stored, so the panel
   * reports on the running configuration until something is actually typed.
   */
  const runDetection = useCallback(async () => {
    detectAbort.current?.abort();
    const controller = new AbortController();
    detectAbort.current = controller;
    setIsDetecting(true);

    try {
      const result = await detectCredentials<DetectionResult>(
        {
          mode,
          elevenLabsApiKey: elevenLabsKey.trim() || undefined,
          elevenLabsBaseUrl: serverValues.elevenLabsBaseUrl.trim() || undefined,
          geminiApiKey: geminiKey.trim() || undefined,
          geminiBaseUrl: serverValues.geminiBaseUrl.trim() || undefined,
          geminiModel:
            serverValues.geminiTranslationModels.split(',')[0]?.trim() || undefined,
          gateway:
            mode === 'gateway' && gateway.url.trim()
              ? {
                  url: gateway.url.trim(),
                  apiKey: gateway.apiKey.trim() || undefined,
                  protocol: gateway.protocol,
                  model: gateway.model.trim() || undefined,
                }
              : undefined,
        },
        controller.signal
      );
      if (!controller.signal.aborted) setDetection(result);
    } catch {
      // A failed check is not an error state of its own; the rows keep their
      // previous verdict and the user can hit Re-check.
    } finally {
      if (!controller.signal.aborted) setIsDetecting(false);
    }
  }, [mode, elevenLabsKey, geminiKey, gateway, serverValues]);

  // Check once on open, then whenever a field settles.
  useEffect(() => {
    if (detectTimer.current) clearTimeout(detectTimer.current);
    detectTimer.current = setTimeout(runDetection, detection ? 900 : 200);
    return () => {
      if (detectTimer.current) clearTimeout(detectTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    elevenLabsKey,
    geminiKey,
    gateway.url,
    gateway.apiKey,
    gateway.protocol,
    gateway.model,
    serverValues,
  ]);

  useEffect(
    () => () => {
      detectAbort.current?.abort();
      if (detectTimer.current) clearTimeout(detectTimer.current);
    },
    []
  );

  const handleSave = async () => {
    setIsSaving(true);
    setGeneralError(null);
    setElevenLabsState(null);
    setGeminiState(null);
    setTranslationState(null);

    try {
      const payload: SaveKeysPayload = {};
      if (elevenLabsKey.trim()) payload.elevenLabsApiKey = elevenLabsKey.trim();

      if (geminiKey.trim()) payload.geminiApiKey = geminiKey.trim();

      /*
       * Endpoints and models go up only when edited. An empty field is a
       * deliberate reset — the backend drops it and falls back to the
       * environment or the built-in default — which is why an untouched field
       * must not be sent: a blank one that was never filled would clear a
       * setting the user never looked at.
       */
      for (const [key, value] of Object.entries(serverValues)) {
        if (value.trim() === (serverBaseline.current[key] || '').trim()) continue;
        payload[key as keyof SaveKeysPayload] = value.trim();
      }

      if (mode === 'gateway' && gateway.url.trim()) {
        // Save what discovery resolved, falling back to what was typed.
        payload.llmGatewayUrl = gatewayStatus?.url || gateway.url.trim();
        payload.llmGatewayProtocol = gateway.protocol;
        /*
         * The field wins over the last probe result.
         *
         * Probes are debounced, so picking a model and hitting Save straight
         * away leaves `gatewayStatus` describing the PREVIOUS model — sending
         * that silently saved the old one and the choice looked ignored. The
         * server re-runs discovery on this value anyway and stores whatever
         * actually answered, so there is nothing to lose by deferring to it.
         */
        payload.llmGatewayModels = gateway.model.trim() || gatewayStatus?.model || '';

        // Only send the bearer token when one was actually typed. The field
        // starts blank because a stored secret is never sent back, so sending
        // the blank would wipe a working key.
        if (gateway.apiKey.trim()) payload.llmGatewayKey = gateway.apiKey.trim();
      }

      const result: SaveKeysResult = await saveBackendKeys(payload);

      // Re-sync to what was actually stored: a bare host comes back with its
      // /v1 path, a cleared field with the default that took its place.
      if (result.server) {
        const stored = seedServerValues(result.server);
        serverBaseline.current = stored;
        setServerValues(stored);
      }

      if (result.validation.elevenLabs) {
        const check = result.validation.elevenLabs;
        setElevenLabsState({
          valid: check.valid,
          message: check.valid
            ? `Connected${check.tier ? ` — ${check.tier} plan` : ''}${
                typeof check.charactersRemaining === 'number'
                  ? `, ${check.charactersRemaining.toLocaleString()} characters left`
                  : ''
              }`
            : check.error || 'This key was rejected by ElevenLabs.',
        });
      }

      if (result.validation.gemini) {
        const check = result.validation.gemini;
        setGeminiState({
          valid: check.valid,
          message: check.valid
            ? `Connected${check.model ? ` — ${check.model}` : ''}`
            : check.error || 'This key was rejected by Google.',
        });
      }

      const gatewayCheck = result.validation.gateway;
      if (mode === 'gateway' && gatewayCheck) {
        setTranslationState({
          valid: gatewayCheck.valid,
          message: gatewayCheck.valid
            ? `Connected — ${gatewayCheck.model || 'model ready'}${
                gatewayCheck.latencyMs ? ` (${gatewayCheck.latencyMs}ms)` : ''
              }`
            : gatewayCheck.error || 'This connection was rejected.',
        });
      }

      const elevenLabsReady = result.keys.elevenLabs !== 'none';
      const translatorReady =
        result.translation.mode === 'google' || result.translation.mode === 'gateway';

      if (elevenLabsReady && translatorReady) {
        // Let the success state land before the dialog closes.
        setTimeout(onComplete, 900);
      } else if (isSettings && result.saved) {
        // Reopened from settings, a partial save is still a real change worth
        // reflecting, even if the other half is not configured yet.
        onComplete();
      }
    } catch (err: any) {
      setGeneralError(err?.message || 'Could not save the settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClasses = (state: FieldState) =>
    `w-full bg-slate-950 border rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none font-mono transition-all ${
      state?.valid === true
        ? 'border-emerald-500/80 focus:border-emerald-400'
        : state?.valid === false
          ? 'border-rose-500/80 focus:border-rose-400'
          : 'border-slate-700 focus:border-indigo-500'
    }`;

  const renderState = (state: FieldState) =>
    state && (
      <p
        className={`text-xs flex items-start gap-1.5 leading-relaxed ${
          state.valid ? 'text-emerald-400' : 'text-rose-400'
        }`}
      >
        {state.valid ? (
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        )}
        <span>{state.message}</span>
      </p>
    );

  /*
   * Shown where a value is still coming from `.env`.
   *
   * It used to say "nothing to do here" over a disabled field, which was the
   * whole problem: a shared build carried one person's keys and no one else
   * could change them from the app. The field stays editable and this explains
   * what saving does.
   */
  const envHint = (what: string) => (
    <p className="flex items-start gap-1.5 text-[11px] text-amber-400/90 leading-relaxed">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>
        Currently using the {what} from a <span className="font-mono">.env</span> file. Saving
        here stores your own on this computer and uses that instead.
      </span>
    </p>
  );

  /** Descriptors for the folded-away endpoint and model fields. */
  const elevenLabsServerFields: ServerField[] = [
    {
      key: 'elevenLabsBaseUrl',
      label: 'API base URL',
      placeholder: 'https://api.elevenlabs.io/v1',
      hint: 'For a proxy or mirror. A bare host gets /v1 added automatically.',
      origin: server?.origins.elevenLabsBaseUrl,
    },
    {
      key: 'elevenLabsSttModel',
      label: 'Transcription model',
      placeholder: 'scribe_v1',
      hint: 'scribe_v1 or scribe_v1_experimental. This is what produces the word timings.',
      origin: server?.origins.elevenLabsSttModel,
    },
    {
      key: 'elevenLabsTtsModel',
      label: 'Voice model',
      placeholder: 'eleven_v3',
      origin: server?.origins.elevenLabsTtsModel,
    },
  ];

  const geminiServerFields: ServerField[] = [
    {
      key: 'geminiBaseUrl',
      label: 'API base URL',
      placeholder: 'https://generativelanguage.googleapis.com',
      hint: "Leave blank for Google's own endpoint; set it for a corporate or regional proxy.",
      origin: server?.origins.geminiBaseUrl,
    },
    {
      key: 'geminiTranslationModels',
      label: 'Translation models',
      placeholder: 'gemini-2.5-flash, gemini-2.0-flash',
      hint: 'Comma-separated, tried in order until one answers.',
      origin: server?.origins.geminiTranslationModels,
    },
    {
      key: 'geminiTtsModel',
      label: 'Speech model',
      placeholder: 'gemini-2.5-flash-preview-tts',
      origin: server?.origins.geminiTtsModel,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/90 backdrop-blur-md overflow-y-auto">
      {/*
       * Sized to fit a laptop screen whole: the cards sit in one row with the
       * verdict beneath, so nothing needs scrolling to be found. The header and
       * footer stay put in any case, so Save is always within reach even when
       * an expanded section does push the body past the fold.
       */}
      <div className="relative w-full max-w-lg lg:max-w-5xl xl:max-w-[88rem] my-auto max-h-[calc(100vh-2rem)] flex flex-col rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-md shadow-indigo-500/20 ring-1 ring-white/20 shrink-0">
              {isSettings ? <Key className="w-5 h-5 text-white" /> : <Radio className="w-5 h-5 text-white" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-white font-display leading-tight">
                {isSettings ? 'API & Translation Engine' : 'Welcome to DHVANI'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isSettings
                  ? 'Change your keys, or switch between Google and your own gateway.'
                  : 'Connect transcription and translation. This is a one-time setup.'}
              </p>
            </div>

            {isSettings && (
              <button
                type="button"
                onClick={onSkip}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/*
         * Body: one card per decision, side by side.
         *
         * Three columns at xl because that is what makes the whole form fit on
         * screen without scrolling — the two translation engines are
         * alternatives, so standing them next to each other is also how they
         * read best. Below xl they stack, and the gateway keeps a full row to
         * itself because its fields need the width.
         */}
        <div className="px-5 py-3.5 flex-1 overflow-y-auto">
          <div className="grid gap-3 lg:grid-cols-3">
            {/* ---------- Transcription: needed whichever engine translates ---------- */}
            <div className="space-y-2 p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800/80 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-400" />
                  ElevenLabs API key
                </label>
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                >
                  Get a key <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Transcription, the word-level timings every subtitle is built from, and voice
                synthesis.
              </p>

              <input
                type="password"
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                placeholder={
                  keySource.elevenLabs === 'saved'
                    ? 'Saved — paste a new key to replace it'
                    : elevenLabsFromEnv
                      ? 'Paste your own key to replace the one from .env'
                      : 'Paste your key here'
                }
                autoComplete="off"
                spellCheck={false}
                className={fieldClasses(elevenLabsState)}
              />
              {renderState(elevenLabsState)}
              {elevenLabsFromEnv && envHint('ElevenLabs key')}

              <ServerSettingsFields
                title="Endpoint & models"
                fields={elevenLabsServerFields}
                values={serverValues}
                onChange={setServerValue}
                onReset={() =>
                  resetServerGroup(elevenLabsServerFields.map((field) => field.key))
                }
              />
            </div>

            {/*
             * Google as a translation engine, holding the key it runs on. The
             * gateway card beside it is its alternative; both carry the same
             * eyebrow so they read as a pair.
             */}
            <div
              className={`space-y-2 p-3.5 rounded-2xl border transition-all min-w-0 ${
                mode === 'google'
                  ? 'bg-indigo-950/30 border-indigo-500/70 ring-1 ring-indigo-500/30'
                  : 'bg-slate-950/50 border-slate-800/80'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">
                  Translation engine
                </p>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                >
                  Get a key <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <button
                type="button"
                onClick={() => setMode('google')}
                aria-pressed={mode === 'google'}
                className="flex items-center gap-2 text-sm font-bold text-slate-100 cursor-pointer text-left"
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    mode === 'google' ? 'border-indigo-400' : 'border-slate-600'
                  }`}
                >
                  {mode === 'google' && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
                </span>
                <Cloud className="w-4 h-4 text-cyan-400" />
                Google Gemini
              </button>

              <p className="text-xs text-slate-400 leading-relaxed">
                Calls Google directly. This key also powers Gemini speech, script alignment and
                Indic spellcheck, whichever engine translates.
              </p>

              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={
                  keySource.gemini === 'saved'
                    ? 'Saved — paste a new key to replace it'
                    : geminiFromEnv
                      ? 'Paste your own key to replace the one from .env'
                      : 'Paste your Gemini API key'
                }
                autoComplete="off"
                spellCheck={false}
                className={fieldClasses(geminiState)}
              />
              {renderState(geminiState)}
              {geminiFromEnv && envHint('Gemini key')}

              {mode === 'google' && keySource.gemini === 'none' && !geminiKey.trim() && (
                <p className="text-[11px] text-amber-400 leading-relaxed">
                  Add the key above to translate with Google.
                </p>
              )}

              <ServerSettingsFields
                title="Endpoint & models"
                fields={geminiServerFields}
                values={serverValues}
                onChange={setServerValue}
                onReset={() => resetServerGroup(geminiServerFields.map((field) => field.key))}
              />
            </div>

            {/*
             * The self-hosted alternative, and the tallest card by some way.
             *
             * Once the cards sit side by side it takes the whole right-hand
             * column, both rows — the verdict slots in beside it rather than
             * under it, which is what stops the two key cards leaving a dead
             * strip beneath them. Its own fields stack when the column is
             * narrow, so three columns stay usable on a small laptop.
             */}
            <div
              className={`space-y-2 p-3.5 rounded-2xl border transition-all min-w-0 lg:row-span-2 ${
                mode === 'gateway'
                  ? 'bg-cyan-950/30 border-cyan-500/70 ring-1 ring-cyan-500/30'
                  : 'bg-slate-950/50 border-slate-800/80'
              }`}
            >
              <p className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">
                Translation engine
              </p>

              <button
                type="button"
                onClick={() => setMode('gateway')}
                aria-pressed={mode === 'gateway'}
                className="flex items-center gap-2 text-sm font-bold text-slate-100 cursor-pointer text-left"
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    mode === 'gateway' ? 'border-cyan-400' : 'border-slate-600'
                  }`}
                >
                  {mode === 'gateway' && <span className="w-2 h-2 rounded-full bg-cyan-400" />}
                </span>
                <Server className="w-4 h-4 text-cyan-400" />
                My own gateway
              </button>

              <p className="text-xs text-slate-400 leading-relaxed">
                Your LiteLLM, vLLM or OpenAI-compatible server — nothing leaves your network except
                what it forwards itself.
              </p>

              <GatewayFields
                values={gateway}
                onChange={setGateway}
                onStatusChange={setGatewayStatus}
                hasSavedKey={Boolean(translation?.gatewayHasKey)}
              />
              {renderState(translationState)}
              {gatewayFromEnv && envHint('gateway address')}
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Most gateways speak the OpenAI format. Pick Gemini REST only if yours proxies
                Google&apos;s own API shape.
              </p>
            </div>

            {/*
             * The live verdict sits under the two key cards, beside the gateway:
             * it reports on transcription and translation together, and its two
             * rows sit side by side rather than leaving half the row empty.
             */}
            <div className="lg:col-span-2 space-y-2 min-w-0">
              <DetectionCard
                result={detection}
                isChecking={isDetecting}
                onRecheck={runDetection}
                keys={{
                  elevenLabs: elevenLabsKey,
                  translation: mode === 'gateway' ? gateway.apiKey : geminiKey,
                  translationUrl: mode === 'gateway' ? gateway.url : undefined,
                }}
                stored={{
                  elevenLabs: keySource.elevenLabs !== 'none',
                  translation:
                    mode === 'gateway'
                      ? Boolean(translation?.gatewayHasKey)
                      : keySource.gemini !== 'none',
                }}
                /*
                 * Picking a model writes it back into the field, so a
                 * "model missing" verdict is one click from fixed.
                 */
                onPickModel={
                  mode === 'gateway'
                    ? (model) => setGateway((current) => ({ ...current, model }))
                    : undefined
                }
              />

              {/* Where the keys end up. Wraps rather than truncating: a path cut
                  off mid-folder is worse than a second line. */}
              <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="min-w-0">
                  Stored on this computer only — never in the browser, never sent anywhere but the
                  services above
                  {configFile ? (
                    <>
                      {' · '}
                      <span className="font-mono text-slate-300 break-all">{configFile}</span>
                    </>
                  ) : null}
                </span>
              </div>

              {generalError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{generalError}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3 shrink-0">
          {isSettings ? (
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 font-mono truncate">
                {translation?.mode === 'gateway'
                  ? `Using your gateway — ${translation.models?.[0] || 'model not set'}`
                  : translation?.mode === 'google'
                    ? `Using Google Gemini — ${translation.models?.[0] || ''}`
                    : 'No translation engine configured'}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Configure the keys yourself using a .env file or environment variables"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>I&apos;ll use a .env file</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-sm font-bold shadow-lg shadow-indigo-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Checking...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                {/* Inside an expression these are plain strings, so no HTML entity. */}
                <span>{isSettings ? 'Verify & Update' : 'Verify & Save'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
