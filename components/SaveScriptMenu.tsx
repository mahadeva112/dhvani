import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Download } from 'lucide-react';
import type { TargetScriptFormat } from '../services/srtService';

const FORMATS: { id: TargetScriptFormat; tag: string; title: string; hint: string }[] = [
  { id: 'json', tag: 'JSON', title: 'Script file', hint: 'Opens under Paste script on any computer' },
  { id: 'dialogue', tag: 'TXT', title: 'Dialogue', hint: 'The lines only, for reading' },
  { id: 'timecoded', tag: 'TXT', title: 'Timecoded', hint: 'Each line with its time' },
  { id: 'bilingual', tag: 'TXT', title: 'Bilingual', hint: 'The original above each line' },
  { id: 'csv', tag: 'CSV', title: 'Spreadsheet', hint: 'For Excel or Google Sheets' },
];

interface SaveScriptMenuProps {
  onSave: (format: TargetScriptFormat) => void;
  /** The row's name, e.g. "Hindi script". */
  title: string;
  disabled?: boolean;
}

/**
 * The script's row in the Final dub's downloads, as a split button: the row
 * saves the script file, the arrow offers every other format.
 */
export const SaveScriptMenu: React.FC<SaveScriptMenuProps> = ({ onSave, title, disabled }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where the menu sits on screen. It's drawn on the page, outside the
  // panel's scroll box, so the panel can't cut it off.
  const [place, setPlace] = useState<{ right: number; top?: number; bottom?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const button = rootRef.current?.getBoundingClientRect();
      if (!button) return;
      const height = menuRef.current?.offsetHeight ?? 280;
      const right = Math.max(8, window.innerWidth - button.right);
      // Opens below, or above when there isn't room below.
      if (button.bottom + 6 + height <= window.innerHeight - 8 || button.top - 6 - height < 8) {
        setPlace({ right, top: button.bottom + 6 });
      } else {
        setPlace({ right, bottom: window.innerHeight - button.top + 6 });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = (format: TargetScriptFormat) => {
    setOpen(false);
    onSave(format);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div
        className={`grid grid-cols-[minmax(0,1fr)_2.5rem] rounded-xl border border-slate-800 overflow-hidden ${disabled ? 'opacity-45' : ''}`}
      >
        <button
          type="button"
          onClick={() => save('json')}
          disabled={disabled}
          title="Save the script file, with each line's time, to open under Paste script on another computer"
          className="flex items-center gap-3 p-2.5 min-w-0 text-left hover:bg-slate-800/50 transition-colors disabled:cursor-not-allowed cursor-pointer"
        >
          <span className="w-9 h-9 rounded-lg flex items-center justify-center font-mono text-[9.5px] font-semibold shrink-0 bg-indigo-500/15 text-indigo-300">
            JSON
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-slate-100 truncate">{title}</span>
            <span className="block text-[11.5px] text-slate-400 truncate">Script file · other formats in the arrow</span>
          </span>
          <Download className="w-4 h-4 text-slate-500 shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Other formats"
          title="Other formats"
          className={`flex items-center justify-center border-l border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 transition-colors disabled:cursor-not-allowed cursor-pointer ${
            open ? 'bg-slate-800/60 text-slate-100' : ''
          }`}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Save script as"
          style={{ position: 'fixed', right: place?.right ?? 8, top: place?.top, bottom: place?.bottom, visibility: place ? 'visible' : 'hidden' }}
          className="z-[60] w-72 max-w-[calc(100vw-1rem)] p-1 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl animate-in fade-in duration-100"
        >
          {FORMATS.map((f, i) => (
            <React.Fragment key={f.id}>
              {i === 1 && <div className="h-px bg-slate-800 mx-1.5 my-1" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => save(f.id)}
                className={`w-full grid grid-cols-[2.75rem_minmax(0,1fr)_1rem] items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                  i === 0 ? 'bg-indigo-500/10 hover:bg-indigo-500/15' : 'hover:bg-slate-800'
                }`}
              >
                <span
                  className={`font-mono text-[10.5px] font-semibold text-center py-0.5 rounded-md ${
                    i === 0 ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {f.tag}
                </span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-slate-100">{f.title}</span>
                  <span className="block text-[11px] text-slate-400 leading-snug">{f.hint}</span>
                </span>
                {i === 0 ? <Check className="w-3.5 h-3.5 text-indigo-300" aria-label="Default" /> : <span />}
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};
