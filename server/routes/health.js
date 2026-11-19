import { Router } from 'express';
import { config } from '../env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ffmpegAvailable } from '../lib/media.js';
import { listProviders, activeProviders } from '../providers/index.js';
import { LANGUAGES } from '../lib/languages.js';
import { keySource, translationSetup, gatewayEnabled } from '../env.js';
import { logger } from '../logger.js';
import { CONFIG_DIR } from '../env.js';
import { diskSpace } from '../lib/diskSpace.js';

export const healthRouter = Router();

/** When this backend started, so the app can tell a restart from a backend that was up all along. */
const startedAt = Date.now();

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
      startedAt,
      elevenLabsConfigured: Boolean(config.elevenlabs.apiKey),
      cartesiaConfigured: Boolean(config.cartesia.apiKey),
      transcriptionProvider: activeProviders.transcription,
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
      // Room left on the drive the app keeps its data on: a full drive makes big audio fail to save.
      disk: await diskSpace(CONFIG_DIR),
    });
  })
);

/** One line the app's page asks to have in backend.log: plain text, made safe, kept short. */
export const clientLogLine = (body) => {
  const text = typeof body?.message === 'string' ? body.message : '';
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  return clean ? `App: ${clean}` : null;
};

/**
 * POST /api/client-log — a request from the page that failed (a dropped
 * connection, say) leaves no trace in backend.log otherwise, so the problem
 * report could never show why a sync or dub stopped.
 */
healthRouter.post('/client-log', (req, res) => {
  const line = clientLogLine(req.body);
  if (line) logger.warn(line);
  res.status(204).end();
});
