import { apiGet, apiJson } from './apiClient';
import { AudioSegment } from '../types';
import { ElevenLabsVoiceSettings } from './elevenLabsService';

/**
 * Sync: a dub voiced line by line and placed on the source's phrases, so it
 * plays in step with the original. The voice is never changed — no speed
 * change and no fades; lines are only moved and the silent pauses inside them
 * shortened. A line too long for its slot is flagged with a suggested shorter
 * wording, never rewritten (see server/lib/syncDub.js).
 */

/** How tight the sync must be: lip-sync ±80 ms, phrase ±150 ms, loose ±300 ms. */
export type SyncPrecision = 'lipsync' | 'phrase' | 'loose';

export const SYNC_PRECISION_OPTIONS: { id: SyncPrecision; label: string }[] = [
  { id: 'phrase', label: 'Phrase (±150 ms)' },
  { id: 'lipsync', label: 'Lip-sync (±80 ms)' },
  { id: 'loose', label: 'Loose (±300 ms)' },
];

/** One synced line: a group of cues spoken as one phrase. Times are in seconds. */
export interface SyncUnitReport {
  index: number;
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
  const data = await apiJson<{ audio: string; contentType: string; report: SyncReport }>('/sync', {
    body: {
      ...request,
      segments: request.segments.map(slimSegment),
      voiceSettings: request.voiceSettings || undefined,
      jobId,
    },
    keys: { elevenLabsKey: apiKey },
    signal,
  });
  // Decoded by hand: the app's content security policy doesn't let fetch() read data: URLs.
  const binary = atob(data.audio);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: data.contentType }), report: data.report };
};

export const getSyncProgress = (jobId: string): Promise<SyncProgress> =>
  apiGet<SyncProgress>(`/sync/jobs/${encodeURIComponent(jobId)}`);

export const cancelSync = (jobId: string): Promise<{ cancelled: boolean }> =>
  apiJson(`/sync/jobs/${encodeURIComponent(jobId)}/cancel`, { body: {} });

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
