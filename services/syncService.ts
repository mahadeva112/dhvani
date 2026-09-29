import { apiGet, apiGetAudio, apiJson } from './apiClient';
import { AudioSegment } from '../types';
import { ElevenLabsVoiceSettings } from './elevenLabsService';

/**
 * Sync: a dub voiced line by line and placed on the source's phrases, so it
 * plays in step with the original. The voice is never changed — no speed
 * change, no gain and no fades; lines are only moved and the silent pauses
 * inside them shortened. A line too long for its slot is flagged with a
 * suggested shorter wording, never rewritten (see server/lib/syncDub.js).
 * The dub comes back as lossless WAV.
 */

/** How tight the sync must be: lip-sync ±80 ms, phrase ±150 ms, loose ±300 ms. */
export type SyncPrecision = 'lipsync' | 'phrase' | 'loose';

export const SYNC_PRECISION_OPTIONS: { id: SyncPrecision; label: string }[] = [
  { id: 'phrase', label: 'Phrase (±150 ms)' },
  { id: 'lipsync', label: 'Lip-sync (±80 ms)' },
  { id: 'loose', label: 'Loose (±300 ms)' },
];

/** What the user picks before a sync. */
export interface SyncOptions {
  precision: SyncPrecision;
  /** Ask the text model for shorter wordings of lines that run long. */
  suggest: boolean;
  /** Bring every line to the same loudness. Off: each line keeps the level it was voiced at. */
  matchLoudness: boolean;
}

/**
 * What the render did to one line, sample by sample, from the server's audio
 * debug mode. Source samples count in the clip as voiced; timeline samples in
 * the synced dub.
 */
export interface SyncAudioDebugLine {
  key: string;
  voicedSamples: number;
  sourceStartSample: number;
  sourceEndSample: number;
  pauseCuts: { sourceStartSample: number; sourceEndSample: number; timelineJoinSample: number; joinStep: number }[];
  droppedBeforeZeroSamples: number;
  /** How much later a line at 0:00 starts, so it can start on a quiet sample. */
  startDelaySamples: number;
  timelineStartSample: number;
  timelineEndSample: number;
  gain: number;
  edgeTrimStartSamples: number;
  edgeTrimEndSamples: number;
  fadeInSamples: number;
  fadeOutSamples: number;
  microFade: boolean;
}

export interface SyncAudioDebug {
  sampleRate: number;
  channels: number;
  resampled: boolean;
  matchLoudness: boolean;
  output: { contentType: string; samples: number; encodes: number };
  lines: SyncAudioDebugLine[];
}

/** Set `localStorage.dhvani_audio_debug = '1'` to get SyncAudioDebug with every sync, logged to the console. */
export const AUDIO_DEBUG_KEY = 'dhvani_audio_debug';

export const audioDebugEnabled = (): boolean => {
  try {
    return localStorage.getItem(AUDIO_DEBUG_KEY) === '1';
  } catch {
    return false;
  }
};

/** One synced line: a group of cues spoken as one phrase. Times are in seconds. */
export interface SyncUnitReport {
  index: number;
  /** Names the line for a retake: the id of its first cue. */
  key: string;
  cueIds: (string | number)[];
  /** What the dub says: the script as written. */
  text: string;
  sourceText: string;
  srcStart: number;
  srcEnd: number;
  /** Where the dub's first and last word landed; null if the line came back silent. */
  placedStart: number | null;
  placedEnd: number | null;
  /** Dub start minus source start: positive is late. */
  offset: number | null;
  /** How far the dub line runs into the next source line. */
  overrun: number | null;
  inSync: boolean;
  silent: boolean;
  /** The line is too long for the time the original line had. */
  exceeded: boolean;
  /** Seconds the line runs past its slot, after its pauses were shortened. */
  exceededBy: number;
  /** A shorter wording to use instead, or null. Never applied automatically. */
  suggestion: string | null;
  /** Seconds taken out of the pauses inside the line. */
  pauseTrimmed: number;
}

export interface SyncReport {
  precision: SyncPrecision;
  tolerance: number;
  /** Length of the synced dub. */
  duration: number;
  summary: {
    lines: number;
    inSync: number;
    medianError: number;
    p90Error: number;
    maxError: number;
    overlaps: number;
    /** Lines too long for their slot, and how many of them got a suggestion. */
    exceeded: number;
    suggested: number;
    /** Why some or all suggestions are missing: the text model's error, or null. */
    suggestionError: string | null;
    pauseTrimmed: number;
    silent: number;
  };
  units: SyncUnitReport[];
  /** Only when the sync ran in audio debug mode. */
  audioDebug?: SyncAudioDebug;
}

/** The steps of a sync, as the server reports them. */
export const SYNC_STEPS = [
  { phase: 'units', label: 'Reading source timings' },
  { phase: 'voicing', label: 'Voicing each line' },
  { phase: 'fitting', label: 'Checking which lines fit' },
  { phase: 'placing', label: 'Placing every line' },
  { phase: 'rendering', label: 'Rendering one file' },
  { phase: 'checking', label: 'Checking the result' },
  { phase: 'suggesting', label: 'Suggesting shorter lines' },
] as const;

