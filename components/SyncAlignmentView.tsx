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
 *   Original   the original's waveform as audio bars, each line in its colour
 *              over a faint tint of it, dimmer so the dub reads first; past
 *              the original's end, a note that it has ended
 *   Synced     the synced dub's waveform the same way, right under the original
 *   scroll bar the whole dub in its lines' colours; drag it to move along
 *
 * Each line has its own colour (lineColors.ts), the same in both lanes, so a
 * line in sync is one colour stacked straight. Nothing is written or marked on
 * the lanes; a line's tooltip says how it landed.
 *
 * Hovering a line (or the line under the playhead) picks out the pair and
 * spells out its words underneath; the tooltip says how it landed.
 */


const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};
/** A short gap, unsigned: milliseconds under a second, else tenths of a second. */
const formatMs = (seconds: number) => {
  const t = Math.abs(seconds);
  return t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(1)} s`;
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
  const visible = units.filter(
    (u) => Math.max(u.srcEnd, u.placedEnd ?? -Infinity) >= windowStart && Math.min(u.srcStart, u.placedStart ?? Infinity) <= end
  );

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
  /** A line's tint under its bars: fainter on the original, stronger with a ring when picked out. */
  const highlight = (u: SyncUnitReport, lane: 'source' | 'synth') => ({
    background: withAlpha(hueOf(u.index), (lane === 'source' ? 0.08 : 0.13) + (u.index === focusIndex ? 0.1 : 0)),
    boxShadow: u.index === focusIndex ? `0 0 0 1px ${withAlpha(hueOf(u.index), 0.7)}` : undefined,
  });
  /** How a line landed, in words, for its tooltip. */
  const landedAs = (u: SyncUnitReport) => {
    if (u.offset === null || u.placedStart === null) return 'silent';
    const parts: string[] = [];
    if (!u.inSync && Math.abs(u.offset) > report.tolerance) parts.push(`starts ${formatMs(u.offset)} ${u.offset > 0 ? 'late' : 'early'}`);
    if ((u.overrun ?? 0) > 0) parts.push(`runs ${formatMs(u.overrun ?? 0)} into the next line`);
    if (u.short) parts.push(`ends ${formatMs(u.shortBy)} early`);
    return parts.length ? parts.join(', ') : 'in sync';
  };

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
  /** The scroll bar's overview: every line where it plays, in its colour. */
  const overview = useMemo(
    () => units.map((u) => ({ from: u.placedStart ?? u.srcStart, to: u.placedEnd ?? u.srcEnd, color: hueOf(u.index) })),
    [units]
  );

  const laneLabel = 'flex items-center gap-1.5 text-[11px] text-slate-400';
  const lineAction = 'h-7 px-2.5 rounded-lg border border-slate-700 text-[11.5px] font-sans text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-1.5 cursor-default';
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
                title={`Line ${u.index + 1} · original\n${u.sourceText}`}
                className={`absolute top-1 bottom-1 rounded transition-opacity ${dim(u) ? 'opacity-30' : ''}`}
                style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%`, ...highlight(u, 'source') }}
              />
            ))}
            {/* Over the tints, dimmer than the dub's */}
            <div className="absolute top-0 bottom-0 left-0 opacity-60" style={{ width: `${((WINDOW_SECONDS + ahead) / WINDOW_SECONDS) * 100}%` }}>
              <WindowWaveform data={sourcePeaks} from={windowStart} span={WINDOW_SECONDS + ahead} spans={sourceSpans} className="text-slate-400/30" />
            </div>
            </div>
            <span ref={playheadRef(0)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100 pointer-events-none" />
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
            {visible.map((u) =>
              u.placedStart === null || u.placedEnd === null ? null : (
                <span
                  key={u.index}
                  onMouseEnter={() => setHovered(u.index)}
                  onClick={seekLine(u.placedStart)}
                  title={`Line ${u.index + 1} · ${landedAs(u)}\n${u.text}`}
                  className={`absolute top-1 bottom-1 rounded transition-opacity ${dim(u) ? 'opacity-30' : ''}`}
                  style={{ left: `${pct(u.placedStart)}%`, width: `${Math.max(0.3, pct(u.placedEnd) - pct(u.placedStart))}%`, ...highlight(u, 'synth') }}
                />
              )
            )}
            <div className="absolute top-0 bottom-0 left-0" style={{ width: `${((WINDOW_SECONDS + ahead) / WINDOW_SECONDS) * 100}%` }}>
              <WindowWaveform data={dubPeaks} from={windowStart} span={WINDOW_SECONDS + ahead} spans={dubSpans} className="text-slate-400/30" />
            </div>
            </div>
            <span ref={playheadRef(2)} className="absolute top-0 bottom-0 w-px -ml-px bg-slate-100 pointer-events-none" />
          </div>

          {/* The scroll bar, along the foot of the lanes: the whole dub in its lines' colours */}
          <div className="border-r border-slate-800 bg-slate-900/80" />
          <div className="px-1 py-1 bg-slate-950/60">
            <TimelineScrollbar inset total={total} windowStart={zoom.viewStart()} windowSeconds={WINDOW_SECONDS} currentTime={currentTime} lines={overview} onScroll={scrollTo} />
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
            <span className="text-slate-400">One colour stacked straight is in sync. Hover a line to see how it landed.</span>
          </div>
        </details>
      </TimelineTransport>
    </div>
  );
};
