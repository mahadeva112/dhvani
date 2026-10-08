import { apiGet, apiGetAudio, apiJson, apiPutBlob, DhvaniApiError } from './apiClient';
import { AudioSegment, DubLines, DubMixReport, DubStem, MixPeakMode, SpeakerVoice } from '../types';
import { ElevenLabsVoiceSettings } from './elevenLabsService';
import { isCartesiaVoice, cartesiaDelivery, type CartesiaVoicePrefs } from './cartesiaService';
import { castPayload, fetchMixed } from './castService';
import type { lockedLines, SyncBank } from './syncEditService';
import { matchedLips, READ_SPREAD, sourceLipTimes, timeLine, type TimedWord } from './speechTiming';

/**
 * Sync: a dub voiced line by line and placed on the source's phrases, so it
 * plays in step with the original. The voice is never changed — no speed
 * change, no gain and no fades; lines are only moved and the silent pauses
 * inside them shortened (SyncJoinSettings decides how far; its two fades are
 * off unless asked for). A line too long for its slot is flagged with a
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

/**
 * How a synced dub joins its lines. Times are in seconds, shares from 0 to 1;
 * the server keeps every value inside its range (server/lib/syncSettings.js).
 * Only `spliceCrossfade` and `edgeFade` change the audio itself.
 */
export interface SyncJoinSettings {
  /** Smallest silence between one line's tail and the next line's first sound. */
  minGap: number;
  /** The same, where the speaker changes. */
  speakerGap: number;
  /** Share of the source pause the dub keeps at least (up to 0.6 s). */
  gapShare: number;
  /** A line's breath before its first word never plays over the line before. */
  breathClear: boolean;
  /** Silence the breaths the voice makes before, between and after its words. Changes the audio. */
  removeBreaths: boolean;
  /** Take silence out of the pauses inside a line that runs long. */
  shortenPauses: boolean;
  /** A pause inside a line is never shortened below this. */
  minInnerPause: number;
  /** The most of any one pause that may be taken out. */
  maxPauseTake: number;
  /** Equal-power crossfade at each pause cut; 0 is a plain cut inside silence. Changes the audio. */
  spliceCrossfade: number;
  /** A line's tail runs until the audio stays below this level, in dBFS. */
  tailFloorDb: number;
  /** Silence kept after a line's tail. */
  tailHold: number;
  /** Fade for an edge that stops on sound; 0 keeps the 3 ms micro-fade. Changes the audio. */
  edgeFade: number;
  /** A line starting later than this after its source line is flagged. */
  maxLateStart: number;
  /** Cues closer than this, by the same speaker, are voiced as one line. */
  unitGap: number;
  /** A joined line is never longer than this. */
  maxUnit: number;
  /** A join with less than this between the words either side is flagged. */
  flagJoin: number;
}

export type SyncJoinPreset = 'natural' | 'tight' | 'lipsync' | 'custom';

/** Natural is also what the server syncs with when no settings are sent. */
export const SYNC_JOIN_PRESETS: Record<Exclude<SyncJoinPreset, 'custom'>, SyncJoinSettings> = {
  natural: {
    minGap: 0.18,
    speakerGap: 0.25,
    gapShare: 0.3,
    breathClear: true,
    removeBreaths: true,
    shortenPauses: true,
    minInnerPause: 0.25,
    maxPauseTake: 0.4,
    spliceCrossfade: 0,
    tailFloorDb: -70,
    tailHold: 0.04,
    edgeFade: 0,
    maxLateStart: 0.25,
    unitGap: 0.4,
    maxUnit: 12,
    flagJoin: 0.15,
  },
  tight: {
    minGap: 0.12,
    speakerGap: 0.22,
    gapShare: 0.35,
    breathClear: true,
    removeBreaths: true,
    shortenPauses: true,
    minInnerPause: 0.2,
    maxPauseTake: 0.6,
    spliceCrossfade: 0,
    tailFloorDb: -70,
    tailHold: 0.025,
    edgeFade: 0,
    maxLateStart: 0.18,
    unitGap: 0.3,
    maxUnit: 12,
    flagJoin: 0.11,
  },
  lipsync: {
    minGap: 0.09,
    speakerGap: 0.18,
    gapShare: 0.3,
    breathClear: true,
    removeBreaths: true,
    shortenPauses: true,
    minInnerPause: 0.18,
    maxPauseTake: 0.7,
    spliceCrossfade: 0,
    tailFloorDb: -70,
    tailHold: 0.015,
    edgeFade: 0,
    maxLateStart: 0.1,
    unitGap: 0.25,
    maxUnit: 12,
    flagJoin: 0.09,
  },
};

