/**
 * Shared language registry.
 *
 * The UI speaks in display names ("Bengali"); ElevenLabs Scribe wants ISO-639
 * codes. This table is the single place that maps between the two, plus the
 * BCP-47 tags used when generating SSML.
 */
export const LANGUAGES = [
  { name: 'Auto Detect', iso: '', bcp47: '' },
  { name: 'English', iso: 'eng', bcp47: 'en-US' },
  { name: 'Assamese', iso: 'asm', bcp47: 'as-IN' },
  { name: 'Bengali', iso: 'ben', bcp47: 'bn-IN' },
  { name: 'Bodo', iso: 'brx', bcp47: 'brx-IN' },
  { name: 'Dogri', iso: 'doi', bcp47: 'doi-IN' },
  { name: 'Gujarati', iso: 'guj', bcp47: 'gu-IN' },
  { name: 'Hindi', iso: 'hin', bcp47: 'hi-IN' },
  { name: 'Kannada', iso: 'kan', bcp47: 'kn-IN' },
  { name: 'Kashmiri', iso: 'kas', bcp47: 'ks-IN' },
  { name: 'Konkani', iso: 'kok', bcp47: 'kok-IN' },
  { name: 'Maithili', iso: 'mai', bcp47: 'mai-IN' },
  { name: 'Malayalam', iso: 'mal', bcp47: 'ml-IN' },
  { name: 'Manipuri', iso: 'mni', bcp47: 'mni-IN' },
  { name: 'Marathi', iso: 'mar', bcp47: 'mr-IN' },
  { name: 'Nepali', iso: 'nep', bcp47: 'ne-NP' },
  { name: 'Odia', iso: 'ori', bcp47: 'or-IN' },
  { name: 'Punjabi', iso: 'pan', bcp47: 'pa-IN' },
  { name: 'Sanskrit', iso: 'san', bcp47: 'sa-IN' },
  { name: 'Santali', iso: 'sat', bcp47: 'sat-IN' },
  { name: 'Sindhi', iso: 'snd', bcp47: 'sd-IN' },
  { name: 'Tamil', iso: 'tam', bcp47: 'ta-IN' },
  { name: 'Telugu', iso: 'tel', bcp47: 'te-IN' },
  { name: 'Urdu', iso: 'urd', bcp47: 'ur-IN' },
  { name: 'Arabic', iso: 'ara', bcp47: 'ar-SA' },
  { name: 'Chinese', iso: 'zho', bcp47: 'zh-CN' },
  { name: 'Dutch', iso: 'nld', bcp47: 'nl-NL' },
  { name: 'French', iso: 'fra', bcp47: 'fr-FR' },
  { name: 'German', iso: 'deu', bcp47: 'de-DE' },
  { name: 'Indonesian', iso: 'ind', bcp47: 'id-ID' },
  { name: 'Italian', iso: 'ita', bcp47: 'it-IT' },
  { name: 'Japanese', iso: 'jpn', bcp47: 'ja-JP' },
  { name: 'Korean', iso: 'kor', bcp47: 'ko-KR' },
  { name: 'Polish', iso: 'pol', bcp47: 'pl-PL' },
  { name: 'Portuguese', iso: 'por', bcp47: 'pt-BR' },
  { name: 'Russian', iso: 'rus', bcp47: 'ru-RU' },
  { name: 'Spanish', iso: 'spa', bcp47: 'es-ES' },
  { name: 'Thai', iso: 'tha', bcp47: 'th-TH' },
  { name: 'Turkish', iso: 'tur', bcp47: 'tr-TR' },
  { name: 'Vietnamese', iso: 'vie', bcp47: 'vi-VN' },
];

const byName = new Map(LANGUAGES.map((lang) => [lang.name.toLowerCase(), lang]));
const byIso = new Map(LANGUAGES.filter((lang) => lang.iso).map((lang) => [lang.iso, lang]));

// ElevenLabs may answer with a two-letter code; map the common ones back.
const TWO_LETTER_TO_ISO = {
  en: 'eng', hi: 'hin', bn: 'ben', ta: 'tam', te: 'tel', kn: 'kan', ml: 'mal', mr: 'mar',
  gu: 'guj', pa: 'pan', or: 'ori', as: 'asm', ur: 'urd', ne: 'nep', sa: 'san', sd: 'snd',
  ar: 'ara', zh: 'zho', nl: 'nld', fr: 'fra', de: 'deu', id: 'ind', it: 'ita', ja: 'jpn',
  ko: 'kor', pl: 'pol', pt: 'por', ru: 'rus', es: 'spa', th: 'tha', tr: 'tur', vi: 'vie',
};

/** Display name -> ISO-639-3 code for the ElevenLabs `language_code` field. */
export const toIsoCode = (displayName) => {
  const key = String(displayName || '').trim().toLowerCase();
  if (!key || key === 'auto' || key === 'auto detect' || key === 'automatic') return '';
  return byName.get(key)?.iso || '';
};

/** ElevenLabs `language_code` -> display name for the UI. */
export const toDisplayName = (isoCode, fallback = 'Unknown') => {
  const raw = String(isoCode || '').trim().toLowerCase();
  if (!raw) return fallback;
  const normalized = raw.length === 2 ? TWO_LETTER_TO_ISO[raw] || raw : raw.slice(0, 3);
  return byIso.get(normalized)?.name || fallback;
};

/** Display name -> BCP-47 tag, used when generating SSML. */
export const toBcp47 = (displayName) =>
  byName.get(String(displayName || '').trim().toLowerCase())?.bcp47 || 'en-US';
