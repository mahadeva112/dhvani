import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioSegment } from '../../types';
import { PASSAGE_PAUSES, buildPassages } from './passages';

export interface LinePacing {
  level: 'natural' | 'tight' | 'fast';
  cps: number;
  /** Seconds the line ends before the original speaker stops, when it ends early. */
  endsEarlyBy: number | null;
}

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

/** A cue's text as one line of the passage cell; a line break inside a cue would shift every line after it. */
const asLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

// Shared by the textarea and the copy behind it, so the pace marks sit exactly under the words.
const CELL_TEXT = 'px-3 py-2.5 leading-[1.75] whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

interface ScriptTableViewProps {
  segments: AudioSegment[];
  /** Passages shown: those with at least one of these cues, so search and the pacing filter still narrow the table. */
  visibleIds: Set<string>;
  sourceLanguage: string;
  targetLanguage: string;
  getSourceText: (seg: AudioSegment) => string;
  getTargetText: (seg: AudioSegment) => string;
  /** Writes several cues' dub lines in one change. */
  onUpdateLines: (lines: { id: string | number; text: string }[]) => void;
  /** How a line fits its cue, worked out from the text being typed. */
  getPacing: (seg: AudioSegment, text: string) => LinePacing;
  passagePause: number;
  onPassagePauseChange: (pause: number) => void;
  activeSegmentId: string | number | null;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  fontSize?: number;
}

/**
 * The script as a plain table, one row per passage: the original's lines
 * beside one editable cell of dub text, one line per cue. Edits go back to
 * the cues when the cell loses focus, and only when every cue still has its line.
 */
