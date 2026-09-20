import React, { useMemo } from 'react';
import { Sliders, Activity, HelpCircle, Check, Gauge } from 'lucide-react';
import { getSensitivityProfile, SensitivityProfile } from '../services/audioService';

export interface PauseSensitivityControlProps {
  sensitivity: number; // 0 to 100
  onChange: (value: number) => void;
  segmentCount?: number;
  variant?: 'card' | 'compact' | 'popover';
  disabled?: boolean;
  onResetDefault?: () => void;
}

export const PRESET_OPTIONS = [
  { value: 20, label: 'Coarse', desc: 'Long pauses (>400ms)' },
  { value: 50, label: 'Balanced', desc: 'Natural dialogue (~130ms)' },
  { value: 72, label: 'Sensitive', desc: 'Fast cadence (~90ms)' },
  { value: 90, label: 'Micro', desc: 'Fine cuts & breaths (~50ms)' },
];

export const PauseSensitivityControl: React.FC<PauseSensitivityControlProps> = ({
  sensitivity = 50,
  onChange,
  segmentCount,
  variant = 'card',
  disabled = false,
  onResetDefault,
}) => {
  const profile: SensitivityProfile = useMemo(() => {
    return getSensitivityProfile(sensitivity);
  }, [sensitivity]);

  // Format dB approx from amplitude
  const thresholdDb = useMemo(() => {
    const db = 20 * Math.log10(Math.max(0.0001, profile.silenceThreshold));
    return Math.round(db);
  }, [profile.silenceThreshold]);

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold px-1">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Pause Sensitivity:</span>
          <span className="font-mono text-cyan-300 font-bold">{sensitivity}%</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={sensitivity}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 sm:w-28 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-50"
          title={`Sensitivity: ${sensitivity}% - ${profile.label}`}
        />

        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
          {Math.round(profile.minSilenceDuration * 1000)}ms
        </span>

        {segmentCount !== undefined && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 font-bold">
            {segmentCount} Cues
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 hover:border-cyan-800/60 p-4 sm:p-5 rounded-2xl space-y-4 shadow-sm transition-all">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shrink-0 shadow-xs">
            <Sliders className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-100 font-display">
                Dialogue Pause Detection Sensitivity
              </h4>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                VAD Threshold
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Adjust how aggressively silent pauses split your dialogue into separate cues
            </p>
          </div>
        </div>

        {/* Right Info Badges */}
        <div className="flex items-center gap-2">
          {segmentCount !== undefined && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-xs font-mono font-bold shadow-xs">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>{segmentCount} Dialogue Segments</span>
            </div>
          )}

          {sensitivity !== 50 && onResetDefault && (
            <button
              type="button"
              onClick={onResetDefault}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"
              title="Reset sensitivity to default 50%"
            >
              Reset (50%)
            </button>
          )}
        </div>
      </div>

      {/* Main Slider Row */}
      <div className="space-y-2 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-medium flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sensitivity Level:</span>
            <span className="font-mono font-bold text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/50">
              {sensitivity}%
            </span>
          </span>

          <span className="font-semibold text-slate-200 text-[11px] flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block animate-pulse" />
            {profile.label}
          </span>
        </div>

        {/* The Range Slider */}
        <div className="relative pt-1 pb-1">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={sensitivity}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-50 transition-all"
            style={{
              background: `linear-gradient(to right, #0284c7 0%, #06b6d4 ${sensitivity}%, #334155 ${sensitivity}%, #334155 100%)`,
            }}
          />

          {/* Track markers */}
          <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1 px-1">
            <span>0% (Coarse / Long)</span>
            <span>50% (Default)</span>
            <span>100% (Micro-Pauses)</span>
          </div>
        </div>

        {/* Dynamic Explanation Description */}
        <p className="text-xs text-slate-300/90 pt-1 border-t border-slate-800/60 leading-relaxed">
          {profile.description}
        </p>
      </div>

      {/* Quick Presets & Acoustic Threshold Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Quick Threshold Presets
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESET_OPTIONS.map((preset) => {
              const isSelected = Math.abs(sensitivity - preset.value) <= 6;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onChange(preset.value)}
                  disabled={disabled}
                  className={`px-2.5 py-2 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-center ${
                    isSelected
                      ? 'bg-cyan-950/80 border-cyan-500 text-white shadow-xs'
                      : 'bg-slate-950 hover:bg-slate-850 border-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{preset.label}</span>
                    <span className="text-[10px] font-mono text-cyan-400">{preset.value}%</span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate mt-0.5">
                    {preset.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Acoustic Metrics Readout */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Calculated VAD Metrics
          </span>
          <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-2.5 space-y-1.5 text-xs font-mono">
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-400">Min Pause Cutoff:</span>
              <span className="text-cyan-300 font-bold">
                {Math.round(profile.minSilenceDuration * 1000)} ms
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-400">Silence Floor:</span>
              <span className="text-slate-200">
                {profile.silenceThreshold.toFixed(4)} ({thresholdDb} dB)
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-slate-400">Min Word Duration:</span>
              <span className="text-slate-200">
                {Math.round(profile.minSpeechDuration * 1000)} ms
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
