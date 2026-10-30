import React, { useRef, useState } from 'react';
import { ChevronDown, RotateCcw, Settings2 } from 'lucide-react';
import { SettingOrigin } from '../services/apiClient';
import { Popover } from './ApiSettingsParts';

export interface ServerField {
  /** Matches the key in `values`, and the field name the backend saves. */
  key: string;
  label: string;
  placeholder: string;
  hint?: string;
  origin?: SettingOrigin;
}

interface ServerSettingsFieldsProps {
  /** Summary text on the disclosure, e.g. "ElevenLabs server settings". */
  title: string;
  fields: ServerField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** Empties every field in this group, so each falls back to .env or a default. */
  onReset?: () => void;
}

/**
 * Endpoint and model settings for one provider, behind a button until wanted.
 *
 * These matter to anyone pointing DHVANI at a proxy, a regional host or a
 * specific model — an install on a network where the public endpoints are not
 * reachable is otherwise unusable — but they are wrong to put in front of
 * someone who only has a key to paste. So they open over the window, which
 * keeps the form the same height whether they are open or not, and the button
 * carries a badge when there is something in here worth opening it for.
 */
export const ServerSettingsFields: React.FC<ServerSettingsFieldsProps> = ({
  title,
  fields,
  values,
  onChange,
  onReset,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  /*
   * What the closed summary advertises. `.env` outranks `saved` because it is
   * the surprising one — it says a value came from a file rather than from this
   * screen, which is the reason someone would open the section.
   */
  const badge = fields.some((field) => field.origin === 'env')
    ? 'from .env'
    : fields.some((field) => field.origin === 'saved')
      ? 'customised'
      : null;

  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => setIsOpen(false);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={`w-full h-10 flex items-center gap-2 px-3.5 rounded-xl border text-[12.5px] transition-colors cursor-default ${
          isOpen ? 'border-indigo-500/60 bg-slate-800/50 text-slate-100' : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
        }`}
      >
        <Settings2 className="w-4 h-4 shrink-0" />
        <span className="truncate">{title}</span>
        {badge && (
          <span
            className={`shrink-0 text-[10px] font-mono px-1.5 py-px rounded ${
              badge === 'from .env' ? 'bg-amber-500/10 text-amber-400/90' : 'bg-slate-800 text-slate-400'
            }`}
          >
            {badge}
          </span>
        )}
        <ChevronDown className={`ml-auto w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <Popover anchor={anchor} open={isOpen} onClose={close} width={460} label={title}>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 [scrollbar-width:thin]">
          {fields.map((field) => (
            <div key={field.key}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <label htmlFor={`dhvani-setting-${field.key}`} className="text-[11.5px] font-semibold text-slate-300">
                  {field.label}
                </label>
                {field.origin === 'env' && (
                  <span
                    className="text-[10px] font-mono text-amber-500/90"
                    title="Currently coming from a .env file. Saving here replaces it on this computer."
                  >
                    from .env
                  </span>
                )}
              </div>
              <input
                id={`dhvani-setting-${field.key}`}
                type="text"
                value={values[field.key] ?? ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                autoComplete="off"
                spellCheck={false}
                className="w-full h-9 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-3 text-[12.5px] text-slate-100 placeholder-slate-600 focus:outline-none font-mono transition-all"
              />
              {field.hint && <p className="text-[10.5px] text-slate-500 mt-1 leading-relaxed">{field.hint}</p>}
            </div>
          ))}
        </div>
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-slate-800">
          {/*
            * Clearing is not quite "back to factory": an empty field falls
            * through to `.env` when one set it. Say so, because the rows
            * above may be labelled "from .env" and that is where they go.
            */}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              title="Empties these, so the app falls back to your .env file or its built-in defaults. Takes effect when you save."
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-slate-700 text-[11.5px] text-slate-300 hover:bg-slate-800 cursor-default"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to defaults
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-500">Takes effect when you save.</span>
          <button
            type="button"
            onClick={close}
            className="h-7 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11.5px] font-semibold text-white cursor-default"
          >
            Done
          </button>
        </div>
      </Popover>
    </>
  );
};
