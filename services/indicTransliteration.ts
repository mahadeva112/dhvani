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
// Mapping prefixes to Devanagari Unicode
interface ScriptRule {
  vowels: Record<string, string>;
  matras: Record<string, string>;
  consonants: Record<string, string>;
  halant: string;
  anusvara: string;
  visarga: string;
  nukta: string;
  chandrabindu: string;
}

const DEVANAGARI_RULE: ScriptRule = {
  vowels: {
    'aa': 'आ', 'a': 'अ', 'ee': 'ई', 'ii': 'ई', 'i': 'इ', 'oo': 'ऊ', 'uu': 'ऊ', 'u': 'उ',
    'ri': 'ऋ', 'e': 'ए', 'ai': 'ऐ', 'o': 'ओ', 'au': 'औ', 'ou': 'औ', 'am': 'अं', 'ah': 'अः'
  },
  matras: {
    'aa': 'ा', 'a': '', 'ee': 'ी', 'ii': 'ी', 'i': 'ि', 'oo': 'ू', 'uu': 'ू', 'u': 'ु',
    'ri': 'ृ', 'e': 'े', 'ai': 'ै', 'o': 'ो', 'au': 'ौ', 'ou': 'ौ', 'am': 'ं', 'ah': 'ः'
  },
  consonants: {
    'ksha': 'क्ष', 'kya': 'क्य', 'shra': 'श्र', 'tra': 'त्र', 'gya': 'ज्ञ', 'dnya': 'ज्ञ',
    'kh': 'ख', 'gh': 'घ', 'chh': 'छ', 'ch': 'च', 'jh': 'झ', 'th': 'थ', 'dh': 'ध',
    'ph': 'फ', 'bh': 'भ', 'sh': 'श', 'shh': 'ष', 'rh': 'ढ़',
    'k': 'क', 'g': 'ग', 'ng': 'ङ', 'c': 'च', 'j': 'ज', 'ny': 'ञ',
    'T': 'ट', 'Th': 'ठ', 'D': 'ड', 'Dh': 'ढ', 'N': 'ण',
    't': 'त', 'd': 'द', 'n': 'न', 'p': 'प', 'f': 'फ़', 'b': 'ब', 'm': 'म',
    'y': 'य', 'r': 'र', 'l': 'ल', 'v': 'व', 'w': 'व', 's': 'स', 'h': 'ह',
    'z': 'ज़', 'q': 'क़', 'x': 'क्स'
  },
  halant: '्',
  anusvara: 'ं',
  visarga: 'ः',
  nukta: '़',
  chandrabindu: 'ँ'
};

const BENGALI_RULE: ScriptRule = {
  vowels: {
    'aa': 'আ', 'a': 'অ', 'ee': 'ঈ', 'ii': 'ঈ', 'i': 'ই', 'oo': 'ঊ', 'uu': 'ঊ', 'u': 'উ',
    'ri': 'ঋ', 'e': 'এ', 'ai': 'ঐ', 'o': 'ও', 'au': 'ঔ', 'ou': 'ঔ', 'am': 'অং', 'ah': 'অঃ'
  },
  matras: {
    'aa': 'া', 'a': '', 'ee': 'ী', 'ii': 'ী', 'i': 'ি', 'oo': 'ূ', 'uu': 'ূ', 'u': 'ু',
    'ri': 'ৃ', 'e': 'ে', 'ai': 'ৈ', 'o': 'ো', 'au': 'ৌ', 'ou': 'ৌ', 'am': 'ং', 'ah': 'ঃ'
  },
  consonants: {
    'ksha': 'ক্ষ', 'shra': 'শ্র', 'tra': 'ত্র', 'gya': 'জ্ঞ',
    'kh': 'খ', 'gh': 'ঘ', 'chh': 'ছ', 'ch': 'চ', 'jh': 'ঝ', 'th': 'থ', 'dh': 'ধ',
    'ph': 'ফ', 'bh': 'ভ', 'sh': 'শ', 'shh': 'ষ', 'rh': 'ঢ়',
    'k': 'ক', 'g': 'গ', 'ng': 'ঙ', 'c': 'চ', 'j': 'জ', 'ny': 'ঞ',
    'T': 'ট', 'Th': 'ঠ', 'D': 'ড', 'Dh': 'ঢ', 'N': 'ণ',
    't': 'ত', 'd': 'দ', 'n': 'ন', 'p': 'প', 'f': 'ফ', 'b': 'ব', 'm': 'ম',
    'y': 'য', 'r': 'র', 'l': 'ল', 'v': 'ভ', 'w': 'ওয়', 's': 'স', 'h': 'হ'
  },
  halant: '্',
  anusvara: 'ং',
  visarga: 'ঃ',
  nukta: '়',
  chandrabindu: 'ঁ'
};

