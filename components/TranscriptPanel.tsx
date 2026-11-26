import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Pencil, RefreshCw } from 'lucide-react';
import type { AudioSegment } from '../types';
import { timingProblems } from '../services/transcriptSegments';
import { reportError } from '../services/errorPopup';
import { TranscriptExportMenu, TranscriptExportNotice, type TranscriptExportResult, type TranscriptFormat } from './TranscriptExportMenu';
import { TranscriptSegmentEditor, formatSplitTime } from './TranscriptSegmentEditor';
import { scrollWithin } from './scrollWithin';
import { useWindowRows } from './useWindowRows';

/** 125.4 -> "2:05.4" */
const formatCueTime = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** 125.4 -> "2:05" */
const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export interface TranscriptPanelProps {
  segments: AudioSegment[];
  /** Language ElevenLabs heard, when known. */
  spokenLanguage?: string;
  isTranscribing: boolean;
  pipelineStatus?: string;
  /** Something else runs on the project (a translation): Edit waits for it. */
  busy?: boolean;
  onSeek?: (time: number) => void;
  activeSegmentId?: string | number | null;
  /** Saves the transcript as a file; omitted hides Export. */
  onExport?: (format: TranscriptFormat) => Promise<TranscriptExportResult>;
  /** Saves the edited lines as one Undo step; omitted hides Edit. */
  onApplySegments?: (segments: AudioSegment[]) => void;
  /** The segments as transcribed, kept from the first change, for Reset. */
  transcriptCuts?: AudioSegment[] | null;
  /** Plays the original between two times. */
  onHear?: (start: number, end: number) => void;
  /** Where the playhead is on the original's clock: S splits the line there. */
  getPlayhead?: () => number;
  /** Told when the editor opens or closes. */
  onEditingChange?: (editing: boolean) => void;
  /** Shown before there is a transcript. */
  emptyHint?: React.ReactNode;
  /** Under the list while it is not being edited, e.g. the next step's button. */
  footer?: React.ReactNode;
  /** Shown in the header instead of Edit when the lines can't be edited here. */
  readOnlyNote?: React.ReactNode;
  className?: string;
}

/**
 * The transcript with its timestamps, and its one editor behind Edit: type in
 * a line, split, join, change the speaker or remove a line, saved as one step.
 */
