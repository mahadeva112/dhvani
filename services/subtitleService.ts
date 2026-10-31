import { AudioSegment, WordTimestamp } from '../types';
import { apiStream, apiJson, apiGet, apiUpload, DhvaniApiError, StreamEvent, RequestOptions } from './apiClient';

/**
 * Client side of the subtitle workflow.
 *
 *   Upload -> ElevenLabs transcription + word timestamps -> original SRT
 *          -> Gemini translation -> translated SRT (same timestamps)
 *
 * Cues arrive from the backend already timed by ElevenLabs. Nothing in this
 * file computes, shifts or rounds a timestamp.
 */

export interface PipelineCue {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  speaker: string;
  text: string;
  translatedText?: string;
  /** The translation with the speaker's pauses as pause marks, for the voice only. */
  pausedText?: string;
  words: WordTimestamp[];
}

export interface PipelineResult {
  detectedLanguage: string;
  detectedLanguageCode: string;
  languageProbability: number | null;
  duration: number;
  audioExtracted: boolean;
  transcript: string;
  words: WordTimestamp[];
  cues: PipelineCue[];
  originalSrt: string;
  translatedSrt: string;
  targetLanguage: string | null;
  translationModel: string | null;
  translationWarning: string | null;
  untranslatedCueIds: string[];
  timingSource: string;
  elapsedMs: number;
}

export interface PipelineProgress {
  stage: string;
  progress: number;
  message: string;
}

/** Converts backend cues into the AudioSegment shape the existing UI renders. */
export const cuesToSegments = (cues: PipelineCue[]): AudioSegment[] =>
  cues.map((cue, index) => ({
    id: cue.id ?? `cue-${index + 1}`,
    startTime: cue.startTime,
    endTime: cue.endTime,
    duration: Math.max(0.05, cue.endTime - cue.startTime),
    speaker: cue.speaker || 'Speaker',
    textSource: cue.text || '',
    textTarget: cue.translatedText ?? cue.text ?? '',
    ...(cue.pausedText && { pausedTarget: cue.pausedText }),
    // Retained verbatim so SRT export can cut cues on real word boundaries.
    words: cue.words || [],
    timingSource: 'elevenlabs',
  }));

/** Converts UI segments back into the cue shape the backend expects. */
export const segmentsToCues = (segments: AudioSegment[]): PipelineCue[] =>
  segments.map((segment, index) => ({
    id: String(segment.id ?? `cue-${index + 1}`),
    index: index + 1,
    startTime: segment.startTime,
    endTime: segment.endTime,
    speaker: segment.speaker || 'Speaker',
    text: segment.textSource || (segment as any).originalText || segment.textTarget || '',
    words: segment.words || [],
  }));

export interface TranscribeAndTranslateOptions extends RequestOptions {
  sourceLanguage?: string;
  targetLanguage?: string;
  customPrompt?: string;
  translate?: boolean;
  /** Ask ElevenLabs to tell speakers apart, and optionally how many there are. */
  diarize?: boolean;
  numSpeakers?: number;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Runs the full pipeline for one media file.
 *
 * Returns the transcription even when translation fails; check
 * `translationWarning` to surface a partial outcome to the user.
 */
export const transcribeAndTranslate = async (
  file: File,
  {
    sourceLanguage = '',
    targetLanguage = '',
    customPrompt = '',
    translate = true,
    diarize = false,
    numSpeakers,
    onProgress,
    keys,
    signal,
  }: TranscribeAndTranslateOptions = {}
): Promise<PipelineResult> => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('targetLanguage', targetLanguage);
  formData.append('customPrompt', customPrompt);
  formData.append('translate', String(translate));
  formData.append('diarize', String(diarize));
  if (diarize && numSpeakers) formData.append('numSpeakers', String(numSpeakers));

  return apiStream<PipelineResult>('/pipeline/subtitles', formData, {
    keys,
    signal,
    onEvent: (event: StreamEvent) => {
      onProgress?.({
        stage: event.stage || 'working',
        progress: typeof event.progress === 'number' ? event.progress : 0,
        message: event.message || 'Working...',
      });
    },
  });
};

/** Live progress of a cue retranslation, streamed batch by batch. */
export interface RetranslateProgress {
  /** Batches finished so far (the backend reports each batch as it starts). */
  done: number;
  /** Total batches, or 0 before the backend has planned them. */
  total: number;
  cueCount: number;
  message: string;
  /** What the current batch is on: its first translation, or the meaning and length checks after it. */
  step?: 'translate' | 'check';
}

/**
 * How far a translation is, 0–0.98, counting a batch's checks as its second
 * half. Null for a single batch: it reports only "started" and "checking",
 * so any percent would just sit still until the end.
 */
export const translationFraction = (progress: RetranslateProgress | null): number | null =>
  progress && progress.total > 1
    ? Math.min(0.98, (progress.done + (progress.step === 'check' ? 0.5 : 0)) / progress.total)
    : null;

interface RetranslateResult {
  cues: PipelineCue[];
  translatedSrt: string;
  untranslatedCueIds: string[];
}

/** How long the backend may stay out of reach (a watchdog restart takes about a minute). */
const TRANSLATION_RECONNECT_MS = 150_000;
const TRANSLATION_POLL_MS = 4_000;
/** Restarts a translation carries on through before it gives up. */
const MAX_TRANSLATION_RESUMES = 3;

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DhvaniApiError('The translation was cancelled.', { code: 'cancelled' }));
      },
      { once: true }
    );
  });

/**
 * Picks up a translation whose stream dropped: asks the backend for the job
 * until it ends, riding out a short outage. A backend that no longer knows
 * the job restarted mid-translation (translation_lost); retranslateCues then
 * sends it again, and the backend carries on from its saved batches.
 */
