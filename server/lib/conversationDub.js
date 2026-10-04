/**
 * A dub of a conversation: each speaker voiced by their own voice.
 *
 * The script arrives as turns, one per run of cues by the same speaker, in
 * the order they are spoken. Each turn is split into passages as a one-voice
 * script is (see ttsText.js), and every speaker's passages are voiced as one
 * read by that speaker's voice: told only the text either side by the same
 * speaker, so one voice never picks up another's delivery. The passages are
 * then joined in script order exactly as a one-voice dub is (see audioJoin.js),
 * with the pause between two turns sized to the pause in the original, and
 * rendered into a mix plus one stem per speaker (see speakerMix.js).
 *
 * Nothing about the voice is changed: no speed change, no fades over speech,
 * and gain only when the user asks to even out the speakers.
 *
 * The voices and the codec are passed in, so the whole run can be tested with
 * fakes.
 */
import { ApiError } from '../errors.js';
import { cancelledError } from './http.js';
import { splitPassages, PASSAGE_PAUSE_SECONDS, TTS_CONTEXT_CHARS, MAX_TTS_CHUNK_CHARS } from './ttsText.js';
import { layoutPassages } from './audioJoin.js';
import { mixSpeakers } from './speakerMix.js';

/** The pause between two speakers' turns follows the original, within these bounds. */
export const MIN_TURN_PAUSE_SECONDS = 0.25;
export const MAX_TURN_PAUSE_SECONDS = 1.2;
/** Used when the original's pause is unknown. */
const DEFAULT_TURN_PAUSE_SECONDS = 0.4;

export const turnPause = (gap) => {
  const seconds = gap === null || gap === undefined || gap === '' ? NaN : Number(gap);
  if (!Number.isFinite(seconds)) return DEFAULT_TURN_PAUSE_SECONDS;
  return Math.min(MAX_TURN_PAUSE_SECONDS, Math.max(MIN_TURN_PAUSE_SECONDS, seconds));
};

/**
 * Turns into passages in script order, each `{ speaker, text, pauseAfter }`.
 * `turns[i]` is `{ speaker, text, gapAfter }`; a turn with no text is skipped
 * and its pause is kept by the turn before it.
 */
export const planConversation = (turns = [], { maxChars = MAX_TTS_CHUNK_CHARS } = {}) => {
  const passages = [];
  for (const turn of turns) {
    const text = String(turn?.text || '').trim();
    if (!text) {
      if (passages.length > 0 && Number.isFinite(Number(turn?.gapAfter))) {
        passages[passages.length - 1].pauseAfter = turnPause(turn.gapAfter);
      }
      continue;
    }
    const speaker = String(turn.speaker || 'Speaker');
    const parts = splitPassages(text, maxChars);
    parts.forEach((part, n) => {
      passages.push({
        speaker,
        text: part.text,
        pauseAfter: n < parts.length - 1 ? PASSAGE_PAUSE_SECONDS[part.breakAfter] ?? 0 : turnPause(turn.gapAfter),
      });
    });
  }
  return passages;
};

/**
 * Runs a conversation dub.
 *
 * `params`: `{ turns, sampleRate, maxChars, voiceFor, matchSpeakers, peak }`,
 * where `voiceFor(speaker)` is the voice that speaker is voiced with and
 * `peak` is how a mix above full scale is handled (see speakerMix.js).
 *
 * `deps`:
 * - `voiceLines(voice, lines, { onLine })` → `[Buffer]`, voicing
 *   `[{ text, previousText, nextText }]` in order with one voice;
 * - `decode(buffer, voice)` → mono Float32Array at `sampleRate`.
 *
 * Returns `{ mix, stems, report }` as mixSpeakers does, with `report.passages`
 * and `report.turns` added.
 */
export const runConversation = async (params, deps, { signal, onProgress = () => {} } = {}) => {
  const { turns, sampleRate, maxChars, voiceFor, matchSpeakers = false, peak = 'float' } = params;
  const checkCancelled = () => {
    if (signal?.aborted) throw cancelledError('Dub');
  };

  const passages = planConversation(turns, { maxChars });
  if (passages.length === 0) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const totalChars = passages.reduce((sum, p) => sum + p.text.length, 0);
  const done = new Array(passages.length).fill(false);
  const progress = (phase) =>
    onProgress({
      phase,
      passageCount: passages.length,
      passagesDone: done.filter(Boolean).length,
      totalChars,
      charsDone: passages.reduce((sum, p, i) => sum + (done[i] ? p.text.length : 0), 0),
      secondsGenerated: 0,
      streaming: false,
    });
  progress('preparing');

  // Each speaker's passages, voiced as one read in that speaker's voice.
  const speakers = [...new Set(passages.map((p) => p.speaker))];
  const buffers = new Array(passages.length);
  for (const speaker of speakers) {
    checkCancelled();
    const indexes = passages.map((p, i) => (p.speaker === speaker ? i : -1)).filter((i) => i >= 0);
    const lines = indexes.map((i, n) => ({
      text: passages[i].text,
      previousText: n > 0 ? passages[indexes[n - 1]].text.slice(-TTS_CONTEXT_CHARS) : undefined,
      nextText: n < indexes.length - 1 ? passages[indexes[n + 1]].text.slice(0, TTS_CONTEXT_CHARS) : undefined,
    }));
    progress('voicing');
    const voiced = await deps.voiceLines(voiceFor(speaker), lines, {
      onLine: (count) => {
        for (let n = 0; n < count; n++) done[indexes[n]] = true;
        progress('voicing');
      },
    });
    indexes.forEach((i, n) => {
      buffers[i] = voiced[n];
      done[i] = true;
    });
  }
  checkCancelled();
  progress('joining');

  const decoded = [];
  for (let i = 0; i < passages.length; i++) decoded.push(await deps.decode(buffers[i], voiceFor(passages[i].speaker)));
  checkCancelled();

  const { clips, length } = layoutPassages(decoded, { sampleRate, pauses: passages.map((p) => p.pauseAfter) });
  if (clips.length === 0) {
    throw new ApiError('The voices returned no audio.', { status: 502, code: 'empty_audio' });
  }
  const result = mixSpeakers(
    clips.map((clip) => ({ ...clip, speaker: passages[clip.index].speaker })),
    { sampleRate, length: length / sampleRate, runOut: 0, peak, matchSpeakers }
  );
  return { ...result, report: { ...result.report, passages: passages.length, turns: turns.length } };
};
