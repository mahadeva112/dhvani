import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { elevenLabsMultipart } from './client.js';
import { toIsoCode, toDisplayName } from '../../lib/languages.js';
import { buildCuesFromWords } from '../../lib/srt.js';
import { extractAudioTrack, isVideoFile, cleanupFiles, probeDuration } from '../../lib/media.js';

const MIME_BY_EXTENSION = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
};

const guessMime = (filename, fallback) =>
  MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] || fallback || 'application/octet-stream';

/**
 * Transcribes a media file with ElevenLabs Scribe and returns word-level
 * timestamps plus cues derived from them.
 *
 * ElevenLabs is the single source of truth for both the transcript and every
 * timestamp in the pipeline.
 */
export const transcribeFile = async (
  file,
  {
    sourceLanguage = '',
    modelId,
    diarize = false,
    tagAudioEvents = false,
    cueOptions = {},
    apiKey,
    onStatus,
  } = {}
) => {
  let uploadPath = file.path;
  let extractedPath = null;

  try {
    if (isVideoFile(file.originalname, file.mimetype)) {
      extractedPath = await extractAudioTrack(file.path, { onStatus });
      if (extractedPath) uploadPath = extractedPath;
    }

    const uploadName = extractedPath
      ? `${path.parse(file.originalname).name}.wav`
      : file.originalname;

    const stats = await fs.promises.stat(uploadPath);
    if (stats.size === 0) {
      throw new ApiError('The uploaded file is empty.', { status: 400, code: 'empty_file' });
    }

    onStatus?.('Uploading audio to ElevenLabs for transcription...');

    const form = new FormData();
    form.append(
      'file',
      new Blob([await fs.promises.readFile(uploadPath)], {
        type: extractedPath ? 'audio/wav' : guessMime(file.originalname, file.mimetype),
      }),
      uploadName
    );
    form.append('model_id', modelId || config.elevenlabs.sttModel);
    form.append('timestamps_granularity', 'word');
    form.append('diarize', String(Boolean(diarize)));
    form.append('tag_audio_events', String(Boolean(tagAudioEvents)));

    // Omitting language_code lets Scribe auto-detect, which is what "Auto Detect" means.
    const isoCode = toIsoCode(sourceLanguage);
    if (isoCode) form.append('language_code', isoCode);

    const response = await elevenLabsMultipart('/speech-to-text', form, { apiKey });
    const data = await response.json();

    const words = Array.isArray(data.words) ? data.words : [];
    if (words.length === 0 && !String(data.text || '').trim()) {
      throw new ApiError(
        'ElevenLabs returned an empty transcription. The file may contain no intelligible speech, ' +
          'or the selected source language may not match the audio.',
        { status: 422, code: 'empty_transcription', provider: 'elevenlabs' }
      );
    }

    if (words.length === 0) {
      throw new ApiError(
        'ElevenLabs returned text but no word timestamps, so accurate subtitle timing is not possible. ' +
          'Try the scribe_v1 model, or re-upload the file as audio.',
        { status: 422, code: 'no_timestamps', provider: 'elevenlabs' }
      );
    }

    onStatus?.('Building subtitle cues from ElevenLabs timestamps...');

    const cues = buildCuesFromWords(words, cueOptions);
    const detectedIso = data.language_code || isoCode;
    const duration = (await probeDuration(uploadPath)) ?? cues.at(-1)?.endTime ?? 0;

    logger.success(
      `Transcribed "${file.originalname}" — ${words.length} words, ${cues.length} cues, ` +
        `language ${detectedIso || 'unknown'}`
    );

    return {
      text: String(data.text || cues.map((cue) => cue.text).join(' ')).trim(),
      languageCode: detectedIso || '',
      languageName: toDisplayName(detectedIso, sourceLanguage || 'Unknown'),
      languageProbability:
        typeof data.language_probability === 'number' ? data.language_probability : null,
      words,
      cues,
      duration,
      audioExtracted: Boolean(extractedPath),
    };
  } finally {
    await cleanupFiles(extractedPath);
  }
};
