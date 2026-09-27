import React from 'react';
import { getSensitivityProfile } from '../services/audioService';

export interface PauseSensitivityControlProps {
  sensitivity: number; // 0 to 100
  onChange: (value: number) => void;
  segmentCount?: number;
  /** Kept for callers; there is one layout now, sized for a side panel. */
  variant?: 'card' | 'compact' | 'popover';
  disabled?: boolean;
}

/**
 * The pause-detection slider as it sits in the review panel: the value, what
 * it means in milliseconds, and how many cues it currently makes. The full
 * window with starting points is PauseSensitivityModal.
 */
export const PauseSensitivityControl: React.FC<PauseSensitivityControlProps> = ({
  sensitivity = 50,
  onChange,
  segmentCount,
  disabled = false,
}) => {
  const profile = getSensitivityProfile(sensitivity);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="pause-control" className="text-[13px] font-semibold text-slate-100">
          Pause detection
        </label>
        <span className="font-mono text-xs text-slate-400 tabular-nums">
          {Math.round(profile.minSilenceDuration * 1000)} ms
          {segmentCount !== undefined && <span className="text-slate-500"> · {segmentCount} cues</span>}
        </span>
      </div>
      <input
        id="pause-control"
        type="range"
        min={0}
        max={100}
        step={1}
        value={sensitivity}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        aria-valuetext={`${sensitivity}, pauses of ${Math.round(profile.minSilenceDuration * 1000)} milliseconds`}
      />
      <div className="flex justify-between text-[10.5px] text-slate-500">
        <span>Fewer, longer cues</span>
        <span>More, shorter cues</span>
      </div>
    </div>
  );
};
