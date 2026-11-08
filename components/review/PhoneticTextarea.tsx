import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDubLanguage } from '../../services/dubLanguage';
import { usePhoneticTyping } from './usePhoneticTyping';

/** Spellings of the Roman word at the caret, over whatever window the box is in. */
export const PhoneticSpellings: React.FC<{
  phonetic: ReturnType<typeof usePhoneticTyping>;
  area: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  lang?: string;
}> = ({ phonetic, area, onChange, lang }) => {
  const popup = phonetic.popup;
  if (!popup) return null;
  return createPortal(
    <div
      role="listbox"
      aria-label={`Spellings of ${popup.word}`}
      className="fixed z-[200] min-w-[12rem] max-w-[22rem] rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-2xl shadow-black/60"
      style={{ left: Math.min(popup.x - 8, window.innerWidth - 360), top: popup.y + 4 }}
    >
      <div className="px-1 pb-1 font-mono text-[11px] text-slate-500">{popup.word}</div>
      <div className="flex flex-wrap gap-1" lang={lang || undefined}>
        {popup.suggestions.map((s, i) => (
          <button
            key={`${i}-${s}`}
            type="button"
            role="option"
            aria-selected={i === popup.selected}
            onMouseDown={(e) => {
              e.preventDefault();
              if (area.current) phonetic.pick(area.current, onChange, i);
            }}
            className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[15px] cursor-default ${
              i === popup.selected ? 'bg-indigo-500/25 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span className="font-mono text-[10px] text-slate-500">{i + 1}</span>
            {s}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3 border-t border-edge px-1 pt-1 text-[10.5px] text-slate-500">
        <span>Space use</span>
        <span>1–5 pick</span>
        <span>Esc keep English</span>
      </div>
    </div>,
    document.body
  );
};

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** The language typed in; the open project's dub language when left out. */
  language?: string;
};

/**
 * A plain textarea for words in the dub language: Roman letters become its
 * script as each word ends, and `.` gives its full stop, as in the script
 * table. Ctrl+G turns it off here and everywhere else.
 */
export const PhoneticTextarea = forwardRef<HTMLTextAreaElement, Props>(({ value, onChange, language, onKeyDown, onKeyUp, onBlur, ...rest }, ref) => {
  const dubLanguage = useDubLanguage();
  const lang = language ?? dubLanguage;
  const phonetic = usePhoneticTyping(lang);
  const area = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => area.current!);

  return (
    <>
      <textarea
        {...rest}
        ref={area}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!rest.readOnly && phonetic.onKeyDown(e, onChange)) return;
          onKeyDown?.(e);
        }}
        onKeyUp={(e) => {
          phonetic.onKeyUp(e);
          onKeyUp?.(e);
        }}
        onBlur={(e) => {
          phonetic.dismiss();
          onBlur?.(e);
        }}
      />
      <PhoneticSpellings phonetic={phonetic} area={area} onChange={onChange} />
    </>
  );
});
PhoneticTextarea.displayName = 'PhoneticTextarea';
