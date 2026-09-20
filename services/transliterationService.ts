/**
 * Indic Phonetic Transliteration Engine
 * Converts Roman Script (English phonetics) to Indian Scripts:
 * - Devanagari (Hindi, Marathi, Sanskrit, Nepali, Konkani, Bodo, Dogri, Maithili)
 * - Bengali (বাংলা) & Assamese (অসমীয়া)
 * - Tamil (தமிழ்)
 * - Telugu (తెలుగు)
 * - Kannada (ಕನ್ನಡ)
 * - Malayalam (മലയാളം)
 * - Gujarati (ગુજરાતી)
 * - Gurmukhi (Punjabi - ਪੰਜਾਬੀ)
 * - Odia (ଓଡ଼ିଆ)
 * - Urdu (اردو)
 */

import {
  CURATED_INDIC_DICTIONARY,
  getUserCustomDictionary,
  getIndicLanguageConfig,
  getPhoneticSuggestions as getIndicSuggestions,
} from './indicTransliteration';

export interface ScriptDefinition {

  code: string;
  name: string;
  nativeName: string;
  vowels: Record<string, string>;
  matras: Record<string, string>;
  consonants: Record<string, string>;
  virama: string;
  anusvara: string;
  visarga: string;
  candrabindu?: string;
  nukta?: string;
  numerals: string[];
  sampleWords: { roman: string; native: string }[];
}

// 1. DEVANAGARI (Hindi, Marathi, Sanskrit, Nepali, etc.)
const DEVANAGARI: ScriptDefinition = {
  code: 'devanagari',
  name: 'Hindi / Devanagari',
  nativeName: 'हिन्दी / देवनागरी',
  virama: '्',
  anusvara: 'ं',
  visarga: 'ः',
  candrabindu: 'ँ',
  nukta: '़',
  numerals: ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'],
  vowels: {
    a: 'अ',
    aa: 'आ',
    A: 'आ',
    i: 'इ',
    ee: 'ई',
    ii: 'ई',
    I: 'ई',
    u: 'उ',
    oo: 'ऊ',
    uu: 'ऊ',
    U: 'ऊ',
    ri: 'ऋ',
    R: 'ऋ',
    e: 'ए',
    ai: 'ऐ',
    ei: 'ऐ',
    o: 'ओ',
    au: 'औ',
    ou: 'औ',
    am: 'अं',
    ah: 'अः',
  },
  matras: {
    aa: 'ा',
    A: 'ा',
    i: 'ि',
    ee: 'ी',
    ii: 'ी',
    I: 'ी',
    u: 'ु',
    oo: 'ू',
    uu: 'ू',
    U: 'ू',
    ri: 'ृ',
    R: 'ृ',
    e: 'े',
    ai: 'ै',
    ei: 'ै',
    o: 'ो',
    au: 'ौ',
    ou: 'ौ',
  },
  consonants: {
    k: 'क',
    kh: 'ख',
    g: 'ग',
    gh: 'घ',
    ng: 'ङ',
    ch: 'च',
    chh: 'छ',
    Ch: 'छ',
    j: 'ज',
    jh: 'झ',
    z: 'ज़',
    ny: 'ञ',
    t: 'त',
    th: 'थ',
    T: 'ट',
    Th: 'ठ',
    d: 'द',
    dh: 'ध',
    D: 'ड',
    Dh: 'ढ',
    N: 'ण',
    n: 'न',
    p: 'प',
    ph: 'फ',
    f: 'फ़',
    F: 'फ़',
    b: 'ब',
    bh: 'भ',
    m: 'म',
    y: 'य',
    r: 'र',
    l: 'ल',
    L: 'ळ',
    v: 'व',
    w: 'व',
    sh: 'श',
    Sh: 'ष',
    s: 'स',
    h: 'ह',
    ksh: 'क्ष',
    tr: 'त्र',
    gy: 'ज्ञ',
    jny: 'ज्ञ',
    shr: 'श्र',
    q: 'क़',
    rh: 'ढ़',
    rd: 'ड़',
  },
  sampleWords: [
    { roman: 'namaste', native: 'नमस्ते' },
    { roman: 'kaise ho', native: 'कैसे हो' },
    { roman: 'dhanyawad', native: 'धन्यवाद' },
    { roman: 'shukriya', native: 'शुक्रिया' },
    { roman: 'bharat', native: 'भारत' },
    { roman: 'audio dubbing', native: 'ऑडियो डबिंग' },
  ],
};

