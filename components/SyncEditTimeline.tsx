import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignStartVertical,
  ArrowRightToLine,
  Check,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  Magnet,
  Maximize2,
  Mic,
  Redo2,
  RotateCcw,
  Scissors,
  SquareSplitHorizontal,
  TriangleAlert,
  Undo2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { TimelineRuler, useTimelineZoom, useWindowPlayheads, wheelScroll } from './TimelineControls';
import { WindowWaveform, usePeaks, type PeakData } from './WindowWaveform';
import { hueOf, withAlpha } from './lineColors';
import { decodeAudioBlobUrl } from '../services/audioService';
import { alignTakeWords } from '../services/syncTakesService';
import { wordsInTakeRange } from '../services/takeRange';
import type { SyncReport, SyncUnitReport } from '../services/syncService';
import {
  basePart,
  hasEdits,
  isEdited,
  isOriginalClip,
  MAX_EDIT_RATE,
  measureEdits,
  MIN_EDIT_RATE,
  MIN_PART_SECONDS,
  ORIGINAL_CLIP_PREFIX,
  originalLines,
  partEnd,
  partLength,
  partsOf,
  partTime,
  SyncBank,
  SyncEditPart,
  SyncEdits,
} from '../services/syncEditService';

/**
 * Edit timing: the synced dub's lines on a timeline under the original, to
 * move, trim, split, stretch, slip, fade, turn up or down and mute by hand
 * after Sync has placed them.
 *
 *   ruler     time; drag across it to zoom to that stretch
 *   Original   the original's waveform, each line in its colour (locked);
 *              drag across it to pick a stretch, then drag the stretch down
 *              onto the dub (or Ctrl + C, Ctrl + V at the playhead) to fill a
 *              gap with the original's own voice: a clip of the original
 *   links      from each original line's start to where its dub line's first
 *              word now lands: upright is in sync
 *   dub        the lines as they will play, each part with its waveform as
 *              edited (gain, fades); where a drag starts on a line says what
 *              it does (see zoneAt), with no tool to pick first
 *   script     what each line says, under where it plays
 *   drift      each line's start error against the tolerance band
 *   overview   under the lanes, like a scrollbar: the whole dub, each line
 *              coloured by how it lands; the frame is the stretch on screen,
 *              and dragging it scrolls
 *
 * Edits are drawn while dragging and handed up (onChange) when the pointer
 * lets go, with a name for the history. Every edited line is locked: Sync
 * keeps it where it is when it runs again.
 */

export type SyncEditStatus = {
  state: 'ready' | 'pending' | 'rendering' | 'error';
  message?: string;
  /** Something to tell the user once, such as edits a sync had to drop. */
  notice?: string;
};

/** How close to a line's edge (px) a drag trims or stretches rather than moves. */
const EDGE_PX = 7;
/** The band along a line's top (px) where its fade corners and gain are. */
const TOP_BAND_PX = 10;
/** How close to a fade corner (px) a drag sets the fade. */
const CORNER_PX = 9;
/** Gain a vertical drag on a line's top edge changes per pixel. */
const DB_PER_PX = 0.25;
const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 12;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const formatTime = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  return `${m}:${(t % 60).toFixed(3).padStart(6, '0')}`;
};
const formatShift = (seconds: number) => `${seconds >= 0 ? '+' : '−'}${Math.abs(seconds).toFixed(2)} s`;

/** How a line lands, in the colours the sync report uses. */
const landing = (unit: SyncUnitReport | undefined, tolerance: number) => {
  if (!unit || unit.offset === null) return { label: 'silent', color: '#64748b', chip: 'bg-slate-700/40 text-slate-300' };
  const off = Math.abs(unit.offset);
  if (unit.inSync) return { label: 'in sync', color: '#34d399', chip: 'bg-emerald-500/15 text-emerald-300' };
  if (off <= tolerance * 2) return { label: unit.offset > 0 ? 'a little late' : 'a little early', color: '#fbbf24', chip: 'bg-amber-400/15 text-amber-300' };
  return { label: unit.offset > 0 ? 'late' : 'early', color: '#f87171', chip: 'bg-rose-500/15 text-rose-300' };
};

/** Pixels within which an edge snaps. */
const SNAP_PX = 8;

/** What an edge can snap to: an original line's start or end, another line's edge, or the playhead. */
type SnapKind = 'start' | 'end' | 'edge' | 'playhead';
type SnapTarget = { t: number; kind: SnapKind; label: string };
const ANY_SNAP: SnapKind[] = ['start', 'end', 'edge', 'playhead'];

/** Keeps a drag following the pointer outside the lane; a pointer already gone still drags over the lane. */
const capture = (e: React.PointerEvent<HTMLElement>) => {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // nothing to capture
  }
};

let partCounter = 0;
const newPartId = (key: string) => `${key}#${Date.now().toString(36)}${(partCounter++).toString(36)}`;

/** The colour of a clip of the original on the dub: the Original lane's. */
const ORIGINAL_HUE = '#22d3ee';

/** One part on the dub lane, with the line it belongs to. */
type Chunk = {
  key: string;
  line: number;
  /** A clip of the original rather than a line of the dub. */
  original: boolean;
  unit: SyncUnitReport | undefined;
  unitIndex: number;
  part: SyncEditPart;
  /** The line's number, with a letter for each part once it is split. */
  label: string;
};

/** A line's edits replaced by `parts`. Anything edited is locked. A clip of the original with no parts left is gone. */
const withParts = (edits: SyncEdits, key: string, parts: SyncEditPart[]): SyncEdits => {
  if (parts.length === 0 && isOriginalClip(key)) {
    const { [key]: _gone, ...rest } = edits;
    return rest;
  }
  return { ...edits, [key]: { parts, locked: true } };
};

/** The clips of the original in `edits`, to tell whether a drag changed any. */
const originalsOf = (edits: SyncEdits | null | undefined) => JSON.stringify(Object.entries(edits ?? {}).filter(([key]) => isOriginalClip(key)));

const sameEdits = (a: SyncEdits | null | undefined, b: SyncEdits | null | undefined) => a === b || (!hasEdits(a) && !hasEdits(b));

/** A part's waveform, as it will play: its stretch of the bank, with its gain and fades. */
const PartWave: React.FC<{
  data: PeakData | null;
  bankOffset: number;
  part: SyncEditPart;
  color: string;
}> = React.memo(({ data, bankOffset, part, color }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setSize((n) => n + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const { from, to, rate, gainDb, fadeIn, fadeOut } = part;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!data || data.seconds <= 0) return;
    const length = (to - from) / rate;
    const gain = 10 ** (gainDb / 20);
    const bars = Math.max(1, Math.floor(w / 2));
    const n = data.peaks.length;
    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
      const t0 = (i / bars) * length;
      const t1 = ((i + 1) / bars) * length;
      const b0 = Math.max(0, Math.floor(((bankOffset + from + t0 * rate) / data.seconds) * n));
      const b1 = Math.min(n, Math.max(b0 + 1, Math.floor(((bankOffset + from + t1 * rate) / data.seconds) * n)));
      let a = 0;
      for (let b = b0; b < b1; b++) if (data.peaks[b] > a) a = data.peaks[b];
      const mid = (t0 + t1) / 2;
      let envelope = gain;
      if (fadeIn > 0) envelope *= Math.min(1, mid / fadeIn);
      if (fadeOut > 0) envelope *= Math.min(1, (length - mid) / fadeOut);
      const bh = Math.max(1, Math.min(1, a * envelope) * (h - 6));
      ctx.fillRect(i * (w / bars), (h - bh) / 2, Math.max(1, w / bars - 0.5), bh);
    }
    // The fades, as a ramp over the waveform.
    ctx.strokeStyle = 'rgba(241,245,249,0.75)';
    ctx.lineWidth = 1;
    if (fadeIn > 0) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(Math.min(w, (fadeIn / length) * w), 0);
      ctx.stroke();
    }
    if (fadeOut > 0) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, w - (fadeOut / length) * w), 0);
      ctx.lineTo(w, h);
      ctx.stroke();
    }
  }, [data, bankOffset, from, to, rate, gainDb, fadeIn, fadeOut, color, size]);
  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />;
});

/** A toolbar button whose name and shortcut show on hover or keyboard focus. */
const ToolButton: React.FC<{
  label: string;
  shortcut: string;
  hint?: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, shortcut, hint, pressed, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={pressed}
    aria-keyshortcuts={shortcut === 'Drag' ? undefined : shortcut}
    title={hint || label}
    aria-label={label}
    className={`group relative h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      pressed ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/60' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
    }`}
  >
    {children}
    <span
      role="tooltip"
      className="hidden sm:block pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 w-max max-w-[16rem] rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-left text-[11px] font-normal leading-snug text-slate-300 opacity-0 shadow-lg shadow-black/40 transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      <span className="flex items-center gap-2 font-medium text-slate-100">
        {label}
        <kbd className="ml-auto rounded border border-slate-600 bg-slate-800 px-1.5 font-mono text-[10.5px] text-slate-200">{shortcut}</kbd>
      </span>
      {hint && <span className="mt-0.5 block whitespace-normal text-slate-400">{hint}</span>}
    </span>
  </button>
);

/** A small action with its shortcut on it. */
const ActionButton: React.FC<{ label: string; shortcut?: string; onClick: () => void; children: React.ReactNode; title?: string }> = ({
  label,
  shortcut,
  onClick,
  children,
  title,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-keyshortcuts={shortcut}
    className="h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
  >
    {children}
    {label}
    {shortcut && <kbd className="rounded border border-slate-700 px-1 font-mono text-[10px] text-slate-500">{shortcut}</kbd>}
  </button>
);

/** A number in the inspector, set on Enter or when the field is left. */
const NumberField: React.FC<{
  label: string;
  value: number;
  step: number;
  digits: number;
  onCommit: (value: number) => void;
}> = ({ label, value, step, digits, onCommit }) => {
  const [text, setText] = useState(value.toFixed(digits));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value.toFixed(digits));
  }, [value, digits, focused]);
  // Read from the field itself: it may be left in the same moment it was typed in.
  const commit = (typed: string) => {
    const v = parseFloat(typed.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - value) > 10 ** -(digits + 1)) onCommit(v);
    else setText(value.toFixed(digits));
  };
  return (
    <label className="flex flex-col gap-1 text-[11px] text-slate-500 min-w-0">
      {label}
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(value.toFixed(digits));
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        className="h-8 w-full min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-2 font-mono text-[12.5px] text-slate-100 tabular-nums focus:outline-none focus:border-indigo-500"
      />
    </label>
  );
};

/**
 * The inspector with several lines picked: one gain and one pair of fades for
 * all of them. A field shows its value when every picked part has the same
 * one, and is empty when they differ; whatever is typed goes to all of them.
 */
const GroupInspector: React.FC<{
  group: Chunk[];
  onGain: (db: number) => void;
  onFadeIn: (ms: number) => void;
  onFadeOut: (ms: number) => void;
  onSpeed: (percent: number) => void;
  onMute: () => void;
  onLock: () => void;
  onReset: () => void;
  onRemove: () => void;
  onClear: () => void;
}> = ({ group, onGain, onFadeIn, onFadeOut, onSpeed, onMute, onLock, onReset, onRemove, onClear }) => {
  const lines = group.filter((c) => !c.original);
  const firstRate = lines[0]?.part.rate;
  const sameRate = firstRate !== undefined && lines.every((c) => Math.abs(c.part.rate - firstRate) < 1e-6) ? firstRate * 100 : null;
  const same = (pick: (part: SyncEditPart) => number) => {
    const first = pick(group[0].part);
    return group.every((c) => Math.abs(pick(c.part) - first) < 1e-6) ? first : null;
  };
  const allMuted = group.every((c) => c.part.muted);
  const button = 'h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5';
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-100">{group.length} lines picked</span>
        <span className="font-mono text-[11.5px] text-slate-400 truncate">{group.map((c) => c.label).join(', ')}</span>
        <button type="button" onClick={onClear} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer">
          Clear <kbd className="font-mono">Esc</kbd>
        </button>
      </div>
      <p className="mt-1 text-[11.5px] text-slate-500">Drag any of them to move them all. What you set here goes to every picked line.</p>
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <GroupField label="Speed (%)" value={sameRate} step={1} digits={0} onCommit={onSpeed} />
        <GroupField label="Gain (dB)" value={same((p) => p.gainDb)} step={0.5} digits={1} onCommit={onGain} />
        <GroupField label="Fade in (ms)" value={same((p) => p.fadeIn * 1000)} step={10} digits={0} onCommit={onFadeIn} />
        <GroupField label="Fade out (ms)" value={same((p) => p.fadeOut * 1000)} step={10} digits={0} onCommit={onFadeOut} />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={onMute} className={button}>
          <VolumeX className="w-3.5 h-3.5" /> {allMuted ? 'Unmute all' : 'Mute all'}
        </button>
        <button type="button" onClick={onLock} className={button}>
          <Lock className="w-3.5 h-3.5" /> Lock or unlock
        </button>
        <button type="button" onClick={onReset} className={button}>
          <RotateCcw className="w-3.5 h-3.5" /> Reset lines
        </button>
        <button type="button" onClick={onRemove} className={button}>
          Remove <kbd className="font-mono text-[10px] text-slate-500">Del</kbd>
        </button>
      </div>
    </>
  );
};

