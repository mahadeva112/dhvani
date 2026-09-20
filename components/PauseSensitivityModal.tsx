import React from 'react';
import { Sliders, X, Check, Activity, Info } from 'lucide-react';
import { PauseSensitivityControl } from './PauseSensitivityControl';

export interface PauseSensitivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  sensitivity: number;
  onSensitivityChange: (val: number) => void;
  segmentCount?: number;
  hasAudioBuffer?: boolean;
}

export const PauseSensitivityModal: React.FC<PauseSensitivityModalProps> = ({
  isOpen,
  onClose,
  sensitivity = 50,
  onSensitivityChange,
  segmentCount = 0,
  hasAudioBuffer = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shrink-0 shadow-xs">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white font-display">
                  Pause Detection Sensitivity
                </h3>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                  VAD Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Control how silence and pause thresholds split speech dialogue into cues
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          <PauseSensitivityControl
            sensitivity={sensitivity}
            onChange={onSensitivityChange}
            segmentCount={segmentCount}
            onResetDefault={() => onSensitivityChange(50)}
          />

          {/* Context tip */}
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-200/90 leading-relaxed">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-cyan-300">Live Re-segmentation: </span>
              {hasAudioBuffer
                ? 'Adjusting this slider dynamically recalculates dialogue cues in real time while preserving any existing translations and text edits.'
                : 'Upload an audio or video file in the studio to preview and re-segment cues instantly as you move the slider.'}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <button
            type="button"
            onClick={() => onSensitivityChange(50)}
            className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors font-medium"
          >
            Reset to Default (50%)
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer flex items-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Apply & Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
