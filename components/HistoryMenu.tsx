import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, History } from 'lucide-react';

/** The project's one history as the Undo buttons and History lists show it (services/projectHistory.ts). */
export interface ProjectHistoryView {
  entries: { label: string; time: number; scriptOnly: boolean }[];
  /** The step the project is at. */
  at: number;
  /** What Undo and Redo would take back or bring back; null where there is nothing. */
  labels: { undo: string | null; redo: string | null };
  /** Puts the project back as it was at that step. */
  goTo: (index: number) => void;
}

const clock = (time: number) => {
  const d = new Date(time);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return same ? hm : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hm}`;
};

/**
 * The History button and its list: every step from the first change to the
 * last, newest on top, each with its time; a click puts the project back
 * there. Steps undone stay listed, dimmed, until a new change replaces them.
 */
export function HistoryMenu({ history, className = '', compact = false }: { history: ProjectHistoryView; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);
  // Opened at the step the project is at.
  useEffect(() => {
    if (open) listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  const count = history.entries.length - 1;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Every change to this project, from the first: click a step to go back to it"
        className={`${compact ? 'h-7 px-2 text-xs' : 'h-8 px-2 text-xs'} rounded-lg flex items-center gap-1.5 font-medium border border-slate-800 cursor-default ${open ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:text-white hover:bg-slate-800'}`}
      >
        <History className="w-3.5 h-3.5" /> History
        {count > 0 && <span className="font-mono text-[10.5px] text-slate-500 tabular-nums">{count}</span>}
        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl shadow-black/50"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="flex items-center justify-between px-1.5 pb-1">
            <span className="text-[12.5px] font-semibold text-slate-100">History</span>
            <span className="text-[10.5px] text-slate-500">click a step to go back to it</span>
          </div>
          <ol ref={listRef} className="flex flex-col-reverse gap-0.5 max-h-80 overflow-y-auto">
            {history.entries.map((entry, n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => {
                    history.goTo(n);
                    setOpen(false);
                  }}
                  aria-current={n === history.at ? 'step' : undefined}
                  title={entry.scriptOnly ? 'Only the script of this step is kept: the audio of its Sync was let go (the last 3 Syncs are kept).' : undefined}
                  className={`w-full flex items-center gap-2 text-left rounded-md px-2 py-1 text-[11.5px] cursor-default ${
                    n === history.at ? 'bg-slate-800 text-slate-100' : n > history.at ? 'text-slate-600 hover:text-slate-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="truncate">{entry.label}</span>
                  {entry.scriptOnly && <span className="shrink-0 text-[10px] text-slate-600">script</span>}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600 tabular-nums">{clock(entry.time)}</span>
                  {n === history.at && <span className="shrink-0 text-[10px] text-slate-400">now</span>}
                  {n > history.at && <span className="shrink-0 text-[10px]">undone</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
