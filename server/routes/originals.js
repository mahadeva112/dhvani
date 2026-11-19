import { Router } from 'express';
import fs from 'node:fs';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { dropOriginal, originalPath, storeOriginal } from '../lib/originals.js';

export const originalsRouter = Router();

/**
 * PUT /api/media/originals — the original media of a project being opened,
 * as the request body (streamed to disk, never held whole). Replies
 * `{ id, bytes }`: a WAV the app reads a stretch at a time from
 * GET /api/media/originals/:id (with a Range), and deletes when it closes.
 */
originalsRouter.put(
  '/media/originals',
  asyncHandler(async (req, res) => {
    const controller = new AbortController();
    // Only an upload cut short stops the work: 'close' also fires once a body is read in full.
    req.on('aborted', () => controller.abort());
    res.json(await storeOriginal(req, { signal: controller.signal }));
  })
);

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
    await dropOriginal(req.params.id);
    res.json({ ok: true });
  })
);
