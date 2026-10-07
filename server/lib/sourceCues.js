/**
 * Delivery cues matched to the source audio ("Match source audio").
 *
 * Enhance emotion on its own (deliveryCues.js) reads only the script, so the
 * model guesses a tone and can add drama the speaker never had. Here the model
 * hears the original speaker instead: each section of the dub script is sent
 * with the stretch of source audio it was translated from, and the model tags
 * the dub where the speaker's own delivery shifts, using the performance score
 * in prompts/Performance_Tags_Prompt.txt (thought function, delivery, pacing,
 * pauses), e.g. "[explaining, calm, slow]" or "[sentence-build pause]".
 *
 * As with deliveryCues.js, the words are guaranteed untouched: every line is
 * checked word for word, tags outside PERFORMANCE_TAGS are dropped, and a line
 * that does not match is voiced as written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../env.js';
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';
import { cutAudioClip } from './media.js';
import { cancelledError } from './http.js';

/**
 * The performance score's vocabulary. Theatrical tags the prompt warns against
 * ([intense], [authoritative]) and its "[return to anchor]" placeholder are
 * not in it, so they never reach the voice.
 */
export const PERFORMANCE_TAGS = [
  // Thought function
  'reasoning', 'explaining', 'narrating', 'questioning', 'concluding', 'contrasting', 'illustrating',
  // Delivery
  'calm', 'serious', 'playful', 'meditative', 'jovial', 'focused', 'matter of fact', 'firm', 'clear',
  // Pacing and prosody
  'slow', 'fast', 'normal pace', 'accelerating', 'decelerating', 'rising pitch', 'falling pitch',
  'emphasize', 'word-stretch', 'clipped', 'rhythmic', 'flowing',
  // Pauses
  'sentence-build pause', 'audience-think pause', 'dramatic pause', 'sharp pause',
];

const TAG = /\[([^\]\n]{1,120})\]/g;

/**
 * A bracketed tag reduced to its allowed parts in canonical form
 * ("[Explaining,  calm, intense]" → "[explaining, calm]"), or null if none of
 * its parts are allowed.
 */
export const performanceTag = (inner) => {
  const kept = [
    ...new Set(
      String(inner)
        .split(',')
        .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' ').replace(/_/g, ' '))
        .filter((part) => PERFORMANCE_TAGS.includes(part))
    ),
  ];
  return kept.length ? `[${kept.join(', ')}]` : null;
};

/** The words of a text, ignoring tags, punctuation, symbols and spacing. */
const wordsOf = (text) =>
  String(text || '')
    .replace(TAG, ' ')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase();

/**
 * The tagged line if it keeps every word of `original` exactly; otherwise the
 * original. Unknown tags are dropped and spacing is tidied.
 */
export const acceptSourceCues = (original, cued) => {
  if (!cued || typeof cued !== 'string') return original;
  const cleaned = cued
    .replace(TAG, (_, inner) => performanceTag(inner) || '')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
  return wordsOf(cleaned) === wordsOf(original) ? cleaned : original;
};

let framework = null;
const loadFramework = () => {
  if (framework === null) {
    framework = fs.readFileSync(path.join(ROOT_DIR, 'prompts', 'Performance_Tags_Prompt.txt'), 'utf8').trim();
  }
  return framework;
};

export const buildSourceCuePrompt = (lines, language) => `${loadFramework()}

**Output Instructions:**
The audio is the original speaker. The text below is the ${language ? `${language} ` : ''}dub script of the same passage, already translated, one line per subtitle cue in spoken order. Align each line with the matching moment in the audio and insert the performance tags exactly where the speaker's real delivery shifts.
Tag only what you actually hear. If the speaker is even and calm, use few tags. Never add intensity, emotion or pauses that are not in the audio.
You may add "..." where the speaker actually pauses. You must NOT add, remove, reorder, translate or respell any word.
Return exactly ${lines.length} line${lines.length === 1 ? '' : 's'}, one for each line below, in the same order. Output ONLY the tagged lines, with no numbering or commentary.

DUB SCRIPT:
${lines.join('\n')}`;

/** Longest stretch of source audio heard in one request, and most script in it. */
export const SECTION_SECONDS = 90;
export const SECTION_CHARS = 2500;

/** Audio either side of a section, so its first and last words are not clipped. */
const SECTION_PAD_SECONDS = 0.25;

/** Sections tagged at once. */
const CONCURRENCY = 3;

/**
 * Groups cues (in spoken order) into sections of at most SECTION_SECONDS of
 * audio and SECTION_CHARS of script. Cues without text are left out.
 */
export const groupSections = (cues) => {
  const sections = [];
  cues.forEach((cue, index) => {
    if (!String(cue.text || '').trim()) return;
    const last = sections[sections.length - 1];
    if (last && cue.end - last.start <= SECTION_SECONDS && last.chars + cue.text.length <= SECTION_CHARS) {
      last.indexes.push(index);
      last.end = Math.max(last.end, cue.end);
      last.chars += cue.text.length;
    } else {
      sections.push({ indexes: [index], start: cue.start, end: cue.end, chars: cue.text.length });
    }
  });
  return sections;
};

/** The tagged lines for one section, each falling back to its original if it doesn't match. */
const tagSection = async (audioPath, section, lines, { language, apiKey, signal }) => {
  const clip = await cutAudioClip(
    audioPath,
    Math.max(0, section.start - SECTION_PAD_SECONDS),
    section.end + SECTION_PAD_SECONDS,
    { signal }
  );
  const { response } = await generateText({
    contents: {
      role: 'user',
      parts: [{ inlineData: { data: clip.toString('base64'), mimeType: 'audio/mpeg' } }, { text: buildSourceCuePrompt(lines, language) }],
    },
    generationConfig: { temperature: 0.2 },
    apiKey,
  });
  const reply = String(response?.text || '')
    .replace(/^```[a-z]*\n?|```$/gim, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (reply.length !== lines.length) {
    logger.info(`Source cues returned ${reply.length} lines for ${lines.length}; this section is voiced as written.`);
    return { lines, tagged: false };
  }
  const accepted = lines.map((line, i) => acceptSourceCues(line, reply[i]));
  return { lines: accepted, tagged: accepted.some((line, i) => line !== lines[i]) };
};

/**
 * Tags every cue's text to match the source audio at `audioPath`.
 *
 * `cues` are `{ start, end, text }` in seconds, in spoken order. Returns
 * `{ texts, sections, taggedSections }`: `texts[i]` is cue i's text with tags,
 * or as written where the model's answer could not be used.
 */
export const matchSourceDelivery = async (audioPath, cues, { language, apiKey, signal } = {}) => {
  const texts = cues.map((cue) => String(cue.text || ''));
  const sections = groupSections(cues);
  let taggedSections = 0;
  let next = 0;

  const worker = async () => {
    while (next < sections.length) {
      if (signal?.aborted) throw cancelledError('Source cues');
      const section = sections[next++];
      const lines = section.indexes.map((i) => texts[i].trim());
      const result = await tagSection(audioPath, section, lines, { language, apiKey, signal });
      section.indexes.forEach((i, k) => (texts[i] = result.lines[k]));
      if (result.tagged) taggedSections += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sections.length) }, worker));

  return { texts, sections: sections.length, taggedSections };
};
