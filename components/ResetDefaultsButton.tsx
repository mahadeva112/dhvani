import React from 'react';
import { RotateCcw } from 'lucide-react';

interface ResetDefaultsButtonProps {
  onClick: () => void;
  /** Off when the settings already are the defaults, or while a dub runs. */
  disabled?: boolean;
  label?: string;
}

/** Icon button that puts the voice settings back to ElevenLabs' own defaults. */
export const ResetDefaultsButton: React.FC<ResetDefaultsButtonProps> = ({
  onClick,
  disabled = false,
  label = 'Reset to ElevenLabs defaults',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className="w-7 h-7 inline-flex items-center justify-center rounded-lg shrink-0 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-slate-400 cursor-pointer transition-colors"
  >
    <RotateCcw className="w-3.5 h-3.5" />
  </button>
);
