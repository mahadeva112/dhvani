import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { buildCuesFromWords } from '../../lib/srt.js';
import { extractAudioTrack, isVideoFile, cleanupFiles, probeDuration } from '../../lib/media.js';
import { cartesiaMultipart, toCartesiaLanguage, fromCartesiaLanguage } from './client.js';

/**
 * Transcribes a media file with Cartesia Ink and returns word-level timestamps
 * plus cues built from them, in the same shape as the ElevenLabs transcriber,
 * so the rest of the pipeline cannot tell the two apart.
 *
 * Cartesia's batch endpoint does not detect the language (it assumes English
 * when none is given), so an "Auto Detect" upload is refused with a clear
 * message rather than transcribed as English.
 */
export const transcribeFile = async (
  file,
  { sourceLanguage = '', cueOptions = {}, apiKey, onStatus } = {}
) => {
  const language = toCartesiaLanguage(sourceLanguage);
  if (!language) {
    throw new ApiError(
      'Cartesia transcription cannot detect the spoken language. Choose it under "Spoken in", ' +
        'or switch transcription back to ElevenLabs in API settings.',
      { status: 400, code: 'language_required', provider: 'cartesia' }
    );
  }

  let uploadPath = file.path;
  let extractedPath = null;

  try {
    if (isVideoFile(file.originalname, file.mimetype)) {
      extractedPath = await extractAudioTrack(file.path, { onStatus });
      if (extractedPath) uploadPath = extractedPath;
    }

    const stats = await fs.promises.stat(uploadPath);
    if (stats.size === 0) {
      throw new ApiError('The uploaded file is empty.', { status: 400, code: 'empty_file' });
    }

    onStatus?.('Uploading audio to Cartesia for transcription...');

    const uploadName = extractedPath ? `${path.parse(file.originalname).name}.wav` : file.originalname;
    const form = new FormData();
    form.append(
      'file',
      new Blob([await fs.promises.readFile(uploadPath)], {
        type: extractedPath ? 'audio/wav' : file.mimetype || 'application/octet-stream',
      }),
      uploadName
    );
    form.append('model', config.cartesia.sttModel);
    form.append('language', language);
    form.append('timestamp_granularities[]', 'word');

    const response = await cartesiaMultipart('/stt', form, { apiKey });
    const data = await response.json();

    // Cartesia words are { word, start, end }; the cue builder reads { text, start, end, type }.
    const words = (Array.isArray(data.words) ? data.words : []).map((word) => ({
      text: word.word ?? word.text ?? '',
      start: word.start,
      end: word.end,
      type: 'word',
    }));

    if (words.length === 0 && !String(data.text || '').trim()) {
      throw new ApiError(
        'Cartesia returned an empty transcription. The file may contain no intelligible speech, ' +
          'or the selected spoken language may not match the audio.',
        { status: 422, code: 'empty_transcription', provider: 'cartesia' }
      );
    }
    if (words.length === 0) {
      throw new ApiError(
        'Cartesia returned text but no word timestamps, so accurate subtitle timing is not possible. ' +
          'Try ElevenLabs transcription for this file.',
        { status: 422, code: 'no_timestamps', provider: 'cartesia' }
      );
    }

    onStatus?.('Building subtitle cues from Cartesia timestamps...');

    const cues = buildCuesFromWords(words, cueOptions);
    const detected = data.language || language;
    const duration = (await probeDuration(uploadPath)) ?? data.duration ?? cues.at(-1)?.endTime ?? 0;

    logger.success(
      `Transcribed "${file.originalname}" with Cartesia — ${words.length} words, ${cues.length} cues, language ${detected}`
    );

    return {
      text: String(data.text || cues.map((cue) => cue.text).join(' ')).trim(),
      languageCode: detected,
      languageName: fromCartesiaLanguage(detected, sourceLanguage || 'Unknown'),
      languageProbability: null,
      words,
      cues,
      duration,
      audioExtracted: Boolean(extractedPath),
    };
  } finally {
    await cleanupFiles(extractedPath);
  }
};
