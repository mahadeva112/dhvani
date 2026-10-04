import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SyncReport, SyncUnitReport } from '../services/syncService';
import { bufferSeconds, computePeaks } from '../services/playbackTimeline';
import { TimelineRuler, TimelineScrollbar, TimelineTransport, TimelineZoomControls, useTimelineZoom, useWindowPlayheads, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';

/**
 * How every synced line landed against the original. It opens on the whole
 * track; zooming in (the buttons, Ctrl + wheel or a pinch, or a drag across the
 * ruler) shows a window of it that follows the playhead.
 *
 *   ruler      time
 *   Original   the original's waveform and lines, numbered
 *   links      a sync line from each original line's start to its dub line's
 *              start: upright is in sync, a slant is the dub early or late
 *   Synced     the synced dub's waveform and lines, numbered, over a dashed
 *              outline of where the original line is; the part of a line that
 *              runs into the next original line is hatched
 *   drift      each line's start error over the whole window, against the
 *              tolerance band, so drift that builds up line after line shows
 *
 * Hovering a line (or the line under the playhead) picks out the pair and
 * spells out its numbers underneath.
 */

/** Above this a late or early start is drawn red rather than amber. */
const FAR_OFF_SECONDS = 0.5;
/** Waveform peaks per second: finer than the closest zoom needs at any width. */
const PEAKS_PER_SECOND = 100;

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};
const formatOffset = (seconds: number) => `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${Math.abs(seconds).toFixed(2)} s`;

type Tone = 'sync' | 'off' | 'far' | 'none';
const toneOf = (u: SyncUnitReport, tolerance: number): Tone => {
  if (u.offset === null || u.placedStart === null) return 'none';
  if (u.inSync) return 'sync';
  return Math.abs(u.offset) > FAR_OFF_SECONDS || (u.overrun ?? 0) > FAR_OFF_SECONDS ? 'far' : Math.abs(u.offset) > tolerance || (u.overrun ?? 0) > tolerance ? 'off' : 'sync';
};
const TONE = {
  sync: { stroke: '#34d399', dot: 'bg-emerald-400', bar: 'bg-indigo-400/55', text: 'text-emerald-300' },
  off: { stroke: '#fbbf24', dot: 'bg-amber-400', bar: 'bg-amber-400/45', text: 'text-amber-300' },
  far: { stroke: '#fb7185', dot: 'bg-rose-400', bar: 'bg-rose-400/45', text: 'text-rose-300' },
  none: { stroke: '#64748b', dot: 'bg-slate-500', bar: 'bg-slate-600/40', text: 'text-slate-400' },
};
const HATCH = 'repeating-linear-gradient(135deg, rgba(251,113,133,0.75) 0 3px, rgba(251,113,133,0.15) 3px 6px)';

/** Peaks of a whole buffer, once; drawn a window at a time. */
const usePeaks = (buffer: AudioBuffer | null | undefined) =>
  useMemo(() => {
    if (!buffer) return null;
    try {
      return { peaks: computePeaks(buffer, Math.max(1, Math.ceil(bufferSeconds(buffer) * PEAKS_PER_SECOND))), seconds: bufferSeconds(buffer) };
    } catch {
      return null;
    }
  }, [buffer]);

/** A lane's waveform for [from, from + span], in the canvas's text colour. */
const WindowWaveform: React.FC<{ data: { peaks: Float32Array; seconds: number } | null; from: number; span: number; className: string }> = ({
  data,
  from,
  span,
  className,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setSize((n) => n + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
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
    ctx.fillStyle = getComputedStyle(canvas).color;
    const bars = Math.max(1, Math.floor(w / 2));
    const barWidth = w / bars;
    const n = data.peaks.length;
    for (let i = 0; i < bars; i++) {
      const t0 = from + (span * i) / bars;
      const t1 = from + (span * (i + 1)) / bars;
      if (t1 <= 0 || t0 >= data.seconds) continue;
      const b0 = Math.max(0, Math.floor((t0 / data.seconds) * n));
      const b1 = Math.min(n, Math.max(b0 + 1, Math.floor((t1 / data.seconds) * n)));
      let a = 0;
      for (let b = b0; b < b1; b++) if (data.peaks[b] > a) a = data.peaks[b];
      const bh = Math.max(1, a * (h - 4));
      ctx.fillRect(i * barWidth, (h - bh) / 2, Math.max(1, barWidth - 0.5), bh);
    }
  }, [data, from, span, size]);
  return <canvas ref={ref} aria-hidden="true" className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} />;
};