// 2. BENGALI & ASSAMESE
const BENGALI: ScriptDefinition = {
  code: 'bengali',
  name: 'Bengali / Assamese',
  nativeName: 'বাংলা / অসমীয়া',
  virama: '্',
  anusvara: 'ং',
  visarga: 'ঃ',
  candrabindu: 'ঁ',
  nukta: '়',
  numerals: ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
  vowels: {
    a: 'অ',
    aa: 'আ',
    A: 'আ',
    i: 'ই',
    ee: 'ঈ',
    ii: 'ঈ',
    I: 'ঈ',
    u: 'উ',
    oo: 'ঊ',
    uu: 'ঊ',
    U: 'ঊ',
    ri: 'ঋ',
    e: 'এ',
    ai: 'ঐ',
    ei: 'ঐ',
    o: 'ও',
    au: 'ঔ',
    ou: 'ঔ',
    am: 'অং',
    ah: 'অঃ',
  },
  matras: {
    aa: 'া',
    A: 'া',
    i: 'ি',
    ee: 'ী',
    ii: 'ী',
    I: 'ী',
    u: 'ু',
    oo: 'ূ',
    uu: 'ূ',
    U: 'ূ',
    ri: 'ৃ',
    e: 'ে',
    ai: 'ৈ',
    ei: 'ৈ',
    o: 'ো',
    au: 'ৌ',
    ou: 'ৌ',
  },
  consonants: {
    k: 'ক',
    kh: 'খ',
    g: 'গ',
    gh: 'ঘ',
    ng: 'ঙ',
    ch: 'চ',
    chh: 'ছ',
    Ch: 'ছ',
    j: 'জ',
    jh: 'ঝ',
    z: 'য',
    ny: 'ঞ',
    t: 'ত',
    th: 'থ',
    T: 'ট',
    Th: 'ঠ',
    d: 'দ',
    dh: 'ধ',
    D: 'ড',
    Dh: 'ঢ',
    N: 'ণ',
    n: 'ন',
    p: 'প',
    ph: 'ফ',
    f: 'ফ',
    F: 'ফ',
    b: 'ব',
    bh: 'ভ',
    m: 'ম',
    y: 'য়',
    r: 'র',
    l: 'ল',
    w: 'ওয়',
    v: 'ভ',
    sh: 'শ',
    Sh: 'ষ',
    s: 'স',
    h: 'হ',
    ksh: 'ক্ষ',
    gy: 'জ্ঞ',
  },
  sampleWords: [
    { roman: 'nomoshkar', native: 'নমস্কার' },
    { roman: 'dhonyobad', native: 'ধন্যবাদ' },
    { roman: 'kemon achen', native: 'কেমন আছেন' },
    { roman: 'bangla', native: 'বাংলা' },
  ],
};

// 3. TAMIL
const TAMIL: ScriptDefinition = {
  code: 'tamil',
  name: 'Tamil',
  nativeName: 'தமிழ்',
  virama: '்',
  anusvara: 'ஂ',
  visarga: 'ஃ',
  numerals: ['௦', '௧', '௨', '௩', '௪', '௫', '௬', '௭', '௮', '௯'],
  vowels: {
    a: 'அ',
    aa: 'ஆ',
    A: 'ஆ',
    i: 'இ',
    ee: 'ஈ',
    ii: 'ஈ',
    I: 'ஈ',
    u: 'உ',
    oo: 'ஊ',
    uu: 'ஊ',
    U: 'ஊ',
    e: 'எ',
    E: 'ஏ',
    eeh: 'ஏ',
    ai: 'ஐ',
    o: 'ஒ',
    O: 'ஓ',
    au: 'ஔ',
    ou: 'ஔ',
  },
  matras: {
    aa: 'ா',
    A: 'ா',
    i: 'ி',
    ee: 'ீ',
    ii: 'ீ',
    I: 'ீ',
    u: 'ு',
    oo: 'ூ',
    uu: 'ூ',
    U: 'ூ',
    e: 'ெ',
    E: 'ே',
    eeh: 'ே',
    ai: 'ை',
    o: 'ொ',
    O: 'ோ',
    au: 'ௌ',
    ou: 'ௌ',
  },
  consonants: {
    k: 'க',
    g: 'க',
    kh: 'க',
    gh: 'க',
    ng: 'ங',
    ch: 'ச',
    s: 'ஸ',
    sh: 'ஷ',
    j: 'ஜ',
    ny: 'ஞ',
    t: 'த',
    th: 'த',
    T: 'ட',
    d: 'ட',
    Th: 'ட',
    N: 'ண',
    n: 'ந',
    nh: 'ன',
    p: 'ப',
    b: 'ப',
    ph: 'ப',
    f: 'ப',
    m: 'ம',
    y: 'ய',
    r: 'ர',
    R: 'ற',
    l: 'ல',
    L: 'ள',
    zh: 'ழ',
    v: 'வ',
    w: 'வ',
    h: 'ஹ',
    ksh: 'க்ஷ',
    sr: 'ஸ்ரீ',
  },
  sampleWords: [
    { roman: 'vanakkam', native: 'வணக்கம்' },
    { roman: 'nandri', native: 'நன்றி' },
    { roman: 'eppadi irukkinga', native: 'எப்படி இருக்கீங்க' },
    { roman: 'tamil', native: 'தமிழ்' },
  ],
};

