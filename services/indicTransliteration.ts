/**
 * Indian Languages Phonetic Transliteration Engine & Virtual Keyboard Data
 * Supports: Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi, Odia, Urdu, Sanskrit
 */

export interface IndicLanguageConfig {
  code: string;
  name: string;
  nativeName: string;
  itcCode: string; // Google Input Tools Code (e.g., 'hi-t-i0-und')
  script: string;
  purnaViram?: string;
  om?: string;
}

export const INDIC_LANGUAGES: Record<string, IndicLanguageConfig> = {
  Hindi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    itcCode: 'hi-t-i0-und',
    script: 'Devanagari',
    purnaViram: '।',
    om: 'ॐ',
  },
  Bengali: {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    itcCode: 'bn-t-i0-und',
    script: 'Bengali',
    purnaViram: '।',
    om: 'ੴ',
  },
  Tamil: {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    itcCode: 'ta-t-i0-und',
    script: 'Tamil',
    purnaViram: '.',
    om: 'ௐ',
  },
  Telugu: {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    itcCode: 'te-t-i0-und',
    script: 'Telugu',
    purnaViram: '।',
    om: 'ఓం',
  },
  Marathi: {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    itcCode: 'mr-t-i0-und',
    script: 'Devanagari',
    purnaViram: '।',
    om: 'ॐ',
  },
  Gujarati: {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    itcCode: 'gu-t-i0-und',
    script: 'Gujarati',
    purnaViram: '।',
    om: 'ૐ',
  },
  Kannada: {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    itcCode: 'kn-t-i0-und',
    script: 'Kannada',
    purnaViram: '।',
    om: 'ಓಂ',
  },
  Malayalam: {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    itcCode: 'ml-t-i0-und',
    script: 'Malayalam',
    purnaViram: '.',
    om: 'ഓം',
  },
  Punjabi: {
    code: 'pa',
    name: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    itcCode: 'pa-t-i0-und',
    script: 'Gurmukhi',
    purnaViram: '।',
    om: 'ੴ',
  },
  Odia: {
    code: 'or',
    name: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    itcCode: 'or-t-i0-und',
    script: 'Odia',
    purnaViram: '।',
    om: 'ଓଁ',
  },
  Urdu: {
    code: 'ur',
    name: 'Urdu',
    nativeName: 'اردو',
    itcCode: 'ur-t-i0-und',
    script: 'Arabic-Persian',
    purnaViram: '۔',
  },
  Sanskrit: {
    code: 'sa',
    name: 'Sanskrit',
    nativeName: 'संस्कृतम्',
    itcCode: 'sa-t-i0-und',
    script: 'Devanagari',
    purnaViram: '।',
    om: 'ॐ',
  },
  Nepali: {
    code: 'ne',
    name: 'Nepali',
    nativeName: 'नेपाली',
    itcCode: 'ne-t-i0-und',
    script: 'Devanagari',
    purnaViram: '।',
    om: 'ॐ',
  },
  Assamese: {
    code: 'as',
    name: 'Assamese',
    nativeName: 'অসমীয়া',
    itcCode: 'as-t-i0-und',
    script: 'Bengali',
    purnaViram: '।',
    om: 'ॐ',
  },
};

/**
 * Resolves a language string (e.g. 'Hindi', 'hi', 'Bengali (বাংলা)', 'ta') to its IndicLanguageConfig
 */
export function getIndicLanguageConfig(langNameOrCode: string = ''): IndicLanguageConfig {
  if (!langNameOrCode) return INDIC_LANGUAGES.Hindi;
  
  if (INDIC_LANGUAGES[langNameOrCode]) {
    return INDIC_LANGUAGES[langNameOrCode];
  }

  const lower = langNameOrCode.toLowerCase().trim();

  // Match by code or name
  for (const [key, config] of Object.entries(INDIC_LANGUAGES)) {
    if (
      lower === config.code.toLowerCase() ||
      lower === key.toLowerCase() ||
      lower.includes(key.toLowerCase()) ||
      lower.includes(config.nativeName.toLowerCase()) ||
      lower.includes(config.name.toLowerCase())
    ) {
      return config;
    }
  }

  // Devanagari default
  return INDIC_LANGUAGES.Hindi;
}


// Character Keyboards Data for On-Screen Visual Palette
export interface ScriptPalette {
  vowels: string[];
  matras: string[];
  consonants: string[];
  numbers: string[];
  symbols: string[];
}