/** A number for several picked lines: empty, with "mixed" as its hint, when they differ. */
const GroupField: React.FC<{ label: string; value: number | null; step: number; digits: number; onCommit: (value: number) => void }> = ({
  label,
  value,
  step,
  digits,
  onCommit,
}) => {
  const shown = value === null ? '' : value.toFixed(digits);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const commit = (typed: string) => {
    const v = parseFloat(typed.replace(',', '.'));
    if (Number.isFinite(v) && (value === null || Math.abs(v - value) > 10 ** -(digits + 1))) onCommit(v);
    else setText(shown);
  };
  return (
    <label className="flex flex-col gap-1 text-[11px] text-slate-500 min-w-0">
      {label}
      <input
        type="number"
        step={step}
        value={text}
        placeholder="mixed"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        className="h-8 w-full min-w-0 rounded-lg border border-slate-800 bg-slate-950 px-2 font-mono text-[12.5px] text-slate-100 tabular-nums placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
      />
    </label>
  );
};

/** The whole dub at a glance, and the stretch of it on screen, which can be dragged. */
const Overview: React.FC<{
  total: number;
  chunks: Chunk[];
  statusOf: (chunk: Chunk) => string;
  windowStart: number;
  windowSeconds: number;
  currentTime: number;
  onScroll: (start: number) => void;
}> = ({ total, chunks, statusOf, windowStart, windowSeconds, currentTime, onScroll }) => {
  const ref = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);
  const pct = (t: number) => (t / total) * 100;
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * total;
  };
  return (
    <div
      ref={ref}
      role="scrollbar"
      aria-label="Whole dub"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(Math.max(0, total - windowSeconds))}
      aria-valuenow={Math.round(windowStart)}
      tabIndex={-1}
      className="relative h-6 rounded-lg border border-slate-800 bg-slate-950/80 overflow-hidden cursor-pointer select-none touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const t = timeAt(e.clientX);
        const onFrame = t >= windowStart && t <= windowStart + windowSeconds;
        grab.current = onFrame ? t - windowStart : windowSeconds / 2;
        if (!onFrame) onScroll(t - windowSeconds / 2);
        capture(e);
      }}
      onPointerMove={(e) => {
        if (grab.current !== null) onScroll(timeAt(e.clientX) - grab.current);
      }}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
    >
      {chunks.map((chunk) => (
        <span
          key={chunk.part.id}
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 rounded-sm pointer-events-none"
          style={{
            left: `${pct(chunk.part.start)}%`,
            width: `${Math.max(0.15, pct(partLength(chunk.part)))}%`,
            background: statusOf(chunk),
            opacity: chunk.part.muted ? 0.25 : 0.75,
          }}
        />
      ))}
      <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-rose-400 pointer-events-none" style={{ left: `${pct(clamp(currentTime, 0, total))}%` }} />
      <span
        aria-hidden="true"
        className="absolute top-0 bottom-0 rounded-md border-[1.5px] border-indigo-200/80 bg-indigo-200/10 cursor-grab active:cursor-grabbing"
        style={{ left: `${pct(windowStart)}%`, width: `${Math.max(1, pct(windowSeconds))}%` }}
      />
    </div>
  );
};

