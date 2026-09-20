import { AudioSegment, ValidationResult, SubtitleConfiguration } from '../types';
import { apiAudio, apiJson, apiUpload } from './apiClient';
import { transcribeAndTranslate, cuesToSegments, segmentsToCues } from './subtitleService';
import { resegmentByWordTimestamps } from './srtService';

/**
 * Gemini client.
 *
 * Gemini's role in this app is translation and text work. It never produces,
 * estimates or edits a subtitle timestamp — those come from ElevenLabs word
 * timings and are carried through untouched (see `services/subtitleService.ts`
 * and `server/lib/srt.js`).
 *
 * All calls go through the local backend, which holds GEMINI_API_KEY. No
 * Google SDK is loaded in the browser and no key reaches client-side code.
 */

const geminiKeys = (apiKey?: string) => ({ keys: { geminiKey: apiKey } });

/**
 * Translates existing dialogue cues into a new target language.
 *
 * Timings are passed through locally and never sent to the model; on failure
 * the original segments are returned so no reviewed work is lost.
 */
export const translateSegmentsToLanguage = async (
  segments: AudioSegment[],
  targetLanguage: string,
  customPrompt?: string,
  sourceLanguage?: string
): Promise<AudioSegment[]> => {
  if (!segments?.length) return [];

  try {
    const response = await apiJson<{ translations: { id: string; translatedText: string }[] }>(
      '/translation/segments',
      {
        body: {
          segments: segmentsToCues(segments).map((cue) => ({ id: cue.id, sourceText: cue.text })),
          sourceLanguage: sourceLanguage || '',
          targetLanguage,
          customPrompt,
        },
      }
    );

    const byId = new Map(response.translations.map((item) => [String(item.id), item.translatedText]));

    return segments.map((segment) => {
      const newText =
        byId.get(String(segment.id)) || segment.textTarget || (segment as any).targetText || '';
      return { ...segment, textTarget: newText, targetText: newText } as AudioSegment;
    });
  } catch (error) {
    console.warn('Segment translation failed; keeping the existing text:', error);
    return segments;
  }
};

/**
 * Transcribes and translates a media file.
 *
 * ElevenLabs produces the transcript and every timestamp; Gemini translates the
 * text. A translation failure still returns the transcription, with the problem
 * reported in `translationWarning`.
 */
export const transcribeMedia = async (
  file: File,
  targetLanguage: string,
  customPrompt?: string,
  onStatusUpdate?: (status: string) => void,
  sourceLanguage?: string
): Promise<{
  script: string;
  segments: AudioSegment[];
  detectedLanguage: string;
  originalSrt: string;
  translatedSrt: string;
  translationWarning: string | null;
}> => {
  const result = await transcribeAndTranslate(file, {
    sourceLanguage: sourceLanguage || '',
    targetLanguage,
    customPrompt,
    onProgress: (progress) => onStatusUpdate?.(progress.message),
  });

  const segments = cuesToSegments(result.cues);

  return {
    script: segments
      .map((segment) => segment.textTarget)
      .filter(Boolean)
      .join(' ')
      .trim(),
    segments,
    detectedLanguage: result.detectedLanguage,
    originalSrt: result.originalSrt,
    translatedSrt: result.translatedSrt,
    translationWarning: result.translationWarning,
  };
};

/**
 * Distributes a pasted target-language script across the existing cues.
 * Cue timings are inputs to the alignment, never outputs.
 */
export const alignCustomScriptWithGemini = async (
  segments: AudioSegment[],
  pastedScript: string,
  targetLanguage: string
): Promise<{ id: string | number; targetText: string }[]> => {
  if (!segments?.length || !pastedScript.trim()) return [];

  const response = await apiJson<{ alignedCues: { id: string; targetText: string }[] }>(
    '/translation/align',
    {
      body: {
        segments: segmentsToCues(segments).map((cue) => ({ id: cue.id, sourceText: cue.text })),
        pastedScript,
        targetLanguage,
      },
    }
  );

  const byId = new Map(response.alignedCues.map((cue) => [String(cue.id), cue.targetText]));
  return segments.map((segment) => ({
    id: segment.id,
    targetText: byId.get(String(segment.id)) || '',
  }));
};

/** Detects the speaker's expression/tone from the audio. */
export const detectAudioExpression = async (audioFile: File): Promise<string> => {
  try {
    const formData = new FormData();
    formData.append('file', audioFile, audioFile.name);
    const response = await apiUpload<{ expression: string }>('/gemini/expression', formData);
    return response.expression || 'Natural';
  } catch (error) {
    console.error('Expression detection failed:', error);
    return 'Natural';
  }
};

