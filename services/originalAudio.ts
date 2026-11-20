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
 * hands out stretches of it; closing the project deletes it, and so does the
 * page going any other way (a crash, a kill), a minute later. Without ffmpeg
 * the original is decoded whole in the page, as it always was.
 */
/** How long to wait before holding an original again once the request holding it ended (the server restarted). */
const HOLD_AGAIN_MS = 2000;
/**
 * A hold silent this long is taken for gone: the server beats every 10 s,
 * and a proxy in between (the dev server) can keep a request open after the
 * server behind it went. Well inside the minute a server gives a page to
 * hold its original again.
 */
const HOLD_QUIET_MS = 25_000;

/**
 * Holds the original at `url` open on the server while the project is open:
 * a request kept open, so a page closed or killed without a word lets go of
 * it and the server deletes it a minute later (server/lib/originals.js). When
 * the request ends while the project is still open (the server restarted),
 * it is held again; only a server that no longer has it (404) ends that.
 * Returns the function that lets go.
 */
const holdOpen = (url: string) => {
  let open = true;
  let request: AbortController | null = null;
  void (async () => {
    while (open) {
      const current = new AbortController();
      request = current;
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const heard = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => current.abort(), HOLD_QUIET_MS);
      };
      try {
        heard();
        const response = await fetch(`${url}/hold`, { signal: current.signal, cache: 'no-store' });
        if (response.status === 404) return;
        const reader = response.body?.getReader();
        if (reader) while (!(await reader.read()).done) heard();
      } catch {
        // The server went away, the hold went quiet, or the project closed.
      } finally {
        clearTimeout(quiet);
      }
      if (open) await new Promise((done) => setTimeout(done, HOLD_AGAIN_MS));
    }
  })();
  return () => {
    open = false;
    request?.abort();
  };
};

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
      const letGo = holdOpen(url);
      // keepalive: the page may be leaving (pagehide), and the delete must still reach the server.
      const close = async () => {
        letGo();
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
