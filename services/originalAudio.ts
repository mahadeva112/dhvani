import type { AudioMetadata, AudioSegment } from '../types';
import { apiPutBlob, DhvaniApiError } from './apiClient.ts';
import { analyzeAudio, blobBytes, detectSpeechSegments, httpBytes, readPcmPeaks, type AudioAnalysisOptions } from './audioService.ts';
import { isStreamedAudio, type WaveAudio } from './waveform.ts';

/**
 * The original of a project, opened without holding its samples: as its
 * peaks and levels, its samples read a stretch at a time when they are
 * needed. Two and a half hours of stereo video audio decoded in the page is
 * 3.5 GB; held this way it is about 30 MB.
 *
 * A plain PCM WAV is read straight from the file. Anything else (a video,
 * an MP3) goes to the server, which keeps its audio track as a 16-bit WAV in
 * the temp folder while the project is open (server/lib/originals.js) and
 * hands out stretches of it; closing the project deletes it. Without ffmpeg
 * the original is decoded whole in the page, as it always was.
 */
export const loadOriginal = async (
  file: File,
  options?: AudioAnalysisOptions
): Promise<{ segments: AudioSegment[]; buffer: WaveAudio; metadata: AudioMetadata }> => {
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
    throw new Error('Invalid file type. Please upload an audio (MP3, WAV, etc.) or video file.');
  }
  let audio: WaveAudio | null = await readPcmPeaks(blobBytes(file), { levels: true });
  if (!audio) {
    try {
      const { id, bytes } = await apiPutBlob<{ id: string; bytes: number }>('/media/originals', file);
      const url = `/api/media/originals/${encodeURIComponent(id)}`;
      // keepalive: the page may be leaving (pagehide), and the delete must still reach the server.
      const close = async () => {
        await fetch(url, { method: 'DELETE', keepalive: true }).catch(() => undefined);
      };
      try {
        audio = await readPcmPeaks(httpBytes(url, bytes), { levels: true });
      } catch (err) {
        await close();
        throw err;
      }
      if (audio) audio.close = close;
      else await close();
    } catch (err) {
      // No ffmpeg, an older server, a full drive: the original still opens, decoded whole in the page as before.
      if (!(err instanceof DhvaniApiError) || err.code !== 'ffmpeg_missing') console.warn('The original could not be read a stretch at a time; decoding it whole:', err);
    }
  }
  if (!audio) return analyzeAudio(file, options);
  const segments = options?.detect === false ? [] : detectSpeechSegments(audio, options);
  return { segments, buffer: audio, metadata: { duration: audio.duration, fileName: file.name, fileType: file.type || 'audio/wav' } };
};

/** Lets the server delete the WAV it keeps for `audio` (an original read from it); anything else is left to the page. */
export const closeOriginal = (audio: WaveAudio | null | undefined) => {
  if (isStreamedAudio(audio)) void audio.close?.();
};