const TAMIL_RULE: ScriptRule = {
  vowels: {
    'aa': 'ஆ', 'a': 'அ', 'ee': 'ஈ', 'ii': 'ஈ', 'i': 'இ', 'oo': 'ஊ', 'uu': 'ஊ', 'u': 'உ',
    'e': 'எ', 'ee_long': 'ஏ', 'ai': 'ஐ', 'o': 'ஒ', 'oo_long': 'ஓ', 'au': 'ஔ'
  },
  matras: {
    'aa': 'ா', 'a': '', 'ee': 'ீ', 'ii': 'ீ', 'i': 'ி', 'oo': 'ூ', 'uu': 'ூ', 'u': 'ு',
    'e': 'ெ', 'ee_long': 'ே', 'ai': 'ை', 'o': 'ொ', 'oo_long': 'ோ', 'au': 'ௌ'
  },
  consonants: {
    'ksha': 'க்ஷ', 'shra': 'ஸ்ர', 'tra': 'த்ர',
    'kh': 'க', 'gh': 'க', 'chh': 'ச', 'ch': 'ச', 'jh': 'ஜ', 'th': 'த', 'dh': 'த',
    'ph': 'ப', 'bh': 'ப', 'sh': 'ஷ', 'shh': 'ஷ',
    'k': 'க', 'g': 'க', 'ng': 'ங', 'c': 'ச', 'j': 'ஜ', 'ny': 'ஞ',
    'T': 'ட', 'Th': 'ட', 'D': 'ட', 'Dh': 'ட', 'N': 'ண',
    't': 'த', 'd': 'த', 'n': 'ந', 'p': 'ப', 'f': 'ப', 'b': 'ப', 'm': 'ம',
    'y': 'ய', 'r': 'ர', 'l': 'ல', 'v': 'வ', 'w': 'வ', 's': 'ஸ', 'h': 'ஹ',
    'zh': 'ழ', 'L': 'ள', 'R': 'ற', 'nn': 'ன'
  },
  halant: '்',
  anusvara: 'ம்',
  visarga: 'ஃ',
  nukta: '',
  chandrabindu: ''
};

const TELUGU_RULE: ScriptRule = {
  vowels: {
    'aa': 'ఆ', 'a': 'అ', 'ee': 'ఈ', 'ii': 'ఈ', 'i': 'ఇ', 'oo': 'ఊ', 'uu': 'ఊ', 'u': 'ఉ',
    'ri': 'ఋ', 'e': 'ఎ', 'ai': 'ఐ', 'o': 'ఒ', 'au': 'ఔ', 'am': 'అం', 'ah': 'అః'
  },
  matras: {
    'aa': 'ా', 'a': '', 'ee': 'ీ', 'ii': 'ీ', 'i': 'ి', 'oo': 'ూ', 'uu': 'ూ', 'u': 'ు',
    'ri': 'ృ', 'e': 'ె', 'ai': 'ై', 'o': 'ొ', 'au': 'ౌ', 'am': 'ం', 'ah': 'ః'
  },
  consonants: {
    'ksha': 'క్ష', 'shra': 'శ్ర', 'tra': 'త్ర', 'gya': 'జ్ఞ',
    'kh': 'ఖ', 'gh': 'ఘ', 'chh': 'ఛ', 'ch': 'చ', 'jh': 'ఝ', 'th': 'థ', 'dh': 'ధ',
    'ph': 'ఫ', 'bh': 'భ', 'sh': 'శ', 'shh': 'ష',
    'k': 'క', 'g': 'గ', 'ng': 'ఙ', 'c': 'చ', 'j': 'జ', 'ny': 'ఞ',
    'T': 'ట', 'Th': 'ఠ', 'D': 'డ', 'Dh': 'ఢ', 'N': 'ణ',
    't': 'త', 'd': 'ద', 'n': 'న', 'p': 'ప', 'f': 'ఫ', 'b': 'బ', 'm': 'మ',
    'y': 'య', 'r': 'ర', 'l': 'ల', 'v': 'వ', 'w': 'వ', 's': 'స', 'h': 'హ', 'L': 'ళ'
  },
  halant: '్',
  anusvara: 'ం',
  visarga: 'ః',
  nukta: '',
  chandrabindu: ''
};

