import React from 'react';
import { SlidersHorizontal, Edit3, Sliders, RefreshCw, Languages, Check } from 'lucide-react';
import {
  TRANSLATION_PRESETS,
  TranslationPromptPreset,
  getPresetById,
} from '../services/translationPromptPresets';

interface TranslationPromptCardProps {
  currentPrompt: string;
  currentPresetId: string;
  onSelectPreset: (preset: TranslationPromptPreset) => void;
  onOpenPromptModal: () => void;
  targetLanguage: string;
  hasSegments?: boolean;
  onRetranslate?: () => void;
  isTranslating?: boolean;
  isCompact?: boolean;
}

export const TranslationPromptCard: React.FC<TranslationPromptCardProps> = ({
  currentPrompt,
  currentPresetId,
  onSelectPreset,
  onOpenPromptModal,
  targetLanguage,
  hasSegments = false,
  onRetranslate,
  isTranslating = false,
  isCompact = false,
}) => {
  const activePreset = getPresetById(currentPresetId);

  return (
    <div className="w-full max-w-2xl mx-auto bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 rounded-2xl shadow-xs space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/30 shrink-0">
            <SlidersHorizontal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200">
                Custom Translation Prompt & Persona
              </h4>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 border border-indigo-300 dark:border-indigo-700/60 text-indigo-700 dark:text-indigo-300">
                {activePreset.name}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              Direct how speech is adapted and translated into {targetLanguage}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenPromptModal}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 border border-slate-300 dark:border-slate-700/80 text-xs font-semibold shadow-2xs transition-all active:scale-95 cursor-pointer"
            title="Edit prompt instructions, constraints & presets"
          >
            <Edit3 className="w-3 h-3 text-indigo-500 dark:text-indigo-400" />
            <span>Customize Prompt</span>
          </button>

          {hasSegments && onRetranslate && (
            <button
              type="button"
              onClick={onRetranslate}
              disabled={isTranslating}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Re-translate all dialogue cues with active prompt"
            >
              {isTranslating ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Languages className="w-3 h-3" />
              )}
              <span>{isTranslating ? 'Translating...' : 'Re-Translate'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Preset Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
        {TRANSLATION_PRESETS.map((preset) => {
          const isSelected = currentPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectPreset(preset)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800'
              }`}
            >
              {preset.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
