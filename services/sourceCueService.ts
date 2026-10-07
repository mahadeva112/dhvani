import { AudioSegment } from '../types';
import { apiUpload } from './apiClient';
import { audioBufferToWav } from './audioService';

/**
 * "Match source audio": the dub script tagged where the original speaker's
 * delivery shifts ([explaining, calm, slow], [sentence-build pause], ...), so
 * Eleven v3/v4 speaks it as the source was spoken. The backend listens to the
 * source audio cue by cue (server/lib/sourceCues.js); every word stays as
 * written, and a cue whose tags don't fit is voiced as written.
 */

/** Rate the source is sent at: speech only needs to be heard, not played. */
const LISTEN_SAMPLE_RATE = 16000;

/** The source as a small mono WAV for the model to listen to. */
const listeningCopy = async (buffer: AudioBuffer): Promise<Blob> => {
  const length = Math.max(1, Math.ceil(buffer.duration * LISTEN_SAMPLE_RATE));
  const context = new OfflineAudioContext(1, length, LISTEN_SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return audioBufferToWav(await context.startRendering());
};

const cueText = (segment: AudioSegment) => String(segment.textTarget || segment.targetText || '').trim();

export interface SourceCueResult {
  /** The segments with their dub text tagged. */
  segments: AudioSegment[];
  /** Sections of the script heard, and how many of them got tags. */
  sections: number;
  taggedSections: number;
}

export const matchSourceDelivery = async (
  audio: AudioBuffer,
  segments: AudioSegment[],
  language: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<SourceCueResult> => {
  const form = new FormData();
  form.append('file', await listeningCopy(audio), 'source.wav');
  form.append(
    'cues',
    JSON.stringify(segments.map((segment) => ({ start: segment.startTime, end: segment.endTime, text: cueText(segment) })))
  );
  if (language) form.append('language', language);

  const result = await apiUpload<{ texts: string[]; sections: number; taggedSections: number }>(
    '/delivery/source-cues',
    form,
    { signal }
  );
  if (!Array.isArray(result?.texts) || result.texts.length !== segments.length) {
    throw new Error('The source-matched script did not line up with the cues.');
  }
  return {
    segments: segments.map((segment, i) =>
      cueText(segment) ? { ...segment, textTarget: result.texts[i], targetText: undefined } : segment
    ),
    sections: result.sections,
    taggedSections: result.taggedSections,
  };
};
