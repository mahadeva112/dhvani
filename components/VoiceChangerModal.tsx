import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  X,
  Mic,
  Upload,
  Play,
  Square,
  RefreshCw,
  Download,
  Check,
  Volume2,
  Sliders,
  AudioWaveform,
  Radio,
  UserPlus,
  AlertCircle,
  ChevronRight,
  Layers,
  Search,
  Filter,
  Star,
} from 'lucide-react';
import {
  speechToSpeech,
  cloneVoiceFromAudio,
  Voice,
  ElevenLabsVoiceSettings,
  DEFAULT_VOICE_SETTINGS,
} from '../services/elevenLabsService';
import {
  applyVoiceEffectToBuffer,
  audioBufferToWav,
  decodeAudioBlobUrl,
  VoiceEffectPreset,
} from '../services/audioService';
import { POPULAR_ELEVENLABS_VOICES } from './VoiceSelectorCard';
import { useFavoriteVoices } from '../services/favoriteVoicesService';

interface VoiceChangerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeAudioFile?: File | null;
  activeAudioBuffer?: AudioBuffer | null;
  availableVoices: Voice[];
  selectedVoiceId: string;
  elApiKey: string;
  onSelectVoiceId: (id: string) => void;
  onApplyTransformedAudio: (file: File, buffer: AudioBuffer) => void;
  onSetDubbedMaster?: (audioBlob: Blob, audioBuffer: AudioBuffer) => void;
  onRefreshVoices?: () => Promise<void>;
}

type ModeTab = 'sts' | 'clone' | 'effects';

