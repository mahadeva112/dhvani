import React, { useState } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { SettingOrigin } from '../services/apiClient';

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
 * Endpoint and model settings for one provider, folded away until wanted.
 *
 * These matter to anyone pointing DHVANI at a proxy, a regional host or a
 * specific model — an install on a network where the public endpoints are not
 * reachable is otherwise unusable — but they are wrong to put in front of
 * someone who only has a key to paste. So they start folded: that is what keeps
 * the whole form on one screen, and the summary carries a badge when there is
 * something in here worth opening it for.
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

  return (
    <div className="border-t border-dashed border-slate-800 pt-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-1.5 py-2 text-[12.5px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
        <span>{title}</span>
        {badge && !isOpen && (
          <span
            className={`ml-auto text-[10px] font-mono ${
              badge === 'from .env' ? 'text-amber-500/90' : 'text-slate-500'
            }`}
          >
            {badge}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="pb-2 space-y-2.5">
          {fields.map((field) => (
            <div key={field.key}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <label
                  htmlFor={`dhvani-setting-${field.key}`}
                  className="text-[11px] font-semibold text-slate-300"
                >
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
                className="w-full h-10 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[10px] px-3 text-[13px] text-slate-100 placeholder-slate-600 focus:outline-none font-mono transition-all"
              />

              {field.hint && (
                <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">{field.hint}</p>
              )}
            </div>
          ))}

          {onReset && (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={onReset}
                className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to defaults</span>
              </button>
              {/*
                * Clearing is not quite "back to factory": an empty field falls
                * through to `.env` when one set it. Say so, because the rows
                * above may be labelled "from .env" and that is where they go.
                */}
              <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                Empties these, so the app falls back to your{' '}
                <span className="font-mono">.env</span> file or its built-in defaults. Takes effect
                when you save.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