// 4. TELUGU
const TELUGU: ScriptDefinition = {
  code: 'telugu',
  name: 'Telugu',
  nativeName: 'తెలుగు',
  virama: '్',
  anusvara: 'ం',
  visarga: 'ః',
  candrabindu: 'ఁ',
  numerals: ['౦', '౧', '౨', '౩', '౪', '౫', '౬', '౭', '౮', '౯'],
  vowels: {
    a: 'అ',
    aa: 'ఆ',
    A: 'ఆ',
    i: 'ఇ',
    ee: 'ఈ',
    ii: 'ఈ',
    I: 'ఈ',
    u: 'ఉ',
    oo: 'ఊ',
    uu: 'ఊ',
    U: 'ఊ',
    ri: 'ఋ',
    e: 'ఎ',
    E: 'ఏ',
    ai: 'ఐ',
    o: 'ఒ',
    O: 'ఓ',
    au: 'ఔ',
    ou: 'ఔ',
    am: 'అం',
    ah: 'అః',
  },
  matras: {
    aa: 'ా',
    A: 'ా',
    i: 'ి',
    ee: 'ీ',
    ii: 'ీ',
    I: 'ీ',
    u: 'ు',
    oo: 'ూ',
    uu: 'ూ',
    U: 'ూ',
    ri: 'ృ',
    e: 'ె',
    E: 'ే',
    ai: 'ై',
    o: 'ొ',
    O: 'ో',
    au: 'ౌ',
    ou: 'ౌ',
  },
  consonants: {
    k: 'క',
    kh: 'ఖ',
    g: 'గ',
    gh: 'ఘ',
    ng: 'ఙ',
    ch: 'చ',
    chh: 'ఛ',
    j: 'జ',
    jh: 'ఝ',
    ny: 'ఞ',
    t: 'త',
    th: 'థ',
    T: 'ట',
    Th: 'ఠ',
    d: 'ద',
    dh: 'ధ',
    D: 'డ',
    Dh: 'ఢ',
    N: 'ణ',
    n: 'న',
    p: 'ప',
    ph: 'ఫ',
    f: 'ఫ',
    b: 'బ',
    bh: 'భ',
    m: 'మ',
    y: 'య',
    r: 'ర',
    l: 'ల',
    L: 'ళ',
    v: 'వ',
    w: 'వ',
    sh: 'శ',
    Sh: 'ష',
    s: 'స',
    h: 'హ',
    ksh: 'క్ష',
    gy: 'జ్ఞ',
  },
  sampleWords: [
    { roman: 'namaskaram', native: 'నమస్కారం' },
    { roman: 'bagunnara', native: 'బాగున్నారా' },
    { roman: 'dhanyavadalu', native: 'ధన్యవాదాలు' },
    { roman: 'telugu', native: 'తెలుగు' },
  ],
};

// 5. KANNADA
const KANNADA: ScriptDefinition = {
  code: 'kannada',
  name: 'Kannada',
  nativeName: 'ಕನ್ನಡ',
  virama: '್',
  anusvara: 'ಂ',
  visarga: 'ಃ',
  numerals: ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'],
  vowels: {
    a: 'ಅ',
    aa: 'ಆ',
    A: 'ಆ',
    i: 'ಇ',
    ee: 'ಈ',
    ii: 'ಈ',
    I: 'ಈ',
    u: 'ಉ',
    oo: 'ಊ',
    uu: 'ಊ',
    U: 'ಊ',
    ri: 'ಋ',
    e: 'ಎ',
    E: 'ಏ',
    ai: 'ಐ',
    o: 'ಒ',
    O: 'ಓ',
    au: 'ಔ',
    ou: 'ಔ',
    am: 'ಅಂ',
    ah: 'ಅಃ',
  },
  matras: {
    aa: 'ಾ',
    A: 'ಾ',
    i: 'ಿ',
    ee: 'ೀ',
    ii: 'ೀ',
    I: 'ೀ',
    u: 'ು',
    oo: 'ೂ',
    uu: 'ೂ',
    U: 'ೂ',
    ri: 'ೃ',
    e: 'ೆ',
    E: 'ೇ',
    ai: 'ೈ',
    o: 'ೊ',
    O: 'ೋ',
    au: 'ೌ',
    ou: 'ೌ',
  },
  consonants: {
    k: 'ಕ',
    kh: 'ಖ',
    g: 'ಗ',
    gh: 'ಘ',
    ng: 'ಙ',
    ch: 'ಚ',
    chh: 'ಛ',
    j: 'ಜ',
    jh: 'ಝ',
    ny: 'ಞ',
    t: 'ತ',
    th: 'ಥ',
    T: 'ಟ',
    Th: 'ಠ',
    d: 'ದ',
    dh: 'ಧ',
    D: 'ಡ',
    Dh: 'ಢ',
    N: 'ಣ',
    n: 'ನ',
    p: 'ಪ',
    ph: 'ಫ',
    f: 'ಫ',
    b: 'ಬ',
    bh: 'ಭ',
    m: 'ಮ',
    y: 'ಯ',
    r: 'ರ',
    l: 'ಲ',
    L: 'ಳ',
    v: 'ವ',
    w: 'ವ',
    sh: 'ಶ',
    Sh: 'ಷ',
    s: 'ಸ',
    h: 'ಹ',
    ksh: 'ಕ್ಷ',
    gy: 'ಜ್ಞ',
  },
  sampleWords: [
    { roman: 'namaskara', native: 'ನಮಸ್ಕಾರ' },
    { roman: 'hegiddeera', native: 'ಹೇಗಿದ್ದೀರಾ' },
    { roman: 'dhanyavadagalu', native: 'ಧನ್ಯವಾದಗಳು' },
    { roman: 'kannada', native: 'ಕನ್ನಡ' },
  ],
};

