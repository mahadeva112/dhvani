import { Router } from 'express';
import { config } from '../env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ffmpegAvailable } from '../lib/media.js';
import { listProviders, activeProviders } from '../providers/index.js';
import { LANGUAGES } from '../lib/languages.js';
import { keySource, translationSetup, gatewayEnabled } from '../env.js';

export const healthRouter = Router();

/**
 * Tells the frontend what the backend can actually do, so the UI can explain a
 * missing key instead of failing on the first request.
 *
 * Only booleans are reported — never a key or a fragment of one.
 */
healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const describe = (capability) =>
      listProviders(capability).map((provider) => ({
        name: provider.name,
        label: provider.label,
        configured: provider.isConfigured(),
        active: activeProviders[capability] === provider.name,
      }));

    res.json({
      ok: true,
      service: 'dhvani-backend',
      version: config.version,
      elevenLabsConfigured: Boolean(config.elevenlabs.apiKey),
      // True when translation can run at all, whether via Google or a gateway.
      geminiConfigured: Boolean(config.gemini.apiKey) || gatewayEnabled(),
      keySource: keySource(),
      translation: translationSetup(),
      ffmpegAvailable: await ffmpegAvailable(),
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
      sttModel: config.elevenlabs.sttModel,
      ttsModel: config.elevenlabs.ttsModel,
      // The models translation will actually use — gateway models when the
      // gateway is active, Google's list otherwise.
      translationModels: translationSetup().models,
      providers: {
        transcription: describe('transcription'),
        translation: describe('translation'),
      },
      languages: LANGUAGES.map(({ name, iso }) => ({ name, iso })),
    });
  })
);