export const SCRIPT_PALETTES: Record<string, ScriptPalette> = {
  Devanagari: {
    vowels: ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ऋ', 'ए', 'ऐ', 'ओ', 'औ', 'अं', 'अः'],
    matras: ['ा', 'ि', 'ी', 'ु', 'ू', 'ृ', 'े', 'ै', 'ो', 'ौ', 'ं', 'ः', '्', 'ँ', '़'],
    consonants: [
      'क', 'ख', 'ग', 'घ', 'ङ',
      'च', 'छ', 'ज', 'झ', 'ञ',
      'ट', 'ठ', 'ड', 'ढ', 'ण',
      'त', 'थ', 'द', 'ध', 'न',
      'प', 'फ', 'ब', 'भ', 'म',
      'य', 'र', 'ल', 'व', 'श',
      'ष', 'स', 'ह', 'क्ष', 'त्र', 'ज्ञ', 'श्र'
    ],
    numbers: ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
    symbols: ['।', '॥', 'ॐ', '₹', 'ऽ'],
  },
  Bengali: {
    vowels: ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'ঋ', 'এ', 'ঐ', 'ও', 'ঔ', 'অং', 'অঃ'],
    matras: ['া', 'ি', 'ী', 'ু', 'ূ', 'ৃ', 'ে', 'ৈ', 'ো', 'ৌ', 'ং', 'ঃ', '্', 'ঁ', '়'],
    consonants: [
      'ক', 'খ', 'গ', 'ঘ', 'ঙ',
      'চ', 'ছ', 'জ', 'ঝ', 'ঞ',
      'ট', 'ঠ', 'ড', 'ঢ', 'ণ',
      'ত', 'থ', 'দ', 'ধ', 'ন',
      'প', 'ফ', 'ব', 'ভ', 'ম',
      'য', 'র', 'ল', 'শ', 'ষ', 'স', 'হ', 'ড়', 'ঢ়', 'য়', 'ক্ষ'
    ],
    numbers: ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
    symbols: ['।', '॥', '৳', '₹'],
  },
  Tamil: {
    vowels: ['அ', 'ஆ', 'இ', 'ஈ', 'உ', 'ஊ', 'எ', 'ஏ', 'ஐ', 'ஒ', 'ஓ', 'ஔ', 'ஃ'],
    matras: ['ா', 'ி', 'ீ', 'ு', 'ூ', 'ெ', 'ே', 'ை', 'ொ', 'ோ', 'ௌ', '்'],
    consonants: [
      'க', 'ங', 'ச', 'ஞ', 'ட', 'ண', 'த', 'ந', 'ப', 'ம',
      'ய', 'ர', 'ல', 'வ', 'ழ', 'ள', 'ற', 'ன',
      'ஜ', 'ஷ', 'ஸ', 'ஹ', 'க்ஷ'
    ],
    numbers: ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'],
    symbols: ['.', 'ௐ', '₹', '௹', '௺'],
  },
  Telugu: {
    vowels: ['అ', 'ఆ', 'ఇ', 'ఈ', 'ఉ', 'ఊ', 'ఋ', 'ఎ', 'ఏ', 'ఐ', 'ఒ', 'ఓ', 'ఔ', 'అం', 'అః'],
    matras: ['ా', 'ి', 'ీ', 'ు', 'ూ', 'ృ', 'ె', 'ే', 'ై', 'ొ', 'ో', 'ౌ', 'ం', 'ః', '్'],
    consonants: [
      'క', 'ఖ', 'గ', 'ఘ', 'ఙ',
      'చ', 'ఛ', 'జ', 'ఝ', 'ఞ',
      'ట', 'ఠ', 'డ', 'ఢ', 'ణ',
      'త', 'థ', 'ద', 'ధ', 'న',
      'ప', 'ఫ', 'బ', 'భ', 'మ',
      'య', 'ర', 'ల', 'వ', 'శ', 'ష', 'స', 'హ', 'ళ', 'క్ష', 'ఱ'
    ],
    numbers: ['౦', '౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯'],
    symbols: ['।', '॥', 'ఓం', '₹'],
  },
  Gujarati: {
    vowels: ['અ', 'આ', 'ઇ', 'ઈ', 'ઉ', 'ઊ', 'ઋ', 'એ', 'ઐ', 'ઓ', 'ઔ', 'અં', 'અઃ'],
    matras: ['ા', 'િ', 'ી', 'ુ', 'ૂ', 'ૃ', 'ે', 'ૈ', 'ો', 'ૌ', 'ં', 'ઃ', '્', 'ઁ'],
    consonants: [
      'ક', 'ખ', 'ગ', 'ઘ', 'ઙ',
      'ચ', 'છ', 'જ', 'ઝ', 'ઞ',
      'ટ', 'ઠ', 'ડ', 'ઢ', 'ણ',
      'ત', 'થ', 'દ', 'ધ', 'ન',
      'પ', 'ફ', 'બ', 'ભ', 'મ',
      'ય', 'ર', 'લ', 'વ', 'શ', 'ષ', 'સ', 'હ', 'ળ', 'ક્ષ', 'જ્ઞ'
    ],
    numbers: ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'],
    symbols: ['।', '॥', 'ૐ', '₹'],
  },
  Kannada: {
    vowels: ['ಅ', 'ಆ', 'ಇ', 'ಈ', 'ಉ', 'ಊ', 'ಋ', 'ಎ', 'ಏ', 'ಐ', 'ಒ', 'ಓ', 'ಔ', 'ಅಂ', 'ಅಃ'],
    matras: ['ಾ', 'ಿ', 'ೀ', 'ು', 'ೂ', 'ೃ', 'ೆ', 'ೇ', 'ೈ', 'ೊ', 'ೋ', 'ೌ', 'ಂ', 'ಃ', '್'],
    consonants: [
      'ಕ', 'ಖ', 'ಗ', 'ಘ', 'ಙ',
      'ಚ', 'ಛ', 'ಜ', 'ಝ', 'ಞ',
      'ಟ', 'ಠ', 'ಡ', 'ಢ', 'ಣ',
      'ತ', 'ಥ', 'ದ', 'ಧ', 'ನ',
      'ಪ', 'ಫ', 'ಬ', 'ಭ', 'ಮ',
      'ಯ', 'ರ', 'ಲ', 'ವ', 'ಶ', 'ಷ', 'ಸ', 'ಹ', 'ಳ', 'ಕ್ಷ', 'ಜ್ಞ'
    ],
    numbers: ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'],
    symbols: ['।', '॥', 'ಓಂ', '₹'],
  },
  Malayalam: {
    vowels: ['അ', 'ആ', 'ഇ', 'ഈ', 'ഉ', 'ഊ', 'ഋ', 'എ', 'ഏ', 'ഐ', 'ഒ', 'ഓ', 'ഔ', 'അം', 'അഃ'],
    matras: ['ാ', 'ി', 'ീ', 'ു', 'ൂ', 'ൃ', 'െ', 'േ', 'ൈ', 'ൊ', 'ോ', 'ൌ', 'ം', 'ഃ', '്'],
    consonants: [
      'ക', 'ഖ', 'ഗ', 'ഘ', 'ങ',
      'ച', 'ഛ', 'ജ', 'ഝ', 'ഞ',
      'ട', 'ഠ', 'ഡ', 'ഢ', 'ണ',
      'ത', 'ഥ', 'ദ', 'ധ', 'ന',
      'പ', 'ഫ', 'ബ', 'ഭ', 'മ',
      'യ', 'ര', 'ല', 'വ', 'ശ', 'ഷ', 'സ', 'ഹ', 'ള', 'ഴ', 'റ'
    ],
    numbers: ['൦', '൧', '൨', '൩', '൪', '൫', '൬', '൭', '൮', '൯'],
    symbols: ['.', 'ഓം', '₹'],
  },
  Gurmukhi: {
    vowels: ['ਅ', 'ਆ', 'ਇ', 'ਈ', 'ਉ', 'ਊ', 'ਏ', 'ਐ', 'ਓ', 'ਔ'],
    matras: ['ਾ', 'ਿ', 'ੀ', 'ੁ', 'ੂ', 'ੇ', 'ੈ', 'ੋ', 'ੌ', 'ਂ', 'ੱ', '੍'],
    consonants: [
      'ਕ', 'ਖ', 'ਗ', 'ਘ', 'ਙ',
      'ਚ', 'ਛ', 'ਜ', 'ਝ', 'ਞ',
      'ਟ', 'ਠ', 'ਡ', 'ਢ', 'ਣ',
      'ਤ', 'ਥ', 'ਦ', 'ਧ', 'ਨ',
      'ਪ', 'ਫ', 'ਬ', 'ਭ', 'ਮ',
      'ਯ', 'ਰ', 'ਲ', 'ਵ', 'ੜ', 'ਸ਼', 'ਖ਼', 'ਗ਼', 'ਜ਼', 'ਫ਼'
    ],
    numbers: ['੦', '੧', '੨', '੩', '੪', '੫', '੬', '੭', '੮', '੯'],
    symbols: ['।', 'ੴ', '₹'],
  },
  Odia: {
    vowels: ['ଅ', 'ଆ', 'ଇ', 'ଈ', 'ଉ', 'ଊ', 'ଋ', 'ଏ', 'ଐ', 'ଓ', 'ଔ', 'ଅଂ', 'ଅଃ'],
    matras: ['ା', 'ି', 'ୀ', 'ୁ', 'ୂ', 'ୃ', 'େ', 'ୈ', 'ୋ', 'ୌ', 'ଂ', 'ଃ', '୍', 'ଁ'],
    consonants: [
      'କ', 'ଖ', 'ଗ', 'ଘ', 'ଙ',
      'ଚ', 'ଛ', 'ଜ', 'ଝ', 'ଞ',
      'ଟ', 'ଠ', 'ଡ', 'ଢ', 'ଣ',
      'ତ', 'ଥ', 'ଦ', 'ଧ', 'ନ',
      'ପ', 'ଫ', 'ବ', 'ଭ', 'ମ',
      'ଯ', 'ର', 'ଲ', 'ୱ', 'ଶ', 'ଷ', 'ସ', 'ହ', 'ଳ', 'କ୍ଷ', 'ଜ୍ଞ'
    ],
    numbers: ['୦', '୧', '୨', '୩', '୪', '୫', '୬', '୭', '୮', '୯'],
    symbols: ['।', '॥', 'ଓଁ', '₹'],
  }
};

// OFFLINE INDIC TRANSLITERATION TABLE (Deterministic phonetic parser)
//
// Keys are matched case-sensitively first, so a capital marks the retroflex or
// long form (T ट, D ड, N ण, Sh ष, L ळ, E ए long, O ओ long, Ri ृ). A lowercase
// key also matches any casing of the input, so "Ram" still reads as र.
interface ScriptRule {
  vowels: Record<string, string>;
  matras: Record<string, string>;
  consonants: Record<string, string>;
  halant: string;
  anusvara: string;
  visarga: string;
  nukta: string;
  chandrabindu: string;
  /** Word-final "a" after a consonant is the long ā ("mera" मेरा), as in Hindi typing. */
  finalAIsLong: boolean;
  /** A word-final bare consonant keeps its virama ("bas" ಬಸ್), as Dravidian scripts write it. */
  finalHalant: boolean;
  /** n/m before a stop is written as this nasal sign ("sundar" सुंदर) instead of a conjunct. */
  nasalBeforeStop?: string;
  /** Word-final n after a long vowel is nasalisation ("hain" हैं, "nahin" नहीं). */
  finalNasalAfterLong?: boolean;
  /** Word-final m is the anusvara ("namaskaram" నమస్కారం). */
  finalMIsAnusvara?: boolean;
  /** "ng" before a consonant or at the end is the anusvara ("bangla" বাংলা). */
  ngIsAnusvara?: boolean;
  /** Malayalam chillu letters for a word-final consonant ("avan" അവൻ). */
  chillu?: Record<string, string>;
  /** Tamil: medial and final n is ன, except before t/d where it stays ந ("vandhu" வந்து). */
  tamilN?: string;
}

