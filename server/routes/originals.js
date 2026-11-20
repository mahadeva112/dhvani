import { Router } from 'express';
import fs from 'node:fs';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { holds, originalPath, storeOriginal } from '../lib/originals.js';

export const originalsRouter = Router();

/**
 * PUT /api/media/originals — the original media of a project being opened,
 * as the request body (streamed to disk, never held whole). Replies
 * `{ id, bytes }`: a WAV the app reads a stretch at a time from
 * GET /api/media/originals/:id (with a Range), holds open with
 * GET /api/media/originals/:id/hold, and deletes when it closes. Not held
 * within a minute, it is deleted.
 */
originalsRouter.put(
  '/media/originals',
  asyncHandler(async (req, res) => {
    const controller = new AbortController();
    // Only an upload cut short stops the work: 'close' also fires once a body is read in full.
    req.on('aborted', () => controller.abort());
    const stored = await storeOriginal(req, { signal: controller.signal });
    holds.dropLater(stored.id);
    res.json(stored);
  })
);

/**
 * GET /api/media/originals/:id/hold — kept open by the page while its project
 * is open, and opened again if the server restarts (services/originalAudio.ts
 * holdOpen). When it closes, however the page went, the original is deleted
 * a minute later unless it is held again.
 */
originalsRouter.get('/media/originals/:id/hold', (req, res) => {
  const file = originalPath(req.params.id);
  if (!file || !fs.existsSync(file)) throw new ApiError('That original is not open here any more.', { status: 404, code: 'original_missing' });
  // no-transform: compression would hold the beats back.
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  const release = holds.hold(req.params.id);
  // A beat every 10 s: nothing between closes the request as idle, and the page takes 25 s of silence for a server gone.
  const beat = setInterval(() => res.write(': held\n\n'), 10_000);
  req.on('close', () => {
    clearInterval(beat);
    release();
  });
});

originalsRouter.get('/media/originals/:id', (req, res, next) => {
  const file = originalPath(req.params.id);
  if (!file || !fs.existsSync(file)) throw new ApiError('That original is not open here any more.', { status: 404, code: 'original_missing' });
  res.sendFile(file, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }, acceptRanges: true }, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

originalsRouter.delete(
  '/media/originals/:id',
  asyncHandler(async (req, res) => {
    if (originalPath(req.params.id)) await holds.dropNow(req.params.id);
    res.json({ ok: true });
  })
);
