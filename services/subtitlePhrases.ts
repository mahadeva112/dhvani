/**
 * DHVANI's own phrase rules for Hindi and Bengali subtitles, on top of the
 * Srutilekha tables (subtitleGrammarData.ts, which stay generated and
 * untouched).
 *
 * Dub text often has no danda or comma, and a TTS read has almost no pauses,
 * so the splitter's only clue is the words themselves. These lists say which
 * words belong with the word after them (एक खास, किसी होटल, अच्छी तरह), which
 * complete the word before them (रख दें, के बाद, यहां तक कि), and which finite
 * verbs close a clause (है, होगा, चाहिए, दिखेगा), since Hindi and Bengali put
 * the verb last.
 *
 * Checked on a real Hindi dub (2026-11-27): without these, cuts landed inside
 * "रख | दें", "के | बाद", "यहां तक | कि" and joined "सोते हैं तो हमारे ऊर्जा".
 */

/** Complete the word before them. */
export const EXTRA_BIND_BACK: readonly string[] = [
  // Hindi light verbs and compound-verb parts: रख दें, कर लें, छोड़ दिया.
  'दें', 'दे', 'दीजिए', 'दिया', 'दी', 'दिए', 'लें', 'लीजिए', 'लिया', 'ली',
  // के बाद, अच्छी तरह, यहां तक कि, समेट कर.
  'बाद', 'तरह', 'कि', 'कर',
  // Bengali: করে দাও, নিয়ে নাও.
  'দাও', 'দিন', 'দিয়েছে', 'নাও', 'নিন',
];

/** Read as opening the next phrase, never as finishing the one before. */
export const NOT_BIND_BACK: readonly string[] = [
  // Hindi "तो" is "then" and opens the clause after it (the table's entry is
  // Urdu "تو" spelt in Devanagari). Bengali emphatic "তো" stays as it was.
  'तो',
];

/** Belong with the word after them: determiners, possessives, quantifiers, clause openers. */
export const EXTRA_BIND_FWD: readonly string[] = [
  // Hindi
  'तो', 'वरना', 'एक', 'किसी', 'कोई', 'हर', 'प्रत्येक', 'हमारे', 'हमारा', 'हमारी',
  'आपके', 'आपका', 'आपकी', 'मेरे', 'मेरा', 'मेरी', 'तुम्हारे', 'तुम्हारा', 'तुम्हारी',
  'उसके', 'उसका', 'उसकी', 'इसके', 'इसका', 'इसकी', 'उनके', 'उनका', 'उनकी', 'इनके', 'इनका', 'इनकी',
  'अपने', 'अपना', 'अपनी', 'उस', 'इस', 'उन', 'इन', 'कुछ', 'सभी', 'कई', 'अच्छी',
  'ऐसी', 'ऐसा', 'वैसी', 'वैसा', 'थोड़ी', 'थोड़ा', 'पूरी', 'पूरा', 'पूरे',
  // Bengali
  'এক', 'একটা', 'একটি', 'কোনো', 'কোনও', 'প্রতি', 'প্রত্যেক', 'আমাদের', 'আমার', 'আপনার',
  'তোমার', 'তাদের', 'ওদের', 'এদের', 'তার', 'এর', 'এই', 'ওই', 'সেই', 'সব', 'সমস্ত', 'অনেক',
  'কিছু', 'খুব', 'নাহলে', 'তাহলে',
];

/** Listed as clause openers by the tables, but here they finish the phrase before. */
export const NOT_BIND_FWD: readonly string[] = ['कि'];

/**
 * Finite verbs that end a Hindi or Bengali clause. A cue closes after one when
 * the next word does not complete it (है → "जाती है | ऐसे में", but "हो गया है").
 */
export const FINITE_VERBS: readonly string[] = [
  // Hindi auxiliaries and modals
  'है', 'हैं', 'था', 'थे', 'थी', 'थीं', 'हूं', 'हूँ', 'होगा', 'होगी', 'होंगे', 'होंगी', 'चाहिए',
  // Hindi subjunctive / imperative light verbs
  'दें', 'दीजिए', 'लें', 'लीजिए',
  // Bengali
  'আছে', 'আছেন', 'আছি', 'ছিল', 'ছিলো', 'ছিলেন', 'ছিলাম', 'হবে', 'হবেন', 'হয়', 'হলো', 'হল',
  'যায়', 'যাবে', 'পারে', 'পারেন', 'পারি', 'উচিত',
];

/** Endings of finite verbs (future and progressive/perfect forms), checked on the whole word. */
export const FINITE_ENDINGS: readonly string[] = [
  // Hindi future: दिखेगा, जाएगा, करेंगे, होओगे
  'ेगा', 'ेगी', 'ेंगे', 'ेंगी', 'एगा', 'एगी', 'एंगे', 'एँगे', 'ोगे', 'ोगी', 'ूंगा', 'ूँगा', 'ूंगी', 'ूँगी',
  // Bengali progressive / perfect: করছে, করেছে, করেছিল
  'চ্ছে', 'চ্ছেন', 'চ্ছি', 'েছে', 'েছেন', 'েছি', 'েছিল', 'েছিলেন', 'েছিলাম',
];
