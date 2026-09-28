import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const transliterateRouter = Router();

// Google Input Tools codes look like `hi-t-i0-und`.
const ITC_PATTERN = /^[a-z]{2,3}-t-i0-und$/;
const WORD_PATTERN = /^[A-Za-z]{1,40}$/;

/**
 * Phonetic spelling candidates for one Roman word.
 *
 * The page's CSP only allows `connect-src 'self'`, so the browser cannot call
 * Google Input Tools itself; without this relay every suggestion silently
 * fell back to the offline rule parser. Only the single typed word is sent.
 */
transliterateRouter.get(
  '/transliterate',
  asyncHandler(async (req, res) => {
    const word = String(req.query.text || '');
    const itc = String(req.query.itc || '');
    const num = Math.min(Math.max(Number(req.query.num) || 5, 1), 8);

    if (!WORD_PATTERN.test(word) || !ITC_PATTERN.test(itc)) {
      res.status(400).json({ candidates: [] });
      return;
    }

    const url =
      `https://inputtools.google.com/request?text=${encodeURIComponent(word)}` +
      `&itc=${itc}&num=${num}&cp=0&cs=1&ie=utf-8&oe=utf-8`;

    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const data = upstream.ok ? await upstream.json() : null;
      const candidates = data?.[0] === 'SUCCESS' && Array.isArray(data[1]?.[0]?.[1]) ? data[1][0][1] : [];
      res.json({ candidates: candidates.filter((c) => typeof c === 'string') });
    } catch {
      // Offline or slow: the client falls back to its own rule parser.
      res.json({ candidates: [] });
    }
  })
);