// 6. MALAYALAM
const MALAYALAM: ScriptDefinition = {
  code: 'malayalam',
  name: 'Malayalam',
  nativeName: 'മലയാളം',
  virama: '്',
  anusvara: 'ം',
  visarga: 'ഃ',
  numerals: ['൦', '൧', '൨', '൩', '൪', '൫', '൬', '൭', '൮', '൯'],
  vowels: {
    a: 'അ',
    aa: 'ആ',
    A: 'ആ',
    i: 'ഇ',
    ee: 'ഈ',
    ii: 'ഈ',
    I: 'ഈ',
    u: 'ഉ',
    oo: 'ഊ',
    uu: 'ഊ',
    U: 'ഊ',
    ri: 'ഋ',
    e: 'എ',
    E: 'ഏ',
    ai: 'ഐ',
    o: 'ഒ',
    O: 'ഓ',
    au: 'ഔ',
    ou: 'ഔ',
    am: 'അം',
    ah: 'അഃ',
  },
  matras: {
    aa: 'ാ',
    A: 'ാ',
    i: 'ി',
    ee: 'ീ',
    ii: 'ീ',
    I: 'ീ',
    u: 'ു',
    oo: 'ൂ',
    uu: 'ൂ',
    U: 'ൂ',
    ri: 'ൃ',
    e: 'െ',
    E: 'േ',
    ai: 'ൈ',
    o: 'ൊ',
    O: 'ോ',
    au: 'ൌ',
    ou: 'ൌ',
  },
  consonants: {
    k: 'ക',
    kh: 'ഖ',
    g: 'ഗ',
    gh: 'ഘ',
    ng: 'ങ',
    ch: 'ച',
    chh: 'ഛ',
    j: 'ജ',
    jh: 'ഝ',
    ny: 'ഞ',
    t: 'ത',
    th: 'ഥ',
    T: 'ട',
    Th: 'ഠ',
    d: 'ദ',
    dh: 'ധ',
    D: 'ഡ',
    Dh: 'ഢ',
    N: 'ണ',
    n: 'ന',
    p: 'പ',
    ph: 'ഫ',
    f: 'ഫ',
    b: 'ബ',
    bh: 'ഭ',
    m: 'മ',
    y: 'യ',
    r: 'ര',
    R: 'റ',
    l: 'ല',
    L: 'ള',
    zh: 'ഴ',
    v: 'വ',
    w: 'വ',
    sh: 'ശ',
    Sh: 'ഷ',
    s: 'സ',
    h: 'ഹ',
    ksh: 'ക്ഷ',
  },
  sampleWords: [
    { roman: 'namaskaram', native: 'നമസ്കാരം' },
    { roman: 'sukhamaano', native: 'സുഖമാണോ' },
    { roman: 'nandi', native: 'നന്ദി' },
    { roman: 'malayalam', native: 'മലയാളം' },
  ],
};

// 7. GUJARATI
const GUJARATI: ScriptDefinition = {
  code: 'gujarati',
  name: 'Gujarati',
  nativeName: 'ગુજરાતી',
  virama: '્',
  anusvara: 'ં',
  visarga: 'ઃ',
  candrabindu: 'ઁ',
  nukta: '઼',
  numerals: ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'],
  vowels: {
    a: 'અ',
    aa: 'આ',
    A: 'આ',
    i: 'ઇ',
    ee: 'ઈ',
    ii: 'ઈ',
    I: 'ઈ',
    u: 'ઉ',
    oo: 'ઊ',
    uu: 'ઊ',
    U: 'ઊ',
    ri: 'ઋ',
    e: 'એ',
    ai: 'ઐ',
    o: 'ઓ',
    au: 'ઔ',
    ou: 'ઔ',
    am: 'અં',
    ah: 'અઃ',
  },
  matras: {
    aa: 'ા',
    A: 'ા',
    i: 'િ',
    ee: 'ી',
    ii: 'ી',
    I: 'ી',
    u: 'ુ',
    oo: 'ૂ',
    uu: 'ૂ',
    U: 'ૂ',
    ri: 'ૃ',
    e: 'ે',
    ai: 'ૈ',
    o: 'ો',
    au: 'ૌ',
    ou: 'ૌ',
  },
  consonants: {
    k: 'ક',
    kh: 'ખ',
    g: 'ગ',
    gh: 'ઘ',
    ng: 'ઙ',
    ch: 'ચ',
    chh: 'છ',
    j: 'જ',
    jh: 'ઝ',
    ny: 'ઞ',
    t: 'ત',
    th: 'થ',
    T: 'ટ',
    Th: 'ઠ',
    d: 'દ',
    dh: 'ધ',
    D: 'ડ',
    Dh: 'ઢ',
    N: 'ણ',
    n: 'ન',
    p: 'પ',
    ph: 'ફ',
    f: 'ફ',
    b: 'બ',
    bh: 'ભ',
    m: 'મ',
    y: 'ય',
    r: 'ર',
    l: 'લ',
    L: 'ળ',
    v: 'વ',
    w: 'વ',
    sh: 'શ',
    Sh: 'ષ',
    s: 'સ',
    h: 'હ',
    ksh: 'ક્ષ',
    gy: 'જ્ઞ',
  },
  sampleWords: [
    { roman: 'namaste', native: 'નમસ્તે' },
    { roman: 'kem cho', native: 'કેમ છો' },
    { roman: 'aabhar', native: 'આભાર' },
    { roman: 'gujarat', native: 'ગુજરાત' },
  ],
};