const INDO_ARYAN_VOWEL_KEYS = (v: {
  a: string; aa: string; i: string; ee: string; u: string; oo: string; Ri?: string;
  e: string; ai: string; o: string; au: string;
}): Record<string, string> => {
  const map: Record<string, string> = {
    aa: v.aa, A: v.aa, a: v.a, ee: v.ee, ii: v.ee, I: v.ee, i: v.i,
    oo: v.oo, uu: v.oo, U: v.oo, u: v.u, e: v.e, ai: v.ai, ei: v.ai, o: v.o, au: v.au, ou: v.au,
  };
  if (v.Ri) map.Ri = v.Ri;
  return map;
};

const DEVANAGARI_RULE: ScriptRule = {
  vowels: INDO_ARYAN_VOWEL_KEYS({
    a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', u: 'उ', oo: 'ऊ', Ri: 'ऋ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ',
  }),
  matras: INDO_ARYAN_VOWEL_KEYS({
    a: '', aa: 'ा', i: 'ि', ee: 'ी', u: 'ु', oo: 'ू', Ri: 'ृ', e: 'े', ai: 'ै', o: 'ो', au: 'ौ',
  }),
  consonants: {
    'ksh': 'क्ष', 'gy': 'ज्ञ', 'dny': 'ज्ञ', 'jny': 'ज्ञ',
    'kh': 'ख', 'gh': 'घ', 'chh': 'छ', 'Ch': 'छ', 'ch': 'च', 'jh': 'झ', 'th': 'थ', 'dh': 'ध',
    'ph': 'फ', 'bh': 'भ', 'shh': 'ष', 'Sh': 'ष', 'sh': 'श', 'Rh': 'ढ़', 'Dh': 'ढ', 'Th': 'ठ',
    'k': 'क', 'g': 'ग', 'c': 'च', 'j': 'ज', 'ny': 'ञ',
    'T': 'ट', 'D': 'ड', 'N': 'ण', 'R': 'ड़',
    't': 'त', 'd': 'द', 'n': 'न', 'p': 'प', 'f': 'फ़', 'b': 'ब', 'm': 'म',
    'y': 'य', 'r': 'र', 'l': 'ल', 'L': 'ळ', 'v': 'व', 'w': 'व', 's': 'स', 'h': 'ह',
    'z': 'ज़', 'q': 'क़', 'x': 'क्स'
  },
  halant: '्',
  anusvara: 'ं',
  visarga: 'ः',
  nukta: '़',
  chandrabindu: 'ँ',
  finalAIsLong: true,
  finalHalant: false,
  nasalBeforeStop: 'ं',
  finalNasalAfterLong: true,
};

const BENGALI_RULE: ScriptRule = {
  vowels: INDO_ARYAN_VOWEL_KEYS({
    a: 'অ', aa: 'আ', i: 'ই', ee: 'ঈ', u: 'উ', oo: 'ঊ', Ri: 'ঋ', e: 'এ', ai: 'ঐ', o: 'ও', au: 'ঔ',
  }),
  matras: INDO_ARYAN_VOWEL_KEYS({
    a: '', aa: 'া', i: 'ি', ee: 'ী', u: 'ু', oo: 'ূ', Ri: 'ৃ', e: 'ে', ai: 'ৈ', o: 'ো', au: 'ৌ',
  }),
  consonants: {
    'ksh': 'ক্ষ', 'gy': 'জ্ঞ',
    'kh': 'খ', 'gh': 'ঘ', 'chh': 'ছ', 'Ch': 'ছ', 'ch': 'চ', 'jh': 'ঝ', 'th': 'থ', 'dh': 'ধ',
    'ph': 'ফ', 'bh': 'ভ', 'shh': 'ষ', 'Sh': 'ষ', 'sh': 'শ', 'Rh': 'ঢ়', 'Dh': 'ঢ', 'Th': 'ঠ',
    'k': 'ক', 'g': 'গ', 'ng': 'ঙ', 'c': 'চ', 'j': 'জ', 'ny': 'ঞ',
    'T': 'ট', 'D': 'ড', 'N': 'ণ', 'R': 'ড়',
    't': 'ত', 'd': 'দ', 'n': 'ন', 'p': 'প', 'f': 'ফ', 'b': 'ব', 'm': 'ম',
    'y': 'য', 'r': 'র', 'l': 'ল', 'v': 'ভ', 'w': 'ওয়', 's': 'স', 'h': 'হ', 'z': 'য'
  },
  halant: '্',
  anusvara: 'ং',
  visarga: 'ঃ',
  nukta: '়',
  chandrabindu: 'ঁ',
  finalAIsLong: true,
  finalHalant: false,
  ngIsAnusvara: true,
};

// Assamese shares the Bengali script but has its own r (ৰ) and w (ৱ).
const ASSAMESE_RULE: ScriptRule = {
  ...BENGALI_RULE,
  consonants: { ...BENGALI_RULE.consonants, 'r': 'ৰ', 'w': 'ৱ', 'v': 'ভ' },
};

const TAMIL_RULE: ScriptRule = {
  vowels: {
    'aa': 'ஆ', 'A': 'ஆ', 'a': 'அ', 'ee': 'ஈ', 'ii': 'ஈ', 'I': 'ஈ', 'i': 'இ', 'oo': 'ஊ', 'uu': 'ஊ', 'U': 'ஊ', 'u': 'உ',
    'E': 'ஏ', 'e': 'எ', 'ai': 'ஐ', 'O': 'ஓ', 'o': 'ஒ', 'au': 'ஔ'
  },
  matras: {
    'aa': 'ா', 'A': 'ா', 'a': '', 'ee': 'ீ', 'ii': 'ீ', 'I': 'ீ', 'i': 'ி', 'oo': 'ூ', 'uu': 'ூ', 'U': 'ூ', 'u': 'ு',
    'E': 'ே', 'e': 'ெ', 'ai': 'ை', 'O': 'ோ', 'o': 'ொ', 'au': 'ௌ'
  },
  consonants: {
    'ksh': 'க்ஷ',
    'kh': 'க', 'gh': 'க', 'chh': 'ச', 'ch': 'ச', 'jh': 'ஜ', 'th': 'த', 'dh': 'த',
    'ph': 'ப', 'bh': 'ப', 'shh': 'ஷ', 'Sh': 'ஷ', 'sh': 'ஷ',
    'k': 'க', 'g': 'க', 'ng': 'ங', 'c': 'ச', 'j': 'ஜ', 'ny': 'ஞ',
    'T': 'ட', 'Th': 'ட', 'D': 'ட', 'Dh': 'ட', 'N': 'ண',
    't': 'த', 'd': 'த', 'nn': 'ன', 'n': 'ந', 'p': 'ப', 'f': 'ஃப', 'b': 'ப', 'm': 'ம',
    'y': 'ய', 'r': 'ர', 'R': 'ற', 'l': 'ல', 'L': 'ள', 'zh': 'ழ', 'v': 'வ', 'w': 'வ', 's': 'ஸ', 'h': 'ஹ'
  },
  halant: '்',
  anusvara: 'ம்',
  visarga: 'ஃ',
  nukta: '',
  chandrabindu: '',
  finalAIsLong: false,
  finalHalant: true,
  tamilN: 'ன',
};