const GUJARATI_RULE: ScriptRule = {
  vowels: {
    'aa': 'આ', 'a': 'અ', 'ee': 'ઈ', 'ii': 'ઈ', 'i': 'ઇ', 'oo': 'ઊ', 'uu': 'ઊ', 'u': 'ઉ',
    'ri': 'ઋ', 'e': 'એ', 'ai': 'ઐ', 'o': 'ઓ', 'au': 'ઔ', 'am': 'અં', 'ah': 'અઃ'
  },
  matras: {
    'aa': 'ા', 'a': '', 'ee': 'ી', 'ii': 'ી', 'i': 'િ', 'oo': 'ૂ', 'uu': 'ૂ', 'u': 'ુ',
    'ri': 'ૃ', 'e': 'ે', 'ai': 'ૈ', 'o': 'ો', 'au': 'ૌ', 'am': 'ં', 'ah': 'ઃ'
  },
  consonants: {
    'ksha': 'ક્ષ', 'shra': 'શ્ર', 'tra': 'ત્ર', 'gya': 'જ્ઞ',
    'kh': 'ખ', 'gh': 'ઘ', 'chh': 'છ', 'ch': 'ચ', 'jh': 'ઝ', 'th': 'થ', 'dh': 'ધ',
    'ph': 'ફ', 'bh': 'ભ', 'sh': 'શ', 'shh': 'ષ',
    'k': 'ક', 'g': 'ગ', 'ng': 'ઙ', 'c': 'ચ', 'j': 'જ', 'ny': 'ઞ',
    'T': 'ટ', 'Th': 'ઠ', 'D': 'ડ', 'Dh': 'ઢ', 'N': 'ણ',
    't': 'ત', 'd': 'દ', 'n': 'ન', 'p': 'પ', 'f': 'ફ', 'b': 'બ', 'm': 'મ',
    'y': 'ય', 'r': 'ર', 'l': 'લ', 'v': 'વ', 'w': 'વ', 's': 'સ', 'h': 'હ', 'L': 'ળ'
  },
  halant: '્',
  anusvara: 'ં',
  visarga: 'ઃ',
  nukta: '',
  chandrabindu: 'ઁ'
};