// 8. PUNJABI (GURMUKHI)
const PUNJABI: ScriptDefinition = {
  code: 'punjabi',
  name: 'Punjabi (Gurmukhi)',
  nativeName: 'ਪੰਜਾਬੀ (ਗੁਰਮੁਖੀ)',
  virama: '੍',
  anusvara: 'ਂ',
  visarga: 'ਃ',
  candrabindu: 'ਁ',
  numerals: ['੦', '੧', '੨', '੩', '੪', '੫', '੬', '੭', '੮', '੯'],
  vowels: {
    a: 'ਅ',
    aa: 'ਆ',
    A: 'ਆ',
    i: 'ਇ',
    ee: 'ਈ',
    ii: 'ਈ',
    I: 'ਈ',
    u: 'ਉ',
    oo: 'ਊ',
    uu: 'ਊ',
    U: 'ਊ',
    e: 'ਏ',
    ai: 'ਐ',
    o: 'ਓ',
    au: 'ਔ',
    ou: 'ਔ',
  },
  matras: {
    aa: 'ਾ',
    A: 'ਾ',
    i: 'ਿ',
    ee: 'ੀ',
    ii: 'ੀ',
    I: 'ੀ',
    u: 'ੁ',
    oo: 'ੂ',
    uu: 'ੂ',
    U: 'ੂ',
    e: 'ੇ',
    ai: 'ੈ',
    o: 'ੋ',
    au: 'ੌ',
    ou: 'ੌ',
  },
  consonants: {
    k: 'ਕ',
    kh: 'ਖ',
    g: 'ਗ',
    gh: 'ਘ',
    ng: 'ਙ',
    ch: 'ਚ',
    chh: 'ਛ',
    j: 'ਜ',
    jh: 'ਝ',
    ny: 'ਞ',
    t: 'ਤ',
    th: 'ਥ',
    T: 'ਟ',
    Th: 'ਠ',
    d: 'ਦ',
    dh: 'ਧ',
    D: 'ਡ',
    Dh: 'ਢ',
    N: 'ਣ',
    n: 'ਨ',
    p: 'ਪ',
    ph: 'ਫ',
    f: 'ਫ਼',
    b: 'ਬ',
    bh: 'ਭ',
    m: 'ਮ',
    y: 'ਯ',
    r: 'ਰ',
    l: 'ਲ',
    L: 'ਲ਼',
    v: 'ਵ',
    w: 'ਵ',
    sh: 'ਸ਼',
    s: 'ਸ',
    h: 'ਹ',
    z: 'ਜ਼',
  },
  sampleWords: [
    { roman: 'sat sri akal', native: 'ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ' },
    { roman: 'ki haal hai', native: 'ਕੀ ਹਾਲ ਹੈ' },
    { roman: 'dhanvaad', native: 'ਧੰਨਵਾਦ' },
    { roman: 'punjab', native: 'ਪੰਜਾਬ' },
  ],
};

// 9. ODIA
const ODIA: ScriptDefinition = {
  code: 'odia',
  name: 'Odia',
  nativeName: 'ଓଡ଼ିଆ',
  virama: '୍',
  anusvara: 'ଂ',
  visarga: 'ଃ',
  candrabindu: 'ଁ',
  numerals: ['୦', '୧', '୨', '୩', '୪', '୫', '୬', '୭', '୮', '୯'],
  vowels: {
    a: 'ଅ',
    aa: 'ଆ',
    A: 'ଆ',
    i: 'ଇ',
    ee: 'ଈ',
    ii: 'ଈ',
    I: 'ଈ',
    u: 'ଉ',
    oo: 'ଊ',
    uu: 'ଊ',
    U: 'ଊ',
    ri: 'ଋ',
    e: 'ଏ',
    ai: 'ଐ',
    o: 'ଓ',
    au: 'ଔ',
    ou: 'ଔ',
  },
  matras: {
    aa: 'ା',
    A: 'ା',
    i: 'ି',
    ee: 'ୀ',
    ii: 'ୀ',
    I: 'ୀ',
    u: 'ୁ',
    oo: 'ୂ',
    uu: 'ୂ',
    U: 'ୂ',
    ri: 'ୃ',
    e: 'େ',
    ai: 'ୈ',
    o: 'ୋ',
    au: 'ୌ',
    ou: 'ୌ',
  },
  consonants: {
    k: 'କ',
    kh: 'ଖ',
    g: 'ଗ',
    gh: 'ଘ',
    ng: 'ଙ',
    ch: 'ଚ',
    chh: 'ଛ',
    j: 'ଜ',
    jh: 'ଝ',
    ny: 'ଞ',
    t: 'ତ',
    th: 'ଥ',
    T: 'ଟ',
    Th: 'ଠ',
    d: 'ଦ',
    dh: 'ଧ',
    D: 'ଡ',
    Dh: 'ଢ',
    N: 'ଣ',
    n: 'ନ',
    p: 'ପ',
    ph: 'ଫ',
    f: 'ଫ',
    b: 'ବ',
    bh: 'ଭ',
    m: 'ମ',
    y: 'ଯ',
    r: 'ର',
    l: 'ଲ',
    L: 'ଳ',
    v: 'ୱ',
    w: 'ୱ',
    sh: 'ଶ',
    Sh: 'ଷ',
    s: 'ସ',
    h: 'ହ',
    ksh: 'କ୍ଷ',
    gy: 'ଜ୍ଞ',
  },
  sampleWords: [
    { roman: 'namaskar', native: 'ନମସ୍କାର' },
    { roman: 'kemiti achhanti', native: 'କେମିତି ଅଛନ୍ତି' },
    { roman: 'dhanyabad', native: 'ଧନ୍ୟବାଦ' },
    { roman: 'odisha', native: 'ଓଡ଼ିଶା' },
  ],
};