export const SYNC_JOIN_PRESET_OPTIONS: { id: SyncJoinPreset; label: string; hint: string }[] = [
  { id: 'natural', label: 'Natural (recommended)', hint: 'Room to breathe between lines.' },
  { id: 'tight', label: 'Tight', hint: 'Follows the original pauses closely.' },
  { id: 'lipsync', label: 'Strict lip-sync', hint: 'Smallest gaps, for on-screen faces.' },
  { id: 'custom', label: 'Custom', hint: 'Your own settings, below.' },
];

/** What the user picks before a sync. */
/**
 * How the dub is voiced: each line on its own, timed for its slot ('lines'),
 * or the whole script in one take with each line then cut from it
 * ('continuous'), which keeps the flow of one read. One voice only.
 */
export type SyncVoicing = 'lines' | 'continuous';

export interface SyncOptions {
  voicing: SyncVoicing;
  precision: SyncPrecision;
  /** Which preset `join` came from; 'custom' once any of it is changed. */
  preset: SyncJoinPreset;
  join: SyncJoinSettings;
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
  /** Who says the line, when the transcript tells speakers apart. */
  speaker?: string | null;
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
  /** The line's first word landed later after its source line than the join settings allow. */
  late: boolean;
  /** Seconds from this line's last word to the next line's first; null for the last line. */
  joinAfter: number | null;
  /** `joinAfter` is under the join settings' review limit. */
  tightJoin: boolean;
  /** Times the line was voiced again because the voice cut it off mid-word (absent in older reports). */
  retakes?: number;
  /** The line was cut from an earlier dub, not voiced again (absent in older reports). */
  fromDub?: boolean;
  /** The take used still ends before its last word died away: the voice cut it off. */
  cutOff?: boolean;
  /** Breaths silenced in the line (absent in older reports). */
  breathsRemoved?: number;
}

export interface SyncReport {
  precision: SyncPrecision;
  /** The join settings the sync ran with, as the server kept them. */
  join: SyncJoinSettings;
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
    /** Lines pushed later than the join settings allow. */
    late: number;
    /** Joins with less silence between the words than the review limit. */
    tightJoins: number;
    silent: number;
    /** Lines voiced again because the voice cut them off, and lines still cut off after that. */
    retaken?: number;
    cutOff?: number;
    /** Lines cut from an earlier dub rather than voiced again. */
    fromDub?: number;
    /** Breaths silenced across the dub. */
    breathsRemoved?: number;
  };
  units: SyncUnitReport[];
  /** Only for a dub with several speakers: what the mix did, and the overlaps it kept. */
  mix?: DubMixReport;
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
  /** How lines are joined; the server's Natural settings when left out. */
  join?: SyncJoinSettings;
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
  /**
   * Several speakers: each is voiced by their own voice from `cast` (the main
   * voice when they have none), overlaps in the original are kept, and the
   * dub comes back with one stem per speaker.
   */
  multiSpeaker?: boolean;
  cast?: Record<string, SpeakerVoice>;
  /** How a mix above full scale is handled, with several speakers. */
  peak?: MixPeakMode;
  /** Lines locked in Edit timing, by key (syncEditService.lockedLines): held where the user put them. */
  locked?: ReturnType<typeof lockedLines>;
  /** Match source audio: each cue's text tagged from the source, by cue id; the cues are voiced from these. */
  voiceTexts?: Record<string, string>;
  /** Enhance emotion: delivery cues are added to the lines before they are voiced, as in a dub. */
  expressive?: boolean;
  /**
   * A dub made before Dub and Sync were one step (mono WAV) and what it says: every line that still reads the
   * same is cut from it rather than voiced again, so the sync sounds as the dub did.
   */
  dub?: { blob: Blob; lines: DubLines };
}

