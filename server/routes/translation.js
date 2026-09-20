import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { translateCueTexts, alignScriptToCues, polishIndicText } from '../providers/gemini/translation.js';
import { parseSrt, serializeSrt, retextCues, assertTimingsPreserved } from '../lib/srt.js';

export const translationRouter = Router();

const geminiKey = (req) => req.get('x-gemini-key') || undefined;

/**
 * POST /api/translation/segments
 *
 * Translates cue text for an existing cue list. The request carries timings so
 * the response can be merged back by id, but timings are never sent to the
 * model and never modified here.
 */
translationRouter.post(
  '/translation/segments',
  asyncHandler(async (req, res) => {
    const { segments, sourceLanguage = '', targetLanguage, customPrompt = '' } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      throw new ApiError('No segments were supplied to translate.', { status: 400, code: 'no_segments' });
    }

    const cues = segments.map((segment, index) => ({
      id: String(segment.id ?? `cue-${index + 1}`),
      text: String(segment.sourceText ?? segment.text ?? segment.textSource ?? '').trim(),
    }));

    const outcome = await translateCueTexts(cues, {
      sourceLanguage,
      targetLanguage,
      customPrompt,
      apiKey: geminiKey(req),
    });

    res.json({
      translations: cues.map((cue) => ({
        id: cue.id,
        translatedText: outcome.translations.get(cue.id) || '',
      })),
      translationModel: outcome.modelUsed,
      untranslatedCueIds: outcome.missingIds,
    });
  })
);

/**
 * POST /api/translation/srt
 *
 * Translates a complete `.srt` document. The incoming timestamps are parsed and
 * written straight back out; only the text between them changes.
 */
translationRouter.post(
  '/translation/srt',
  asyncHandler(async (req, res) => {
    const { srt, sourceLanguage = '', targetLanguage, customPrompt = '' } = req.body || {};

    if (!srt?.trim()) {
      throw new ApiError('No SRT content was supplied.', { status: 400, code: 'no_srt' });
    }

    const sourceCues = parseSrt(srt);
    if (sourceCues.length === 0) {
      throw new ApiError('That SRT file could not be parsed — no cues were found.', {
        status: 400,
        code: 'bad_srt',
      });
    }

    const outcome = await translateCueTexts(sourceCues, {
      sourceLanguage,
      targetLanguage,
      customPrompt,
      apiKey: geminiKey(req),
    });

    const translatedCues = retextCues(sourceCues, outcome.translations, 'translatedText').map((cue) => ({
      ...cue,
      translatedText: cue.translatedText || cue.text,
    }));

    assertTimingsPreserved(sourceCues, translatedCues);

    res.json({
      srt: serializeSrt(translatedCues, { field: 'translatedText' }),
      cueCount: translatedCues.length,
      translationModel: outcome.modelUsed,
      untranslatedCueIds: outcome.missingIds,
    });
  })
);

/** POST /api/translation/align — spreads a pasted target script across cues. */
translationRouter.post(
  '/translation/align',
  asyncHandler(async (req, res) => {
    const { segments, pastedScript, targetLanguage } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      throw new ApiError('No segments were supplied to align against.', {
        status: 400,
        code: 'no_segments',
      });
    }
    if (!pastedScript?.trim()) {
      throw new ApiError('No script text was pasted.', { status: 400, code: 'no_script' });
    }

    const cues = segments.map((segment, index) => ({
      id: String(segment.id ?? `cue-${index + 1}`),
      text: String(segment.sourceText ?? segment.textSource ?? segment.text ?? '').trim(),
    }));

    const aligned = await alignScriptToCues(cues, {
      pastedScript,
      targetLanguage,
      apiKey: geminiKey(req),
    });

    res.json({
      alignedCues: cues.map((cue) => ({ id: cue.id, targetText: aligned.get(cue.id) || '' })),
    });
  })
);

/** POST /api/translation/polish — Indic spelling/matra/conjunct repair. */
translationRouter.post(
  '/translation/polish',
  asyncHandler(async (req, res) => {
    const { text, targetLanguage, context } = req.body || {};
    res.json(await polishIndicText({ text, targetLanguage, context, apiKey: geminiKey(req) }));
  })
);
