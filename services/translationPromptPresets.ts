export interface TranslationPromptPreset {
  id: string;
  name: string;
  shortDesc: string;
  badge: string;
  category: 'persona' | 'style' | 'tone';
  prompt: string;
}

export const TRANSLATION_PRESETS: TranslationPromptPreset[] = [
  {
    id: 'sadhguru_spoken',
    name: 'Sadhguru',
    shortDesc: 'Meaning first, never word for word: each sentence said the way a native speaker would, split across the lines by their time',
    badge: 'Recommended',
    category: 'persona',
    // A style directive for the one-pass translation (server/providers/gemini/translation.js),
    // which already sends the rules for splitting a sentence over its cues and
    // each cue's syllable budget. This says how Sadhguru's speech is carried over.
    prompt: `ROLE: You write the dubbing script for a talk by Sadhguru (and anyone who speaks or asks questions with him). A voice artist speaks each line over the original video, so it must sound like Sadhguru talking in this language, not like a translated text.

1. MEANING, NEVER WORD FOR WORD
- First understand what the whole sentence says and why he says it. Then say that the way a native speaker of the language would say it out loud. Never copy the English word order or sentence shape.
- Where an English word is broad, pick the specific word this context needs. Carry the relation, not the connective: "Because X, Y" can become "X, that is why Y" when that is how the language says it.
- English idioms and turns of phrase become the language's own expression for the same idea, never a word-for-word copy.
- Where the translation rules that follow give examples in the language you are writing, follow their approach.

2. HIS WAY OF SPEAKING
- He speaks in thought units and short spoken fragments, not textbook sentences: keep that shape. Where he really stopped inside a line, the line already marks it with "‖" and the pause rules say how to keep it. Never add a pause he did not make: no "…" and no extra comma for one.
- A provocative line stays sharp, a calm one stays calm, humour keeps its setup and its landing. A line that lands on a point ends on its key word.
- Keep the order of his thoughts from one sentence to the next, and never flip cause and effect. Inside a sentence, use the language's own word order: the verb, a "which / that" part and words like "only" and "even" go where the language puts them, even when that moves a word into the next or previous cue.
- Questions stay short and spoken. A quotation keeps its speaker: put quoted words or an inner thought in double quotes, with the "said / asked / thought" verb where the language naturally puts it.

3. NOTHING DROPPED, NOTHING ADDED
- Keep every idea, example, condition, negation, comparison, number and name, and the exact certainty: "may" stays "may", "some" stays "some", "known to be" is not "people think", "pain" is not "suffering".
- Keep each word's exact sense in every language, even when a shorter word is tempting. Find the word of this language that means the same thing, not a near one:
  - never a narrower or broader word: "emperors" are not "kings", "men" are not "people", "civilization" is not "culture", "revered" is not "worshipped";
  - never a word of another kind: when he speaks of "beings" beyond the human, they are neither "people" nor "creatures" or "animals" (Hindi सत्ता, Bengali সত্তা: use your language's word for an existence or entity);
  - keep both words of a pair he uses on purpose ("controlled and ruled", "guided and nurtured"), not one for both.
- Keep deliberate repetition and the distinctions he draws, with the same word each time.
- Never add "not", "only", "even", "never", an explanation or a stronger claim.

4. WORDS
- Everyday spoken forms, not bookish or officialese ones; respectful forms for the people he speaks about with respect.
- Use the classical spiritual word where the idea calls for it (mukti, sadhana, chitta), and keep the English words the audience itself says in English (internet, hospital, meditation app).

5. MARKS FOR THE VOICE
- "," between chunks of one sentence; "…" only for a real hesitation inside a thought, never inside a line he said in one breath.
- " - " before an aside, a list or the phrase that completes what came just before.
- "!" where a point lands sharply.

6. SHORT ON TIME
- Indian languages take longer to say than English. When a line's syllable budget is tight, say the same thing in fewer syllables: shorter common words, a leaner sentence, dropping fillers he did not stress ("so", "you know", "actually"), dropping a subject the previous line already set.
- Cut the wrapping, never the point: the idea, the emphasis, the punchline and the negation always stay, and no word becomes a different one.`
  },
  {
    id: 'natural_spoken',
    name: 'Natural Spoken',
    shortDesc: 'The same meaning-first, time-aware dubbing for any speaker: interviews, guests, documentaries',
    badge: 'Any speaker',
    category: 'style',
    prompt: `ROLE: You write the dubbing script for this video. A voice artist speaks each line over the original, so it must sound like this person talking in this language, not like a translated text.

1. MEANING, NEVER WORD FOR WORD
- First understand what the whole sentence says and why. Then say it the way a native speaker would say it out loud. Never copy the English word order or sentence shape.
- English idioms become the language's own expression for the same idea. Where an English word is broad, pick the specific word this context needs.
- Inside a sentence, use the language's own word order, even when that moves a word into the next or previous cue. Where the translation rules that follow give examples in the language you are writing, follow their approach.

2. THE SPEAKER'S OWN VOICE
- Keep each speaker's register: a casual speaker stays casual, a formal one formal, a joke keeps its setup and its landing, an emotional moment keeps its weight.
- Keep their rhythm: short bursts stay short, a restarted or trailing sentence stays that way.
- Questions stay questions, quotations keep their speaker.

3. NOTHING DROPPED, NOTHING ADDED
- Keep every idea, condition, negation, comparison, number and name, and the exact certainty ("may" stays "may").
- Keep each word's exact sense: find the word of this language that means the same thing, never a narrower, broader or different kind of word ("emperors" are not "kings", "beings" are not "people"), and keep both words of a deliberate pair.
- Add no explanation and no idea the speaker did not say.

4. WORDS
- Everyday spoken forms, not bookish ones. Keep the English words people of this language normally say in English. Proper nouns, brands and technical terms stay as they are known.

5. SHORT ON TIME
- Indian languages take longer to say than English. When a line's syllable budget is tight, say the same thing in fewer syllables: shorter common words, a leaner sentence, dropping fillers the speaker did not stress, dropping a subject the previous line already set.
- Cut the wrapping, never the point, and never swap a word for a shorter one that means something else.`
  },
  {
    id: 'custom',
    name: 'Custom Instructions',
    shortDesc: 'Custom prompt with your own rules, terminology glossary, tone, or constraints',
    badge: 'Custom',
    category: 'persona',
    prompt: `You are an expert audio dubbing translator and dialogue adapter.
Translate each dialogue cue into the target language in the tone, vocabulary and speaking rhythm set out below, as natural spoken language.`
  }
];

