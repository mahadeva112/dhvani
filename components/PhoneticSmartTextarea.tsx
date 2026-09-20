import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Keyboard,
  Languages,
  Check,
  CheckCheck,
  Loader2,
  Undo2,
  ChevronDown,
  Info,
  X,
  Plus
} from 'lucide-react';
import {
  getIndicLanguageConfig,
  getPhoneticSuggestions,
  transliterateWordOffline,
  transliterateTextSmart,
  SCRIPT_PALETTES,
  INDIC_LANGUAGES,
  saveUserCustomWord,
} from '../services/indicTransliteration';
import { polishIndicDialogueWithAI } from '../services/geminiService';

export interface PhoneticSmartTextareaProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  onOpenKeyboardModal?: () => void;
  id?: string;
  /** Show the Quick Symbols & Matras toggle + drawer (hidden on the Review screen) */
  showQuickSymbols?: boolean;
}

interface UndoEntry {
  start: number;
  roman: string;
  converted: string;
  separator: string;
}

export const PhoneticSmartTextarea: React.FC<PhoneticSmartTextareaProps> = ({
  value,
  onChange,
  language,
  placeholder,
  rows = 2,
  className = '',
  onOpenKeyboardModal,
  id,
  showQuickSymbols = true,
}) => {
  // Enabled state for phonetic auto-transliteration (persisted or on by default)
  const [isPhoneticOn, setIsPhoneticOn] = useState<boolean>(true);
  const [currentWord, setCurrentWord] = useState<string>('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number>(0);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState<boolean>(false);

  // AI Polish states
  const [isPolishingAI, setIsPolishingAI] = useState<boolean>(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // Quick Symbols Drawer / Popover
  const [showSymbols, setShowSymbols] = useState<boolean>(false);

  // Smart Backspace Undo tracker
  const undoHistoryRef = useRef<UndoEntry | null>(null);

  // Debounce ref
  const debounceTimeoutRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const langConfig = getIndicLanguageConfig(language);
  const scriptPalette = SCRIPT_PALETTES[langConfig.script] || SCRIPT_PALETTES.Devanagari;

  // Global Ctrl+G / Cmd+G shortcut to toggle phonetic
  const handleTogglePhonetic = () => {
    setIsPhoneticOn((prev) => !prev);
    setSuggestions([]);
    setCurrentWord('');
  };

  // Fetch suggestions when current word changes (debounced 100ms)
  const fetchSuggestionsForWord = useCallback(
    (word: string) => {
      if (!isPhoneticOn || !word || !/[a-zA-Z]/.test(word)) {
        setSuggestions([]);
        return;
      }

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(async () => {
        setIsLoadingSuggestions(true);
        try {
          const list = await getPhoneticSuggestions(word, language, 5);
          setSuggestions(list);
          setSelectedCandidateIdx(0);
        } catch {
          const fallback = transliterateWordOffline(word, language);
          setSuggestions([fallback, word].filter(Boolean));
          setSelectedCandidateIdx(0);
        } finally {
          setIsLoadingSuggestions(false);
        }
      }, 90);
    },
    [isPhoneticOn, language]
  );

  // Commit chosen suggestion or word
  const commitSuggestion = (suggested: string, separator: string = ' ') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const textBefore = value.substring(0, pos);
    const textAfter = value.substring(pos);

    const match = textBefore.match(/([a-zA-Z0-9]+)$/);
    if (match && match[1]) {
      const romanWord = match[1];
      const wordStart = textBefore.length - romanWord.length;
      const replacedBefore = textBefore.substring(0, wordStart) + suggested + separator;
      const newFullText = replacedBefore + textAfter;

      // Track undo state so immediate backspace can restore the typed Roman letters
      undoHistoryRef.current = {
        start: wordStart,
        roman: romanWord,
        converted: suggested,
        separator,
      };

      onChange(newFullText);
      setSuggestions([]);
      setCurrentWord('');

      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = replacedBefore.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
  };

  // Handle Key Down
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 1. Keyboard shortcut Ctrl+G or Cmd+G to toggle Indic Phonetic
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      handleTogglePhonetic();
      return;
    }

    if (!isPhoneticOn) return;

    // 2. Smart Backspace: Undo transliteration if pressed immediately right after word commit
    if (e.key === 'Backspace' && undoHistoryRef.current) {
      const textarea = textareaRef.current;
      if (textarea) {
        const pos = textarea.selectionStart;
        const expectedPos =
          undoHistoryRef.current.start +
          undoHistoryRef.current.converted.length +
          undoHistoryRef.current.separator.length;

        // If cursor is sitting right at the end of the committed word + separator
        if (pos === expectedPos && textarea.selectionEnd === pos) {
          e.preventDefault();
          const { start, roman, converted, separator } = undoHistoryRef.current;
          const textBefore = value.substring(0, start);
          const textAfter = value.substring(start + converted.length + separator.length);
          const restoredText = textBefore + roman + textAfter;

          undoHistoryRef.current = null;
          onChange(restoredText);

          setTimeout(() => {
            if (textareaRef.current) {
              const newPos = start + roman.length;
              textareaRef.current.focus();
              textareaRef.current.setSelectionRange(newPos, newPos);
              fetchSuggestionsForWord(roman);
            }
          }, 0);
          return;
        }
      }
    }

    // Any other key clears previous undo snapshot
    if (e.key !== 'Backspace') {
      undoHistoryRef.current = null;
    }

    // 3. When Suggestion Popup is Active
    if (suggestions.length > 0) {
      // Number keys 1-5 select that candidate immediately
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < suggestions.length) {
          e.preventDefault();
          commitSuggestion(suggestions[idx], ' ');
          return;
        }
      }

      // Arrow Down
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCandidateIdx((prev) => (prev + 1) % suggestions.length);
        return;
      }

      // Arrow Up
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCandidateIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }

      // Tab selects current active candidate
      if (e.key === 'Tab') {
        e.preventDefault();
        commitSuggestion(suggestions[selectedCandidateIdx] || suggestions[0], ' ');
        return;
      }

      // Escape dismisses suggestions (keeps current Roman word)
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestions([]);
        setCurrentWord('');
        return;
      }
    }

    // 4. Space, Enter, or Punctuation commits transliteration
    if (
      e.key === ' ' ||
      e.key === 'Enter' ||
      e.key === ',' ||
      e.key === '.' ||
      e.key === '?' ||
      e.key === '!' ||
      e.key === '।'
    ) {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pos = textarea.selectionStart;
      const textBefore = value.substring(0, pos);
      const match = textBefore.match(/([a-zA-Z0-9]+)$/);

      if (match && match[1]) {
        e.preventDefault();
        const sep = e.key === 'Enter' ? '\n' : e.key;

        if (suggestions.length > 0) {
          const chosen = suggestions[selectedCandidateIdx] || suggestions[0];
          commitSuggestion(chosen, sep);
        } else {
          // Fallback to offline rule if suggestions haven't landed yet
          const offlineCandidate = transliterateWordOffline(match[1], language);
          commitSuggestion(offlineCandidate || match[1], sep);
        }
      }
    }
  };

  // Handle Key Up / Typing to discover active Roman word
  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isPhoneticOn) return;

    // Ignore navigation keys handled in keydown
    if (['ArrowDown', 'ArrowUp', 'Tab', 'Escape', 'Enter'].includes(e.key)) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const textBefore = value.substring(0, pos);
    const match = textBefore.match(/([a-zA-Z0-9]+)$/);

    if (match && match[1] && match[1].length >= 1) {
      const word = match[1];
      setCurrentWord(word);
      fetchSuggestionsForWord(word);
    } else {
      setSuggestions([]);
      setCurrentWord('');
    }
  };

  // Convert entire cue text (all Roman words)
  const handleConvertEntireText = async () => {
    if (!value) return;
    setIsLoadingSuggestions(true);
    try {
      const smartConverted = await transliterateTextSmart(value, language);
      onChange(smartConverted);
    } catch {
      const fallback = transliterateWordOffline(value, language);
      onChange(fallback);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  // AI Polish with Gemini
  const handlePolishWithAI = async () => {
    if (!value || !value.trim()) return;
    setIsPolishingAI(true);
    setAiNote(null);
    try {
      const res = await polishIndicDialogueWithAI(
        value,
        langConfig.name,
        `Dialogue cue for Indic dubbing in ${langConfig.nativeName}`
      );
      if (res.correctedText) {
        onChange(res.correctedText);
        setAiNote(res.notes || `Polished ${langConfig.nativeName} spelling and nuances`);
        setTimeout(() => setAiNote(null), 4000);
      }
    } catch (err: any) {
      setAiNote('AI Polish unavailable. Check internet or API key.');
      setTimeout(() => setAiNote(null), 4000);
    } finally {
      setIsPolishingAI(false);
    }
  };

  // Insert a quick character from character palette
  const handleInsertChar = (char: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + char);
      return;
    }

    const pos = textarea.selectionStart;
    const textBefore = value.substring(0, pos);
    const textAfter = value.substring(pos);
    const newText = textBefore + char + textAfter;

    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos + char.length, pos + char.length);
      }
    }, 0);
  };

  // Quick symbols to display in drawer (Virama/Halant, Anusvara, Chandrabindu, Nukta, Purna Viram, Om, Rupee)
  const quickChars = [
    { label: 'Halant (्)', char: scriptPalette.matras.find((m) => m === '्' || m === '্' || m === '்' || m === '్') || '्' },
    { label: 'Anusvara (ं)', char: scriptPalette.matras.find((m) => m === 'ं' || m === 'ং' || m === 'ం') || 'ं' },
    { label: 'Chandrabindu (ँ)', char: scriptPalette.matras.find((m) => m === 'ँ' || m === 'ঁ') || 'ँ' },
    { label: 'Nukta (़)', char: scriptPalette.matras.find((m) => m === '़' || m === '়') || '़' },
    { label: 'Purna Viram (।)', char: langConfig.purnaViram || '।' },
    { label: 'Om', char: langConfig.om || 'ॐ' },
    { label: '₹', char: '₹' },
  ].filter(Boolean);

  return (
    <div className="relative group/phonetic flex flex-col space-y-1">
      {/* Top Helper Toolbar */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Indic Language Script Pill */}
          <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 dark:text-indigo-300 border border-indigo-500/20 text-[10px] font-medium font-sans flex items-center gap-1">
            <span className="font-serif font-bold text-xs">{langConfig.nativeName}</span>
            <span className="opacity-70 text-[9px]">({langConfig.name})</span>
          </span>

          {/* Toggle Phonetic Button */}
          <button
            type="button"
            onClick={handleTogglePhonetic}
            className={`px-2 py-0.5 rounded-md font-mono flex items-center gap-1 transition-all ${
              isPhoneticOn
                ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700 hover:text-indigo-600'
            }`}
            title="Toggle Indic Phonetic Transliteration (Shortcut: Ctrl+G / Cmd+G)"
          >
            <Keyboard className="w-3 h-3" />
            <span>Phonetic: {isPhoneticOn ? 'ON' : 'OFF'}</span>
          </button>

          {/* AI Polish Button */}
          <button
            type="button"
            onClick={handlePolishWithAI}
            disabled={isPolishingAI || !value}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all border ${
              isPolishingAI
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
            }`}
            title="AI Indic Spellcheck & Grammar Polish: Corrects broken matras, incorrect conjuncts, and refines natural dialogue nuance using Gemini."
          >
            {isPolishingAI ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                <span>Polishing...</span>
              </>
            ) : (
              <>
                <CheckCheck className="w-3 h-3 text-emerald-400" />
                <span>AI Polish</span>
              </>
            )}
          </button>

          {/* Batch Transliterate Cue if Roman text remains */}
          {isPhoneticOn && value && /[a-zA-Z]{2,}/.test(value) && (
            <button
              type="button"
              onClick={handleConvertEntireText}
              disabled={isLoadingSuggestions}
              className="px-1.5 py-0.5 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] flex items-center gap-1 transition-colors border border-slate-300 dark:border-slate-700"
              title="Convert all Roman English words in this cue to Indian script"
            >
              <Languages className="w-2.5 h-2.5 text-indigo-400" />
              <span>Convert All</span>
            </button>
          )}

          {/* Quick Symbols Popover Toggle */}
          {showQuickSymbols && (
          <button
            type="button"
            onClick={() => setShowSymbols(!showSymbols)}
            className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-0.5 transition-colors border ${
              showSymbols
                ? 'bg-indigo-900 text-indigo-200 border-indigo-500'
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-700'
            }`}
            title="Quick Symbols & Matras"
          >
            <span className="font-serif">् । ॐ</span>
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showSymbols ? 'rotate-180' : ''}`} />
          </button>
          )}
        </div>

        {/* Virtual Keyboard Modal Trigger */}
        {onOpenKeyboardModal && (
          <button
            type="button"
            onClick={onOpenKeyboardModal}
            className="p-1 rounded text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 text-[10px]"
            title="Open On-Screen Virtual Indic Keyboard & Palette"
          >
            <Keyboard className="w-3 h-3" />
            <span className="hidden sm:inline">Virtual Keyboard</span>
          </button>
        )}
      </div>

      {/* Quick Symbols Mini Drawer */}
      {showQuickSymbols && showSymbols && (
        <div className="p-1.5 bg-slate-100 dark:bg-slate-900 border border-indigo-500/40 rounded-lg flex items-center gap-1.5 flex-wrap animate-in fade-in zoom-in-95 duration-100 text-xs">
          <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 uppercase font-bold px-1">
            Insert:
          </span>
          {quickChars.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleInsertChar(item.char)}
              className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-800 dark:text-slate-200 font-serif font-bold text-sm shadow-2xs border border-slate-200 dark:border-slate-700 transition-colors"
              title={`Insert ${item.label}`}
            >
              {item.char}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowSymbols(false)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-auto"
            title="Close symbols drawer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* AI Polish Note Banner */}
      {aiNote && (
        <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-500/50 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1.5 animate-in fade-in duration-150">
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="font-medium text-[11px]">{aiNote}</span>
        </div>
      )}

      {/* Main Textarea Container */}
      <div className="relative">
        <textarea
          id={id}
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          rows={rows}
          placeholder={
            placeholder ||
            (isPhoneticOn
              ? `Dialogue translation in ${langConfig.nativeName} (${langConfig.name})... Type in English phonetically (e.g. "namaste").`
              : `Dialogue translation...`)
          }
          className={`w-full p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-xs font-serif text-slate-900 dark:text-white focus:outline-none resize-none leading-relaxed transition-all shadow-inner ${className}`}
        />

        {/* Live Word Suggestions Popup (Candidate List with Number Keys 1-5) */}
        {isPhoneticOn && suggestions.length > 0 && (
          <div className="absolute left-1 -bottom-9 z-30 flex items-center gap-1 bg-white dark:bg-slate-900 border border-indigo-500 rounded-lg p-1 shadow-2xl shadow-indigo-950/40 animate-in fade-in zoom-in-95 duration-100 max-w-[95%] overflow-x-auto">
            <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 px-1 shrink-0 flex items-center gap-1">
              <Languages className="w-3 h-3" />
              <span>Select:</span>
            </span>

            {suggestions.map((sugg, i) => {
              const isSelected = i === selectedCandidateIdx;
              return (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitSuggestion(sugg, ' ');
                  }}
                  className={`px-2 py-0.5 rounded text-xs font-serif transition-all flex items-center gap-1 shrink-0 ${
                    isSelected
                      ? 'bg-indigo-600 text-white font-bold shadow-xs scale-105'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                  title={`Press ${i + 1} or Click to select "${sugg}"`}
                >
                  <span className="font-mono text-[9px] opacity-75 font-semibold">[{i + 1}]</span>
                  <span className="text-xs">{sugg}</span>
                </button>
              );
            })}

            <span className="text-[9px] text-slate-400 px-1 hidden md:inline shrink-0">
              (Press 1-5, Tab, or Space)
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