export const SyncEditTimeline: React.FC<{
  bank: SyncBank;
  bankBlob: Blob | null | undefined;
  baseReport: SyncReport;
  edits: SyncEdits | null | undefined;
  onChange: (edits: SyncEdits, label: string) => void;
  status: SyncEditStatus;
  /** The dub plays live from its lines: edits are heard at once while the file renders behind. */
  live?: boolean;
  /** The lines, decoded, for live playback; null when they go (a new sync, or the editor closing). */
  onBankAudio?: (buffer: AudioBuffer | null) => void;
  /**
   * The edits as a drag has them, while it lasts, so the live dub plays them
   * as the line moves; null when a drag ends without changing anything.
   */
  onDraft?: (edits: SyncEdits | null) => void;
  onRetry: () => void;
  sourceBuffer: AudioBuffer | null | undefined;
  /** The source's length, which the dub is as long as. */
  total: number;
  targetLanguage: string;
  currentTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  onPlayFrom: (time: number) => void;
  onClose: () => void;
  /** A lane's header with its mute, solo, fader and meter; without it the lanes show their names. */
  renderTrackHead?: (track: 'source' | 'synth', label: string, dot: string, badge?: React.ReactNode) => React.ReactNode;
  /** Opens the takes of a line (TakesPanel): new readings of it, voiced now, to pick from. */
  onOpenTakes?: (key: string, phrase?: { from: number; to: number }) => void;
  elApiKey?: string;
  takesUnavailableKeys?: string[];
}> = ({
  bank,
  bankBlob,
  baseReport,
  edits,
  onChange,
  status,
  live = false,
  onBankAudio,
  onDraft,
  onRetry,
  sourceBuffer,
  total: sourceTotal,
  targetLanguage,
  currentTime,
  isPlaying,
  getLiveTime,
  onSeek,
  onPlayFrom,
  onClose,
  renderTrackHead,
  onOpenTakes,
  elApiKey,
  takesUnavailableKeys = [],
}) => {
  const rate = bank.sampleRate;
  const committed = edits ?? {};
  const [draft, setDraft] = useState<SyncEdits | null>(null);
  const view = draft ?? committed;

  // History, with the edits as they were when the editor opened at its start.
  const [history, setHistory] = useState<{ entries: { label: string; edits: SyncEdits }[]; at: number }>(() => ({
    entries: [{ label: hasEdits(committed) ? 'Your edits so far' : 'As Sync placed it', edits: committed }],
    at: 0,
  }));
  const lastSent = useRef<SyncEdits | null | undefined>(edits);
  useEffect(() => {
    // Edits that changed from outside (a new sync) start the history again.
    if (sameEdits(edits, lastSent.current)) return;
    lastSent.current = edits;
    setHistory({ entries: [{ label: 'After Sync again', edits: edits ?? {} }], at: 0 });
  }, [edits]);
  const commit = (next: SyncEdits, label: string) => {
    lastSent.current = next;
    setHistory((h) => {
      const entries = [...h.entries.slice(0, h.at + 1), { label, edits: next }].slice(-100);
      return { entries, at: entries.length - 1 };
    });
    onChange(next, label);
  };
  const goTo = (index: number) => {
    const entry = history.entries[index];
    if (!entry || index === history.at) return;
    lastSent.current = entry.edits;
    setHistory((h) => ({ ...h, at: index }));
    onChange(entry.edits, `Back to: ${entry.label}`);
  };

  // The bank's own waveform, decoded once per bank.
  const [bankBuffer, setBankBuffer] = useState<AudioBuffer | null>(null);
  const onBankAudioRef = useRef(onBankAudio);
  onBankAudioRef.current = onBankAudio;
  useEffect(() => {
    onBankAudioRef.current?.(bankBuffer);
  }, [bankBuffer]);
  useEffect(() => () => onBankAudioRef.current?.(null), []);
  useEffect(() => {
    setBankBuffer(null);
    if (!bankBlob) return;
    let live = true;
    const url = URL.createObjectURL(bankBlob);
    decodeAudioBlobUrl(url)
      .then((buffer) => live && setBankBuffer(buffer))
      .catch((err) => console.warn('Could not draw the edited lines:', err))
      .finally(() => URL.revokeObjectURL(url));
    return () => {
      live = false;
    };
  }, [bankBlob]);
  const bankPeaks = usePeaks(bankBuffer);
  const sourcePeaks = usePeaks(sourceBuffer);

  const unitIndexByKey = useMemo(() => new Map(baseReport.units.map((unit, n) => [unit.key, n])), [baseReport]);
  const measured = useMemo(() => measureEdits(baseReport, bank, view), [baseReport, bank, view]);
  const unitByKey = useMemo(() => new Map(measured.units.map((unit) => [unit.key, unit])), [measured]);
  const tolerance = baseReport.tolerance;

  // The bank's lines, then the original once for each clip of it on the dub.
  const sourceSeconds = sourceBuffer?.duration || sourceTotal;
  const lines = useMemo(() => [...bank.lines, ...originalLines(view, sourceSeconds, rate)], [bank, view, sourceSeconds, rate]);

  const chunks: Chunk[] = useMemo(() => {
    const out: Chunk[] = [];
    let clips = 0;
    lines.forEach((line, n) => {
      const parts = [...partsOf(view, line, rate)].sort((a, b) => a.start - b.start);
      const original = Boolean(line.original);
      const unitIndex = original ? -1 : unitIndexByKey.get(line.key) ?? n;
      // A clip of the original is O1, O2… in the order they were made.
      const name = original ? `O${++clips}` : `${unitIndex + 1}`;
      parts.forEach((part, k) =>
        out.push({
          key: line.key,
          line: n,
          original,
          unit: original ? undefined : unitByKey.get(line.key),
          unitIndex,
          part,
          label: `${name}${parts.length > 1 ? 'abcdefghijklmnopqrstuvwxyz'[k] ?? `.${k + 1}` : ''}`,
        })
      );
    });
    return out.sort((a, b) => a.part.start - b.part.start);
  }, [lines, view, rate, unitIndexByKey, unitByKey]);

  const total = useMemo(() => Math.max(sourceTotal, ...chunks.map((c) => partEnd(c.part)), 1), [sourceTotal, chunks]);
  const zoom = useTimelineZoom(total, currentTime, { wheelScrollsTime: true });
  const { windowStart, windowSeconds } = zoom;
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  const playheadRef = useWindowPlayheads({
    reportedTime: currentTime,
    isPlaying,
    getLiveTime,
    windowStart,
    windowSeconds,
    follow: zoom.follow,
    onFollow: zoom.followTo,
  });

  // Open on about twenty seconds around the playhead, so lines are big enough to edit.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || total <= 25) return;
    opened.current = true;
    zoom.zoomTo(20, currentTime, 0.25);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  /** Blade: a click cuts the line there, as DaVinci Resolve's blade. Off, every drag edits by where it starts. */
  const [blade, setBlade] = useState(false);
  const [rangeTool, setRangeTool] = useState(false);
  const [takeRange, setTakeRange] = useState<{ from: number; to: number } | null>(null);
  const [rangeWords, setRangeWords] = useState<{ key: string; from: number; to: number; text: string } | null>(null);
  const [aligningRange, setAligningRange] = useState(false);
  const rangeDrag = useRef<{ chunk: Chunk; start: number; end: number } | null>(null);
  const alignmentRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    alignmentRequest.current?.abort();
    rangeDrag.current = null;
    setTakeRange(null);
    setRangeWords(null);
    setAligningRange(false);
    return () => { alignmentRequest.current?.abort(); };
  }, [bank, edits, baseReport]);
  const [snap, setSnap] = useState(true);
  const [ripple, setRipple] = useState(false);
  /*
   * The picked parts, as in a DAW: a click picks one, Ctrl + click adds or
   * drops one, a drag across empty lane picks every part it touches, Ctrl + A
   * picks all. The last one picked is the one the inspector and the one-line
   * actions (split, join, align) work on; moves, nudges, gain, fades, mute,
   * lock, reset and remove work on all of them.
   */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  const setSelected = (id: string | null) => setSelectedIds(id ? [id] : []);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const say = (text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => void (toastTimer.current && window.clearTimeout(toastTimer.current)), []);

  const chunkOf = (id: string | null) => (id ? chunks.find((c) => c.part.id === id) ?? null : null);
  const current = chunkOf(selected);
  /** Every picked part, in timeline order. */
  const group = chunks.filter((c) => selectedSet.has(c.part.id));
  const lineOf = (chunk: Chunk) => lines[chunk.line];
  const lineSeconds = (chunk: Chunk) => lineOf(chunk).length / rate;
  // A picked part that went away (undo, reset) is no longer picked.
  useEffect(() => {
    const still = selectedIds.filter((id) => chunks.some((c) => c.part.id === id));
    if (still.length !== selectedIds.length) setSelectedIds(still);
  }, [selectedIds, chunks]);
  /** How the picked parts are named in the history: "line 4", "clip O1", or "3 lines". */
  const groupName = (list: Chunk[]) => (list.length === 1 ? `${list[0].original ? 'clip' : 'line'} ${list[0].label}` : `${list.length} lines`);

  /** The room a part has: from the end of the part before it to the start of the one after, ignoring parts it already overlaps. */
  const roomOf = (id: string, among: Chunk[] = chunks) => {
    const me = among.find((c) => c.part.id === id);
    if (!me) return { lo: 0, hi: total };
    const start = me.part.start;
    const end = partEnd(me.part);
    let lo = 0;
    let hi = Math.max(total, end) + 600;
    for (const other of among) {
      if (other.part.id === id || other.part.muted) continue;
      const oEnd = partEnd(other.part);
      if (oEnd <= start + 1e-6) lo = Math.max(lo, oEnd);
      else if (other.part.start >= end - 1e-6) hi = Math.min(hi, other.part.start);
    }
    return { lo, hi };
  };

  const snapTargets = useMemo(() => {
    const list: SnapTarget[] = [];
    baseReport.units.forEach((unit, n) => {
      list.push({ t: unit.srcStart, kind: 'start', label: `original ${n + 1} start` }, { t: unit.srcEnd, kind: 'end', label: `original ${n + 1} end` });
    });
    return list;
  }, [baseReport]);
  const laneRef = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || !r.width) return windowStart;
    return windowStart + ((clientX - r.left) / r.width) * windowSeconds;
  };
  /**
   * What `times` snap to, within SNAP_PX. Each time names the kinds of target
   * it meets, and the first time that meets one wins, so a moved line's first
   * word lands on an original line's start before its edges are tried.
   */
  const snapNear = (times: { t: number; kinds: SnapKind[] }[], skip: string | Set<string>): { delta: number; at: number; label: string } | null => {
    if (!snap) return null;
    const width = laneRef.current?.getBoundingClientRect().width || 1;
    const reach = (SNAP_PX / width) * windowSeconds;
    const targets: SnapTarget[] = [...snapTargets, { t: currentTime, kind: 'playhead', label: 'playhead' }];
    for (const c of chunks) {
      if ((typeof skip === 'string' ? c.part.id === skip : skip.has(c.part.id)) || c.part.muted) continue;
      targets.push({ t: c.part.start, kind: 'edge', label: `line ${c.label} start` }, { t: partEnd(c.part), kind: 'edge', label: `line ${c.label} end` });
    }
    for (const time of times) {
      let best: { delta: number; at: number; label: string } | null = null;
      for (const target of targets) {
        if (!time.kinds.includes(target.kind)) continue;
        const delta = target.t - time.t;
        if (Math.abs(delta) <= reach && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: target.t, label: target.label };
      }
      if (best) return best;
    }
    return null;
  };

  // ---- Editing ----

  const replacePart = (base: SyncEdits, chunk: Chunk, next: SyncEditPart | null, extra: SyncEditPart[] = []) => {
    const parts = partsOf(base, lineOf(chunk), rate)
      .flatMap((part) => (part.id === chunk.part.id ? (next ? [next] : []) : [part]))
      .concat(extra);
    return withParts(base, chunk.key, parts);
  };

  /** Moves a part by `delta` seconds, and with `rippled` every part that starts after it too. Returns null when there is no room. */
  const shifted = (base: SyncEdits, chunk: Chunk, delta: number, rippled: boolean, among: Chunk[]) => {
    const { lo, hi } = roomOf(chunk.part.id, among);
    const start = chunk.part.start;
    if (!rippled) {
      const moved = clamp(start + delta, lo, Math.max(lo, hi - partLength(chunk.part)));
      return { edits: replacePart(base, chunk, { ...chunk.part, start: moved }), moved: moved - start, blocked: Math.abs(moved - (start + delta)) > 1e-6 };
    }
    const d = Math.max(delta, lo - start);
    let next = replacePart(base, chunk, { ...chunk.part, start: start + d });
    for (const other of among) {
      if (other.part.id === chunk.part.id || other.part.start <= start + 1e-9) continue;
      const parts = partsOf(next, lineOf(other), rate).map((part) => (part.id === other.part.id ? { ...part, start: Math.max(0, part.start + d) } : part));
      next = withParts(next, other.key, parts);
    }
    return { edits: next, moved: d, blocked: Math.abs(d - delta) > 1e-6 };
  };

  /**
   * Moves several parts by the same `delta`, as far as the parts that stay
   * allow; with `rippled`, every part after the first of them goes too.
   */
  const shiftedMany = (base: SyncEdits, movers: Chunk[], delta: number, rippled: boolean, among: Chunk[]) => {
    if (movers.length === 1) return shifted(base, movers[0], delta, rippled, among);
    const first = Math.min(...movers.map((c) => c.part.start));
    const ids = new Set(movers.map((c) => c.part.id));
    const moving = rippled ? among.filter((c) => ids.has(c.part.id) || c.part.start > first + 1e-9) : movers;
    const movingIds = new Set(moving.map((c) => c.part.id));
    const staying = among.filter((c) => !movingIds.has(c.part.id));
    let low = -Infinity;
    let high = Infinity;
    for (const m of moving) {
      const { lo, hi } = roomOf(m.part.id, [...staying, m]);
      low = Math.max(low, lo - m.part.start);
      high = Math.min(high, hi - partEnd(m.part));
    }
    const d = clamp(delta, low, Math.max(low, high));
    let next = base;
    for (const m of moving) next = replacePart(next, m, { ...m.part, start: Math.max(0, m.part.start + d) });
    return { edits: next, moved: d, blocked: Math.abs(d - delta) > 1e-6 };
  };

  /** `change` applied to every part in `list`, one after another, so two parts of one line both change. */
  const changeAll = (base: SyncEdits, list: Chunk[], change: (part: SyncEditPart) => SyncEditPart | null) =>
    list.reduce((next, c) => replacePart(next, c, change(c.part)), base);

  const splitAt = (base: SyncEdits, chunk: Chunk, t: number): SyncEdits | null => {
    const part = chunk.part;
    if (t - part.start < MIN_PART_SECONDS || partEnd(part) - t < MIN_PART_SECONDS) return null;
    const at = part.from + (t - part.start) * part.rate;
    const left: SyncEditPart = { ...part, to: at, fadeOut: 0 };
    const right: SyncEditPart = { ...part, id: newPartId(chunk.key), start: t, from: at, fadeIn: 0 };
    return replacePart(base, chunk, left, [right]);
  };

  /**
   * What a drag does depends only on where on a line it starts, as in REAPER
   * and DaVinci Resolve: no tool has to be picked first.
   *
   *   the middle             move (Shift: ripple)        Alt: slip
   *   either edge            trim                        Alt: stretch
   *   a top corner           fade in / fade out
   *   the top edge between   gain (drag up or down)
   */
  type Zone = 'move' | 'slip' | 'trimLeft' | 'trimRight' | 'stretchLeft' | 'stretchRight' | 'fadeIn' | 'fadeOut' | 'gain';

  const zoneAt = (el: HTMLElement, chunk: Chunk, clientX: number, clientY: number, alt: boolean): Zone => {
    const box = el.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    const length = partLength(chunk.part);
    const pxPerSecond = box.width / Math.max(1e-6, length);
    // A narrow line keeps room in the middle to be moved.
    const edge = Math.min(EDGE_PX, box.width / 4);
    if (y <= TOP_BAND_PX && box.width >= 24) {
      const fadeInX = chunk.part.fadeIn * pxPerSecond;
      const fadeOutX = box.width - chunk.part.fadeOut * pxPerSecond;
      if (Math.abs(x - fadeInX) <= CORNER_PX && x < box.width / 2) return 'fadeIn';
      if (Math.abs(x - fadeOutX) <= CORNER_PX && x >= box.width / 2) return 'fadeOut';
      if (x > edge && x < box.width - edge) return 'gain';
    }
    if (x <= edge) return alt ? 'stretchLeft' : 'trimLeft';
    if (x >= box.width - edge) return alt ? 'stretchRight' : 'trimRight';
    return alt ? 'slip' : 'move';
  };

  const ZONE_CURSOR: Record<Zone, string> = {
    move: 'grab',
    slip: 'ew-resize',
    trimLeft: 'w-resize',
    trimRight: 'e-resize',
    stretchLeft: 'col-resize',
    stretchRight: 'col-resize',
    fadeIn: 'pointer',
    fadeOut: 'pointer',
    gain: 'ns-resize',
  };
  const ZONE_HINT: Record<Zone, string> = {
    move: 'Drag to move · Shift + drag pushes the lines after it · Alt + drag slips the audio inside',
    slip: 'Drag to slip the audio inside the line; the line stays where it is',
    trimLeft: 'Drag to trim the start · Alt + drag stretches instead',
    trimRight: 'Drag to trim the end · Alt + drag stretches instead',
    stretchLeft: 'Drag to stretch: faster or slower, pitch kept',
    stretchRight: 'Drag to stretch: faster or slower, pitch kept',
    fadeIn: 'Drag to fade in',
    fadeOut: 'Drag to fade out',
    gain: 'Drag up or down to turn the line up or down',
  };

  type Drag = {
    zone: Zone;
    chunk: Chunk;
    among: Chunk[];
    base: SyncEdits;
    t0: number;
    y0: number;
    rippled: boolean;
    /** The parts a move, gain or fade drag takes along: the dragged one alone unless it is one of several picked. */
    group: Chunk[];
    moved: boolean;
    label: string;
    /** The edits as this drag has them now. */
    next: SyncEdits | null;
  };
  const drag = useRef<Drag | null>(null);
  /** A drag across empty lane: the parts it touches are picked. `keep` is what was picked before, with Ctrl. */
  const marquee = useRef<{ t0: number; keep: string[]; moved: boolean } | null>(null);
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);

  /*
   * The edits a drag has, sent on to the live dub while it lasts, at most
   * every 60 ms: often enough to hear the line where it is, not so often
   * that every pixel starts it again.
   */
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const draftTimer = useRef<number | null>(null);
  const pendingDraft = useRef<SyncEdits | null>(null);
  const flushDraft = () => {
    draftTimer.current = null;
    const next = pendingDraft.current;
    pendingDraft.current = null;
    if (!next) return;
    onDraftRef.current?.(next);
    draftTimer.current = window.setTimeout(flushDraft, 60);
  };
  const sendDraft = (next: SyncEdits) => {
    pendingDraft.current = next;
    if (draftTimer.current === null) flushDraft();
  };
  const stopDraft = () => {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = null;
    pendingDraft.current = null;
  };
  useEffect(() => stopDraft, []);
  const [hud, setHud] = useState<{ x: number; text: string } | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  /** The line under the pointer and what a drag there would do; `at` is the time under it, for S. */
  const [hover, setHover] = useState<{ id: string; zone: Zone } | null>(null);
  const pointerTime = useRef<{ id: string; at: number } | null>(null);

  const partUnder = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.('[data-part]') as HTMLElement | null;
    const chunk = el ? chunkOf(el.dataset.part || null) : null;
    return el && chunk ? { el, chunk } : null;
  };

  const onLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    rootRef.current?.focus({ preventScroll: true });
    const t = timeAt(e.clientX);
    const under = partUnder(e.target);
    if (rangeTool) {
      alignmentRequest.current?.abort();
      setAligningRange(false);
      setRangeWords(null);
      setTakeRange(null);
      if (!under || under.chunk.original || under.chunk.part.muted) return say('Drag inside one audible dub line to select words.');
      const { chunk } = under;
      if (committed[chunk.key]?.locked ?? lineOf(chunk).locked) return say('Unlock this line before retaking it.');
      if (takesUnavailableKeys.includes(chunk.key)) return say('This line changed. Sync again before selecting its words.');
      setSelected(chunk.part.id);
      const start = clamp(t, chunk.part.start, partEnd(chunk.part));
      rangeDrag.current = { chunk, start, end: start };
      setTakeRange({ from: start, to: start });
      capture(e);
      return;
    }
    const additive = e.ctrlKey || e.metaKey;
    if (!under) {
      // A click seeks; a drag picks the parts it crosses (see onLanePointerMove).
      marquee.current = { t0: t, keep: additive ? selectedIds : [], moved: false };
      capture(e);
      return;
    }
    const { el, chunk } = under;
    if (additive && !blade) {
      // Ctrl + click adds the part, or drops it when it is already picked.
      const id = chunk.part.id;
      setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
      return;
    }
    // Clicking one of several picked parts keeps them all, so they can be dragged together.
    const keepGroup = selectedSet.has(chunk.part.id) && selectedIds.length > 1;
    if (keepGroup) setSelectedIds((ids) => [...ids.filter((x) => x !== chunk.part.id), chunk.part.id]);
    else setSelected(chunk.part.id);
    if (blade) {
      const next = splitAt(committed, chunk, t);
      if (next) commit(next, `Split line ${chunk.label}`);
      else say('Too close to the edge of the line to cut there.');
      return;
    }
    const zone = zoneAt(el, chunk, e.clientX, e.clientY, e.altKey);
    drag.current = {
      zone,
      chunk,
      among: chunks,
      base: committed,
      t0: t,
      y0: e.clientY,
      rippled: ripple || e.shiftKey,
      group: keepGroup ? group : [chunk],
      moved: false,
      label: '',
      next: null,
    };
    capture(e);
  };

  const onLanePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const range = rangeDrag.current;
    if (range) {
      range.end = clamp(timeAt(e.clientX), range.chunk.part.start, partEnd(range.chunk.part));
      setTakeRange({ from: Math.min(range.start, range.end), to: Math.max(range.start, range.end) });
      return;
    }
    if (rangeTool) return;
    const m = marquee.current;
    if (m) {
      const t = timeAt(e.clientX);
      const width = laneRef.current?.getBoundingClientRect().width || 1;
      if (!m.moved && (Math.abs(t - m.t0) / windowSeconds) * width < 4) return;
      m.moved = true;
      const from = Math.min(m.t0, t);
      const to = Math.max(m.t0, t);
      setBand({ from, to });
      const touched = chunks.filter((c) => c.part.start < to && partEnd(c.part) > from).map((c) => c.part.id);
      setSelectedIds([...m.keep.filter((id) => !touched.includes(id)), ...touched]);
      return;
    }
    const d = drag.current;
    if (!d) {
      // Not dragging: show what a drag here would do.
      const under = partUnder(e.target);
      if (under) pointerTime.current = { id: under.chunk.part.id, at: timeAt(e.clientX) };
      else pointerTime.current = null;
      const zone = under && !blade ? zoneAt(under.el, under.chunk, e.clientX, e.clientY, e.altKey) : null;
      const next = under && zone ? { id: under.chunk.part.id, zone } : null;
      if (next?.id !== hover?.id || next?.zone !== hover?.zone) setHover(next);
      return;
    }
    const t = timeAt(e.clientX);
    const dt = t - d.t0;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dt) < windowSeconds / 2000 && Math.abs(dy) < 2) return;
    d.moved = true;
    const { chunk, base, zone } = d;
    const part = chunk.part;
    const line = lineOf(chunk);
    const { lo, hi } = roomOf(part.id, d.among);
    const laneBox = laneRef.current!.getBoundingClientRect();
    let next: SyncEdits = base;
    let text = '';
    let snapped: { at: number; label: string } | null = null;

    const several = d.group.length > 1 ? ` · ${d.group.length} lines` : '';
    if (zone === 'fadeIn' || zone === 'fadeOut') {
      const length = partLength(part);
      const value = zone === 'fadeIn' ? t - part.start : partEnd(part) - t;
      const fade = Math.round(clamp(value, 0, length / 2) * 100) / 100;
      // Every picked part gets the same fade, as far as its own length allows.
      next = changeAll(base, d.group, (p) => ({ ...p, [zone]: Math.min(fade, partLength(p) / 2) }));
      d.label = `${zone === 'fadeIn' ? 'Fade in' : 'Fade out'} ${groupName(d.group)}`;
      text = `${zone === 'fadeIn' ? 'fade in' : 'fade out'} ${Math.round(fade * 1000)} ms${several}`;
    } else if (zone === 'gain') {
      const gainDb = clamp(Math.round((part.gainDb - dy * DB_PER_PX) * 2) / 2, MIN_GAIN_DB, MAX_GAIN_DB);
      // The picked parts move by the same dB, so their levels keep their balance.
      const change = gainDb - part.gainDb;
      next = changeAll(base, d.group, (p) => ({ ...p, gainDb: clamp(p.gainDb + change, MIN_GAIN_DB, MAX_GAIN_DB) }));
      d.label = `Set the gain of ${groupName(d.group)}`;
      text = d.group.length > 1 ? `gain ${change > 0 ? '+' : ''}${change.toFixed(1)} dB${several}` : `gain ${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
    } else if (zone === 'move') {
      const onset = line.lead > part.from && line.lead < part.to ? partTime(part, line.lead) - part.start : 0;
      const hit = snapNear(
        [
          { t: part.start + dt + onset, kinds: ['start', 'playhead'] },
          { t: part.start + dt, kinds: ['edge', 'playhead'] },
          { t: partEnd(part) + dt, kinds: ['edge', 'end'] },
        ],
        new Set(d.group.map((c) => c.part.id))
      );
      const delta = dt + (hit?.delta ?? 0);
      const result = shiftedMany(base, d.group, delta, d.rippled, d.among);
      next = result.edits;
      if (hit && !result.blocked) snapped = hit;
      const unit = baseReport.units[chunk.unitIndex];
      const newPart = partsOf(next, line, rate).find((p) => p.id === part.id) ?? part;
      const onsetNow = line.lead > newPart.from && line.lead < newPart.to ? partTime(newPart, line.lead) : newPart.start;
      d.label = `${d.rippled ? 'Ripple move' : 'Move'} ${groupName(d.group)}`;
      text = `Δ ${formatShift(result.moved)}${several}${unit ? ` · line ${chunk.label} vs original ${formatShift(onsetNow - unit.srcStart)}` : ''}${snapped ? ` · snap: ${snapped.label}` : ''}${result.blocked && !d.rippled ? ' · hold Shift to push the lines after it' : ''}`;
    } else if (zone === 'slip') {
      const span = part.to - part.from;
      const from = clamp(part.from - dt * part.rate, 0, lineSeconds(chunk) - span);
      next = replacePart(base, chunk, { ...part, from, to: from + span });
      d.label = `Slip line ${chunk.label}`;
      // Slipping needs audio hidden past a trimmed edge, as in REAPER.
      text = span >= lineSeconds(chunk) - 1e-6 ? 'nothing to slip: trim an edge first, then slip' : `slip ${formatShift(from - part.from)}`;
    } else if (zone === 'trimLeft') {
      const hit = snapNear([{ t: part.start + dt, kinds: ANY_SNAP }], part.id);
      let start = clamp(part.start + dt + (hit?.delta ?? 0), lo, partEnd(part) - MIN_PART_SECONDS);
      let from = part.from + (start - part.start) * part.rate;
      if (from < 0) {
        from = 0;
        start = part.start - part.from / part.rate;
      }
      next = replacePart(base, chunk, { ...part, start, from, fadeIn: Math.min(part.fadeIn, (part.to - from) / part.rate / 2) });
      if (hit) snapped = hit;
      d.label = `Trim the start of line ${chunk.label}`;
      text = `${Math.round(from * 1000)} ms off the start${snapped ? ` · snap: ${snapped.label}` : ''}`;
    } else if (zone === 'trimRight') {
      const hit = snapNear([{ t: partEnd(part) + dt, kinds: ANY_SNAP }], part.id);
      const end = clamp(partEnd(part) + dt + (hit?.delta ?? 0), part.start + MIN_PART_SECONDS, hi);
      const to = clamp(part.from + (end - part.start) * part.rate, part.from + MIN_PART_SECONDS * part.rate, lineSeconds(chunk));
      next = replacePart(base, chunk, { ...part, to, fadeOut: Math.min(part.fadeOut, (to - part.from) / part.rate / 2) });
      if (hit) snapped = hit;
      d.label = `Trim the end of line ${chunk.label}`;
      text = `${Math.round((lineSeconds(chunk) - to) * 1000)} ms off the end${snapped ? ` · snap: ${snapped.label}` : ''}`;
    } else {
      // Stretch: the edge dragged moves, the other stays where it is.
      const span = part.to - part.from;
      const right = zone === 'stretchRight';
      const hit = snapNear([{ t: (right ? partEnd(part) : part.start) + dt, kinds: ANY_SNAP }], part.id);
      const moved = (right ? partEnd(part) : part.start) + dt + (hit?.delta ?? 0);
      const length = right ? Math.min(hi, moved) - part.start : partEnd(part) - Math.max(lo, moved);
      const speed = Math.round(clamp(span / Math.max(MIN_PART_SECONDS, length), MIN_EDIT_RATE, MAX_EDIT_RATE) * 1000) / 1000;
      next = replacePart(base, chunk, { ...part, rate: speed, ...(right ? {} : { start: partEnd(part) - span / speed }) });
      if (hit) snapped = hit;
      d.label = `Stretch line ${chunk.label}`;
      text = `speed ${Math.round(speed * 100)}% · ${(span / speed).toFixed(2)} s · pitch kept`;
    }

    d.next = next;
    setDraft(next);
    // A stretch is heard once dropped: working out a new speed on every move would hold up the drag.
    if (zone !== 'stretchLeft' && zone !== 'stretchRight') sendDraft(next);
    setSnapLine(snapped ? snapped.at : null);
    setHud({ x: clamp(e.clientX - laneBox.left + 12, 0, Math.max(0, laneBox.width - 260)), text });
  };

  const endDrag = () => {
    const range = rangeDrag.current;
    if (range) {
      rangeDrag.current = null;
      if (!bankBlob || !range.chunk.unit || Math.abs(range.start - range.end) < 0.01) {
        setTakeRange(null);
        say('Drag across the words to retake, or open Takes and click the words.');
        return;
      }
      const controller = new AbortController();
      alignmentRequest.current?.abort();
      alignmentRequest.current = controller;
      setAligningRange(true);
      void alignTakeWords(bank, bankBlob, lineOf(range.chunk), range.chunk.unit.text, { apiKey: elApiKey, signal: controller.signal })
        .then(words => {
          if (controller.signal.aborted) return;
          const picked = wordsInTakeRange(words, range.chunk.part, range.start, range.end);
          if (!picked) throw new Error('No complete words in this range. Widen it or pick words in Takes.');
          setTakeRange({ from: picked.start, to: picked.end });
          setRangeWords({ key: range.chunk.key, from: picked.from, to: picked.to, text: picked.text });
          onOpenTakes?.(range.chunk.key, { from: picked.from, to: picked.to });
        })
        .catch(err => {
          if (!controller.signal.aborted) { setTakeRange(null); say(err?.message || 'Could not match words. Open Takes to pick them manually.'); }
        })
        .finally(() => { if (!controller.signal.aborted) setAligningRange(false); });
      return;
    }
    const m = marquee.current;
    if (m) {
      marquee.current = null;
      setBand(null);
      if (!m.moved) {
        // A click on empty lane: the playhead goes there, and nothing stays picked unless Ctrl was held.
        if (m.keep.length === 0) setSelectedIds([]);
        zoom.setFollow(true);
        onSeek(clamp(m.t0, 0, total));
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    stopDraft();
    setHud(null);
    setSnapLine(null);
    // A drag that changed nothing (a slip with nothing to slip, a move against a wall) leaves no step.
    const changed =
      d?.next &&
      (bank.lines.some((line) => JSON.stringify(partsOf(d.next, line, rate)) !== JSON.stringify(partsOf(d.base, line, rate))) ||
        originalsOf(d.next) !== originalsOf(d.base));
    if (d?.moved && d.next && changed) commit(d.next, d.label || `Edit line ${d.chunk.label}`);
    // Committed edits reach the live dub with the job's; a drag that changed nothing puts it back.
    else if (d?.moved) onDraftRef.current?.(null);
    setDraft(null);
  };

  // ---- Actions ----

  const act = {
    split: () => {
      // At the pointer when it is over a line, as REAPER splits; otherwise at the playhead.
      const pointed = pointerTime.current ? chunkOf(pointerTime.current.id) : null;
      const at = pointed && pointerTime.current ? pointerTime.current.at : currentTime;
      const target =
        pointed ??
        (current && currentTime > current.part.start && currentTime < partEnd(current.part) ? current : null) ??
        chunks.find((c) => !c.part.muted && currentTime > c.part.start && currentTime < partEnd(c.part));
      if (!target) return say('Point at a line, or put the playhead inside one, to split it there.');
      const next = splitAt(committed, target, at);
      if (!next) return say('Too close to the edge of the line to cut there.');
      commit(next, `Split line ${target.label}`);
    },
    join: () => {
      if (!current) return say('Pick a part of a split line first.');
      const later = chunks.filter((c) => c.key === current.key && c.part.start > current.part.start).sort((a, b) => a.part.start - b.part.start)[0];
      if (!later) return say('This line has no later part to join it to.');
      const joined: SyncEditPart = { ...current.part, to: Math.max(current.part.to, later.part.to), fadeOut: later.part.fadeOut };
      const end = joined.start + partLength(joined);
      const others = chunks.filter((c) => c.part.id !== current.part.id && c.part.id !== later.part.id && !c.part.muted);
      if (others.some((c) => c.part.start < end - 1e-6 && partEnd(c.part) > joined.start + 1e-6 && c.part.start >= current.part.start)) {
        return say('No room to join: the joined line would run into the next one.');
      }
      const parts = partsOf(committed, lineOf(current), rate).filter((p) => p.id !== later.part.id).map((p) => (p.id === current.part.id ? joined : p));
      commit(withParts(committed, current.key, parts), `Join line ${current.label}`);
    },
    align: () => {
      if (!current) return say('Pick a line to align.');
      if (current.original) return say('A clip of the original has no line of the script to align to.');
      const unit = baseReport.units[current.unitIndex];
      const line = lineOf(current);
      const parts = partsOf(committed, line, rate);
      const span = unit ? measuredSpan(current.key) : null;
      if (!unit || !span) return say('This line has no words left to align.');
      const delta = unit.srcStart - span;
      // The whole line moves, so its parts keep their places relative to each other.
      const ids = new Set(parts.map((p) => p.id));
      const among = chunks;
      const first = chunks.filter((c) => ids.has(c.part.id)).sort((a, b) => a.part.start - b.part.start)[0];
      const last = chunks.filter((c) => ids.has(c.part.id)).sort((a, b) => partEnd(b.part) - partEnd(a.part))[0];
      const lo = roomOf(first.part.id, among).lo;
      const hi = roomOf(last.part.id, among).hi;
      if (!ripple && (first.part.start + delta < lo - 1e-6 || partEnd(last.part) + delta > hi + 1e-6)) {
        return say('The lines either side are in the way. Turn on Ripple or move them first.');
      }
      let next = withParts(committed, current.key, parts.map((p) => ({ ...p, start: Math.max(0, p.start + delta) })));
      if (ripple && delta > 0) {
        for (const c of chunks) {
          if (ids.has(c.part.id) || c.part.start <= first.part.start) continue;
          next = withParts(next, c.key, partsOf(next, lineOf(c), rate).map((p) => (p.id === c.part.id ? { ...p, start: p.start + delta } : p)));
        }
      }
      commit(next, `Align line ${current.label} to the original`);
    },
    mute: () => {
      if (group.length === 0) return say('Pick a line to mute.');
      // Any picked part still playing: mute them all. All muted: unmute them all.
      const muted = group.some((c) => !c.part.muted);
      commit(
        changeAll(committed, group, (p) => ({ ...p, muted })),
        `${muted ? 'Mute' : 'Unmute'} ${groupName(group)}`
      );
    },
    lock: () => {
      if (group.length === 0) return say('Pick a line to lock or unlock.');
      const keys = [...new Set(group.filter((c) => !c.original).map((c) => c.key))];
      if (keys.length === 0) return say('A clip of the original always stays where you put it.');
      const locked = keys.some((key) => !(committed[key]?.locked ?? false));
      const next = { ...committed };
      for (const c of group) if (!c.original) next[c.key] = { parts: committed[c.key]?.parts ?? [basePart(lineOf(c), rate)], locked };
      const one = keys.length === 1;
      commit(next, `${locked ? 'Lock' : 'Unlock'} ${one ? `line ${group[0].label}` : `${keys.length} lines`}`);
      say(
        locked
          ? `Locked: Sync again leaves ${one ? 'this line where it is' : 'these lines where they are'}.`
          : `Unlocked: Sync again places ${one ? 'this line itself, and its' : 'these lines itself, and their'} edits go.`
      );
    },
    remove: () => {
      if (group.length === 0) return;
      commit(changeAll(committed, group, () => null), `Remove ${groupName(group)}`);
      setSelected(null);
      say('Removed. Undo brings it back.');
    },
    reset: () => {
      const keys = [...new Set(group.map((c) => c.key))].filter((key) => committed[key]);
      if (keys.length === 0) return say(group.length > 1 ? 'These lines are as Sync placed them.' : 'This line is as Sync placed it.');
      const rest = { ...committed };
      for (const key of keys) delete rest[key];
      const first = group.find((c) => c.key === keys[0]);
      // Resetting a clip of the original takes it off the dub, as there is nothing Sync placed to go back to.
      commit(rest, `Reset ${keys.length === 1 && first ? groupName([first]) : `${keys.length} lines`}`);
    },
    selectAll: () => {
      setSelectedIds(chunks.map((c) => c.part.id));
      say(`${chunks.length} lines picked. Drag one to move them all; gain, fades and mute go to all of them.`);
    },
    resetAll: () => {
      if (!hasEdits(committed)) return;
      commit({}, 'Reset all edits');
      setSelected(null);
    },
    nudge: (seconds: number) => {
      if (group.length === 0) return;
      const result = shiftedMany(committed, group, seconds, ripple, chunks);
      if (Math.abs(result.moved) < 1e-6) return say(`No room to move ${group.length > 1 ? 'them' : 'it'} further that way.`);
      commit(result.edits, `Nudge ${groupName(group)} ${formatShift(result.moved)}`);
    },
    undo: () => goTo(history.at - 1),
    redo: () => goTo(history.at + 1),
  };

  /** Where line `key`'s first word lands now. */
  function measuredSpan(key: string) {
    return unitByKey.get(key)?.placedStart ?? null;
  }

  const setField = (patch: Partial<SyncEditPart>, label: string) => {
    if (!current) return;
    let part = { ...current.part, ...patch };
    const { lo, hi } = roomOf(current.part.id);
    if (patch.start !== undefined) part.start = clamp(patch.start, lo, Math.max(lo, hi - partLength(part)));
    if (patch.rate !== undefined) {
      part.rate = clamp(patch.rate, MIN_EDIT_RATE, MAX_EDIT_RATE);
      if (part.start + partLength(part) > hi + 1e-6) return say('No room at that speed: the next line starts first.');
    }
    if (patch.fadeIn !== undefined || patch.fadeOut !== undefined) {
      const half = partLength(part) / 2;
      part = { ...part, fadeIn: clamp(part.fadeIn, 0, half), fadeOut: clamp(part.fadeOut, 0, half) };
    }
    commit(replacePart(committed, current, part), `${label} line ${current.label}`);
  };

  /** Sets gain or fades on every picked part: the same value on each, fades held to half of each part. */
  const setGroupField = (patch: Partial<Pick<SyncEditPart, 'gainDb' | 'fadeIn' | 'fadeOut'>>, label: string) => {
    if (group.length === 0) return;
    commit(
      changeAll(committed, group, (p) => {
        const half = partLength(p) / 2;
        return {
          ...p,
          ...(patch.gainDb !== undefined && { gainDb: patch.gainDb }),
          ...(patch.fadeIn !== undefined && { fadeIn: clamp(patch.fadeIn, 0, half) }),
          ...(patch.fadeOut !== undefined && { fadeOut: clamp(patch.fadeOut, 0, half) }),
        };
      }),
      `${label} ${groupName(group)}`
    );
  };

  /**
   * One speed on every picked dub line, pitch kept. Each line keeps its start,
   * so it stays with the original; a line with no room to slow that far before
   * the next one starts slows only as far as it fits. Clips of the original
   * voice keep their own speed.
   */
  const setGroupRate = (wanted: number) => {
    const dubbed = group.filter((c) => !c.original);
    if (dubbed.length === 0) return say('Only clips of the original are picked: they keep their own speed.');
    const target = clamp(wanted, MIN_EDIT_RATE, MAX_EDIT_RATE);
    let held = 0;
    const next = changeAll(committed, dubbed, (p) => {
      const { hi } = roomOf(p.id);
      const fits = (p.to - p.from) / Math.max(MIN_PART_SECONDS, hi - p.start);
      const rate = Math.round(Math.min(MAX_EDIT_RATE, Math.max(target, fits)) * 1000) / 1000;
      if (rate > target + 1e-3) held += 1;
      const half = (p.to - p.from) / rate / 2;
      return { ...p, rate, fadeIn: Math.min(p.fadeIn, half), fadeOut: Math.min(p.fadeOut, half) };
    });
    commit(next, `Set the speed of ${groupName(dubbed)} to ${Math.round(target * 100)}%`);
    if (held > 0) say(`${held} ${held === 1 ? 'line has' : 'lines have'} no room that slow: ${held === 1 ? 'it slows' : 'they slow'} only as far as the next line allows.`);
  };

  // ---- Clips of the original ----

  /*
   * A drag across the Original lane picks a stretch of it; a drag starting
   * on the picked stretch carries it down, and letting go over the dub puts
   * it there as a clip of the original, where it was dropped. Ctrl + C copies
   * the picked stretch and Ctrl + V puts it at the playhead.
   */
  const [pick, setPick] = useState<{ from: number; to: number } | null>(null);
  const clipboard = useRef<{ from: number; to: number } | null>(null);
  const originalDrag = useRef<{ kind: 'pick' | 'carry'; t0: number; grab: number; moved: boolean } | null>(null);
  /** Where a carried stretch would land, while it is over the dub lane. */
  const [carry, setCarry] = useState<{ start: number; length: number; fits: boolean } | null>(null);

  /**
   * Where a stretch `length` long dropped at `at` goes on the dub: there, as
   * long as the gap it lands in allows, its end trimmed to fit before the
   * next line. Null when it lands on a line.
   */
  const placeOriginal = (at: number, length: number) => {
    const start = clamp(at, 0, total);
    const playing = chunks.filter((c) => !c.part.muted);
    if (playing.some((c) => c.part.start <= start + 1e-6 && partEnd(c.part) > start + 1e-6)) return null;
    const next = Math.min(Infinity, ...playing.filter((c) => c.part.start > start + 1e-6).map((c) => c.part.start));
    const fit = Math.min(length, next - start);
    return fit >= MIN_PART_SECONDS ? { start, length: fit, trimmed: fit < length - 1e-6 } : null;
  };

  /** Puts `length` seconds of the original from `from` on the dub at `start`, as a clip of its own. */
  const putOriginal = (from: number, length: number, start: number, trimmed: boolean) => {
    const key = `${ORIGINAL_CLIP_PREFIX}${Date.now().toString(36)}${(partCounter++).toString(36)}`;
    const part: SyncEditPart = { id: newPartId(key), start, from, to: from + length, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false };
    commit(withParts(committed, key, [part]), `Put the original ${formatTime(from)} on the dub at ${formatTime(start)}`);
    setSelected(part.id);
    say(trimmed ? 'Put on the dub, its end trimmed to fit before the next line.' : 'Put on the dub. Drag its edges to trim it, or Del to take it off.');
  };

  const copyPick = () => {
    if (!pick) return false;
    clipboard.current = pick;
    say(`Copied ${(pick.to - pick.from).toFixed(2)} s of the original. Ctrl + V puts it on the dub at the playhead.`);
    return true;
  };
  const pasteOriginal = () => {
    const copied = clipboard.current;
    if (!copied) return say('Drag across the original to pick a stretch, then Ctrl + C to copy it.');
    const place = placeOriginal(currentTime, copied.to - copied.from);
    if (!place) return say('The playhead is on a line. Put it in a gap of the dub, then Ctrl + V.');
    putOriginal(copied.from, place.length, place.start, place.trimmed);
  };

  /** Where a stretch carried from the original lands: snapped to an edge or the playhead, as a move does. */
  const carryAt = (clientX: number, length: number) => {
    const raw = timeAt(clientX) - (originalDrag.current?.grab ?? 0);
    const hit = snapNear(
      [
        { t: raw, kinds: ['edge', 'playhead'] },
        { t: raw + length, kinds: ['edge', 'playhead'] },
      ],
      new Set()
    );
    return { start: raw + (hit?.delta ?? 0), snapped: hit };
  };
  const overDub = (clientY: number) => {
    const box = laneRef.current?.getBoundingClientRect();
    return Boolean(box && clientY >= box.top && clientY <= box.bottom);
  };

  const onOriginalPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    rootRef.current?.focus({ preventScroll: true });
    const t = clamp(timeAt(e.clientX), 0, sourceSeconds);
    const onPick = pick && t >= pick.from && t <= pick.to;
    originalDrag.current = { kind: onPick ? 'carry' : 'pick', t0: t, grab: onPick && pick ? t - pick.from : 0, moved: false };
    capture(e);
  };
  const onOriginalPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = originalDrag.current;
    if (!d) return;
    const width = laneRef.current?.getBoundingClientRect().width || 1;
    const t = clamp(timeAt(e.clientX), 0, sourceSeconds);
    if (!d.moved && (Math.abs(t - d.t0) / windowSeconds) * width < 4 && !(d.kind === 'carry' && overDub(e.clientY))) return;
    d.moved = true;
    if (d.kind === 'pick') {
      setPick({ from: Math.min(d.t0, t), to: Math.max(d.t0, t) });
      return;
    }
    if (!pick) return;
    const length = pick.to - pick.from;
    const laneBox = laneRef.current!.getBoundingClientRect();
    const hudX = clamp(e.clientX - laneBox.left + 12, 0, Math.max(0, laneBox.width - 260));
    if (!overDub(e.clientY)) {
      setCarry(null);
      setSnapLine(null);
      setHud({ x: hudX, text: `${length.toFixed(2)} s of the original · drop it on the dub lane` });
      return;
    }
    const { start, snapped } = carryAt(e.clientX, length);
    const place = placeOriginal(start, length);
    setCarry(place ? { start: place.start, length: place.length, fits: true } : { start: Math.max(0, start), length, fits: false });
    setSnapLine(place && snapped ? snapped.at : null);
    setHud({
      x: hudX,
      text: place
        ? `drop at ${formatTime(place.start)}${place.trimmed ? ` · trimmed to ${place.length.toFixed(2)} s to fit` : ''}${snapped ? ` · snap: ${snapped.label}` : ''}`
        : 'on a line: drop it in a gap',
    });
  };
  const onOriginalPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = originalDrag.current;
    originalDrag.current = null;
    setCarry(null);
    setHud(null);
    setSnapLine(null);
    if (!d) return;
    if (!d.moved) {
      // A click seeks, and lets go of a stretch picked elsewhere.
      if (d.kind === 'pick') setPick(null);
      zoom.setFollow(true);
      onSeek(clamp(d.t0, 0, total));
      return;
    }
    if (d.kind !== 'carry' || !pick || !overDub(e.clientY)) return;
    const length = pick.to - pick.from;
    const place = placeOriginal(carryAt(e.clientX, length).start, length);
    if (!place) return say('That is on a line of the dub. Drop the original in a gap.');
    putOriginal(pick.from, place.length, place.start, place.trimmed);
  };
  const onOriginalPointerCancel = () => {
    originalDrag.current = null;
    setCarry(null);
    setHud(null);
    setSnapLine(null);
  };

  // ---- Keys ----

  const rootRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    const key = e.key;
    const lower = key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    let done = true;
    if (mod && lower === 'c') done = copyPick();
    else if (mod && lower === 'v') pasteOriginal();
    else if (mod && lower === 'z') (e.shiftKey ? act.redo : act.undo)();
    else if (mod && lower === 'y') act.redo();
    else if (mod && lower === 'a') act.selectAll();
    else if (mod || e.altKey) done = false;
    else if (key === ',' || key === '<') act.nudge(e.shiftKey ? -0.1 : -0.01);
    else if (key === '.' || key === '>') act.nudge(e.shiftKey ? 0.1 : 0.01);
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const index = current ? chunks.indexOf(current) : -1;
      const next = chunks[clamp(index + (key === 'ArrowRight' ? 1 : -1), 0, chunks.length - 1)] ?? chunks[0];
      if (next) {
        setSelected(next.part.id);
        zoom.setFollow(true);
        onSeek(next.part.start);
      }
    } else if (key === '/') {
      if (current) onPlayFrom(Math.max(0, current.part.start - 0.3));
    } else if (key === 'Home') onSeek(0);
    else if (key === '=' || key === '+') zoom.zoomBy(0.5);
    else if (key === '-' || key === '_') zoom.zoomBy(2);
    else if (lower === 'z' && e.shiftKey) zoom.fitAll();
    else if (lower === 's') act.split();
    else if (lower === 'g') act.join();
    else if (lower === 'a') act.align();
    else if (lower === 'm') act.mute();
    else if (lower === 'l') act.lock();
    else if (lower === 'n') setSnap((v) => !v);
    else if (key === 'Delete' || key === 'Backspace') act.remove();
    else if (key === 'Escape') {
      setSelected(null);
      setPick(null);
    }
    else if (lower === 'b') { alignmentRequest.current?.abort(); rangeDrag.current = null; setAligningRange(false); setTakeRange(null); setRangeWords(null); setRangeTool(false); setBlade((v) => !v); }
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---- Drawing ----

  const onScreen = (start: number, end: number) => end >= windowStart - 1 && start <= windowStart + windowSeconds + 1;
  const visible = chunks.filter((c) => onScreen(c.part.start, partEnd(c.part)));
  const spoken = measured.units.filter((u) => u.placedStart !== null && onScreen(Math.min(u.srcStart, u.placedStart as number), Math.max(u.srcEnd, u.placedEnd as number)));
  const editedCount = Object.keys(committed).filter((key) => !isOriginalClip(key)).length;
  const originalCount = Object.keys(committed).length - editedCount;
  const inSync = measured.summary.inSync;
  const lineCount = measured.units.filter((u) => !u.silent || isEdited(committed, u.key)).length;
  const originalSpans = useMemo(
    () => baseReport.units.map((unit, n) => ({ from: unit.srcStart, to: unit.srcEnd, color: withAlpha(hueOf(n), 0.75) })),
    [baseReport]
  );
  const statusColor = (chunk: Chunk) => (chunk.original ? ORIGINAL_HUE : landing(chunk.unit, tolerance).color);
  const driftY = (offset: number) => 50 - clamp(offset / 0.6, -1, 1) * 40;
  const laneCursor = blade || rangeTool ? 'crosshair' : drag.current ? ZONE_CURSOR[drag.current.zone].replace('grab', 'grabbing') : hover ? ZONE_CURSOR[hover.zone] : 'default';
  const currentUnit = current ? unitByKey.get(current.key) : undefined;
  const currentLanding = landing(currentUnit, tolerance);
  const currentLocked = current ? committed[current.key]?.locked ?? false : false;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Edit timing"
      className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/60"
    >
      {/* Title, what the edits come to, and whether the audio has caught up */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13.5px] font-semibold text-slate-100">Edit timing</h3>
        <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/12 text-amber-300">
          {editedCount === 0 ? 'No hand edits' : `${editedCount} line${editedCount === 1 ? '' : 's'} edited by hand`}
        </span>
        {originalCount > 0 && (
          <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-cyan-400/12 text-cyan-300">
            {originalCount} clip{originalCount === 1 ? '' : 's'} of the original
          </span>
        )}
        <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
          {inSync} of {lineCount} in sync
        </span>
        <span aria-live="polite" className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
          {status.state === 'pending' || status.state === 'rendering' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {live ? 'Playing your edits live · saving the file…' : 'Updating the audio…'}
            </>
          ) : status.state === 'error' ? (
            <span className="flex items-center gap-1.5 text-rose-300">
              <TriangleAlert className="w-3.5 h-3.5" /> {status.message}
              <button type="button" onClick={onRetry} className="underline underline-offset-2 hover:text-rose-200 cursor-pointer">
                Try again
              </button>
            </span>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" /> Audio up to date
            </>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={act.resetAll}
            disabled={!hasEdits(committed)}
            className="h-8 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset all edits
          </button>
          <button type="button" onClick={onClose} className="h-8 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs font-semibold text-white cursor-pointer flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Done
          </button>
        </span>
      </div>
      {status.notice && <p className="text-[12px] text-amber-300">{status.notice}</p>}

      {/* Tools: names and shortcuts show on hover */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-xl border border-slate-800 bg-slate-950 p-0.5">
          {onOpenTakes && <ToolButton label="Select range" shortcut="Drag" hint="Drag inside a dub line to select words for a retake. Uses ElevenLabs forced alignment; may use alignment credits. No voice is generated until Retake is pressed." pressed={rangeTool} onClick={() => { alignmentRequest.current?.abort(); rangeDrag.current = null; setAligningRange(false); setTakeRange(null); setRangeWords(null); setRangeTool(v => !v); setBlade(false); }}>
            <Mic className="w-4 h-4" /> Select range
          </ToolButton>}
          <ToolButton label="Blade" shortcut="B" hint="On: a click cuts a line in two there. Off: S splits at the pointer or the playhead." pressed={blade} onClick={() => { alignmentRequest.current?.abort(); rangeDrag.current = null; setAligningRange(false); setTakeRange(null); setRangeWords(null); setRangeTool(false); setBlade((v) => !v); }}>
            <Scissors className="w-4 h-4" />
            Blade
          </ToolButton>
          <ToolButton label="Snap" shortcut="N" hint="Edges snap to the original's lines, other lines and the playhead." pressed={snap} onClick={() => setSnap((v) => !v)}>
            <Magnet className="w-4 h-4" />
            Snap
          </ToolButton>
          <ToolButton
            label="Ripple"
            shortcut="Shift + drag"
            hint="Moving a line pushes every line after it along too. Off, a line stops at its neighbours."
            pressed={ripple}
            onClick={() => setRipple((v) => !v)}
          >
            <ArrowRightToLine className="w-4 h-4" />
            Ripple
          </ToolButton>
        </div>
        <div className="ml-auto flex items-center gap-0.5 rounded-xl border border-slate-800 bg-slate-950 p-0.5" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom.zoomBy(2)} disabled={!zoom.zoomed} title="Zoom out (−)" aria-label="Zoom out" className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="min-w-[3.5rem] text-center font-mono text-[11px] text-slate-400 tabular-nums">{windowSeconds < 60 ? `${Math.round(windowSeconds)} s` : `${(windowSeconds / 60).toFixed(1)} min`}</span>
          <button type="button" onClick={() => zoom.zoomBy(0.5)} disabled={!zoom.canZoomIn} title="Zoom in (=)" aria-label="Zoom in" className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" onClick={zoom.fitAll} disabled={!zoom.zoomed} title="Whole track (Shift + Z)" className="h-8 px-2 rounded-lg flex items-center gap-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default">
            <Maximize2 className="w-3.5 h-3.5" /> Fit
          </button>
        </div>
      </div>

      {/* The lanes */}
      <div className={`grid ${renderTrackHead ? 'grid-cols-[12.5rem_minmax(0,1fr)]' : 'grid-cols-[5.5rem_minmax(0,1fr)]'} rounded-xl border border-slate-800 overflow-hidden bg-slate-900/50`}>
        <div className="flex flex-col text-[11px] text-slate-400 border-r border-slate-800">
          <div className="h-6 px-2 flex items-center font-mono text-[11px] font-semibold text-slate-200 tabular-nums border-b border-slate-800">{formatTime(currentTime)}</div>
          {renderTrackHead ? (
            <div className="h-14 px-2 flex items-center border-b border-slate-800">
              {renderTrackHead('source', 'Original', 'bg-cyan-400', <Lock className="w-3 h-3 text-slate-600" aria-label="Locked" />)}
            </div>
          ) : (
            <div className="h-14 px-2 flex items-center gap-1.5 border-b border-slate-800">
              <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original <Lock className="w-3 h-3 text-slate-600 ml-auto" aria-label="Locked" />
            </div>
          )}
          <div className="h-6 px-2 flex items-center text-[10.5px] text-slate-500 border-b border-slate-800">Sync links</div>
          {renderTrackHead ? (
            <div className="h-[4.5rem] px-2 flex items-center border-b border-slate-800">{renderTrackHead('synth', `${targetLanguage} dub`, 'bg-indigo-400')}</div>
          ) : (
            <div className="h-[4.5rem] px-2 flex items-center gap-1.5 border-b border-slate-800">
              <span className="w-2 h-2 rounded-sm bg-indigo-400" /> <span className="truncate">{targetLanguage} dub</span>
            </div>
          )}
          <div className="h-6 px-2 flex items-center text-[10.5px] text-slate-500 border-b border-slate-800">Script</div>
          <div className="h-10 px-2 flex items-center text-[10.5px] text-slate-500">Start drift</div>
        </div>

        <div
          ref={zoom.lanesRef}
          className="relative min-w-0 select-none"
          onWheel={wheelScroll(windowSeconds, (s) => zoom.scrollTo(windowStart + s))}
        >
          <div className="h-6 px-0 pt-1 border-b border-slate-800 bg-slate-950/40">
            <TimelineRuler zoom={zoom} />
          </div>

          {/* Original: a click seeks, a drag picks a stretch to put on the dub */}
          <div
            className="relative h-14 border-b border-slate-800 bg-slate-950/50 overflow-hidden cursor-text touch-none"
            title="Drag across the original to pick a stretch, then drag it down onto the dub"
            onPointerDown={onOriginalPointerDown}
            onPointerMove={onOriginalPointerMove}
            onPointerUp={onOriginalPointerUp}
            onPointerCancel={onOriginalPointerCancel}
          >
            <WindowWaveform data={sourcePeaks} from={windowStart} span={windowSeconds} spans={originalSpans} className="text-slate-600/40" />
            {pick && onScreen(pick.from, pick.to) && (
              <span
                className="absolute top-0 bottom-0 z-10 border-x-2 border-cyan-300 bg-cyan-300/15 cursor-grab active:cursor-grabbing"
                style={{ left: `${pct(pick.from)}%`, width: `${((pick.to - pick.from) / windowSeconds) * 100}%` }}
              >
                <span className="absolute left-1 bottom-0.5 whitespace-nowrap rounded bg-slate-950/80 px-1 font-mono text-[10px] text-cyan-200 pointer-events-none">
                  {(pick.to - pick.from).toFixed(2)} s · drag onto the dub
                </span>
              </span>
            )}
            {baseReport.units.map((unit, n) =>
              onScreen(unit.srcStart, unit.srcEnd) ? (
                <span
                  key={unit.key}
                  className="absolute top-1 font-mono text-[10px] font-semibold text-slate-200 pointer-events-none px-1 rounded bg-slate-950/70"
                  style={{ left: `${pct(unit.srcStart)}%` }}
                >
                  {n + 1}
                </span>
              ) : null
            )}
          </div>

          {/* Sync links */}
          <div className="relative h-6 border-b border-slate-800 overflow-hidden">
            <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
              {spoken.map((unit) => {
                const { color } = landing(unit, tolerance);
                const chosen = current?.key === unit.key;
                return (
                  <line
                    key={unit.key}
                    x1={pct(unit.srcStart)}
                    y1={0}
                    x2={pct(unit.placedStart as number)}
                    y2={24}
                    stroke={color}
                    strokeWidth={chosen ? 2.2 : 1.2}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>
          </div>

          {/* The dub, editable */}
          <div
            ref={laneRef}
            className="relative h-[4.5rem] border-b border-slate-800 bg-slate-950/70 overflow-hidden touch-none"
            style={{ cursor: laneCursor }}
            onPointerDown={onLanePointerDown}
            onPointerMove={onLanePointerMove}
            onPointerLeave={() => {
              if (drag.current) return;
              setHover(null);
              pointerTime.current = null;
            }}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              if (rangeDrag.current) { rangeDrag.current = null; setTakeRange(null); }
              else endDrag();
            }}
          >
            {visible.map((chunk) => {
              const { part } = chunk;
              const chosen = chunk.part.id === selected;
              const picked = selectedSet.has(chunk.part.id);
              const hue = chunk.original ? ORIGINAL_HUE : hueOf(chunk.unitIndex);
              const color = statusColor(chunk);
              const length = partLength(part);
              const showOffset = chunk.unit && chunk.unit.offset !== null && part.from <= lineOf(chunk).lead + 1e-6;
              const tags = [part.rate !== 1 && `${Math.round(part.rate * 100)}%`, part.gainDb !== 0 && `${part.gainDb > 0 ? '+' : ''}${part.gainDb.toFixed(1)} dB`].filter(Boolean).join(' · ');
              return (
                <div
                  key={part.id}
                  data-part={part.id}
                  className={`absolute top-1.5 bottom-1.5 rounded-md border overflow-hidden ${chunk.original ? 'border-dashed' : ''} ${part.muted ? 'opacity-35' : ''} ${chosen ? 'ring-2 ring-slate-100 z-10' : picked ? 'ring-2 ring-indigo-300 z-10' : ''}`}
                  style={{
                    left: `${pct(part.start)}%`,
                    width: `${Math.max(0.15, (length / windowSeconds) * 100)}%`,
                    background: withAlpha(hue, 0.16),
                    borderColor: withAlpha(hue, 0.9),
                    backgroundImage: part.muted ? 'repeating-linear-gradient(135deg, rgba(148,163,184,0.18) 0 4px, transparent 4px 8px)' : undefined,
                  }}
                  title={
                    chunk.original
                      ? `Clip ${chunk.label}: the original from ${formatTime(part.from)} to ${formatTime(part.to)}`
                      : `Line ${chunk.label}${chunk.unit?.text ? `: ${chunk.unit.text}` : ''}`
                  }
                >
                  <PartWave
                    data={chunk.original ? sourcePeaks : bankPeaks}
                    bankOffset={chunk.original ? 0 : lineOf(chunk).bankStart / rate}
                    part={part}
                    color={withAlpha(hue, 0.95)}
                  />
                  <span className="absolute left-1 top-0.5 flex items-center gap-1 whitespace-nowrap text-[10.5px] font-semibold text-slate-100 pointer-events-none drop-shadow">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    {chunk.label}
                    {showOffset && <span className="font-mono font-normal text-slate-300">{formatShift(chunk.unit!.offset as number)}</span>}
                    {tags && <span className="font-normal text-slate-300">· {tags}</span>}
                    {!chunk.original && committed[chunk.key]?.locked && <Lock className="w-2.5 h-2.5 text-slate-300" aria-label="Locked" />}
                    {part.muted && <VolumeX className="w-3 h-3 text-slate-300" aria-label="Muted" />}
                  </span>
                  {!chunk.original && isEdited(committed, chunk.key) && <span className="absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-amber-400 pointer-events-none" aria-hidden="true" />}
                  {/* What a drag here does: shown where the pointer is, and on the picked line */}
                  {(() => {
                    const zone = hover?.id === part.id ? hover.zone : drag.current?.chunk.part.id === part.id ? drag.current.zone : null;
                    const lit = picked || zone !== null;
                    if (!lit || blade || rangeTool) return null;
                    const edgeClass = (on: boolean, stretch: boolean) =>
                      `absolute top-0 bottom-0 w-[3px] pointer-events-none ${on ? (stretch ? 'bg-indigo-300' : 'bg-slate-100') : 'bg-slate-100/25'}`;
                    return (
                      <>
                        <span aria-hidden="true" className={`${edgeClass(zone === 'trimLeft' || zone === 'stretchLeft', zone === 'stretchLeft')} left-0`} />
                        <span aria-hidden="true" className={`${edgeClass(zone === 'trimRight' || zone === 'stretchRight', zone === 'stretchRight')} right-0`} />
                        <span
                          aria-hidden="true"
                          className={`absolute top-0 -ml-1 w-2.5 h-2.5 rounded-[2px] pointer-events-none ${zone === 'fadeIn' ? 'bg-amber-300' : 'bg-slate-100/80'}`}
                          style={{ left: `${Math.min(90, (part.fadeIn / length) * 100)}%`, marginLeft: part.fadeIn > 0 ? undefined : 0 }}
                        />
                        <span
                          aria-hidden="true"
                          className={`absolute top-0 -mr-1 w-2.5 h-2.5 rounded-[2px] pointer-events-none ${zone === 'fadeOut' ? 'bg-amber-300' : 'bg-slate-100/80'}`}
                          style={{ right: `${Math.min(90, (part.fadeOut / length) * 100)}%`, marginRight: part.fadeOut > 0 ? undefined : 0 }}
                        />
                        {zone === 'gain' && <span aria-hidden="true" className="absolute left-2 right-2 top-0 h-[3px] rounded-full bg-sky-300 pointer-events-none" />}
                      </>
                    );
                  })()}
                </div>
              );
            })}
            {carry && (
              <span
                aria-hidden="true"
                className={`absolute top-1.5 bottom-1.5 rounded-md border-2 border-dashed pointer-events-none z-20 ${carry.fits ? 'border-cyan-300 bg-cyan-300/15' : 'border-rose-400 bg-rose-400/10'}`}
                style={{ left: `${pct(carry.start)}%`, width: `${Math.max(0.15, (carry.length / windowSeconds) * 100)}%` }}
              />
            )}
            {takeRange && (
              <span aria-hidden="true" className="absolute top-0 bottom-0 border-x-2 border-indigo-300 bg-indigo-400/20 pointer-events-none z-30"
                style={{ left: `${pct(takeRange.from)}%`, width: `${((takeRange.to - takeRange.from) / windowSeconds) * 100}%` }} />
            )}
            {band && (
              <span
                aria-hidden="true"
                className="absolute top-0 bottom-0 border border-dashed border-indigo-300/80 bg-indigo-400/10 pointer-events-none z-20"
                style={{ left: `${pct(band.from)}%`, width: `${((band.to - band.from) / windowSeconds) * 100}%` }}
              />
            )}
            {/* Where the picked line's original starts */}
            {currentUnit && onScreen(currentUnit.srcStart, currentUnit.srcStart) && (
              <span aria-hidden="true" className="absolute top-0 bottom-0 border-l border-dashed border-amber-300/80 pointer-events-none" style={{ left: `${pct(currentUnit.srcStart)}%` }} />
            )}
            {!bankPeaks && bankBlob && <span className="absolute right-2 bottom-1 text-[10px] text-slate-500 pointer-events-none">Drawing the waveforms…</span>}
          </div>

          {/* Script */}
          <div className="relative h-6 border-b border-slate-800 overflow-hidden">
            {spoken.map((unit) => (
              <span
                key={unit.key}
                className={`absolute top-1 truncate text-[10.5px] pointer-events-none ${current?.key === unit.key ? 'text-slate-100' : 'text-slate-400'}`}
                style={{ left: `calc(${pct(unit.placedStart as number)}% + 2px)`, width: `${(((unit.placedEnd as number) - (unit.placedStart as number)) / windowSeconds) * 100}%` }}
                title={unit.text}
              >
                {unit.text}
              </span>
            ))}
          </div>

          {/* Drift: each line's start error, against the tolerance band */}
          <div className="relative h-10 overflow-hidden">
            <span
              aria-hidden="true"
              className="absolute left-0 right-0 bg-emerald-400/[0.07] border-y border-dashed border-emerald-400/30 pointer-events-none"
              style={{ top: `${driftY(tolerance)}%`, bottom: `${100 - driftY(-tolerance)}%` }}
            />
            <span aria-hidden="true" className="absolute left-0 right-0 top-1/2 border-t border-slate-800 pointer-events-none" />
            {spoken.map((unit) => (
              <span
                key={unit.key}
                title={`Line ${(unitIndexByKey.get(unit.key) ?? 0) + 1}: ${formatShift(unit.offset as number)}`}
                className={`absolute w-2 h-2 -ml-1 -mt-1 rounded-full ${current?.key === unit.key ? 'ring-2 ring-slate-100' : ''}`}
                style={{ left: `${pct(unit.srcStart)}%`, top: `${driftY(unit.offset as number)}%`, background: landing(unit, tolerance).color }}
              />
            ))}
          </div>

          {snapLine !== null && (
            <span aria-hidden="true" className="absolute top-6 bottom-0 border-l border-dashed border-amber-300 pointer-events-none z-20" style={{ left: `${pct(snapLine)}%` }} />
          )}
          <span ref={playheadRef(0)} aria-hidden="true" className="absolute top-0 bottom-0 w-0.5 -ml-px bg-rose-400 pointer-events-none z-20" />
          {hud && (
            <span
              aria-live="polite"
              className="absolute z-30 top-[7.6rem] rounded-md border border-slate-700 bg-slate-950/95 px-2 py-1 font-mono text-[11px] text-slate-100 whitespace-nowrap pointer-events-none"
              style={{ left: hud.x }}
            >
              {hud.text}
            </span>
          )}
        </div>
      </div>

      {/* Under the lanes, where a scrollbar sits */}
      <Overview
        total={total}
        chunks={chunks}
        statusOf={statusColor}
        windowStart={windowStart}
        windowSeconds={windowSeconds}
        currentTime={currentTime}
        onScroll={(start) => zoom.scrollTo(start)}
      />

      {/* Actions on the picked line */}
      {rangeTool && <p role="status" className="text-[12px] text-indigo-200">
        {aligningRange ? 'Matching the selected audio to its words…' : rangeWords ? `Selected: “${rangeWords.text}” · word boundaries matched. Choose a direction and Retake below.` : 'Drag inside one dub waveform to select words. For keyboard selection, open Takes, click a word, then Shift-click another.'}
      </p>}
      <div className="flex flex-wrap items-center gap-1">
        <div className="flex flex-wrap gap-0.5 rounded-xl border border-slate-800 bg-slate-950 p-0.5">
          <ActionButton label="Split" shortcut="S" onClick={act.split} title="Cut the line at the playhead">
            <SquareSplitHorizontal className="w-4 h-4" />
          </ActionButton>
          <ActionButton label="Join" shortcut="G" onClick={act.join} title="Join this part to the next part of its line">
            <Link2 className="w-4 h-4" />
          </ActionButton>
          <ActionButton label="Align" shortcut="A" onClick={act.align} title="Move the line so its first word starts with the original's">
            <AlignStartVertical className="w-4 h-4" />
          </ActionButton>
          <ActionButton label={group.length > 0 && group.every((c) => c.part.muted) ? 'Unmute' : 'Mute'} shortcut="M" onClick={act.mute}>
            <VolumeX className="w-4 h-4" />
          </ActionButton>
          <ActionButton label={currentLocked ? 'Unlock' : 'Lock'} shortcut="L" onClick={act.lock} title="A locked line stays where it is when Sync runs again">
            {currentLocked ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </ActionButton>
          {onOpenTakes && (
            <ActionButton
              label="Takes"
              onClick={() => (current && !current.original ? onOpenTakes(current.key) : say('Pick a line of the dub to retake it'))}
              title="Voice new takes of the picked line, or of some of its words, and pick one"
            >
              <Mic className="w-4 h-4" />
            </ActionButton>
          )}
        </div>
        <div className="flex gap-0.5 rounded-xl border border-slate-800 bg-slate-950 p-0.5">
          <button type="button" onClick={act.undo} disabled={history.at === 0} title="Undo (Ctrl + Z)" aria-label="Undo" className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={act.redo} disabled={history.at >= history.entries.length - 1} title="Redo (Ctrl + Shift + Z)" aria-label="Redo" className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-pointer disabled:cursor-default">
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <span className="ml-auto flex items-center gap-3 min-w-0">
          {toast ? (
            <span aria-live="polite" className="text-[12px] text-amber-300">{toast}</span>
          ) : (
            <span className="truncate text-[11.5px] text-slate-500">
              {blade ? 'Blade is on: click a line to cut it there · B turns it off' : hover ? ZONE_HINT[hover.zone] : group.length > 1
                    ? `${group.length} lines picked: drag one to move them all · its top edge or corners set gain and fades on all · Ctrl + click adds or drops a line`
                    : pick
                      ? 'Drag the picked stretch of the original down onto a gap in the dub · Ctrl + C copies it, Ctrl + V puts it at the playhead · Esc lets go'
                      : 'Point at a line: its middle moves it, its edges trim it, its top corners fade it, its top edge sets its gain · Ctrl + click or drag across empty lane picks several · drag across the original to fill a gap with it'}
            </span>
          )}
        </span>
      </div>

      {/* Inspector and history */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-label="Picked line" className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 min-w-0">
          {group.length > 1 ? (
            <GroupInspector
              group={group}
              onGain={(v) => setGroupField({ gainDb: clamp(Math.round(v * 2) / 2, MIN_GAIN_DB, MAX_GAIN_DB) }, 'Set the gain of')}
              onFadeIn={(v) => setGroupField({ fadeIn: Math.max(0, v) / 1000 }, 'Fade in')}
              onFadeOut={(v) => setGroupField({ fadeOut: Math.max(0, v) / 1000 }, 'Fade out')}
              onSpeed={(v) => setGroupRate(v / 100)}
              onMute={act.mute}
              onLock={act.lock}
              onReset={act.reset}
              onRemove={act.remove}
              onClear={() => setSelectedIds([])}
            />
          ) : current ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-100">{current.original ? `Clip ${current.label}` : `Line ${current.label}`}</span>
                {current.original ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cyan-400/12 text-cyan-300">original voice</span>
                ) : (
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${currentLanding.chip}`}>{currentLanding.label}</span>
                )}
                {currentUnit?.offset !== null && currentUnit?.offset !== undefined && (
                  <span className="font-mono text-[11.5px] text-slate-400">{formatShift(currentUnit.offset)} vs original</span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
                  {current.original ? (
                    'Stays where you put it'
                  ) : currentLocked ? (
                    <>
                      <Lock className="w-3 h-3" /> Locked: Sync again leaves it
                    </>
                  ) : isEdited(committed, current.key) ? (
                    'Not locked: Sync again places it itself'
                  ) : (
                    'As Sync placed it'
                  )}
                </span>
              </div>
              {current.original && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-300">
                  The original from <span className="font-mono">{formatTime(current.part.from)}</span> to <span className="font-mono">{formatTime(current.part.to)}</span>, on the dub
                  to fill a gap. Its edges trim it into more of the original; Alt + drag slips which stretch it plays.
                </p>
              )}
              {current.unit && (
                <>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-200">{current.unit.text}</p>
                  <p className="text-[11.5px] leading-relaxed text-slate-500">{current.unit.sourceText}</p>
                </>
              )}
              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <NumberField label="Start (s)" value={current.part.start} step={0.01} digits={3} onCommit={(v) => setField({ start: v }, 'Set the start of')} />
                <NumberField label="Speed (%)" value={current.part.rate * 100} step={1} digits={0} onCommit={(v) => setField({ rate: v / 100 }, 'Set the speed of')} />
                <NumberField label="Gain (dB)" value={current.part.gainDb} step={0.5} digits={1} onCommit={(v) => setField({ gainDb: clamp(Math.round(v * 2) / 2, -24, 12) }, 'Set the gain of')} />
                <NumberField label="Fade in (ms)" value={current.part.fadeIn * 1000} step={10} digits={0} onCommit={(v) => setField({ fadeIn: Math.max(0, v) / 1000 }, 'Fade in')} />
                <NumberField label="Fade out (ms)" value={current.part.fadeOut * 1000} step={10} digits={0} onCommit={(v) => setField({ fadeOut: Math.max(0, v) / 1000 }, 'Fade out')} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {current.original ? (
                  <button type="button" onClick={act.remove} className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5">
                    Take off the dub <kbd className="font-mono text-[10px] text-slate-500">Del</kbd>
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={act.align} className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5">
                      <AlignStartVertical className="w-3.5 h-3.5" /> Align to original
                    </button>
                    <button type="button" onClick={act.reset} className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" /> Reset line
                    </button>
                  </>
                )}
                <button type="button" onClick={() => onPlayFrom(Math.max(0, current.part.start - 0.3))} className="h-8 px-3 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer">
                  Play from here <kbd className="ml-1 font-mono text-[10px] text-slate-500">/</kbd>
                </button>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-slate-400">
              Click a line on the dub lane to pick it. Drag its middle to move it, an edge to trim it (Alt: stretch), a top corner to fade it, its top edge up or down for gain; Alt + drag the middle slips the audio inside. The arrow keys go from line to line, and{' '}
              <kbd className="font-mono text-slate-300">,</kbd> <kbd className="font-mono text-slate-300">.</kbd> nudge it by 10 ms (100 ms with Shift). To fill a gap with the original's own voice, drag across the
              Original lane to pick a stretch and drag it down onto the dub, or copy it with <kbd className="font-mono text-slate-300">Ctrl + C</kbd> and put it at the playhead with{' '}
              <kbd className="font-mono text-slate-300">Ctrl + V</kbd>.
            </p>
          )}
        </section>

        <section aria-label="Edit history" className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-slate-100">History</span>
            <span className="text-[10.5px] text-slate-500">click a step to go back to it</span>
          </div>
          <ol className="mt-1.5 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {history.entries.map((entry, n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => goTo(n)}
                  className={`w-full text-left rounded-md px-2 py-1 text-[11.5px] truncate cursor-pointer ${
                    n === history.at ? 'bg-slate-800 text-slate-100' : n > history.at ? 'text-slate-600 hover:text-slate-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 border-t border-slate-800 pt-2 text-[10.5px] leading-relaxed text-slate-500">
            <kbd className="font-mono text-slate-400">Space</kbd> play · <kbd className="font-mono text-slate-400">/</kbd> play from the line ·{' '}
            <kbd className="font-mono text-slate-400">Del</kbd> remove · <kbd className="font-mono text-slate-400">Esc</kbd> deselect ·{' '}
            <kbd className="font-mono text-slate-400">Ctrl + A</kbd> pick all · <kbd className="font-mono text-slate-400">Ctrl</kbd> + click add ·{' '}
            <kbd className="font-mono text-slate-400">Ctrl + C / V</kbd> copy the original onto the dub ·{' '}
            <kbd className="font-mono text-slate-400">= −</kbd> zoom · scroll to move · <kbd className="font-mono text-slate-400">Ctrl</kbd> + scroll to zoom
          </p>
        </section>
      </div>
    </div>
  );
};
