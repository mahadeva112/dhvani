/**
 * Chunk sync: a dub line placed the way Samanvaya places it in REAPER, as
 * the chunks of speech between its pauses rather than as one rigid clip.
 *
 * 1. Each voiced line is split where it goes quiet, as REAPER's Dynamic
 *    split does with "Remove silent areas" (splitChunks): a gate opens at
 *    `openDb`, closes `hysteresisDb` below that, and a silence shorter than
 *    `minSilence` or a slice shorter than `minSlice` doesn't split. Each
 *    chunk keeps `leadPad` before its first sound and `trailPad` after its
 *    last. With forced alignment, a split that would cut into a word is not
 *    made, which REAPER can't promise.
 * 2. Each chunk wants its first word where the original says the same part
 *    of the line (chunkTargets): its place in the dub's words, as a share of
 *    each cue, mapped onto that cue's original speech with the original's
 *    pauses skipped, as Samanvaya's _compute_targets does.
 * 3. Chunks closer than RIGID_GAP_SECONDS move as one block; the pause
 *    between blocks may shrink to `gapShare` of what the voice left, never
 *    below a floor, and no block need wait more than `maxGap`. Shrinking
 *    goes in order of punctuation (pauseFloors): a pause between words
 *    first, then one at a comma, a sentence end last.
 * 4. Every block of the dub is placed in one solve (placeClips), its error
 *    shared with the blocks around it, early as well as late.
 *
 * Nothing changes the voice: the chunks are the line's own samples, and only
 * the silence between them is left out.
 */

/** Chunks closer than this were said in one breath and move together (Samanvaya's _ISO_RIGID_GAP). */
export const RIGID_GAP_SECONDS = 0.15;

/** The gate reads the line's level in frames this long. */
const GATE_FRAME_SECONDS = 0.005;

/** A split may not cut into a word by more than this, where forced alignment puts the word's edge. */
const WORD_EDGE_SECONDS = 0.02;

/**
 * How far before the gate opens a chunk may reach for a soft start (an "s",
 * an "h") that is above the close level but below the open level: REAPER
 * keeps only its leading pad of it, Chunk sync keeps the whole of it.
 */
const SOFT_ONSET_SECONDS = 0.1;

/** Pauses a dub line was voiced with that the original speaker took shorter than this are word gaps, not pauses. */
const SOURCE_SPAN_GAP_SECONDS = 0.15;

