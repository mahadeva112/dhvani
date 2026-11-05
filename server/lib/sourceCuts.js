/**
 * Cut at the original's pauses (join.cutAtSourcePauses): where in a dub line
 * the original speaker paused, and where in its voice Sync may cut it there
 * without it sounding cut.
 *
 * A dub line is often read straight through where the speaker paused, and
 * then Chunk sync has no silence to split it at: everything after the pause
 * comes in early. Translation marks each pause in the line it writes
 * (`pausedTarget`, see translationPauses.js), and cues joined into one line
 * meet where the speaker stopped between them, so the word each pause follows
 * is known. Sync cuts the take there, as it does the user's own cuts (S on
 * Review's dub lane), and the part after it starts where the speaker starts
 * again.
 *
 * Sound first (soundFirstCut): the voice's own pause there is used when it
 * has one; else the line is cut only after a comma or sentence end, where the
 * sound dips between the two words. Elsewhere it is left as it is. The voice
 * is never changed: only the silence between the parts.
 */

import { PAUSE_MARK, stripPauses } from './linePauses.js';
import { TRANSLATION_PAUSE_SECONDS } from './translationPauses.js';

/** The pause a cut at a pause stands for is at least this long in the original (the default; see syncSettings.js). */
export const SOURCE_CUT_MIN_PAUSE = TRANSLATION_PAUSE_SECONDS;

/** Between the words around a cut with no pause of the voice's own, the sound dips at least this far below the line's speech. */
export const QUIET_DROP_DB = 20;
/** ... or below this level, in dBFS, however quiet the line. */
export const QUIET_FLOOR_DB = -45;

/** The window a dip is measured over. */
const QUIET_WINDOW_SECONDS = 0.01;
/** A chunk boundary this close to a word's edge still falls between the two words. */
const EDGE_SECONDS = 0.02;