const KANNADA_RULE: ScriptRule = {
  vowels: {
    'aa': 'ಆ', 'a': 'ಅ', 'ee': 'ಈ', 'ii': 'ಈ', 'i': 'ಇ', 'oo': 'ಊ', 'uu': 'ಊ', 'u': 'ಉ',
    'ri': 'ಋ', 'e': 'ಎ', 'ai': 'ಐ', 'o': 'ಒ', 'au': 'ಔ', 'am': 'ಅಂ', 'ah': 'ಅಃ'
  },
  matras: {
    'aa': 'ಾ', 'a': '', 'ee': 'ೀ', 'ii': 'ೀ', 'i': 'ಿ', 'oo': 'ೂ', 'uu': 'ೂ', 'u': 'ು',
    'ri': 'ೃ', 'e': 'ೆ', 'ai': 'ೈ', 'o': 'ೊ', 'au': 'ೌ', 'am': 'ಂ', 'ah': 'ಃ'
  },
  consonants: {
    'ksha': 'ಕ್ಷ', 'shra': 'ಶ್ರ', 'tra': 'ತ್ರ', 'gya': 'ಜ್ಞ',
    'kh': 'ಖ', 'gh': 'ಘ', 'chh': 'ಛ', 'ch': 'ಚ', 'jh': 'ಝ', 'th': 'ಥ', 'dh': 'ಧ',
    'ph': 'ಫ', 'bh': 'ಭ', 'sh': 'ಶ', 'shh': 'ಷ',
    'k': 'ಕ', 'g': 'ಗ', 'ng': 'ಙ', 'c': 'ಚ', 'j': 'ಜ', 'ny': 'ಞ',
    'T': 'ಟ', 'Th': 'ಠ', 'D': 'ಡ', 'Dh': 'ಢ', 'N': 'ಣ',
    't': 'ತ', 'd': 'ದ', 'n': 'ನ', 'p': 'ಪ', 'f': 'ಫ', 'b': 'ಬ', 'm': 'ಮ',
    'y': 'ಯ', 'r': 'ರ', 'l': 'ಲ', 'v': 'ವ', 'w': 'ವ', 's': 'ಸ', 'h': 'ಹ', 'L': 'ಳ'
  },
  halant: '್',
  anusvara: 'ಂ',
  visarga: 'ಃ',
  nukta: '',
  chandrabindu: ''
};

const MALAYALAM_RULE: ScriptRule = {
  vowels: {
    'aa': 'ആ', 'a': 'അ', 'ee': 'ഈ', 'ii': 'ഈ', 'i': 'ഇ', 'oo': 'ഊ', 'uu': 'ഊ', 'u': 'ഉ',
    'ri': 'ഋ', 'e': 'എ', 'ai': 'ഐ', 'o': 'ഒ', 'au': 'ഔ', 'am': 'അം', 'ah': 'അഃ'
  },
  matras: {
    'aa': 'ാ', 'a': '', 'ee': 'ീ', 'ii': 'ീ', 'i': 'ി', 'oo': 'ൂ', 'uu': 'ൂ', 'u': 'ു',
    'ri': 'ൃ', 'e': 'െ', 'ai': 'ൈ', 'o': 'ൊ', 'au': 'ൌ', 'am': 'ം', 'ah': 'ഃ'
  },
  consonants: {
    'ksha': 'ക്ഷ', 'shra': 'ശ്ര', 'tra': 'ത്ര', 'gya': 'ജ്ഞ',
    'kh': 'ഖ', 'gh': 'ഘ', 'chh': 'ഛ', 'ch': 'ച', 'jh': 'ഝ', 'th': 'ഥ', 'dh': 'ധ',
    'ph': 'ഫ', 'bh': 'ഭ', 'sh': 'ശ', 'shh': 'ഷ',
    'k': 'ക', 'g': 'ഗ', 'ng': 'ങ', 'c': 'ച', 'j': 'ജ', 'ny': 'ഞ',
    'T': 'ട', 'Th': 'ഠ', 'D': 'ഡ', 'Dh': 'ഢ', 'N': 'ണ',
    't': 'ത', 'd': 'ദ', 'n': 'ന', 'p': 'പ', 'f': 'ഫ', 'b': 'ബ', 'm': 'മ',
    'y': 'യ', 'r': 'ര', 'l': 'ല', 'v': 'വ', 'w': 'വ', 's': 'സ', 'h': 'ഹ',
    'zh': 'ഴ', 'L': 'ള', 'R': 'റ'
  },
  halant: '്',
  anusvara: 'ം',
  visarga: 'ഃ',
  nukta: '',
  chandrabindu: ''
};