const awaitTranslationJob = async (
  jobId: string,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: StreamEvent) => void }
): Promise<RetranslateResult> => {
  let unreachableSince: number | null = null;
  for (;;) {
    await pause(TRANSLATION_POLL_MS, signal);
    let job: { state: string; progress: StreamEvent | null; result: RetranslateResult | null; error: any };
    try {
      job = await apiGet(`/pipeline/retranslate/${jobId}`, { signal, retry: false });
      unreachableSince = null;
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof DhvaniApiError && err.code === 'job_not_found') {
        throw new DhvaniApiError(
          'The DHVANI backend kept restarting while it was translating, so the translation stopped. Your cues are unchanged.',
          { code: 'translation_lost', retryable: true }
        );
      }
      unreachableSince ??= Date.now();
      if (Date.now() - unreachableSince > TRANSLATION_RECONNECT_MS) throw err;
      continue;
    }
    if (job.state === 'done' && job.result) return job.result;
    if (job.state === 'failed') {
      throw new DhvaniApiError(job.error?.message || 'The translation failed.', {
        code: job.error?.code,
        provider: job.error?.provider,
        retryable: job.error?.retryable,
        details: job.error?.details,
      });
    }
    if (job.progress) onEvent(job.progress);
  }
};

/**
 * Re-translates cues that are already transcribed.
 *
 * This is the recovery path when translation fails or the user changes the
 * target language: the audio is never re-sent and the timestamps are reused.
 */
export const retranslateCues = async (
  segments: AudioSegment[],
  {
    sourceLanguage = '',
    targetLanguage,
    customPrompt = '',
    voiceRate,
    speakerRates,
    fast = false,
    keys,
    signal,
    onProgress,
  }: RequestOptions & {
    sourceLanguage?: string;
    targetLanguage: string;
    customPrompt?: string;
    /** The dub voice's speaking rate in syllables a second: each cue is then sized for that voice. */
    voiceRate?: number;
    /** The same for the speakers who have a voice of their own, by speaker name. */
    speakerRates?: Record<string, number>;
    /** Translation only: no meaning, length or term checks, several batches at once. */
    fast?: boolean;
    onProgress?: (progress: RetranslateProgress) => void;
  }
): Promise<{ segments: AudioSegment[]; translatedSrt: string; untranslatedCueIds: string[] }> => {
  const report = (event: StreamEvent) => {
    const total = Number(event.batchCount) || 0;
    onProgress?.({
      done: Math.max(0, (Number(event.batch) || 0) - 1),
      total,
      cueCount: Number(event.cueCount) || segments.length,
      message: String(event.message || '').replace(/\.+$/, ''),
      step: event.step === 'check' ? 'check' : 'translate',
    });
  };

  // The backend keeps the translation under this id, so a connection that
  // drops halfway through a long script no longer loses the work.
  const jobId = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const body = { cues: segmentsToCues(segments), sourceLanguage, targetLanguage, customPrompt, ...(voiceRate && { voiceRate }), ...(speakerRates && Object.keys(speakerRates).length > 0 && { speakerRates }), ...(fast && { fast }), jobId };

  let response: RetranslateResult | null = null;
  for (let resumes = 0; !response; resumes += 1) {
    try {
      response = await apiStream<RetranslateResult>('/pipeline/retranslate', body, { keys, signal, onEvent: report });
    } catch (err) {
      const dropped = err instanceof DhvaniApiError && (err.code === 'backend_unreachable' || err.code === 'incomplete_stream');
      if (signal?.aborted || !dropped) throw err;
      try {
        response = await awaitTranslationJob(jobId, { signal, onEvent: report });
      } catch (lost) {
        // The backend restarted mid-run: sent again under the same id, it
        // carries on from the batches it had saved instead of starting over.
        if (!(lost instanceof DhvaniApiError && lost.code === 'translation_lost') || resumes >= MAX_TRANSLATION_RESUMES) throw lost;
        onProgress?.({ done: 0, total: 0, cueCount: segments.length, message: 'The backend restarted; carrying on from the last finished batch' });
      }
    }
  }

  // Merge by id so any UI-only field on the original segment survives.
  const byId = new Map(response.cues.map((cue) => [String(cue.id), cue]));

  return {
    segments: segments.map((segment) => {
      const cue = byId.get(String(segment.id));
      if (!cue) return segment;
      const translated = cue.translatedText || segment.textTarget || '';
      return {
        ...segment,
        // startTime / endTime deliberately untouched.
        textTarget: translated,
        targetText: translated,
        // A new translation replaces the pauses of the one before.
        pausedTarget: cue.pausedText || undefined,
      } as AudioSegment;
    }),
    translatedSrt: response.translatedSrt,
    untranslatedCueIds: response.untranslatedCueIds || [],
  };
};

/** Transcription only, with no translation step. */
export const transcribeOnly = async (
  file: File,
  {
    sourceLanguage = '',
    diarize = false,
    keys,
    signal,
  }: RequestOptions & { sourceLanguage?: string; diarize?: boolean } = {}
): Promise<PipelineResult> => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('sourceLanguage', sourceLanguage);
  formData.append('diarize', String(diarize));

  return apiUpload<PipelineResult>('/transcription', formData, { keys, signal });
};

/** Translates a complete SRT document, preserving every timestamp in it. */
export const translateSrtDocument = async (
  srt: string,
  {
    sourceLanguage = '',
    targetLanguage,
    customPrompt = '',
    keys,
    signal,
  }: RequestOptions & { sourceLanguage?: string; targetLanguage: string; customPrompt?: string }
): Promise<{ srt: string; cueCount: number; untranslatedCueIds: string[] }> =>
  apiJson('/translation/srt', {
    body: { srt, sourceLanguage, targetLanguage, customPrompt },
    keys,
    signal,
  });
