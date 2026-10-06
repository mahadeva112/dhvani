import React, { useEffect, useRef } from 'react';
import { MAX_DB, MIN_DB, TrackLevel } from './useTrackMixer';

/** Peak level shown on the meter: −48 dBFS at the left, 0 dBFS at the right. */
const METER_FLOOR_DB = -48;

const formatDb = (db: number) => (db <= MIN_DB ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`);

/** The track's level meter, redrawn every frame while playing without re-rendering. */
const LevelMeter: React.FC<{ getPeak?: () => number; isPlaying: boolean }> = ({ getPeak, isPlaying }) => {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const draw = (peak: number) => {
      const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
      const fill = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
      el.style.width = `${fill * 100}%`;
      el.style.backgroundColor = db > -1 ? '#fb7185' : db > -6 ? '#fbbf24' : '#34d399';
    };
    if (!isPlaying || !getPeak) {
      draw(0);
      return;
    }
    let frame = 0;
    // Falls back slowly, as a meter does, so short peaks stay readable.
    let shown = 0;
    const tick = () => {
      shown = Math.max(getPeak(), shown * 0.9);
      draw(shown);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getPeak, isPlaying]);
  return (
    <span className="relative block h-1 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
      <span ref={bar} className="absolute inset-y-0 left-0 w-0" />
    </span>
  );
};

/**
 * A track's header in a player: its name, mute (M), solo (S), a fader in dB
 * and a level meter. The levels are for listening only.
 */
export const TrackStrip: React.FC<{
  label: string;
  /** Tailwind background class for the track's colour square. */
  dot: string;
  level: TrackLevel;
  soloed: boolean;
  /** False when mute or another track's solo keeps this one from being heard. */
  heard: boolean;
  onLevelChange: (patch: Partial<TrackLevel>) => void;
  onSolo: () => void;
  getPeak?: () => number;
  isPlaying: boolean;
  /** Shown after the name, such as a lock. */
  badge?: React.ReactNode;
}> = ({ label, dot, level, soloed, heard, onLevelChange, onSolo, getPeak, isPlaying, badge }) => {
  const toggle = (on: boolean, onClass: string) =>
    `w-[22px] h-5 rounded-[5px] border text-[10.5px] font-semibold flex items-center justify-center cursor-pointer transition-colors ${
      on ? onClass : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100 hover:border-slate-500'
    }`;
  return (
    <div className="flex flex-col justify-center gap-1.5 min-w-0 w-full">
      <span className="flex items-center gap-1.5 text-[11.5px] text-slate-300 min-w-0">
        <span className={`w-2 h-2 rounded-sm shrink-0 ${dot}`} />
        <span className="truncate">{label}</span>
        {badge && <span className="ml-auto shrink-0 flex items-center">{badge}</span>}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={level.muted}
          aria-label={`Mute ${label}`}
          title="Mute"
          onClick={() => onLevelChange({ muted: !level.muted })}
          className={toggle(level.muted, 'border-rose-500 bg-rose-500 text-white')}
        >
          M
        </button>
        <button
          type="button"
          aria-pressed={soloed}
          aria-label={`Solo ${label}`}
          title="Solo: hear only this track"
          onClick={onSolo}
          className={toggle(soloed, 'border-amber-400 bg-amber-400 text-amber-950')}
        >
          S
        </button>
        <input
          type="range"
          min={MIN_DB}
          max={MAX_DB}
          step={0.5}
          value={level.db}
          aria-label={`${label} level`}
          aria-valuetext={formatDb(level.db)}
          title="Listening level. Double-click for 0 dB"
          onChange={(e) => onLevelChange({ db: Number(e.target.value), muted: false })}
          onDoubleClick={() => onLevelChange({ db: 0 })}
          className={`flex-1 min-w-0 h-1 accent-indigo-400 cursor-pointer transition-opacity ${heard ? '' : 'opacity-40'}`}
        />
        <span className="w-[3.25rem] text-right font-mono text-[10.5px] text-slate-400 tabular-nums">{formatDb(level.db)}</span>
      </span>
      <LevelMeter getPeak={getPeak} isPlaying={isPlaying && heard} />
    </div>
  );
};