const GURMUKHI_RULE: ScriptRule = {
  vowels: {
    'aa': 'ਆ', 'a': 'ਅ', 'ee': 'ਈ', 'ii': 'ਈ', 'i': 'ਇ', 'oo': 'ਊ', 'uu': 'ਊ', 'u': 'ਉ',
    'e': 'ਏ', 'ai': 'ਐ', 'o': 'ਓ', 'au': 'ਔ', 'am': 'ਅੰ'
  },
  matras: {
    'aa': 'ਾ', 'a': '', 'ee': 'ੀ', 'ii': 'ੀ', 'i': 'ਿ', 'oo': 'ੂ', 'uu': 'ੂ', 'u': 'ੁ',
    'e': 'ੇ', 'ai': 'ੈ', 'o': 'ੋ', 'au': 'ੌ', 'am': 'ਂ'
  },
  consonants: {
    'kh': 'ਖ', 'gh': 'ਘ', 'chh': 'ਛ', 'ch': 'ਚ', 'jh': 'ਝ', 'th': 'ਥ', 'dh': 'ਧ',
    'ph': 'ਫ', 'bh': 'ਭ', 'sh': 'ਸ਼',
    'k': 'ਕ', 'g': 'ਗ', 'ng': 'ਙ', 'c': 'ਚ', 'j': 'ਜ', 'ny': 'ਞ',
    'T': 'ਟ', 'Th': 'ਠ', 'D': 'ਡ', 'Dh': 'ਢ', 'N': 'ਣ',
    't': 'ਤ', 'd': 'ਦ', 'n': 'ਨ', 'p': 'ਪ', 'f': 'ਫ਼', 'b': 'ਬ', 'm': 'ਮ',
    'y': 'ਯ', 'r': 'ਰ', 'l': 'ਲ', 'v': 'ਵ', 'w': 'ਵ', 's': 'ਸ', 'h': 'ਹ',
    'z': 'ਜ਼', 'q': 'ਕ'
  },
  halant: '੍',
  anusvara: 'ਂ',
  visarga: '',
  nukta: '਼',
  chandrabindu: 'ਁ'
};

const ODIA_RULE: ScriptRule = {
  vowels: {
    'aa': 'ଆ', 'a': 'ଅ', 'ee': 'ଈ', 'ii': 'ଈ', 'i': 'ଇ', 'oo': 'ଊ', 'uu': 'ଊ', 'u': 'ଉ',
    'ri': 'ଋ', 'e': 'ଏ', 'ai': 'ଐ', 'o': 'ଓ', 'au': 'ଔ', 'am': 'ଅଂ', 'ah': 'ଅଃ'
  },
  matras: {
    'aa': 'ା', 'a': '', 'ee': 'ୀ', 'ii': 'ୀ', 'i': 'ି', 'oo': 'ୂ', 'uu': 'ୂ', 'u': 'ୁ',
    'ri': 'ୃ', 'e': 'େ', 'ai': 'ୈ', 'o': 'ୋ', 'au': 'ୌ', 'am': 'ଂ', 'ah': 'ଃ'
  },
  consonants: {
    'ksha': 'କ୍ଷ', 'shra': 'ଶ୍ର', 'tra': 'ତ୍ର', 'gya': 'ଜ୍ଞ',
    'kh': 'ଖ', 'gh': 'ଘ', 'chh': 'ଛ', 'ch': 'ଚ', 'jh': 'ଝ', 'th': 'ଥ', 'dh': 'ଧ',
    'ph': 'ଫ', 'bh': 'ଭ', 'sh': 'ଶ', 'shh': 'ଷ',
    'k': 'କ', 'g': 'ଗ', 'ng': 'ଙ', 'c': 'ଚ', 'j': 'ଜ', 'ny': 'ଞ',
    'T': 'ଟ', 'Th': 'ଠ', 'D': 'ଡ', 'Dh': 'ଢ', 'N': 'ଣ',
    't': 'ତ', 'd': 'ଦ', 'n': 'ନ', 'p': 'ପ', 'f': 'ଫ', 'b': 'ବ', 'm': 'ମ',
    'y': 'ଯ', 'r': 'ର', 'l': 'ଲ', 'v': 'ୱ', 'w': 'ୱ', 's': 'ସ', 'h': 'ହ', 'L': 'ଳ'
  },
  halant: '୍',
  anusvara: 'ଂ',
  visarga: 'ଃ',
  nukta: '',
  chandrabindu: 'ଁ'
};

