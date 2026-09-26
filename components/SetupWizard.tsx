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
  Check,
  Eye,
  EyeOff,
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
  /** Whether the backend found ffmpeg, shown with the other checks; omitted hides the row. */
  ffmpegAvailable?: boolean;
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
  ffmpegAvailable,
}) => {
  const isSettings = variant === 'settings';
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  // A saved key shows as saved until the user chooses to replace it.
  const [replacingElevenLabs, setReplacingElevenLabs] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
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
    `w-full h-[42px] bg-slate-950/60 border rounded-[10px] px-3 text-[13px] text-slate-100 placeholder:font-sans placeholder-slate-500 focus:outline-none focus:ring-4 font-mono transition-all ${
      state?.valid === true
        ? 'border-emerald-500/60 focus:border-emerald-400 focus:ring-emerald-500/10'
        : state?.valid === false
          ? 'border-rose-500/80 focus:border-rose-400 focus:ring-rose-500/15'
          : 'border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/15'
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

  const elevenLabsDone =
    elevenLabsState?.valid === true ||
    (elevenLabsState === null && detection?.elevenlabs.status === 'ok');
  const translationDone =
    (mode === 'google' ? geminiState?.valid === true : translationState?.valid === true) ||
    detection?.translation.status === 'ok';
  const showElevenLabsInput = !(keySource.elevenLabs === 'saved' && !replacingElevenLabs && !elevenLabsKey);

  /** A numbered section heading; the number becomes a tick once that half works. */
  const sectionHeading = (n: number, done: boolean, title: string, blurb: string, link?: { href: string }) => (
    <div className="flex items-start gap-3">
      <span
        className={`w-[22px] h-[22px] mt-0.5 rounded-full flex items-center justify-center shrink-0 font-mono text-[11px] border ${
          done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-700 text-slate-400'
        }`}
      >
        {done ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14.5px] font-semibold text-slate-100 leading-tight">{title}</h3>
        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{blurb}</p>
      </div>
      {link && (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 whitespace-nowrap"
        >
          Get a key <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        className="relative w-full max-w-[56rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start gap-3.5 px-5 sm:px-6 pt-5 pb-4 border-b border-slate-800 shrink-0">
          <div className="w-10 h-10 rounded-[11px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            {isSettings ? (
              <Key className="w-5 h-5" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="6" width="2" height="4" rx="1" />
                <rect x="4.5" y="3" width="2" height="10" rx="1" />
                <rect x="8" y="1" width="2" height="14" rx="1" />
                <rect x="11.5" y="4.5" width="2" height="7" rx="1" />
              </svg>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="setup-title" className="text-[19px] font-semibold text-slate-100 leading-tight">
              {isSettings ? 'API settings' : 'Welcome to DHVANI'}
            </h2>
            <p className="text-[13px] text-slate-400 mt-1 max-w-[52ch]">
              {isSettings
                ? 'Change a key, or switch translation between Google and your own gateway. Blank fields keep what is saved.'
                : "Connect two services and you're ready to dub. Each key is checked as you paste it."}
            </p>
          </div>
          {isSettings && (
            <button
              type="button"
              onClick={onSkip}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body: the form, and the live checks beside it */}
        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="px-5 sm:px-6 pb-5 min-w-0">
            {/* 1. Transcription and voice */}
            <div className="py-5 flex flex-col gap-3">
              {sectionHeading(
                1,
                elevenLabsDone,
                'Transcription and voice',
                'ElevenLabs transcribes the talk, times every word, and speaks the dub.',
                { href: 'https://elevenlabs.io/app/settings/api-keys' }
              )}

              {showElevenLabsInput ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="setup-elevenlabs-key" className="text-xs text-slate-400">
                    ElevenLabs API key
                  </label>
                  <div className="relative">
                    <input
                      id="setup-elevenlabs-key"
                      type={showElevenLabsKey ? 'text' : 'password'}
                      value={elevenLabsKey}
                      onChange={(e) => setElevenLabsKey(e.target.value)}
                      placeholder={
                        elevenLabsFromEnv ? 'Paste your own key to replace the one from .env' : 'Paste your key, it starts with sk_'
                      }
                      autoComplete="off"
                      spellCheck={false}
                      className={`${fieldClasses(elevenLabsState)} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowElevenLabsKey((v) => !v)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
                      aria-label={showElevenLabsKey ? 'Hide key' : 'Show key'}
                    >
                      {showElevenLabsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {renderState(elevenLabsState)}
                  {elevenLabsFromEnv && envHint('ElevenLabs key')}
                </div>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] bg-slate-950/60 border border-slate-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-slate-100">Key saved on this computer</span>
                    <span className="block text-[11.5px] text-slate-400 truncate">
                      {detection?.elevenlabs.status === 'ok'
                        ? 'Working. Replace it only to use a different key.'
                        : 'Choose Replace to paste a new key'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplacingElevenLabs(true)}
                    className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
                  >
                    Replace
                  </button>
                </div>
              )}

              <ServerSettingsFields
                title="Endpoint and models"
                fields={elevenLabsServerFields}
                values={serverValues}
                onChange={setServerValue}
                onReset={() => resetServerGroup(elevenLabsServerFields.map((field) => field.key))}
              />
            </div>

            {/* 2. Translation */}
            <div className="py-5 border-t border-slate-800 flex flex-col gap-3">
              {sectionHeading(
                2,
                translationDone,
                'Translation',
                'Turns each cue into the dub language. Pick one engine; it only ever sees cue text.'
              )}

              <div role="radiogroup" aria-label="Translation engine" className="grid sm:grid-cols-2 gap-2">
                {[
                  {
                    id: 'google' as const,
                    title: 'Google Gemini',
                    blurb: 'Calls Google directly with your Gemini key.',
                    Icon: Cloud,
                  },
                  {
                    id: 'gateway' as const,
                    title: 'Your own gateway',
                    blurb: 'LiteLLM, vLLM or any OpenAI-compatible server on your network.',
                    Icon: Server,
                  },
                ].map((opt) => {
                  const on = mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setMode(opt.id)}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        on
                          ? 'border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/10'
                          : 'border-slate-800 hover:bg-slate-800/40'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
                          on ? 'border-indigo-400' : 'border-slate-600'
                        }`}
                      >
                        {on && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100">
                          <opt.Icon className="w-3.5 h-3.5 text-slate-400" />
                          {opt.title}
                        </span>
                        <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{opt.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {mode === 'google' ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="setup-gemini-key" className="flex justify-between gap-2 text-xs text-slate-400">
                    <span>Gemini API key</span>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      Get a key <ExternalLink className="w-3 h-3" />
                    </a>
                  </label>
                  <input
                    id="setup-gemini-key"
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder={
                      keySource.gemini === 'saved'
                        ? 'Saved. Paste a new key to replace it'
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
                  <p className="text-[11.5px] text-slate-500 leading-relaxed">
                    This key also powers Gemini speech, script alignment and Indic spellcheck.
                  </p>
                  <ServerSettingsFields
                    title="Endpoint and models"
                    fields={geminiServerFields}
                    values={serverValues}
                    onChange={setServerValue}
                    onReset={() => resetServerGroup(geminiServerFields.map((field) => field.key))}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <GatewayFields
                    values={gateway}
                    onChange={setGateway}
                    onStatusChange={setGatewayStatus}
                    hasSavedKey={Boolean(translation?.gatewayHasKey)}
                  />
                  {renderState(translationState)}
                  {gatewayFromEnv && envHint('gateway address')}
                </div>
              )}
            </div>

            {generalError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-500/10 border border-rose-500/30 text-[12.5px] text-slate-200">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">Nothing was saved. {generalError}</span>
              </div>
            )}
          </div>

          {/* Live checks and where things are kept */}
          <aside
            aria-label="Checks"
            className="px-5 sm:px-5 py-5 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/40 flex flex-col gap-4 min-w-0"
          >
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
                translation: mode === 'gateway' ? Boolean(translation?.gatewayHasKey) : keySource.gemini !== 'none',
              }}
              /*
               * Picking a model writes it back into the field, so a
               * "model missing" verdict is one click from fixed.
               */
              onPickModel={mode === 'gateway' ? (model) => setGateway((current) => ({ ...current, model })) : undefined}
            />

            {ffmpegAvailable !== undefined && (
              <div className="flex items-start gap-2.5">
                <span
                  className={`w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 ${
                    ffmpegAvailable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {ffmpegAvailable ? <Check className="w-3 h-3" strokeWidth={3} /> : <Info className="w-3 h-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-slate-100">Video support</span>
                  <span className="block text-[11.5px] text-slate-400 leading-snug">
                    {ffmpegAvailable
                      ? 'ffmpeg found, so only the audio of a video is uploaded'
                      : 'ffmpeg not found; videos are uploaded whole'}
                  </span>
                </span>
              </div>
            )}

            {/* Wraps rather than truncating: a path cut off mid-folder is worse than a second line. */}
            {configFile && (
              <div className="text-xs text-slate-400 leading-relaxed">
                Saved to this computer only:
                <span className="block mt-1.5 px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-200 break-all">
                  {configFile}
                </span>
              </div>
            )}

            <p className="md:mt-auto flex items-start gap-2 text-[11.5px] text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-px" />
              <span>Keys never reach the browser. They go only to ElevenLabs and your translation engine.</span>
            </p>
          </aside>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-800 flex flex-wrap items-center gap-3 shrink-0">
          {isSettings ? (
            <p className="min-w-0 flex-1 text-[11.5px] text-slate-500 truncate">
              {translation?.mode === 'gateway'
                ? `Translating with your gateway · ${translation.models?.[0] || 'model not set'}`
                : translation?.mode === 'google'
                  ? `Translating with Google Gemini · ${translation.models?.[0] || ''}`
                  : 'No translation engine set up yet'}
            </p>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 min-w-0 text-left text-[12.5px] text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Configure the keys yourself using a .env file or environment variables"
            >
              <Terminal className="w-3.5 h-3.5 shrink-0" />
              <span>I&apos;ll use a .env file instead</span>
            </button>
          )}

          {isSettings && (
            <button
              type="button"
              onClick={onSkip}
              className="h-10 px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSubmit}
            className="h-10 px-5 flex items-center justify-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Checking…</span>
              </>
            ) : (
              <span>{isSettings ? 'Save changes' : 'Save and start'}</span>
            )}
          </button>
        </div>
      </section>
    </div>
  );
};
