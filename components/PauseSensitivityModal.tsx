import React, { useRef } from 'react';
import { X, Info, Activity } from 'lucide-react';
import { getSensitivityProfile } from '../services/audioService';
import { AudioSegment } from '../types';
import { MiniWaveform } from './MediaStrip';

export interface PauseSensitivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  sensitivity: number;
  onSensitivityChange: (val: number) => void;
  segmentCount?: number;
  hasAudioBuffer?: boolean;
  /** The audio and its cues, to show where the cuts fall. */
  audioBuffer?: AudioBuffer | null;
  segments?: AudioSegment[];
}

const LOOKS = [
  { value: 20, label: 'Long pauses', hint: 'over 400 ms' },
  { value: 50, label: 'Natural', hint: 'about 130 ms' },
  { value: 72, label: 'Quick speech', hint: 'about 90 ms' },
  { value: 90, label: 'Every breath', hint: 'about 50 ms' },
];

export const PauseSensitivityModal: React.FC<PauseSensitivityModalProps> = ({
  isOpen,
  onClose,
  sensitivity = 50,
  onSensitivityChange,
  segmentCount = 0,
  hasAudioBuffer = false,
  audioBuffer = null,
  segments = [],
}) => {
  // The count when the window opened, taken on the render that opens it, so the change is shown against it.
  const openedWith = useRef(segmentCount);
  const wasOpen = useRef(false);
  if (isOpen && !wasOpen.current) openedWith.current = segmentCount;
  wasOpen.current = isOpen;

  if (!isOpen) return null;

  const profile = getSensitivityProfile(sensitivity);
  const silenceDb = Math.round(20 * Math.log10(Math.max(0.0001, profile.silenceThreshold)));
  const delta = segmentCount - openedWith.current;
  const total = audioBuffer?.duration || segments[segments.length - 1]?.endTime || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        className="w-full max-w-[38.75rem] min-h-full sm:min-h-0 sm:my-auto flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <Activity className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="pause-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Pause detection
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">How long a pause has to be before the talk is split into a new cue.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 flex flex-col gap-4">
          {hasAudioBuffer && (
            <>
              <div className="flex items-baseline gap-2.5" aria-live="polite">
                <span className="text-[30px] font-semibold text-slate-100 tabular-nums leading-none">{segmentCount}</span>
                <span className="text-[13px] text-slate-400">cues</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
                  {delta === 0 ? 'same as before' : `${delta > 0 ? '+' : ''}${delta} from before`}
                </span>
              </div>

              {/* Where the cuts fall: the waveform with a mark at each cue's start */}
              {audioBuffer && total > 0 && (
                <div className="relative h-[70px] rounded-[10px] bg-slate-950/60 overflow-hidden" aria-hidden="true">
                  <div className="absolute inset-x-0 top-2 bottom-2">
                    <MiniWaveform buffer={audioBuffer} className="text-cyan-400/70" />
                  </div>
                  {segments.slice(1).map((seg) => (
                    <span
                      key={seg.id}
                      className="absolute top-0 bottom-0 w-0.5 bg-indigo-400"
                      style={{ left: `${(seg.startTime / total) * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          <div role="group" aria-label="Starting points" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {LOOKS.map((look) => {
              const on = sensitivity === look.value;
              return (
                <button
                  key={look.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSensitivityChange(look.value)}
                  className={`flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-[10px] border text-left transition-colors cursor-pointer ${
                    on ? 'border-indigo-500 ring-4 ring-indigo-500/10 bg-indigo-950/40' : 'border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <span className="text-[12.5px] font-semibold text-slate-100">{look.label}</span>
                  <span className="text-[11px] text-slate-400">{look.hint}</span>
                </button>
              );
            })}
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="pause-sensitivity" className="text-[13px] font-semibold text-slate-100">
                Sensitivity
              </label>
              <span className="font-mono text-xs text-slate-100 tabular-nums">{sensitivity}</span>
            </div>
            <p className="text-[11.5px] text-slate-400 mt-0.5 mb-2">Lower makes fewer, longer cues. Higher splits at shorter pauses.</p>
            <input
              id="pause-sensitivity"
              type="range"
              min={0}
              max={100}
              step={1}
              value={sensitivity}
              onChange={(e) => onSensitivityChange(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10.5px] text-slate-500 mt-0.5">
              <span>Fewer, longer cues</span>
              <span>More, shorter cues</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['Shortest pause', `${Math.round(profile.minSilenceDuration * 1000)} ms`],
              ['Silence below', `${silenceDb} dB`],
              ['Shortest cue', `${profile.minSpeechDuration.toFixed(2)} s`],
            ].map(([k, v]) => (
              <div key={k} className="px-2.5 py-2 rounded-[10px] bg-slate-950/60 border border-slate-800">
                <span className="block text-[11px] text-slate-500">{k}</span>
                <span className="block font-mono text-[13px] text-slate-100 tabular-nums">{v}</span>
              </div>
            ))}
          </div>

          <p className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] border border-dashed border-slate-700 text-xs text-slate-400 leading-relaxed">
            <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
            {hasAudioBuffer
              ? 'Moving the slider re-splits the cues straight away. Text already in a cue is carried over to the new cues where it lines up.'
              : 'Add an audio or video file first. The cues are split from its audio.'}
          </p>
        </div>

        <div className="flex items-center gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-800">
          <button
            type="button"
            onClick={() => onSensitivityChange(50)}
            disabled={sensitivity === 50}
            className="text-[12.5px] text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-default px-1 cursor-pointer"
          >
            Reset to natural
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-[38px] px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </section>
    </div>
  );
};
