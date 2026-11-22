import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { ApiError } from '../errors.js';
import { matchSourceDelivery, tagClip } from '../lib/sourceCues.js';
import { cutAudioClip } from '../lib/media.js';
import { cancelledError } from '../lib/http.js';

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

/** Longest clip one section request takes: a section is 90 s, with room for its padding. */
const SECTION_CLIP_SECONDS = 120;

/**
 * POST /api/delivery/source-cues/section — tags one section of a dub script
 * to match its stretch of the source, for Natural heard ahead of Dub.
 *
 * Multipart: `file` is that stretch of the source audio alone (the app cuts
 * it, see groupSections in sourceSections.js), `lines` a JSON list of the
 * section's dub lines in spoken order, `language` their language and
 * `speakers` (optional) a JSON list of who says each line, sent when more
 * than one person speaks. Responds `{ lines, tagged }`, each line with tags or as written.
 */
deliveryRouter.post(
  '/delivery/source-cues/section',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError('No source audio was uploaded.', { status: 400, code: 'no_file' });
    let lines;
    try {
      lines = JSON.parse(req.body?.lines || '[]');
    } catch {
      lines = null;
    }
    if (!Array.isArray(lines) || !lines.length || lines.some((line) => typeof line !== 'string')) {
      throw new ApiError('No script lines were sent.', { status: 400, code: 'no_lines' });
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    // Who says each line, when more than one person speaks (see buildSourceCuePrompt).
    let speakers;
    try {
      speakers = JSON.parse(req.body?.speakers || 'null');
    } catch {
      speakers = null;
    }
    if (!Array.isArray(speakers) || speakers.length !== lines.length || speakers.some((name) => typeof name !== 'string' || name.length > 128)) {
      speakers = undefined;
    }

    const clip = await cutAudioClip(req.file.path, 0, SECTION_CLIP_SECONDS, { signal: controller.signal });
    if (controller.signal.aborted) throw cancelledError('Source cues');
    res.json(
      await tagClip(clip, lines.map((line) => line.trim()), {
        language: req.body?.language || undefined,
        apiKey: req.get('x-gemini-key') || undefined,
        speakers,
      })
    );
  })
);