export const QUICK_PROMPT_TAGS = [
  { label: 'Keep tech terms in English', tag: '\n- Retain modern technical, digital, and brand names in English script or standard loanword transliteration.' },
  { label: 'Short & punchy sentences', tag: '\n- Prefer short, punchy spoken sentences that are easy to say in quick succession, but never drop an idea, a negation, a number or a name to make a line shorter.' },
  { label: 'Respectful tone', tag: '\n- Use the respectful form of "you" and its polite verb forms throughout, in everyday spoken words, never bookish or officialese ones.' },
  { label: 'Casual everyday slang', tag: '\n- Use modern, conversational colloquial phrasing popular with younger audiences.' },
  { label: 'Fit each line to its time', tag: '\n- Keep each line close to its syllable budget through word choice, never at the cost of meaning: a clear line a little long is better than one that leaves something out.' },
  { label: 'Sanskrit/Spiritual vocabulary', tag: '\n- Use classical spiritual equivalents for philosophical concepts (Mukti, Divya, Chitta, Chetana).' },
];

/**
 * The style a translation uses until the user picks another. Only a pick made
 * in the prompt dialog is saved, so anyone who never chose one follows this.
 */
export const DEFAULT_PROMPT_PRESET_ID = 'sadhguru_spoken';

export const getPresetById = (id: string): TranslationPromptPreset => {
  return (
    TRANSLATION_PRESETS.find((p) => p.id === id) ||
    TRANSLATION_PRESETS.find((p) => p.id === DEFAULT_PROMPT_PRESET_ID)!
  );
};

/** Ids of prompts the user saved under their own names (services/savedTranslationPrompts.ts). */
export const SAVED_PROMPT_ID_PREFIX = 'my_';

/** A short fingerprint of a prompt's text (32-bit FNV-1a), to recognise an old version without keeping its text. */
export const promptFingerprint = (prompt: string) => {
  let hash = 0x811c9dc5;
  const text = prompt.trim();
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Fingerprints of each style's earlier texts. A project or a browser that
 * saved one of these saved the style as the app wrote it, not an edit of its
 * own, so it moves to the style's text of today. Add the old fingerprint here
 * whenever a style's text changes.
 */
export const EARLIER_TEXTS: Record<string, string[]> = {
  sadhguru_spoken: ['bec608bf', '4ed0d984'],
  natural_spoken: ['69f648d4'],
};

/**
 * A saved style (the app's or a project's) as it reads today. A style that has
 * since been removed comes back as the default, with the default's prompt, so
 * nobody is left translating with a prompt the style list no longer shows.
 * A listed style saved with one of its earlier texts gets its text of today.
 * Custom instructions, the user's own named prompts and edited styles are kept
 * as saved: no update ever replaces them.
 */
export const currentPromptChoice = (presetId: string | null | undefined, prompt: string | null | undefined) => {
  if (presetId?.startsWith(SAVED_PROMPT_ID_PREFIX) && prompt) return { presetId, prompt };
  const known = TRANSLATION_PRESETS.some((p) => p.id === presetId);
  if (presetId && known) {
    const outdated = Boolean(prompt) && (EARLIER_TEXTS[presetId] || []).includes(promptFingerprint(prompt!));
    return { presetId, prompt: !prompt || outdated ? getPresetById(presetId).prompt : prompt };
  }
  return { presetId: DEFAULT_PROMPT_PRESET_ID, prompt: getPresetById(DEFAULT_PROMPT_PRESET_ID).prompt };
};
