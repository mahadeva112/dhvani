/**
 * Takes from the dub: a sync built from the Final dub's own audio.
 *
 * Voicing every line again for a sync makes new takes, and a new take never
 * sounds quite like the dub the user already heard and liked. So where the
 * dub is still what the script says, each line is cut out of the dub instead:
 * the dub is force-aligned with the script it was voiced from (ElevenLabs
 * forced alignment gives every word's time), each cue gets the time its words
 * take, and a line is cut at the quietest point between its words and its
 * neighbours'. Only lines whose words changed since the dub are voiced again.
 *
 * The cut copies the dub's samples untouched: no fade, gain or resample.
 */

const TAG = /\[[^\]\n]{1,120}\]/g;

/** The letters and digits of a text, as forced alignment hears them: no tags, punctuation or spacing. */
export const lettersOf = (text) =>
  String(text || '')
    .replace(TAG, ' ')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');

/** The script the dub says, for forced alignment: the cues' words with any tags taken out. */
export const alignmentText = (cues) =>
  cues
    .map((cue) => String(cue.text || '').replace(TAG, ' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The time each cue takes in the dub, from forced-alignment `words`
 * (`[{ text, start, end }]`, seconds) and the dubbed `cues` (`[{ id, text }]`
 * in spoken order). Words are matched to cues letter by letter, so spacing and
 * punctuation don't matter. Returns a Map of cue id → `{ start, end }`, or
 * null when the words don't spell out the script (the dub says something else).
 */
export const cueSpans = (words, cues) => {
  const owner = [];
  let script = '';
  cues.forEach((cue, c) => {
    const letters = lettersOf(cue.text);
    script += letters;
    for (let k = 0; k < letters.length; k++) owner.push(c);
  });
  if (!script) return null;

  const spans = new Map();
  let at = 0;
  for (const word of Array.isArray(words) ? words : []) {
    const letters = lettersOf(word?.text);
    if (!letters) continue;
    if (script.slice(at, at + letters.length) !== letters) return null;
    const start = Number(word.start);
    const end = Number(word.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      for (const c of new Set(owner.slice(at, at + letters.length))) {
        const id = String(cues[c].id);
        const span = spans.get(id);
        spans.set(id, span ? { start: Math.min(span.start, start), end: Math.max(span.end, end) } : { start, end });
      }
    }
    at += letters.length;
  }
  return at === script.length ? spans : null;
};

/** Length of the window the quietest cut point is looked for with. */
const QUIET_WINDOW_SECONDS = 0.01;

/** How far before a first line, or after a last one, the cut may reach. */
const OPEN_EDGE_SECONDS = { before: 0.5, after: 1 };

/** The sample at the middle of the quietest window between `from` and `to` (sample indexes). */
export const quietestPoint = (samples, from, to, window) => {
  const a = Math.max(0, Math.min(samples.length, Math.round(from)));
  const b = Math.max(a, Math.min(samples.length, Math.round(to)));
  if (b - a <= window) return Math.round((a + b) / 2);
  let energy = 0;
  for (let i = a; i < a + window; i++) energy += samples[i] * samples[i];
  let best = energy;
  let bestAt = a;
  for (let i = a + window; i < b; i++) {
    energy += samples[i] * samples[i] - samples[i - window] * samples[i - window];
    // Ties go to the later window, nearer the middle of a silent gap.
    if (energy <= best) {
      best = energy;
      bestAt = i - window + 1;
    }
  }
  return bestAt + Math.floor(window / 2);
};

/**
 * Each sync unit's take cut from the dub, or null for a unit that must be
 * voiced again. `units` as buildSyncUnits gives them; `spans` from cueSpans;
 * `usable(cueId)` says whether a cue still reads as it did in the dub;
 * `samples` the dub at `sampleRate`. A unit is cut only when every cue in it
 * is usable and placed in the dub.
 */
export const cutDubTakes = ({ units, spans, usable, samples, sampleRate }) => {
  const window = Math.max(1, Math.round(QUIET_WINDOW_SECONDS * sampleRate));
  const all = [...spans.entries()].map(([id, span]) => ({ id, ...span }));
  return units.map((unit) => {
    const ids = unit.cueIds.map(String);
    if (!ids.every((id) => spans.has(id) && usable(id))) return null;
    const own = new Set(ids);
    const start = Math.min(...ids.map((id) => spans.get(id).start));
    const end = Math.max(...ids.map((id) => spans.get(id).end));
    let before = -Infinity;
    let after = Infinity;
    for (const span of all) {
      if (own.has(span.id)) continue;
      if (span.start < start) before = Math.max(before, Math.min(span.end, start));
      else after = Math.min(after, Math.max(span.start, end));
    }
    const from = Number.isFinite(before)
      ? quietestPoint(samples, before * sampleRate, start * sampleRate, window)
      : Math.max(0, Math.round((start - OPEN_EDGE_SECONDS.before) * sampleRate));
    const to = Number.isFinite(after)
      ? quietestPoint(samples, end * sampleRate, after * sampleRate, window)
      : Math.min(samples.length, Math.round((end + OPEN_EDGE_SECONDS.after) * sampleRate));
    return to > from ? samples.slice(from, to) : null;
  });
};
