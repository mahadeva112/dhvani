import React from 'react';
import { UnfoldVertical } from 'lucide-react';
import { nextWaveHeight, setWaveHeight, useWaveHeight } from './waveHeight';

/** Steps the Wave height ×1 → ×2 → ×4 → ×1 for every editing wave in the app; the audio is untouched. */
export const WaveHeightButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const height = useWaveHeight();
  const raised = height > 1;
  return (
    <button
      type="button"
      onClick={() => setWaveHeight(nextWaveHeight(height))}
      aria-label={`Wave height ×${height}`}
      title="Wave height: draws quiet audio taller (×1, ×2, ×4). Only the picture changes, not the sound."
      className={`h-[30px] px-2 flex items-center gap-1 rounded-lg border font-mono text-[11px] tabular-nums transition-colors cursor-default ${
        raised ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300' : 'border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800'
      } ${className}`}
    >
      <UnfoldVertical className="w-3.5 h-3.5" />×{height}
    </button>
  );
};