/** Only what the server reads from each cue; word timings and legacy fields stay behind. */
const slimSegment = (segment: AudioSegment, voiceTexts?: Record<string, string>) => ({
  id: segment.id,
  startTime: segment.startTime,
  endTime: segment.endTime,
  speaker: segment.speaker,
  textTarget: segment.textTarget || segment.targetText || '',
  textSource: segment.textSource || segment.originalText || '',
  ...(voiceTexts?.[segment.id] && { voiceText: voiceTexts[segment.id] }),
});

/**
 * Syncs a dub. Besides the dub it returns its bank, every placed line as the
 * render took it, for Edit timing: `bank` describes the lines and `bankBlob`
 * holds their samples, both kept with the project.
 */
export const syncDub = async (
  request: SyncRequest,
  { apiKey, jobId, signal }: { apiKey?: string; jobId?: string; signal?: AbortSignal } = {}
): Promise<{ blob: Blob; stems: DubStem[]; report: SyncReport; bank: SyncBank; bankBlob: Blob }> => {
  const { cartesia, cast, multiSpeaker, voiceTexts, dub, ...rest } = request;
  // A Cartesia voice gets the same model and delivery as a Cartesia dub.
  const voice =
    cartesia && isCartesiaVoice(request.voiceId)
      ? { modelId: cartesia.modelId || undefined, voiceSettings: cartesiaDelivery(cartesia) }
      : { voiceSettings: request.voiceSettings || undefined };
  type Synced = {
    audioId: string;
    contentType: string;
    stems: { speaker: string; audioId: string; contentType: string }[];
    report: SyncReport;
    bank: SyncBank & { audioId: string };
  };
  const send = (withDub: boolean) =>
    apiJson<Synced>('/sync', {
      body: {
        ...rest,
        ...voice,
        segments: request.segments.map((segment) => slimSegment(segment, voiceTexts)),
        ...(voiceTexts && { performanceTags: true }),
        ...(withDub && dub && { dub: { dubId: dub.lines.dubId, cues: dub.lines.cues } }),
        ...(multiSpeaker && {
          multiSpeaker: true,
          cast: castPayload(cast, { modelId: request.modelId, voiceSettings: request.voiceSettings, cartesia }),
        }),
        jobId,
      },
      keys: { elevenLabsKey: apiKey },
      signal,
    });
  let data: Synced;
  try {
    data = await send(Boolean(dub));
  } catch (err) {
    if (!dub || !(err instanceof DhvaniApiError) || err.code !== 'sync_dub_missing') throw err;
    // The server keeps a dub a few hours, and not across a restart: send it again.
    let sent = true;
    try {
      await apiPutBlob(`/sync/dubs/${encodeURIComponent(dub.lines.dubId)}`, dub.blob, { signal });
    } catch (putErr) {
      if (signal?.aborted) throw putErr;
      // A dub the server can't read (not mono WAV) is no reason to fail: every line is voiced instead.
      console.warn('The dub could not be sent for Sync; every line is voiced again.', putErr);
      sent = false;
    }
    data = await send(sent);
  }
  // The dub, any stems and the bank are fetched on their own: lossless WAV is too big to ride inside JSON.
  const mixed = await fetchMixed(data, signal);
  const { audioId, ...bank } = data.bank;
  const bankBlob = await apiGetAudio(`/sync/audio/${encodeURIComponent(audioId)}`, { signal });
  return { ...mixed, bank, bankBlob };
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
  /** Seconds the user trimmed the line to on the timeline; set only client-side, by withLineTargets. */
  wantSeconds?: number;
  /** Set by the Expert estimate (expertPreview): the line timed in syllables, and its lip closures. */
  expert?: ExpertLine;
}

