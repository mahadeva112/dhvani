import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Pause, Pencil, Play, Plus, Trash2, Undo2, FileText } from 'lucide-react';
import type { AudioSegment } from '../types';
import { ToolWindow, toolPrimaryButton, toolSecondaryButton } from './ToolWindow';
import { ReviewPicture, type ReviewClock, type ReviewVideo } from './ReviewVideoPanel';
import { useLiveFrame } from './useLiveTime';
import { sourceOf } from '../services/transcriptSegments';
import { SPEAKER_COLORS, speakerOf } from '../services/speakers';
import { applyTranscriptDraft, draftChanges, type TranscriptDraftLine } from '../services/transcriptEdit';

/** 125.4 -> "2:05" */
const clock = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const draftOf = (segments: AudioSegment[]): TranscriptDraftLine[] =>
  segments.map((s) => ({ id: String(s.id), text: sourceOf(s), speaker: speakerOf(s), removed: false }));

/**
 * The original transcript beside its video: click a line to go to it, ▶ to
 * hear just that line, edit or remove lines, and say who speaks each one.
 * Nothing reaches the project until Save changes, which is one Undo step.
 * Times never change here; a removed line leaves its time empty.
 */
export const OriginalTranscriptWindow: React.FC<
  ReviewClock & {
    segments: AudioSegment[];
    spokenLanguage?: string;
    /** The project's review video; without one the original plays on its own. */
    video: ReviewVideo | null;
    onPickVideo: () => void;
    onSeek: (time: number) => void;
    onTogglePlay: () => void;
    /** Plays the original from `start` and stops at `end`. */
    onPlayLine: (start: number, end: number) => void;
    onSave: (segments: AudioSegment[]) => void;
    onClose: () => void;
  }
