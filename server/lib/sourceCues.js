/**
 * Delivery cues matched to the source audio (voice expression "Natural").
 *
 * Voice expression "Expressive" (deliveryCues.js) reads only the script, so the
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
import { PERFORMANCE_TAGS, acceptSourceCues, groupSections, SECTION_PAD_SECONDS } from './sourceSections.js';

export { PERFORMANCE_TAGS, performanceTag, acceptSourceCues, groupSections, SECTION_SECONDS, SECTION_CHARS } from './sourceSections.js';

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
The dub must sound calm, grounded and consistent, in the speaker's own natural voice: no dramatic expression, exaggerated emotion, theatrical intonation or sudden changes in pitch, loudness or energy. Use only these tags: ${PERFORMANCE_TAGS.map((t) => `[${t}]`).join(' ')}.
You may add "..." where the speaker actually pauses. You must NOT add, remove, reorder, translate or respell any word.
Return exactly ${lines.length} line${lines.length === 1 ? '' : 's'}, one for each line below, in the same order. Output ONLY the tagged lines, with no numbering or commentary.

DUB SCRIPT:
${lines.join('\n')}`;

/** Sections tagged at once. */
const CONCURRENCY = 3;

/**
 * The tagged lines for one clip of the source (mp3), each falling back to its
 * original if it doesn't match. `tagged` says whether any line got tags.
 */
export const tagClip = async (clip, lines, { language, apiKey }) => {
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

/** The tagged lines for one section of the source audio at `audioPath`. */
const tagSection = async (audioPath, section, lines, { language, apiKey, signal }) => {
  const clip = await cutAudioClip(
    audioPath,
    Math.max(0, section.start - SECTION_PAD_SECONDS),
    section.end + SECTION_PAD_SECONDS,
    { signal }
  );
  return tagClip(clip, lines, { language, apiKey });
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
