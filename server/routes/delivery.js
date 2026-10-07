import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { ApiError } from '../errors.js';
import { matchSourceDelivery } from '../lib/sourceCues.js';

export const deliveryRouter = Router();

/**
 * POST /api/delivery/source-cues — tags a dub script to match the source audio.
 *
 * Multipart: `file` is the source audio, `cues` a JSON list of
 * `{ start, end, text }` (seconds, spoken order) and `language` the script's
 * language. Responds `{ texts, sections, taggedSections }`, `texts[i]` being
 * cue i's text with performance tags (or as written where none could be added).
 * Closing the request cancels the work still to do.
 */
deliveryRouter.post(
  '/delivery/source-cues',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError('No source audio was uploaded.', { status: 400, code: 'no_file' });
    let cues;
    try {
      cues = JSON.parse(req.body?.cues || '[]');
    } catch {
      cues = null;
    }
    if (!Array.isArray(cues) || !cues.length) {
      throw new ApiError('No script cues were sent.', { status: 400, code: 'no_cues' });
    }
    const clean = cues.map((cue) => ({
      start: Number(cue?.start) || 0,
      end: Number(cue?.end) || 0,
      text: String(cue?.text || ''),
    }));

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    res.json(
      await matchSourceDelivery(req.file.path, clean, {
        language: req.body?.language || undefined,
        apiKey: req.get('x-gemini-key') || undefined,
        signal: controller.signal,
      })
    );
  })
);