const clean = (text) => String(text || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const hasWord = (text) => /[\p{L}\p{N}]/u.test(String(text ?? ''));
const cueText = (cue) => String(cue?.textTarget || cue?.targetText || '').trim();

/** The cue's line with the speaker's pauses its translation kept, while the cue still says that translation. */
const pausedText = (cue) => {
  const paused = String(cue?.pausedTarget || '').trim();
  return paused && stripPauses(paused) === cueText(cue) ? paused : null;
};

const timedWords = (cue) =>
  (Array.isArray(cue?.words) ? cue.words : []).filter((word) => hasWord(word?.text) && finite(word.start) && finite(word.end) && word.end >= word.start);

/** Where the cue's original speech starts again after each pause translation kept a mark for, in order (as cuePauses finds them). */
const resumesOf = (cue) => {
  const words = timedWords(cue);
  const out = [];
  for (let w = 1; w < words.length; w++) if (words[w].start - words[w - 1].end >= TRANSLATION_PAUSE_SECONDS) out.push(words[w].start);
  return out;
};

/**
 * The cuts at the original's pauses in a dub line of `cues` saying `text`,
 * as `[{ letters, seconds, resume }]`: `letters` of the line said before the
 * pause (counted as chunkSync's cutPoints counts them), `seconds` how long the
 * speaker paused and `resume` where the speaker starts again, or null where
 * that isn't known for certain. Between two cues of the line that is the next
 * cue's first word; inside a cue, its translation's pause marks, while the cue
 * says that translation and the marks are as many as its pauses. Pauses
 * shorter than `minPause` and the letters in `skip` (cuts the user turned
 * off on Review's dub lane) are left out.
 */
export const sourcePauseCuts = (cues, text, { minPause = SOURCE_CUT_MIN_PAUSE, skip = [] } = {}) => {
  const sorted = (cues || []).filter((cue) => cue && cueText(cue) && finite(cue.startTime) && finite(cue.endTime)).sort((a, b) => a.startTime - b.startTime);
  const total = clean(text).length;
  // A line put together from other words than its cues' says nothing about where their pauses fall.
  if (sorted.length === 0 || clean(sorted.map(cueText).join(' ')) !== clean(text)) return [];
  const cuts = [];
  let before = 0;
  sorted.forEach((cue, c) => {
    const previous = sorted[c - 1];
    if (previous) {
      const first = timedWords(cue)[0];
      const last = timedWords(previous).at(-1);
      const resume = first ? first.start : cue.startTime;
      const gap = resume - (last ? last.end : previous.endTime);
      if (gap > 0) cuts.push({ letters: before, seconds: gap, resume });
    }
    const paused = pausedText(cue);
    if (paused) {
      const resumes = resumesOf(cue);
      const marks = [...paused.matchAll(PAUSE_MARK)];
      marks.forEach((mark, k) => {
        cuts.push({
          letters: before + clean(stripPauses(paused.slice(0, mark.index))).length,
          seconds: Number(mark[1]),
          resume: marks.length === resumes.length ? resumes[k] : null,
        });
      });
    }
    before += clean(cueText(cue)).length;
  });
  const skipped = new Set(Array.isArray(skip) ? skip : []);
  const seen = new Set();
  return cuts.filter((cut) => {
    if (!(cut.seconds >= minPause - 1e-9) || cut.letters <= 0 || cut.letters >= total || skipped.has(cut.letters) || seen.has(cut.letters)) return false;
    seen.add(cut.letters);
    return true;
  });
};

/** The level of `samples` from `from` to `to`, in dBFS (RMS). */
export const levelDb = (samples, from, to) => {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(samples.length, Math.ceil(to));
  if (b <= a) return -Infinity;
  let sum = 0;
  for (let s = a; s < b; s++) sum += samples[s] * samples[s];
  const rms = Math.sqrt(sum / (b - a));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
};

/**
 * Where the voice of a line may be cut for a cut at `letters` letters
 * (sourcePauseCuts), sound first. `words` are its aligned words, `kinds`
 * how its script reads after each (wordKinds), `chunks` where it goes quiet
 * (splitChunks) and `speechDb` the level of its speech (levelDb). Returns:
 * - `{ at, how: 'voice' }` where the voice pauses there itself: a chunk
 *   boundary falls between the two words, and the part starts at it;
 * - `{ at, how: 'quiet' }` where it doesn't, but the script has a comma or a
 *   sentence end there and the sound between the two words dips
 *   QUIET_DROP_DB below its speech (or below QUIET_FLOOR_DB): `at` is the
 *   quietest point;
 * - `{ why }` where it may not be cut: 'words' when the cut doesn't fall
 *   between two timed words, 'runs-on' when the voice runs on there.
 */
export const soundFirstCut = ({ samples, sampleRate, words, kinds, chunks, letters, speechDb }) => {
  const spoken = (words || []).map((word, k) => ({ word, k })).filter(({ word }) => hasWord(word?.text) && finite(word.start) && finite(word.end));
  let sum = 0;
  let at = -1;
  for (let s = 0; s < spoken.length; s++) {
    sum += clean(spoken[s].word.text).length;
    if (sum === letters) {
      at = s;
      break;
    }
    if (sum > letters) break;
  }
  if (at < 0 || at >= spoken.length - 1) return { why: 'words' };
  const aEnd = spoken[at].word.end * sampleRate;
  const bStart = spoken[at + 1].word.start * sampleRate;
  const edge = EDGE_SECONDS * sampleRate;
  // The voice's own pause: it went quiet between the two words.
  for (let c = 1; c < (chunks || []).length; c++) {
    if (chunks[c - 1].to <= bStart + edge && chunks[c].from >= aEnd - edge) return { at: chunks[c].from, how: 'voice' };
  }
  const kind = kinds?.[spoken[at].k] ?? 'word';
  if (kind === 'word') return { why: 'runs-on' };
  // The quietest point between the two words, measured over QUIET_WINDOW_SECONDS.
  const win = Math.max(1, Math.round(QUIET_WINDOW_SECONDS * sampleRate));
  const mid = (aEnd + bStart) / 2;
  const lo = Math.min(aEnd, bStart, mid - win / 2);
  const hi = Math.max(aEnd, bStart, mid + win / 2);
  const step = Math.max(1, Math.round(win / 4));
  let best = null;
  for (let s = lo; s <= Math.max(lo, hi - win); s += step) {
    const db = levelDb(samples, s, s + win);
    if (!best || db < best.db) best = { db, at: Math.round(s + win / 2) };
  }
  const quiet = Math.max(QUIET_FLOOR_DB, (finite(speechDb) ? speechDb : 0) - QUIET_DROP_DB);
  return best && best.db <= quiet ? { at: best.at, how: 'quiet' } : { why: 'runs-on' };
};

/** Where in `pauses` (linePauses, `[[start, end]]`) the speaker starts again nearest `t`, within `reach` seconds; null when none is. */
export const nearestResume = (pauses, t, reach = 1) => {
  let best = null;
  for (const [, end] of pauses || []) if (Math.abs(end - t) <= reach && (best === null || Math.abs(end - t) < Math.abs(best - t))) best = end;
  return best;
};
