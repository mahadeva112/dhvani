import fs from 'node:fs';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { ApiError } from '../errors.js';
import { forceAlign } from '../providers/elevenlabs/alignment.js';
import { alignmentText } from '../lib/dubTakes.js';
import { wordTimesForCues } from '../lib/dubSubtitles.js';
import { loudnessEnvelope } from '../lib/media.js';
import { ENVELOPE_HOP, snapWordOnsets } from '../lib/onsetSnap.js';
import { logger } from '../logger.js';

export const subtitlesRouter = Router();

/** `[{ id, text }]` from the form's JSON field, in spoken order. */
const parseCues = (raw) => {
  let cues;
  try {
    cues = JSON.parse(String(raw || '[]'));
  } catch {
    cues = null;
  }
  if (!Array.isArray(cues)) return [];
  return cues
    .filter((cue) => cue && (typeof cue.id === 'string' || typeof cue.id === 'number') && typeof cue.text === 'string')
    .slice(0, 20000)
    .map((cue) => ({ id: String(cue.id), text: cue.text }));
};

/**
 * POST /api/subtitles/dub-timing
 *
 * The dub (or synced dub) in, plus the lines it says in order; every word's
 * time in that audio out. ElevenLabs forced alignment places the script's own
 * words, the waveform moves each word that starts out of silence onto its real
 * onset, and the app then cuts subtitles on those words exactly as it does for
 * the original speech.
 */
subtitlesRouter.post(
  '/subtitles/dub-timing',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError('No dub audio was sent.', { status: 400, code: 'missing_file' });
    const cues = parseCues(req.body?.cues).filter((cue) => cue.text.trim());
    const text = alignmentText(cues);
    if (!text) throw new ApiError('No dub lines were sent.', { status: 400, code: 'missing_cues' });

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    const { signal } = controller;

    const buffer = await fs.promises.readFile(req.file.path);
    const { words } = await forceAlign(
      { buffer, contentType: req.file.mimetype || 'audio/wav', fileName: req.file.originalname || 'dub.wav', text },
      { apiKey: req.get('x-elevenlabs-key') || undefined, signal }
    );
    const envelope = await loudnessEnvelope(req.file.path, { hopSeconds: ENVELOPE_HOP, signal });
    const timed = wordTimesForCues(snapWordOnsets(words, envelope), cues);
    if (!timed) {
      throw new ApiError('The dub could not be lined up with its script, so its subtitles keep their estimated timing.', {
        status: 422,
        code: 'dub_alignment_failed',
      });
    }

    logger.success(`Timed ${cues.length} dub lines to the dub's own words for subtitles.`);
    res.json({ cues: timed, onsetSync: Boolean(envelope) });
  })
);