// 10. URDU (Perso-Arabic)
const URDU: ScriptDefinition = {
  code: 'urdu',
  name: 'Urdu',
  nativeName: 'اردو',
  virama: '',
  anusvara: 'ں',
  visarga: 'ہ',
  numerals: ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'],
  vowels: {
    a: 'ا',
    aa: 'آ',
    A: 'آ',
    i: 'ای',
    ee: 'ای',
    ii: 'ای',
    I: 'ای',
    u: 'او',
    oo: 'او',
    uu: 'او',
    U: 'او',
    e: 'اے',
    ai: 'اے',
    o: 'او',
    au: 'او',
    ou: 'او',
  },
  matras: {
    aa: 'ا',
    A: 'ا',
    i: 'ی',
    ee: 'ی',
    ii: 'ی',
    I: 'ی',
    u: 'و',
    oo: 'و',
    uu: 'و',
    U: 'و',
    e: 'ے',
    ai: 'ے',
    o: 'و',
    au: 'و',
    ou: 'و',
  },
  consonants: {
    b: 'ب',
    p: 'پ',
    t: 'ت',
    T: 'ٹ',
    th: 'تھ',
    Th: 'ٹھ',
    s: 'س',
    j: 'ج',
    ch: 'چ',
    h: 'ح',
    kh: 'خ',
    d: 'د',
    D: 'ڈ',
    dh: 'دھ',
    Dh: 'ڈھ',
    z: 'ز',
    r: 'ر',
    rh: 'ڑ',
    zh: 'ژ',
    sh: 'ش',
    Sh: 'ص',
    k: 'ک',
    g: 'گ',
    l: 'ل',
    m: 'م',
    n: 'ن',
    v: 'و',
    w: 'و',
    y: 'ی',
    f: 'ف',
    q: 'ق',
  },
  sampleWords: [
    { roman: 'salaam', native: 'سلام' },
    { roman: 'shukriya', native: 'شکریہ' },
    { roman: 'aap kaise hain', native: 'آپ کیسے ہیں' },
    { roman: 'urdu', native: 'اردو' },
  ],
};

export const SUPPORTED_SCRIPTS: Record<string, ScriptDefinition> = {
  Hindi: DEVANAGARI,
  Marathi: DEVANAGARI,
  Sanskrit: DEVANAGARI,
  Nepali: DEVANAGARI,
  Konkani: DEVANAGARI,
  Bodo: DEVANAGARI,
  Dogri: DEVANAGARI,
  Maithili: DEVANAGARI,
  Bengali: BENGALI,
  Assamese: BENGALI,
  Tamil: TAMIL,
  Telugu: TELUGU,
  Kannada: KANNADA,
  Malayalam: MALAYALAM,
  Gujarati: GUJARATI,
  Punjabi: PUNJABI,
  Odia: ODIA,
  Urdu: URDU,
  devanagari: DEVANAGARI,
  bengali: BENGALI,
  tamil: TAMIL,
  telugu: TELUGU,
  kannada: KANNADA,
  malayalam: MALAYALAM,
  gujarati: GUJARATI,
  punjabi: PUNJABI,
  odia: ODIA,
  urdu: URDU,
};

/**
 * Maps language name or code to matching ScriptDefinition
 */
export function getScriptForLanguage(langNameOrCode: string): ScriptDefinition {
  if (!langNameOrCode) return DEVANAGARI;
  const direct = SUPPORTED_SCRIPTS[langNameOrCode];
  if (direct) return direct;

  const lower = langNameOrCode.toLowerCase();
  for (const [key, script] of Object.entries(SUPPORTED_SCRIPTS)) {
    if (lower.includes(key.toLowerCase()) || lower.includes(script.code.toLowerCase())) {
      return script;
    }
  }

  return DEVANAGARI;
}

/**
 * Fast phonetic transliteration of a single word or token from Roman to Target Script
 */
