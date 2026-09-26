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
  Sliders,
  AudioWaveform,
  Radio,
  UserPlus,
  AlertCircle,
  ArrowLeftRight,
  FileAudio,
  Film,
  ChevronsDown,
  ChevronsUp,
  Wind,
  Bot,
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
import { POPULAR_ELEVENLABS_VOICES, VoiceSelectorCard } from './VoiceSelectorCard';
import { MiniWaveform } from './MediaStrip';
import { useFavoriteVoices } from '../services/favoriteVoicesService';

/** The effects the audio engine offers, in the order shown. */
const EFFECTS: { id: VoiceEffectPreset; label: string; desc: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'studio', label: 'Studio broadcast', desc: 'Clear, close, even', Icon: Mic },
  { id: 'deep', label: 'Deeper', desc: 'Lower pitch, fuller', Icon: ChevronsDown },
  { id: 'high', label: 'Brighter', desc: 'Higher pitch, lighter', Icon: ChevronsUp },
  { id: 'radio', label: 'Vintage radio', desc: 'Warm, narrow, old set', Icon: Radio },
  { id: 'whisper', label: 'Whisper', desc: 'Airy and breathy', Icon: Wind },
  { id: 'robot', label: 'Robot', desc: 'Vocoder, metallic', Icon: Bot },
];

/** 125 -> "2:05", 3725 -> "1:02:05" */
const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const primaryButton =
  'h-[42px] px-[18px] flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer';

