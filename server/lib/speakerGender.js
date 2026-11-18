/**
 * Who says a line, as the text model needs it: a woman or a man. In Hindi,
 * Marathi, Gujarati, Punjabi, Urdu and many other languages a speaker's
 * words about themself agree with their gender ("मैं गया" / "मैं गई"), and
 * the English never says which. The user sets it per speaker in the Cast;
 * nothing is guessed here. A speaker without one is left as the model reads it.
 */

/** The genders a speaker can be given. */
export const SPEAKER_GENDERS = ['woman', 'man'];

/** `{ speaker name: 'woman' | 'man' }` from a request, anything else dropped. */
export const cleanSpeakerGenders = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([speaker, gender]) => typeof speaker === 'string' && speaker.length <= 128 && SPEAKER_GENDERS.includes(gender))
      .slice(0, 64)
  );
};

/** The gender of the speaker of `cue`, or undefined. */
export const genderOfCue = (cue, genders) => {
  const speaker = cue?.speaker || 'Speaker';
  return genders && Object.hasOwn(genders, speaker) ? genders[speaker] : undefined;
};

/** The field a cue carries in a prompt's JSON when its speaker's gender is known. */
export const speakerField = (cue) => (cue?.speakerIs ? { speaker: cue.speakerIs } : {});

/**
 * The rule that goes with `speakerField`, or '' when no cue has one. Only the
 * speaker's words about themself follow their gender; words about anyone
 * else follow who they are about.
 */
export const speakerGenderRule = (cues, targetLanguage = 'the translation') =>
  cues.some((cue) => cue?.speakerIs)
    ? `
WHO IS SPEAKING
A cue with "speaker": "woman" is said by a woman, "speaker": "man" by a man. Where the speaker talks about themself (I, me, my, myself, and "we" when it means them), every word that agrees with the speaker in ${targetLanguage} (verb endings, participles, adjectives) takes the speaker's gender: a woman says "I went", "I am ready", "I was tired" in the feminine forms, a man in the masculine. Words about anyone else follow who they are about, never the speaker. A cue with no "speaker" keeps the forms it has.
`
    : '';

/** The reviewer's extra problem when genders are known, or ''. */
export const speakerGenderReview = (cues) =>
  cues.some((cue) => cue?.speakerIs)
    ? `\n- the speaker talks about themself in the wrong gender: a cue with "speaker": "woman" uses masculine forms for the speaker's own "I" (or "man" uses feminine), in a language whose verbs or adjectives show it;`
    : '';

/** Below this the model's answer is shown as "not sure", never as a pick. */
export const HEARD_SURE_ENOUGH = 0.6;

/**
 * The prompt for hearing one speaker's clip: a man's voice or a woman's. A
 * child, a voice that could be either, or noise is "unsure"; the answer is
 * only ever a suggestion the user accepts in the Cast.
 */
export const HEAR_SPEAKER_PROMPT = `Listen to this clip. It is one person speaking (a few of their lines joined).

Does this voice sound like an adult man's or an adult woman's?
- Answer "unsure" for a child, a voice that could be either, music or noise over the voice, or more than one person.
- Judge only the voice, never the words.

Respond with ONLY this JSON:
{"voice":"man" | "woman" | "unsure","sure":<0 to 1, how sure you are>}`;

/**
 * The model's answer as `{ voice: 'man' | 'woman' | null, sure }`. Anything
 * it could not decide, or decided below HEARD_SURE_ENOUGH, is `voice: null`.
 */
export const readHeardVoice = (answer) => {
  const said = String(answer?.voice ?? answer?.gender ?? '').trim().toLowerCase();
  const voice = ['man', 'male'].includes(said) ? 'man' : ['woman', 'female'].includes(said) ? 'woman' : null;
  const raw = Number(answer?.sure ?? answer?.confidence);
  const sure = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw > 1 && raw <= 100 ? raw / 100 : raw)) : voice ? HEARD_SURE_ENOUGH : 0;
  return { voice: voice && sure >= HEARD_SURE_ENOUGH ? voice : null, sure: Math.round(sure * 100) / 100 };
};