export function transliterateWord(romanWord: string, script: ScriptDefinition): string {
  if (!romanWord) return '';

  // Check punctuation/numbers
  if (/^[\d\s.,!?:;'"(){}\[\]\\/_-]+$/.test(romanWord)) {
    return romanWord;
  }

  // Urdu handling (Arabic right-to-left alphabet mapping)
  if (script.code === 'urdu') {
    let res = '';
    let i = 0;
    const s = romanWord.toLowerCase();
    while (i < s.length) {
      if (i + 2 <= s.length && script.consonants[s.slice(i, i + 2)]) {
        res += script.consonants[s.slice(i, i + 2)];
        i += 2;
      } else if (script.consonants[s[i]]) {
        res += script.consonants[s[i]];
        i += 1;
      } else if (i === 0 && script.vowels[s[i]]) {
        res += script.vowels[s[i]];
        i += 1;
      } else if (script.matras[s[i]]) {
        res += script.matras[s[i]];
        i += 1;
      } else {
        res += s[i];
        i += 1;
      }
    }
    return res;
  }

  // Common known dictionary overrides for popular Indian words
  const dictMap: Record<string, Record<string, string>> = {
    devanagari: {
      namaste: 'नमस्ते',
      namaskar: 'नमस्कार',
      dhanyawad: 'धन्यवाद',
      dhanyavad: 'धन्यवाद',
      shukriya: 'शुक्रिया',
      kaise: 'कैसे',
      hai: 'है',
      hain: 'हैं',
      ho: 'हो',
      kya: 'क्या',
      kyon: 'क्यों',
      kyu: 'क्यों',
      kyun: 'क्यों',
      theek: 'ठीक',
      thik: 'ठीक',
      achha: 'अच्छा',
      acha: 'अच्छा',
      bhaarat: 'भारत',
      bharat: 'भारत',
      sadhguru: 'सद्गुरु',
      audio: 'ऑडियो',
      dubbing: 'डबिंग',
      studio: 'स्टूडियो',
      hindi: 'हिन्दी',
    },
    bengali: {
      nomoshkar: 'নমস্কার',
      namaskar: 'নমস্কার',
      dhonyobad: 'ধন্যবাদ',
      dhanyabad: 'ধন্যবাদ',
      kemon: 'কেমন',
      achen: 'আছেন',
      acho: 'আছো',
      bhalo: 'ভালো',
      bangla: 'বাংলা',
    },
    tamil: {
      vanakkam: 'வணக்கம்',
      nandri: 'நன்றி',
      nanri: 'நன்றி',
      eppadi: 'எப்படி',
      irukkinga: 'இருக்கீங்க',
      tamil: 'தமிழ்',
      aam: 'ஆம்',
      illai: 'இல்லை',
    },
    telugu: {
      namaskaram: 'నమస్కారం',
      bagunnara: 'బాగున్నారా',
      dhanyavadalu: 'ధన్యవాదాలు',
      telugu: 'తెలుగు',
      ela: 'ఎలా',
      unnaru: 'ఉన్నారు',
    },
    kannada: {
      namaskara: 'ನಮಸ್ಕಾರ',
      hegiddeera: 'ಹೇಗಿದ್ದೀರಾ',
      dhanyavadagalu: 'ಧನ್ಯವಾದಗಳು',
      kannada: 'ಕನ್ನಡ',
    },
    malayalam: {
      namaskaram: 'നമസ്കാരം',
      sukhamaano: 'സുഖമാണോ',
      nandi: 'നന്ദി',
      malayalam: 'മലയാളം',
    },
    gujarati: {
      namaste: 'નમસ્તે',
      kem: 'કેમ',
      cho: 'છો',
      aabhar: 'આભાર',
      gujarat: 'ગુજરાત',
    },
    punjabi: {
      sat: 'ਸਤਿ',
      sri: 'ਸ਼੍ਰੀ',
      akal: 'ਅਕਾਲ',
      dhanvaad: 'ਧੰਨਵਾਦ',
      ki: 'ਕੀ',
      haal: 'ਹਾਲ',
    },
  };

  const cleanLower = romanWord.toLowerCase().trim();
  const scriptKey = script.code;

  // 1. Check user custom dictionary
  const userDict = getUserCustomDictionary(scriptKey);
  if (userDict && userDict[cleanLower]) {
    return userDict[cleanLower];
  }

  // 2. Check rich Curated Indic Dictionary
  for (const [langName, words] of Object.entries(CURATED_INDIC_DICTIONARY)) {
    if (script.name.toLowerCase().includes(langName.toLowerCase()) || scriptKey.includes(langName.toLowerCase())) {
      if (words[cleanLower]) {
        return words[cleanLower];
      }
    }
  }

  if (dictMap[scriptKey] && dictMap[scriptKey][cleanLower]) {
    return dictMap[scriptKey][cleanLower];
  }

  // Multi-pass phonetic parser
  let result = '';
  let i = 0;
  const len = romanWord.length;


  while (i < len) {
    // 1. Check multi-char consonants (3 chars, 2 chars, 1 char)
    let matchedConsonant: string | null = null;
    let matchedConsonantLen = 0;

    for (const testLen of [3, 2, 1]) {
      if (i + testLen <= len) {
        const sub = romanWord.slice(i, i + testLen);
        const subLower = sub.toLowerCase();

        // Check case-sensitive then case-insensitive
        if (script.consonants[sub]) {
          matchedConsonant = script.consonants[sub];
          matchedConsonantLen = testLen;
          break;
        } else if (script.consonants[subLower]) {
          matchedConsonant = script.consonants[subLower];
          matchedConsonantLen = testLen;
          break;
        }
      }
    }

    if (matchedConsonant) {
      i += matchedConsonantLen;

      // Now inspect vowel immediately following this consonant
      let matchedVowelMatra: string | null = null;
      let matchedVowelLen = 0;

      for (const testVowelLen of [3, 2, 1]) {
        if (i + testVowelLen <= len) {
          const vSub = romanWord.slice(i, i + testVowelLen);
          const vSubLower = vSub.toLowerCase();

          if (script.matras[vSub]) {
            matchedVowelMatra = script.matras[vSub];
            matchedVowelLen = testVowelLen;
            break;
          } else if (script.matras[vSubLower]) {
            matchedVowelMatra = script.matras[vSubLower];
            matchedVowelLen = testVowelLen;
            break;
          }
        }
      }

      if (matchedVowelMatra) {
        // Consonant + Matra
        result += matchedConsonant + matchedVowelMatra;
        i += matchedVowelLen;
      } else if (i < len && (romanWord[i] === 'a' || romanWord[i] === 'A')) {
        // Inherent 'a' vowel -> If at terminal end of word, modern users mean explicit 'aa' / 'ा' matra
        if (i + 1 === len && (script.matras['aa'] || script.matras['A'])) {
          result += matchedConsonant + (script.matras['aa'] || script.matras['A'] || 'ा');
        } else {
          result += matchedConsonant;
        }
        i += 1;
      } else if (i < len && /[a-zA-Z]/.test(romanWord[i])) {
        // Followed immediately by another consonant -> Half-letter / Conjunct with Virama!
        result += matchedConsonant + script.virama;
      } else {
        // End of word or before punctuation: In modern Indian languages (Hindi etc), terminal consonant has inherent 'a' or pure consonant
        result += matchedConsonant;
      }
      continue;
    }

    // 2. Check independent Vowels at the start or after a break
    let matchedVowel: string | null = null;
    let matchedVLen = 0;

    for (const testVLen of [3, 2, 1]) {
      if (i + testVLen <= len) {
        const sub = romanWord.slice(i, i + testVLen);
        const subLower = sub.toLowerCase();

        if (script.vowels[sub]) {
          matchedVowel = script.vowels[sub];
          matchedVLen = testVLen;
          break;
        } else if (script.vowels[subLower]) {
          matchedVowel = script.vowels[subLower];
          matchedVLen = testVLen;
          break;
        }
      }
    }

    if (matchedVowel) {
      result += matchedVowel;
      i += matchedVLen;
      continue;
    }

    // 3. Modifiers (Anusvara 'M' or 'n', Visarga 'H')
    if (romanWord[i] === 'M' || (romanWord[i] === 'n' && i + 1 === len)) {
      result += script.anusvara;
      i += 1;
      continue;
    }
    if (romanWord[i] === 'H') {
      result += script.visarga;
      i += 1;
      continue;
    }

    // Numbers & Punctuation
    const digitIdx = parseInt(romanWord[i], 10);
    if (!isNaN(digitIdx) && script.numerals[digitIdx]) {
      result += script.numerals[digitIdx];
      i += 1;
      continue;
    }

    // Pass through unmapped character
    result += romanWord[i];
    i += 1;
  }

  return result;
}

/**
 * Transliterates a full sentence or paragraph in real-time, preserving whitespace, punctuation, and markdown.
 */
export function transliterateSentence(text: string, languageName: string): string {
  if (!text) return '';
  const script = getScriptForLanguage(languageName);

  // Split by whitespace and punctuation boundaries while keeping delimiters
  const tokens = text.split(/(\s+|[.,!?:;'"(){}\[\]\\/_\-]+)/);

  return tokens
    .map((token) => {
      if (!token || /^\s+$/.test(token) || /^[.,!?:;'"(){}\[\]\\/_\-]+$/.test(token)) {
        return token;
      }
      return transliterateWord(token, script);
    })
    .join('');
}

/**
 * Returns alternative spelling suggestions for a typed Roman token
 */
export function getTransliterationSuggestions(
  romanToken: string,
  languageName: string
): string[] {
  if (!romanToken || romanToken.trim().length === 0) return [];
  const script = getScriptForLanguage(languageName);
  const primary = transliterateWord(romanToken, script);

  const suggestions: Set<string> = new Set();
  if (primary) suggestions.add(primary);

  // Variations:
  // 1. With long vowel
  const variation1 = transliterateWord(romanToken + 'a', script);
  if (variation1 && variation1 !== primary) suggestions.add(variation1);

  // 2. With double vowel
  const variation2 = transliterateWord(romanToken.replace(/a$/, 'aa').replace(/i$/, 'ee').replace(/u$/, 'oo'), script);
  if (variation2 && variation2 !== primary) suggestions.add(variation2);

  // 3. With Anusvara (Nasal dot)
  if (!primary.endsWith(script.anusvara)) {
    suggestions.add(primary + script.anusvara);
  }

  // 4. Exclamation / punctuation friendly variant
  if (romanToken.length > 2) {
    const rawEnglish = romanToken;
    suggestions.add(rawEnglish); // Option to keep original English word
  }

  return Array.from(suggestions).slice(0, 5);
}
