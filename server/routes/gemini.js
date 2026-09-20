import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import {
  detectExpression,
  splitSegment,
  generateSsml,
  validateSsml,
  synthesizeSpeechGemini,
} from '../providers/gemini/studio.js';

export const geminiRouter = Router();

const apiKey = (req) => req.get('x-gemini-key') || undefined;

const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

/** POST /api/gemini/expression — detects the speaker's tone from a clip. */
geminiRouter.post(
  '/gemini/expression',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    try {
      res.json({ expression: await detectExpression(req.file, { apiKey: apiKey(req) }) });
    } catch (err) {
      // Expression detection is a nicety; a failure should not block the dub.
      res.json({ expression: 'Natural', warning: err?.message });
    }
  })
);

/** POST /api/gemini/split — re-cuts one cue, snapped to its word timestamps. */
geminiRouter.post(
  '/gemini/split',
  asyncHandler(async (req, res) => {
    const { segment } = req.body || {};
    res.json({ segments: await splitSegment(segment, { apiKey: apiKey(req) }) });
  })
);

/** POST /api/gemini/ssml — builds ElevenLabs SSML from the reviewed script. */
geminiRouter.post(
  '/gemini/ssml',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const ssml = await generateSsml(
      {
        script: body.script || '',
        segments: parseJsonField(body.segments, []),
        manualDuration: body.manualDuration ? Number(body.manualDuration) : undefined,
        pronunciations: parseJsonField(body.pronunciations, []),
        language: body.language || 'Bengali',
        file: req.file,
      },
      { apiKey: apiKey(req) }
    );

    res.json({ ssml });
  })
);

/** POST /api/gemini/validate-ssml — QA pass over generated SSML. */
geminiRouter.post(
  '/gemini/validate-ssml',
  asyncHandler(async (req, res) => {
    const { ssml, durationLimit, segments = [] } = req.body || {};
    res.json(await validateSsml({ ssml, durationLimit, segments }, { apiKey: apiKey(req) }));
  })
);

/** POST /api/gemini/tts — Gemini voice synthesis, returned as WAV. */
geminiRouter.post(
  '/gemini/tts',
  asyncHandler(async (req, res) => {
    const { text, voiceName, expression } = req.body || {};
    const wav = await synthesizeSpeechGemini({ text, voiceName, expression }, { apiKey: apiKey(req) });

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.length));
    res.end(wav);
  })
);