/**
 * Splits one cue into smaller cues.
 *
 * Boundaries snap onto the cue's ElevenLabs word timestamps when it has them,
 * so a split never invents a timing that was not measured from the audio.
 */
export const splitSegment = async (segment: AudioSegment): Promise<AudioSegment[]> => {
  const text = (segment.textTarget || segment.textSource || '').trim();
  if (!text) return [segment];

  const response = await apiJson<{ segments: AudioSegment[] }>('/gemini/split', {
    body: {
      segment: {
        id: String(segment.id),
        startTime: segment.startTime,
        endTime: segment.endTime,
        speaker: segment.speaker,
        textSource: segment.textSource,
        textTarget: segment.textTarget,
        words: segment.words || [],
      },
    },
  });

  return response.segments?.length ? response.segments : [segment];
};

/**
 * Re-cuts the whole transcript to subtitle constraints.
 *
 * Reuses the ElevenLabs word timestamps already attached to the segments, so
 * re-segmentation stays anchored to measured audio rather than an estimate.
 */
export const optimizeSegments = async (
  currentSegments: AudioSegment[],
  config: SubtitleConfiguration
): Promise<AudioSegment[]> => resegmentByWordTimestamps(currentSegments, config);

/** Validates generated SSML against the measured speech activity. */
export const validateXmlTiming = async (
  xml: string,
  _audioFile: File | null,
  durationLimit: number | undefined,
  detectedSegments: AudioSegment[] = []
): Promise<ValidationResult> => {
  try {
    return await apiJson<ValidationResult>('/gemini/validate-ssml', {
      body: {
        ssml: xml,
        durationLimit,
        segments: detectedSegments.map((segment) => ({
          startTime: segment.startTime,
          endTime: segment.endTime,
        })),
      },
    });
  } catch (error: any) {
    return {
      isValid: false,
      durationStatus: 'Unknown',
      timingMatch: 'Not Applicable',
      issues: [`Validation could not run: ${error?.message || error}`],
    };
  }
};

/** Generates ElevenLabs SSML from the reviewed script and measured rhythm. */
export const generateElevenLabsXml = async (
  script: string,
  segments: AudioSegment[],
  manualDuration?: number,
  expression?: string,
  pronunciations?: { original: string; replacement: string }[],
  audioFile?: File | null,
  language: string = 'Bengali',
  onStatusUpdate?: (status: string) => void
): Promise<string> => {
  onStatusUpdate?.('Generating SSML with Gemini...');

  const formData = new FormData();
  formData.append('script', script);
  formData.append(
    'segments',
    JSON.stringify(
      segments.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        textTarget: segment.textTarget,
      }))
    )
  );
  if (manualDuration) formData.append('manualDuration', String(manualDuration));
  if (pronunciations?.length) formData.append('pronunciations', JSON.stringify(pronunciations));
  formData.append('language', language);
  if (audioFile) formData.append('file', audioFile, audioFile.name);

  const response = await apiUpload<{ ssml: string }>('/gemini/ssml', formData);
  return response.ssml;
};

/** Gemini text-to-speech. Returns a WAV blob. */
export const synthesizeSpeechGemini = async (
  text: string,
  voiceName: string,
  expression: string = 'Neutral'
): Promise<Blob> => apiAudio('/gemini/tts', { text, voiceName, expression });

export interface IndicPolishResult {
  originalText: string;
  correctedText: string;
  changesMade: boolean;
  notes?: string;
}

/** Repairs phonetically typed Indic text (matras, conjuncts, halants). */
export const polishIndicDialogueWithAI = async (
  text: string,
  targetLanguage: string,
  context?: string
): Promise<IndicPolishResult> => {
  if (!text?.trim()) {
    return { originalText: text, correctedText: text, changesMade: false };
  }

  return apiJson<IndicPolishResult>('/translation/polish', {
    body: { text, targetLanguage, context },
  });
};

/**
 * Kept for source compatibility with older call sites. The model cascade now
 * lives on the backend, which owns the API key.
 *
 * @deprecated Call a specific service function instead.
 */
export const callGeminiWithModelFallback = async () => {
  throw new Error(
    'callGeminiWithModelFallback has moved to the backend. Use a specific service function such as ' +
      'translateSegmentsToLanguage or transcribeMedia instead.'
  );
};