> = ({ segments, spokenLanguage, video, onPickVideo, onSeek, onTogglePlay, onPlayLine, onSave, onClose, ...clockProps }) => {
  const { currentTime, isPlaying, getLiveTime } = clockProps;
  const [draft, setDraft] = useState(() => draftOf(segments));
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [speakerMenu, setSpeakerMenu] = useState<string | null>(null);
  const [extraSpeakers, setExtraSpeakers] = useState<string[]>([]);
  const [speakerMode, setSpeakerMode] = useState(() => new Set(segments.map(speakerOf)).size > 1);
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const byId = useMemo(() => new Map(segments.map((s) => [String(s.id), s])), [segments]);
  const changes = useMemo(() => draftChanges(segments, draft, speakerOf), [segments, draft]);
  const shown = draft.filter((d) => !d.removed);
  const speakers = useMemo(() => {
    const names: string[] = [];
    for (const d of draft) if (!names.includes(d.speaker)) names.push(d.speaker);
    for (const s of extraSpeakers) if (!names.includes(s)) names.push(s);
    return names;
  }, [draft, extraSpeakers]);
  const colorOf = (name: string) => SPEAKER_COLORS[Math.max(0, speakers.indexOf(name)) % SPEAKER_COLORS.length];
  const duration = useMemo(() => segments.reduce((end, s) => Math.max(end, s.endTime || 0), 0), [segments]);

  // The line being spoken, found each frame; the list re-renders only when it changes.
  const [current, setCurrent] = useState<string | null>(null);
  const lineAt = useCallback(
    (t: number) => draft.find((d) => !d.removed && byId.get(d.id) && t >= byId.get(d.id)!.startTime && t < byId.get(d.id)!.endTime + 0.25)?.id ?? null,
    [draft, byId]
  );
  useLiveFrame(currentTime, isPlaying, getLiveTime, (t) => {
    if (barRef.current) barRef.current.style.width = `${duration ? Math.min(100, (t / duration) * 100) : 0}%`;
    if (timeRef.current) timeRef.current.textContent = clock(t);
    const id = lineAt(t);
    setCurrent((was) => (was === id ? was : id));
  });

  // The spoken line stays in view, unless a line is being typed in.
  useEffect(() => {
    if (!current || editing || !listRef.current) return;
    const list = listRef.current;
    const row = list.querySelector<HTMLElement>(`[data-line="${CSS.escape(current)}"]`);
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: 'smooth' });
    }
  }, [current, editing]);

  const update = (id: string, patch: Partial<TranscriptDraftLine>) => setDraft((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const startEdit = (id: string) => {
    commitEdit();
    setEditing(id);
    setText(draft.find((d) => d.id === id)?.text ?? '');
  };
  function commitEdit() {
    if (editing === null) return;
    const next = text.replace(/\s+/g, ' ').trim();
    // Emptied out, the line is removed instead: a line with no words can't be dubbed.
    update(editing, next ? { text: next } : { removed: true });
    setEditing(null);
  }
  const close = () => {
    if (editing !== null) commitEdit();
    if (changes.total > 0) setConfirmLeave(true);
    else onClose();
  };
  const save = () => {
    const final = editing !== null ? draft.map((d) => (d.id === editing ? { ...d, ...(text.trim() ? { text: text.trim() } : { removed: true }) } : d)) : draft;
    onSave(applyTranscriptDraft(segments, final, speakerOf));
    onClose();
  };
  const addSpeaker = (forId?: string) => {
    let n = speakers.length + 1;
    while (speakers.includes(`Speaker ${n}`)) n += 1;
    const name = `Speaker ${n}`;
    setExtraSpeakers((all) => [...all, name]);
    if (forId) update(forId, { speaker: name });
    return name;
  };
  const fromHereOn = (id: string, speaker: string) => {
    const at = draft.findIndex((d) => d.id === id);
    setDraft((all) => all.map((d, i) => (i >= at ? { ...d, speaker } : d)));
  };

  // Space plays, Enter edits the spoken line, Delete removes it, unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (typing || confirmLeave || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        onTogglePlay();
      } else if (e.key === 'Enter' && current) {
        e.preventDefault();
        startEdit(current);
      } else if (e.key === 'Delete' && current) {
        e.preventDefault();
        update(current, { removed: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const footer = confirmLeave ? (
    <div className="w-full flex flex-wrap items-center gap-3">
      <span className="text-[13px] text-slate-200">
        Leave without saving {changes.total} {changes.total === 1 ? 'change' : 'changes'}?
      </span>
      <span className="flex-1" />
      <button type="button" className={toolSecondaryButton} onClick={() => setConfirmLeave(false)}>
        Keep editing
      </button>
      <button type="button" className={`${toolPrimaryButton} !bg-rose-600 hover:!bg-rose-500`} onClick={onClose}>
        Discard
      </button>
    </div>
  ) : (
    <div className="w-full flex flex-wrap items-center gap-3">
      <span className="text-[12px] text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
        {!speakerMode ? (
          <>
            {speakers.length === 1 && <span>One speaker found.</span>}
            <button
              type="button"
              onClick={() => {
                setSpeakerMode(true);
                if (speakers.length < 2) addSpeaker();
              }}
              className="text-indigo-300 hover:text-indigo-200 cursor-default"
            >
              Someone else speaks too?
            </button>
          </>
        ) : (
          <>
            {speakers.map((name) => (
              <span key={name} className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(name) }} />
                {name}
                <span className="text-slate-500 tabular-nums">{shown.filter((d) => d.speaker === name).length}</span>
              </span>
            ))}
            <span className="text-slate-500">Pick a speaker on a line; "From here on" sets the lines after it too.</span>
          </>
        )}
      </span>
      <span className="flex-1" />
      <button type="button" className={toolSecondaryButton} onClick={close}>
        Cancel
      </button>
      <button type="button" className={toolPrimaryButton} disabled={changes.total === 0 && editing === null} onClick={save}>
        Save changes{changes.total > 0 ? ` (${changes.total})` : ''}
      </button>
    </div>
  );

  return (
    <ToolWindow
      onClose={close}
      title="Original transcript"
      subtitle={`${shown.length} ${shown.length === 1 ? 'line' : 'lines'}${spokenLanguage ? ` · ${spokenLanguage}` : ''}`}
      icon={FileText}
      tone="slate"
      widthClassName="max-w-[68rem]"
      heightClassName="h-[min(44rem,calc(100vh-3rem))]"
      closeOnBackdrop={changes.total === 0}
      bodyScrolls={false}
      footer={footer}
    >
      <div className="flex flex-col md:flex-row min-h-0 flex-1 w-full" onMouseDown={(e) => speakerMenu && !(e.target as HTMLElement).closest('[data-speaker-menu]') && setSpeakerMenu(null)}>
        {/* The picture and its transport */}
        <div className="md:w-[42%] shrink-0 p-3 md:p-5 border-b md:border-b-0 md:border-r border-edge">
          {video ? (
            <ReviewPicture {...clockProps} video={video} className="w-full h-[24vh] md:h-auto md:aspect-video rounded-xl" />
          ) : (
            <div className="w-full h-[24vh] md:h-auto md:aspect-video rounded-xl bg-slate-950 border border-edge flex flex-col items-center justify-center gap-2 text-center px-6">
              <Film className="w-6 h-6 text-slate-600" aria-hidden="true" />
              <p className="text-[12.5px] text-slate-400">No video with this project. The original plays without a picture.</p>
              <button type="button" onClick={onPickVideo} className="text-[12.5px] text-indigo-300 hover:text-indigo-200 cursor-default">
                Pick a video…
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5 mt-3">
            <button
              type="button"
              onClick={onTogglePlay}
              className="w-8 h-8 shrink-0 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center cursor-default"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-px" />}
            </button>
            <span className="font-mono text-[11.5px] text-slate-400 tabular-nums">
              <span ref={timeRef}>{clock(currentTime)}</span> / {clock(duration)}
            </span>
            <div
              role="slider"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={-1}
              className="flex-1 h-1.5 rounded-full bg-slate-800 relative"
              onMouseDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration)));
              }}
            >
              <div ref={barRef} className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" />
            </div>
          </div>
          <p className="hidden md:block text-[11.5px] text-slate-500 mt-3 leading-relaxed">
            Click a line to go to it, or its ▶ to play just that line. The line being spoken is highlighted. Enter edits it, Delete removes it.
          </p>
        </div>

        {/* The lines */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto relative">
          {draft.map((d) => {
            const seg = byId.get(d.id);
            if (!seg) return null;
            if (d.removed) {
              return (
                <div key={d.id} data-line={d.id} className="flex items-center gap-3 px-4 py-1.5 border-b border-edge/60 text-[11.5px] text-slate-500">
                  <span className="font-mono w-9 tabular-nums">{clock(seg.startTime)}</span>
                  <span className="flex-1 truncate line-through">{d.text}</span>
                  <button type="button" onClick={() => update(d.id, { removed: false })} className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 cursor-default">
                    <Undo2 className="w-3 h-3" /> Undo
                  </button>
                </div>
              );
            }
            const now = current === d.id;
            const changed = d.text !== sourceOf(seg).trim();
            return (
              <div
                key={d.id}
                data-line={d.id}
                className={`group flex items-start gap-3 px-4 py-2.5 border-b border-edge/60 border-l-2 ${now ? 'bg-indigo-950/70 border-l-indigo-400' : 'border-l-transparent hover:bg-slate-800/40'}`}
              >
                <button
                  type="button"
                  onClick={() => onPlayLine(seg.startTime, seg.endTime)}
                  className="mt-1 text-slate-500 hover:text-slate-100 cursor-default"
                  title="Play this line"
                  aria-label={`Play line at ${clock(seg.startTime)}`}
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
                <span className="font-mono text-[11.5px] text-slate-300 w-9 mt-0.5 tabular-nums">{clock(seg.startTime)}</span>
                <span className="font-mono text-[10.5px] text-slate-500 w-10 mt-[3px] tabular-nums">{(seg.endTime - seg.startTime).toFixed(1)} s</span>
                <div className="flex-1 min-w-0">
                  {speakerMode && (
                    <div className="relative mb-1" data-speaker-menu>
                      <button
                        type="button"
                        onClick={() => setSpeakerMenu(speakerMenu === d.id ? null : d.id)}
                        className="h-6 px-2 rounded-md border border-edge hover:border-slate-600 inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-default"
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(d.speaker) }} />
                        {d.speaker}
                      </button>
                      {speakerMenu === d.id && (
                        <div className="absolute z-20 top-7 left-0 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl shadow-black/60 py-1 text-[12px]">
                          {speakers.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => {
                                update(d.id, { speaker: name });
                                setSpeakerMenu(null);
                              }}
                              className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-slate-700 text-left cursor-default"
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(name) }} />
                              {name}
                              {name === d.speaker && <span className="ml-auto text-slate-500">✓</span>}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              addSpeaker(d.id);
                              setSpeakerMenu(null);
                            }}
                            className="w-full px-2.5 py-1.5 flex items-center gap-2 hover:bg-slate-700 text-left text-indigo-300 border-t border-slate-700 mt-1 cursor-default"
                          >
                            <Plus className="w-3 h-3" /> New speaker
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              fromHereOn(d.id, d.speaker);
                              setSpeakerMenu(null);
                            }}
                            className="w-full px-2.5 py-1.5 hover:bg-slate-700 text-left text-slate-400 text-[11.5px] cursor-default"
                          >
                            From here on: {d.speaker}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {editing === d.id ? (
                    <>
                      <textarea
                        autoFocus
                        rows={2}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            commitEdit();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                        onBlur={commitEdit}
                        className="w-full resize-none bg-slate-950 border border-indigo-500 rounded-lg px-2.5 py-1.5 text-[13.5px] leading-relaxed text-slate-100 outline-none"
                      />
                      <p className="text-[10.5px] text-slate-500 mt-1">Enter keeps · Esc cancels · the line's time stays as it is</p>
                    </>
                  ) : (
                    <p
                      onClick={() => onSeek(seg.startTime)}
                      onDoubleClick={() => startEdit(d.id)}
                      className={`text-[13.5px] leading-relaxed ${now ? 'text-slate-50' : 'text-slate-200'}`}
                    >
                      {d.text}
                      {changed && <span className="ml-1.5 text-[10.5px] text-slate-500">edited</span>}
                    </p>
                  )}
                </div>
                {editing !== d.id && (
                  <span className={`flex items-center gap-0.5 shrink-0 ${now ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                    <button
                      type="button"
                      onClick={() => startEdit(d.id)}
                      className="w-7 h-7 rounded-md hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-default"
                      title="Edit words (Enter)"
                      aria-label="Edit words"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => update(d.id, { removed: true })}
                      className="w-7 h-7 rounded-md hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-rose-300 cursor-default"
                      title="Remove line (Delete)"
                      aria-label="Remove line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </ToolWindow>
  );
};
