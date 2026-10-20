import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { TimelineNote } from '../types';

/*
 * The editor's own markers on the Edit timing timeline: a flag on the ruler
 * with a note ("check this again"). A click jumps there and opens the note,
 * a drag moves the flag. Nothing renders or exports them.
 */

const MARKER_HUE = '#fbbf24';

const clock = (seconds: number) => {
  const t = Math.max(0, seconds);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
};

export const newMarker = (time: number): TimelineNote => ({
  id: `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  time: Math.max(0, time),
  note: '',
});

export const sortMarkers = (markers: TimelineNote[]) => [...markers].sort((a, b) => a.time - b.time);

interface MarkerProps {
  markers: TimelineNote[];
  onChange: (markers: TimelineNote[]) => void;
  windowStart: number;
  windowSeconds: number;
  /** Seconds drawn past the right edge, for a timeline that glides. */
  ahead?: number;
  total: number;
  /** The open note, by marker id. */
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
  onSeek: (time: number) => void;
}

/** The flags, drawn over the ruler. */
export const MarkerFlags: React.FC<MarkerProps> = ({ markers, onChange, windowStart, windowSeconds, ahead = 0, total, editingId, onEditingChange, onSeek }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const [dragTime, setDragTime] = useState<{ id: string; time: number } | null>(null);
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  const timeAt = (clientX: number) => {
    const box = rowRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return windowStart;
    return Math.min(total, Math.max(0, windowStart + ((clientX - box.left) / box.width) * windowSeconds));
  };
  const timeOf = (m: TimelineNote) => (dragTime?.id === m.id ? dragTime.time : m.time);
  const editing = markers.find((m) => m.id === editingId) ?? null;

  return (
    <div ref={rowRef} className="absolute inset-0 pointer-events-none">
      {markers.map((m, i) => {
        const at = timeOf(m);
        if (at < windowStart - 1 || at > windowStart + windowSeconds + ahead + 1) return null;
        return (
          <button
            key={m.id}
            type="button"
            aria-label={`Marker ${i + 1} at ${clock(at)}${m.note ? `: ${m.note}` : ''}`}
            title={`${m.note || 'Marker'} · ${clock(at)}\nClick to jump here and edit the note; drag to move it.`}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { id: m.id, x: e.clientX, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== m.id) return;
              if (!d.moved && Math.abs(e.clientX - d.x) < 3) return;
              d.moved = true;
              setDragTime({ id: m.id, time: timeAt(e.clientX) });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (!d) return;
              if (d.moved) {
                const time = timeAt(e.clientX);
                onChange(sortMarkers(markers.map((x) => (x.id === m.id ? { ...x, time } : x))));
              } else {
                onSeek(m.time);
                onEditingChange(editingId === m.id ? null : m.id);
              }
              setDragTime(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragTime(null);
            }}
            className="absolute top-0 -ml-[5px] w-[11px] h-full pointer-events-auto cursor-default touch-none z-20"
            style={{ left: `${pct(at)}%` }}
          >
            <svg viewBox="0 0 11 16" className="w-[11px] h-4" aria-hidden="true">
              <path d="M5 0h6v7H5z" fill={MARKER_HUE} opacity={editingId === m.id ? 1 : 0.85} />
              <rect x="4.5" y="0" width="1.25" height="16" fill={MARKER_HUE} />
            </svg>
          </button>
        );
      })}
      {editing && (
        <MarkerNote
          key={editing.id}
          marker={editing}
          left={Math.min(100, Math.max(0, pct(timeOf(editing))))}
          onNote={(note) => onChange(markers.map((x) => (x.id === editing.id ? { ...x, note } : x)))}
          onRemove={() => {
            onChange(markers.filter((x) => x.id !== editing.id));
            onEditingChange(null);
          }}
          onClose={() => onEditingChange(null)}
        />
      )}
    </div>
  );
};

/** A marker's note, open under its flag. */
const MarkerNote: React.FC<{
  marker: TimelineNote;
  left: number;
  onNote: (note: string) => void;
  onRemove: () => void;
  onClose: () => void;
}> = ({ marker, left, onNote, onRemove, onClose }) => {
  const [draft, setDraft] = useState(marker.note);
  const boxRef = useRef<HTMLDivElement>(null);
  const save = () => {
    if (draft.trim() !== marker.note) onNote(draft.trim());
  };
  // A click anywhere else keeps the note and closes it.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      saveRef.current();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);
  return (
    <div
      ref={boxRef}
      className="absolute top-full mt-1 z-30 w-64 p-2 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl pointer-events-auto"
      style={{ left: `${left}%`, transform: `translateX(-${left > 70 ? 100 : left < 30 ? 0 : 50}%)` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-amber-300">Marker · {clock(marker.time)}</span>
        <button
          type="button"
          onClick={onRemove}
          title="Delete this marker"
          aria-label="Delete this marker"
          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-300 hover:bg-slate-800 cursor-default"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        autoFocus
        type="text"
        value={draft}
        placeholder="A note, e.g. check this again"
        aria-label="Marker note"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            save();
            onClose();
          }
          if (e.key === 'Escape') onClose();
        }}
        className="w-full px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-[12.5px] text-slate-100 focus:outline-none focus:border-amber-400"
      />
      <p className="text-[10.5px] text-slate-500 mt-1">Enter saves. Only you see markers; they don't change the dub.</p>
    </div>
  );
};

/** A faint line down the lanes at each marker, under everything else. */
export const MarkerLines: React.FC<{ markers: TimelineNote[]; windowStart: number; windowSeconds: number; ahead?: number }> = ({ markers, windowStart, windowSeconds, ahead = 0 }) => (
  <>
    {markers.map((m) =>
      m.time < windowStart || m.time > windowStart + windowSeconds + ahead ? null : (
        <span
          key={m.id}
          aria-hidden="true"
          className="absolute top-6 bottom-0 border-l border-dashed pointer-events-none z-10"
          style={{ left: `${((m.time - windowStart) / windowSeconds) * 100}%`, borderColor: `${MARKER_HUE}66` }}
        />
      )
    )}
  </>
);

/** The markers as a row of chips under the tools: a click jumps there. */
export const MarkerList: React.FC<{ markers: TimelineNote[]; onJump: (marker: TimelineNote) => void }> = ({ markers, onJump }) =>
  markers.length === 0 ? null : (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Markers">
      <span className="text-[11px] text-slate-500">Markers</span>
      {markers.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onJump(m)}
          title={`Jump to ${clock(m.time)}`}
          className="max-w-[16rem] h-6 px-2 flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-[11px] text-amber-200 hover:bg-amber-400/20 cursor-default"
        >
          <span className="font-mono tabular-nums text-amber-300">{clock(m.time)}</span>
          <span className="truncate">{m.note || `Marker ${i + 1}`}</span>
        </button>
      ))}
    </div>
  );