export function ScriptTableView({
  segments,
  visibleIds,
  sourceLanguage,
  targetLanguage,
  getSourceText,
  getTargetText,
  onUpdateLines,
  getPacing,
  passagePause,
  onPassagePauseChange,
  activeSegmentId,
  isPlaying,
  onSeek,
  fontSize = 15,
}: ScriptTableViewProps) {
  const passages = useMemo(() => buildPassages(segments, passagePause), [segments, passagePause]);
  const shown = passages.filter((p) => p.cues.some((seg) => visibleIds.has(String(seg.id))));

  // Text being typed, or kept because its lines no longer match the cues, by passage.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const savedText = (cues: AudioSegment[]) => cues.map((seg) => asLine(getTargetText(seg))).join('\n');

  const dropDraft = (key: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  const commit = (key: string, cues: AudioSegment[]) => {
    const draft = drafts[key];
    if (draft === undefined) return;
    const lines = draft.split('\n');
    if (lines.length !== cues.length) return; // kept, with a note, until the lines match again
    const changed = cues
      .map((seg, i) => ({ id: seg.id, text: lines[i], before: asLine(getTargetText(seg)) }))
      .filter((l) => l.text !== l.before)
      .map(({ id, text }) => ({ id, text }));
    if (changed.length > 0) onUpdateLines(changed);
    dropDraft(key);
  };

  // Follow playback to the passage being heard, but never while someone is typing.
  const activeKey = useMemo(
    () => passages.find((p) => p.cues.some((seg) => seg.id === activeSegmentId))?.key ?? null,
    [passages, activeSegmentId]
  );
  useEffect(() => {
    if (!isPlaying || !activeKey || editing) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-passage="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeKey, isPlaying, editing]);

  const markClass = (p: LinePacing) =>
    p.level === 'fast' ? 'bg-rose-500/25 rounded-sm' : p.level === 'tight' ? 'bg-amber-400/15 rounded-sm' : '';

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-slate-800 text-[11px] text-slate-400">
        <span title="A new passage starts where the original speaker pauses this long, or the speaker changes">
          Split at original pauses over
        </span>
        <div role="group" aria-label="Pause that starts a passage" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
          {PASSAGE_PAUSES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={passagePause === p}
              onClick={() => onPassagePauseChange(p)}
              className={`px-2 py-0.5 rounded-md font-mono tabular-nums cursor-pointer transition-colors ${
                passagePause === p ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p}s
            </button>
          ))}
        </div>
        <span className="ml-auto text-slate-500">One line per cue · Esc undoes the cell</span>
      </div>
      <div className="p-3 sm:p-4">
      <table className="w-full table-fixed border-collapse text-slate-200" style={{ fontSize: `${fontSize}px` }}>
        <colgroup>
          <col className="w-[5.5rem]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] font-semibold text-slate-400">
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">Passage</th>
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{sourceLanguage || 'Original'}</th>
            <th className="border border-slate-700/70 bg-slate-950/60 px-3 py-2 font-semibold">{targetLanguage || 'Dub script'}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((passage) => {
            const { key, cues } = passage;
            const value = drafts[key] ?? savedText(cues);
            const lines = value.split('\n');
            const mismatch = lines.length !== cues.length;
            const paces = cues.map((seg, i) => getPacing(seg, lines[i] ?? ''));
            const fast = paces.filter((p) => p.level === 'fast').length;
            const tight = paces.filter((p) => p.level === 'tight').length;
            const start = cues[0].startTime;
            const end = cues[cues.length - 1].endTime;
            return (
              <tr key={key} data-passage={key} className={key === activeKey ? 'bg-indigo-500/[0.06]' : ''}>
                <td className="border border-slate-700/70 px-3 py-2.5 align-top text-[11px] text-slate-500">
                  <div className="text-[13px] font-semibold text-slate-200">{passage.index + 1}</div>
                  <button
                    type="button"
                    onClick={() => onSeek(start)}
                    className="mt-1 block text-left font-mono tabular-nums leading-relaxed hover:text-indigo-300 cursor-pointer"
                    title="Play this passage"
                  >
                    {formatTime(start)}
                    <br />
                    {formatTime(end)}
                  </button>
                  <div className="mt-1">
                    {cues.length} {cues.length === 1 ? 'line' : 'lines'}
                  </div>
                  {fast > 0 && <div className="mt-1 text-rose-300">{fast} too fast</div>}
                  {tight > 0 && <div className="mt-0.5 text-amber-300/90">{tight} tight</div>}
                </td>

                <td className="border border-slate-700/70 align-top text-slate-400">
                  <div className={CELL_TEXT} lang={sourceLanguage || undefined}>
                    {cues.map((seg) => (
                      <div
                        key={String(seg.id)}
                        onClick={() => window.getSelection()?.isCollapsed && onSeek(seg.startTime)}
                        className={`cursor-pointer hover:text-slate-200 ${seg.id === activeSegmentId ? 'text-indigo-200' : ''}`}
                        title={`${formatTime(seg.startTime)} · play from here`}
                      >
                        {asLine(getSourceText(seg)) || ' '}
                      </div>
                    ))}
                  </div>
                </td>

                <td className="border border-slate-700/70 align-top p-0 focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-indigo-500">
                  <div className="grid" lang={targetLanguage || undefined}>
                    {/* The same text, invisible, behind the textarea: it sizes the cell and carries the pace marks. */}
                    <div aria-hidden className={`${CELL_TEXT} [grid-area:1/1] text-transparent pointer-events-none select-none`}>
                      {lines.map((line, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && '\n'}
                          <span className={i < cues.length ? markClass(paces[i]) : ''}>{line}</span>
                        </React.Fragment>
                      ))}
                      {'​'}
                    </div>
                    <textarea
                      value={value}
                      spellCheck={false}
                      rows={1}
                      onFocus={() => setEditing(key)}
                      onChange={(e) => {
                        const text = e.target.value;
                        setDrafts((d) => ({ ...d, [key]: text }));
                      }}
                      onBlur={() => {
                        setEditing(null);
                        commit(key, cues);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          dropDraft(key);
                          e.currentTarget.blur();
                        }
                      }}
                      aria-label={`Passage ${passage.index + 1}, ${targetLanguage || 'dub script'}, one line per cue`}
                      className={`${CELL_TEXT} [grid-area:1/1] w-full h-full resize-none overflow-hidden bg-transparent text-slate-100 outline-none caret-indigo-300`}
                    />
                  </div>
                  {mismatch && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2.5 text-[11.5px] text-rose-300">
                      <span>
                        {lines.length} lines here, this passage has {cues.length} {cues.length === 1 ? 'cue' : 'cues'}. Make
                        it one line per cue to save.
                      </span>
                      <button
                        type="button"
                        onClick={() => dropDraft(key)}
                        className="text-slate-300 underline underline-offset-2 hover:text-slate-100 cursor-pointer"
                      >
                        Undo changes
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