/** A line as the Expert estimate times it. Seconds in `words` and `dubLips` are from the line's start. */
export interface ExpertLine {
  /** Syllables a second the line was timed at. */
  rate: number;
  syllables: number;
  /** A fast and a slow read of the line, in seconds. */
  low: number;
  high: number;
  words: TimedWord[];
  dubLips: number[];
  /** Where the original speaker's lips close, on the original's clock; empty without word timings. */
  sourceLips: number[];
  lipsMatched: number;
  /** Syllables to take out for the line to fit its slot, or that it has room for; 0 when neither. */
  cut: number;
  room: number;
}

/** A trimmed line within this many seconds of its trim already matches it. */
export const TRIM_TOLERANCE = 0.2;

/** Shortest length a line can be trimmed to. */
export const MIN_TRIM_SECONDS = 0.3;

/**
 * The preview with the user's trims applied: a trimmed line aims for the
 * characters its trimmed length holds at the preview's rate. Status, slot and
 * estimate are left as the server worked them out, so the counts still say
 * how each line sits in its slot.
 */
export const withLineTargets = (preview: SyncPreview | null, segments: AudioSegment[]): SyncPreview | null => {
  if (!preview) return null;
  const want = new Map<string, number>();
  for (const seg of segments) if (seg.dubTargetSeconds && seg.dubTargetSeconds > 0) want.set(String(seg.id), seg.dubTargetSeconds);
  if (want.size === 0) return preview;
  return {
    ...preview,
    units: preview.units.map((unit) => {
      const seconds = want.get(unit.key);
      if (!seconds) return unit;
      // The Expert estimate times each line on its own, so a trim converts at the line's own rate.
      const cps = unit.expert ? unit.text.length / Math.max(0.1, unit.estimate) : preview.charsPerSecond;
      return { ...unit, wantSeconds: seconds, targetChars: Math.max(1, Math.round(seconds * cps)) };
    }),
  };
};

/** True when a trimmed line's estimate is off its trim, so it needs a new wording to match. */
export const wantsChange = (unit: SyncPreviewUnit) =>
  unit.wantSeconds !== undefined && Math.abs(unit.estimate - unit.wantSeconds) > TRIM_TOLERANCE;

export interface SyncPreview {
  precision: SyncPrecision;
  charsPerSecond: number;
  units: SyncPreviewUnit[];
  /** `fits` includes the short lines, which fit their slot; `short` counts them on their own. */
  summary: {
    lines: number;
    fits: number;
    tight: number;
    long: number;
    short: number;
    maxOverflow: number;
    /** Expert only: the original's lip closures, and how many have one in the dub near them. */
    lips?: { matched: number; total: number };
  };
  /** 'quick' (characters at a rate, from the server) unless expertPreview has re-timed it. */
  method?: EstimateMethod;
  /** Expert only: the rate its lines were timed at. */
  syllablesPerSecond?: number;
}

/**
 * How the preview times a dub line. Quick: its characters at the voice's
 * rate. Expert: its syllables at the voice's rate, with pauses, a fast-to-slow
 * range and lip closures.
 */
export type EstimateMethod = 'quick' | 'expert';

/*
 * The thresholds the server's preview uses (server/lib/syncPreview.js and
 * syncDub.js), so an Expert line is called long, tight or short exactly as a
 * Quick one would be at the same length.
 */
const ALLOWED_OVERFLOW: Record<SyncPrecision, number> = { lipsync: 0.15, phrase: 0.3, loose: 0.6 };
const TIGHT_SHARE = 0.9;
const SUGGESTION_MARGIN = 0.92;
const LENGTHEN_FILL = 0.95;
const SHORT_SHARE = 0.6;
const MIN_SHORT_GAP = 1;
/** True when `seconds` of dub leave too much of `spoken` seconds of original unsaid. */
export const isShortSpeech = (seconds: number, spoken: number) => seconds < spoken * SHORT_SHARE && spoken - seconds >= MIN_SHORT_GAP;

/**
 * The server's preview re-timed by the Expert estimate: every line in
 * syllables at `syllablesPerSecond`, its status, overrun and target length
 * worked out again from that, and the lip closures of the original (from the
 * cues' word timings) set against the dub's. Slots stay as the server set them.
 */