export interface SyncProgress {
  phase: (typeof SYNC_STEPS)[number]['phase'] | 'done' | 'cancelled' | 'failed';
  /** 1-based step in SYNC_STEPS. */
  step: number;
  unitCount: number;
  unitsVoiced: number;
  unitsToVoice: number;
  suggestionsTotal: number;
  suggestionsDone: number;
}

export interface SyncRequest {
  segments: AudioSegment[];
  sourceDuration: number;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  voiceSettings: ElevenLabsVoiceSettings | null;
  language?: string;
  seed?: number;
  precision: SyncPrecision;
  /** Ask the text model for shorter wordings of lines that run long. */
  suggest: boolean;
  matchLoudness?: boolean;
  /** Retaken lines, by key: each is voiced again with its own seed. */
  lineSeeds?: Record<string, number>;
  /** Report what the render did to every line (SyncReport.audioDebug). */
  debug?: boolean;
}

/** Only what the server reads from each cue; word timings and legacy fields stay behind. */
const slimSegment = (segment: AudioSegment) => ({
  id: segment.id,
  startTime: segment.startTime,
  endTime: segment.endTime,
  speaker: segment.speaker,
  textTarget: segment.textTarget || segment.targetText || '',
  textSource: segment.textSource || segment.originalText || '',
});

export const syncDub = async (
  request: SyncRequest,
  { apiKey, jobId, signal }: { apiKey?: string; jobId?: string; signal?: AbortSignal } = {}
): Promise<{ blob: Blob; report: SyncReport }> => {
  const data = await apiJson<{ audioId: string; contentType: string; report: SyncReport }>('/sync', {
    body: {
      ...request,
      segments: request.segments.map(slimSegment),
      voiceSettings: request.voiceSettings || undefined,
      jobId,
    },
    keys: { elevenLabsKey: apiKey },
    signal,
  });
  // The dub is fetched on its own, as it is: lossless WAV is too big to ride inside JSON.
  const blob = await apiGetAudio(`/sync/audio/${encodeURIComponent(data.audioId)}`, { signal });
  return { blob, report: data.report };
};

export const getSyncProgress = (jobId: string): Promise<SyncProgress> =>
  apiGet<SyncProgress>(`/sync/jobs/${encodeURIComponent(jobId)}`);

export const cancelSync = (jobId: string): Promise<{ cancelled: boolean }> =>
  apiJson(`/sync/jobs/${encodeURIComponent(jobId)}/cancel`, { body: {} });

/**
 * Spreads a new wording of a line over the line's cues, in proportion to how
 * long each cue's text was, so the cues (and their subtitle timing) stay as
 * they are. Whole words only; every cue keeps at least one word when there
 * are enough.
 */
export const distributeLineText = (text: string, cueTexts: string[]): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (cueTexts.length <= 1) return [words.join(' ')];
  const lengths = cueTexts.map((t) => Math.max(1, t.trim().length));
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  let used = 0;
  let share = 0;
  lengths.forEach((length, n) => {
    share += length / total;
    const left = cueTexts.length - n - 1;
    const end =
      n === cueTexts.length - 1
        ? words.length
        : Math.min(words.length - Math.min(left, words.length - used - 1), Math.max(used + 1, Math.round(share * words.length)));
    out.push(words.slice(used, Math.max(used, end)).join(' '));
    used = Math.max(used, end);
  });
  return out;
};

/**
 * Cues timed to the synced dub, for its subtitles. Each line's cues share the
 * line's placed span in proportion to their length. Word timings are dropped:
 * they belong to the source audio.
 */
export const syncedSegments = (segments: AudioSegment[], report: SyncReport): AudioSegment[] => {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const out: AudioSegment[] = [];
  for (const unit of report.units) {
    if (unit.placedStart === null || unit.placedEnd === null) continue;
    const span = Math.max(0.01, unit.placedEnd - unit.placedStart);
    const cues = unit.cueIds.map((id) => byId.get(id)).filter((cue): cue is AudioSegment => Boolean(cue));
    if (cues.length === 0) {
      out.push({
        id: cues[0]?.id ?? `sync-${unit.index}`,
        startTime: unit.placedStart,
        endTime: unit.placedEnd,
        duration: span,
        speaker: cues[0]?.speaker,
        textSource: unit.sourceText,
        textTarget: unit.text,
        targetText: unit.text,
        timingSource: 'derived',
      });
      continue;
    }
    const lengths = cues.map((cue) => Math.max(1, (cue.textTarget || cue.targetText || '').length));
    const total = lengths.reduce((a, b) => a + b, 0);
    let at = unit.placedStart;
    cues.forEach((cue, n) => {
      const length = (lengths[n] / total) * span;
      const { words: _words, ...rest } = cue;
      out.push({ ...rest, startTime: at, endTime: at + length, duration: length, timingSource: 'derived' });
      at += length;
    });
  }
  return out;
};