const dravidianVowels = (v: {
  a: string; aa: string; i: string; ee: string; u: string; oo: string; Ri: string;
  e: string; E: string; ai: string; o: string; O: string; au: string;
}): Record<string, string> => ({
  aa: v.aa, A: v.aa, a: v.a, ee: v.ee, ii: v.ee, I: v.ee, i: v.i, oo: v.oo, uu: v.oo, U: v.oo, u: v.u,
  Ri: v.Ri, E: v.E, e: v.e, ai: v.ai, O: v.O, o: v.o, au: v.au, ou: v.au,
});

const TELUGU_RULE: ScriptRule = {
  vowels: dravidianVowels({
    a: 'అ', aa: 'ఆ', i: 'ఇ', ee: 'ఈ', u: 'ఉ', oo: 'ఊ', Ri: 'ఋ', e: 'ఎ', E: 'ఏ', ai: 'ఐ', o: 'ఒ', O: 'ఓ', au: 'ఔ',
  }),
  matras: dravidianVowels({
    a: '', aa: 'ా', i: 'ి', ee: 'ీ', u: 'ు', oo: 'ూ', Ri: 'ృ', e: 'ె', E: 'ే', ai: 'ై', o: 'ొ', O: 'ో', au: 'ౌ',
  }),
  consonants: {
    'ksh': 'క్ష', 'gy': 'జ్ఞ',
    'kh': 'ఖ', 'gh': 'ఘ', 'chh': 'ఛ', 'ch': 'చ', 'jh': 'ఝ', 'th': 'థ', 'dh': 'ధ',
    'ph': 'ఫ', 'bh': 'భ', 'shh': 'ష', 'Sh': 'ష', 'sh': 'శ', 'Th': 'ఠ', 'Dh': 'ఢ',
    'k': 'క', 'g': 'గ', 'c': 'చ', 'j': 'జ', 'ny': 'ఞ',
    'T': 'ట', 'D': 'డ', 'N': 'ణ',
    't': 'త', 'd': 'ద', 'n': 'న', 'p': 'ప', 'f': 'ఫ', 'b': 'బ', 'm': 'మ',
    'y': 'య', 'r': 'ర', 'R': 'ఱ', 'l': 'ల', 'L': 'ళ', 'v': 'వ', 'w': 'వ', 's': 'స', 'h': 'హ', 'z': 'జ'
  },
  halant: '్',
  anusvara: 'ం',
  visarga: 'ః',
  nukta: '',
  chandrabindu: '',
  finalAIsLong: false,
  finalHalant: true,
  nasalBeforeStop: 'ం',
  finalMIsAnusvara: true,
};

const GUJARATI_RULE: ScriptRule = {
  vowels: INDO_ARYAN_VOWEL_KEYS({
    a: 'અ', aa: 'આ', i: 'ઇ', ee: 'ઈ', u: 'ઉ', oo: 'ઊ', Ri: 'ઋ', e: 'એ', ai: 'ઐ', o: 'ઓ', au: 'ઔ',
  }),
  matras: INDO_ARYAN_VOWEL_KEYS({
    a: '', aa: 'ા', i: 'િ', ee: 'ી', u: 'ુ', oo: 'ૂ', Ri: 'ૃ', e: 'ે', ai: 'ૈ', o: 'ો', au: 'ૌ',
  }),
  consonants: {
    'ksh': 'ક્ષ', 'gy': 'જ્ઞ',
    'kh': 'ખ', 'gh': 'ઘ', 'chh': 'છ', 'Ch': 'છ', 'ch': 'ચ', 'jh': 'ઝ', 'th': 'થ', 'dh': 'ધ',
    'ph': 'ફ', 'bh': 'ભ', 'shh': 'ષ', 'Sh': 'ષ', 'sh': 'શ', 'Th': 'ઠ', 'Dh': 'ઢ',
    'k': 'ક', 'g': 'ગ', 'c': 'ચ', 'j': 'જ', 'ny': 'ઞ',
    'T': 'ટ', 'D': 'ડ', 'N': 'ણ',
    't': 'ત', 'd': 'દ', 'n': 'ન', 'p': 'પ', 'f': 'ફ', 'b': 'બ', 'm': 'મ',
    'y': 'ય', 'r': 'ર', 'l': 'લ', 'L': 'ળ', 'v': 'વ', 'w': 'વ', 's': 'સ', 'h': 'હ', 'z': 'ઝ'
  },
  halant: '્',
  anusvara: 'ં',
  visarga: 'ઃ',
  nukta: '',
  chandrabindu: 'ઁ',
  finalAIsLong: true,
  finalHalant: false,
  nasalBeforeStop: 'ં',
  finalNasalAfterLong: true,
};

const KANNADA_RULE: ScriptRule = {
  vowels: dravidianVowels({
    a: 'ಅ', aa: 'ಆ', i: 'ಇ', ee: 'ಈ', u: 'ಉ', oo: 'ಊ', Ri: 'ಋ', e: 'ಎ', E: 'ಏ', ai: 'ಐ', o: 'ಒ', O: 'ಓ', au: 'ಔ',
  }),
  matras: dravidianVowels({
    a: '', aa: 'ಾ', i: 'ಿ', ee: 'ೀ', u: 'ು', oo: 'ೂ', Ri: 'ೃ', e: 'ೆ', E: 'ೇ', ai: 'ೈ', o: 'ೊ', O: 'ೋ', au: 'ೌ',
  }),
  consonants: {
    'ksh': 'ಕ್ಷ', 'gy': 'ಜ್ಞ',
    'kh': 'ಖ', 'gh': 'ಘ', 'chh': 'ಛ', 'ch': 'ಚ', 'jh': 'ಝ', 'th': 'ಥ', 'dh': 'ಧ',
    'ph': 'ಫ', 'bh': 'ಭ', 'shh': 'ಷ', 'Sh': 'ಷ', 'sh': 'ಶ', 'Th': 'ಠ', 'Dh': 'ಢ',
    'k': 'ಕ', 'g': 'ಗ', 'c': 'ಚ', 'j': 'ಜ', 'ny': 'ಞ',
    'T': 'ಟ', 'D': 'ಡ', 'N': 'ಣ',
    't': 'ತ', 'd': 'ದ', 'n': 'ನ', 'p': 'ಪ', 'f': 'ಫ', 'b': 'ಬ', 'm': 'ಮ',
    'y': 'ಯ', 'r': 'ರ', 'l': 'ಲ', 'L': 'ಳ', 'v': 'ವ', 'w': 'ವ', 's': 'ಸ', 'h': 'ಹ', 'z': 'ಜ'
  },
  halant: '್',
  anusvara: 'ಂ',
  visarga: 'ಃ',
  nukta: '',
  chandrabindu: '',
  finalAIsLong: false,
  finalHalant: true,
  nasalBeforeStop: 'ಂ',
  finalMIsAnusvara: true,
};