export const expertPreview = (preview: SyncPreview, segments: AudioSegment[], syllablesPerSecond: number): SyncPreview => {
  const rate = syllablesPerSecond;
  const cueById = new Map(segments.map((seg) => [String(seg.id), seg]));
  const allowed = ALLOWED_OVERFLOW[preview.precision] ?? ALLOWED_OVERFLOW.phrase;
  const units = preview.units.map((unit): SyncPreviewUnit => {
    const timing = timeLine(unit.text, rate);
    const estimate = timing.seconds;
    const overflow = estimate - unit.slot;
    const short = isShortSpeech(estimate, unit.spoken);
    const status = overflow > allowed ? 'long' : estimate > unit.slot * TIGHT_SHARE ? 'tight' : short ? 'short' : 'fits';
    const chars = unit.text.length;
    const targetChars =
      status === 'short'
        ? Math.max(chars + 1, Math.floor((chars / Math.max(0.1, estimate)) * Math.min(unit.spoken * LENGTHEN_FILL, unit.slot * SUGGESTION_MARGIN)))
        : Math.max(1, Math.floor(chars * Math.min(1, unit.slot / Math.max(0.1, estimate)) * SUGGESTION_MARGIN));
    const sourceLips = unit.cueIds
      .flatMap((id) => sourceLipTimes(cueById.get(String(id))?.words))
      .filter((t) => t >= unit.srcStart - 0.05 && t <= unit.srcStart + unit.slot);
    const dubLips = timing.lips;
    // The syllables the slot holds at this rate, once the line's pauses are taken out.
    const pauses = estimate - timing.syllables / rate;
    const holds = Math.floor(Math.max(0, unit.slot * SUGGESTION_MARGIN - pauses) * rate);
    return {
      ...unit,
      estimate,
      overflow: Math.max(0, overflow),
      underflow: status === 'short' ? Math.max(0, unit.spoken - estimate) : 0,
      status,
      targetChars,
      expert: {
        rate,
        syllables: timing.syllables,
        low: estimate * (1 - READ_SPREAD),
        high: estimate * (1 + READ_SPREAD),
        words: timing.words,
        dubLips,
        sourceLips,
        lipsMatched: matchedLips(sourceLips, dubLips.map((t) => unit.srcStart + t)),
        cut: status === 'long' || status === 'tight' ? Math.max(status === 'tight' ? 1 : 0, timing.syllables - holds) : 0,
        room: status === 'long' ? 0 : Math.max(0, holds - timing.syllables),
      },
    };
  });
  const count = (status: SyncPreviewUnit['status']) => units.filter((u) => u.status === status).length;
  return {
    ...preview,
    method: 'expert',
    syllablesPerSecond: rate,
    units,
    summary: {
      lines: units.length,
      fits: count('fits') + count('short'),
      tight: count('tight'),
      long: count('long'),
      short: count('short'),
      maxOverflow: units.reduce((max, u) => (u.status === 'long' ? Math.max(max, u.overflow) : max), 0),
      lips: {
        matched: units.reduce((sum, u) => sum + (u.expert?.lipsMatched ?? 0), 0),
        total: units.reduce((sum, u) => sum + (u.expert?.sourceLips.length ?? 0), 0),
      },
    },
  };
};

/** Which lines are likely to fit, before anything is voiced. No voice or text model is called. */
export const previewSync = (
  request: { segments: AudioSegment[]; precision: SyncPrecision; charsPerSecond: number; sourceDuration?: number; join?: SyncJoinSettings },
  { signal }: { signal?: AbortSignal } = {}
): Promise<SyncPreview> =>
  apiJson<SyncPreview>('/sync/preview', { body: { ...request, segments: request.segments.map((segment) => slimSegment(segment)) }, signal });

/** One join setting Fit to this video would change, and what in the video says so. */
export interface SyncFitChange {
  key: keyof SyncJoinSettings;
  from: number | boolean;
  to: number | boolean;
  reason: string;
}

