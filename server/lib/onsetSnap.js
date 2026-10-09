/**
 * Onset correction for ElevenLabs word timestamps (from Srutilekha).
 *
 * Scribe, like every ASR, marks a word as starting where it gets LOUD — at the
 * vowel — not where the speaker actually begins it. A leading fricative or
 * plosive carries almost no energy, so a subtitle cut on the raw timestamp pops
 * in a few frames after the sound. Measured on a Hindi reel, every cue that
 * began out of clear silence was late, by +34 to +209 ms (median +70 ms), and
 * not one was early.
 *
 * So each word that begins out of a real gap is moved back onto the onset found
 * in the waveform. Only ever earlier, never past the previous word, never more
 * than SNAP_MAX_PULL — the worst case is that a word stays where Scribe put it.
 * Words inside continuous speech have no onset to snap to and are left alone.
 */

export const ENVELOPE_HOP = 0.005; // 5 ms, about 1/8 of a frame
const ENV_THRESH = 0.04; // fraction of peak that counts as not-silence
const SNAP_MAX_PULL = 0.3; // never drag a start back further than this
const SNAP_DIP = 0.04; // quiet shorter than this is inside a word, not a gap
const SNAP_MIN_KEEP = 0.08; // never trim the previous word shorter than this
const NO_AUDIO_LEAD = 0.08; // fixed pull when the waveform cannot be read
const NO_AUDIO_MIN_GAP = 0.12; // …applied only to words that follow a pause

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Where the run of speech containing `t` begins, or null when `t` is already
 * in silence or the walk back stays inside continuous speech for `maxPull`.
 */
export const onsetBefore = (envelope, t, { hop = ENVELOPE_HOP, maxPull = SNAP_MAX_PULL } = {}) => {
  const i = Math.floor(t / hop);
  if (i <= 0 || i >= envelope.length || envelope[i] <= ENV_THRESH) return null;

  const limit = Math.max(0, i - Math.round(maxPull / hop));
  const dip = Math.max(1, Math.round(SNAP_DIP / hop));
  let quiet = 0;
  let onset = i;
  for (let j = i - 1; j >= limit; j -= 1) {
    if (envelope[j] > ENV_THRESH) {
      quiet = 0;
      onset = j;
    } else {
      quiet += 1;
      if (quiet >= dip) return onset * hop;
    }
  }
  return null;
};

const isSpoken = (word) =>
  (word?.type || 'word') === 'word' &&
  typeof word?.start === 'number' &&
  typeof word?.end === 'number' &&
  String(word.text || '').trim().length > 0;

/**
 * Returns a copy of Scribe's `words` with onset-corrected starts. Spacing and
 * audio-event tokens pass through untouched. With no envelope (no ffmpeg), a
 * word that follows a pause gets a small fixed lead instead.
 */
export const snapWordOnsets = (words = [], envelope = null, { hop = ENVELOPE_HOP } = {}) => {
  const out = words.map((word) => ({ ...word }));
  let prev = null;

  for (const word of out) {
    if (!isSpoken(word)) continue;
    const start = Number(word.start);
    const prevEnd = prev ? Number(prev.end) : 0;
    let next = start;

    if (envelope && envelope.length) {
      const onset = onsetBefore(envelope, start, { hop });
      if (onset !== null && onset < start) {
        next = onset;
        // Scribe's word ENDS overshoot too, so the previous word can still be
        // "running" when this one audibly begins. onsetBefore only returns a
        // time with real silence in front of it, so hand those frames over.
        if (prev && next < prevEnd && next - Number(prev.start) >= SNAP_MIN_KEEP) {
          prev.end = round3(next);
        }
      }
    } else if (!prev || start - prevEnd >= NO_AUDIO_MIN_GAP) {
      next = start - NO_AUDIO_LEAD;
    }

    const floor = prev ? Number(prev.end) : 0;
    next = Math.max(next, floor, 0);
    if (next < start && next < Number(word.end)) word.start = round3(next);
    prev = word;
  }

  return out;
};
