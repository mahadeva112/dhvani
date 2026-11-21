/**
 * Bookish words a dub voice should not say: words of written or classical
 * language that people rarely say aloud, each with what a speaker says
 * instead. A translation that has one is sent back once to say it the spoken
 * way (refineBatch in providers/gemini/translation.js), and the list is shown
 * to the model up front too (translationExamples.js).
 *
 * Only words that are bookish in nearly every talk are listed. Words a
 * careful speaker does say aloud (Hindi स्पष्ट, प्रक्रिया, संदेह, जिज्ञासा,
 * नश्वर) are not, nor is a spiritual term the speaker means as one (mukti,
 * sadhana): those are the translation style's call.
 */

/** By language: `{ word, forms?, say }`, `forms` being other spellings of the same word. */
export const BOOKISH_WORDS = {
  Hindi: [
    { word: 'नश्वरता', say: 'कि हम नश्वर हैं / कि हम मरने वाले हैं' },
    { word: 'असहायता', say: 'कि वो कुछ कर नहीं सकता' },
    { word: 'संशय', say: 'शक / संदेह' },
    { word: 'समयबद्ध', say: 'समय सीमित है' },
    { word: 'व्यवस्थित', say: 'ढंग से / सलीके से' },
    { word: 'यदि', say: 'अगर' },
    { word: 'केवल', say: 'सिर्फ़ / बस' },
    { word: 'किंतु', forms: ['किन्तु'], say: 'लेकिन / पर' },
    { word: 'परंतु', forms: ['परन्तु'], say: 'लेकिन / पर' },
    { word: 'अतः', say: 'इसलिए' },
    { word: 'तथा', say: 'और' },
    { word: 'संभवतः', forms: ['सम्भवतः'], say: 'शायद' },
    { word: 'अत्यंत', forms: ['अत्यन्त'], say: 'बहुत' },
    { word: 'सदैव', say: 'हमेशा' },
    { word: 'सर्वदा', say: 'हमेशा' },
    { word: 'पश्चात', forms: ['पश्चात्'], say: 'बाद' },
    { word: 'उपरांत', forms: ['उपरान्त'], say: 'बाद' },
    { word: 'प्रत्येक', say: 'हर' },
    { word: 'प्रारंभ', forms: ['प्रारम्भ'], say: 'शुरू' },
    { word: 'हेतु', say: 'के लिए' },
    { word: 'अवश्य', say: 'ज़रूर' },
    { word: 'कदापि', say: 'कभी नहीं' },
  ],
};

/** Where one word ends and the next starts, in any script: spaces, punctuation and the danda. */
const BETWEEN_WORDS = /[\s.,;:!?।॥"'“”‘’()[\]{}…—–-]+/u;

/** The bookish words `text` says, in `language`, each once: `{ word, said, say }`, `said` the spelling found. */
export const bookishWordsIn = (text, language) => {
  const list = BOOKISH_WORDS[language];
  if (!list || !text) return [];
  const tokens = new Set(String(text).split(BETWEEN_WORDS).filter(Boolean));
  const found = [];
  for (const entry of list) {
    const said = [entry.word, ...(entry.forms || [])].find((form) => tokens.has(form));
    if (said) found.push({ word: entry.word, said, say: entry.say });
  }
  return found;
};

/** The list as one line for a prompt ("नश्वरता → कि हम नश्वर हैं, …"), or '' for a language without one. */
export const bookishLine = (language) => (BOOKISH_WORDS[language] || []).map(({ word, say }) => `${word} → ${say}`).join('; ');
