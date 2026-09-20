import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config, ROOT_DIR, CONFIG_FILE, keySource, translationSetup } from './env.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { pipelineRouter } from './routes/pipeline.js';
import { transcriptionRouter } from './routes/transcription.js';
import { translationRouter } from './routes/translation.js';
import { elevenLabsRouter } from './routes/elevenlabs.js';
import { geminiRouter } from './routes/gemini.js';
import { ffmpegAvailable } from './lib/media.js';

const app = express();

app.disable('x-powered-by');

// Trust only a loopback proxy, so `req.ip` cannot be spoofed by a client
// sending its own X-Forwarded-For header.
app.set('trust proxy', 'loopback');

/*
 * Security headers.
 *
 * The CSP is deliberately strict: the app has no third-party scripts and no
 * remote analytics. `connect-src 'self'` means that even if a dependency were
 * compromised, it could not exfiltrate a transcript to another host.
 * `mediaSrc` allows blob: for locally generated audio, and the ElevenLabs
 * preview CDN for voice auditions.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // Vite injects inline styles; Tailwind's runtime does too.
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:', 'data:', 'https://storage.googleapis.com'],
        /*
         * `blob:` is required, not a loosening: the app reads its own
         * generated audio back with fetch() before decoding it into an
         * AudioBuffer (see decodeAudioBlobUrl). Without it every voice
         * conversion ends in "Failed to fetch" after the audio has already
         * been produced. A blob: URL can only be minted by this page, so it
         * adds no exfiltration route.
         */
        'connect-src': ["'self'", 'blob:'],
        'worker-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        // Only meaningful over HTTPS; harmless on localhost.
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    // Blob URLs for generated audio must stay readable by the page.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // HSTS would be wrong for a localhost app and can brick plain-HTTP access.
    hsts: false,
  })
);

app.use(
  compression({
    // Audio and video responses are already compressed; re-compressing wastes
    // CPU and breaks streaming responsiveness.
    filter: (req, res) => {
      const type = res.getHeader('Content-Type');
      if (typeof type === 'string' && /^(audio|video)\//.test(type)) return false;
      if (typeof type === 'string' && type.includes('x-ndjson')) return false;
      return compression.filter(req, res);
    },
  })
);

/*
 * CORS applies to the API only.
 *
 * Static assets are same-origin by definition, and running them through the
 * CORS check rejected the app's own stylesheet and module scripts — browsers
 * do send an Origin header for those.
 *
 * The server's own origins are always allowed, so a production build served by
 * this process works without anyone having to configure CORS_ORIGIN.
 */
const selfOrigins = new Set(
  ['localhost', '127.0.0.1', config.host].flatMap((host) =>
    host && host !== '0.0.0.0' ? [`http://${host}:${config.port}`] : []
  )
);

app.use(
  '/api',
  cors({
    origin: (origin, callback) => {
      // A same-origin fetch or a non-browser client sends no Origin header.
      if (!origin || selfOrigins.has(origin) || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Deny by answering without CORS headers rather than throwing, so the
      // browser reports a clean CORS failure instead of a 500.
      return callback(null, false);
    },
    allowedHeaders: ['Content-Type', 'x-elevenlabs-key', 'x-gemini-key'],
  })
);

// Cue lists for a long recording can be sizeable, hence the generous JSON limit.
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

/*
 * Rate limiting.
 *
 * This is a single-user local app, so the point is not to stop an attacker —
 * it is to stop a stuck retry loop in the UI from spending real money at the
 * provider. Health and settings are exempt so the setup screen stays usable.
 */
if (config.rateLimitPerMinute > 0) {
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health' || req.path.startsWith('/settings'),
      message: {
        error: {
          message:
            'Too many requests to the local DHVANI backend in one minute. This usually means a ' +
            'retry loop. Wait a moment, or raise RATE_LIMIT_PER_MINUTE.',
          code: 'local_rate_limited',
          retryable: true,
        },
      },
    })
  );
}

app.use((req, _res, next) => {
  if (req.path !== '/api/health') logger.info(`${req.method} ${req.path}`);
  next();
});

app.use('/api', healthRouter);
app.use('/api', settingsRouter);
app.use('/api', pipelineRouter);
app.use('/api', transcriptionRouter);
app.use('/api', translationRouter);
app.use('/api', elevenLabsRouter);
app.use('/api', geminiRouter);

/*
 * In production the same process serves the built frontend, so the whole app is
 * one local origin with no separate dev server and no CORS surface.
 */
const distDir = path.join(ROOT_DIR, 'dist');
const hasBuild = fs.existsSync(path.join(distDir, 'index.html'));

if (hasBuild) {
  app.use(
    express.static(distDir, {
      // Hashed asset filenames are safe to cache forever; index.html is not.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.[0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpg|svg)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  logger.success(`DHVANI ${config.version} listening on ${url}`);

  const keys = keySource();
  if (keys.elevenLabs === 'none') {
    logger.warn('No ElevenLabs API key — transcription and voice synthesis will fail.');
  }
  if (keys.gemini === 'none' && keys.gateway === 'none') {
    logger.warn('No Gemini API key and no LLM gateway — translation will fail.');
  }
  if (keys.elevenLabs === 'saved' || keys.gemini === 'saved' || keys.gateway === 'saved') {
    logger.info(`Using API keys saved at ${CONFIG_FILE}`);
  }

  const translation = translationSetup();
  if (translation.mode === 'gateway') {
    logger.info(`Translation runs through the LLM gateway at ${translation.gatewayUrl}.`);
  }

  ffmpegAvailable().then((available) => {
    if (available) logger.info('ffmpeg detected — audio will be extracted from uploaded video.');
    else logger.warn('ffmpeg not found — video files will be uploaded to ElevenLabs as-is.');
  });

  if (hasBuild) logger.info(`Serving the production build from ${distDir}`);
  else logger.info(`No build found. Run the Vite dev server on port ${config.clientPort} for the UI.`);

  if (config.host === '0.0.0.0') {
    logger.warn(
      'HOST is 0.0.0.0, so this server is reachable from your network. Anyone who can reach it ' +
        'can spend your API credits. Keep it on 127.0.0.1 unless you have put auth in front of it.'
    );
  }
});

// Long uploads and long transcriptions must not be cut off by the default timeouts.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.setTimeout(0);

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err?.stack || err);
  shutdown('uncaughtException');
});

export { app, server };