export const VoiceChangerModal: React.FC<VoiceChangerModalProps> = ({
  isOpen,
  onClose,
  activeAudioFile,
  activeAudioBuffer,
  availableVoices,
  selectedVoiceId,
  elApiKey,
  onSelectVoiceId,
  onApplyTransformedAudio,
  onSetDubbedMaster,
  onRefreshVoices,
}) => {
  const [activeTab, setActiveTab] = useState<ModeTab>('sts');

  // Source audio state
  const [sourceAudioFile, setSourceAudioFile] = useState<File | null>(activeAudioFile || null);
  const [sourceAudioUrl, setSourceAudioUrl] = useState<string | null>(null);
  const [sourceAudioBuffer, setSourceAudioBuffer] = useState<AudioBuffer | null>(
    activeAudioBuffer || null
  );

  // Target voice state for STS
  const [targetVoiceId, setTargetVoiceId] = useState<string>(selectedVoiceId || 'CwhRBWXzGAHq8TQ4Fs17');
  const [stsModelId, setStsModelId] = useState<string>('eleven_multilingual_sts_v2');
  const [stability, setStability] = useState<number>(0.5);
  const [similarity, setSimilarity] = useState<number>(0.75);
  const [removeBackgroundNoise, setRemoveBackgroundNoise] = useState<boolean>(false);

  // Target Voice Search & Category Filters
  const [voiceSearchQuery, setVoiceSearchQuery] = useState<string>('');
  const [voiceCategoryFilter, setVoiceCategoryFilter] = useState<string>('all');

  // Favourites, shared with the text-to-speech voice picker
  const { favorites, isFavorite, toggleFavorite } = useFavoriteVoices();

  const handleToggleFavorite = (voice: Voice) => {
    toggleFavorite({
      id: voice.voice_id,
      name: voice.name,
      category: voice.category,
      gender: voice.labels?.gender,
      accent: voice.labels?.accent,
      previewUrl: voice.preview_url,
    });
  };

  // Unified & filtered list of voices
  const allAvailableVoices = useMemo<Voice[]>(() => {
    if (availableVoices && availableVoices.length > 0) {
      return availableVoices;
    }
    return POPULAR_ELEVENLABS_VOICES.map((v) => ({
      voice_id: v.id,
      name: v.name,
      category: v.category,
      labels: {
        accent: v.accent,
        gender: v.gender,
        description: v.desc,
        ...v.labels,
      },
      preview_url: v.previewUrl,
    }));
  }, [availableVoices]);

  const filteredVoices = useMemo<Voice[]>(() => {
    const q = voiceSearchQuery.trim().toLowerCase();

    const matched = allAvailableVoices.filter((voice) => {
      // Category / Gender filter
      if (voiceCategoryFilter === 'favorites') {
        if (!isFavorite(voice.voice_id)) return false;
      } else if (voiceCategoryFilter === 'cloned') {
        if (voice.category !== 'cloned') return false;
      } else if (voiceCategoryFilter === 'premade') {
        if (voice.category !== 'premade') return false;
      } else if (voiceCategoryFilter === 'female') {
        const g = (voice.labels?.gender || '').toLowerCase();
        if (!g.includes('female')) return false;
      } else if (voiceCategoryFilter === 'male') {
        const g = (voice.labels?.gender || '').toLowerCase();
        if (!g.includes('male') || g.includes('female')) return false;
      } else if (voiceCategoryFilter === 'narration') {
        const u = (
          (voice.labels?.use_case || '') +
          ' ' +
          (voice.labels?.description || '') +
          ' ' +
          (voice.category || '')
        ).toLowerCase();
        if (!u.includes('narrat') && !u.includes('audiobook') && !u.includes('story') && !u.includes('deep')) {
          return false;
        }
      }

      // Search keyword filter
      if (!q) return true;

      const nameMatch = (voice.name || '').toLowerCase().includes(q);
      const accentMatch = (voice.labels?.accent || '').toLowerCase().includes(q);
      const genderMatch = (voice.labels?.gender || '').toLowerCase().includes(q);
      const descMatch = (voice.labels?.description || '').toLowerCase().includes(q);
      const useCaseMatch = (voice.labels?.use_case || '').toLowerCase().includes(q);
      const catMatch = (voice.category || '').toLowerCase().includes(q);

      return nameMatch || accentMatch || genderMatch || descMatch || useCaseMatch || catMatch;
    });

    // Favourites float to the top so a saved voice is always one glance away.
    return [...matched].sort(
      (a, b) => Number(isFavorite(b.voice_id)) - Number(isFavorite(a.voice_id))
    );
  }, [allAvailableVoices, voiceSearchQuery, voiceCategoryFilter, isFavorite]);

  /** Favourites resolved against the live library, for the quick-pick row. */
  const favoriteVoices = useMemo<Voice[]>(() => {
    return favorites.map((fav) => {
      const live = allAvailableVoices.find((v) => v.voice_id === fav.id);
      if (live) return live;
      return {
        voice_id: fav.id,
        name: fav.name || fav.id,
        category: fav.category,
        labels: { gender: fav.gender, accent: fav.accent },
        preview_url: fav.previewUrl,
      } as Voice;
    });
  }, [favorites, allAvailableVoices]);

  // Voice cloning state
  const [cloneName, setCloneName] = useState<string>('');
  const [cloneDescription, setCloneDescription] = useState<string>('');
  const [cloneGender, setCloneGender] = useState<string>('unspecified');
  const [cloneAccent, setCloneAccent] = useState<string>('American');
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);

  // DSP effect preset
  const [selectedEffect, setSelectedEffect] = useState<VoiceEffectPreset>('deep');

  // Mic recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordDuration, setRecordDuration] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  // Result output state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outputBuffer, setOutputBuffer] = useState<AudioBuffer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Audio Playback state (A/B comparison)
  const [playingTrack, setPlayingTrack] = useState<'source' | 'output' | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [auditionVoiceId, setAuditionVoiceId] = useState<string | null>(null);
  const auditionPlayerRef = useRef<HTMLAudioElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cloneFileInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize source audio if active file changes
  useEffect(() => {
    if (activeAudioFile) {
      setSourceAudioFile(activeAudioFile);
      const url = URL.createObjectURL(activeAudioFile);
      setSourceAudioUrl(url);
      if (activeAudioBuffer) {
        setSourceAudioBuffer(activeAudioBuffer);
      } else {
        decodeAudioBlobUrl(url)
          .then((buf) => setSourceAudioBuffer(buf))
          .catch(() => {});
      }
      return () => URL.revokeObjectURL(url);
    }
  }, [activeAudioFile, activeAudioBuffer]);

  // Sync selected voice
  useEffect(() => {
    if (selectedVoiceId) {
      setTargetVoiceId(selectedVoiceId);
    }
  }, [selectedVoiceId]);

  if (!isOpen) return null;

  // Handle custom file upload for source
  const handleCustomFileUpload = async (file: File) => {
    setErrorMessage(null);
    setSourceAudioFile(file);
    const url = URL.createObjectURL(file);
    setSourceAudioUrl(url);
    try {
      const buf = await decodeAudioBlobUrl(url);
      setSourceAudioBuffer(buf);
    } catch {
      // ignore
    }
  };

  // Handle mic recording
  const startRecording = async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/wav' });
        const recordedFile = new File([audioBlob], `recorded_voice_${Date.now()}.wav`, {
          type: 'audio/wav',
        });
        await handleCustomFileUpload(recordedFile);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordDuration(0);
      timerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setErrorMessage(
        err.message || 'Microphone access denied. Please allow microphone permissions.'
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  // Playback control
  const playTrack = (track: 'source' | 'output') => {
    if (playingTrack === track) {
      audioPlayerRef.current?.pause();
      setPlayingTrack(null);
      return;
    }

    const url = track === 'source' ? sourceAudioUrl : outputUrl;
    if (!url) return;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.src = url;
      audioPlayerRef.current.play();
      setPlayingTrack(track);
      audioPlayerRef.current.onended = () => setPlayingTrack(null);
    }
  };

  // Audition preview voice
  const handleAuditionVoice = (voice: Voice) => {
    if (auditionVoiceId === voice.voice_id) {
      auditionPlayerRef.current?.pause();
      setAuditionVoiceId(null);
      return;
    }

    if (voice.preview_url) {
      if (!auditionPlayerRef.current) {
        auditionPlayerRef.current = new Audio();
      }
      auditionPlayerRef.current.src = voice.preview_url;
      auditionPlayerRef.current.play();
      setAuditionVoiceId(voice.voice_id);
      auditionPlayerRef.current.onended = () => setAuditionVoiceId(null);
    }
  };

  // EXECUTE: Speech-to-Speech
  const handleRunSpeechToSpeech = async () => {
    if (!sourceAudioFile && !sourceAudioBuffer) {
      setErrorMessage('Please provide or record speech audio first.');
      return;
    }
    try {
      setIsProcessing(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setProcessingStatus('Uploading audio & converting voice with ElevenLabs STS...');

      let audioBlob: Blob;
      if (sourceAudioFile) {
        audioBlob = sourceAudioFile;
      } else {
        audioBlob = audioBufferToWav(sourceAudioBuffer!);
      }

      const settings: ElevenLabsVoiceSettings = {
        stability,
        similarity_boost: similarity,
        style: 0.0,
        use_speaker_boost: true,
      };

      const resultBlob = await speechToSpeech(
        elApiKey,
        targetVoiceId,
        audioBlob,
        stsModelId,
        settings,
        removeBackgroundNoise
      );

      const url = URL.createObjectURL(resultBlob);
      setOutputBlob(resultBlob);
      setOutputUrl(url);

      const buf = await decodeAudioBlobUrl(url);
      setOutputBuffer(buf);

      setSuccessMessage('Voice converted successfully! Listen to the preview below.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Speech-to-Speech conversion failed.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // EXECUTE: Clone Voice from Audio
  const handleRunVoiceClone = async () => {
    if (!cloneName.trim()) {
      setErrorMessage('Please enter a name for the new cloned voice.');
      return;
    }
    const samples = cloneFiles.length > 0 ? cloneFiles : sourceAudioFile ? [sourceAudioFile] : [];
    if (samples.length === 0) {
      setErrorMessage('Please upload or select an audio sample to clone.');
      return;
    }
    try {
      setIsProcessing(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setProcessingStatus('Extracting vocal timbre and creating clone in ElevenLabs...');

      const labels: Record<string, string> = {};
      if (cloneGender !== 'unspecified') labels.gender = cloneGender;
      if (cloneAccent) labels.accent = cloneAccent;

      const result = await cloneVoiceFromAudio(
        elApiKey,
        cloneName,
        samples,
        cloneDescription || 'Cloned in DHVANI Voice Studio',
        labels
      );

      if (onRefreshVoices) {
        await onRefreshVoices();
      }

      onSelectVoiceId(result.voice_id);
      setTargetVoiceId(result.voice_id);
      setSuccessMessage(`Voice "${result.name}" cloned and activated successfully!`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Voice cloning failed.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // EXECUTE: DSP Voice Modulation
  const handleRunDspEffect = async () => {
    if (!sourceAudioBuffer && !sourceAudioFile) {
      setErrorMessage('Please upload or provide an audio file first.');
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setProcessingStatus(`Applying ${selectedEffect.toUpperCase()} voice modulation...`);

      let buffer = sourceAudioBuffer;
      if (!buffer && sourceAudioFile) {
        const url = URL.createObjectURL(sourceAudioFile);
        buffer = await decodeAudioBlobUrl(url);
        setSourceAudioBuffer(buffer);
      }

      if (!buffer) throw new Error('Could not decode audio buffer.');

      const modulatedBuffer = await applyVoiceEffectToBuffer(buffer, selectedEffect);
      const wavBlob = audioBufferToWav(modulatedBuffer);
      const url = URL.createObjectURL(wavBlob);

      setOutputBuffer(modulatedBuffer);
      setOutputBlob(wavBlob);
      setOutputUrl(url);

      setSuccessMessage(`Applied ${selectedEffect.toUpperCase()} voice modulation successfully!`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Audio effect processing failed.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  // Apply to project
  const handleApplyToProject = () => {
    if (!outputBlob || !outputBuffer) return;
    const fileName = `voice_changed_${Date.now()}.wav`;
    const newFile = new File([outputBlob], fileName, { type: 'audio/wav' });
    onApplyTransformedAudio(newFile, outputBuffer);
    onClose();
  };

  const handleSetMasterDub = () => {
    // The host needs the decoded buffer, not a URL: it drives the waveform and
    // the synth track. It mints its own object URL from the blob.
    if (!outputBlob || !outputBuffer || !onSetDubbedMaster) return;
    onSetDubbedMaster(outputBlob, outputBuffer);
    onClose();
  };

  const handleDownloadOutput = () => {
    if (!outputBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(outputBlob);
    a.download = `voice_transformed_${Date.now()}.wav`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden Audio Players */}
        <audio ref={audioPlayerRef} />

        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
              <AudioWaveform className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white font-display flex items-center gap-2">
                <span>Voice Studio: Change Voice from Audio</span>
              </h2>
              <p className="text-xs text-slate-400">
                Transform speech into a new voice identity, clone voices from clips, or apply DSP effects
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Navigation Tabs */}
        <div className="px-4 pt-3 border-b border-slate-800/80 bg-slate-950/40 flex items-center gap-2">
          <button
            onClick={() => setActiveTab('sts')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'sts'
                ? 'border-indigo-500 text-indigo-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <AudioWaveform className="w-4 h-4 text-indigo-400" />
            <span>Speech-to-Speech (AI Voice Changer)</span>
          </button>

          <button
            onClick={() => setActiveTab('clone')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'clone'
                ? 'border-indigo-500 text-indigo-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <UserPlus className="w-4 h-4 text-purple-400" />
            <span>Clone Voice from Audio</span>
          </button>

          <button
            onClick={() => setActiveTab('effects')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === 'effects'
                ? 'border-indigo-500 text-indigo-300 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Instant Audio DSP Filters</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 custom-scrollbar">
          {/* Status Alerts */}
          {errorMessage && (
            <div className="p-3 bg-red-950/40 border border-red-800/80 rounded-xl flex items-start gap-2.5 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-xl flex items-start gap-2.5 text-xs text-emerald-300">
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* SECTION 1: Source Audio Selector */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  1. Source Speech Audio
                </span>
                {sourceAudioFile && (
                  <span className="text-xs font-mono text-cyan-300 bg-cyan-950/80 border border-cyan-800/80 px-2 py-0.5 rounded-md truncate max-w-xs">
                    {sourceAudioFile.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {sourceAudioUrl && (
                  <button
                    type="button"
                    onClick={() => playTrack('source')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      playingTrack === 'source'
                        ? 'bg-amber-500 text-white border-amber-400 animate-pulse'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
                    }`}
                  >
                    {playingTrack === 'source' ? (
                      <>
                        <Square className="w-3.5 h-3.5 fill-current" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Play Original</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 text-xs font-semibold cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Choose Other File</span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleCustomFileUpload(e.target.files[0]);
                  }}
                  className="hidden"
                />

                {/* Mic Recorder */}
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    isRecording
                      ? 'bg-red-600 text-white border-red-500 animate-pulse'
                      : 'bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{isRecording ? `Recording (${recordDuration}s)...` : 'Record Mic'}</span>
                </button>
              </div>
            </div>

            {!sourceAudioFile && !sourceAudioBuffer && (
              <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-lg">
                No audio loaded. Upload an audio file or record your microphone to begin voice conversion.
              </div>
            )}
          </div>

          {/* TAB 1: SPEECH TO SPEECH (AI VOICE CHANGER) */}
          {activeTab === 'sts' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                {/* Voice Selection Header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      2. Select Target Voice Model
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-cyan-300">
                      {filteredVoices.length} {filteredVoices.length === 1 ? 'voice' : 'voices'}
                    </span>
                  </div>

                  {onRefreshVoices && (
                    <button
                      type="button"
                      onClick={() => onRefreshVoices()}
                      title="Refresh voice library from ElevenLabs API"
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 hover:bg-slate-900 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Sync Library</span>
                    </button>
                  )}
                </div>

                {/* QUICK PICK: one click to switch between favourite voices */}
                {favoriteVoices.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] uppercase font-bold text-amber-400/90 tracking-wider flex items-center gap-1 shrink-0">
                      <Star className="w-3 h-3 fill-current" /> Favourites:
                    </span>
                    {favoriteVoices.map((v) => {
                      const isActive = targetVoiceId === v.voice_id;
                      return (
                        <button
                          key={v.voice_id}
                          type="button"
                          onClick={() => setTargetVoiceId(v.voice_id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                            isActive
                              ? 'bg-cyan-600 text-white border-cyan-500 shadow-xs'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-200 border-slate-800 hover:border-cyan-500/40'
                          }`}
                          title={`Convert into ${v.name}`}
                        >
                          {isActive && <Check className="w-3 h-3 shrink-0" />}
                          <span className="truncate max-w-[9rem]">{v.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Voice Search Input & Category Filters */}
                <div className="space-y-2">
                  {/* Search bar */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={voiceSearchQuery}
                      onChange={(e) => setVoiceSearchQuery(e.target.value)}
                      placeholder="Search voice by name, accent (e.g. British), gender, narration..."
                      className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-inner"
                    />
                    {voiceSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setVoiceSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded-md hover:bg-slate-800 transition-colors"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Category Filter Chips */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] no-scrollbar">
                    {[
                      { id: 'all', label: 'All Voices' },
                      {
                        id: 'favorites',
                        label: `★ Favourites${favorites.length > 0 ? ` (${favorites.length})` : ''}`,
                      },
                      { id: 'premade', label: 'Premade' },
                      { id: 'cloned', label: 'Cloned / Custom' },
                      { id: 'female', label: 'Female' },
                      { id: 'male', label: 'Male' },
                      { id: 'narration', label: 'Narration & Deep' },
                    ].map((cat) => {
                      const isActive = voiceCategoryFilter === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setVoiceCategoryFilter(cat.id)}
                          className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all cursor-pointer ${
                            isActive
                              ? cat.id === 'favorites'
                                ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                                : 'bg-cyan-600 text-white font-semibold shadow-xs'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Voice Cards Grid */}
                {filteredVoices.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1 custom-scrollbar">
                    {filteredVoices.map((voice) => {
                      const isSelected = targetVoiceId === voice.voice_id;
                      const isAuditioning = auditionVoiceId === voice.voice_id;
                      const gender = voice.labels?.gender || (voice as any).gender || '';
                      const accent = voice.labels?.accent || (voice as any).accent || '';
                      const isCloned = voice.category === 'cloned';

                      return (
                        <div
                          key={voice.voice_id}
                          onClick={() => setTargetVoiceId(voice.voice_id)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-950/90 border-cyan-500 text-white shadow-md ring-1 ring-cyan-500/50'
                              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-850 text-slate-300'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold truncate text-white">{voice.name}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                              {isCloned && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60">
                                  Cloned
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 truncate">
                              {gender && <span className="capitalize">{gender}</span>}
                              {gender && accent && <span>•</span>}
                              {accent && <span>{accent}</span>}
                              {!gender && !accent && (
                                <span className="capitalize">{voice.category || 'Voice'}</span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavorite(voice);
                            }}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer shrink-0 ${
                              isFavorite(voice.voice_id)
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                                : 'bg-slate-950 hover:bg-slate-800 text-slate-500 hover:text-amber-200 border-slate-800 hover:border-amber-500/40'
                            }`}
                            title={
                              isFavorite(voice.voice_id)
                                ? 'Remove from favourites'
                                : 'Add to favourites'
                            }
                          >
                            <Star
                              className={`w-3 h-3 ${isFavorite(voice.voice_id) ? 'fill-current' : ''}`}
                            />
                          </button>

                          {voice.preview_url && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAuditionVoice(voice);
                              }}
                              className={`p-1.5 rounded-lg text-[10px] font-semibold border transition-all cursor-pointer shrink-0 ${
                                isAuditioning
                                  ? 'bg-amber-500 text-white border-amber-400 animate-pulse'
                                  : 'bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border-slate-800'
                              }`}
                              title={isAuditioning ? 'Stop audition' : 'Audition voice audio'}
                            >
                              {isAuditioning ? (
                                <Square className="w-3 h-3 fill-current" />
                              ) : (
                                <Volume2 className="w-3 h-3" />
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 px-4 text-center rounded-xl bg-slate-900/40 border border-dashed border-slate-800 space-y-2">
                    <Search className="w-6 h-6 text-slate-500 mx-auto opacity-60" />
                    {voiceCategoryFilter === 'favorites' && !voiceSearchQuery ? (
                      <>
                        <p className="text-xs text-slate-300 font-medium">No favourite voices yet</p>
                        <p className="text-[11px] text-slate-500">
                          Star a voice with the <Star className="w-3 h-3 inline -mt-0.5" /> button to pin it here
                          and in the dubbing voice picker.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-slate-300 font-medium">
                          No voices found matching <span className="text-cyan-400 font-mono font-bold">"{voiceSearchQuery}"</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Try searching with a different name, accent (e.g. American, British), or reset your filter.
                        </p>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceSearchQuery('');
                        setVoiceCategoryFilter('all');
                      }}
                      className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Reset Filters</span>
                    </button>
                  </div>
                )}

                {/* STS Model & Fine-Tuning Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800/80">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">
                      STS AI Engine
                    </label>
                    <select
                      value={stsModelId}
                      onChange={(e) => setStsModelId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="eleven_multilingual_sts_v2">
                        Eleven Multilingual STS v2 (Authentic Multilingual Nuance)
                      </option>
                      <option value="eleven_english_sts_v2">
                        Eleven English STS v2 (Optimized English Inflection)
                      </option>
                    </select>
                  </div>

                  <div className="flex items-center gap-4 pt-4">
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={removeBackgroundNoise}
                        onChange={(e) => setRemoveBackgroundNoise(e.target.checked)}
                        className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>Clean Background Noise in Audio</span>
                    </label>
                  </div>
                </div>

                {/* Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Vocal Stability (Cadence Match)</span>
                      <span className="font-mono text-indigo-400">{stability.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={stability}
                      onChange={(e) => setStability(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Similarity / Voice Authenticity</span>
                      <span className="font-mono text-indigo-400">{similarity.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={similarity}
                      onChange={(e) => setSimilarity(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handleRunSpeechToSpeech}
                disabled={isProcessing || !sourceAudioFile}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-sm font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-all active:scale-98"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{processingStatus || 'Converting Voice...'}</span>
                  </>
                ) : (
                  <>
                    <AudioWaveform className="w-4 h-4" />
                    <span>Transform Voice with ElevenLabs STS</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* TAB 2: CLONE VOICE FROM AUDIO */}
          {activeTab === 'clone' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Clone Voice Identity from Audio
                </span>
                <p className="text-xs text-slate-400">
                  Extract the unique vocal identity from your audio clip to create a permanent voice
                  model for all your dubbing projects.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">Voice Name</label>
                    <input
                      type="text"
                      value={cloneName}
                      onChange={(e) => setCloneName(e.target.value)}
                      placeholder="e.g. My Custom Narrator Voice"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-300 block mb-1">
                      Gender / Accent Tags
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={cloneGender}
                        onChange={(e) => setCloneGender(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="unspecified">Unspecified</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                      <input
                        type="text"
                        value={cloneAccent}
                        onChange={(e) => setCloneAccent(e.target.value)}
                        placeholder="Accent (e.g. British)"
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1">
                    Voice Sample Source
                  </label>
                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-300">
                      {cloneFiles.length > 0
                        ? `${cloneFiles.length} sample file(s) selected`
                        : sourceAudioFile
                        ? `Using current audio: ${sourceAudioFile.name}`
                        : 'No audio selected'}
                    </span>
                    <button
                      type="button"
                      onClick={() => cloneFileInputRef.current?.click()}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-md cursor-pointer"
                    >
                      Choose Other Sample
                    </button>
                    <input
                      ref={cloneFileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files) {
                          setCloneFiles(Array.from(e.target.files));
                        }
                      }}
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handleRunVoiceClone}
                disabled={isProcessing}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-400 text-white text-sm font-bold shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-all active:scale-98"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Cloning Voice Model...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Clone & Activate New Voice from Audio</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* TAB 3: INSTANT AUDIO DSP FILTERS */}
          {activeTab === 'effects' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Select Instant Audio Filter (No API Key Required)
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'deep', label: 'Deep Male Pitch', desc: 'Resonant bass & low timbre' },
                    { id: 'high', label: 'Higher Pitch', desc: 'Bright pitch shift & youthful tone' },
                    { id: 'studio', label: 'Studio Broadcast', desc: 'High-clarity air & compressor' },
                    { id: 'radio', label: 'Vintage Radio', desc: 'Bandpass telephone transceiver' },
                    { id: 'robot', label: 'Robot Vocoder', desc: 'Metallic ring modulation' },
                    { id: 'whisper', label: 'Whisper Texture', desc: 'Airy breath highpass filter' },
                  ].map((eff) => (
                    <div
                      key={eff.id}
                      onClick={() => setSelectedEffect(eff.id as VoiceEffectPreset)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        selectedEffect === eff.id
                          ? 'bg-cyan-950/80 border-cyan-500 text-white ring-1 ring-cyan-500/50'
                          : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <span className="text-xs font-bold block">{eff.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{eff.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <button
                type="button"
                onClick={handleRunDspEffect}
                disabled={isProcessing}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-sm font-bold shadow-lg shadow-cyan-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-all active:scale-98"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processing Audio Filter...</span>
                  </>
                ) : (
                  <>
                    <Sliders className="w-4 h-4" />
                    <span>Apply Audio Voice Filter</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* SECTION 3: Transformed Audio Preview & Direct Actions */}
          {outputUrl && (
            <div className="bg-slate-950 border border-indigo-900/60 rounded-xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                    <Check className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Transformed Audio Output Ready</h4>
                    <p className="text-[10px] text-slate-400">
                      Compare A/B with original speech, then apply to project
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* A/B Track Controls */}
                  <button
                    type="button"
                    onClick={() => playTrack('source')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      playingTrack === 'source'
                        ? 'bg-amber-500 text-white border-amber-400'
                        : 'bg-slate-900 text-slate-300 border-slate-800'
                    }`}
                  >
                    {playingTrack === 'source' ? 'Stop' : 'Play Original'}
                  </button>

                  <button
                    type="button"
                    onClick={() => playTrack('output')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all shadow-sm cursor-pointer ${
                      playingTrack === 'output'
                        ? 'bg-emerald-500 text-white border-emerald-400 animate-pulse'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
                    }`}
                  >
                    {playingTrack === 'output' ? 'Stop' : 'Play Transformed'}
                  </button>
                </div>
              </div>

              {/* Apply Actions Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleApplyToProject}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Use as Active Audio</span>
                </button>

                {onSetDubbedMaster && (
                  <button
                    type="button"
                    onClick={handleSetMasterDub}
                    className="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Set as Dubbed Master</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleDownloadOutput}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700 transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Audio</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
