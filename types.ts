import type { SyncReport } from './services/syncService';
import type { SyncBank, SyncEdits } from './services/syncEditService';

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

/** The voice one speaker is dubbed with, in a dub with several speakers. */
export interface SpeakerVoice {
  voiceId: string;
}

/**
 * How a mix of several voices that peaks above full scale is handled: kept
 * exactly as summed in a 32-bit float file, or turned down as a whole.
 */
export type MixPeakMode = 'float' | 'lower';

/** What mixing a dub with several speakers did, from the server. */
export interface DubMixReport {
  speakers: string[];
  /** The mix's peak in dBFS (above 0 when speakers talking together sum past full scale), and where. */
  peakDb: number | null;
  peakAt: number;
  overFullScale: boolean;
  peak: MixPeakMode;
  /** How far the whole mix was turned down; 0 unless `peak` is 'lower' and it went over. */
  loweredDb: number;
  /** dB per speaker when speakers were evened out; empty otherwise. */
  gains: Record<string, number>;
  /** Synced dubs: overlaps kept from the original, and lines of one speaker that ran into each other. */
  overlapsKept?: number;
  selfOverlaps?: number;
}

/** One speaker's part of a dub, the same length as the mix. */
export interface DubStem {
  speaker: string;
  blob: Blob;
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

/** The script a dub was voiced from, for a sync to cut its lines from that dub (see BatchJob.dubLines). */
export interface DubLines {
  /** Names the dub on the server, which the app sends it to before a sync. */
  dubId: string;
  voiceId: string;
  modelId: string;
  /**
   * How a continuous read was voiced (voice settings, emotion, loudness), so
   * Sync again reads the script again only when that changes. Absent on dubs
   * made before Dub and Sync were one step.
   */
  readKey?: string;
  /** The cues as the dub says them, in spoken order. */
  cues: { id: string; text: string }[];
}

// New Interface for Batch Processing
export interface BatchJob {
  id: string;
  /** The project's name as the user set it. Unset means its file's name. */
  name?: string;
  /** When the project was made and last worked on, in ms. Unset on projects saved before these were kept. */
  createdAt?: number;
  updatedAt?: number;
  /** The step the user last picked on this project, so opening it again lands there. */
  lastStep?: number;
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
  /**
   * What the dub above says, cue by cue, and with which voice: a sync with the
   * same voice cuts every line that still reads the same out of the dub
   * instead of voicing it again. Unset for a dub with several voices.
   */
  dubLines?: DubLines | null;
  
  srtUrl: string | null; // New field for SRT download
  srtBlob: Blob | null; // Added for IndexedDB persistence
  
  /** Original-language SRT built straight from ElevenLabs word timestamps. */
  originalSrt?: string;
  /** Translated SRT carrying the exact same timestamps. */
  translatedSrt?: string;
  /** Automatic translation, the user's own script, or not chosen yet. */
  targetSource?: TargetSource;

  /**
   * The synced dub: Sync's own file, kept beside the dub above (a dub made
   * before Dub and Sync were one step), which it never replaces. Every step
   * plays this one under the original once there is one.
   */
  syncedAudioUrl?: string | null;
  syncedBlob?: Blob | null;
  syncedAudioBuffer?: AudioBuffer | null;
  /** Set with the synced dub: how each line lined up with the source, with any Edit timing edits measured in. */
  syncReport?: SyncReport | null;
  /**
   * Edit timing. The bank is every line as Sync placed it (its samples in
   * `syncBankBlob`); `syncEdits` is what the user did to them, and
   * `syncBaseReport` the report as Sync made it, before any edit. The synced
   * dub above is rendered from the bank with the edits.
   */
  syncBank?: SyncBank | null;
  syncBankBlob?: Blob | null;
  syncEdits?: SyncEdits | null;
  syncBaseReport?: SyncReport | null;
  /** Retaken lines, by line key: each keeps its own seed, so its new take survives later Syncs and reloads. */
  syncLineSeeds?: Record<string, number> | null;
  /** Lines changed since the last Sync (reworded, cut, joined or retaken), by line key: the next Sync re-voices them. */
  syncPendingLines?: string[] | null;

  /** The voice each speaker is dubbed with, by speaker name. A speaker not in it gets the main voice. */
  cast?: Record<string, SpeakerVoice>;
  /** Set when the dub was voiced by several speakers: one track per speaker, and what the mix did. */
  dubStems?: DubStem[] | null;
  dubMix?: DubMixReport | null;
  /** The same for the synced dub. */
  syncedStems?: DubStem[] | null;
  syncMix?: DubMixReport | null;
  
  // Errors
  errorMsg: string | null;
  /**
   * Set when transcription succeeded but translation did not. Transcription
   * data is preserved so the user can retry translation alone.
   */
  translationWarning?: string | null;
}