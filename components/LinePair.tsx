import React from 'react';

/**
 * A line as the player shows it: the original's words above, the dub's below,
 * in small type so the whole sentence fits, wrapping when it does not.
 * No language tags: the two sentences alone.
 */
export const LinePair: React.FC<{
  source?: string;
  dub?: string;
  className?: string;
  /** Larger type, where the line is what the row is for. */
  large?: boolean;
}> = ({ source, dub, className = '', large = false }) => {
  const row = (text: string, textClass: string) => <span className={`min-w-0 leading-snug break-words ${textClass}`}>{text || '—'}</span>;
  return (
    <span className={`flex-1 min-w-0 flex flex-col gap-0.5 ${className}`}>
      {row(source || '', large ? 'text-[12.5px] text-slate-400' : 'text-[11px] text-slate-400')}
      {row(dub || '', large ? 'text-[15px] text-slate-50' : 'text-[12px] text-slate-100')}
    </span>
  );
};
