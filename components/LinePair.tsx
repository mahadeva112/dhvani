import React from 'react';

/** Short tags for the languages a dub is usually in; anything else takes its first two letters. */
const TAGS: Record<string, string> = {
  english: 'EN', hindi: 'HI', bengali: 'BN', bangla: 'BN', tamil: 'TA', telugu: 'TE', kannada: 'KN', malayalam: 'ML',
  marathi: 'MR', gujarati: 'GU', punjabi: 'PA', odia: 'OR', oriya: 'OR', assamese: 'AS', urdu: 'UR', nepali: 'NE',
  sanskrit: 'SA', spanish: 'ES', french: 'FR', german: 'DE', italian: 'IT', portuguese: 'PT', russian: 'RU',
  chinese: 'ZH', mandarin: 'ZH', japanese: 'JA', korean: 'KO', arabic: 'AR', hebrew: 'HE', turkish: 'TR',
};

/** 'Hindi', 'hi', 'Bengali (বাংলা)', 'en-US' → HI, HI, BN, EN. */
export const languageTag = (language?: string): string => {
  const name = (language || '').split('(')[0].trim().toLowerCase();
  if (!name) return '';
  if (TAGS[name]) return TAGS[name];
  const code = name.split(/[-_]/)[0];
  return (code.length <= 3 ? code : code.slice(0, 2)).toUpperCase();
};

/**
 * A line as the player shows it: the original's words above, the dub's below,
 * in small type so the whole sentence fits, wrapping when it does not.
 */
export const LinePair: React.FC<{ source?: string; dub?: string; sourceLanguage?: string; dubLanguage?: string; className?: string }> = ({
  source,
  dub,
  sourceLanguage,
  dubLanguage,
  className = '',
}) => {
  const row = (tag: string, language: string | undefined, text: string, textClass: string) => (
    <span className="flex items-baseline gap-2 min-w-0">
      <span className="w-5 shrink-0 font-mono text-[10px] text-slate-500" title={language || undefined}>{tag}</span>
      <span className={`flex-1 min-w-0 leading-snug break-words ${textClass}`}>{text || '—'}</span>
    </span>
  );
  return (
    <span className={`flex-1 min-w-0 flex flex-col gap-0.5 ${className}`}>
      {row(languageTag(sourceLanguage) || 'EN', sourceLanguage, source || '', 'text-[11px] text-slate-400')}
      {row(languageTag(dubLanguage), dubLanguage, dub || '', 'text-[12px] text-slate-100')}
    </span>
  );
};