const MALAYALAM_RULE: ScriptRule = {
  vowels: dravidianVowels({
    a: 'അ', aa: 'ആ', i: 'ഇ', ee: 'ഈ', u: 'ഉ', oo: 'ഊ', Ri: 'ഋ', e: 'എ', E: 'ഏ', ai: 'ഐ', o: 'ഒ', O: 'ഓ', au: 'ഔ',
  }),
  matras: dravidianVowels({
    a: '', aa: 'ാ', i: 'ി', ee: 'ീ', u: 'ു', oo: 'ൂ', Ri: 'ൃ', e: 'െ', E: 'േ', ai: 'ൈ', o: 'ൊ', O: 'ോ', au: 'ൗ',
  }),
  consonants: {
    'ksh': 'ക്ഷ', 'gy': 'ജ്ഞ',
    'kh': 'ഖ', 'gh': 'ഘ', 'chh': 'ഛ', 'ch': 'ച', 'jh': 'ഝ', 'th': 'ത', 'dh': 'ധ',
    'ph': 'ഫ', 'bh': 'ഭ', 'shh': 'ഷ', 'Sh': 'ഷ', 'sh': 'ശ', 'Th': 'ഠ', 'Dh': 'ഢ', 'zh': 'ഴ',
    'k': 'ക', 'g': 'ഗ', 'ng': 'ങ', 'c': 'ച', 'j': 'ജ', 'ny': 'ഞ',
    'T': 'ട', 'D': 'ഡ', 'N': 'ണ',
    't': 'ത', 'd': 'ദ', 'n': 'ന', 'p': 'പ', 'f': 'ഫ', 'b': 'ബ', 'm': 'മ',
    'y': 'യ', 'r': 'ര', 'R': 'റ', 'l': 'ല', 'L': 'ള', 'v': 'വ', 'w': 'വ', 's': 'സ', 'h': 'ഹ', 'z': 'സ'
  },
  halant: '്',
  anusvara: 'ം',
  visarga: 'ഃ',
  nukta: '',
  chandrabindu: '',
  finalAIsLong: false,
  finalHalant: true,
  finalMIsAnusvara: true,
  chillu: { 'n': 'ൻ', 'N': 'ൺ', 'r': 'ർ', 'l': 'ൽ', 'L': 'ൾ' },
};

const GURMUKHI_RULE: ScriptRule = {
  vowels: INDO_ARYAN_VOWEL_KEYS({
    a: 'ਅ', aa: 'ਆ', i: 'ਇ', ee: 'ਈ', u: 'ਉ', oo: 'ਊ', e: 'ਏ', ai: 'ਐ', o: 'ਓ', au: 'ਔ',
  }),
  matras: INDO_ARYAN_VOWEL_KEYS({
    a: '', aa: 'ਾ', i: 'ਿ', ee: 'ੀ', u: 'ੁ', oo: 'ੂ', e: 'ੇ', ai: 'ੈ', o: 'ੋ', au: 'ੌ',
  }),
  consonants: {
    'kh': 'ਖ', 'gh': 'ਘ', 'chh': 'ਛ', 'Ch': 'ਛ', 'ch': 'ਚ', 'jh': 'ਝ', 'th': 'ਥ', 'dh': 'ਧ',
    'ph': 'ਫ', 'bh': 'ਭ', 'sh': 'ਸ਼', 'Th': 'ਠ', 'Dh': 'ਢ', 'Rh': 'ੜ',
    'k': 'ਕ', 'g': 'ਗ', 'c': 'ਚ', 'j': 'ਜ', 'ny': 'ਞ',
    'T': 'ਟ', 'D': 'ਡ', 'N': 'ਣ', 'R': 'ੜ',
    't': 'ਤ', 'd': 'ਦ', 'n': 'ਨ', 'p': 'ਪ', 'f': 'ਫ਼', 'b': 'ਬ', 'm': 'ਮ',
    'y': 'ਯ', 'r': 'ਰ', 'l': 'ਲ', 'L': 'ਲ਼', 'v': 'ਵ', 'w': 'ਵ', 's': 'ਸ', 'h': 'ਹ',
    'z': 'ਜ਼', 'q': 'ਕ'
  },
  halant: '੍',
  anusvara: 'ਂ',
  visarga: '',
  nukta: '਼',
  chandrabindu: 'ਁ',
  finalAIsLong: true,
  finalHalant: false,
  // Gurmukhi writes a nasal before a stop with tippi ("punjab" ਪੰਜਾਬ).
  nasalBeforeStop: 'ੰ',
  finalNasalAfterLong: true,
};

const ODIA_RULE: ScriptRule = {
  vowels: INDO_ARYAN_VOWEL_KEYS({
    a: 'ଅ', aa: 'ଆ', i: 'ଇ', ee: 'ଈ', u: 'ଉ', oo: 'ଊ', Ri: 'ଋ', e: 'ଏ', ai: 'ଐ', o: 'ଓ', au: 'ଔ',
  }),
  matras: INDO_ARYAN_VOWEL_KEYS({
    a: '', aa: 'ା', i: 'ି', ee: 'ୀ', u: 'ୁ', oo: 'ୂ', Ri: 'ୃ', e: 'େ', ai: 'ୈ', o: 'ୋ', au: 'ୌ',
  }),
  consonants: {
    'ksh': 'କ୍ଷ', 'gy': 'ଜ୍ଞ',
    'kh': 'ଖ', 'gh': 'ଘ', 'chh': 'ଛ', 'Ch': 'ଛ', 'ch': 'ଚ', 'jh': 'ଝ', 'th': 'ଥ', 'dh': 'ଧ',
    'ph': 'ଫ', 'bh': 'ଭ', 'shh': 'ଷ', 'Sh': 'ଷ', 'sh': 'ଶ', 'Th': 'ଠ', 'Dh': 'ଢ', 'Rh': 'ଢ଼',
    'k': 'କ', 'g': 'ଗ', 'ng': 'ଙ', 'c': 'ଚ', 'j': 'ଜ', 'ny': 'ଞ',
    'T': 'ଟ', 'D': 'ଡ', 'N': 'ଣ', 'R': 'ଡ଼',
    't': 'ତ', 'd': 'ଦ', 'n': 'ନ', 'p': 'ପ', 'f': 'ଫ', 'b': 'ବ', 'm': 'ମ',
    'y': 'ଯ', 'r': 'ର', 'l': 'ଲ', 'L': 'ଳ', 'v': 'ୱ', 'w': 'ୱ', 's': 'ସ', 'h': 'ହ', 'z': 'ଜ'
  },
  halant: '୍',
  anusvara: 'ଂ',
  visarga: 'ଃ',
  nukta: '',
  chandrabindu: 'ଁ',
  finalAIsLong: true,
  finalHalant: false,
  ngIsAnusvara: true,
};

function getRuleForLanguage(langName: string): ScriptRule {
  const norm = langName.toLowerCase();
  if (norm.includes('assamese')) return ASSAMESE_RULE;
  if (norm.includes('bengali') || norm.includes('bangla')) return BENGALI_RULE;
  if (norm.includes('tamil')) return TAMIL_RULE;
  if (norm.includes('telugu')) return TELUGU_RULE;
  if (norm.includes('gujarati')) return GUJARATI_RULE;
  if (norm.includes('kannada')) return KANNADA_RULE;
  if (norm.includes('malayalam')) return MALAYALAM_RULE;
  if (norm.includes('punjabi') || norm.includes('gurmukhi')) return GURMUKHI_RULE;
  if (norm.includes('odia') || norm.includes('oriya')) return ODIA_RULE;
  // Default to Devanagari (Hindi, Marathi, Nepali, Sanskrit)
  return DEVANAGARI_RULE;
}

/**
 * Curated High-Frequency Indic Vocabulary Dictionary.
 * Contains vetted colloquial, dubbing, and conversational words across Indian languages
 * to guarantee instant 100% accuracy even when offline or before remote fetching.
 */
