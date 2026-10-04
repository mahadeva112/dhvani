import type { SyncReport } from './services/syncService';

/**
 * One word as measured by ElevenLabs. These are the authoritative timings for
 * the whole app: subtitle cues are cut on these boundaries and never on an
 * estimate.
 */
export interface WordTimestamp {
  text: string;
  start: number; // seconds, from ElevenLabs
  end: number; // seconds, from ElevenLabs
}

export interface AudioSegment {
  id: number | string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  duration: number; // in seconds
  speaker?: string;
  textSource?: string; // Transcribed source-language text
  textTarget?: string; // Translated text (timings are NOT re-derived from it)
  emotion?: string; // Specific tone or vocal style
  speedRate?: number; // Target speed pacing
  /**
   * Seconds the user trimmed this cue's dub line to on the sync timeline, set
   * on the line's first cue. Suggestions aim for it instead of the length
   * worked out from the slot; Sync still starts the line with its sentence.
   */
  dubTargetSeconds?: number;
  /** Word timings from ElevenLabs, used to cut SRT cues exactly. */
  words?: WordTimestamp[];
  /**
   * Where this cue's timing came from. 'elevenlabs' means measured from audio;
   * 'derived' means computed inside a measured cue (e.g. a hand split of a
   * typed cue with no word data).
   */
  timingSource?: 'elevenlabs' | 'derived';

  /*
   * Legacy aliases kept in sync with textSource/textTarget by the components
   * that write them. Older cues and sample sessions still carry these names.
   */
  originalText?: string;
  targetText?: string;
  text?: string;
}

export type AudioTrackMode = 'source' | 'synth' | 'both';
/** How a track switch moves playback: where the new track starts, and whether it plays. */
export interface TrackSwitchOptions {
  /** Position on the new track; defaults to where the heard track is now. */
  seek?: number;
  /** Defaults to whether something is playing now. */
  play?: boolean;
}
export type StudioViewMode = 'express' | 'dual' | 'script' | 'teleprompter';

export enum ProcessingStatus {
  IDLE = 'IDLE',
  READY = 'READY', // Media loaded and analysed, waiting for transcription
  QUEUED = 'QUEUED', // New status for batch
  UPLOADING = 'UPLOADING', // Uploading to Gemini
  ANALYZING_AUDIO = 'ANALYZING_AUDIO',
  GENERATING_XML = 'GENERATING_XML',
  VALIDATING_XML = 'VALIDATING_XML',
  SYNTHESIZING_AUDIO = 'SYNTHESIZING_AUDIO',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface ProcessingResult {
  xml: string;
  segments: AudioSegment[];
}

export interface AudioMetadata {
  duration: number;
  fileName: string;
  fileType: string;
}

export interface ValidationResult {
  isValid: boolean;
  durationStatus: "Safe" | "Risk of Exceeding" | "Too Short" | "Unknown";
  timingMatch: "Accurate" | "Misaligned" | "Not Applicable";
  issues: string[];
}

export interface SubtitleConfiguration {
  maxCharsPerLine: number;
  maxLinesPerCue: number;
  maxSecondsPerCue: number;
  strategy?: string;
}

export interface PronunciationPair {
  id: string; 
  original: string; 
  replacement: string; 
}

// Undo/Redo State Snapshot
export interface JobSnapshot {
  script: string;
  segments: AudioSegment[];
  pronunciations: PronunciationPair[];
  timestamp: number;
}

export interface JobHistory {
  past: JobSnapshot[];
  future: JobSnapshot[];
}

/**
 * Where a job's target-language lines came from. A transcript waits in
 * 'pending' until the user picks automatic translation or their own script;
 * nothing is translated before that choice. Jobs saved before this field
 * existed have it unset and are treated as already chosen.
 */
export type TargetSource = 'pending' | 'translated' | 'custom';

// New Interface for Batch Processing
export interface BatchJob {
  id: string;
  file: File;
  status: ProcessingStatus;
  
  // Inputs
  script: string;
  /** Target (translation) language. */
  language: string;
  /** Source language for transcription; '' means let ElevenLabs auto-detect. */
  sourceLanguage?: string;
  /** Source language ElevenLabs actually detected. */
  detectedLanguage?: string;
  manualDuration: string;
  expression: string;
  pronunciations: PronunciationPair[];
  customPrompt?: string;
  promptPresetId?: string;
  
  // History
  history: JobHistory;

  // Analysis Data
  audioMetadata: AudioMetadata | null;
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  analysisSensitivity?: number; // 0 to 100 sensitivity threshold for pause detection (default: 50)
  
  // Outputs
  xmlOutput: string;
  validationResult: ValidationResult | null;
  
  // We store Blobs for persistence, URLs for display
  synthesizedAudioUrl: string | null;
  synthesizedBlob: Blob | null; // Added for IndexedDB persistence
  
  synthAudioBuffer: AudioBuffer | null; // Visual waveform data for output
  /**
   * Characters in the script the dub was voiced from. The voice's speaking
   * rate is these over the dub's seconds of speech, so editing the script
   * afterwards doesn't shift the rate every estimate is made at.
   */
  dubScriptCharacters?: number;
  
  srtUrl: string | null; // New field for SRT download
  srtBlob: Blob | null; // Added for IndexedDB persistence
  
  /** Original-language SRT built straight from ElevenLabs word timestamps. */
  originalSrt?: string;
  /** Translated SRT carrying the exact same timestamps. */
  translatedSrt?: string;
  /** Automatic translation, the user's own script, or not chosen yet. */
  targetSource?: TargetSource;

  /** Set when the dub was made by Sync: how each line lined up with the source. */
  syncReport?: SyncReport | null;
  
  // Errors
  errorMsg: string | null;
  /**
   * Set when transcription succeeded but translation did not. Transcription
   * data is preserved so the user can retry translation alone.
   */
  translationWarning?: string | null;
}