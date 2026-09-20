import React, { useState, useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  RefreshCw,
  Check,
  RotateCcw,
  Sliders,
  HelpCircle,
  FileText,
  Mic,
  Languages,
  CheckCircle2,
  Tag,
  BookOpen,
} from 'lucide-react';
import {
  TRANSLATION_PRESETS,
  QUICK_PROMPT_TAGS,
  TranslationPromptPreset,
  getPresetById,
  DEFAULT_PROMPT_PRESET_ID,
} from '../services/translationPromptPresets';
import { AudioSegment } from '../types';

interface TranslationPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPrompt: string;
  currentPresetId: string;
  targetLanguage: string;
  hasActiveSegments: boolean;
  hasAudioFile: boolean;
  onSavePrompt: (prompt: string, presetId: string) => void;
  onRetranslateSegments?: (prompt: string) => Promise<void>;
  onRetranscribeAudio?: (prompt: string) => Promise<void>;
  isTranslating?: boolean;
}

export const TranslationPromptModal: React.FC<TranslationPromptModalProps> = ({
  isOpen,
  onClose,
  currentPrompt,
  currentPresetId,
  targetLanguage,
  hasActiveSegments,
  hasAudioFile,
  onSavePrompt,
  onRetranslateSegments,
  onRetranscribeAudio,
  isTranslating = false,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(currentPresetId || DEFAULT_PROMPT_PRESET_ID);
  const [promptText, setPromptText] = useState<string>(currentPrompt || '');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isProcessingAudio, setIsProcessingAudio] = useState<boolean>(false);

  // Sync state on open
  useEffect(() => {
    if (isOpen) {
      setSelectedPresetId(currentPresetId || DEFAULT_PROMPT_PRESET_ID);
      setPromptText(currentPrompt || getPresetById(currentPresetId || DEFAULT_PROMPT_PRESET_ID).prompt);
      setSuccessNotice(null);
    }
  }, [isOpen, currentPrompt, currentPresetId]);

  if (!isOpen) return null;

  const currentPreset = getPresetById(selectedPresetId);

  const handleSelectPreset = (preset: TranslationPromptPreset) => {
    setSelectedPresetId(preset.id);
    setPromptText(preset.prompt);
  };

  const handleInsertTag = (tagText: string) => {
    setPromptText((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}\n${tagText}` : tagText;
    });
  };

  const handleResetToPreset = () => {
    const preset = getPresetById(selectedPresetId);
    setPromptText(preset.prompt);
    setSuccessNotice(`Reset to "${preset.name}" default instructions`);
    setTimeout(() => setSuccessNotice(null), 2500);
  };

  const handleSaveOnly = () => {
    onSavePrompt(promptText, selectedPresetId);
    setSuccessNotice('Prompt instructions saved successfully!');
    setTimeout(() => {
      setSuccessNotice(null);
      onClose();
    }, 1200);
  };

  const handleApplyAndRetranslate = async () => {
    onSavePrompt(promptText, selectedPresetId);
    if (onRetranslateSegments) {
      try {
        await onRetranslateSegments(promptText);
        setSuccessNotice(`Successfully re-translated cues in ${targetLanguage}!`);
        setTimeout(() => {
          setSuccessNotice(null);
          onClose();
        }, 1500);
      } catch (err: any) {
        console.warn('Retranslation notice:', err);
      }
    }
  };

  const handleApplyAndRetranscribe = async () => {
    onSavePrompt(promptText, selectedPresetId);
    if (onRetranscribeAudio) {
      setIsProcessingAudio(true);
      try {
        await onRetranscribeAudio(promptText);
        setSuccessNotice(`Audio re-transcribed & translated in ${targetLanguage}!`);
        setTimeout(() => {
          setSuccessNotice(null);
          onClose();
        }, 1500);
      } catch (err: any) {
        console.warn('Retranscribe notice:', err);
      } finally {
        setIsProcessingAudio(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        className="w-full max-w-3xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/80 flex items-center justify-center shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h2 id="prompt-modal-title" className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2 font-display">
                <span>Custom Translation Prompt</span>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">
                  {targetLanguage}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Change tone, persona, vocabulary rules, or pacing constraints for AI translation & review.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center border border-slate-200 dark:border-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {/* Preset Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>Translation Presets & Persona</span>
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Click a preset to load base instructions</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TRANSLATION_PRESETS.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`p-2.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 dark:bg-indigo-950/80 border-indigo-500 shadow-sm text-indigo-950 dark:text-white ring-1 ring-indigo-500'
                        : 'bg-slate-50 dark:bg-slate-950/80 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-bold leading-tight">{preset.name}</span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                          isSelected
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
                        }`}
                      >
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {preset.shortDesc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preset Info Banner */}
          <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800/50 flex items-start gap-2.5 text-xs text-indigo-900 dark:text-indigo-200">
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-[11px]">
              <span className="font-semibold text-indigo-950 dark:text-white">{currentPreset.name}: </span>
              <span className="text-indigo-800 dark:text-indigo-200/90">{currentPreset.shortDesc}. You can freely customize the instructions below.</span>
            </div>
          </div>

          {/* Quick Directive Tags */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <Tag className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>Quick Constraints (Click to append):</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPT_TAGS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleInsertTag(item.tag)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-cyan-700 dark:hover:text-cyan-300 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/50 transition-all active:scale-95 cursor-pointer"
                  title="Click to insert this rule into prompt"
                >
                  + {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="translation-prompt-textarea" className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                <span>Active Translation Directive & Persona</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToPreset}
                  className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Reset instructions back to preset default"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Preset</span>
                </button>
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                  {promptText.length} chars
                </span>
              </div>
            </div>

            <div className="relative">
              <textarea
                id="translation-prompt-textarea"
                rows={9}
                value={promptText}
                onChange={(e) => {
                  setPromptText(e.target.value);
                  if (selectedPresetId !== 'custom') {
                    setSelectedPresetId('custom');
                  }
                }}
                placeholder="Enter custom instructions, tone guidelines, prohibited vocabulary, or formatting rules for translating speech into the target language..."
                className="w-full rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700/90 focus:border-indigo-500 p-3.5 text-xs font-mono text-slate-900 dark:text-slate-200 leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500/50 shadow-inner custom-scrollbar"
              />
            </div>
          </div>

          {/* Success Notice Notification */}
          {successNotice && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-500/70 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSaveOnly}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 text-xs font-semibold transition-all cursor-pointer"
          >
            Save Prompt for Later
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Re-transcribe Audio Button if raw audio exists */}
            {hasAudioFile && onRetranscribeAudio && (
              <button
                type="button"
                onClick={handleApplyAndRetranscribe}
                disabled={isProcessingAudio || isTranslating}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-cyan-700 dark:text-cyan-300 hover:text-cyan-800 dark:hover:text-cyan-200 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Re-run speech recognition & translation from the original audio using this prompt"
              >
                {isProcessingAudio ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-600 dark:text-cyan-400" />
                ) : (
                  <Mic className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                )}
                <span>Re-Transcribe Audio with Prompt</span>
              </button>
            )}

            {/* Re-translate Dialogue Cues if cues already exist */}
            {hasActiveSegments && onRetranslateSegments && (
              <button
                type="button"
                onClick={handleApplyAndRetranslate}
                disabled={isTranslating || isProcessingAudio}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Translate all dialogue cues again using this custom prompt"
              >
                {isTranslating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                ) : (
                  <Languages className="w-3.5 h-3.5 text-white" />
                )}
                <span>
                  {isTranslating ? 'Re-Translating Dialogue...' : 'Apply & Re-Translate Dialogue Cues'}
                </span>
              </button>
            )}

            {!hasActiveSegments && (
              <button
                type="button"
                onClick={handleSaveOnly}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition-all active:scale-95 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save & Set Active Prompt</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
