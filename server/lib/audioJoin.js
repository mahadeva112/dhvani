/**
 * Joins separately generated speech passages into one continuous read.
 *
 * Appending the passages' files as they come back leaves the joins uneven:
 * each generation carries its own lead-in and tail silence (sometimes almost
 * none, sometimes far too much) and its own MP3 encoder padding. Here the
 * passages are joined as audio instead, without changing the voice:
 *
 * - each passage is trimmed only inside true silence (see prepareClip), so a
 *   word's whole decay and every breath are kept, and no trim can click;
 * - the passages are spaced so the pause between the last word of one and the
 *   first word of the next is sized to the boundary in the script;
 * - every sample is copied as generated: gain 1 and no fades. Loudness is
 *   evened out between passages only when asked for (`matchLoudness`), and an
 *   edge with no silence around it gets the same few-millisecond treatment as
 *   in a synced dub (see renderTimeline), never a fade over speech.
 *
 * The dub's own start and end are evened out the same way: generations often
 * begin on the first syllable and stop on the last one, which sounds like the
 * audio was cut off. Silence is added (never cut from speech) so the first word
 * starts DUB_LEAD_IN_SECONDS in and the last one is followed by
 * DUB_RUN_OUT_SECONDS.
 */
import { prepareClip, renderTimeline } from './syncRender.js';

/**
 * How much more than the script's pause is left between two passages' words,
 * and how far the first word sits after the lead-in and the last before the
 * run-out: the breathing room trimming used to keep either side of speech.
 */
const WORD_LEAD_SECONDS = 0.03;
const WORD_TAIL_SECONDS = 0.08;
const END_TAIL_SECONDS = 0.15;

/** Silence before the first word and after the last, so the dub neither starts nor stops abruptly. */
export const DUB_LEAD_IN_SECONDS = 0.3;
export const DUB_RUN_OUT_SECONDS = 1.2;

/**
 * Joins mono float passages into one dub. `pauses[i]` is the pause, in
 * seconds, after passage `i` (so between its last word and the next
 * passage's first, plus the breathing room above); `leadIn` and `runOut` are
 * the silence before the first word and after the last. A single passage gets
 * the same treatment. `log` receives what the render did to each passage (see
 * renderTimeline). Returns one Float32Array.
 */
export const joinPassages = (
  passages,
  { sampleRate, pauses = [], leadIn = DUB_LEAD_IN_SECONDS, runOut = DUB_RUN_OUT_SECONDS, matchLoudness = false, log }
) => {
  const toSamples = (seconds) => Math.round(Math.max(0, seconds ?? 0) * sampleRate);

  const pieces = [];
  passages.forEach((samples, index) => {
    const clip = prepareClip(samples, sampleRate);
    if (!clip) return; // a silent passage adds nothing but its pause
    pieces.push({ index, samples: clip.samples, lead: toSamples(clip.lead), speech: toSamples(clip.speech) });
  });
  if (pieces.length === 0) return new Float32Array(0);

  // Whole-sample starts: each passage's first word lands where the pause asks,
  // but a passage never starts before the one before it has ended.
  const clips = [];
  let end = 0;
  let lastWordEnd = 0;
  pieces.forEach((piece, n) => {
    const wordAt =
      n === 0
        ? toSamples(leadIn + WORD_LEAD_SECONDS)
        : lastWordEnd + toSamples((pauses[pieces[n - 1].index] ?? 0) + WORD_TAIL_SECONDS + WORD_LEAD_SECONDS);
    const start = Math.max(end, wordAt - piece.lead);
    clips.push({ samples: piece.samples, startSample: start });
    end = start + piece.samples.length;
    lastWordEnd = start + piece.lead + piece.speech;
  });

  const total = Math.max(end, lastWordEnd + toSamples(runOut + END_TAIL_SECONDS));
  return renderTimeline(clips, { sampleRate, length: total / sampleRate, runOut: 0, matchLoudness, log });
};