export const CURATED_INDIC_DICTIONARY: Record<string, Record<string, string>> = {
  Hindi: {
    namaste: 'नमस्ते',
    namaskar: 'नमस्कार',
    dhanyawad: 'धन्यवाद',
    dhanyavad: 'धन्यवाद',
    shukriya: 'शुक्रिया',
    kya: 'क्या',
    kaise: 'कैसे',
    kaisa: 'कैसा',
    kaisi: 'कैसी',
    hai: 'है',
    hain: 'हैं',
    ho: 'हो',
    hoon: 'हूँ',
    hu: 'हूँ',
    mera: 'मेरा',
    meri: 'मेरी',
    mere: 'मेरे',
    tera: 'तेरा',
    teri: 'तेरी',
    tere: 'तेरे',
    iska: 'इसका',
    iski: 'इसकी',
    iske: 'इसके',
    uska: 'उसका',
    uski: 'उसकी',
    uske: 'उसके',
    unka: 'उनका',
    unki: 'उनकी',
    unke: 'उनके',
    humara: 'हमारा',
    humari: 'हमारी',
    hamara: 'हमारा',
    hamari: 'हमारी',
    aap: 'आप',
    tum: 'तुम',
    hum: 'हम',
    mai: 'मैं',
    main: 'मैं',
    mujhe: 'मुझे',
    tujhe: 'तुझे',
    hume: 'हमें',
    humko: 'हमको',
    aapko: 'आपको',
    tumko: 'तुमको',
    yeh: 'यह',
    ye: 'ये',
    woh: 'वह',
    wo: 'वो',
    theek: 'ठीक',
    thik: 'ठीक',
    achha: 'अच्छा',
    achcha: 'अच्छा',
    acha: 'अच्छा',
    accha: 'अच्छा',
    bhai: 'भाई',
    bhaiya: 'भैया',
    behen: 'बहन',
    dost: 'दोस्त',
    yaar: 'यार',
    sahab: 'साहब',
    ji: 'जी',
    kyun: 'क्यों',
    kyon: 'क्यों',
    kyu: 'क्यों',
    nahi: 'नहीं',
    nahin: 'नहीं',
    haan: 'हाँ',
    han: 'हाँ',
    lekin: 'लेकिन',
    magar: 'मगर',
    par: 'पर',
    aur: 'और',
    kuch: 'कुछ',
    kuchh: 'कुछ',
    sab: 'सब',
    sabkuch: 'सबकुछ',
    bahut: 'बहुत',
    bohot: 'बहुत',
    kaam: 'काम',
    kam: 'कम',
    baat: 'बात',
    aaj: 'आज',
    kal: 'कल',
    ab: 'अब',
    tab: 'तब',
    jab: 'जब',
    yahan: 'यहाँ',
    wahan: 'वहाँ',
    kahan: 'कहाँ',
    jahan: 'जहाँ',
    kab: 'कब',
    ghar: 'घर',
    desh: 'देश',
    bharat: 'भारत',
    duniya: 'दुनिया',
    zindagi: 'जिंदगी',
    dil: 'दिल',
    pyar: 'प्यार',
    prem: 'प्रेम',
    audio: 'ऑडियो',
    video: 'वीडियो',
    dubbing: 'डबिंग',
    studio: 'स्टूडियो',
    film: 'फिल्म',
    acting: 'एक्टिंग',
    director: 'डायरेक्टर',
    scene: 'सीन',
    dialogue: 'डायलॉग',
    awaaz: 'आवाज़',
    awaz: 'आवाज़',
    shuru: 'शुरू',
    khatam: 'खत्म',
    suno: 'सुनो',
    dekho: 'देखो',
    bolo: 'बोलो',
    ruko: 'रुको',
    chalo: 'चलो',
    aao: 'आओ',
    jao: 'जाओ',
    karo: 'करो',
    mat: 'मत',
    zaruri: 'ज़रूरी',
    zaroori: 'ज़रूरी',
    alvida: 'अलविदा',
  },
  Bengali: {
    nomoshkar: 'নমস্কার',
    namaskar: 'নমস্কার',
    dhonyobad: 'ধন্যবাদ',
    dhanyabad: 'ধন্যবাদ',
    kemon: 'কেমন',
    achen: 'আছেন',
    acho: 'আছো',
    achi: 'আছি',
    bhalo: 'ভালো',
    amar: 'আমার',
    amra: 'আমরা',
    tomar: 'তোমার',
    tomra: 'তোমরা',
    apnar: 'আপনার',
    apnara: 'আপনারা',
    eita: 'এইটা',
    oita: 'ওইটা',
    ki: 'কী',
    keno: 'কেন',
    kothay: 'কোথায়',
    kobe: 'কবে',
    kintu: 'কিন্তু',
    ebong: 'এবং',
    ar: 'আর',
    shob: 'সব',
    shundor: 'সুন্দর',
    shotti: 'সত্যি',
    bhai: 'ভাই',
    dada: 'দাদা',
    didi: 'দিদি',
    bondhu: 'বন্ধু',
    bari: 'বাড়ি',
    bangla: 'বাংলা',
    desh: 'দেশ',
    shobai: 'সবাই',
    ektu: 'একটু',
    onek: 'অনেক',
    shunte: 'শুনতে',
    bolun: 'বলুন',
    dekhun: 'দেখুন',
    thik: 'ঠিক',
    hobe: 'হবে',
    hoyeche: 'হয়েছে',
  },
  Tamil: {
    vanakkam: 'வணக்கம்',
    nandri: 'நன்றி',
    eppadi: 'எப்படி',
    irukkinga: 'இருக்கீங்க',
    irukkeenga: 'இருக்கீங்க',
    irukken: 'இருக்கேன்',
    nalla: 'நல்லா',
    aam: 'ஆம்',
    illai: 'இல்லை',
    enna: 'என்ன',
    yenga: 'எங்க',
    yengae: 'எங்கே',
    yen: 'ஏன்',
    eppo: 'எப்போ',
    thalaiva: 'தலைவா',
    thambi: 'தம்பி',
    anna: 'அண்ணா',
    nanba: 'நண்பா',
    romba: 'ரொம்ப',
    mikka: 'மிக்க',
    seri: 'சரி',
    solunga: 'சொல்லுங்க',
    paarunga: 'பாருங்க',
    vaa: 'வா',
    poda: 'போடா',
  },
  Telugu: {
    namaskaram: 'నమస్కారం',
    bagunnara: 'బాగున్నారా',
    dhanyavadalu: 'ధన్యవాదాలు',
    ela: 'ఎలా',
    unnaru: 'ఉన్నారు',
    nenu: 'నేను',
    meeru: 'మీరు',
    manamu: 'మనము',
    avunu: 'అవును',
    kaadhu: 'కాదు',
    emiti: 'ఏమిటి',
    enti: 'ఏంటి',
    ekkada: 'ఎక్కడ',
    eppudu: 'ఎప్పుడు',
    endhuku: 'ఎందుకు',
    mithrama: 'మిత్రమా',
    anna: 'అన్న',
    chala: 'చాలా',
    manchi: 'మంచి',
    cheppandi: 'చెప్పండి',
    chudandi: 'చూడండి',
    sare: 'సరే',
  },
  Marathi: {
    namaskar: 'नमस्कार',
    dhanyavaad: 'धन्यवाद',
    dhanyavad: 'धन्यवाद',
    kase: 'कसे',
    aahat: 'आहात',
    mi: 'मी',
    aamhi: 'आम्ही',
    tumhi: 'तुम्ही',
    aaple: 'आपले',
    ho: 'हो',
    naahi: 'नाही',
    kaay: 'काय',
    kiti: 'किती',
    kuthe: 'कुठे',
    kadhi: 'कधी',
    ka: 'का',
    changla: 'चांगला',
    changli: 'चांगली',
    bhau: 'भाऊ',
    dada: 'दादा',
    mitra: 'मित्र',
    bara: 'बरं',
    sang: 'सांग',
    aika: 'ऐका',
  },
  Gujarati: {
    namaste: 'નમસ્તે',
    namaskar: 'નમસ્કાર',
    aabhar: 'આભાર',
    kem: 'કેમ',
    cho: 'છો',
    tame: 'તમે',
    hu: 'હું',
    ame: 'અમે',
    ha: 'હા',
    na: 'ના',
    su: 'શું',
    kyare: 'ક્યારે',
    kyan: 'ક્યાં',
    saras: 'સરસ',
    bhai: 'ભાઈ',
    dost: 'દોસ્ત',
    majama: 'મજામાં',
  },
  Kannada: {
    namaskara: 'ನಮಸ್ಕಾರ',
    hegiddira: 'ಹೇಗಿದ್ದೀರಾ',
    dhanyavadagalu: 'ಧನ್ಯವಾದಗಳು',
    naanu: 'ನಾನು',
    neevu: 'ನೀವು',
    houdu: 'ಹೌದು',
    illa: 'ಇಲ್ಲ',
    yenu: 'ಏನು',
    yelli: 'ಎಲ್ಲಿ',
    yaake: 'ಯಾಕೆ',
    chennagi: 'ಚೆನ್ನಾಗಿ',
    anna: 'ಅಣ್ಣ',
  },
  Malayalam: {
    namaskaram: 'നമസ്കാരം',
    sukhamano: 'സുഖമാണോ',
    nandi: 'നന്ദി',
    njan: 'ഞാൻ',
    ningal: 'നിങ്ങൾ',
    athe: 'അതെ',
    alla: 'അല്ല',
    entha: 'എന്താ',
    evide: 'എവിടെ',
    enthu: 'എന്ത്',
    nalla: 'നല്ല',
    sahodara: 'സഹോദരാ',
  },
  Punjabi: {
    satshriakal: 'ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ',
    kiddan: 'ਕਿੱਦਾਂ',
    dhannwad: 'ਧੰਨਵਾਦ',
    hanji: 'ਹਾਂਜੀ',
    nahi: 'ਨਹੀਂ',
    ki: 'ਕੀ',
    kithe: 'ਕਿੱਥੇ',
    kyun: 'ਕਿਉਂ',
    veere: 'ਵੀਰੇ',
    bhabhi: 'ਭਾਬੀ',
    changga: 'ਚੰਗਾ',
  },
  Odia: {
    namaskar: 'ନମସ୍କାର',
    dhanyabad: 'ଧନ୍ୟବାଦ',
    kemiti: 'କେମିତି',
    achanti: 'ଅଛନ୍ତି',
    mu: 'ମୁଁ',
    tume: 'ତୁମେ',
    aapana: 'ଆପଣ',
    haan: 'ହଁ',
    naahin: 'ନାହିଁ',
    kana: 'କଣ',
    kouthi: 'କେଉଁଠି',
    bhala: 'ଭଲ',
  },
  Urdu: {
    adab: 'آداب',
    assalamoalaikum: 'السلام علیکم',
    shukriya: 'شکریہ',
    kaise: 'کیسے',
    kaisa: 'کیسا',
    hai: 'ہے',
    hain: 'ہیں',
    mera: 'میرا',
    meri: 'میری',
    mere: 'میرے',
    aap: 'آپ',
    tum: 'تم',
    hum: 'ہم',
    mai: 'میں',
    kya: 'کیا',
    kyun: 'کیوں',
    nahi: 'نہیں',
    haan: 'ہاں',
    lekin: 'لیکن',
    aur: 'اور',
    bahut: 'بہت',
    dost: 'دوست',
    bhai: 'بھائی',
    shandar: 'شاندار',
  },
};