export interface SyncFit {
  /** The settings sent, with the changes in them. */
  join: SyncJoinSettings;
  changes: SyncFitChange[];
  measured: { lines: number; speakers: number; pauses: number; handovers: number; wordPauses: number; lengthRatio: number | null };
  /** Why nothing could be measured, or null. */
  note: string | null;
}

/**
 * Join settings measured from this video: the speaker's pauses (from the
 * cues' word timings) and how much longer the dub runs. Nothing is applied.
 */
export const fitJoinSettings = (
  request: { segments: AudioSegment[]; join: SyncJoinSettings; charsPerSecond: number; rateMeasured: boolean },
  { signal }: { signal?: AbortSignal } = {}
): Promise<SyncFit> =>
  apiJson<SyncFit>('/sync/fit', {
    body: { ...request, segments: request.segments.map((segment) => ({ ...slimSegment(segment), words: segment.words })) },
    signal,
  });

/** The lines either side of one being reworded, and who says it, so the text model reads it in context. */
export interface LineContext {
  before: string[];
  after: string[];
  speaker?: string;
}

type LineRequest = {
  text: string;
  sourceText?: string;
  language?: string;
  targetChars: number;
  avoid?: string[];
  /** How many wordings to ask for, 1 to 3; each of a different kind. */
  count?: number;
  context?: LineContext;
};

/**
 * A new wording of a line. `issues` is set when the meaning check did not
 * pass it: what the check found changed, for the user to judge before using it.
 */
export interface LineSuggestion {
  text: string;
  issues?: string[];
}

/**
 * New wordings from the server, which has checked each means what the source
 * line means; those that passed come first. A wording that failed the check
 * still comes back, with `issues`, so pressing the button always gives the
 * user something to judge and edit. Empty when nothing usable came back.
 */
const askForLines = async (path: string, request: LineRequest, signal?: AbortSignal): Promise<LineSuggestion[]> => {
  const { options, line, flagged } = await apiJson<{
    options?: { line: string; issues?: string[] }[];
    line: string | null;
    reason?: 'unusable' | 'meaning' | null;
    flagged?: { line: string; issues: string[] } | null;
  }>(path, { body: request, signal });
  const list = Array.isArray(options) ? options : line ? [{ line }] : flagged?.line ? [flagged] : [];
  return list
    .filter((o) => typeof o?.line === 'string' && o.line.trim())
    .map((o) =>
      o.issues ? { text: o.line, issues: o.issues.length ? o.issues : ['The meaning may differ from the original line.'] } : { text: o.line }
    );
};

/** Shorter wordings of one line from the text model; empty when it had nothing usable. */
export const suggestShorterLine = (request: LineRequest, { signal }: { signal?: AbortSignal } = {}): Promise<LineSuggestion[]> =>
  askForLines('/sync/shorten', request, signal);

/** Fuller wordings of one line that ends too early; empty when it had nothing usable. */
export const suggestLongerLine = (request: LineRequest, { signal }: { signal?: AbortSignal } = {}): Promise<LineSuggestion[]> =>
  askForLines('/sync/lengthen', request, signal);

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

/**
 * Characters the voice is asked to say, counted as the speaking rate counts
 * them. Saved with each dub, so edits made after it don't change the rate the
 * dub is measured at.
 */
export const scriptCharacterCount = (segments: AudioSegment[]): number =>
  segments.reduce((sum, seg) => sum + (seg.textTarget || seg.targetText || '').trim().length, 0);

/** The voice's rate in characters a second, or null when it can't be believed. */
export const speakingRate = (characters: number, speechSeconds: number): number | null => {
  if (!(speechSeconds > 1) || characters <= 0) return null;
  const rate = characters / speechSeconds;
  return rate >= 5 && rate <= 35 ? rate : null;
};

/** The voice's rate as a sync measured it: each voiced line's characters over the seconds its words took. */
export const syncedSpeakingRate = (report: Pick<SyncReport, 'units'> | null | undefined): number | null => {
  let characters = 0;
  let seconds = 0;
  for (const unit of report?.units || []) {
    if (unit.silent || !(unit.speech > 0)) continue;
    characters += unit.text.trim().length;
    seconds += unit.speech;
  }
  return speakingRate(characters, seconds);
};
