import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { config } from '../env.js';
import { ApiError } from '../errors.js';
import {
  getUser,
  getVoices,
  getModels,
  synthesizeSpeech,
  speechToSpeech,
  cloneVoice,
} from '../providers/elevenlabs/speech.js';

export const elevenLabsRouter = Router();

const apiKey = (req) => req.get('x-elevenlabs-key') || undefined;

/** Pipes a provider audio response through to the browser without buffering it. */
const streamAudio = async (providerResponse, res, fallbackType = 'audio/mpeg') => {
  res.setHeader('Content-Type', providerResponse.headers.get('content-type') || fallbackType);
  const length = providerResponse.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);

  const buffer = Buffer.from(await providerResponse.arrayBuffer());
  res.end(buffer);
};

/**
 * GET /api/elevenlabs/user
 *
 * Doubles as key validation for the settings screen. Reports whether the
 * backend holds a key without ever returning the key itself.
 */
elevenLabsRouter.get(
  '/elevenlabs/user',
  asyncHandler(async (req, res) => {
    try {
      const data = await getUser({ apiKey: apiKey(req) });
      res.json({
        isValid: true,
        serverManaged: Boolean(config.elevenlabs.apiKey),
        user: {
          subscription: data.subscription || {
            tier: 'standard',
            character_count: 0,
            character_limit: 10000,
            status: 'active',
          },
          is_new_user: data.is_new_user,
          first_name: data.first_name,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        res.status(200).json({
          isValid: false,
          serverManaged: Boolean(config.elevenlabs.apiKey),
          error: err.message,
        });
        return;
      }
      throw err;
    }
  })
);

elevenLabsRouter.get(
  '/elevenlabs/voices',
  asyncHandler(async (req, res) => {
    res.json({ voices: await getVoices({ apiKey: apiKey(req) }) });
  })
);

elevenLabsRouter.get(
  '/elevenlabs/models',
  asyncHandler(async (req, res) => {
    res.json({ models: await getModels({ apiKey: apiKey(req) }) });
  })
);

/** POST /api/elevenlabs/tts — text to speech. */
elevenLabsRouter.post(
  '/elevenlabs/tts',
  asyncHandler(async (req, res) => {
    const { voiceId, text, modelId, outputFormat, voiceSettings } = req.body || {};
    const providerResponse = await synthesizeSpeech(
      { voiceId, text, modelId, outputFormat, voiceSettings },
      { apiKey: apiKey(req) }
    );
    await streamAudio(providerResponse, res);
  })
);

/** POST /api/elevenlabs/speech-to-speech — voice conversion. */
elevenLabsRouter.post(
  '/elevenlabs/speech-to-speech',
  cleanupUploads,
  upload.single('audio'),
  asyncHandler(async (req, res) => {
    const { voiceId, modelId, voiceSettings, removeBackgroundNoise } = req.body || {};

    let parsedSettings;
    try {
      parsedSettings = voiceSettings ? JSON.parse(voiceSettings) : undefined;
    } catch {
      parsedSettings = undefined;
    }

    const providerResponse = await speechToSpeech(
      {
        voiceId,
        file: req.file,
        modelId: modelId || 'eleven_multilingual_sts_v2',
        voiceSettings: parsedSettings,
        removeBackgroundNoise: removeBackgroundNoise === undefined ? undefined : removeBackgroundNoise === 'true',
      },
      { apiKey: apiKey(req) }
    );

    await streamAudio(providerResponse, res);
  })
);

/** POST /api/elevenlabs/voices/add — instant voice clone from samples. */
elevenLabsRouter.post(
  '/elevenlabs/voices/add',
  cleanupUploads,
  upload.array('files', 25),
  asyncHandler(async (req, res) => {
    const { name, description, labels } = req.body || {};
    res.json(
      await cloneVoice(
        { name, files: req.files, description, labels },
        { apiKey: apiKey(req) }
      )
    );
  })
);
