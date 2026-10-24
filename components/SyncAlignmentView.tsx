import React, { useMemo, useState } from 'react';
import { CircleHelp, Mic, Pencil } from 'lucide-react';
import type { SyncReport, SyncUnitReport } from '../services/syncService';
import { LINE_HUES, hueOf, withAlpha } from './lineColors';
import { WindowWaveform, usePeaks } from './WindowWaveform';
import { TimelineRuler, TimelineScrollbar, TimelineTransport, TimelineZoomControls, useTimelineZoom, useWindowPlayheads, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';
import { LinePair } from './LinePair';

/**
 * How every synced line landed against the original. It opens on the whole
 * track; zooming in (the buttons, Ctrl + wheel or a pinch) shows a window of
 * it, which moves along under the playhead while it plays.
 *
 *   ruler      time; a click puts the playhead there, a drag scrubs it
 *   Original   the original's waveform over its lines, numbered; past the
 *              original's end, a note that it has ended
 *   links      a sync line from each original line's start to its dub line's
 *              start: upright is in sync, a slant is the dub early or late
 *   Synced     the synced dub's waveform over its lines, numbered with a dot
 *              for how the line landed, and a dashed outline of where the
 *              original line is; the part of a line that runs into the next
 *              original line has a red strip under it
 *   scroll bar the whole dub, with the lines off their timing marked; drag it
 *              to move along
 *
 * Each line has its own colour (lineColors.ts), the same in both lanes and on
 * its link, so a line's original and synced halves pair up at a glance.
 *
 * Hovering a line (or the line under the playhead) picks out the pair and
 * spells out its numbers underneath.
 */

/** Above this a late or early start is drawn red rather than amber. */
const FAR_OFF_SECONDS = 0.5;

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

type Tone = 'sync' | 'off' | 'far' | 'none';
const toneOf = (u: SyncUnitReport, tolerance: number): Tone => {
  if (u.offset === null || u.placedStart === null) return 'none';
  if (u.inSync) return 'sync';
  return Math.abs(u.offset) > FAR_OFF_SECONDS || (u.overrun ?? 0) > FAR_OFF_SECONDS ? 'far' : Math.abs(u.offset) > tolerance || (u.overrun ?? 0) > tolerance ? 'off' : 'sync';
};
const TONE = {
  sync: { stroke: '#34d399', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  off: { stroke: '#fbbf24', dot: 'bg-amber-400', text: 'text-amber-300' },
  far: { stroke: '#fb7185', dot: 'bg-rose-400', text: 'text-rose-300' },
  none: { stroke: '#64748b', dot: 'bg-slate-500', text: 'text-slate-400' },
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
  /** As the Dub step's player: each lane's header (name, mute, solo, level) in place of its plain label. */
  trackHead?: (track: 'source' | 'synth') => React.ReactNode;
  /** Lanes not heard now (muted, or left out by solo), drawn dimmed. */
  silent?: { source?: boolean; synth?: boolean };
  /** Previous and next line buttons either side of play. */
  onPrevLine?: () => void;
  onNextLine?: () => void;
  /** More of the player's controls, after the legend: speed, video. */
  transportExtras?: React.ReactNode;
  /** The picked-out line's actions: work on it in the line list. */
  onWorkOnLine?: (unit: SyncUnitReport, mode: 'takes' | 'words') => void;
  /** Whether a line's takes can be opened (Takes shows only then). */
  canOpenTakes?: boolean;
  /** A click on a lane: with this, the player decides (a lane not being heard starts that track there). */
  onSeekTrack?: (track: 'source' | 'synth', time: number) => void;
  /** The languages of the original and the dub, for the picked-out line's tags. */
  sourceLanguage?: string;
  dubLanguage?: string;
}> = ({
  report,
  reportedTime,
  getLiveTime,
  onSeek,
  isPlaying,
  onTogglePlay,
  sourceBuffer,
  dubBuffer,
  trackHead,
  silent,
  onPrevLine,
  onNextLine,
  transportExtras,
  onWorkOnLine,
  canOpenTakes = false,
  onSeekTrack,
  sourceLanguage,
  dubLanguage,
}) => {
  // The clocks and the line under the playhead use tenths; the playheads move every frame through playheadRef.
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime, 0.1);
  const units = useMemo(() => [...report.units].sort((a, b) => a.srcStart - b.srcStart), [report]);
  const total = Math.max(report.duration, ...units.map((u) => Math.max(u.srcEnd, u.placedEnd ?? 0)));
  const zoom = useTimelineZoom(total, currentTime);
  const { windowStart, windowSeconds: WINDOW_SECONDS, ahead, follow, setFollow, scrollTo } = zoom;
  const [hovered, setHovered] = useState<number | null>(null);
  const playheadRef = useWindowPlayheads({
    reportedTime,
    isPlaying,
    getLiveTime,
    windowStart,
    windowSeconds: WINDOW_SECONDS,
    follow,
    onFollow: zoom.followTo,
    glideTo: zoom.glideTo,
  });
  const sourcePeaks = usePeaks(sourceBuffer);
  /** Where the original's audio ends; past it the Original lane says so rather than sitting empty. */
  const sourceEnd = sourcePeaks?.seconds ?? report.duration;
  const dubPeaks = usePeaks(dubBuffer);

  // Gliding, `ahead` more is drawn past the right edge, for the timeline to move into.
  const end = windowStart + WINDOW_SECONDS + ahead;
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
  const sourceSpans = useMemo(
    () => units.map((u) => ({ from: u.srcStart, to: u.srcEnd, color: hueOf(u.index), faded: hovered !== null && u.index !== hovered })),
    [units, hovered]
  );
  const dubSpans = useMemo(
    () =>
      units.flatMap((u) =>
        u.placedStart === null || u.placedEnd === null
          ? []
          : [{ from: u.placedStart, to: u.placedEnd, color: hueOf(u.index), faded: hovered !== null && u.index !== hovered }]
      ),
    [units, hovered]
  );
  /** A line's highlight, under the waveform: a tint of its colour, stronger with a ring when picked out. */
  const highlight = (u: SyncUnitReport) => ({
    background: withAlpha(hueOf(u.index), u.index === focusIndex ? 0.24 : 0.12),
    boxShadow: u.index === focusIndex ? `0 0 0 1px ${withAlpha(hueOf(u.index), 0.7)}` : undefined,
  });

  const onWheel = wheelScroll(WINDOW_SECONDS, (seconds) => scrollTo(zoom.viewStart() + seconds));
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFollow(true);
    onSeek(zoom.viewStart() + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS);
  };
  /** A click on a track's lane, through the player when it handles track switching. */
  const seekOn = (track: 'source' | 'synth') => (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeekTrack) return seekAt(e);
    const r = e.currentTarget.getBoundingClientRect();
    setFollow(true);
    onSeekTrack(track, Math.max(0, Math.min(total, zoom.viewStart() + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS)));
  };
  /** Left and right arrows on a lane move the playhead 5 s. */
  const nudge = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setFollow(true);
    onSeek(Math.max(0, Math.min(total, currentTime + (e.key === 'ArrowRight' ? 5 : -5))));
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

  const laneLabel = 'flex items-center gap-1.5 text-[11px] text-slate-400';
  const lineAction = 'h-7 px-2.5 rounded-lg border border-slate-700 text-[11.5px] font-sans text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-1.5 cursor-default';
  /**
   * The line's label across the top of its clip, as a DAW names its items: a
   * strip in the line's colour with its number, on the dub a dot for how it
   * landed, and its words when there is room.
   */
  const clipLabel = (u: SyncUnitReport, from: number, to: number, words: string, tone?: Tone) => {
    const width = pct(to) - pct(from);
    return (
      <span
        className="absolute z-10 inset-x-0 top-0 h-[15px] rounded-t flex items-center gap-1 px-1 overflow-hidden whitespace-nowrap font-mono text-[9.5px] font-semibold leading-none text-slate-950 pointer-events-none"
        style={{ background: hueOf(u.index) }}
      >
        {width > 1.6 && (
          <>
            {tone && <span className={`w-1.5 h-1.5 shrink-0 rounded-full ring-1 ring-slate-950/70 ${TONE[tone].dot}`} />}
            {u.index + 1}
            {width > 8 && words && <span className="font-sans font-medium truncate opacity-80">{words}</span>}
          </>
        )}
      </span>
    );
  };

  const fx = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 1000;
  /** A track header cell: the track's colour down its left edge, then its name and mixer. */
  const headCell = (stripe: string, children: React.ReactNode) => (
    <div className="flex min-w-0 self-stretch border-r border-b border-slate-800 bg-slate-900/80">
      <span className={`w-1 shrink-0 ${stripe}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 flex items-center px-2.5 py-2">{children}</div>
    </div>
  );
  const laneHeight = trackHead ? 'h-[4.75rem]' : 'h-14';

  return (
    <div className="flex flex-col gap-2" onMouseLeave={() => setHovered(null)}>
      <TimelineZoomControls zoom={zoom} />

      {/* The arrange view, as in REAPER: track headers on the left, the ruler and lanes on the right, the scroll bar along their foot. */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
        <div
          ref={zoom.lanesRef}
          className={`grid ${trackHead ? 'grid-cols-[12.5rem_minmax(0,1fr)]' : 'grid-cols-[5.5rem_minmax(0,1fr)]'}`}
          style={{ overflowX: 'clip' }}
        >
          {/* Ruler: a click puts the playhead there, a drag scrubs it */}
          <div className="flex items-center px-2.5 border-r border-b border-slate-800 bg-slate-900/80 font-mono text-[10.5px] text-slate-500 tabular-nums">
            {formatClock(total)} in all
          </div>
          <div className="relative h-7 border-b border-slate-800 bg-slate-900/60 overflow-hidden">
            <TimelineRuler zoom={zoom} marks onSeek={(t) => onSeek(Math.max(0, Math.min(total, t)))} />
            {/* The playhead's cap, at the foot of the ruler */}
            <span
              ref={playheadRef(3)}
              aria-hidden="true"
              className="absolute bottom-0 w-0 h-0 -ml-[5px] border-x-[5px] border-x-transparent border-t-[7px] border-t-slate-100 pointer-events-none"
            />
          </div>

          {/* Original */}
          {trackHead ? (
            headCell('bg-cyan-400', trackHead('source'))
          ) : (
            headCell('bg-cyan-400', <span className={laneLabel}>Original</span>)
          )}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Original position"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(currentTime)}
            className={`relative ${laneHeight} border-b border-slate-800 overflow-hidden cursor-default transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400 ${silent?.source ? 'opacity-40' : ''}`}
            onClick={seekOn('source')}
            onKeyDown={nudge}
            onWheel={onWheel}
          >
            <div ref={zoom.strip} className="absolute inset-0">
            {sourceEnd > 0 && sourceEnd < end && (
              <span
                aria-hidden="true"
                className="absolute top-1 bottom-1 rounded border border-dashed border-slate-600/70 bg-slate-800/40 pointer-events-none flex items-center overflow-hidden"
                style={{ left: `${Math.max(0, pct(sourceEnd))}%`, right: `${(-ahead / WINDOW_SECONDS) * 100}%` }}
              >
                <span className="px-2 text-[11px] text-slate-400 whitespace-nowrap">Original ends {formatClock(sourceEnd)}</span>
              </span>
            )}
            {visible.map((u) => (
              <span
                key={u.index}
                onMouseEnter={() => setHovered(u.index)}
                onClick={seekLine(u.srcStart)}
                title={`#${u.index + 1} ${u.sourceText}`}
                className={`absolute top-1.5 bottom-1.5 rounded transition-opacity ${dim(u) ? 'opacity-30' : ''}`}
                style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%`, ...highlight(u) }}
              >
                {clipLabel(u, u.srcStart, u.srcEnd, u.sourceText)}
              </span>
            ))}
            {/* Over the lines, under their labels */}
            <div className="absolute top-[15px] bottom-0 left-0" style={{ width: `${((WINDOW_SECONDS + ahead) / WINDOW_SECONDS) * 100}%` }}>
              <WindowWaveform data={sourcePeaks} from={windowStart} span={WINDOW_SECONDS + ahead} spans={sourceSpans} className="text-slate-400/30" />
            </div>
            </div>
            <span ref={playheadRef(0)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100 pointer-events-none" />
          </div>

          {/* Sync lines: original start to dub start */}
          <div className="flex items-center px-2.5 border-r border-b border-slate-800 bg-slate-900/80 text-[10.5px] text-slate-500">Start → start</div>
          <div className="relative h-6 border-b border-slate-800 bg-slate-950/40 overflow-hidden" onWheel={onWheel}>
            <svg ref={zoom.strip} viewBox="0 0 1000 24" preserveAspectRatio="none" overflow="visible" className="absolute inset-0 w-full h-full" aria-hidden="true">
              {visible.map((u) =>
                u.placedStart === null ? null : (
                  <line
                    key={u.index}
                    x1={fx(u.srcStart)}
                    y1={0}
                    x2={fx(u.placedStart)}
                    y2={24}
                    stroke={hueOf(u.index)}
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
          {trackHead ? (
            headCell('bg-indigo-400', trackHead('synth'))
          ) : (
            headCell('bg-indigo-400', <span className={laneLabel}>Synced</span>)
          )}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Synced dub position"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(currentTime)}
            className={`relative ${laneHeight} border-b border-slate-800 overflow-hidden cursor-default transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-400 ${silent?.synth ? 'opacity-40' : ''}`}
            onClick={seekOn('synth')}
            onKeyDown={nudge}
            onWheel={onWheel}
          >
            <div ref={zoom.strip} className="absolute inset-0">
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
                    className={`absolute top-1.5 bottom-1.5 rounded transition-opacity ${dim(u) ? 'opacity-30' : ''}`}
                    style={{
                      left: `${pct(u.placedStart)}%`,
                      width: `${Math.max(0.3, pct(u.placedEnd) - pct(u.placedStart))}%`,
                      ...highlight(u),
                    }}
                  >
                    {clipLabel(u, u.placedStart, u.placedEnd, u.text, tone)}
                  </span>
                  {runOn !== null && (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0.5 h-[3px] rounded-full bg-rose-400 pointer-events-none ${dim(u) ? 'opacity-30' : ''}`}
                      style={{ left: `${pct(runOn)}%`, width: `${Math.max(0.3, pct(u.placedEnd) - pct(runOn))}%` }}
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
            <div className="absolute top-[15px] bottom-0 left-0" style={{ width: `${((WINDOW_SECONDS + ahead) / WINDOW_SECONDS) * 100}%` }}>
              <WindowWaveform data={dubPeaks} from={windowStart} span={WINDOW_SECONDS + ahead} spans={dubSpans} className="text-slate-400/30" />
            </div>
            </div>
            <span ref={playheadRef(2)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100 pointer-events-none" />
          </div>

          {/* The scroll bar, along the foot of the lanes: the whole dub, with the lines to look at marked */}
          <div className="border-r border-slate-800 bg-slate-900/80" />
          <div className="px-1 py-1 bg-slate-950/60">
            <TimelineScrollbar inset total={total} windowStart={zoom.viewStart()} windowSeconds={WINDOW_SECONDS} currentTime={currentTime} markers={markers} onScroll={scrollTo} />
          </div>
        </div>
      </div>

      <TimelineTransport
        isPlaying={isPlaying}
        onTogglePlay={() => {
          setFollow(true);
          onTogglePlay();
        }}
        currentTime={currentTime}
        total={total}
        onPrev={onPrevLine}
        onNext={onNextLine}
        status={
          // The picked-out line, spelled out: the one hovered, else the one being heard.
          // Its timing is on the lanes and in Edit timing; here only the words: the original above, the dub below.
          <span className="flex-1 min-w-0 flex items-center gap-3 text-[12px]" aria-live="polite">
            {focus ? (
              <>
                <LinePair source={focus.sourceText} dub={focus.text} sourceLanguage={sourceLanguage} dubLanguage={dubLanguage} />
                <span className="flex items-center gap-2 shrink-0">
                  {onWorkOnLine && canOpenTakes && !focus.silent && (
                    <button type="button" onClick={() => onWorkOnLine(focus, 'takes')} className={lineAction} title="Open this line's takes in the list below">
                      <Mic className="w-3 h-3" /> Takes
                    </button>
                  )}
                  {onWorkOnLine && (focus.exceeded || focus.short) && (
                    <button type="button" onClick={() => onWorkOnLine(focus, 'words')} className={lineAction} title="Reword this line in the list below">
                      <Pencil className="w-3 h-3" /> Edit words
                    </button>
                  )}
                </span>
              </>
            ) : (
              <span className="text-slate-500">Hover a line to see how it landed, or press play.</span>
            )}
          </span>
        }
      >
        {transportExtras}
        {/* The legend, a click away rather than a row of its own */}
        <details className="relative">
          <summary
            className="list-none w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default [&::-webkit-details-marker]:hidden"
            aria-label="What the colours mean"
            title="What the colours mean"
          >
            <CircleHelp className="w-4 h-4" />
          </summary>
          <div className="absolute right-0 bottom-full mb-2 z-30 w-72 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-3 flex flex-col gap-2 text-[11.5px] text-slate-300">
            <span className="flex items-center gap-2">
              <span className="flex gap-0.5">
                {LINE_HUES.map((hue) => (
                  <span key={hue} className="w-2 h-2.5 rounded-sm" style={{ background: hue }} />
                ))}
              </span>
              Each line's colour, the same in both lanes
            </span>
            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> In sync</span>
            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Off by up to {FAR_OFF_SECONDS} s</span>
            <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Off by more</span>
            <span className="flex items-center gap-2"><span className="w-3 h-[3px] rounded-full bg-rose-400" /> Runs into the next line</span>
            <span className="flex items-center gap-2"><span className="w-3 h-2.5 rounded-sm border border-dashed border-slate-500" /> Where the original line is</span>
            <span className="flex items-center gap-2"><span className="w-3 h-2.5 rounded-sm border border-dashed border-sky-400/70" /> Ends early</span>
            <span className="flex items-center gap-2"><span className="w-0.5 h-2.5 rounded-full bg-amber-400" /> On the scroll bar: a line to look at</span>
          </div>
        </details>
      </TimelineTransport>
    </div>
  );
};
