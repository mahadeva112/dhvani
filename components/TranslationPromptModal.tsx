import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Mic, Languages, AlignLeft, Zap, BookmarkPlus, Pencil, Trash2 } from 'lucide-react';
import {
  TRANSLATION_PRESETS,
  QUICK_PROMPT_TAGS,
  TranslationPromptPreset,
  getPresetById,
  DEFAULT_PROMPT_PRESET_ID,
  SAVED_PROMPT_ID_PREFIX,
} from '../services/translationPromptPresets';
import {
  SavedTranslationPrompt,
  loadSavedPrompts,
  saveNamedPrompt,
  updateSavedPromptText,
  renameSavedPrompt,
  deleteSavedPrompt,
} from '../services/savedTranslationPrompts';
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
  /** `fast` is Fast translate: translation only, no meaning, length or term checks. */
  onRetranslateSegments?: (prompt: string, options?: { fast?: boolean }) => Promise<void>;
  onRetranscribeAudio?: (prompt: string) => Promise<void>;
  isTranslating?: boolean;
  /** How many cues and how much audio a re-run would cover, for the buttons' wording. */
  segmentCount?: number;
  audioDuration?: number;
}

const applyCard =
  'text-left p-3 rounded-[11px] border border-slate-800 hover:bg-slate-800/50 hover:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-default';

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
  segmentCount = 0,
  audioDuration = 0,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(currentPresetId || DEFAULT_PROMPT_PRESET_ID);
  const [promptText, setPromptText] = useState<string>(currentPrompt || '');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isProcessingAudio, setIsProcessingAudio] = useState<boolean>(false);
  /** Which re-translate button the running translation came from, for its spinner. */
  const [fastRunning, setFastRunning] = useState(false);
  /** The user's own named prompts, which no app update changes. */
  const [savedPrompts, setSavedPrompts] = useState<SavedTranslationPrompt[]>([]);
  const [saveName, setSaveName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Sync state on open
  useEffect(() => {
    if (isOpen) {
      setSelectedPresetId(currentPresetId || DEFAULT_PROMPT_PRESET_ID);
      setPromptText(currentPrompt || getPresetById(currentPresetId || DEFAULT_PROMPT_PRESET_ID).prompt);
      setSuccessNotice(null);
      setSavedPrompts(loadSavedPrompts());
      setSaveName('');
      setRenaming(null);
      setConfirmDeleteId(null);
    }
  }, [isOpen, currentPrompt, currentPresetId]);

  if (!isOpen) return null;

  const currentPreset = getPresetById(selectedPresetId);
  const isSavedChoice = selectedPresetId.startsWith(SAVED_PROMPT_ID_PREFIX);
  const selectedSaved = savedPrompts.find((p) => p.id === selectedPresetId);
  // A saved prompt from a project made on another computer keeps the project's text.
  const baseName = isSavedChoice ? selectedSaved?.name || 'Your saved prompt' : currentPreset.name;
  const baseText = isSavedChoice ? selectedSaved?.prompt ?? currentPrompt : currentPreset.prompt;

  const flash = (notice: string) => {
    setSuccessNotice(notice);
    setTimeout(() => setSuccessNotice(null), 2500);
  };

  const handleSelectPreset = (preset: TranslationPromptPreset) => {
    setSelectedPresetId(preset.id);
    setPromptText(preset.prompt);
  };

  const handleSelectSaved = (saved: SavedTranslationPrompt) => {
    setSelectedPresetId(saved.id);
    setPromptText(saved.prompt);
  };

  /** Makes this text the style in use; edits to a saved prompt are written back into it. */
  const commitPrompt = () => {
    if (selectedSaved && promptText !== selectedSaved.prompt) {
      setSavedPrompts(updateSavedPromptText(selectedSaved.id, promptText));
    }
    onSavePrompt(promptText, selectedPresetId);
  };

  const handleSaveAs = () => {
    const name = saveName.trim();
    if (!name || !promptText.trim()) return;
    const { list, saved, replaced } = saveNamedPrompt(name, promptText);
    setSavedPrompts(list);
    setSelectedPresetId(saved.id);
    onSavePrompt(promptText, saved.id);
    setSaveName('');
    flash(replaced ? `Updated "${saved.name}"` : `Saved as "${saved.name}"`);
  };

  const handleRename = () => {
    if (!renaming) return;
    const list = renameSavedPrompt(renaming.id, renaming.name);
    if (!list) {
      flash(renaming.name.trim() ? `Another prompt is already called "${renaming.name.trim()}"` : 'A name is needed');
      return;
    }
    setSavedPrompts(list);
    setRenaming(null);
  };

  const handleDelete = (saved: SavedTranslationPrompt) => {
    if (confirmDeleteId !== saved.id) {
      setConfirmDeleteId(saved.id);
      return;
    }
    setSavedPrompts(deleteSavedPrompt(saved.id));
    setConfirmDeleteId(null);
    // The text stays in the box, now as custom instructions.
    if (selectedPresetId === saved.id) setSelectedPresetId('custom');
    flash(`Deleted "${saved.name}"`);
  };

  const handleInsertTag = (tagText: string) => {
    setPromptText((prev) => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}\n${tagText}` : tagText;
    });
  };

  const handleResetToPreset = () => {
    setPromptText(baseText);
    flash(isSavedChoice ? `Back to the saved text of "${baseName}"` : `Back to ${baseName}'s own text`);
  };

  const handleSaveOnly = () => {
    commitPrompt();
    setSuccessNotice('Saved');
    setTimeout(() => {
      setSuccessNotice(null);
      onClose();
    }, 1200);
  };

  const handleApplyAndRetranslate = async ({ fast = false }: { fast?: boolean } = {}) => {
    commitPrompt();
    if (onRetranslateSegments) {
      setFastRunning(fast);
      try {
        await onRetranslateSegments(promptText, { fast });
        setSuccessNotice(`Re-translated in ${targetLanguage}`);
        setTimeout(() => {
          setSuccessNotice(null);
          onClose();
        }, 1500);
      } catch (err: any) {
        console.warn('Retranslation notice:', err);
      } finally {
        setFastRunning(false);
      }
    }
  };

  const handleApplyAndRetranscribe = async () => {
    commitPrompt();
    if (onRetranscribeAudio) {
      setIsProcessingAudio(true);
      try {
        await onRetranscribeAudio(promptText);
        setSuccessNotice('Transcribed again. Choose translate or your own script next.');
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

  const edited = promptText.trim() !== baseText.trim();
  const busy = isTranslating || isProcessingAudio;
  const cueText = segmentCount > 0 ? `${segmentCount} ${segmentCount === 1 ? 'cue' : 'cues'}` : 'the cues';
  const lengthText = audioDuration > 0
    ? `${Math.floor(audioDuration / 60)}:${String(Math.round(audioDuration % 60)).padStart(2, '0')}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        className="relative w-full max-w-[60rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <AlignLeft className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="prompt-modal-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Translation style
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              How the {targetLanguage} should sound. It's sent with every cue the engine translates.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0 cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Styles */}
          <div role="radiogroup" aria-label="Style" className="px-3.5 py-3.5 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/40 flex flex-col gap-1.5">
            {TRANSLATION_PRESETS.map((preset) => {
              const on = preset.id === selectedPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => handleSelectPreset(preset)}
                  className={`flex items-start gap-2.5 p-2.5 rounded-[11px] border text-left transition-colors cursor-default ${
                    on ? 'border-indigo-500 ring-4 ring-indigo-500/10 bg-slate-900' : 'border-slate-800 bg-slate-900 hover:bg-slate-800/60'
                  }`}
                >
                  <span className={`w-[15px] h-[15px] mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${on ? 'border-indigo-400' : 'border-slate-600'}`}>
                    {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-slate-100">
                      {preset.name}
                      <span
                        className={`text-[10.5px] font-semibold px-1.5 py-px rounded-full ${
                          preset.badge === 'Recommended' ? 'bg-indigo-500/15 text-indigo-300' : 'border border-slate-700 text-slate-400'
                        }`}
                      >
                        {preset.badge}
                      </span>
                    </span>
                    <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{preset.shortDesc}</span>
                  </span>
                </button>
              );
            })}

            <span className="mt-2 px-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Your prompts</span>
            {savedPrompts.length === 0 && (
              <p className="px-1 text-[11.5px] text-slate-500 leading-snug">
                Save the instructions under your own name. App updates never change them.
              </p>
            )}
            {savedPrompts.map((saved) => {
              const on = saved.id === selectedPresetId;
              const firstLine = saved.prompt.trim().split('\n')[0];
              if (renaming?.id === saved.id) {
                return (
                  <div key={saved.id} className="flex items-center gap-1.5 p-2 rounded-[11px] border border-indigo-500 bg-slate-900">
                    <input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: saved.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      aria-label="New name"
                      className="flex-1 min-w-0 h-7 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-md px-2 text-[12.5px] text-slate-100 focus:outline-none"
                    />
                    <button type="button" onClick={handleRename} className="h-7 px-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11.5px] font-semibold cursor-default">
                      Rename
                    </button>
                  </div>
                );
              }
              return (
                <div
                  key={saved.id}
                  className={`group flex items-start rounded-[11px] border transition-colors ${
                    on ? 'border-indigo-500 ring-4 ring-indigo-500/10 bg-slate-900' : 'border-slate-800 bg-slate-900 hover:bg-slate-800/60'
                  }`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => handleSelectSaved(saved)}
                    className="flex-1 min-w-0 flex items-start gap-2.5 p-2.5 text-left cursor-default"
                  >
                    <span className={`w-[15px] h-[15px] mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${on ? 'border-indigo-400' : 'border-slate-600'}`}>
                      {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-slate-100 truncate">{saved.name}</span>
                      <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug truncate">{firstLine || 'No instructions'}</span>
                    </span>
                  </button>
                  <span className="flex items-center gap-0.5 p-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        setRenaming({ id: saved.id, name: saved.name });
                      }}
                      title="Rename"
                      aria-label={`Rename ${saved.name}`}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-default"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(saved)}
                      onBlur={() => setConfirmDeleteId((id) => (id === saved.id ? null : id))}
                      title={confirmDeleteId === saved.id ? 'Click again to delete' : 'Delete'}
                      aria-label={confirmDeleteId === saved.id ? `Click again to delete ${saved.name}` : `Delete ${saved.name}`}
                      className={`h-6 flex items-center justify-center rounded-md cursor-default ${
                        confirmDeleteId === saved.id
                          ? 'px-1.5 bg-red-500/15 text-red-300 text-[11px] font-semibold'
                          : 'w-6 text-slate-500 hover:text-red-300 hover:bg-slate-800'
                      }`}
                    >
                      {confirmDeleteId === saved.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Instructions */}
          <div className="px-5 sm:px-6 py-4 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="prompt-text" className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                Instructions
              </label>
              <span className="text-[11.5px] text-slate-400">
                {baseName}, {edited ? 'edited' : 'unchanged'}
              </span>
            </div>
            <textarea
              id="prompt-text"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={9}
              placeholder="Tone, words to use or avoid, names to keep, how long lines should be…"
              className="w-full min-h-[13rem] resize-y bg-slate-950/60 border border-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Add a rule</span>
              <span className="text-[11.5px] text-slate-400">Click to add it to the end</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPT_TAGS.map((item) => {
                const added = promptText.includes(item.tag.trim());
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => !added && handleInsertTag(item.tag)}
                    disabled={added}
                    className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors cursor-default ${
                      added
                        ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    {added ? '✓' : '+'} {item.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 mt-1">
              <label htmlFor="prompt-save-name" className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                Save as your own prompt
              </label>
              <span className="text-[11.5px] text-slate-400">Kept on this computer; updates never change it</span>
            </div>
            <div className="flex gap-2">
              <input
                id="prompt-save-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveAs()}
                placeholder="Name, e.g. Bengali talks"
                maxLength={60}
                className="flex-1 min-w-0 h-[34px] bg-slate-950/60 border border-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 rounded-[10px] px-3 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveAs}
                disabled={!saveName.trim() || !promptText.trim() || busy}
                className="h-[34px] px-3.5 inline-flex items-center gap-1.5 rounded-[10px] border border-slate-700 text-[12.5px] font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40 cursor-default"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                {savedPrompts.some((p) => p.name.trim().toLocaleLowerCase() === saveName.trim().toLocaleLowerCase()) ? 'Update' : 'Save as'}
              </button>
            </div>

            {(hasActiveSegments && onRetranslateSegments) || (hasAudioFile && onRetranscribeAudio) ? (
              <>
                <span className="mt-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Save and apply</span>
                <div className="grid sm:grid-cols-2 gap-2">
                  {hasActiveSegments && onRetranslateSegments && (
                    <button type="button" onClick={() => void handleApplyAndRetranslate()} disabled={busy} className={applyCard}>
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
                        {isTranslating && !fastRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5 text-slate-400" />}
                        {isTranslating && !fastRunning ? 'Re-translating…' : `Re-translate the ${cueText}`}
                      </span>
                      <span className="block text-[11.5px] text-slate-400 mt-1 leading-snug">
                        Keeps the English and its timing; only the {targetLanguage} is written again.
                      </span>
                      <span className="block text-[10.5px] text-amber-300 mt-1.5">Uses your translation engine</span>
                    </button>
                  )}
                  {hasActiveSegments && onRetranslateSegments && (
                    <button type="button" onClick={() => void handleApplyAndRetranslate({ fast: true })} disabled={busy} className={applyCard}>
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
                        {isTranslating && fastRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-slate-400" />}
                        {isTranslating && fastRunning ? 'Fast re-translating…' : `Fast re-translate the ${cueText}`}
                      </span>
                      <span className="block text-[11.5px] text-slate-400 mt-1 leading-snug">
                        Translation only. Skips meaning, length and term checks.
                      </span>
                      <span className="block text-[10.5px] text-amber-300 mt-1.5">Uses your translation engine</span>
                    </button>
                  )}
                  {hasAudioFile && onRetranscribeAudio && (
                    <button type="button" onClick={handleApplyAndRetranscribe} disabled={busy} className={applyCard}>
                      <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
                        {isProcessingAudio ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5 text-slate-400" />}
                        {isProcessingAudio ? 'Transcribing…' : 'Transcribe again from the audio'}
                      </span>
                      <span className="block text-[11.5px] text-slate-400 mt-1 leading-snug">
                        Starts over from the original speech. You then choose translate or your own script.
                      </span>
                      <span className="block text-[10.5px] text-amber-300 mt-1.5">
                        Uses ElevenLabs credits{lengthText ? ` for ${lengthText} of audio` : ''}
                      </span>
                    </button>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          <button
            type="button"
            onClick={handleResetToPreset}
            disabled={!edited || busy}
            className="text-[12.5px] text-slate-400 hover:text-slate-200 disabled:opacity-40 px-1 cursor-default"
          >
            {isSavedChoice ? 'Reset to the saved text' : "Reset to the style's own text"}
          </button>
          <span className="flex-1" />
          <span className="text-[11.5px] text-slate-500" role="status" aria-live="polite">
            {successNotice || 'Saved on this computer'}
          </span>
          <button
            type="button"
            onClick={handleSaveOnly}
            disabled={busy}
            className="h-[38px] px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
};
