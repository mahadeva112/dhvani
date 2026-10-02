import { apiGet, apiGetAudio, apiJson } from './apiClient';
import { AudioSegment } from '../types';
import { ElevenLabsVoiceSettings } from './elevenLabsService';
import { isCartesiaVoice, cartesiaDelivery, type CartesiaVoicePrefs } from './cartesiaService';

/**
 * Sync: a dub voiced line by line and placed on the source's phrases, so it
 * plays in step with the original. The voice is never changed — no speed
 * change, no gain and no fades; lines are only moved and the silent pauses
 * inside them shortened. A line too long for its slot is flagged with a
 * suggested shorter wording, and a line that ends well before the original
 * speaker stops with a fuller one; neither is ever applied by itself (see
 * server/lib/syncDub.js).
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
  /** Ask the text model for fuller wordings of lines that end well before the original speaker stops. */
  suggestLonger: boolean;
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
  /** The line ends well before the original speaker stops: the dub goes quiet while they still talk. */
  short: boolean;
  /** Seconds of the original speech the dub leaves unsaid; 0 unless `short`. */
  shortBy: number;
  /** Seconds the dub line's words take, as voiced. */
  speech: number;
  /** Length a new wording should aim for: shorter when `exceeded`, longer when `short`, otherwise null. */
  targetChars: number | null;
  /** A shorter (or, for a short line, fuller) wording to use instead, or null. Never applied automatically. */
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
    /** Lines that end well before the original speaker stops. */
    short: number;
    /** Suggestions asked for, long and short lines together, and how many came back. */
    suggestionsAsked: number;
    suggested: number;
    /** Suggestions held back because every wording the text model offered changed the meaning. */
    meaningRejected: number;
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
  { phase: 'suggesting', label: 'Suggesting better-fitting lines' },
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
  /** Ask the text model for fuller wordings of lines that end early. */
  suggestLonger?: boolean;
  matchLoudness?: boolean;
  /** Retaken lines, by key: each is voiced again with its own seed. */
  lineSeeds?: Record<string, number>;
  /** Report what the render did to every line (SyncReport.audioDebug). */
  debug?: boolean;
  /** How a Cartesia voice is voiced; used in place of modelId and voiceSettings for one. */
  cartesia?: CartesiaVoicePrefs;
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
  const { cartesia, ...rest } = request;
  // A Cartesia voice gets the same model and delivery as a Cartesia dub.
  const voice =
    cartesia && isCartesiaVoice(request.voiceId)
      ? { modelId: cartesia.modelId || undefined, voiceSettings: cartesiaDelivery(cartesia) }
      : { voiceSettings: request.voiceSettings || undefined };
  const data = await apiJson<{ audioId: string; contentType: string; report: SyncReport }>('/sync', {
    body: {
      ...rest,
      ...voice,
      segments: request.segments.map(slimSegment),
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

/** One line of a sync preview: its slot, and how long the dub line is estimated to take. */
export interface SyncPreviewUnit {
  index: number;
  /** Same key as the line has in a sync report. */
  key: string;
  cueIds: (string | number)[];
  text: string;
  sourceText: string;
  srcStart: number;
  srcEnd: number;
  nextStart: number | null;
  /** Seconds the line has: to where the next phrase starts, less a breath. */
  slot: number;
  /** Seconds the original speaker talks for. */
  spoken: number;
  /** Estimated seconds of speech. */
  estimate: number;
  /** Estimated seconds past the slot, 0 when it fits. */
  overflow: number;
  /** Estimated seconds of the original speech the dub leaves silent; 0 unless the line is short. */
  underflow: number;
  /** 'short': the dub likely ends well before the original speaker stops. */
  status: 'fits' | 'tight' | 'long' | 'short';
  /** Length a new wording should aim for, in characters: shorter for a long line, longer for a short one. */
  targetChars: number;
}

export interface SyncPreview {
  precision: SyncPrecision;
  charsPerSecond: number;
  units: SyncPreviewUnit[];
  /** `fits` includes the short lines, which fit their slot; `short` counts them on their own. */
  summary: { lines: number; fits: number; tight: number; long: number; short: number; maxOverflow: number };
}

/** Which lines are likely to fit, before anything is voiced. No voice or text model is called. */
export const previewSync = (
  request: { segments: AudioSegment[]; precision: SyncPrecision; charsPerSecond: number; sourceDuration?: number },
  { signal }: { signal?: AbortSignal } = {}
): Promise<SyncPreview> =>
  apiJson<SyncPreview>('/sync/preview', { body: { ...request, segments: request.segments.map(slimSegment) }, signal });

type LineRequest = { text: string; sourceText?: string; language?: string; targetChars: number; avoid?: string[] };

/**
 * A new wording from the server, which has already checked it means what the
 * source line means. Null when nothing usable came back; throws, with a reason
 * to show, when every wording changed the meaning.
 */
const askForLine = async (path: string, request: LineRequest, signal?: AbortSignal): Promise<string | null> => {
  const { line, reason } = await apiJson<{ line: string | null; reason?: 'unusable' | 'meaning' | null }>(path, { body: request, signal });
  if (!line && reason === 'meaning') {
    throw new Error('Every wording the text model offered changed the meaning of the original line, so none is shown. Try again, or edit it yourself.');
  }
  return line;
};

/** A shorter wording of one line from the text model, meaning checked, or null when it had nothing usable. */
export const suggestShorterLine = (request: LineRequest, { signal }: { signal?: AbortSignal } = {}): Promise<string | null> =>
  askForLine('/sync/shorten', request, signal);

/** A fuller wording of one line that ends too early, meaning checked, or null when it had nothing usable. */
export const suggestLongerLine = (request: LineRequest, { signal }: { signal?: AbortSignal } = {}): Promise<string | null> =>
  askForLine('/sync/lengthen', request, signal);

/** A typical dub speaking rate, used when there is no dub to measure one from. */
export const TYPICAL_CHARS_PER_SECOND = 14;

/** Silence shorter than this sits inside a line (a breath, a comma), so it counts as speaking time. */
const LINE_BREAK_SECONDS = 0.35;

/**
 * Seconds of speech in a dub: every stretch above the noise floor, plus the
 * short pauses inside lines. The longer silences between lines are left out,
 * so characters over this is the voice's own rate, as Sync would meet it.
 * Returns 0 when the buffer holds no speech.
 */
export const measureSpeechSeconds = (buffer: AudioBuffer): number => {
  const data = buffer.getChannelData(0);
  const frame = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  const levels: number[] = [];
  for (let at = 0; at + frame <= data.length; at += frame) {
    let sum = 0;
    for (let i = at; i < at + frame; i++) sum += data[i] * data[i];
    levels.push(Math.sqrt(sum / frame));
  }
  if (levels.length === 0) return 0;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const loud = sorted[Math.floor(sorted.length * 0.95)];
  const threshold = Math.max(0.003, floor * 3, loud * 0.04);
  const frameSeconds = frame / buffer.sampleRate;
  const maxGapFrames = Math.round(LINE_BREAK_SECONDS / frameSeconds);

  let speech = 0;
  let gap = 0;
  let started = false;
  for (const level of levels) {
    if (level >= threshold) {
      if (started && gap <= maxGapFrames) speech += gap;
      speech += 1;
      gap = 0;
      started = true;
    } else if (started) gap += 1;
  }
  return speech * frameSeconds;
};

/** The voice's rate in characters a second, or null when it can't be believed. */
export const speakingRate = (characters: number, speechSeconds: number): number | null => {
  if (!(speechSeconds > 1) || characters <= 0) return null;
  const rate = characters / speechSeconds;
  return rate >= 5 && rate <= 35 ? rate : null;
};