/**
 * Custom User Dictionary Storage for personalized phonetic spellings
 */
const CUSTOM_DICT_STORAGE_KEY = 'indic_user_custom_dictionary_v1';

export function getUserCustomDictionary(langCode: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_DICT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed[langCode.toLowerCase()] || {};
  } catch {
    return {};
  }
}

export function saveUserCustomWord(roman: string, native: string, langCode: string): void {
  if (typeof window === 'undefined' || !roman || !native) return;
  try {
    const raw = localStorage.getItem(CUSTOM_DICT_STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    const key = langCode.toLowerCase();
    if (!store[key]) store[key] = {};
    store[key][roman.toLowerCase().trim()] = native.trim();
    localStorage.setItem(CUSTOM_DICT_STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('Failed to save custom word:', err);
  }
}

export function deleteUserCustomWord(roman: string, langCode: string): void {
  if (typeof window === 'undefined' || !roman) return;
  try {
    const raw = localStorage.getItem(CUSTOM_DICT_STORAGE_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    const key = langCode.toLowerCase();
    if (store[key]) {
      delete store[key][roman.toLowerCase().trim()];
      localStorage.setItem(CUSTOM_DICT_STORAGE_KEY, JSON.stringify(store));
    }
  } catch (err) {
    console.warn('Failed to delete custom word:', err);
  }
}

export function listAllUserCustomWords(langCode: string): { roman: string; native: string }[] {
  const dict = getUserCustomDictionary(langCode);
  return Object.entries(dict).map(([roman, native]) => ({ roman, native }));
}

const sortedKeyCache = new WeakMap<Record<string, string>, string[]>();

function keysLongestFirst(table: Record<string, string>): string[] {
  let keys = sortedKeyCache.get(table);
  if (!keys) {
    keys = Object.keys(table).sort((a, b) => b.length - a.length);
    sortedKeyCache.set(table, keys);
  }
  return keys;
}

/**
 * The longest table key at `pos`. An exact-case key wins, so "T" is ट and
 * "Sh" is ष; failing that, a lowercase key matches any casing of the input.
 * An uppercase key never matches lowercase input, which is what used to turn
 * every "t" into ट, "d" into ड and "n" into ण.
 */
function matchKey(table: Record<string, string>, word: string, lower: string, pos: number): string | null {
  const keys = keysLongestFirst(table);
  for (const key of keys) {
    if (word.startsWith(key, pos)) return key;
  }
  for (const key of keys) {
    if (key === key.toLowerCase() && lower.startsWith(key, pos)) return key;
  }
  return null;
}

const isLetter = (ch: string | undefined) => !!ch && /[A-Za-z]/.test(ch);
// Consonants a preceding n / m merges into as a nasal sign.
const STOPS_AFTER_N = /^[kgcjtdKGCJTD]/;
const STOPS_AFTER_M = /^[pbPB]/;
// Vowels after which a word-final n is nasalisation: main, hain, men, kyon, logon.
const NASALISING_VOWEL = /(ai|[^e]e|^e|[^o]o|^o)$/;

/**
 * OFFLINE ALGORITHMIC TRANSLITERATOR
 * Converts Roman English syllables to Indic Script with high accuracy
 */
export function transliterateWordOffline(word: string, language: string): string {
  if (!word) return '';

  let cleanWord = word.trim();
  const lowerWord = cleanWord.toLowerCase();
  const langConfig = getIndicLanguageConfig(language);
  const langKey = langConfig.name;

  // 1. Check User Custom Dictionary first
  const userDict = getUserCustomDictionary(langConfig.code);
  if (userDict[lowerWord]) {
    return userDict[lowerWord];
  }

  // 2. Check Curated Indic Dictionary
  if (CURATED_INDIC_DICTIONARY[langKey] && CURATED_INDIC_DICTIONARY[langKey][lowerWord]) {
    return CURATED_INDIC_DICTIONARY[langKey][lowerWord];
  }

  // Also check generic Hindi / Devanagari dictionary if Sanskrit or Nepali
  if ((langKey === 'Sanskrit' || langKey === 'Nepali' || langKey === 'Marathi') && CURATED_INDIC_DICTIONARY.Hindi[lowerWord]) {
    return CURATED_INDIC_DICTIONARY.Hindi[lowerWord];
  }

  // A word typed in all capitals is emphasis or caps lock, not a run of retroflex letters.
  if (cleanWord.length > 1 && cleanWord === cleanWord.toUpperCase()) cleanWord = lowerWord;

  const rule = getRuleForLanguage(language);
  const lower = cleanWord.toLowerCase();
  const len = cleanWord.length;
  let result = '';
  let i = 0;

  while (i < len) {
    const ch = cleanWord[i];

    if (!isLetter(ch)) {
      result += ch;
      i += 1;
      continue;
    }

    // Mid-word capital M / H are the anusvara and visarga.
    if (i > 0 && ch === 'M' && rule.anusvara) {
      result += rule.anusvara;
      i += 1;
      continue;
    }
    if (i > 0 && ch === 'H' && rule.visarga) {
      result += rule.visarga;
      i += 1;
      continue;
    }

    const consKey = matchKey(rule.consonants, cleanWord, lower, i);
    if (consKey) {
      const start = i;
      i += consKey.length;
      const atEnd = !isLetter(cleanWord[i]);
      const matraKey = atEnd ? null : matchKey(rule.matras, cleanWord, lower, i);
      const nextConsKey = atEnd || matraKey !== null ? null : matchKey(rule.consonants, cleanWord, lower, i);
      const before = lower.slice(0, start);
      const afterVowel = start > 0 && /[aeiou]$/.test(before);
      let letter = rule.consonants[consKey];

      if (matraKey === null) {
        // n / m before a stop: सुंदर, हिंदी, ಬೆಂಗಳೂರು, ਪੰਜਾਬ
        if (rule.nasalBeforeStop && afterVowel && nextConsKey &&
            ((consKey === 'n' && STOPS_AFTER_N.test(nextConsKey)) || (consKey === 'm' && STOPS_AFTER_M.test(nextConsKey)))) {
          result += rule.nasalBeforeStop;
          continue;
        }
        // Bengali / Odia "ng" before a consonant or at the end: বাংলা, রং
        if (rule.ngIsAnusvara && consKey === 'ng' && start > 0) {
          result += rule.anusvara;
          continue;
        }
        if (atEnd && start > 0) {
          if (rule.finalMIsAnusvara && consKey === 'm') {
            result += rule.anusvara;
            continue;
          }
          if (rule.finalNasalAfterLong && consKey === 'n' && NASALISING_VOWEL.test(before)) {
            result += rule.anusvara;
            continue;
          }
          if (rule.chillu?.[consKey]) {
            result += rule.chillu[consKey];
            continue;
          }
        }
      }

      // Tamil: ந starts a word or precedes t/d (வந்து); elsewhere it is ன (அவன்).
      if (rule.tamilN && consKey === 'n' && start > 0 && !(nextConsKey && /^[tdTD]/.test(nextConsKey))) {
        letter = rule.tamilN;
      }

      result += letter;

      if (matraKey !== null) {
        const wordFinalA = matraKey === 'a' && !isLetter(cleanWord[i + 1]);
        result += wordFinalA && rule.finalAIsLong ? rule.matras['aa'] : rule.matras[matraKey];
        i += matraKey.length;
      } else if (!atEnd || rule.finalHalant) {
        // Consonant cluster (क्य, त्र) or a Dravidian word-final consonant (ಬಸ್).
        result += rule.halant;
      }
      continue;
    }

    const vowelKey = matchKey(rule.vowels, cleanWord, lower, i);
    if (vowelKey) {
      result += rule.vowels[vowelKey];
      i += vowelKey.length;
      continue;
    }

    // Fallback char
    result += ch;
    i += 1;
  }

  return result;
}

/**
 * Transliterates an entire text string using offline rule parser
 */
export function transliterateTextOffline(text: string, language: string): string {
  if (!text) return '';
  return text.replace(/([a-zA-Z]+)/g, (match) => {
    return transliterateWordOffline(match, language);
  });
}

// In-Memory cache for online transliteration suggestions
const suggestionCache = new Map<string, string[]>();

/**
 * Fetches high-accuracy phonetic suggestions from Google Input Tools API + Curated Dict + Offline Fallbacks.
 * Returns numbered candidates with the original English word retained as a clean choice.
 */
export async function getPhoneticSuggestions(
  word: string,
  language: string,
  numSuggestions: number = 5
): Promise<string[]> {
  const trimmed = word.trim();
  if (!trimmed || !/[a-zA-Z]/.test(trimmed)) {
    return [trimmed];
  }

  const langConfig = getIndicLanguageConfig(language);
  const itc = langConfig.itcCode;
  const lower = trimmed.toLowerCase();
  const cacheKey = `${itc}:${lower}`;

  if (suggestionCache.has(cacheKey)) {
    return suggestionCache.get(cacheKey)!;
  }

  const candidatePool: string[] = [];

  // 1. User Custom Dictionary
  const userDict = getUserCustomDictionary(langConfig.code);
  if (userDict[lower]) {
    candidatePool.push(userDict[lower]);
  }

  // 2. Curated High-Frequency Indic Dictionary
  if (CURATED_INDIC_DICTIONARY[langConfig.name] && CURATED_INDIC_DICTIONARY[langConfig.name][lower]) {
    const curated = CURATED_INDIC_DICTIONARY[langConfig.name][lower];
    if (!candidatePool.includes(curated)) {
      candidatePool.push(curated);
    }
  }

  // 3. Online Google Input Tools, relayed by our server because the page's CSP
  // (connect-src 'self') blocks calling Google from the browser.
  let reachedOnline = false;
  try {
    const url = `/api/transliterate?text=${encodeURIComponent(trimmed)}&itc=${itc}&num=${numSuggestions}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data: { candidates?: string[] } = await res.json();
      const googleCandidates = data.candidates || [];
      reachedOnline = googleCandidates.length > 0;
      for (const gc of googleCandidates) {
        if (!candidatePool.includes(gc)) {
          candidatePool.push(gc);
        }
      }
    }
  } catch {
    // Network timeout or offline - gracefully proceed with local candidates
  }

  // 4. Offline Algorithmic Candidate
  const offlineOption = transliterateWordOffline(trimmed, language);
  if (offlineOption && !candidatePool.includes(offlineOption)) {
    candidatePool.push(offlineOption);
  }

  // 5. Always include original Roman English token as an explicit option
  if (!candidatePool.includes(trimmed)) {
    candidatePool.push(trimmed);
  }

  const finalCandidates = candidatePool.slice(0, Math.max(numSuggestions, 5));
  // An offline-only answer is not cached, so the word is looked up again once the network is back.
  if (reachedOnline) suggestionCache.set(cacheKey, finalCandidates);
  return finalCandidates;
}

/**
 * High-speed smart batch transliteration for entire sentences or cues
 */
export async function transliterateTextSmart(text: string, language: string): Promise<string> {
  if (!text) return '';

  const tokens = text.split(/([a-zA-Z]+)/);
  const convertedTokens = await Promise.all(
    tokens.map(async (token) => {
      if (/[a-zA-Z]/.test(token)) {
        const suggestions = await getPhoneticSuggestions(token, language, 1);
        return suggestions[0] || transliterateWordOffline(token, language);
      }
      return token;
    })
  );

  return convertedTokens.join('');
}


/**
 * Common Quick Cheat Sheet for Phonetic Typing (e.g. "k" -> क, "kh" -> ख, "sh" -> श)
 */
export const PHONETIC_CHEAT_SHEET: { roman: string; desc: string; sample: string }[] = [
  { roman: 'k / kh / g / gh', desc: 'Velar Consonants', sample: 'क / ख / ग / घ' },
  { roman: 'ch / chh / j / jh', desc: 'Palatal Consonants', sample: 'च / छ / ज / झ' },
  { roman: 't / th / d / dh / n', desc: 'Dental Consonants', sample: 'त / थ / द / ध / न' },
  { roman: 'T / Th / D / Dh / N', desc: 'Retroflex (Capital)', sample: 'ट / ठ / ड / ढ / ण' },
  { roman: 'p / ph,f / b / bh / m', desc: 'Labial Consonants', sample: 'प / फ / ब / भ / म' },
  { roman: 'sh / shh,Sh / s / h', desc: 'Sibilants & Aspirate', sample: 'श / ष / स / ह' },
  { roman: 'kya / tra / gya / shra', desc: 'Conjuncts (Yuktakshar)', sample: 'क्या / त्र / ज्ञ / श्र' },
  { roman: 'a / aa / i / ee / u / oo', desc: 'Vowels & Matras', sample: 'अ, आ, इ, ई, उ, ऊ' },
  { roman: 'e / ai / o / au', desc: 'Diphthongs', sample: 'ए, ऐ, ओ, औ' },
  { roman: 'M / H / Ri', desc: 'Anusvara, Visarga, Ri sign', sample: 'ं / ः / ृ' },
];
