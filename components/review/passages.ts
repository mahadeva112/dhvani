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

/** How the Script view lays out a passage: one line per cue to edit, or running text to read along. */
export type PassageLayout = 'lines' | 'paragraph';

const LAYOUT_KEY = 'dhvani_passage_layout';

export const loadPassageLayout = (): PassageLayout => {
  try {
    if (localStorage.getItem(LAYOUT_KEY) === 'paragraph') return 'paragraph';
  } catch {}
  return 'lines';
};

export const savePassageLayout = (layout: PassageLayout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
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