const actionButton =
  'w-full flex items-center gap-3 p-2.5 rounded-[11px] border border-slate-800 bg-slate-900 hover:bg-slate-800/70 text-left transition-colors cursor-pointer';

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
  /** The dub language, so the voice library suggests voices that speak it. */
  targetLanguage?: string;
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
  targetLanguage = 'Hindi',
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

  // Favourites, shared with the text-to-speech voice picker
  const { favorites } = useFavoriteVoices();

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
  const [cloneAccent, setCloneAccent] = useState<string>('Indian');
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  // Total length of the added clone samples, read from each file's metadata.
  const [cloneSampleSeconds, setCloneSampleSeconds] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      cloneFiles.map(
        (file) =>
          new Promise<number>((resolve) => {
            const url = URL.createObjectURL(file);
            const probe = new Audio();
            probe.preload = 'metadata';
            probe.onloadedmetadata = () => {
              URL.revokeObjectURL(url);
              resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
            };
            probe.onerror = () => {
              URL.revokeObjectURL(url);
              resolve(0);
            };
            probe.src = url;
          })
      )
    ).then((lengths) => !cancelled && setCloneSampleSeconds(lengths.reduce((a, b) => a + b, 0)));
    return () => {
      cancelled = true;
    };
  }, [cloneFiles]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  // Who or what the result was made with, for its label.
  const [outputLabel, setOutputLabel] = useState('');

  // DSP effect preset
  const [selectedEffect, setSelectedEffect] = useState<VoiceEffectPreset>('studio');

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

  const targetVoice = allAvailableVoices.find((v) => v.voice_id === targetVoiceId) || null;
  // A built-in voice missing from the live library still has a known name.
  const builtIn = POPULAR_ELEVENLABS_VOICES.find((v) => v.id === targetVoiceId);
  const targetFull = (targetVoice?.name || builtIn?.name || 'Choose a voice').trim();
  const hasTarget = Boolean(targetVoice || builtIn);
  const [targetName, ...targetTagParts] = targetFull.split(/\s+[-–—|]\s+/);
  const targetMeta = [
    targetTagParts.join(' – ') || targetVoice?.labels?.description || targetVoice?.labels?.use_case,
    targetVoice?.labels?.accent,
    targetVoice?.labels?.gender,
  ]
    .filter(Boolean)
    .map((t) => String(t).replace(/[_-]+/g, ' '))
    .join(' · ');
  const shortName = (name?: string) => (name || '').trim().split(/\s+[-–—|]\s+/)[0];
  const sourceLength = sourceAudioBuffer ? formatLength(sourceAudioBuffer.duration) : null;
  const sampleSeconds =
    (cloneFiles.length === 0 && sourceAudioBuffer ? sourceAudioBuffer.duration : 0) + cloneSampleSeconds;
  const effect = EFFECTS.find((e) => e.id === selectedEffect) || EFFECTS[0];

  const runLabel =
    activeTab === 'sts'
      ? `Changing to ${targetName}…`
      : activeTab === 'clone'
        ? `Creating “${cloneName.trim() || 'new voice'}”…`
        : `Applying ${effect.label}…`;

  const tabButton = (id: ModeTab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={activeTab === id}
      onClick={() => {
        setActiveTab(id);
        setErrorMessage(null);
      }}
      className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-1.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-[12.5px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
        activeTab === id ? 'bg-slate-800 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      <Icon className="hidden sm:block w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );

  const slider = (label: string, hint: string, value: number, onChange: (v: number) => void, ends: [string, string]) => (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-slate-100">{label}</span>
        <span className="font-mono text-xs text-slate-100 tabular-nums">{value.toFixed(2)}</span>
      </div>
      <p className="text-[11.5px] text-slate-400 mt-0.5 mb-2">{hint}</p>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="w-full accent-indigo-500 cursor-pointer"
      />
      <div className="flex justify-between text-[10.5px] text-slate-500 mt-0.5">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );

  const field = 'w-full h-10 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[10px] px-3 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-changer-title"
        className="w-full max-w-[62.5rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <audio ref={audioPlayerRef} />

        {/* Header with the three modes */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <AudioWaveform className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="voice-changer-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Voice changer
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">Keep how it was said, change who says it.</p>
          </div>
          <div
            role="tablist"
            aria-label="Mode"
            className="order-3 sm:order-none w-full sm:w-auto flex p-[3px] gap-0.5 rounded-[11px] bg-slate-950/60 border border-slate-800"
          >
            {tabButton('sts', 'Change voice', ArrowLeftRight)}
            {tabButton('clone', 'Clone a voice', UserPlus)}
            {tabButton('effects', 'Effects', Sliders)}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source audio, shared by every mode */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-5 sm:px-6 py-3 border-b border-slate-800 bg-slate-950/40 shrink-0">
          <span className="hidden sm:block w-14 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 shrink-0">Source</span>
          <span className="w-[34px] h-[34px] rounded-[9px] bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0">
            {isRecording ? <Mic className="w-4 h-4" /> : <FileAudio className="w-4 h-4" />}
          </span>
          <span className="min-w-0 basis-[calc(100%-46px)] sm:basis-auto sm:w-60">
            <span className="block text-[13px] font-semibold text-slate-100 truncate" title={sourceAudioFile?.name}>
              {isRecording ? 'Recording…' : sourceAudioFile?.name || 'No audio yet'}
            </span>
            <span className="block text-[11.5px] text-slate-400 font-mono tabular-nums">
              {isRecording
                ? formatLength(recordDuration)
                : sourceAudioFile
                  ? [sourceLength, sourceAudioFile === activeAudioFile ? 'from this project' : 'your file'].filter(Boolean).join(' · ')
                  : 'Choose a file or record'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => playTrack('source')}
            disabled={!sourceAudioUrl || isRecording}
            className="w-[30px] h-[30px] rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center shrink-0 disabled:opacity-30 cursor-pointer"
            aria-label={playingTrack === 'source' ? 'Stop source' : 'Play source'}
          >
            {playingTrack === 'source' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-px" />}
          </button>
          <div className="order-last sm:order-none basis-full sm:basis-auto flex-1 min-w-0 h-[34px]">
            {sourceAudioBuffer && <MiniWaveform buffer={sourceAudioBuffer} className="text-cyan-400/70" />}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRecording}
            className="h-8 px-3 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 disabled:opacity-40 shrink-0 cursor-pointer"
          >
            Other file
          </button>
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            className={`h-8 px-3 flex items-center gap-2 rounded-[9px] border text-[12.5px] font-medium shrink-0 cursor-pointer ${
              isRecording ? 'border-rose-500/60 bg-rose-500/15 text-rose-200' : 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full bg-rose-400 ${isRecording ? 'animate-pulse' : ''}`} />
            {isRecording ? 'Stop' : 'Record'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCustomFileUpload(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[minmax(0,1fr)_23.75rem]">
          {/* Settings for the chosen mode */}
          <div className="px-5 sm:px-6 py-5 flex flex-col gap-4 min-w-0">
            {activeTab === 'sts' && (
              <>
                <p className="text-[13px] text-slate-400 max-w-[60ch]">
                  The new voice follows the original's timing, pauses and emotion, so it lines up with the video.
                </p>
                <div className="flex flex-col gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Change into</span>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-amber-600 to-orange-400 text-white font-semibold flex items-center justify-center shrink-0">
                      {(targetName.charAt(0) || '?').toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-slate-100 truncate" title={targetFull}>{targetName}</span>
                      {targetMeta && <span className="block text-[11.5px] text-slate-400 truncate capitalize">{targetMeta}</span>}
                    </span>
                    {targetVoice?.preview_url && (
                      <button
                        type="button"
                        onClick={() => handleAuditionVoice(targetVoice)}
                        className="h-8 px-2.5 flex items-center gap-1.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 shrink-0 cursor-pointer"
                      >
                        {auditionVoiceId === targetVoice.voice_id ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                        Sample
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsPickerOpen(true)}
                      className="h-8 px-2.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 shrink-0 cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                  {favoriteVoices.length > 0 && (
                    <div role="group" aria-label="Favourite voices" className="flex flex-wrap gap-1.5">
                      {favoriteVoices.slice(0, 5).map((v) => {
                        const on = v.voice_id === targetVoiceId;
                        const name = shortName(v.name);
                        return (
                          <button
                            key={v.voice_id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setTargetVoiceId(v.voice_id)}
                            className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs transition-colors cursor-pointer ${
                              on ? 'border-indigo-500 bg-indigo-950/40 text-slate-100' : 'border-slate-800 text-slate-300 hover:bg-slate-800/60'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-semibold flex items-center justify-center">
                              {(name.charAt(0) || '?').toUpperCase()}
                            </span>
                            <span className="truncate max-w-[7rem]">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {slider('Match the original', 'Higher keeps rhythm and pitch closer to the speaker.', stability, setStability, ['Freer', 'Closer'])}
                  {slider(
                    'Likeness',
                    `How strongly it sounds like ${hasTarget ? targetName : 'the chosen voice'}.`,
                    similarity,
                    setSimilarity,
                    ['Looser', 'Stronger']
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4 items-end">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="sts-model" className="text-xs text-slate-400">Model</label>
                    <select id="sts-model" value={stsModelId} onChange={(e) => setStsModelId(e.target.value)} className={`${field} cursor-pointer`}>
                      <option value="eleven_multilingual_sts_v2" className="bg-slate-900">Multilingual (29 languages)</option>
                      <option value="eleven_english_sts_v2" className="bg-slate-900">English only</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 h-10">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">Clean up background</span>
                      <span className="block text-[11.5px] text-slate-400">Removes hum and room noise first</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={removeBackgroundNoise}
                      aria-label="Clean up background"
                      onClick={() => setRemoveBackgroundNoise((v) => !v)}
                      className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-pointer ${removeBackgroundNoise ? 'bg-indigo-500' : 'bg-slate-700'}`}
                    >
                      <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${removeBackgroundNoise ? 'left-[17px]' : 'left-[3px]'}`} />
                    </button>
                  </div>
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOutputLabel(targetName);
                      handleRunSpeechToSpeech();
                    }}
                    disabled={isProcessing || isRecording || !hasTarget || (!sourceAudioFile && !sourceAudioBuffer)}
                    className={primaryButton}
                  >
                    <ArrowLeftRight className="w-4 h-4" /> {hasTarget ? `Change to ${targetName}` : 'Change voice'}
                  </button>
                  <span className="text-[11.5px] text-slate-500">
                    Uses ElevenLabs credits{sourceLength ? ` for ${sourceLength} of audio` : ''}.
                  </span>
                </div>
              </>
            )}

            {activeTab === 'clone' && (
              <>
                <p className="text-[13px] text-slate-400 max-w-[60ch]">
                  Make a new ElevenLabs voice from clean recordings of one speaker. It joins your library and can dub or change voices.
                </p>
                <div className="grid sm:grid-cols-2 gap-3.5">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="clone-name" className="text-xs text-slate-400">Name</label>
                    <input id="clone-name" value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="e.g. Hindi narrator" className={field} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-slate-400">Gender</span>
                    <div role="group" aria-label="Gender" className="flex h-10 p-[3px] gap-0.5 bg-slate-950/60 border border-slate-700 rounded-[10px]">
                      {([
                        ['female', 'Female'],
                        ['male', 'Male'],
                        ['unspecified', 'Not set'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={cloneGender === value}
                          onClick={() => setCloneGender(value)}
                          className={`flex-1 rounded-[7px] text-xs font-medium transition-colors cursor-pointer ${
                            cloneGender === value ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="clone-accent" className="text-xs text-slate-400">Accent</label>
                    <input id="clone-accent" value={cloneAccent} onChange={(e) => setCloneAccent(e.target.value)} placeholder="e.g. Indian" className={field} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="clone-desc" className="flex justify-between text-xs text-slate-400">
                      <span>Description</span>
                      <span className="text-slate-500">optional</span>
                    </label>
                    <input id="clone-desc" value={cloneDescription} onChange={(e) => setCloneDescription(e.target.value)} placeholder="Calm, measured, warm" className={field} />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Samples</span>
                  <div className="flex items-center gap-3 p-3 border-[1.5px] border-dashed border-slate-700 rounded-xl">
                    <span className="w-[34px] h-[34px] rounded-[9px] bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                      <Upload className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">Add recordings</span>
                      <span className="block text-[11.5px] text-slate-400">Up to 25 files. One speaker, no music.</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => cloneFileInputRef.current?.click()}
                      className="h-8 px-3 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 shrink-0 cursor-pointer"
                    >
                      Browse
                    </button>
                    <input
                      ref={cloneFileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) setCloneFiles((prev) => [...prev, ...Array.from(e.target.files!)].slice(0, 25));
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {cloneFiles.length === 0 && sourceAudioFile && (
                      <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-slate-800 text-[12.5px]">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-slate-200">Source audio ({sourceAudioFile.name})</span>
                        {sourceLength && <span className="font-mono text-[11.5px] text-slate-500">{sourceLength}</span>}
                      </div>
                    )}
                    {cloneFiles.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-slate-800 text-[12.5px]">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-slate-200">{f.name}</span>
                        <span className="font-mono text-[11.5px] text-slate-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button
                          type="button"
                          onClick={() => setCloneFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="p-0.5 text-slate-500 hover:text-slate-200 cursor-pointer"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {sampleSeconds > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-[5px] rounded-full bg-slate-800 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, (sampleSeconds / 180) * 100)}%` }} />
                      </div>
                      <span className="text-[11.5px] text-slate-400">
                        {formatLength(sampleSeconds)} of speech. 1 to 3 minutes is enough for a good clone.
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleRunVoiceClone}
                    disabled={isProcessing || isRecording || !cloneName.trim() || (cloneFiles.length === 0 && !sourceAudioFile)}
                    className={primaryButton}
                  >
                    <UserPlus className="w-4 h-4" /> Create voice
                  </button>
                  <span className="text-[11.5px] text-slate-500">Only clone a voice you have permission to use.</span>
                </div>
              </>
            )}

            {activeTab === 'effects' && (
              <>
                <p className="text-[13px] text-slate-400 max-w-[60ch]">
                  Quick sound treatments. They run on this computer and don't touch ElevenLabs.
                </p>
                <div role="radiogroup" aria-label="Effect" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {EFFECTS.map((fx) => {
                    const on = fx.id === selectedEffect;
                    return (
                      <button
                        key={fx.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSelectedEffect(fx.id)}
                        className={`flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          on ? 'border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/10' : 'border-slate-800 hover:bg-slate-800/40'
                        }`}
                      >
                        <span
                          className={`w-[30px] h-[30px] rounded-lg border flex items-center justify-center ${
                            on ? 'text-indigo-300 border-indigo-500/40 bg-slate-950/60' : 'text-slate-400 border-slate-800 bg-slate-950/60'
                          }`}
                        >
                          <fx.Icon className="w-4 h-4" />
                        </span>
                        <span>
                          <span className="block text-[12.5px] font-semibold text-slate-100">{fx.label}</span>
                          <span className="block text-[11px] text-slate-400 leading-snug">{fx.desc}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setOutputLabel(effect.label);
                      handleRunDspEffect();
                    }}
                    disabled={isProcessing || isRecording || (!sourceAudioFile && !sourceAudioBuffer)}
                    className={primaryButton}
                  >
                    Apply {effect.label}
                  </button>
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <Check className="w-3.5 h-3.5" /> Free, no credits used
                  </span>
                </div>
              </>
            )}

            {errorMessage && (
              <p className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-500/10 border border-rose-500/30 text-[12.5px] text-slate-200" role="alert">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-px" /> {errorMessage}
              </p>
            )}
          </div>

          {/* Result */}
          <aside aria-label="Result" className="px-5 py-5 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/40 flex flex-col gap-3.5 min-w-0">
            <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Result</span>

            {isProcessing ? (
              <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-slate-900 border border-slate-800" role="status" aria-live="polite">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" /> {runLabel}
                </span>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
                </div>
                <span className="text-[11.5px] text-slate-400">{processingStatus || 'Working…'}</span>
              </div>
            ) : successMessage && activeTab === 'clone' && !outputUrl ? (
              <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-emerald-200">
                  <Check className="w-4 h-4" /> Voice created
                </span>
                <span className="text-[12px] text-slate-300 leading-relaxed">
                  {successMessage} It's now selected for dubbing, and you can change into it from the first tab.
                </span>
              </div>
            ) : outputUrl ? (
              <>
                <span className="flex items-center gap-2 text-[12.5px] text-emerald-300">
                  <Check className="w-3.5 h-3.5" /> Ready. Compare, then choose what to do with it.
                </span>
                {[
                  { track: 'source' as const, title: 'Original', sub: 'Speaker', buffer: sourceAudioBuffer, color: 'text-cyan-400/80' },
                  { track: 'output' as const, title: 'Changed', sub: outputLabel, buffer: outputBuffer, color: 'text-indigo-400' },
                ].map((lane) => (
                  <div
                    key={lane.track}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-900 border ${
                      lane.track === 'output' ? 'border-indigo-500/50' : 'border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => playTrack(lane.track)}
                      className="w-[30px] h-[30px] rounded-full border border-slate-700 bg-slate-950/60 text-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
                      aria-label={`${playingTrack === lane.track ? 'Stop' : 'Play'} ${lane.title.toLowerCase()}`}
                    >
                      {playingTrack === lane.track ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-px" />}
                    </button>
                    <span className="w-[4.5rem] shrink-0">
                      <span className="block text-[12.5px] font-semibold text-slate-100">{lane.title}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{lane.sub}</span>
                    </span>
                    <div className="flex-1 min-w-0 h-[30px]">
                      {lane.buffer && <MiniWaveform buffer={lane.buffer} className={lane.color} />}
                    </div>
                  </div>
                ))}

                <span className="mt-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Use it</span>
                <div className="flex flex-col gap-2">
                  {onSetDubbedMaster && (
                    <button type="button" onClick={handleSetMasterDub} className={`${actionButton} border-indigo-500/50 bg-indigo-950/30`}>
                      <span className="w-[30px] h-[30px] rounded-lg bg-slate-950/60 border border-slate-800 text-indigo-300 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-slate-100">Use as the dub</span>
                        <span className="block text-[11.5px] text-slate-400">Becomes the finished audio in Final dub</span>
                      </span>
                    </button>
                  )}
                  <button type="button" onClick={handleApplyToProject} className={actionButton}>
                    <span className="w-[30px] h-[30px] rounded-lg bg-slate-950/60 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                      <RefreshCw className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-100">Use as the source audio</span>
                      <span className="block text-[11.5px] text-slate-400">Replaces the project's audio with this</span>
                    </span>
                  </button>
                  <button type="button" onClick={handleDownloadOutput} className={actionButton}>
                    <span className="w-[30px] h-[30px] rounded-lg bg-slate-950/60 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                      <Download className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-100">Download .wav</span>
                      <span className="block text-[11.5px] text-slate-400 font-mono">
                        {outputBuffer ? `${formatLength(outputBuffer.duration)} · ${(outputBuffer.sampleRate / 1000).toFixed(1)} kHz` : 'Audio file'}
                      </span>
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-[13.75rem] flex flex-col items-center justify-center gap-2.5 p-6 text-center rounded-xl border-[1.5px] border-dashed border-slate-700 text-[12.5px] text-slate-500">
                <span className="w-10 h-10 rounded-[11px] bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center">
                  <AudioWaveform className="w-5 h-5" />
                </span>
                <span className="max-w-[16rem]">Your result appears here, next to the original, so you can compare before using it.</span>
              </div>
            )}
          </aside>
        </div>
      </section>

      {/* The full voice library, to pick who to change into */}
      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a voice to change into"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setIsPickerOpen(false);
          }}
          onKeyDown={(e) => e.key === 'Escape' && setIsPickerOpen(false)}
        >
          <div className="w-full max-w-5xl flex flex-col gap-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Done
              </button>
            </div>
            <VoiceSelectorCard
              elVoiceId={targetVoiceId}
              onElVoiceIdChange={setTargetVoiceId}
              availableVoices={availableVoices}
              targetLanguage={targetLanguage}
              className="h-[78vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
};
