import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Key,
  Mic,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Search,
  Play,
  Square,
  SlidersHorizontal,
  Check,
  ShieldCheck,
  ArrowUpDown,
  User,
  Layers,
  Volume2,
  Lock,
} from 'lucide-react';
import {
  Voice,
  ElevenLabsModel,
  ElevenLabsUser,
  ElevenLabsVoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  MIN_VOICE_SPEED,
  MAX_VOICE_SPEED,
  ALL_ELEVENLABS_MODELS,
  validateApiKey,
  getModels,
  getVoices,
  synthesizeSamplePreview,
  getVoiceSettings,
} from '../services/elevenLabsService';
import { isServerManagedKey } from '../services/apiClient';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Read-only here: the key is entered in API Settings, not in this modal. */
  elApiKey: string;
  elVoiceId: string;
  onElVoiceIdChange: (voiceId: string) => void;
  elModelId: string;
  onElModelIdChange: (modelId: string) => void;
  /** Null means the selected voice's own ElevenLabs settings are used. */
  elVoiceSettings?: ElevenLabsVoiceSettings | null;
  onElVoiceSettingsChange?: (settings: ElevenLabsVoiceSettings | null) => void;
  availableVoices: Voice[];
  isLoadingVoices: boolean;
  onRefreshVoices: () => void;
  /** Opens the API & translation engine dialog. Hidden when keys are env-managed. */
  onOpenApiSettings?: () => void;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  elApiKey,
  elVoiceId,
  onElVoiceIdChange,
  elModelId,
  onElModelIdChange,
  elVoiceSettings = null,
  onElVoiceSettingsChange,
  availableVoices,
  isLoadingVoices,
  onRefreshVoices,
  onOpenApiSettings,
}) => {
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'cloned' | 'premade' | 'generated'>('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // Alphabetical sorting default: Ascending (A-Z)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isAuditioningCustom, setIsAuditioningCustom] = useState<string | null>(null);

  // API Validation State
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<ElevenLabsUser | null>(null);

  // Dynamic Models List from ElevenLabs API
  const [modelsList, setModelsList] = useState<ElevenLabsModel[]>(ALL_ELEVENLABS_MODELS);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);

  // Real-time fetched voices list
  const [realtimeVoices, setRealtimeVoices] = useState<Voice[]>([]);
  const [isFetchingRealtimeVoices, setIsFetchingRealtimeVoices] = useState<boolean>(false);

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  /*
   * The selected voice's own ElevenLabs settings. They are what a dub uses
   * until the sliders are moved, so the sliders show them rather than a
   * generic default.
   */
  const [voiceOwnSettings, setVoiceOwnSettings] = useState<ElevenLabsVoiceSettings | null>(null);
  useEffect(() => {
    if (!isOpen || !elVoiceId) return;
    let cancelled = false;
    setVoiceOwnSettings(null);
    getVoiceSettings(elApiKey, elVoiceId)
      .then((settings) => !cancelled && setVoiceOwnSettings(settings))
      .catch(() => !cancelled && setVoiceOwnSettings(null));
    return () => {
      cancelled = true;
    };
  }, [isOpen, elApiKey, elVoiceId]);

  const usingVoiceOwnSettings = !elVoiceSettings;
  const shownSettings = elVoiceSettings || voiceOwnSettings || DEFAULT_VOICE_SETTINGS;

  // Validate API key and fetch real-time voices & all models
  const handleValidateApiKey = useCallback(
    async (keyToValidate: string) => {
      const cleanKey = keyToValidate.trim();
      if (!cleanKey) {
        setValidationStatus('idle');
        setValidationError(null);
        setUserInfo(null);
        setRealtimeVoices([]);
        return;
      }

      setValidationStatus('validating');
      setValidationError(null);

      try {
        const result = await validateApiKey(cleanKey);
        if (result.isValid && result.user) {
          setValidationStatus('valid');
          setUserInfo(result.user);
          setValidationError(null);

          // Fetch real-time voices and all models simultaneously
          setIsFetchingRealtimeVoices(true);
          setIsLoadingModels(true);

          const [voices, models] = await Promise.all([
            getVoices(cleanKey),
            getModels(cleanKey),
          ]);

          setRealtimeVoices(voices);
          setIsFetchingRealtimeVoices(false);

          if (models && models.length > 0) {
            setModelsList(models);
          }
          setIsLoadingModels(false);

          // Ensure an active voice ID is chosen from real-time voices if none or invalid
          if (voices.length > 0) {
            const hasCurrent = voices.some((v) => v.voice_id === elVoiceId);
            if (!hasCurrent) {
              onElVoiceIdChange(voices[0].voice_id);
            }
          }
        } else {
          setValidationStatus('invalid');
          setValidationError(result.error || 'Invalid ElevenLabs API Key.');
          setUserInfo(null);
          setRealtimeVoices([]);
        }
      } catch (err: any) {
        setValidationStatus('invalid');
        setValidationError(err?.message || 'Failed to validate API key.');
        setUserInfo(null);
        setRealtimeVoices([]);
      }
    },
    [elVoiceId, onElVoiceIdChange]
  );

  // Auto-validate on modal open if API key is present
  useEffect(() => {
    if (isOpen && elApiKey && elApiKey.trim().length > 10 && validationStatus === 'idle') {
      handleValidateApiKey(elApiKey);
    }
  }, [isOpen, elApiKey, handleValidateApiKey, validationStatus]);

  // Combine voices from prop or local real-time query
  const effectiveVoicesSource = useMemo(() => {
    if (realtimeVoices.length > 0) return realtimeVoices;
    if (availableVoices.length > 0) return availableVoices;
    return [];
  }, [realtimeVoices, availableVoices]);

  // Transform and sort voices ALPHABETICALLY (A to Z or Z to A)
  const sortedAndFilteredVoices = useMemo(() => {
    // Only show voices if validated
    if (validationStatus !== 'valid' && effectiveVoicesSource.length === 0) {
      return [];
    }

    const q = voiceSearchQuery.trim().toLowerCase();

    // 1. Map to structured voice items
    const formatted = effectiveVoicesSource.map((v) => {
      const labels = v.labels || {};
      const descParts = [
        labels.accent,
        labels.gender,
        labels.age,
        labels.use_case || labels.description,
      ].filter(Boolean);

      return {
        id: v.voice_id,
        name: v.name || 'Unnamed Voice',
        category: (v.category || 'custom').toLowerCase(),
        preview_url: v.preview_url,
        labels,
        desc: descParts.length > 0 ? descParts.join(' • ') : undefined,
      };
    });

    // 2. Filter by category & search query
    const filtered = formatted.filter((v) => {
      if (categoryFilter !== 'all') {
        const cat = v.category;
        if (categoryFilter === 'cloned' && !cat.includes('clon') && !cat.includes('professional')) return false;
        if (categoryFilter === 'premade' && !cat.includes('premade')) return false;
        if (categoryFilter === 'generated' && !cat.includes('generated') && !cat.includes('custom')) return false;
      }

      if (!q) return true;

      const matchName = v.name.toLowerCase().includes(q);
      const matchDesc = (v.desc || '').toLowerCase().includes(q);
      const matchCat = v.category.includes(q);
      const matchLabels = Object.values(v.labels || {}).some(
        (val) => typeof val === 'string' && val.toLowerCase().includes(q)
      );

      return matchName || matchDesc || matchCat || matchLabels;
    });

    // 3. Sort ALPHABETICALLY by voice name (A to Z or Z to A)
    return filtered.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [effectiveVoicesSource, validationStatus, voiceSearchQuery, categoryFilter, sortOrder]);

  // Find currently selected voice details
  const selectedVoice = useMemo(() => {
    return sortedAndFilteredVoices.find((v) => v.id === elVoiceId) ||
      effectiveVoicesSource.find((v) => v.voice_id === elVoiceId) ||
      null;
  }, [sortedAndFilteredVoices, effectiveVoicesSource, elVoiceId]);

  // Audio sample playback handling
  const handlePlayVoicePreview = (voiceId: string, previewUrl?: string) => {
    if (playingVoiceId === voiceId) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
      }
      setPlayingVoiceId(null);
      return;
    }

    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }

    if (previewUrl) {
      const audio = new Audio(previewUrl);
      audioPreviewRef.current = audio;
      setPlayingVoiceId(voiceId);
      audio.play().catch((err) => {
        console.warn('Voice preview playback failed:', err);
        setPlayingVoiceId(null);
      });
      audio.onended = () => {
        setPlayingVoiceId(null);
        audioPreviewRef.current = null;
      };
    }
  };

  // Live TTS voice audition generator
  const handleSynthesizeQuickSample = async (voiceId: string) => {
    if (!elApiKey || isAuditioningCustom) return;
    setIsAuditioningCustom(voiceId);

    try {
      const blob = await synthesizeSamplePreview(
        elApiKey,
        voiceId,
        'Hello, this is a real-time speech preview from your ElevenLabs account.',
        elModelId
      );
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      audioPreviewRef.current = audio;
      setPlayingVoiceId(voiceId);
      audio.play();
      audio.onended = () => {
        setPlayingVoiceId(null);
        setIsAuditioningCustom(null);
        URL.revokeObjectURL(url);
      };
    } catch (e: any) {
      console.warn('Custom preview synthesis error:', e);
      alert(`Could not synthesize preview: ${e?.message || 'Unknown error'}`);
    } finally {
      setIsAuditioningCustom(null);
    }
  };

  const handleManualRefresh = async () => {
    if (elApiKey) {
      await handleValidateApiKey(elApiKey);
      onRefreshVoices();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="voice-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30 shrink-0">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-display">Dubbing Voice & Model Settings</h3>
              <p className="text-xs text-slate-400">
                Configure ElevenLabs validated realtime voices & all API models
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (audioPreviewRef.current) {
                audioPreviewRef.current.pause();
              }
              onClose();
            }}
            className="p-1.5 rounded-xl text-slate-400 hover:text-indigo-300 hover:bg-slate-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* ElevenLabs engine settings: the only speech engine. */}
          <div className="space-y-5">
            {/*
              Connection status only. The key itself is entered in API
              Settings (top bar), so it lives in one place instead of two.
            */}
            <div className="space-y-2.5 p-4 rounded-2xl bg-slate-950 border border-slate-800/90 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-indigo-400" />
                  <span>ElevenLabs Connection:</span>
                </label>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleValidateApiKey(elApiKey)}
                    disabled={validationStatus === 'validating'}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/50 disabled:opacity-40 text-slate-200 hover:text-indigo-200 font-semibold text-[11px] transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    {validationStatus === 'validating' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>{validationStatus === 'validating' ? 'Checking...' : 'Re-check'}</span>
                  </button>

                  {onOpenApiSettings && (
                    <button
                      type="button"
                      onClick={onOpenApiSettings}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] shadow-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Manage Key</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isServerManagedKey(elApiKey)
                  ? 'Using the ElevenLabs key held by the local server, set in API Settings.'
                  : 'Using a session key override; the stored key lives in API Settings.'}{' '}
                This panel only picks the voice and speech model.
              </p>

              {/* Validation Feedback & Account Tier details */}
              {validationStatus === 'valid' && userInfo && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs text-emerald-300">
                    <span className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>API Key Validated & Connected</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-900/60 border border-emerald-700 text-[10px] font-mono uppercase font-bold text-emerald-200">
                      Tier: {userInfo.subscription.tier || 'Active'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 border-t border-emerald-900/40">
                    <span className="text-slate-400">
                      Character Quota:{' '}
                      <strong className="text-white font-mono">
                        {userInfo.subscription.character_count.toLocaleString()} /{' '}
                        {userInfo.subscription.character_limit.toLocaleString()} chars
                      </strong>
                    </span>
                    <span className="text-slate-400 font-mono text-[10px]">
                      Status: <span className="text-emerald-400 font-semibold">{userInfo.subscription.status}</span>
                    </span>
                  </div>
                </div>
              )}

              {validationStatus === 'invalid' && validationError && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-start gap-2 text-xs text-rose-300 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Validation Failed</p>
                    <p className="text-[11px] text-rose-400/90 mt-0.5">{validationError}</p>
                  </div>
                </div>
              )}
            </div>

            {/* ALL MODELS IN API SUPPORT SECTION */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>ElevenLabs Speech Model (All API Models Supported):</span>
                </label>
                {isLoadingModels && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                    <span>Loading API models...</span>
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <select
                  value={elModelId}
                  onChange={(e) => onElModelIdChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 cursor-pointer shadow-inner"
                >
                  {modelsList.map((m) => (
                    <option key={m.model_id} value={m.model_id} className="bg-slate-900 text-white">
                      {m.name} ({m.model_id}) {m.token_cost_factor ? `• ${m.token_cost_factor}x cost` : ''}
                    </option>
                  ))}
                </select>

                {/* Active Model Description Card */}
                {(() => {
                  const currentModel = modelsList.find((m) => m.model_id === elModelId) || modelsList[0];
                  return currentModel ? (
                    <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-indigo-300">{currentModel.name}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-400 border border-indigo-800">
                          {currentModel.model_id}
                        </span>
                      </div>
                      {currentModel.description && (
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          {currentModel.description}
                        </p>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            {/* NATURAL ELEVENLABS VOICE SETTINGS & CALIBRATION */}
            <div className="space-y-3 pt-3 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200">
                    Voice Clarity & Natural Speech Settings
                  </span>
                </div>
                {onElVoiceSettingsChange && (
                  <button
                    type="button"
                    onClick={() => onElVoiceSettingsChange(null)}
                    disabled={usingVoiceOwnSettings}
                    className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors underline disabled:no-underline disabled:text-slate-500 disabled:cursor-default"
                  >
                    Reset to this voice's own settings
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400">
                {usingVoiceOwnSettings
                  ? voiceOwnSettings
                    ? "Using this voice's own ElevenLabs settings — the same as on the ElevenLabs website."
                    : "Using this voice's own ElevenLabs settings."
                  : 'Custom settings for this voice. Picking another voice goes back to its own settings.'}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                {/* Stability Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">Stability:</span>
                    <span className="font-mono text-indigo-400 font-bold">
                      {((shownSettings.stability ?? 0.5) * 100).toFixed(0)}% (
                      {(shownSettings.stability ?? 0.5) === 0.5 ? 'Natural' : (shownSettings.stability ?? 0.5) < 0.5 ? 'Expressive' : 'Steady'}
                      )
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={shownSettings.stability ?? 0.5}
                    onChange={(e) =>
                      onElVoiceSettingsChange?.({
                        ...shownSettings,
                        stability: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>0% Variable</span>
                    <span className="text-emerald-400">50% Default</span>
                    <span>100% Stable</span>
                  </div>
                </div>

                {/* Similarity / Clarity Boost */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">Clarity + Similarity:</span>
                    <span className="font-mono text-indigo-400 font-bold">
                      {((shownSettings.similarity_boost ?? 0.75) * 100).toFixed(0)}% (
                      {(shownSettings.similarity_boost ?? 0.75) === 0.75 ? 'Authentic' : 'Custom'}
                      )
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={shownSettings.similarity_boost ?? 0.75}
                    onChange={(e) =>
                      onElVoiceSettingsChange?.({
                        ...shownSettings,
                        similarity_boost: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>0% Low</span>
                    <span className="text-emerald-400">75% Default</span>
                    <span>100% High</span>
                  </div>
                </div>

                {/* Style Exaggeration */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">Style Exaggeration:</span>
                    <span className="font-mono text-indigo-400 font-bold">
                      {((shownSettings.style ?? 0.0) * 100).toFixed(0)}% (
                      {(shownSettings.style ?? 0.0) === 0.0 ? 'Natural Clean' : 'Exaggerated'}
                      )
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={shownSettings.style ?? 0.0}
                    onChange={(e) =>
                      onElVoiceSettingsChange?.({
                        ...shownSettings,
                        style: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span className="text-emerald-400">0% Natural (Recommended)</span>
                    <span>100% Dramatic</span>
                  </div>
                </div>

                {/* Speaking Speed */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">Speaking Speed:</span>
                    <span className="font-mono text-indigo-400 font-bold">
                      {(shownSettings.speed ?? 1.0).toFixed(2)}x (
                      {(() => {
                        const spd = shownSettings.speed ?? 1.0;
                        if (spd < 0.95) return 'Slower';
                        if (spd <= 1.05) return 'Natural';
                        return 'Faster';
                      })()}
                      )
                    </span>
                  </div>
                  <input
                    type="range"
                    min={MIN_VOICE_SPEED}
                    max={MAX_VOICE_SPEED}
                    step="0.01"
                    value={shownSettings.speed ?? 1.0}
                    onChange={(e) =>
                      onElVoiceSettingsChange?.({
                        ...shownSettings,
                        speed: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>0.70x Slow</span>
                    <span className="text-emerald-400">1.00x Natural (Default)</span>
                    <span>1.20x Fast</span>
                  </div>
                </div>

                {/* Speaker Boost Toggle */}
                <div className="flex items-center justify-between pt-2 sm:pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={shownSettings.use_speaker_boost !== false}
                      onChange={(e) =>
                        onElVoiceSettingsChange?.({
                          ...shownSettings,
                          use_speaker_boost: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded accent-indigo-600 bg-slate-800 border-slate-700 cursor-pointer"
                    />
                    <span className="text-xs text-slate-300 font-medium">
                      Speaker Boost (Acoustic Clarity)
                    </span>
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono">Default ON</span>
                </div>
              </div>
            </div>

            {/* REALTIME VOICES ONLY AFTER VALIDATION (ALPHABETICAL) */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Real-Time Voice Library (Alphabetically Sorted):</span>
                </label>
                {validationStatus === 'valid' && (
                  <button
                    type="button"
                    onClick={handleManualRefresh}
                    disabled={isFetchingRealtimeVoices || isLoadingVoices}
                    className="text-[11px] text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${
                        isFetchingRealtimeVoices || isLoadingVoices ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Refresh Live Voices</span>
                  </button>
                )}
              </div>

              {/* Gate: If Not Validated, Show Security Card */}
              {validationStatus !== 'valid' ? (
                <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 text-center space-y-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto">
                    <Lock className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">API Key Validation Required</h4>
                    <p className="text-[11px] text-slate-400 max-w-md mx-auto mt-0.5">
                      Real-time account voices, custom cloned voices, and the live catalog unlock
                      once your ElevenLabs key validates. Keys are managed in API Settings.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleValidateApiKey(elApiKey)}
                      disabled={validationStatus === 'validating'}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                    >
                      {validationStatus === 'validating' ? 'Checking...' : 'Re-check Key to Load Voices'}
                    </button>
                    {onOpenApiSettings && (
                      <button
                        type="button"
                        onClick={onOpenApiSettings}
                        className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-indigo-500/50 text-slate-200 hover:text-indigo-200 font-bold text-xs transition-all active:scale-95 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>Open API Settings</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Validated: Real-Time Alphabetical Voice List */
                <div className="space-y-2.5 animate-in fade-in">
                  {/* Search & Alphabetical Sort Controls */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={voiceSearchQuery}
                        onChange={(e) => setVoiceSearchQuery(e.target.value)}
                        placeholder="Search real-time voices (name, accent, gender, use case)..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all shadow-inner"
                      />
                      {voiceSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setVoiceSearchQuery('')}
                          className="absolute right-2.5 top-2.5 text-slate-400 hover:text-indigo-300 p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Sort Order Toggle (A-Z / Z-A) */}
                    <button
                      type="button"
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 hover:border-indigo-500 text-xs text-slate-300 hover:text-indigo-200 flex items-center gap-1.5 transition-all shadow-xs"
                      title="Toggle Alphabetical Sort Order"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-mono font-bold">{sortOrder === 'asc' ? 'A ➔ Z' : 'Z ➔ A'}</span>
                    </button>
                  </div>

                  {/* Category Filter Chips */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider mr-1">
                        Category:
                      </span>
                      {(['all', 'cloned', 'premade', 'generated'] as const).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCategoryFilter(cat)}
                          className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                            categoryFilter === cat
                              ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                              : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          {cat === 'all'
                            ? 'All Voices'
                            : cat === 'cloned'
                            ? 'My Clones / Custom'
                            : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                      ))}
                    </div>

                    <span className="text-[10px] text-slate-400 font-mono">
                      {sortedAndFilteredVoices.length} of {effectiveVoicesSource.length} voices
                    </span>
                  </div>

                  {/* Scrollable Alphabetical Voice Cards List */}
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 border border-slate-800 rounded-2xl p-2 bg-slate-950/70 divide-y divide-slate-800/40">
                    {isFetchingRealtimeVoices ? (
                      <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-400 mx-auto" />
                        <p>Fetching real-time voices from your ElevenLabs account...</p>
                      </div>
                    ) : sortedAndFilteredVoices.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400">
                        <p>No voices found matching &quot;{voiceSearchQuery}&quot;</p>
                        <button
                          type="button"
                          onClick={() => {
                            setVoiceSearchQuery('');
                            setCategoryFilter('all');
                          }}
                          className="mt-1.5 text-indigo-400 hover:underline text-[11px]"
                        >
                          Reset filters
                        </button>
                      </div>
                    ) : (
                      sortedAndFilteredVoices.map((v) => {
                        const isSelected = v.id === elVoiceId;
                        const isPlaying = playingVoiceId === v.id;
                        const isAuditioning = isAuditioningCustom === v.id;

                        return (
                          <div
                            key={v.id}
                            onClick={() => onElVoiceIdChange(v.id)}
                            className={`voice-item-card p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2.5 ${
                              isSelected
                                ? 'bg-indigo-600/20 border border-indigo-500/70 text-white shadow-xs ring-1 ring-indigo-500/40'
                                : 'hover:bg-slate-900/90 text-slate-300 border border-transparent'
                            }`}
                          >
                            {/* Left: Radio/Check + Info */}
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? 'border-indigo-400 bg-indigo-600 text-white'
                                    : 'border-slate-600 bg-slate-950'
                                }`}
                              >
                                {isSelected && <Check className="w-2.5 h-2.5" />}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold truncate">{v.name}</span>
                                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase">
                                    {v.category}
                                  </span>
                                </div>
                                {v.desc && (
                                  <p className="text-[10px] text-slate-400 truncate mt-0.5">{v.desc}</p>
                                )}
                              </div>
                            </div>

                            {/* Right: Real-time Audio Preview Action */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {v.preview_url ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePlayVoicePreview(v.id, v.preview_url);
                                  }}
                                  className={`px-2 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-all ${
                                    isPlaying
                                      ? 'bg-amber-500 text-slate-950 border-amber-400 animate-pulse'
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 hover:border-indigo-500/40 hover:text-indigo-200'
                                  }`}
                                  title="Listen to official voice preview sample"
                                >
                                  {isPlaying ? (
                                    <Square className="w-3 h-3 fill-current" />
                                  ) : (
                                    <Play className="w-3 h-3 fill-current text-indigo-400" />
                                  )}
                                  <span className="text-[10px]">Preview</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSynthesizeQuickSample(v.id);
                                  }}
                                  disabled={isAuditioning}
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-indigo-500/40 text-slate-300 hover:text-indigo-200 text-xs font-semibold flex items-center gap-1 transition-all"
                                  title="Generate live TTS audition"
                                >
                                  {isAuditioning ? (
                                    <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                                  ) : (
                                    <Volume2 className="w-3 h-3 text-indigo-400" />
                                  )}
                                  <span className="text-[10px]">Audition</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Active Selected Voice Summary Card */}
                  {selectedVoice && (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-indigo-950/40 border border-indigo-800/50 text-[11px]">
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-slate-400">Selected Voice:</span>
                        <span className="font-bold text-indigo-300 truncate">{selectedVoice.name}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300">
                          {'voice_id' in selectedVoice ? selectedVoice.voice_id : selectedVoice.id}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 font-semibold shrink-0">
                        Ready for Synthesis
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between">
          <p className="text-[11px] text-slate-500 font-mono">
            {`Model: ${elModelId} • Voice: ${selectedVoice?.name || elVoiceId}`}
          </p>
          <button
            type="button"
            onClick={() => {
              if (audioPreviewRef.current) {
                audioPreviewRef.current.pause();
              }
              onClose();
            }}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all active:scale-95"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};