export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  segments,
  spokenLanguage = '',
  isTranscribing,
  pipelineStatus = '',
  busy = false,
  onSeek,
  activeSegmentId = null,
  onExport,
  onApplySegments,
  transcriptCuts = null,
  onHear,
  getPlayhead,
  onEditingChange,
  emptyHint = 'Press Transcribe to write down what is said.',
  footer,
  readOnlyNote,
  className = '',
}) => {
  const [editing, setEditingState] = useState(false);
  /** The playhead time S was pressed at, to split as the editor opens. */
  const [splitOnOpen, setSplitOnOpen] = useState<number | null>(null);
  const [exportResult, setExportResult] = useState<TranscriptExportResult | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const setEditing = (on: boolean) => {
    setEditingState(on);
    onEditingChange?.(on);
  };

  const hasTranscript = segments.some((s) => (s.textSource || s.originalText || '').trim());
  const working = busy || isTranscribing;
  const canEdit = Boolean(onApplySegments) && hasTranscript && !working;
  const editorOpen = editing && Boolean(onApplySegments);

  // A 2-hour transcript has thousands of segments: only those in view are drawn.
  const listShown = !editorOpen && !isTranscribing && hasTranscript;
  const rows = useWindowRows({
    scroller: listRef,
    count: listShown ? segments.length : 0,
    // A line of text and its padding; a long one wraps to more.
    estimate: (i) => 21 + Math.ceil(Math.max(1, (segments[i]?.textSource || segments[i]?.originalText || '').length) / 90) * 18,
    keyOf: (i) => String(segments[i].id),
    data: segments,
  });
  /** Brings a segment into view: one drawn the least distance, one not drawn to the middle. */
  const showSegment = (index: number, block: 'nearest' | 'center' = 'nearest') => {
    const seg = segments[index];
    if (!seg) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-cue-id="${CSS.escape(String(seg.id))}"]`);
    if (row) scrollWithin(row, block);
    else rows.scrollToRow(index, 'center');
  };

  // Keep the cue being played in view.
  useEffect(() => {
    if (activeSegmentId === null || !listRef.current) return;
    showSegment(segments.findIndex((seg) => String(seg.id) === String(activeSegmentId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegmentId]);

  // S on the transcript opens the editor with a split at the playhead.
  useEffect(() => {
    if (editing || !canEdit || !getPlayhead) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 's') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      setExportResult(null);
      setSplitOnOpen(getPlayhead());
      setEditing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, canEdit, getPlayhead]);

  const flagged = useMemo(() => new Map(timingProblems(segments).map((p) => [String(p.id), p])), [segments]);
  const length = segments.length ? segments[segments.length - 1].endTime : 0;
  const multiSpeaker = useMemo(() => new Set(segments.map((s) => (s.speaker || '').trim())).size > 1, [segments]);

  return (
    <section aria-label="Transcript" className={`flex flex-col min-h-0 bg-slate-900/90 border border-edge rounded-2xl overflow-hidden ${className}`}>
      {!editorOpen && (
        <div className="shrink-0 flex flex-wrap items-center gap-2.5 px-4 min-h-12 py-2 border-b border-edge">
          <FileText className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-slate-100">Transcript</h2>
          {hasTranscript && !isTranscribing && (
            <span className="text-xs text-slate-400 tabular-nums">
              {segments.length} {segments.length === 1 ? 'line' : 'lines'} · {formatLength(length)}
              {spokenLanguage ? ` · ${spokenLanguage}` : ''}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {onApplySegments && hasTranscript && (
              <button
                type="button"
                onClick={() => {
                  setExportResult(null);
                  setSplitOnOpen(null);
                  setEditing(true);
                }}
                disabled={!canEdit}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-edge bg-slate-950 hover:bg-slate-800 disabled:opacity-50 disabled:hover:bg-slate-950 text-[12.5px] font-medium text-slate-200 cursor-default"
                title="Type in lines, split or join them, change who speaks, or remove a line. Or play to a point and press S."
              >
                <Pencil className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                Edit
              </button>
            )}
            {!onApplySegments && hasTranscript && readOnlyNote}
            {onExport && hasTranscript && (
              <TranscriptExportMenu
                onExport={onExport}
                onResult={setExportResult}
                disabled={!hasTranscript || isTranscribing}
                segmentCount={segments.length}
                translated={false}
              />
            )}
          </div>
        </div>
      )}

      {editorOpen ? (
        <TranscriptSegmentEditor
          segments={segments}
          transcriptCuts={transcriptCuts}
          onApply={(next) => {
            onApplySegments!(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onHear={onHear}
          formatTime={formatSplitTime}
          getPlayhead={getPlayhead}
          initialSplitTime={splitOnOpen}
        />
      ) : isTranscribing ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center" role="status" aria-live="polite">
          <RefreshCw className="w-5 h-5 text-indigo-300 animate-spin" />
          <p className="text-sm font-semibold text-slate-200">Transcribing</p>
          <p className="text-xs text-slate-400 font-mono max-w-sm truncate">{pipelineStatus || 'Working…'}</p>
        </div>
      ) : !hasTranscript ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
          <span className="w-11 h-11 mb-1 rounded-xl bg-slate-950 border border-edge flex items-center justify-center text-slate-500">
            <FileText className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-slate-300">No transcript yet</p>
          <p className="text-xs text-slate-500 max-w-xs">{emptyHint}</p>
        </div>
      ) : (
        <ol ref={listRef} className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
          <li ref={rows.spacerRef} aria-hidden="true" style={{ height: rows.padTop }} />
          {segments.slice(rows.start, rows.end).map((seg, k) => {
            const i = rows.start + k;
            const text = seg.textSource || seg.originalText || '';
            const on = activeSegmentId === seg.id;
            const problem = flagged.get(String(seg.id));
            const estimated = seg.timingSource === 'derived';
            return (
              <li key={seg.id} ref={rows.rowRef(i)} data-cue-id={String(seg.id)} className={i > 0 ? 'border-t border-slate-800/70' : ''}>
                <button
                  type="button"
                  onClick={() => Number.isFinite(seg.startTime) && onSeek?.(seg.startTime)}
                  className={`w-full grid grid-cols-[2rem_7.5rem_minmax(0,1fr)] gap-2.5 items-baseline px-4 py-2.5 text-left transition-colors cursor-default ${
                    on ? 'bg-indigo-500/10' : problem ? 'bg-rose-500/[0.06] hover:bg-rose-500/10' : 'hover:bg-slate-800/40'
                  }`}
                  title={problem ? 'Check this line’s timing' : 'Play from here'}
                >
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className={`font-mono text-[11px] tabular-nums ${problem ? 'text-rose-300' : estimated ? 'text-amber-300' : 'text-slate-400'}`}>
                    {Number.isFinite(seg.startTime) ? formatCueTime(seg.startTime) : '—'}–{Number.isFinite(seg.endTime) ? formatCueTime(seg.endTime) : '—'}
                    {problem ? (
                      <span className="block text-[9.5px] font-sans font-semibold text-rose-300/90">check timing</span>
                    ) : estimated ? (
                      <span className="block text-[9.5px] font-sans font-semibold text-amber-300/80">estimated</span>
                    ) : null}
                  </span>
                  <span className="text-[13px] leading-snug text-slate-200">
                    {multiSpeaker && (seg.speaker || '').trim() && (
                      <span className="mr-1.5 text-[11px] font-medium text-slate-500">{seg.speaker}</span>
                    )}
                    {text || <span className="italic text-slate-600">No speech</span>}
                  </span>
                </button>
              </li>
            );
          })}
          <li aria-hidden="true" style={{ height: rows.padBottom }} />
        </ol>
      )}
      {!editorOpen && (
        <TranscriptExportNotice
          result={exportResult}
          onDismiss={() => setExportResult(null)}
          onShowSegment={(index) => {
            const seg = segments[index];
            if (!seg) return;
            showSegment(index, 'center');
            if (Number.isFinite(seg.startTime)) onSeek?.(seg.startTime);
          }}
          onSaveJson={
            onExport
              ? () =>
                  void onExport('json')
                    .then(setExportResult)
                    .catch((err) => reportError(err, { title: 'Exporting the transcript failed', safe: 'Your transcript is unchanged.' }))
              : undefined
          }
        />
      )}
      {!editorOpen && hasTranscript && !isTranscribing && footer}
    </section>
  );
};
