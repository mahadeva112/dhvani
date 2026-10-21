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
- Example of the approach (English, then natural Hindi and Bengali):
  English: "Today, if you say you are a spiritual person, people think you need an investigation."
  Not this (literal): "आज, यदि आप कहते हैं कि आप एक आध्यात्मिक व्यक्ति हैं, लोग सोचते हैं कि आपको एक जाँच की ज़रूरत है।"
  This: "और आज, अगर आप कहें कि आप आध्यात्मिक इंसान हैं, तो लोग सोचते हैं कि आपकी जाँच होनी चाहिए!"
  This (Bengali): "আর আজ, আপনি যদি বলেন যে আপনি আধ্যাত্মিক মানুষ, তবে লোকে মনে করে আপনার ওপর তদন্ত চালানো দরকার!"
  English: "not with a sword or any kind of weapon, but simply out of their consciousness."
  This (Hindi): "किसी तलवार या हथियार के बल पर नहीं, बल्कि सिर्फ़ अपनी चेतना से।"
  This (Bengali): "কোনো তলোয়ার বা অস্ত্রের জোরে নয়, বরং স্রেফ তাঁদের চেতনার ক্ষমতায়।"
  The joke lands, the emphasis stays, and nothing in it sounds translated.

2. HIS WAY OF SPEAKING
- He speaks in thought units and pause-driven fragments, not textbook sentences. Keep his breaks: a pause before a punchline, after a deep question, before a contradiction ("No...").
- A provocative line stays sharp, a calm one stays calm, humour keeps its setup and its landing. A line that lands on a point ends on its key word.
- Keep the order of his thoughts. Never flip cause and effect or swap the halves of an idea to read smoother.
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
- "," between chunks of one sentence; "..." only for a real hesitation inside a thought, never inside a line he said in one breath.
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
- Example of the approach: "people think you need an investigation" is not "लोग सोचते हैं कि आपको एक जाँच की ज़रूरत है" but "लोग सोचते हैं कि आपकी जाँच होनी चाहिए!"; in Bengali "লোকে মনে করে আপনার ওপর তদন্ত চালানো দরকার!".

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
Translate each dialogue cue into the target language adhering strictly to custom style instructions, vocabulary rules, and natural speaking rhythm.`
  }
];

export const QUICK_PROMPT_TAGS = [
  { label: 'Keep tech terms in English', tag: '\n- Retain modern technical, digital, and brand names in English script or standard loanword transliteration.' },
  { label: 'Short & punchy sentences', tag: '\n- Keep translated sentences short, punchy, and easy to speak in quick succession.' },
  { label: 'Respectful formal tone', tag: '\n- Use respectful, formal honorifics and polite verb conjugations throughout.' },
  { label: 'Casual everyday slang', tag: '\n- Use modern, conversational colloquial phrasing popular with younger audiences.' },
  { label: 'Match exact speech duration', tag: '\n- Calibrate syllable count carefully to match the timing window of each dialogue cue.' },
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

/**
 * A saved style (the app's or a project's) as it reads today. A style that has
 * since been removed comes back as the default, with the default's prompt, so
 * nobody is left translating with a prompt the style list no longer shows.
 * Custom instructions and the styles still listed are kept as saved.
 */
export const currentPromptChoice = (presetId: string | null | undefined, prompt: string | null | undefined) => {
  const known = TRANSLATION_PRESETS.some((p) => p.id === presetId);
  if (presetId && known) return { presetId, prompt: prompt || getPresetById(presetId).prompt };
  return { presetId: DEFAULT_PROMPT_PRESET_ID, prompt: getPresetById(DEFAULT_PROMPT_PRESET_ID).prompt };
};