export const SyncAlignmentView: React.FC<{
  report: SyncReport;
  reportedTime: number;
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  /** The original and the synced dub, for the lanes' waveforms. */
  sourceBuffer?: AudioBuffer | null;
  dubBuffer?: AudioBuffer | null;
}> = ({ report, reportedTime, getLiveTime, onSeek, isPlaying, onTogglePlay, sourceBuffer, dubBuffer }) => {
  // The clocks and the line under the playhead use tenths; the playheads move every frame through playheadRef.
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime, 0.1);
  const units = useMemo(() => [...report.units].sort((a, b) => a.srcStart - b.srcStart), [report]);
  const total = Math.max(report.duration, ...units.map((u) => Math.max(u.srcEnd, u.placedEnd ?? 0)));
  const zoom = useTimelineZoom(total, currentTime);
  const { windowStart, windowSeconds: WINDOW_SECONDS, follow, setFollow, scrollTo } = zoom;
  const [hovered, setHovered] = useState<number | null>(null);
  const playheadRef = useWindowPlayheads({
    reportedTime,
    isPlaying,
    getLiveTime,
    windowStart,
    windowSeconds: WINDOW_SECONDS,
    follow,
    onFollow: zoom.followTo,
  });
  const sourcePeaks = usePeaks(sourceBuffer);
  const dubPeaks = usePeaks(dubBuffer);

  const end = windowStart + WINDOW_SECONDS;
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  const tones = useMemo(() => new Map(units.map((u) => [u.index, toneOf(u, report.tolerance)])), [units, report.tolerance]);
  const visible = units.filter(
    (u) => Math.max(u.srcEnd, u.placedEnd ?? -Infinity) >= windowStart && Math.min(u.srcStart, u.placedStart ?? Infinity) <= end
  );
  /** Where each line's slot ends: the next original line's start. */
  const nextStart = useMemo(() => new Map(units.map((u, i) => [u.index, units[i + 1]?.srcStart ?? null])), [units]);

  // The line picked out: the one hovered, else the one being heard.
  const atPlayhead = units.find((u) => currentTime >= Math.min(u.srcStart, u.placedStart ?? Infinity) && currentTime <= Math.max(u.srcEnd, u.placedEnd ?? -Infinity));
  const focus = hovered !== null ? units.find((u) => u.index === hovered) : atPlayhead;
  const focusIndex = focus?.index ?? null;
  const dim = (u: SyncUnitReport) => hovered !== null && u.index !== hovered;

  const onWheel = wheelScroll(WINDOW_SECONDS, (seconds) => scrollTo(windowStart + seconds));
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFollow(true);
    onSeek(windowStart + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS);
  };
  const seekLine = (time: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setFollow(true);
    onSeek(Math.max(0, time));
  };
  const markers = useMemo(
    () =>
      units
        .filter((u) => u.exceeded || u.short || !u.inSync)
        .map((u) => ({ time: u.srcStart, tone: u.exceeded || !u.inSync ? ('warn' as const) : ('soft' as const) })),
    [units]
  );

  // Drift chart: start error in seconds, late up. The range always shows the tolerance band.
  const offsets = units.map((u) => u.offset).filter((o): o is number => o !== null);
  const yMax = Math.max(report.tolerance * 2, ...offsets);
  const yMin = Math.min(-report.tolerance * 2, ...offsets);
  const DRIFT_H = 56;
  const y = (o: number) => 4 + ((yMax - o) / (yMax - yMin || 1)) * (DRIFT_H - 8);
  const maxLate = offsets.length ? Math.max(...offsets) : 0;
  const longCount = units.filter((u) => u.exceeded).length;

  const laneLabel = 'flex items-center gap-1.5 text-[11px] text-slate-400';
  const lineNumber = (u: SyncUnitReport, from: number, to: number) =>
    pct(to) - pct(from) > 3.2 ? (
      <span className="absolute left-1 top-0.5 font-mono text-[9.5px] font-semibold text-slate-100/90 pointer-events-none">{u.index + 1}</span>
    ) : null;

  const fx = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 1000;

  return (
    <div className="flex flex-col gap-1.5" onMouseLeave={() => setHovered(null)}>
      <TimelineZoomControls zoom={zoom} />

      <div ref={zoom.lanesRef} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 items-center">
        {/* Ruler: drag across it to zoom to that stretch */}
        <span />
        <TimelineRuler zoom={zoom} />

        {/* Original */}
        <span className={laneLabel}>
          <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original
        </span>
        <div className="relative h-11 rounded-t-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
          <WindowWaveform data={sourcePeaks} from={windowStart} span={WINDOW_SECONDS} className="text-cyan-300/25" />
          {visible.map((u) => (
            <span
              key={u.index}
              onMouseEnter={() => setHovered(u.index)}
              onClick={seekLine(u.srcStart)}
              title={`#${u.index + 1} ${u.sourceText}`}
              className={`absolute top-1.5 bottom-1.5 rounded bg-cyan-400/35 border-l-2 border-cyan-300 transition-opacity ${dim(u) ? 'opacity-30' : ''} ${
                u.index === focusIndex ? 'ring-1 ring-cyan-200' : ''
              }`}
              style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%` }}
            >
              {lineNumber(u, u.srcStart, u.srcEnd)}
            </span>
          ))}
          <span ref={playheadRef(0)} className="absolute top-0 bottom-0 w-0.5 -ml-px bg-slate-100 pointer-events-none" />
        </div>

        {/* Sync lines: original start to dub start */}
        <span className="text-[10px] text-slate-500 leading-tight">Start → start</span>
        <div className="relative h-7 bg-slate-950/30 overflow-hidden" onWheel={onWheel}>
          <svg viewBox="0 0 1000 28" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
            {visible.map((u) =>
              u.placedStart === null ? null : (
                <line
                  key={u.index}
                  x1={fx(u.srcStart)}
                  y1={0}
                  x2={fx(u.placedStart)}
                  y2={28}
                  stroke={TONE[tones.get(u.index) ?? 'none'].stroke}
                  strokeWidth={u.index === focusIndex ? 2.5 : 1.5}
                  strokeOpacity={dim(u) ? 0.2 : 0.9}
                  vectorEffect="non-scaling-stroke"
                />
              )
            )}
          </svg>
          <span ref={playheadRef(1)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100/60 pointer-events-none" />
        </div>

        {/* Dub */}
        <span className={laneLabel}>
          <span className="w-2 h-2 rounded-sm bg-indigo-400" /> Synced
        </span>
        <div className="relative h-11 rounded-b-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
          <WindowWaveform data={dubPeaks} from={windowStart} span={WINDOW_SECONDS} className="text-indigo-300/25" />
          {/* Where each line should be: the original line's span */}
          {visible.map((u) => (
            <span
              key={`slot-${u.index}`}
              aria-hidden="true"
              className={`absolute top-1 bottom-1 rounded border border-dashed border-slate-500/60 pointer-events-none ${dim(u) ? 'opacity-30' : ''}`}
              style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%` }}
            />
          ))}
          {visible.map((u) => {
            if (u.placedStart === null || u.placedEnd === null) return null;
            const tone = tones.get(u.index) ?? 'none';
            const slotEnd = nextStart.get(u.index);
            // The part that runs into the next original line.
            const runOn = slotEnd !== null && slotEnd !== undefined && u.placedEnd > slotEnd ? Math.max(u.placedStart, slotEnd) : null;
            return (
              <React.Fragment key={u.index}>
                <span
                  onMouseEnter={() => setHovered(u.index)}
                  onClick={seekLine(u.placedStart)}
                  title={`#${u.index + 1} ${u.text}`}
                  className={`absolute top-1.5 bottom-1.5 rounded border-l-2 transition-opacity ${TONE[tone].bar} ${dim(u) ? 'opacity-30' : ''} ${
                    u.index === focusIndex ? 'ring-1 ring-indigo-200' : ''
                  }`}
                  style={{
                    left: `${pct(u.placedStart)}%`,
                    width: `${Math.max(0.3, pct(u.placedEnd) - pct(u.placedStart))}%`,
                    borderLeftColor: TONE[tone].stroke,
                  }}
                >
                  {lineNumber(u, u.placedStart, u.placedEnd)}
                </span>
                {runOn !== null && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-1.5 bottom-1.5 rounded-r pointer-events-none ${dim(u) ? 'opacity-30' : ''}`}
                    style={{ left: `${pct(runOn)}%`, width: `${Math.max(0.3, pct(u.placedEnd) - pct(runOn))}%`, background: HATCH }}
                  />
                )}
                {u.short && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 bottom-1.5 rounded-r border border-dashed border-sky-400/70 bg-sky-400/5 pointer-events-none"
                    style={{ left: `${pct(u.placedEnd)}%`, width: `${Math.max(0.3, pct(u.placedEnd + u.shortBy) - pct(u.placedEnd))}%` }}
                  />
                )}
              </React.Fragment>
            );
          })}
          <span ref={playheadRef(2)} className="absolute top-0 bottom-0 w-0.5 -ml-px bg-slate-100 pointer-events-none" />
        </div>

        {/* Drift: each line's start error */}
        <span className="text-[10px] text-slate-500 leading-tight">
          Start error
          <span className="block">late ↑</span>
        </span>
        <div className="relative mt-1.5 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" style={{ height: DRIFT_H }} onClick={seekAt} onWheel={onWheel}>
          <svg viewBox={`0 0 1000 ${DRIFT_H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
            <rect x={0} width={1000} y={y(report.tolerance)} height={Math.max(1, y(-report.tolerance) - y(report.tolerance))} fill="rgba(52,211,153,0.12)" />
            <line x1={0} x2={1000} y1={y(0)} y2={y(0)} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <polyline
              fill="none"
              stroke="rgba(148,163,184,0.7)"
              strokeWidth={1.25}
              vectorEffect="non-scaling-stroke"
              points={units
                .filter((u) => u.offset !== null)
                .map((u) => `${fx(u.srcStart)},${y(u.offset as number)}`)
                .join(' ')}
            />
          </svg>
          {units.map((u) =>
            u.offset === null || u.srcStart < windowStart - 1 || u.srcStart > end + 1 ? null : (
              <span
                key={u.index}
                onMouseEnter={() => setHovered(u.index)}
                onClick={seekLine(u.srcStart)}
                title={`#${u.index + 1}: starts ${formatOffset(u.offset)}`}
                className={`absolute w-2 h-2 -ml-1 -mt-1 rounded-full ${TONE[tones.get(u.index) ?? 'none'].dot} ${
                  u.index === focusIndex ? 'ring-2 ring-white/70' : ''
                } ${dim(u) ? 'opacity-30' : ''}`}
                style={{ left: `${pct(u.srcStart)}%`, top: y(u.offset) }}
              />
            )
          )}
          <span ref={playheadRef(3)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100/60 pointer-events-none" />
        </div>

        <span />
        <div className="mt-1.5">
          <TimelineScrollbar total={total} windowStart={windowStart} windowSeconds={WINDOW_SECONDS} currentTime={currentTime} markers={markers} onScroll={scrollTo} />
        </div>
      </div>

      {/* The picked-out line, spelled out */}
      <div className="min-h-[3.25rem] rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[12px]" aria-live="polite">
        {focus ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tabular-nums">
              <span className="font-semibold text-slate-100">#{focus.index + 1}</span>
              <span className="text-cyan-300">
                Original {formatClock(focus.srcStart)}–{formatClock(focus.srcEnd)}
              </span>
              {focus.placedStart !== null && focus.placedEnd !== null ? (
                <span className="text-indigo-300">
                  Synced {formatClock(focus.placedStart)}–{formatClock(focus.placedEnd)}
                </span>
              ) : (
                <span className="text-slate-500">Synced: no audio</span>
              )}
              {focus.offset !== null && (
                <span className={TONE[tones.get(focus.index) ?? 'none'].text}>
                  starts {formatOffset(focus.offset)}
                  {focus.inSync ? ' · in sync' : ''}
                </span>
              )}
              {(focus.overrun ?? 0) > 0.01 && <span className="text-rose-300">runs {(focus.overrun as number).toFixed(2)} s into #{focus.index + 2}</span>}
              {focus.exceeded && <span className="text-amber-300">{focus.exceededBy.toFixed(2)} s too long</span>}
              {focus.short && <span className="text-sky-300">ends {focus.shortBy.toFixed(1)} s early</span>}
            </div>
            <p className="mt-0.5 text-slate-300 truncate">{focus.text}</p>
          </>
        ) : (
          <span className="text-slate-500">Hover a line to see how it landed, or press play.</span>
        )}
      </div>

      {maxLate > report.tolerance && longCount > 0 && (
        <p className="text-[12px] text-amber-200/90">
          The dub drifts up to {formatOffset(maxLate)} late: {longCount === 1 ? '1 line is' : `${longCount} lines are`} longer than the original line, and a line
          can't start until the one before it ends, so each long line pushes the ones after it later. Shorten the long lines below, then sync again.
        </p>
      )}

      <TimelineTransport
        isPlaying={isPlaying}
        onTogglePlay={() => {
          setFollow(true);
          onTogglePlay();
        }}
        currentTime={currentTime}
        total={total}
        windowStart={windowStart}
        windowSeconds={WINDOW_SECONDS}
      >
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-emerald-400" /> In sync</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-amber-400" /> Off by up to {FAR_OFF_SECONDS} s</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-rose-400" /> Off by more</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: HATCH }} /> Runs into the next line</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm border border-dashed border-slate-500" /> Where the original line is</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm border border-dashed border-sky-400/70" /> Ends early</span>
      </TimelineTransport>
    </div>
  );
};
