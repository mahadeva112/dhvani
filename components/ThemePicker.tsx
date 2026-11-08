import React from 'react';
import { Check } from 'lucide-react';
import { THEMES, setTheme, useTheme } from './theme';

/**
 * The themes side by side, each a small drawing of the app in its colours:
 * the window, a side list, two waveform rows and a button. A click switches
 * the whole app at once and remembers it on this computer.
 */
export const ThemePicker: React.FC = () => {
  const theme = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3">
      {THEMES.map((t) => {
        const on = t.id === theme;
        const [bg, panel, line, accent, text] = t.swatch;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(t.id)}
            className={`text-left rounded-xl border p-2.5 transition-colors cursor-default ${
              on ? 'border-indigo-500 bg-indigo-500/10' : 'border-edge hover:border-slate-600 bg-slate-950/40'
            }`}
          >
            <span aria-hidden="true" className="block h-[84px] rounded-lg overflow-hidden border" style={{ background: bg, borderColor: line }}>
              <span className="flex h-full">
                <span className="w-[34%] h-full flex flex-col gap-1.5 p-2" style={{ background: panel, borderRight: `1px solid ${line}` }}>
                  <span className="h-1.5 w-3/4 rounded-full" style={{ background: text, opacity: 0.85 }} />
                  <span className="h-1.5 w-1/2 rounded-full" style={{ background: text, opacity: 0.4 }} />
                  <span className="h-1.5 w-2/3 rounded-full" style={{ background: accent }} />
                  <span className="h-1.5 w-1/2 rounded-full" style={{ background: text, opacity: 0.4 }} />
                </span>
                <span className="flex-1 flex flex-col justify-center gap-2 p-2">
                  {[0.35, 0.8].map((alpha, row) => (
                    <span key={row} className="flex items-center gap-[2px] h-5">
                      {Array.from({ length: 22 }, (_, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full"
                          style={{ height: `${30 + ((i * 37 + row * 11) % 70)}%`, background: row ? accent : text, opacity: alpha }}
                        />
                      ))}
                    </span>
                  ))}
                  <span className="self-end h-3 w-10 rounded" style={{ background: accent }} />
                </span>
              </span>
            </span>
            <span className="mt-2 flex items-center gap-2">
              <span className="text-[13px] font-medium text-slate-100">{t.label}</span>
              {on && <Check className="w-3.5 h-3.5 text-indigo-300" />}
            </span>
            <span className="block text-[11.5px] text-slate-400">{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
};
