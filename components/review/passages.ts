import type { AudioSegment } from '../../types';

/** The pauses in the original a reviewer can split passages at, in seconds. */
export const PASSAGE_PAUSES = [0.8, 1.2, 2] as const;
export const DEFAULT_PASSAGE_PAUSE = 1.2;

const PAUSE_KEY = 'dhvani_passage_pause';

export const loadPassagePause = (): number => {
  try {
    const saved = Number(localStorage.getItem(PAUSE_KEY));
    if ((PASSAGE_PAUSES as readonly number[]).includes(saved)) return saved;
  } catch {}
  return DEFAULT_PASSAGE_PAUSE;
};

export const savePassagePause = (pause: number) => {
  try {
    localStorage.setItem(PAUSE_KEY, String(pause));
  } catch {}
};

export interface Passage {
  /** The passage's first cue, which names it across edits that don't touch its start. */
  key: string;
  /** 0-based position in the script. */
  index: number;
  cues: AudioSegment[];
  /** Silence in the original before this passage starts; 0 for the first one. */
  pauseBefore: number;
}

/**
 * The script cut into passages where the original speaker pauses longer than
 * `pause` seconds, or where the speaker changes. It reads only the cues'
 * times on the original, so the cues themselves are never cut or moved.
 */
export const buildPassages = (segments: AudioSegment[], pause: number): Passage[] => {
  const passages: Passage[] = [];
  segments.forEach((seg, i) => {
    const prev = segments[i - 1];
    const gap = prev ? Math.max(0, seg.startTime - prev.endTime) : 0;
    if (!prev || gap > pause || (seg.speaker || '') !== (prev.speaker || '')) {
      passages.push({ key: String(seg.id), index: passages.length, cues: [seg], pauseBefore: gap });
    } else {
      passages[passages.length - 1].cues.push(seg);
    }
  });
  return passages;
};

// A full stop, question or exclamation mark, danda or ellipsis, maybe inside a closing quote or bracket.
export const endsSentence = (text: string) => /[.!?।॥…][\s"'”’)\]]*$/.test(text.trim());

/**
 * How long the Script view's paragraphs run, from how long the script is:
 * about a sixth of it, never under a minute or over three. A five-minute
 * talk reads in five paragraphs, a twelve-minute one in two-minute
 * paragraphs, anything from eighteen minutes in three-minute ones.
 */
export const scriptParagraphSeconds = (segments: AudioSegment[]): number => {
  const total = segments.length ? segments[segments.length - 1].endTime - segments[0].startTime : 0;
  if (!Number.isFinite(total) || total <= 0) return 120;
  return Math.min(180, Math.max(60, total / 6));
};

/** The most cues a paragraph takes when the cues' times can't say where to end it. */
const PARAGRAPH_MAX_CUES = 40;

/**
 * The script cut into the Script view's paragraphs, each about
 * `scriptParagraphSeconds` long. Within 70-140% of that length a paragraph
 * ends where the original pauses longest, best at a sentence's end or where
 * the speaker changes; a last stretch that would come out short stays with
 * the paragraph before it. Cues are never cut or moved.
 */
export const buildScriptParagraphs = (segments: AudioSegment[], sourceOf: (seg: AudioSegment) => string): Passage[] => {
  const target = scriptParagraphSeconds(segments);
  const passages: Passage[] = [];
  let s = 0;
  while (s < segments.length) {
    const startT = segments[s].startTime;
    const lengthTo = (j: number) => segments[j].endTime - startT;
    let cut = segments.length - 1;
    if (!(lengthTo(segments.length - 1) <= target * 1.4)) {
      let best = -1;
      let bestScore = -Infinity;
      let firstLongEnough = -1;
      for (let j = s; j < segments.length - 1; j++) {
        const len = lengthTo(j);
        if (len > target * 1.4) break;
        if (!(len >= target * 0.7)) continue;
        if (firstLongEnough === -1) firstLongEnough = j;
        const next = segments[j + 1];
        // A cut that would leave a short last paragraph is passed over.
        if (segments[segments.length - 1].endTime - next.startTime < target * 0.7) continue;
        const gap = Math.max(0, next.startTime - segments[j].endTime) || 0;
        const score =
          Math.min(gap, 3) +
          (endsSentence(sourceOf(segments[j])) ? 1 : 0) +
          ((next.speaker || '') !== (segments[j].speaker || '') ? 1.5 : 0) -
          (0.5 * Math.abs(len - target)) / target;
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
      if (best !== -1) cut = best;
      else {
        // One long cue overshoots the window, or the times are unknown: end at the first cue past the target's 70%.
        let j = s;
        while (j < segments.length - 1 && !(lengthTo(j) >= target * 0.7) && j - s < PARAGRAPH_MAX_CUES - 1) j++;
        cut = firstLongEnough !== -1 ? firstLongEnough : j;
      }
    }
    const prev = segments[s - 1];
    passages.push({
      key: String(segments[s].id),
      index: passages.length,
      cues: segments.slice(s, cut + 1),
      pauseBefore: prev ? Math.max(0, segments[s].startTime - prev.endTime) : 0,
    });
    s = cut + 1;
  }
  return passages;
};
