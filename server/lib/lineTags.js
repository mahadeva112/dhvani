/**
 * Audio tags the user types into a retake's words, as `[whispers]` or
 * `[speaking softly]`: Eleven v3 and v4 perform them, and nothing else sees
 * them. The script and the subtitles never carry them (stripTags); only the
 * voice hears them, kept by cleanTextForNaturalSpeech's `keepOwnTags`.
 * Pause marks (`[pause 0.4s]`, linePauses.js) are not tags.
 */

/** One tag: English words, as v3 reads them. Global: use with replace or matchAll, never test or exec. */
export const TAG_MARK = /\[([a-zA-Z][a-zA-Z' -]{0,38})\]/g;

/** Whether the inside of a bracket is a tag. */
export const isTagName = (name) => /^[a-zA-Z][a-zA-Z' -]{0,38}$/.test(String(name || '').trim());

/** Tags offered in the retake window, grouped as the menu shows them. Any other English tag can be typed. */
export const TAG_LIBRARY = [
  { group: 'Mood', tags: ['calm', 'warmly', 'serious', 'thoughtful', 'curious', 'excited', 'amused', 'sarcastic', 'sad', 'happy'] },
  { group: 'Delivery', tags: ['whispers', 'softly', 'slowly', 'firmly'] },
  { group: 'Sounds', tags: ['sighs', 'exhales', 'chuckles', 'laughs', 'clears throat'] },
];

/** The tags in a line, in order, as typed. */
export const tagsOf = (text) => [...String(text || '').matchAll(TAG_MARK)].map((m) => m[1].trim());

/** The line without its tags: what the script and the subtitles keep. */
export const stripTags = (text) =>
  String(text || '')
    .replace(TAG_MARK, ' ')
    .replace(/\s+([,.!?;:…।])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

/**
 * What is wrong with the brackets in a line, for the retake window to show:
 * `foreign`, the insides of brackets that are not English tags (the voice may
 * read them aloud), and `unclosed`, whether a `[` is never closed.
 */
export const tagProblems = (text) => {
  const s = String(text || '').replace(/\[pause\s+\d+(?:\.\d+)?\s*s\]/gi, ' ');
  const foreign = [...s.matchAll(/\[([^\]\[\n]*)\]/g)].map((m) => m[1].trim()).filter((name) => name && !isTagName(name));
  let depth = 0;
  let unclosed = false;
  for (const ch of s) {
    if (ch === '[') {
      if (depth > 0) unclosed = true;
      depth = 1;
    } else if (ch === ']') depth = 0;
  }
  return { foreign, unclosed: unclosed || depth > 0 };
};
