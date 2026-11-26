import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import { PAUSE_SPLIT, cuePauses, readPausedLine } from '../../lib/translationPauses.js';
import { stripPauses } from '../../lib/linePauses.js';

/**
 * Mark pauses: the original's pauses put into a dub line that has none (it
 * was edited by hand, or translated before short pauses were marked), so Sync
 * can cut the dub there and each piece sits under its piece of the original.
 *
 * The model only says where each "‖" goes in the line as it is. Code keeps
 * its answer only when the line without the marks is the line it sent, letter
 * for letter, with one mark for each pause: no word of the script ever
 * changes here. A cue whose language order can't keep a pause gets no marks.
 */

/** Cues sent in one call. */
const MARK_BATCH = 20;
/** Calls at once. */
const MARK_PARALLEL = 4;

const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The cues that can take marks: a timed original with a pause inside it
 * (cuePauses) and a dub line. Each `{ id, english, line, pauses }`, `english`
 * with a "‖" at each pause.
 */
export const markableCues = (cues) =>
  cues.flatMap((cue) => {
    const line = squash(cue.line);
    const split = cuePauses({ ...cue, text: String(cue.text ?? '').trim() });
    if (!line || !split) return [];
    return [{ id: String(cue.id), english: split.parts.map((part) => part.text).join(` ${PAUSE_SPLIT} `), line, pauses: split.pauses }];
  });

export const buildMarkPrompt = (batch, targetLanguage) => `Each item is an English subtitle cue and its ${targetLanguage || 'dub'} line, which a voice will say over the video. A "${PAUSE_SPLIT}" in the English is where the speaker stops for a moment.

Put a "${PAUSE_SPLIT}" into each ${targetLanguage || 'dub'} line at the matching place: as many as the English has, in the same order, each where what comes before it says what came before it in the English, at a natural phrase break, never inside a word, a name or a fixed phrase, and never between a word and its postposition, case ending or helping verb.

Copy every other character of the line exactly as it is: the same words, spelling, punctuation and order. Never add, drop, move or change a word, and never fix anything. If the line's word order puts an idea on the other side of a stop, so no place matches, give "split": null for that item.

INPUT (JSON):
${JSON.stringify(batch.map(({ id, english, line }) => ({ id, english, line })), null, 2)}

Respond with ONLY this JSON:
{"lines":[{"id":"<the same id>","split":"<the line with the marks, or null>"}]}`;

/**
 * The model's line read back: the cue's line with a pause mark at each "‖"
 * (`[pause 0.5s]`, as long as the original's), or null when it isn't the
 * same line with exactly one mark per pause.
 */
export const readMarkedLine = (cue, split) => {
  if (typeof split !== 'string' || !split.includes(PAUSE_SPLIT)) return null;
  if (squash(split.split(PAUSE_SPLIT).join(' ')) !== cue.line) return null;
  const { paused } = readPausedLine(split, cue.pauses);
  if (!paused || squash(stripPauses(paused)) !== cue.line) return null;
  return paused;
};

/**
 * Pause marks for `cues` (`{ id, text, words, line }`: the original with its
 * word timings, and the dub line as the script has it now). Returns `marked`
 * (cue id → the line with pause marks), `missed` (ids of cues with pauses
 * that got none) and `modelUsed`.
 */
export const markPauses = async (cues, { targetLanguage = '', apiKey, models, generate = generateText, onProgress } = {}) => {
  const todo = markableCues(cues);
  const marked = new Map();
  let modelUsed = null;
  let firstError = null;
  const batches = [];
  for (let i = 0; i < todo.length; i += MARK_BATCH) batches.push(todo.slice(i, i + MARK_BATCH));
  let done = 0;
  const queue = [...batches];
  const worker = async () => {
    while (queue.length) {
      const batch = queue.shift();
      try {
        const { response, modelUsed: used } = await generate({
          contents: { role: 'user', parts: [{ text: buildMarkPrompt(batch, targetLanguage) }] },
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          effort: 'low',
          models,
          apiKey,
        });
        modelUsed = used ?? modelUsed;
        const parsed = parseJsonResponse(response.text, 'Mark pauses');
        const byId = new Map(batch.map((cue) => [cue.id, cue]));
        for (const item of Array.isArray(parsed?.lines) ? parsed.lines : []) {
          const cue = byId.get(String(item?.id ?? ''));
          const paused = cue ? readMarkedLine(cue, item.split) : null;
          if (paused) marked.set(cue.id, paused);
        }
      } catch (err) {
        firstError ??= err;
        logger.error(`Mark pauses: a batch of ${batch.length} cue(s) failed: ${err?.message || err}`);
      }
      done += 1;
      onProgress?.({ done, total: batches.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(MARK_PARALLEL, batches.length) }, worker));
  if (!marked.size && firstError) throw firstError;
  const missed = todo.filter((cue) => !marked.has(cue.id)).map((cue) => cue.id);
  logger.info(`Mark pauses: ${marked.size} of ${todo.length} cue(s) marked${missed.length ? `, ${missed.length} left as they were` : ''}.`);
  return { marked, missed, modelUsed, asked: todo.length };
};
