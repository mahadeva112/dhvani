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

/**
 * By language: `{ word, forms?, say }`, `forms` being other spellings of the same word.
 * Hindi came from the user's corrections; the other eleven (2026-11-22) are
 * first drafts of the plainest cases (written connectives, Bengali sadhu
 * forms, written Tamil/Kannada endings), to be grown or trimmed from native
 * speakers' corrections. Words match whole, so another ending is another entry.
 */
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
    { word: 'एवं', say: 'और' },
    { word: 'अथवा', say: 'या' },
    { word: 'अपितु', say: 'बल्कि' },
    { word: 'इत्यादि', say: 'वगैरह' },
    { word: 'तत्पश्चात', forms: ['तत्पश्चात्'], say: 'उसके बाद' },
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
  Bengali: [
    // Sadhu bhasha (the written Bengali of old books) and Sanskrit connectives no one says aloud.
    { word: 'নশ্বরতা', forms: ['নশ্বরতার', 'নশ্বরতাকে'], say: 'যে আমরা একদিন মরব' },
    { word: 'তাহার', say: 'তার' },
    { word: 'তাঁহার', say: 'তাঁর' },
    { word: 'তাহারা', say: 'তারা' },
    { word: 'তাহা', say: 'তা / সেটা' },
    { word: 'যাহা', say: 'যা' },
    { word: 'যাহার', say: 'যার' },
    { word: 'ইহা', say: 'এটা' },
    { word: 'উহা', say: 'ওটা' },
    { word: 'করিয়া', say: 'করে' },
    { word: 'হইয়া', say: 'হয়ে' },
    { word: 'করিতে', say: 'করতে' },
    { word: 'হইতে', say: 'থেকে / হতে' },
    { word: 'করিল', say: 'করল' },
    { word: 'হইল', say: 'হল' },
    { word: 'করিবে', say: 'করবে' },
    { word: 'অতএব', say: 'তাই' },
    { word: 'যদ্যপি', say: 'যদিও' },
    { word: 'তথাপি', say: 'তবুও' },
    { word: 'পরন্তু', say: 'কিন্তু' },
    { word: 'সর্বদা', say: 'সবসময়' },
    { word: 'অত্যন্ত', say: 'খুব' },
    { word: 'পুনরায়', say: 'আবার' },
    { word: 'নিকট', say: 'কাছে' },
    { word: 'নিমিত্ত', say: 'জন্য' },
    { word: 'ব্যতীত', say: 'ছাড়া' },
    { word: 'প্রারম্ভ', say: 'শুরু' },
    { word: 'পশ্চাৎ', say: 'পরে' },
    { word: 'অদ্য', say: 'আজ' },
    { word: 'সম্ভবত', say: 'হয়তো' },
  ],
  Assamese: [
    { word: 'নশ্বৰতা', forms: ['নশ্বৰতাৰ'], say: 'যে আমি এদিন মৰিম' },
    { word: 'অতএব', say: 'সেয়েহে' },
    { word: 'যদ্যপি', say: 'যদিও' },
    { word: 'পুনৰ', say: 'আকৌ' },
    { word: 'পুনৰায়', say: 'আকৌ' },
    { word: 'অদ্য', say: 'আজি' },
    { word: 'সৰ্বদা', say: 'সদায়' },
  ],
  Gujarati: [
    { word: 'નશ્વરતા', forms: ['નશ્વરતાનો', 'નશ્વરતાની'], say: 'કે આપણે એક દિવસ મરવાના છીએ' },
    { word: 'યદ્યપિ', say: 'જોકે' },
    { word: 'અતઃ', say: 'એટલે' },
    { word: 'તથા', say: 'અને' },
    { word: 'કિંતુ', forms: ['કિન્તુ'], say: 'પણ' },
    { word: 'પરંતુ', forms: ['પરન્તુ'], say: 'પણ' },
    { word: 'કેવળ', say: 'ફક્ત / બસ' },
    { word: 'સદૈવ', say: 'હંમેશા' },
    { word: 'સર્વદા', say: 'હંમેશા' },
    { word: 'અત્યંત', forms: ['અત્યન્ત'], say: 'બહુ / ખૂબ' },
    { word: 'પશ્ચાત', forms: ['પશ્ચાત્'], say: 'પછી' },
    { word: 'પ્રારંભ', say: 'શરૂઆત' },
  ],
  Marathi: [
    { word: 'नश्वरता', forms: ['नश्वरतेची', 'नश्वरतेचं', 'नश्वरतेचा', 'नश्वरतेला'], say: 'की आपण एक दिवस मरणार आहोत' },
    { word: 'यद्यपि', say: 'जरी' },
    { word: 'अतः', say: 'म्हणून' },
    { word: 'तथा', say: 'आणि' },
    { word: 'तथापि', say: 'तरीही' },
    { word: 'किंतु', forms: ['किन्तु'], say: 'पण' },
    { word: 'परंतु', forms: ['परन्तु'], say: 'पण' },
    { word: 'केवळ', say: 'फक्त' },
    { word: 'सदैव', say: 'नेहमी' },
    { word: 'सर्वदा', say: 'नेहमी' },
    { word: 'अत्यंत', forms: ['अत्यन्त'], say: 'खूप' },
    { word: 'पश्चात', forms: ['पश्चात्'], say: 'नंतर' },
    { word: 'प्रारंभ', forms: ['प्रारम्भ'], say: 'सुरुवात' },
    { word: 'अद्याप', say: 'अजून' },
  ],
  Nepali: [
    { word: 'नश्वरता', forms: ['नश्वरताको'], say: 'कि हामी एक दिन मर्छौं' },
    { word: 'यदि', say: 'drop it and end the clause with भने' },
    { word: 'अतः', say: 'त्यसैले' },
    { word: 'तथा', say: 'र' },
    { word: 'तथापि', say: 'तैपनि' },
    { word: 'किन्तु', forms: ['किंतु'], say: 'तर' },
    { word: 'परन्तु', forms: ['परंतु'], say: 'तर' },
    { word: 'केवल', say: 'मात्र / खाली' },
    { word: 'सदैव', say: 'सधैं' },
    { word: 'अत्यन्त', forms: ['अत्यंत'], say: 'धेरै / एकदमै' },
    { word: 'पश्चात्', forms: ['पश्चात'], say: 'पछि' },
    { word: 'प्रारम्भ', forms: ['प्रारंभ'], say: 'सुरु' },
    { word: 'हेतु', say: 'लागि' },
    { word: 'मानिसहरू', forms: ['मानिस'], say: 'मान्छे / मान्छेहरू' },
  ],
  Odia: [
    { word: 'ନଶ୍ୱରତା', forms: ['ନଶ୍ୱରତାର'], say: 'ଯେ ଆମେ ଦିନେ ମରିବା' },
    { word: 'ଯଦ୍ୟପି', say: 'ଯଦିଓ' },
    { word: 'ଅତଏବ', say: 'ତେଣୁ' },
    { word: 'ସର୍ବଦା', say: 'ସବୁବେଳେ' },
    { word: 'ଅତ୍ୟନ୍ତ', say: 'ବହୁତ' },
    { word: 'ପୁନର୍ବାର', say: 'ପୁଣି' },
    { word: 'ପଶ୍ଚାତ୍', forms: ['ପଶ୍ଚାତ'], say: 'ପରେ' },
  ],
  Punjabi: [
    { word: 'ਕਿੰਤੂ', forms: ['ਕਿੰਤੁ'], say: 'ਪਰ' },
    { word: 'ਪਰੰਤੂ', forms: ['ਪਰੰਤੁ'], say: 'ਪਰ' },
    { word: 'ਕੇਵਲ', say: 'ਸਿਰਫ਼ / ਬੱਸ' },
    { word: 'ਸਦੈਵ', say: 'ਹਮੇਸ਼ਾ' },
    { word: 'ਅਤਿਅੰਤ', say: 'ਬਹੁਤ' },
    { word: 'ਉਪਰੰਤ', say: 'ਬਾਅਦ' },
    { word: 'ਪ੍ਰਾਰੰਭ', say: 'ਸ਼ੁਰੂ' },
    { word: 'ਹੇਤੂ', say: 'ਲਈ' },
    { word: 'ਵਿਅਕਤੀ', say: 'ਬੰਦਾ / ਇਨਸਾਨ' },
  ],
  Tamil: [
    // Written Tamil forms; a dub says the spoken ones.
    { word: 'நீங்கள்', say: 'நீங்க' },
    { word: 'உங்கள்', say: 'உங்க' },
    { word: 'அவர்கள்', say: 'அவங்க' },
    { word: 'இருக்கிறது', say: 'இருக்கு' },
    { word: 'இல்லை', say: 'இல்ல' },
    { word: 'இன்று', say: 'இன்னைக்கு' },
    { word: 'ஆனால்', say: 'ஆனா' },
    { word: 'ஏனெனில்', say: 'ஏன்னா' },
    { word: 'எனவே', say: 'அதனால' },
    { word: 'ஆகவே', say: 'அதனால' },
    { word: 'மிகவும்', say: 'ரொம்ப' },
    { word: 'சொன்னால்', say: 'சொன்னா' },
    { word: 'வேண்டும்', say: 'வேணும்' },
  ],
  Telugu: [
    { word: 'మరియు', say: 'drop it, or ఇంకా' },
    { word: 'కావున', say: 'కాబట్టి' },
    { word: 'అనగా', say: 'అంటే' },
    { word: 'ఎందుకనగా', say: 'ఎందుకంటే' },
    { word: 'అత్యంత', say: 'చాలా' },
    { word: 'సర్వదా', say: 'ఎప్పుడూ' },
    { word: 'పునః', say: 'మళ్ళీ' },
    { word: 'ప్రజలు', say: 'జనం / మనుషులు' },
  ],
  Kannada: [
    // Written Kannada forms; a dub says the spoken ones.
    { word: 'ಎಂದು', say: 'ಅಂತ' },
    { word: 'ಆದರೆ', say: 'ಆದ್ರೆ' },
    { word: 'ಏಕೆಂದರೆ', say: 'ಯಾಕಂದ್ರೆ' },
    { word: 'ಆದ್ದರಿಂದ', say: 'ಅದಕ್ಕೆ' },
    { word: 'ಆಗುತ್ತದೆ', say: 'ಆಗುತ್ತೆ' },
    { word: 'ಇರುತ್ತದೆ', say: 'ಇರುತ್ತೆ' },
    { word: 'ಮಾಡುತ್ತದೆ', say: 'ಮಾಡುತ್ತೆ' },
    { word: 'ಬದಲಾಗುತ್ತದೆ', say: 'ಬದಲಾಗುತ್ತೆ' },
    { word: 'ಹೇಳಿದರೆ', say: 'ಹೇಳಿದ್ರೆ' },
    { word: 'ಕುಳಿತರೆ', say: 'ಕೂತ್ರೆ' },
    { word: 'ಕೇವಲ', say: 'ಬರೀ' },
  ],
  Malayalam: [
    { word: 'അതിനാൽ', say: 'അതുകൊണ്ട്' },
    { word: 'എന്തെന്നാൽ', say: 'കാരണം' },
    { word: 'എന്നാൽ', say: 'പക്ഷേ' },
    { word: 'സദാ', say: 'എപ്പോഴും' },
    { word: 'അത്യന്തം', say: 'വളരെ / ഒരുപാട്' },
    { word: 'പുനഃ', say: 'വീണ്ടും' },
    { word: 'പറയുകയാണെങ്കിൽ', say: 'പറഞ്ഞാൽ' },
    { word: 'ചെയ്യുകയാണെങ്കിൽ', say: 'ചെയ്താൽ' },
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