const clean = (text) => String(text || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The chunks of speech in `samples`, as `[{ from, to }]` sample ranges in
 * order, as REAPER's Dynamic split with "Remove silent areas" cuts them.
 * `protect` (`[{ start, end }]` samples, the words as forced alignment hears
 * them) keeps any split out of a word. A line with no sound is one chunk.
 */
export const splitChunks = (
  samples,
  sampleRate,
  { openDb = -40, hysteresisDb = -15, minSlice = 0.1, minSilence = 0.15, leadPad = 0.01, trailPad = 0.02, protect = [] } = {}
) => {
  const whole = [{ from: 0, to: samples.length }];
  const hop = Math.max(1, Math.round(GATE_FRAME_SECONDS * sampleRate));
  const open = 10 ** (openDb / 20);
  const close = 10 ** ((openDb - Math.abs(hysteresisDb)) / 20);
  const silenceFrames = Math.max(1, Math.round(minSilence / GATE_FRAME_SECONDS));
  const levelOf = (frame) => {
    let peak = 0;
    const end = Math.min(samples.length, (frame + 1) * hop);
    for (let i = frame * hop; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
    return peak;
  };
  const sounds = [];
  let on = false;
  let start = 0;
  let lastLoud = 0;
  let below = 0;
  for (let frame = 0; frame * hop < samples.length; frame++) {
    const peak = levelOf(frame);
    if (!on) {
      if (peak >= open) {
        on = true;
        // Back over a soft start, as far as the close level and SOFT_ONSET_SECONDS allow, never into the chunk before.
        const earliest = Math.max(sounds.length ? Math.ceil(sounds.at(-1).to / hop) : 0, frame - Math.round(SOFT_ONSET_SECONDS / GATE_FRAME_SECONDS));
        start = frame;
        while (start > earliest && levelOf(start - 1) >= close) start--;
        lastLoud = frame;
        below = 0;
      }
    } else if (peak >= close) {
      lastLoud = frame;
      below = 0;
    } else if (++below >= silenceFrames) {
      sounds.push({ from: start * hop, to: Math.min(samples.length, (lastLoud + 1) * hop) });
      on = false;
    }
  }
  if (on) sounds.push({ from: start * hop, to: Math.min(samples.length, (lastLoud + 1) * hop) });
  if (sounds.length === 0) return whole;

  // A slice shorter than minSlice is not cut out on its own: it joins the one before it (or after, at the start).
  const minLength = Math.round(minSlice * sampleRate);
  const sliced = [];
  for (const sound of sounds) {
    const last = sliced.at(-1);
    if (last && (sound.to - sound.from < minLength || last.to - last.from < minLength)) last.to = sound.to;
    else sliced.push({ ...sound });
  }

  // The pads, then any split that would cut into a word joins its two chunks.
  const lead = Math.round(leadPad * sampleRate);
  const trail = Math.round(trailPad * sampleRate);
  const edge = Math.round(WORD_EDGE_SECONDS * sampleRate);
  const words = protect.filter((word) => finite(word?.start) && finite(word?.end) && word.end - word.start > 2 * edge);
  // A chunk holds the whole of every word it touches, as forced alignment hears it, with the pads around it.
  const padded = sliced.map((chunk) => {
    let { from, to } = chunk;
    for (const word of words) {
      if (word.end > from && word.start < to) {
        from = Math.min(from, word.start);
        to = Math.max(to, word.end);
      }
    }
    return { from: Math.max(0, from - lead), to: Math.min(samples.length, to + trail) };
  });
  const chunks = [];
  for (const chunk of padded) {
    const last = chunks.at(-1);
    const cutsWord = last && words.some((word) => word.start + edge < chunk.from && word.end - edge > last.to);
    if (last && (chunk.from <= last.to || cutsWord)) last.to = Math.max(last.to, chunk.to);
    else chunks.push({ ...chunk });
  }
  return chunks;
};

/** How a pause reads in the script: after a sentence end, after a comma, or between words. */
export const PAUSE_KINDS = ['word', 'comma', 'stop'];

/** How the script reads after `token`: 'stop', 'comma' or 'word' (see wordKinds). */
export const kindOf = (token) => (/[.!?।॥…]["'’”)\]]*$/u.test(token) ? 'stop' : /[,;:—–-]["'’”)\]]*$/u.test(token) ? 'comma' : 'word');

/**
 * For each of the aligned `words` of `text`, how the script reads after it:
 * 'stop' after a sentence end, 'comma' after a comma, semicolon, colon or
 * dash, 'word' otherwise. Words are matched to the script by their letters,
 * as forced alignment returns them.
 */
export const wordKinds = (text, words) => {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  // Where each token's letters end, counted in the letters of the whole text.
  const ends = [];
  let letters = 0;
  for (const token of tokens) {
    letters += clean(token).length;
    ends.push({ at: letters, kind: kindOf(token) });
  }
  let cursor = 0;
  return words.map((word) => {
    cursor += clean(word.text).length;
    const token = ends.find((end) => end.at === cursor);
    return token ? token.kind : 'word';
  });
};

/**
 * The original speech of a cue as `[[start, end]]` seconds, its pauses left
 * out: its words joined where the speaker ran on, or the whole cue when its
 * words are untimed.
 */
const sourceSpans = (cue) => {
  const words = (Array.isArray(cue?.words) ? cue.words : [])
    .filter((word) => /[\p{L}\p{N}]/u.test(String(word?.text ?? 'x')) && finite(word.start) && finite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start);
  if (words.length === 0) return finite(cue?.startTime) && finite(cue?.endTime) && cue.endTime > cue.startTime ? [[cue.startTime, cue.endTime]] : [];
  const spans = [[words[0].start, words[0].end]];
  for (const word of words.slice(1)) {
    const last = spans.at(-1);
    if (word.start - last[1] < SOURCE_SPAN_GAP_SECONDS) last[1] = Math.max(last[1], word.end);
    else spans.push([word.start, word.end]);
  }
  return spans;
};

/** The moment `share` (0-1) of the way through `spans`' speech. */
const timeAt = (spans, share) => {
  const total = spans.reduce((sum, [a, b]) => sum + b - a, 0);
  let left = Math.min(1, Math.max(0, share)) * total;
  // A share that ends one stretch exactly starts the next: a chunk lands where the speaker starts again.
  for (const [a, b] of spans) {
    if (left < b - a - 1e-6) return a + left;
    left = Math.max(0, left - (b - a));
  }
  return spans.at(-1)[1];
};

/**
 * Where each chunk's first word should land in the original, in seconds.
 * `onsets` are the seconds into the line each chunk's first sound starts;
 * `words` the line's aligned words (or null) and `cues` the line's cues in
 * order, each with its dub text (`textTarget`) and original word timestamps.
 * A chunk's first word is that far through the dub's letters; the cue it
 * falls in is found by letters, and the same share of that cue's original
 * speech is where it should land. Without word timing, a chunk's place in
 * the line's speech time stands in for its place in the letters.
 */
export const chunkTargets = ({ onsets, words, cues, lead, speech }) => {
  const lengths = cues.map((cue) => clean(cue?.textTarget || cue?.targetText).length);
  const letters = lengths.reduce((sum, n) => sum + n, 0);
  const spans = cues.map(sourceSpans);
  const fallback = cues.find((cue) => finite(cue?.startTime))?.startTime ?? 0;
  // Letters of the line said before `t` seconds into it.
  const lettersBefore = (t) => {
    if (words && words.length) {
      let count = 0;
      for (const word of words) {
        if (word.start >= t - WORD_EDGE_SECONDS) break;
        count += clean(word.text).length;
      }
      return count;
    }
    return speech > 0 ? letters * Math.min(1, Math.max(0, (t - lead) / speech)) : 0;
  };
  return onsets.map((t) => {
    if (letters === 0) return fallback;
    let at = lettersBefore(t);
    for (let c = 0; c < cues.length; c++) {
      const last = c === cues.length - 1;
      if (at < lengths[c] || last) {
        if (spans[c].length === 0) return finite(cues[c]?.startTime) ? cues[c].startTime : fallback;
        return timeAt(spans[c], lengths[c] > 0 ? at / lengths[c] : 0);
      }
      at -= lengths[c];
    }
    return fallback;
  });
};

/**
 * The least pause each kind may shrink to, at each step of the priority
 * order: `tier` 0 shrinks only pauses between words, 1 also those at a
 * comma, 2 every pause. A pause not yet allowed to shrink keeps what it
 * has, up to `maxGap`.
 */
export const pauseFloor = (kind, original, tier, { gapShare, wordGap, commaGap, stopGap, maxGap }) => {
  const floor = kind === 'stop' ? stopGap : kind === 'comma' ? commaGap : wordGap;
  const rank = PAUSE_KINDS.indexOf(kind);
  const kept = rank > tier ? Math.min(original, maxGap) : Math.max(floor, Math.min(original * gapShare, maxGap));
  // Never more than the pause there was (Samanvaya: "never demand more silence than the artist left").
  return Math.max(0, Math.min(kept, original));
};
