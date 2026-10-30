import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Key,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Server,
  Cloud,
  Info,
  X,
  Eye,
  EyeOff,
  AudioLines,
  AudioWaveform,
  Lock,
  FlaskConical,
  RotateCw,
  Languages,
  Play,
  Shield,
  ArrowRight,
  KeyRound,
  Film,
  FileAudio,
  HardDrive,
  CircleDashed,
} from 'lucide-react';
import {
  apiJson,
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
import { ServerSettingsFields, ServerField } from './ServerSettingsFields';
import {
  agoLabel,
  formatLatency,
  hostOf,
  readCheckHistory,
  recordCheckTimes,
  Sparkline,
  type CheckHistory,
  type DetectionResult,
  type DetectionRow,
} from './ApiSettingsParts';
import { reportError } from '../services/errorPopup';
import { maskKey, PROBE_WORDS, type ProbeStatus } from '../services/providerDetect';
import { synthesizeSamplePreview } from '../services/elevenLabsService';

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
  /** The engine speaking the dub, and how to switch it once the settings are saved. */
  voiceEngine?: 'elevenlabs' | 'cartesia';
  onVoiceEngineChange?: (engine: 'elevenlabs' | 'cartesia') => void;
  /** The engine to show selected on open, e.g. Cartesia when opened from the voice picker's switch. */
  initialEngine?: 'elevenlabs' | 'cartesia';
  /** The language Try it translates into. */
  dubLanguage?: string;
  /** The voice Try it speaks with; omitted, Try it asks for a voice first. */
  previewVoice?: { id: string; name: string; modelId: string; apiKey: string } | null;
  /** The ElevenLabs plan's allowance, shown on the Transcribe step. */
  elevenLabsQuota?: { used: number; limit: number; resetUnix?: number } | null;
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
  cartesiaBaseUrl: server?.values.cartesiaBaseUrl || '',
  cartesiaApiVersion: server?.values.cartesiaApiVersion || '',
  cartesiaTtsModel: server?.values.cartesiaTtsModel || '',
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
  voiceEngine = 'elevenlabs',
  onVoiceEngineChange,
  initialEngine,
  dubLanguage = 'Hindi',
  previewVoice = null,
  elevenLabsQuota = null,
}) => {
  const isSettings = variant === 'settings';
  // ElevenLabs is the default; Cartesia takes over the dub only when chosen here or in the voice picker.
  const [engine, setEngine] = useState<'elevenlabs' | 'cartesia'>(initialEngine ?? voiceEngine);
  const engineChanged = engine !== voiceEngine;
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  // A saved key shows as saved until the user chooses to replace it.
  const [replacingElevenLabs, setReplacingElevenLabs] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [cartesiaKey, setCartesiaKey] = useState('');
  const [replacingCartesia, setReplacingCartesia] = useState(false);
  const [showCartesiaKey, setShowCartesiaKey] = useState(false);
  // Optional: Cartesia shares credits used only with an admin key.
  const [cartesiaAdminKey, setCartesiaAdminKey] = useState('');
  const [cartesiaAdminState, setCartesiaAdminState] = useState<FieldState>(null);

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
  const [cartesiaState, setCartesiaState] = useState<FieldState>(null);

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
  const cartesiaFromEnv = keySource.cartesia === 'env';
  const hasCartesia = (keySource.cartesia ?? 'none') !== 'none';

  const needsElevenLabs = keySource.elevenLabs === 'none';

  // The step on show: the one that needs something, or the one asked for.
  const [step, setStep] = useState<StepId>(() =>
    initialEngine ? 'voice' : needsElevenLabs ? 'transcribe' : translation?.mode === 'none' ? 'translate' : 'transcribe'
  );
  const [history, setHistory] = useState<CheckHistory>(readCheckHistory);
  // Ticks so "checked 12 s ago" stays true.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const [tryText, setTryText] = useState('Welcome. Today we look at how the mind works.');
  const [tried, setTried] = useState<Record<'translate' | 'voice', TryResult>>({ translate: { state: 'idle' }, voice: { state: 'idle' } });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** What the Transcribe step's meter shows; nothing until the plan's allowance is known. */
  const quota =
    elevenLabsQuota && elevenLabsQuota.limit > 0
      ? {
          share: Math.max(0, elevenLabsQuota.limit - elevenLabsQuota.used) / elevenLabsQuota.limit,
          left: compactCount(Math.max(0, elevenLabsQuota.limit - elevenLabsQuota.used)),
          of: `of ${compactCount(elevenLabsQuota.limit)}`,
          note: elevenLabsQuota.resetUnix
            ? `Resets ${new Date(elevenLabsQuota.resetUnix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : undefined,
        }
      : null;

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
      cartesiaKey.trim().length > 0 ||
      cartesiaAdminKey.trim().length > 0 ||
      engineChanged ||
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
          cartesiaApiKey: cartesiaKey.trim() || undefined,
          cartesiaBaseUrl: serverValues.cartesiaBaseUrl.trim() || undefined,
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
      if (!controller.signal.aborted) {
        setDetection(result);
        setHistory(recordCheckTimes(result));
      }
    } catch {
      // A failed check is not an error state of its own; the rows keep their
      // previous verdict and the user can hit Re-check.
    } finally {
      if (!controller.signal.aborted) setIsDetecting(false);
    }
  }, [mode, elevenLabsKey, geminiKey, cartesiaKey, gateway, serverValues]);

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
    cartesiaKey,
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
    setElevenLabsState(null);
    setGeminiState(null);
    setTranslationState(null);
    setCartesiaState(null);
    setCartesiaAdminState(null);

    try {
      const payload: SaveKeysPayload = {};
      if (elevenLabsKey.trim()) payload.elevenLabsApiKey = elevenLabsKey.trim();

      if (geminiKey.trim()) payload.geminiApiKey = geminiKey.trim();
      if (cartesiaKey.trim()) payload.cartesiaApiKey = cartesiaKey.trim();
      if (cartesiaAdminKey.trim()) payload.cartesiaAdminKey = cartesiaAdminKey.trim();

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

      // Switching engine alone has nothing for the server to store.
      if (Object.keys(payload).length === 0) {
        if (engine === 'cartesia' && !hasCartesia) {
          setCartesiaState({ valid: false, message: 'Paste a Cartesia key to switch the dub to Cartesia.' });
          return;
        }
        onVoiceEngineChange?.(engine);
        onComplete();
        return;
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

      if (result.validation.cartesia) {
        const check = result.validation.cartesia;
        setCartesiaState({
          valid: check.valid,
          message: check.valid
            ? `Connected${typeof check.voiceCount === 'number' ? ` — ${check.voiceCount.toLocaleString()} voices` : ''}`
            : check.error || 'This key was rejected by Cartesia.',
        });
      }

      if (result.validation.cartesiaAdmin) {
        const check = result.validation.cartesiaAdmin;
        setCartesiaAdminState({
          valid: check.valid,
          message: check.valid ? 'Saved. Credits used now show in the balance popover.' : check.error || 'Cartesia rejected this admin key.',
        });
        if (check.valid) setCartesiaAdminKey('');
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

      // The engine only switches to Cartesia once a working Cartesia key is in place.
      const cartesiaWorks = (result.keys.cartesia ?? 'none') !== 'none' && result.validation.cartesia?.valid !== false;
      if (engine === 'cartesia' && !cartesiaWorks) {
        if (!result.validation.cartesia) {
          setCartesiaState({ valid: false, message: 'Paste a Cartesia key to switch the dub to Cartesia.' });
        }
        return;
      }
      if (engineChanged) onVoiceEngineChange?.(engine);

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
      reportError(err, { title: 'The settings could not be saved', safe: 'Nothing was saved — what you typed is still in the form.' });
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

  /** True when any of these endpoint fields differs from what the form opened with. */
  const serverFieldsChanged = (fields: ServerField[]) =>
    fields.some((field) => (serverValues[field.key] || '').trim() !== (serverBaseline.current[field.key] || '').trim());

  /** Descriptors for the endpoint and model fields behind each step's button. */
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
      placeholder: 'scribe_v2',
      hint: 'scribe_v2 (sharpest word timings) or scribe_v1. This is what produces the word timings.',
      origin: server?.origins.elevenLabsSttModel,
    },
    {
      key: 'elevenLabsTtsModel',
      label: 'Voice model',
      placeholder: 'eleven_v4',
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

  const cartesiaServerFields: ServerField[] = [
    {
      key: 'cartesiaBaseUrl',
      label: 'API base URL',
      placeholder: 'https://api.cartesia.ai',
      hint: 'Change it only for a proxy or a mirror.',
      origin: server?.origins.cartesiaBaseUrl,
    },
    {
      key: 'cartesiaApiVersion',
      label: 'API version',
      placeholder: '2026-08-14',
      hint: 'Sent as the Cartesia-Version header.',
      origin: server?.origins.cartesiaApiVersion,
    },
    {
      key: 'cartesiaTtsModel',
      label: 'Voice model',
      placeholder: 'sonic-3.6',
      hint: 'sonic-3.6 speaks 44 languages, including Hindi, Tamil, Telugu, Bengali and Odia.',
      origin: server?.origins.cartesiaTtsModel,
    },
  ];

  const elevenLabsFieldsChanged = serverFieldsChanged(elevenLabsServerFields);
  const geminiFieldsChanged = serverFieldsChanged(geminiServerFields);
  const cartesiaFieldsChanged = serverFieldsChanged(cartesiaServerFields);

  /*
   * What each step has that is not saved yet. A step with changes can't be
   * tried, because a try runs on the saved settings, and its card says so.
   */
  const savedMode: TranslationMode | null = translation?.mode === 'gateway' || translation?.mode === 'google' ? translation.mode : null;
  const gatewayChanged =
    bareUrl(gateway.url) !== bareUrl(translation?.gatewayUrl) ||
    gateway.apiKey.trim().length > 0 ||
    gateway.protocol !== (translation?.gatewayProtocol || 'openai') ||
    gateway.model.trim() !== (translation?.models?.[0] || '');
  const dirty: Record<StepId, boolean> = {
    transcribe: elevenLabsKey.trim().length > 0 || elevenLabsFieldsChanged,
    translate: mode !== savedMode || (mode === 'google' ? geminiKey.trim().length > 0 || geminiFieldsChanged : gatewayChanged),
    voice: engineChanged || (engine === 'cartesia' ? cartesiaKey.trim().length > 0 || cartesiaFieldsChanged : elevenLabsKey.trim().length > 0 || elevenLabsFieldsChanged),
  };
  const unsaved = dirty.transcribe || dirty.translate || dirty.voice || cartesiaAdminKey.trim().length > 0;

  const showCartesiaInput = !(keySource.cartesia === 'saved' && !replacingCartesia && !cartesiaKey);
  const showElevenLabsInput = !(keySource.elevenLabs === 'saved' && !replacingElevenLabs && !elevenLabsKey);

  /** Who does each step, what it is checked as, and what it sends where. */
  const steps: StepView[] = [
    {
      id: 'transcribe',
      key: '1',
      title: 'Transcribe',
      what: 'Every word, with its time',
      carries: 'Audio',
      engine: 'ElevenLabs',
      Icon: AudioLines,
      tile: 'from-slate-100 to-slate-400 text-slate-900',
      model: serverValues.elevenLabsSttModel || 'scribe_v2',
      row: detection?.elevenlabs,
      times: history.elevenlabs || [],
      sends: ffmpegAvailable === false ? 'The whole file' : 'Audio track only',
      host: hostOf(serverValues.elevenLabsBaseUrl, 'api.elevenlabs.io'),
      credential: elevenLabsKey ? `Key ${maskKey(elevenLabsKey)}` : keySource.elevenLabs !== 'none' ? 'Key saved on this computer' : 'No key yet',
    },
    {
      id: 'translate',
      key: '2',
      title: 'Translate',
      what: 'Each cue into the dub language',
      carries: 'Words + times',
      engine: mode === 'gateway' ? 'Your gateway' : 'Google Gemini',
      Icon: mode === 'gateway' ? Server : Cloud,
      tile: mode === 'gateway' ? 'from-indigo-400 to-indigo-600 text-white' : 'from-sky-400 to-blue-600 text-white',
      model:
        mode === 'gateway'
          ? gateway.model || detection?.translation.model || ''
          : serverValues.geminiTranslationModels.split(',')[0]?.trim() || detection?.translation.model || '',
      row: detection && detection.mode === mode ? detection.translation : undefined,
      times: history.translation || [],
      sends: 'Cue text only',
      host: mode === 'gateway' ? hostOf(gateway.url, 'your gateway') : hostOf(serverValues.geminiBaseUrl, 'generativelanguage.googleapis.com'),
      credential:
        mode === 'gateway'
          ? gateway.apiKey ? `Key ${maskKey(gateway.apiKey)}` : translation?.gatewayHasKey ? 'Key saved on this computer' : 'No key; fine for a local gateway'
          : geminiKey ? `Key ${maskKey(geminiKey)}` : keySource.gemini !== 'none' ? 'Key saved on this computer' : 'No key yet',
    },
    engine === 'cartesia'
      ? {
          id: 'voice',
          key: '3',
          title: 'Voice',
          what: 'Speaks the dub',
          carries: 'Cue text',
          engine: 'Cartesia',
          Icon: AudioWaveform,
          tile: 'from-orange-400 to-orange-600 text-white',
          model: serverValues.cartesiaTtsModel || 'sonic-3.6',
          row: detection?.cartesia,
          times: history.cartesia || [],
          sends: 'The dub’s text',
          host: hostOf(serverValues.cartesiaBaseUrl, 'api.cartesia.ai'),
          credential: cartesiaKey ? `Key ${maskKey(cartesiaKey)}` : hasCartesia ? 'Key saved on this computer' : 'No key yet',
        }
      : {
          id: 'voice',
          key: '3',
          title: 'Voice',
          what: 'Speaks the dub',
          carries: 'Cue text',
          engine: 'ElevenLabs',
          Icon: AudioLines,
          tile: 'from-slate-100 to-slate-400 text-slate-900',
          model: serverValues.elevenLabsTtsModel || 'eleven_v4',
          row: detection?.elevenlabs,
          times: history.elevenlabs || [],
          sends: 'The dub’s text',
          host: hostOf(serverValues.elevenLabsBaseUrl, 'api.elevenlabs.io'),
          credential: 'The ElevenLabs key from Transcribe',
        },
  ];
  const statusOf = (view: StepView): ProbeStatus => (isDetecting ? 'checking' : view.row?.status ?? 'unverified');
  const readyCount = steps.filter((view) => statusOf(view) === 'ok').length;
  const translateView = steps[1];

  /*
   * The body keeps the tallest height it has had at this width, so a choice
   * that adds a field, or a message that appears, makes the window grow once
   * and never bounce back. A different width starts over, since text wraps
   * differently there.
   */
  const bodyGrid = useRef<HTMLDivElement>(null);
  const tallest = useRef({ width: 0, height: 0 });
  const keepTallest = useCallback(() => {
    const el = bodyGrid.current;
    if (!el) return;
    const width = el.clientWidth;
    if (width !== tallest.current.width) {
      tallest.current = { width, height: 0 };
      el.style.minHeight = '';
    }
    const height = el.offsetHeight;
    if (height > tallest.current.height) {
      tallest.current.height = height;
      el.style.minHeight = `${height}px`;
    }
  }, []);
  useLayoutEffect(keepTallest);
  useEffect(() => {
    const el = bodyGrid.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(keepTallest);
    observer.observe(el);
    return () => observer.disconnect();
  }, [keepTallest]);

  // 1, 2 and 3 pick a step, and Ctrl S saves, unless a field has the keys.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const canSubmitRef = useRef(canSubmit);
  canSubmitRef.current = canSubmit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSubmitRef.current) saveRef.current();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const picked = STEP_KEYS[e.key];
      if (picked) setStep(picked);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* --------------------------- Try it --------------------------- */

  const runTryTranslate = async () => {
    const text = tryText.trim();
    if (!text) return;
    setTried((t) => ({ ...t, translate: { state: 'running' } }));
    const started = performance.now();
    try {
      const response = await apiJson<{ translations: { id: string; translatedText: string }[] }>('/translation/segments', {
        body: {
          segments: [{ id: 'try', sourceText: text, startTime: 0, endTime: 4 }],
          sourceLanguage: '',
          targetLanguage: dubLanguage,
        },
      });
      const out = response.translations?.[0]?.translatedText?.trim();
      if (!out) throw new Error('The translation came back empty.');
      setTried((t) => ({ ...t, translate: { state: 'done', text: out, ms: performance.now() - started } }));
    } catch (err: any) {
      setTried((t) => ({ ...t, translate: { state: 'error', error: err?.message || 'The line could not be translated.' } }));
    }
  };

  const runTryVoice = async () => {
    if (!previewVoice) return;
    audioRef.current?.pause();
    setTried((t) => ({ ...t, voice: { state: 'running' } }));
    const started = performance.now();
    try {
      const text = tried.translate.state === 'done' && tried.translate.text ? tried.translate.text : 'This is how your dub will sound.';
      const blob = await synthesizeSamplePreview(previewVoice.apiKey, previewVoice.id, text, previewVoice.modelId);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audioRef.current = audio;
      setTried((t) => ({ ...t, voice: { state: 'done', text, ms: performance.now() - started } }));
      await audio.play();
    } catch (err: any) {
      setTried((t) => ({ ...t, voice: { state: 'error', error: err?.message || 'The voice could not be played.' } }));
    }
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  /* --------------------------- Pieces --------------------------- */

  const keyBox = (name: string, working: boolean, onReplace: () => void) => (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-slate-800/25 border border-slate-800 min-w-0">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${working ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
        <ShieldCheck className="w-4 h-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-slate-100 truncate">{name} key saved on this computer</span>
        <span className="block text-[11.5px] text-slate-400 truncate">
          {working ? 'Working. Replace it only to use a different key.' : 'Choose Replace to paste a new key'}
        </span>
      </span>
      <button
        type="button"
        onClick={onReplace}
        className="h-8 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default shrink-0"
      >
        Replace
      </button>
    </div>
  );

  const keyInput = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    shown: boolean,
    onToggleShown: () => void,
    placeholder: string,
    state: FieldState
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-slate-400">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={`${fieldClasses(state)} pr-11`}
        />
        <button
          type="button"
          onClick={onToggleShown}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-default"
          aria-label={shown ? 'Hide key' : 'Show key'}
        >
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {renderState(state)}
    </div>
  );

  /** Two engines for one step, as cards that sit side by side when there is room and stack when there is not. */
  const choice = <T extends string>(
    label: string,
    value: T,
    onPick: (id: T) => void,
    options: { id: T; title: string; blurb: string; Icon: React.ComponentType<{ className?: string }>; tile: string; badge?: string; warn?: string }[]
  ) => (
    <div role="radiogroup" aria-label={label} className="grid @lg/stage:grid-cols-2 gap-2">
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(opt.id)}
            className={`min-w-0 flex items-start gap-3 p-3 rounded-xl border text-left transition-colors cursor-default ${
              on ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-slate-800 hover:bg-slate-800/40'
            }`}
          >
            <span className={`w-8 h-8 rounded-lg bg-gradient-to-b ${opt.tile} flex items-center justify-center shrink-0`}>
              <opt.Icon className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-semibold text-slate-100 truncate">{opt.title}</span>
                {opt.badge && <span className="shrink-0 font-mono text-[10px] text-slate-500">{opt.badge}</span>}
                {opt.warn && <span className="shrink-0 text-[10px] font-medium px-1.5 py-px rounded-md bg-amber-500/15 text-amber-300">{opt.warn}</span>}
              </span>
              <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug line-clamp-2">{opt.blurb}</span>
            </span>
            <span className={`w-4 h-4 mt-1 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${on ? 'border-indigo-400' : 'border-slate-600'}`}>
              {on && <span className="w-2 h-2 rounded-full bg-indigo-400" />}
            </span>
          </button>
        );
      })}
    </div>
  );

  const getKey = (href: string) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="shrink-0 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 whitespace-nowrap"
    >
      Get a key <ExternalLink className="w-3 h-3" />
    </a>
  );

  /* --------------------------- Steps --------------------------- */

  const transcribeStep = (
    <>
      <p className="flex items-start gap-1.5 text-[12px] text-slate-400 leading-relaxed">
        <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="min-w-0 flex-1">Only ElevenLabs times every word, so it always transcribes.</span>
        {getKey('https://elevenlabs.io/app/settings/api-keys')}
      </p>
      {showElevenLabsInput ? (
        <>
          {keyInput(
            'setup-elevenlabs-key',
            'ElevenLabs API key',
            elevenLabsKey,
            setElevenLabsKey,
            showElevenLabsKey,
            () => setShowElevenLabsKey((v) => !v),
            elevenLabsFromEnv ? 'Paste your own key to replace the one from .env' : 'Paste your key, it starts with sk_',
            elevenLabsState
          )}
          {elevenLabsFromEnv && envHint('ElevenLabs key')}
        </>
      ) : (
        keyBox('ElevenLabs', detection?.elevenlabs.status === 'ok', () => setReplacingElevenLabs(true))
      )}
      {quota && <UsageMeter label="Characters left" share={quota.share} value={quota.left} unit={quota.of} note={quota.note} />}
      <ServerSettingsFields
        title="Endpoint and models"
        fields={elevenLabsServerFields}
        values={serverValues}
        onChange={setServerValue}
        onReset={() => resetServerGroup(elevenLabsServerFields.map((field) => field.key))}
      />
    </>
  );

  const translateStep = (
    <>
      {choice<TranslationMode>('Translation engine', mode, setMode, [
        {
          id: 'google',
          title: 'Google Gemini',
          blurb: 'Calls Google directly with your Gemini key.',
          Icon: Cloud,
          tile: 'from-sky-400 to-blue-600 text-white',
          warn: keySource.gemini === 'none' && !geminiKey.trim() ? 'Needs a key' : undefined,
        },
        {
          id: 'gateway',
          title: 'Your own gateway',
          blurb: 'LiteLLM, vLLM or any OpenAI-compatible server on your network.',
          Icon: Server,
          tile: 'from-indigo-400 to-indigo-600 text-white',
          badge: mode === 'gateway' && translateView.row?.latencyMs ? formatLatency(translateView.row.latencyMs) : undefined,
        },
      ])}
      {mode === 'google' ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="setup-gemini-key" className="flex justify-between gap-2 text-xs text-slate-400">
            <span>Gemini API key</span>
            {getKey('https://aistudio.google.com/apikey')}
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
          <p className="text-[11.5px] text-slate-500 leading-relaxed mb-1.5">
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
            knownModels={detection?.mode === 'gateway' ? detection.translation.models : []}
          />
          {renderState(translationState)}
          {gatewayFromEnv && envHint('gateway address')}
        </div>
      )}
    </>
  );

  const voiceStep = (
    <>
      {choice<'elevenlabs' | 'cartesia'>('Voice engine', engine, setEngine, [
        {
          id: 'elevenlabs',
          title: 'ElevenLabs',
          blurb: 'The default. Speaks the dub with the key from Transcribe.',
          Icon: AudioLines,
          tile: 'from-slate-100 to-slate-400 text-slate-900',
        },
        {
          id: 'cartesia',
          title: 'Cartesia',
          blurb: 'Speaks the dub with Cartesia Sonic voices. Switch back any time.',
          Icon: AudioWaveform,
          tile: 'from-orange-400 to-orange-600 text-white',
          warn: !hasCartesia && !cartesiaKey.trim() ? 'Needs a key' : undefined,
        },
      ])}
      {engine === 'elevenlabs' ? (
        <>
          <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-slate-800/25 border border-slate-800 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
              <AudioLines className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-slate-100 truncate">Uses the ElevenLabs key from Transcribe</span>
              <span className="block text-[11.5px] text-slate-400 truncate">One key transcribes and speaks.</span>
            </span>
            <button
              type="button"
              onClick={() => setStep('transcribe')}
              className="h-8 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default shrink-0"
            >
              Open
            </button>
          </div>
          <ServerSettingsFields
            title="Endpoint and models"
            fields={elevenLabsServerFields}
            values={serverValues}
            onChange={setServerValue}
            onReset={() => resetServerGroup(elevenLabsServerFields.map((field) => field.key))}
          />
        </>
      ) : (
        <>
          <div className="flex justify-end -mb-1">{getKey('https://play.cartesia.ai/keys')}</div>
          {showCartesiaInput ? (
            <>
              {keyInput(
                'setup-cartesia-key',
                'Cartesia API key',
                cartesiaKey,
                setCartesiaKey,
                showCartesiaKey,
                () => setShowCartesiaKey((v) => !v),
                cartesiaFromEnv ? 'Paste your own key to replace the one from .env' : 'Paste your key, it starts with sk_car_',
                cartesiaState
              )}
              {cartesiaFromEnv && envHint('Cartesia key')}
            </>
          ) : (
            keyBox('Cartesia', detection?.cartesia?.status === 'ok', () => setReplacingCartesia(true))
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="setup-cartesia-admin-key" className="flex justify-between gap-2 text-xs text-slate-400">
              <span>Admin key</span>
              <span className="text-slate-500 truncate">optional, only to show credits used</span>
            </label>
            <input
              id="setup-cartesia-admin-key"
              type="password"
              value={cartesiaAdminKey}
              onChange={(e) => setCartesiaAdminKey(e.target.value)}
              placeholder={
                keySource.cartesiaAdmin && keySource.cartesiaAdmin !== 'none'
                  ? 'Admin key saved. Paste a new one to replace it.'
                  : 'Not needed to dub'
              }
              autoComplete="off"
              spellCheck={false}
              className={fieldClasses(cartesiaAdminState)}
            />
            {renderState(cartesiaAdminState)}
          </div>
          <ServerSettingsFields
            title="Endpoint and models"
            fields={cartesiaServerFields}
            values={serverValues}
            onChange={setServerValue}
            onReset={() => resetServerGroup(cartesiaServerFields.map((field) => field.key))}
          />
        </>
      )}
    </>
  );

  /* --------------------------- Live panel --------------------------- */

  /** Try it for a step: Translate and Voice have one, Transcribe does not. */
  const tryCardFor = (current: StepView) => {
    if (current.id === 'transcribe') return null;
    const status = statusOf(current);
    const isTranslate = current.id === 'translate';
    const result = tried[current.id];
    const blocked = dirty[current.id]
      ? 'Save first to try your changes'
      : status !== 'ok'
        ? 'Works once this step is ready'
        : !isTranslate && !previewVoice
          ? 'Pick a voice first'
          : null;
    return (
      <div className="rounded-xl border border-slate-800 bg-gradient-to-b from-slate-800/40 to-slate-800/10 p-3.5">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider font-semibold text-slate-400">
          <FlaskConical className="w-3.5 h-3.5 shrink-0" />
          Try it
          <span className="ml-auto normal-case tracking-normal font-normal text-[11.5px] text-slate-500 truncate">
            {isTranslate ? `Into ${dubLanguage}` : previewVoice ? previewVoice.name : 'Hear the voice'}
          </span>
        </div>
        {/* The result takes the sample's place, so the panel keeps its height. */}
        <div className="mt-2.5 min-h-[3.75rem] rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2 flex flex-col justify-center min-w-0">
          {result.state === 'done' ? (
            <div className="tools-hub-preview-in min-w-0">
              <p className={`text-slate-50 leading-snug break-words ${isTranslate ? 'text-[14px]' : 'text-[12.5px]'}`}>
                {isTranslate ? result.text : `“${result.text}”`}
              </p>
              <p className="mt-1 font-mono text-[10.5px] text-slate-500 truncate">
                {isTranslate ? current.model.split('/').pop() : previewVoice?.modelId} · {formatLatency(result.ms ?? 0)}
              </p>
            </div>
          ) : result.state === 'error' ? (
            <p className="text-[12px] text-rose-300 leading-snug break-words">{result.error}</p>
          ) : isTranslate ? (
            <input
              value={tryText}
              onChange={(e) => setTryText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !blocked && runTryTranslate()}
              aria-label="A line to translate"
              className="w-full bg-transparent text-[12.5px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
          ) : (
            <p className="text-[12.5px] text-slate-400 leading-snug">
              {tried.translate.state === 'done' ? 'Speaks the line translated in step 2' : 'Speaks a short English line'}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={Boolean(blocked) || result.state === 'running'}
          onClick={() => {
            if (result.state === 'done' || result.state === 'error') {
              setTried((t) => ({ ...t, [current.id]: { state: 'idle' } }));
              if (!isTranslate) runTryVoice();
              return;
            }
            if (isTranslate) runTryTranslate();
            else runTryVoice();
          }}
          className="mt-2.5 w-full h-8 rounded-lg bg-slate-100 text-slate-900 hover:bg-white disabled:bg-slate-800 disabled:text-slate-500 text-[12.5px] font-semibold flex items-center justify-center gap-2 cursor-default"
        >
          {result.state === 'running' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {isTranslate ? 'Translating…' : 'Voicing…'}
            </>
          ) : blocked ? (
            blocked
          ) : result.state === 'done' || result.state === 'error' ? (
            <>
              <RotateCw className="w-3.5 h-3.5" /> {isTranslate ? 'Try another line' : 'Play again'}
            </>
          ) : isTranslate ? (
            <>
              <Languages className="w-3.5 h-3.5" /> Translate
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" /> Play
            </>
          )}
        </button>
        <p className="mt-1.5 text-[10.5px] text-slate-500">Runs on the saved settings and uses a few characters.</p>
      </div>
    );
  };

  /** What a step sends where, its key, and its last check. */
  const connectionCardFor = (current: StepView) => {
    const status = statusOf(current);
    const word = PROBE_WORDS[status] || PROBE_WORDS.unverified;
    return (
    <div className="rounded-xl border border-slate-800 p-3.5 min-w-0">
      <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider font-semibold text-slate-400">
        <Shield className="w-3.5 h-3.5 shrink-0" />
        What leaves this computer
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[12px] min-w-0">
        <span className="shrink-0 px-2 py-0.5 rounded-md bg-slate-800 text-slate-200">{current.sends}</span>
        <ArrowRight className="w-3.5 h-3.5 shrink-0 text-slate-500" />
        <span className="min-w-0 font-mono text-[11px] text-slate-300 truncate flex items-center gap-1" title={current.host}>
          <Lock className="w-3 h-3 shrink-0 text-emerald-400" />
          <span className="truncate">{current.host}</span>
        </span>
      </div>
      <ul className="mt-3 pt-2.5 border-t border-slate-800 space-y-1.5 text-[11.5px]">
        <li className="flex items-start gap-2 min-w-0">
          <KeyRound className="w-3.5 h-3.5 shrink-0 mt-px text-slate-500" />
          <span className="min-w-0 flex-1 truncate text-slate-300">{current.credential}</span>
        </li>
        <li className="flex items-start gap-2 min-w-0">
          <StatusDot tone={word.tone} checking={status === 'checking'} />
          <span className={`min-w-0 flex-1 leading-snug break-words ${TONE_TEXT[word.tone]}`}>
            {word.word}
            {current.row?.message && status !== 'checking' ? ` · ${current.row.message}` : ''}
          </span>
          {current.row?.latencyMs && status === 'ok' ? (
            <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{formatLatency(current.row.latencyMs)}</span>
          ) : null}
        </li>
        {ffmpegAvailable !== undefined && current.id === 'transcribe' && (
          <li className="flex items-start gap-2 min-w-0">
            <Film className="w-3.5 h-3.5 shrink-0 mt-px text-slate-500" />
            <span className="min-w-0 flex-1 text-slate-400 leading-snug">
              {ffmpegAvailable ? 'ffmpeg found, so only the audio of a video is uploaded' : 'ffmpeg not found; videos are uploaded whole'}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
  };

  /* --------------------------- Window --------------------------- */

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        className="@container relative w-full max-w-[68rem] min-h-full sm:min-h-0 sm:my-auto sm:h-[min(43rem,calc(100vh-3rem))] flex flex-col sm:rounded-[22px] bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/60 text-slate-100 overflow-hidden"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-44 left-1/2 -translate-x-1/2 w-[50rem] h-[20rem] rounded-full blur-3xl opacity-[.16] bg-indigo-500"
        />

        {/* Header: name, how many steps work, Re-check */}
        <div className="relative flex items-center gap-3 @xl:gap-3.5 px-4 @xl:px-7 pt-5 @xl:pt-6 shrink-0">
          <div className="w-10 h-10 @xl:w-11 @xl:h-11 rounded-xl bg-slate-100 text-slate-950 flex items-center justify-center shrink-0 shadow-lg shadow-black/30" aria-hidden="true">
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
            <h2 id="setup-title" className="text-[18px] @xl:text-[19px] font-semibold text-slate-100 leading-tight truncate">
              {isSettings ? 'API settings' : 'Welcome to DHVANI'}
            </h2>
            <p className="hidden @md:block text-[12.5px] text-slate-400 mt-0.5 truncate">
              {isSettings
                ? 'The services your dub goes through. Pick a step to change who does it.'
                : "Connect two services and you're ready to dub. Each key is checked as you paste it."}
            </p>
          </div>
          <div
            className={`shrink-0 flex items-center gap-2 h-9 pl-2.5 pr-1 rounded-full border ${
              isDetecting
                ? 'border-slate-700 bg-slate-800/40'
                : readyCount === 3
                  ? 'border-emerald-500/30 bg-emerald-500/[.07]'
                  : 'border-amber-500/30 bg-amber-500/[.07]'
            }`}
          >
            <HealthRing ready={readyCount} checking={isDetecting} />
            <span className="leading-tight whitespace-nowrap">
              {isDetecting ? (
                <span className="block text-[12px] font-semibold text-slate-300">Checking…</span>
              ) : (
                <span className={`block text-[12px] font-semibold ${readyCount === 3 ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {readyCount}/3<span className="hidden @lg:inline"> steps ready</span>
                </span>
              )}
              {detection && !isDetecting && (
                <span className="hidden @lg:block text-[10.5px] text-slate-500">checked {agoLabel(detection.checkedAt, now)}</span>
              )}
            </span>
            <button
              type="button"
              onClick={runDetection}
              disabled={isDetecting}
              aria-label="Check every service again"
              className="h-7 px-2 @lg:px-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-[11.5px] flex items-center gap-1.5 disabled:opacity-60 cursor-default"
            >
              <RefreshCw className={`w-3 h-3 ${isDetecting ? 'animate-spin' : ''}`} />
              <span className="hidden @lg:inline">Re-check</span>
            </button>
          </div>
          {isSettings && (
            <button
              type="button"
              onClick={onSkip}
              aria-label="Close"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-default"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body. The window keeps one height for every step; this scrolls only when the screen is too short for a step. */}
        <div className="relative flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin]">
          {/* The pipeline: Media, the three steps, the dub */}
          <div role="tablist" aria-label="Steps" className="flex items-stretch px-4 @xl:px-7 pt-4 @xl:pt-5">
            <FlowEnd Icon={FileAudio} label="Media" />
            {steps.map((view, i) => (
              <React.Fragment key={view.id}>
                <FlowLink label={view.carries} first={i === 0} />
                <StepCard view={view} status={statusOf(view)} active={view.id === step} changed={dirty[view.id]} onPick={() => setStep(view.id)} />
              </React.Fragment>
            ))}
            <FlowLink label="Dub audio" last />
            <FlowEnd Icon={AudioLines} label="Dub" />
          </div>

          {/* The picked step, and the live panel beside it, or under it when the window is narrow */}
          {/*
            All three steps are laid out in the same place and only the picked one shows, so the
            window is as tall as its tallest step and stays that size from one step to the next.
          */}
          <div ref={bodyGrid} className="grid @4xl:grid-cols-[minmax(0,1fr)_19rem] gap-4 @xl:gap-5 px-4 @xl:px-7 pt-4 @xl:pt-5 pb-5 content-start">
            <div className="@container/stage min-w-0 grid">
              {steps.map((view) => {
                const shown = view.id === step;
                return (
                  <div
                    key={view.id}
                    role="tabpanel"
                    aria-label={view.title}
                    aria-hidden={!shown}
                    inert={!shown}
                    className={`[grid-area:1/1] min-w-0 flex flex-col gap-3 ${shown ? 'tools-hub-preview-in' : 'invisible'}`}
                  >
                    <div className="flex items-baseline gap-2 min-w-0">
                      <h3 className="text-[15px] font-semibold text-slate-100 shrink-0">{view.title}</h3>
                      <span className="text-[12.5px] text-slate-500 truncate">{view.what}</span>
                    </div>
                    {view.id === 'transcribe' ? transcribeStep : view.id === 'translate' ? translateStep : voiceStep}
                  </div>
                );
              })}
            </div>
            <div className="min-w-0 grid">
              {steps.map((view) => {
                const shown = view.id === step;
                const tryCard = tryCardFor(view);
                return (
                  <aside
                    key={view.id}
                    aria-label={`${view.title}: live`}
                    aria-hidden={!shown}
                    inert={!shown}
                    className={`[grid-area:1/1] min-w-0 grid ${tryCard ? '@xl:@max-4xl:grid-cols-2' : ''} @4xl:flex @4xl:flex-col gap-3 content-start ${
                      shown ? 'tools-hub-preview-in' : 'invisible'
                    }`}
                  >
                    {tryCard}
                    {connectionCardFor(view)}
                  </aside>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="relative px-4 @xl:px-7 py-3.5 border-t border-slate-800 bg-slate-950/50 flex flex-wrap items-center gap-x-4 gap-y-2.5 shrink-0">
          {isSettings ? (
            <div className="min-w-0 flex-1 basis-56 flex items-center gap-3">
              <span className="hidden @md:flex w-8 h-8 rounded-lg bg-slate-800/70 items-center justify-center shrink-0">
                <HardDrive className="w-4 h-4 text-slate-400" />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-[12px] text-slate-300 truncate">Keys are saved on this computer only</p>
                {configFile && (
                  <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5" title={configFile}>
                    {configFile}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 basis-56 min-w-0 text-left text-[12.5px] text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5 cursor-default"
              title="Configure the keys yourself using a .env file or environment variables"
            >
              <Terminal className="w-3.5 h-3.5 shrink-0" />
              <span>I&apos;ll use a .env file instead</span>
            </button>
          )}

          <div className="ml-auto flex items-center gap-3">
            {unsaved && (
              <span className="hidden @md:flex items-center gap-1.5 text-[12px] text-amber-300 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Unsaved changes
              </span>
            )}
            {isSettings && (
              <button
                type="button"
                onClick={onSkip}
                className="h-10 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 text-[13px] font-semibold text-slate-200 cursor-default"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSubmit}
              className="h-10 px-5 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold shadow-lg shadow-indigo-950/40 transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed cursor-default"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Checking…</span>
                </>
              ) : (
                <>
                  <span>{isSettings ? 'Save changes' : 'Save and start'}</span>
                  <kbd className="hidden @lg:inline text-[10.5px] px-1 rounded bg-indigo-500/60 font-sans">Ctrl S</kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

/* ------------------------------------------------------------------ */

type StepId = 'transcribe' | 'translate' | 'voice';

const STEP_KEYS: Record<string, StepId> = { '1': 'transcribe', '2': 'translate', '3': 'voice' };

interface StepView {
  id: StepId;
  key: string;
  title: string;
  what: string;
  /** What reaches this step from the one before, written on the link. */
  carries: string;
  engine: string;
  Icon: React.ComponentType<{ className?: string }>;
  tile: string;
  model: string;
  row?: DetectionRow;
  times: number[];
  sends: string;
  host: string;
  credential: string;
}

type TryResult = { state: 'idle' | 'running' | 'done' | 'error'; text?: string; ms?: number; error?: string };

const TONE_TEXT = { ok: 'text-emerald-300', warn: 'text-amber-300', error: 'text-rose-300', muted: 'text-slate-400' } as const;

/** "http://host:1/v1/" and "http://host:1" are the same gateway. */
const bareUrl = (url?: string | null) => (url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');

const StatusDot: React.FC<{ tone: keyof typeof TONE_TEXT; checking?: boolean }> = ({ tone, checking }) =>
  checking ? (
    <RefreshCw className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400 animate-spin" />
  ) : tone === 'ok' ? (
    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px text-emerald-400" />
  ) : tone === 'muted' ? (
    <CircleDashed className="w-3.5 h-3.5 shrink-0 mt-px text-slate-500" />
  ) : (
    <AlertCircle className={`w-3.5 h-3.5 shrink-0 mt-px ${tone === 'warn' ? 'text-amber-400' : 'text-rose-400'}`} />
  );

/** A ring that fills a third for each step that works. */
const HealthRing: React.FC<{ ready: number; checking: boolean }> = ({ ready, checking }) => (
  <svg viewBox="0 0 20 20" className={`w-5 h-5 shrink-0 -rotate-90 ${checking ? 'animate-pulse' : ''}`} aria-hidden="true">
    <circle cx="10" cy="10" r="8" fill="none" stroke="#1e293b" strokeWidth="2.5" />
    <circle
      cx="10"
      cy="10"
      r="8"
      fill="none"
      stroke={ready === 3 ? '#34d399' : '#fbbf24'}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeDasharray={`${(ready / 3) * 50.3} 50.3`}
    />
  </svg>
);

/** The ends of the pipeline, shown only when the window is wide enough for them. */
const FlowEnd: React.FC<{ Icon: React.ComponentType<{ className?: string }>; label: string }> = ({ Icon, label }) => (
  <div className="hidden @3xl:flex shrink-0 self-center flex-col items-center gap-1 text-[10.5px] text-slate-500">
    <span className="w-10 h-10 rounded-xl border border-dashed border-slate-700 bg-slate-900 flex items-center justify-center">
      <Icon className="w-4 h-4" />
    </span>
    {label}
  </div>
);

/** An arrow between two steps with a dot running along it, and what it carries when there is room to say. */
const FlowLink: React.FC<{ label: string; first?: boolean; last?: boolean }> = ({ label, first, last }) => (
  <div className={`${first || last ? 'hidden @3xl:flex' : 'flex'} shrink-0 w-3 @xl:w-8 @3xl:w-[4.5rem] self-center flex-col items-center gap-1`}>
    <div className="relative w-full h-3">
      <span className="absolute inset-x-0.5 top-1/2 h-px bg-gradient-to-r from-indigo-500/20 via-indigo-400/70 to-indigo-500/20" />
      <span className="api-flow-dot hidden @xl:block" />
    </div>
    <span className="hidden @3xl:block text-[9.5px] text-slate-500 whitespace-nowrap">{label}</span>
  </div>
);

/** One step of the pipeline: who does it, its model, its answer times and whether it works. */
const StepCard: React.FC<{ view: StepView; status: ProbeStatus; active: boolean; changed: boolean; onPick: () => void }> = ({
  view,
  status,
  active,
  changed,
  onPick,
}) => {
  const word = PROBE_WORDS[status] || PROBE_WORDS.unverified;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onPick}
      className={`min-w-0 flex-1 text-left rounded-2xl border p-2.5 @xl:p-3.5 transition-all cursor-default ${
        active
          ? 'border-indigo-400/70 bg-gradient-to-b from-indigo-500/15 to-indigo-500/5 shadow-[0_0_0_1px_rgba(129,140,248,.35),0_16px_40px_-18px_rgba(99,102,241,.8)]'
          : 'border-slate-800 bg-slate-800/25 hover:bg-slate-800/50 hover:border-slate-700'
      }`}
    >
      <span className={`flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-semibold min-w-0 ${active ? 'text-indigo-300' : 'text-slate-500'}`}>
        <kbd className={`w-4 h-4 shrink-0 rounded flex items-center justify-center text-[9.5px] font-sans ${active ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
          {view.key}
        </kbd>
        <span className="truncate">{view.title}</span>
        {changed && (
          <span className="hidden @2xl:inline ml-auto shrink-0 normal-case tracking-normal text-[10px] px-1.5 rounded bg-amber-500/15 text-amber-300">Changed</span>
        )}
      </span>
      <span className="mt-2 @xl:mt-2.5 flex items-center gap-2.5 min-w-0">
        <span className={`hidden @md:flex w-8 h-8 @xl:w-9 @xl:h-9 shrink-0 rounded-xl bg-gradient-to-b ${view.tile} items-center justify-center shadow-md shadow-black/30`}>
          <view.Icon className="w-4 h-4 @xl:w-[18px] @xl:h-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[12.5px] @xl:text-[14px] font-semibold text-slate-100 truncate">{view.engine}</span>
          <span className="hidden @xl:block mt-0.5 font-mono text-[10.5px] text-slate-500 truncate">{view.model || 'model not set'}</span>
        </span>
      </span>
      <span className="mt-2 @xl:mt-2.5 flex items-end gap-2 min-w-0">
        <span className="hidden @2xl:block flex-1 min-w-0">
          <Sparkline values={view.times} active={active} />
        </span>
        <span className="min-w-0 @2xl:shrink-0 @2xl:text-right leading-tight">
          <span className={`flex items-center @2xl:justify-end gap-1.5 text-[11px] min-w-0 ${TONE_TEXT[word.tone]}`}>
            <span
              className={`w-1.5 h-1.5 shrink-0 rounded-full ${
                status === 'ok' ? 'bg-emerald-400 api-live-dot' : word.tone === 'warn' ? 'bg-amber-400' : word.tone === 'error' ? 'bg-rose-400' : 'bg-slate-500'
              }`}
            />
            <span className="truncate">{status === 'ok' ? 'Live' : word.word}</span>
          </span>
          {status === 'ok' && view.row?.latencyMs ? (
            <span className="hidden @xl:block font-mono text-[11px] text-slate-400">{formatLatency(view.row.latencyMs)}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
};

/** A plan's allowance on one line: name, bar, what is left, when it resets. */
const UsageMeter: React.FC<{ label: string; share: number; value: string; unit: string; note?: string }> = ({ label, share, value, unit, note }) => (
  <div className="min-h-11 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-800 bg-slate-800/25 px-3.5 py-2.5">
    <span className="shrink-0 text-[11.5px] text-slate-400">{label}</span>
    <span className="flex-1 min-w-[6rem] h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <span
        className={`block h-full rounded-full ${share < 0.1 ? 'bg-rose-400' : share < 0.25 ? 'bg-amber-400' : 'bg-gradient-to-r from-emerald-500 to-emerald-300'}`}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
      />
    </span>
    <span className="shrink-0 whitespace-nowrap">
      <span className="font-mono text-[13px] font-semibold text-slate-100">{value}</span> <span className="text-[11px] text-slate-500">{unit}</span>
    </span>
    {note && <span className="shrink-0 text-[11px] text-slate-500 whitespace-nowrap">{note}</span>}
  </div>
);

/** 61840 -> "62K", 5895000 -> "5.9M". */
const compactCount = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
