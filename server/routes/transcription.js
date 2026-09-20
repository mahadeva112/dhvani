import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { assertSupportedMedia } from '../lib/media.js';
import { getProvider, activeProviders } from '../providers/index.js';
import { serializeSrt, serializeVtt } from '../lib/srt.js';

export const transcriptionRouter = Router();

/**
 * POST /api/transcription
 *
 * Transcription on its own: audio/video in, word timestamps and an
 * original-language SRT out. No language model is involved.
 */
transcriptionRouter.post(
  '/transcription',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    assertSupportedMedia(req.file);

    const { sourceLanguage = '', modelId, diarize = 'false', tagAudioEvents = 'false' } = req.body || {};

    const provider = getProvider('transcription', req.body?.provider || activeProviders.transcription);
    const result = await provider.transcribe(req.file, {
      sourceLanguage,
      modelId,
      diarize: diarize === 'true',
      tagAudioEvents: tagAudioEvents === 'true',
      apiKey: req.get('x-elevenlabs-key') || undefined,
    });

    res.json({
      detectedLanguage: result.languageName,
      detectedLanguageCode: result.languageCode,
      languageProbability: result.languageProbability,
      duration: result.duration,
      audioExtracted: result.audioExtracted,
      transcript: result.text,
      words: result.words,
      cues: result.cues,
      srt: serializeSrt(result.cues, { field: 'text' }),
      vtt: serializeVtt(result.cues, { field: 'text' }),
      timingSource: 'elevenlabs_word_timestamps',
    });
  })
);
