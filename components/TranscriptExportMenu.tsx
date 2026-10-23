import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Loader2, X } from 'lucide-react';
import type { TimingProblem } from '../services/transcriptSegments';
import { describeTimingProblem } from '../services/transcriptExport';
import { reportError } from '../services/errorPopup';

export type TranscriptFormat = 'json' | 'txt' | 'srt';

/** What an export did: saved, the Save dialog closed, or subtitles stopped by timing to fix. */
export type TranscriptExportResult =
  | { status: 'saved'; name: string; downloaded: boolean; format: TranscriptFormat }
  | { status: 'cancelled' }
  | { status: 'blocked'; problems: TimingProblem[] };

interface TranscriptExportMenuProps {
  /** Saves the transcript in a format. Throws when saving failed. */
  onExport: (format: TranscriptFormat) => Promise<TranscriptExportResult>;
  onResult: (result: TranscriptExportResult) => void;
  /** No usable transcript yet. */
  disabled?: boolean;
  segmentCount: number;
  translated: boolean;
  /** The project has a dub, which only the .dhvani project file carries. */
  hasDub?: boolean;
}

const FORMATS: { id: TranscriptFormat; tag: string; title: string }[] = [
  { id: 'json', tag: 'JSON', title: 'Dhvani JSON' },
  { id: 'txt', tag: 'TXT', title: 'Paragraph text' },
  { id: 'srt', tag: 'SRT', title: 'Subtitles' },
];

/**
 * Export on the transcript: Dhvani JSON to carry on in Dhvani, paragraphs to
 * read, or one subtitle per segment. Nothing is transcribed or translated.
 */
export const TranscriptExportMenu: React.FC<TranscriptExportMenuProps> = ({
  onExport,
  onResult,
  disabled,
  segmentCount,
  translated,
  hasDub,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<TranscriptFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hint: Record<TranscriptFormat, string> = {
    json: `Segments, times, speakers and language${translated ? ', with the translation' : ''}. Open it with Import project to carry on. The audio${hasDub ? ' and dub' : ''} aren't inside.`,
    txt: 'Readable paragraphs without timestamps. Words exactly as transcribed.',
    srt: 'One subtitle per segment, with its start and end time.',
  };

  const run = async (format: TranscriptFormat) => {
    setOpen(false);
    setBusy(format);
    try {
      onResult(await onExport(format));
    } catch (err) {
      reportError(err, { title: 'Exporting the transcript failed', safe: 'Your transcript is unchanged.', retry: () => run(format) });
    } finally {
      setBusy(null);
      triggerRef.current?.focus();
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const i = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : FORMATS.length - 1)) % FORMATS.length;
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy !== null}
        title={disabled ? 'Transcribe the audio first' : 'Export the transcript'}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="h-8 pl-2.5 pr-2 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-[12px] font-semibold text-slate-100 disabled:opacity-50 disabled:hover:bg-slate-800 cursor-default"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {busy ? 'Exporting…' : 'Export'}
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export the transcript"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-10 z-30 w-[22rem] max-w-[calc(100vw-2rem)] p-1.5 rounded-xl border border-slate-700 bg-slate-900 shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
        >
          <div className="px-2.5 pt-1.5 pb-2 text-[11px] text-slate-500">
            Export the transcript · {segmentCount} {segmentCount === 1 ? 'segment' : 'segments'}
            {translated ? ', translated' : ', not translated'}
          </div>
          {FORMATS.map((f, i) => {
            const main = f.id === 'json';
            return (
              <button
                key={f.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                onClick={() => void run(f.id)}
                className={`w-full flex items-start gap-3 p-2.5 rounded-lg text-left cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
                  i > 0 ? 'mt-1' : ''
                } ${main ? 'bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/15' : 'border border-transparent hover:bg-slate-800/60'}`}
              >
                <span
                  className={`shrink-0 w-11 text-center text-[10px] font-mono font-semibold py-1 rounded-md ${
                    main ? 'bg-indigo-500/20 text-indigo-200' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {f.tag}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-slate-100">
                    {f.title}
                    {main && (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200">
                        Continue in Dhvani
                      </span>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{hint[f.id]}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** The line under the transcript that says what the last export did. */
export const TranscriptExportNotice: React.FC<{
  result: TranscriptExportResult | null;
  onDismiss: () => void;
  /** Scrolls to a segment by its place in the transcript. */
  onShowSegment?: (index: number) => void;
  onSaveJson?: () => void;
}> = ({ result, onDismiss, onShowSegment, onSaveJson }) => {
  if (!result || result.status === 'cancelled') return null;
  if (result.status === 'saved') {
    return (
      <div role="status" className="flex items-center gap-2 px-4 py-2.5 border-t border-emerald-500/30 bg-emerald-500/[0.07] text-[12px] text-emerald-200">
        <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {result.downloaded ? 'Saved to your downloads as ' : 'Saved '}
          {result.name}
          {result.format === 'json' ? ' · open it with Import project' : ''}
        </span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-emerald-500/10 cursor-default">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  const shown = result.problems.slice(0, 3);
  const more = result.problems.length - shown.length;
  return (
    <div role="alert" className="flex items-start gap-2.5 px-4 py-3 border-t border-rose-500/30 bg-rose-500/[0.08] text-[12px]">
      <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-px" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-rose-200">
          Subtitles not saved: {result.problems.length} {result.problems.length === 1 ? 'segment has' : 'segments have'} timing to fix
        </span>
        <span className="block text-slate-300 mt-0.5 leading-snug">
          {shown.map(describeTimingProblem).join('. ')}
          {more > 0 ? `, and ${more} more` : ''}. Nothing was changed in your project.
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
        {onShowSegment && (
          <button
            type="button"
            onClick={() => onShowSegment(result.problems[0].index)}
            className="h-7 px-2.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 cursor-default"
          >
            Show {String(result.problems[0].index + 1).padStart(2, '0')}
          </button>
        )}
        {onSaveJson && (
          <button
            type="button"
            onClick={onSaveJson}
            className="h-7 px-2.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[11.5px] text-slate-200 cursor-default"
          >
            Save Dhvani JSON instead
          </button>
        )}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-slate-800 text-slate-400 cursor-default">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
};
