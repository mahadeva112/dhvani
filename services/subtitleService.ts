import { AudioSegment, WordTimestamp } from '../types';
import { apiStream, apiJson, apiUpload, StreamEvent, RequestOptions } from './apiClient';

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
  diarize?: boolean;
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
    keys,
    signal,
  }: RequestOptions & { sourceLanguage?: string; targetLanguage: string; customPrompt?: string }
): Promise<{ segments: AudioSegment[]; translatedSrt: string; untranslatedCueIds: string[] }> => {
  const response = await apiJson<{
    cues: PipelineCue[];
    translatedSrt: string;
    untranslatedCueIds: string[];
  }>('/pipeline/retranslate', {
    body: { cues: segmentsToCues(segments), sourceLanguage, targetLanguage, customPrompt },
    keys,
    signal,
  });

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
