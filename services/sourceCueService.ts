import { AudioSegment } from '../types';
import { apiUpload } from './apiClient';
import { audioBufferToWav, readRange } from './audioService';
import { isStreamedAudio, type WaveAudio } from './waveform';

/**
 * Voice expression "Natural": the dub script tagged where the original speaker's
 * delivery shifts ([explaining, calm, slow], [sentence-build pause], ...), so
 * Eleven v3/v4 speaks it as the source was spoken. The backend listens to the
 * source audio cue by cue (server/lib/sourceCues.js); every word stays as
 * written, and a cue whose tags don't fit is voiced as written.
 */

/** Rate the source is sent at: speech only needs to be heard, not played. */
const LISTEN_SAMPLE_RATE = 16000;

/** The source as a small mono WAV for the model to listen to. */
/** Minutes of the original made into the listening copy at a time. */
const LISTEN_PIECE_SECONDS = 60;

/** 16-bit mono PCM pieces at LISTEN_SAMPLE_RATE as one WAV. */
const wavOfPieces = (pieces: Int16Array[]): Blob => {
  const frames = pieces.reduce((n, p) => n + p.length, 0);
  const head = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  head.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, LISTEN_SAMPLE_RATE, true);
  head.setUint32(28, LISTEN_SAMPLE_RATE * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  text(36, 'data');
  head.setUint32(40, frames * 2, true);
  return new Blob([head.buffer, ...pieces.map((p) => p.buffer as ArrayBuffer)], { type: 'audio/wav' });
};

/**
 * The original at 16 kHz mono, for the model to listen to. Short audio
 * decoded whole is made in one go, as before; an original held as its peaks
 * is read and made a minute at a time, so the page never holds all of it.
 */
const listeningCopy = async (audio: WaveAudio): Promise<Blob> => {
  if (!isStreamedAudio(audio)) {
    const length = Math.max(1, Math.ceil(audio.duration * LISTEN_SAMPLE_RATE));
    const context = new OfflineAudioContext(1, length, LISTEN_SAMPLE_RATE);
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(context.destination);
    source.start();
    return audioBufferToWav(await context.startRendering());
  }
  const pieces: Int16Array[] = [];
  for (let at = 0; at < audio.duration; at += LISTEN_PIECE_SECONDS) {
    const end = Math.min(audio.duration, at + LISTEN_PIECE_SECONDS);
    const length = Math.max(1, Math.round(end * LISTEN_SAMPLE_RATE) - Math.round(at * LISTEN_SAMPLE_RATE));
    const context = new OfflineAudioContext(1, length, LISTEN_SAMPLE_RATE);
    const source = context.createBufferSource();
    source.buffer = await readRange(audio, at, end);
    source.connect(context.destination);
    source.start();
    const heard = (await context.startRendering()).getChannelData(0);
    const pcm = new Int16Array(heard.length);
    for (let i = 0; i < heard.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(heard[i] * 32767)));
    pieces.push(pcm);
  }
  return wavOfPieces(pieces);
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
  audio: WaveAudio,
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