function getRuleForLanguage(langName: string): ScriptRule {
  const norm = langName.toLowerCase();
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

/**
 * OFFLINE ALGORITHMIC TRANSLITERATOR
 * Converts Roman English syllables to Indic Script with high accuracy
 */
export function transliterateWordOffline(word: string, language: string): string {
  if (!word) return '';

  const cleanWord = word.trim();
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

  const rule = getRuleForLanguage(language);
  let result = '';
  let i = 0;
  const len = cleanWord.length;

  const sortedConsonants = Object.keys(rule.consonants).sort((a, b) => b.length - a.length);
  const sortedMatras = Object.keys(rule.matras).sort((a, b) => b.length - a.length);
  const sortedVowels = Object.keys(rule.vowels).sort((a, b) => b.length - a.length);

  while (i < len) {
    const remaining = cleanWord.slice(i);
    const lowerRemaining = remaining.toLowerCase();

    // 1. Check for standalone punctuation or numbers
    if (/^[0-9\s.,!?:;'"()\-]/.test(remaining[0])) {
      result += remaining[0];
      i += 1;
      continue;
    }

    // 2. Check if starts with a consonant
    let matchedConsonant: string | null = null;
    let consLen = 0;

    for (const c of sortedConsonants) {
      if (lowerRemaining.startsWith(c.toLowerCase())) {
        matchedConsonant = rule.consonants[c];
        consLen = c.length;
        break;
      }
    }

    if (matchedConsonant) {
      result += matchedConsonant;
      i += consLen;

      // Check if followed by vowel/matra
      const afterCons = cleanWord.slice(i).toLowerCase();
      let matchedMatra: string | null = null;
      let matraLen = 0;

      for (const m of sortedMatras) {
        if (afterCons.startsWith(m)) {
          matchedMatra = rule.matras[m];
          matraLen = m.length;
          break;
        }
      }

      if (matchedMatra !== null) {
        // Special case: In Indic phonetic typing, if a word ends in 'a' after a consonant (like "mera", "tera", "kaha", "bhaiya")
        // and matchedMatra was empty string (inherent 'a'), but it is at the terminal end of the word,
        // it signifies the explicit 'aa' / 'ा' matra!
        if (matraLen === 1 && afterCons[0] === 'a' && i + 1 === len && rule.matras['aa']) {
          result += rule.matras['aa'];
        } else {
          result += matchedMatra;
        }
        i += matraLen;
      } else {
        // If followed immediately by another consonant without vowel, insert halant to form conjunct!
        if (i < len && /[a-zA-Z]/.test(cleanWord[i])) {
          result += rule.halant;
        }
      }
      continue;
    }

    // 3. Check for standalone vowel
    let matchedVowel: string | null = null;
    let vowLen = 0;

    for (const v of sortedVowels) {
      if (lowerRemaining.startsWith(v.toLowerCase())) {
        matchedVowel = rule.vowels[v];
        vowLen = v.length;
        break;
      }
    }

    if (matchedVowel) {
      result += matchedVowel;
      i += vowLen;
      continue;
    }

    // Fallback char
    result += remaining[0];
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

  // 3. Online Google Input Tools (High-Accuracy Industry Standard)
  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(
      trimmed
    )}&itc=${itc}&num=${numSuggestions}&cp=0&cs=1&ie=utf-8&oe=utf-8`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
        const googleCandidates: string[] = data[1][0][1];
        for (const gc of googleCandidates) {
          if (!candidatePool.includes(gc)) {
            candidatePool.push(gc);
          }
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
  suggestionCache.set(cacheKey, finalCandidates);
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
  { roman: 'e / ai / o / au / am', desc: 'Diphthongs & Nasals', sample: 'ए, ऐ, ओ, औ, अं' },
];
