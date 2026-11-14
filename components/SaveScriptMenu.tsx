import React, { useState } from 'react';
import { ChevronRight, Download, FileText, X } from 'lucide-react';
import type { TargetScriptFormat } from '../services/srtService';
import { CenteredPanel } from './CenteredPanel';

const FORMATS: { id: TargetScriptFormat; tag: string; title: string; hint: string }[] = [
  { id: 'json', tag: 'JSON', title: 'Script file', hint: "With each line's time. Opens under Paste script on any computer." },
  { id: 'dialogue', tag: 'TXT', title: 'Dialogue', hint: 'The lines only, for reading' },
  { id: 'timecoded', tag: 'TXT', title: 'Timecoded', hint: 'Each line with its time' },
  { id: 'bilingual', tag: 'TXT', title: 'Bilingual', hint: 'The original above each line' },
  { id: 'docx', tag: 'DOCX', title: 'Word', hint: 'Paragraphs in a table, original left, dub right' },
  { id: 'csv', tag: 'CSV', title: 'Spreadsheet', hint: 'For Excel or Google Sheets' },
];

/** As heard: the synced dub's lines, at their times in it. Full: every cue. */
export type ScriptScope = 'heard' | 'full';

interface SaveScriptMenuProps {
  onSave: (format: TargetScriptFormat) => void;
  /** The row's name, e.g. "Hindi script". */
  title: string;
  disabled?: boolean;
  /** Set once there is a synced dub: whether the text formats follow it. */
  scope?: ScriptScope;
  onScopeChange?: (scope: ScriptScope) => void;
  /** Lines the synced dub left out, for the choice's hint. */
  removedCount?: number;
  /** A small "Script" button, for a row of buttons, in place of the full row. */
  compact?: boolean;
}

/**
 * The script's row in the Dub step's downloads. It opens a window in the
 * middle of the screen, like Save the dub: every format the script saves as,
 * and, once synced, whether the text formats follow the dub.
 */
export const SaveScriptMenu: React.FC<SaveScriptMenuProps> = ({ onSave, title, disabled, scope, onScopeChange, removedCount = 0, compact = false }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          title={`Save the ${title}: script file, text, Word or spreadsheet`}
          className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 text-[12.5px] font-medium text-slate-200 hover:text-white hover:bg-slate-800 whitespace-nowrap transition-colors disabled:opacity-40 cursor-default"
        >
          <FileText className="w-3.5 h-3.5" /> Script
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-edge bg-slate-950/60 hover:bg-slate-800 text-left text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
      >
        <FileText className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] truncate">Save the {title}</span>
          <span className="block text-[11.5px] text-slate-500 truncate">Script file, text, Word, spreadsheet</span>
        </span>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
      </button>
      )}

      <CenteredPanel open={open && !disabled} onClose={() => setOpen(false)} label={`Save the ${title}`} className="max-w-[30rem]">
        <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-edge">
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
            <FileText className="w-[18px] h-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-100 truncate">Save the {title}</h2>
            <p className="text-[12px] text-slate-400">Pick a format. Each one saves on its own.</p>
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 py-4 flex flex-col gap-4">
          {scope && onScopeChange && (
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Which lines</span>
              <div role="group" aria-label="Which lines" className="flex p-0.5 gap-0.5 rounded-xl bg-slate-950 border border-edge">
                {([
                  ['heard', 'As heard in the dub'],
                  ['full', 'Full script'],
                ] as [ScriptScope, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={scope === id}
                    onClick={() => onScopeChange(id)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-[12.5px] font-medium transition-colors cursor-default ${
                      scope === id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11.5px] text-slate-400 leading-snug">
                {scope === 'heard'
                  ? `${removedCount > 0 ? `Leaves out ${removedCount} ${removedCount === 1 ? 'cue' : 'cues'} removed in Edit timing; times` : 'Times'} as in the synced dub. The script file is always whole.`
                  : 'Every cue at its time in the original, removed ones too.'}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Format</span>
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onSave(f.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-edge bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600 text-left transition-colors cursor-default"
              >
                <span className="shrink-0 w-11 text-center font-mono text-[10.5px] py-0.5 rounded-md bg-slate-800 text-slate-300">{f.tag}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-slate-100">{f.title}</span>
                  <span className="block text-[11.5px] text-slate-400 leading-snug">{f.hint}</span>
                </span>
                <Download className="w-4 h-4 text-slate-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </CenteredPanel>
    </>
  );
};
