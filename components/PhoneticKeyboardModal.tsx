import React, { useState, useEffect, useRef } from 'react';
import {
  Keyboard,
  Languages,
  Type,
  Copy,
  Check,
  X,
  HelpCircle,
  ArrowRight,
  BookOpen,
  RefreshCw,
  Zap,
  Minimize2,
  Maximize2,
  CheckCheck,
  Loader2,
  Trash2,
  Plus,
  BookMarked,
  Sliders
} from 'lucide-react';
import {
  INDIC_LANGUAGES,
  SCRIPT_PALETTES,
  PHONETIC_CHEAT_SHEET,
  transliterateTextOffline,
  transliterateTextSmart,
  getPhoneticSuggestions,
  transliterateWordOffline,
  getIndicLanguageConfig,
  saveUserCustomWord,
  deleteUserCustomWord,
  listAllUserCustomWords
} from '../services/indicTransliteration';
import { polishIndicDialogueWithAI } from '../services/geminiService';
import { AudioSegment } from '../types';

interface PhoneticKeyboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetLanguage: string;
  onLanguageChange?: (lang: string) => void;
  segments?: AudioSegment[];
  onUpdateSegments?: (segments: AudioSegment[]) => void;
  activeSegmentId?: string | number | null;
  onInsertTextToActiveSegment?: (text: string) => void;
  isGlobalPhoneticEnabled: boolean;
  onToggleGlobalPhonetic: (enabled: boolean) => void;
}

export const PhoneticKeyboardModal: React.FC<PhoneticKeyboardModalProps> = ({
  isOpen,
  onClose,
  targetLanguage,
  onLanguageChange,
  segments = [],
  onUpdateSegments,
  activeSegmentId,
  onInsertTextToActiveSegment,
  isGlobalPhoneticEnabled,
  onToggleGlobalPhonetic,
}) => {
  const [selectedLang, setSelectedLang] = useState<string>(targetLanguage || 'Hindi');
  const [activeTab, setActiveTab] = useState<'sandbox' | 'ai-polish' | 'palette' | 'custom-dict' | 'cheatsheet' | 'batch'>('sandbox');
  
  // Sandbox states
  const [romanInput, setRomanInput] = useState('');
  const [indicOutput, setIndicOutput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);

  // AI Polish states
  const [aiInputText, setAiInputText] = useState('');
  const [aiOutputText, setAiOutputText] = useState('');
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [aiCopied, setAiCopied] = useState(false);
  const [aiInserted, setAiInserted] = useState(false);

  // Custom Dictionary states
  const [customRoman, setCustomRoman] = useState('');
  const [customNative, setCustomNative] = useState('');
  const [customWordList, setCustomWordList] = useState<{ roman: string; native: string }[]>([]);

  // Batch convert states
  const [batchConvertedCount, setBatchConvertedCount] = useState<number | null>(null);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const scratchInputRef = useRef<HTMLTextAreaElement>(null);

  const currentLangConfig = getIndicLanguageConfig(selectedLang);
  const currentPalette = SCRIPT_PALETTES[currentLangConfig.script] || SCRIPT_PALETTES.Devanagari;

  // Sync with prop targetLanguage
  useEffect(() => {
    if (targetLanguage) {
      setSelectedLang(targetLanguage);
    }
  }, [targetLanguage]);

  // Load custom words on language change
  useEffect(() => {
    setCustomWordList(listAllUserCustomWords(currentLangConfig.code));
  }, [selectedLang, currentLangConfig.code]);

  // If activeSegment changes and has text, pre-fill AI polish input for convenience
  useEffect(() => {
    if (activeSegmentId && segments.length > 0) {
      const active = segments.find(
        (s) => s.id === activeSegmentId || (s as any)._id === activeSegmentId
      );
      if (active) {
        const txt = active.textTarget || (active as any).targetText || '';
        if (txt && !aiInputText) {
          setAiInputText(txt);
        }
      }
    }
  }, [activeSegmentId, segments]);

  // Transliterate on input change in sandbox
  useEffect(() => {
    if (!romanInput) {
      setIndicOutput('');
      setSuggestions([]);
      return;
    }

    // Live offline transliteration
    const offlineConverted = transliterateTextOffline(romanInput, selectedLang);
    setIndicOutput(offlineConverted);

    // Get suggestions for the current last word
    const words = romanInput.trim().split(/\s+/);
    const lastWord = words[words.length - 1];
    if (lastWord && /[a-zA-Z]/.test(lastWord)) {
      getPhoneticSuggestions(lastWord, selectedLang, 5).then((suggs) => {
        setSuggestions(suggs);
      });
    } else {
      setSuggestions([]);
    }
  }, [romanInput, selectedLang]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!indicOutput) return;
    navigator.clipboard.writeText(indicOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyToActiveSegment = () => {
    if (!indicOutput) return;
    if (onInsertTextToActiveSegment) {
      onInsertTextToActiveSegment(indicOutput);
      setInserted(true);
      setTimeout(() => setInserted(false), 2000);
    }
  };

  const handleInsertChar = (char: string) => {
    setIndicOutput((prev) => prev + char);
    if (onInsertTextToActiveSegment) {
      onInsertTextToActiveSegment(char);
    }
  };

  const handleApplySuggestion = (sug: string) => {
    const words = romanInput.split(/(\s+)/);
    // Find last word token
    for (let i = words.length - 1; i >= 0; i--) {
      if (/[a-zA-Z]/.test(words[i])) {
        words[i] = sug;
        break;
      }
    }
    const newText = words.join('');
    setIndicOutput(newText);
    setSuggestions([]);
  };

  // AI Polish Execution
  const handleRunAiPolish = async () => {
    if (!aiInputText.trim()) return;
    setIsPolishing(true);
    setAiNotes(null);
    try {
      const res = await polishIndicDialogueWithAI(
        aiInputText,
        currentLangConfig.name,
        `Dialogue cue for Indic dubbing in ${currentLangConfig.nativeName}`
      );
      setAiOutputText(res.correctedText);
      setAiNotes(res.notes || 'Dialogue polished and validated for native naturalness.');
    } catch (err: any) {
      setAiNotes('Failed to connect to AI. Please check internet connection.');
    } finally {
      setIsPolishing(false);
    }
  };

  // Custom Dictionary management
  const handleAddCustomWord = () => {
    if (!customRoman.trim() || !customNative.trim()) return;
    saveUserCustomWord(customRoman, customNative, currentLangConfig.code);
    setCustomWordList(listAllUserCustomWords(currentLangConfig.code));
    setCustomRoman('');
    setCustomNative('');
  };

  const handleDeleteCustomWord = (roman: string) => {
    deleteUserCustomWord(roman, currentLangConfig.code);
    setCustomWordList(listAllUserCustomWords(currentLangConfig.code));
  };

  const handleBatchTransliterateAllCues = async () => {
    if (!segments || segments.length === 0 || !onUpdateSegments) return;

    setIsBatchConverting(true);
    let count = 0;
    const updated = await Promise.all(
      segments.map(async (seg) => {
        const targetTxt = seg.textTarget || (seg as any).targetText || '';
        if (/[a-zA-Z]/.test(targetTxt)) {
          const converted = await transliterateTextSmart(targetTxt, selectedLang);
          count++;
          return {
            ...seg,
            textTarget: converted,
            targetText: converted,
          };
        }
        return seg;
      })
    );

    onUpdateSegments(updated);
    setIsBatchConverting(false);
    setBatchConvertedCount(count);
    setTimeout(() => setBatchConvertedCount(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full ${
          isMinimized ? 'max-w-md' : 'max-w-3xl'
        } bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300 max-h-[92vh] text-slate-900 dark:text-slate-100`}
      >
        {/* Modal Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-slate-100 via-indigo-50/50 to-slate-100 dark:from-slate-900 dark:via-indigo-950/60 dark:to-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Indic Phonetic Keyboard & AI Suite
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/30 text-[10px] font-mono font-medium">
                  {currentLangConfig.nativeName} ({currentLangConfig.name})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Type English letters (Roman) → Converts to {currentLangConfig.nativeName} script with AI Spellcheck
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
              title={isMinimized ? 'Expand' : 'Minimize'}
            >
              {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Global Phonetic Switcher Banner */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600 dark:text-slate-400 font-medium">Target Language Script:</span>
            <select
              value={selectedLang}
              onChange={(e) => {
                const newLang = e.target.value;
                setSelectedLang(newLang);
                if (onLanguageChange) onLanguageChange(newLang);
              }}
              className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg px-2.5 py-1 text-xs font-semibold focus:border-indigo-500 focus:outline-none"
            >
              {Object.keys(INDIC_LANGUAGES).map((lang) => (
                <option key={lang} value={lang}>
                  {lang} ({INDIC_LANGUAGES[lang].nativeName})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">Auto-Phonetic in All Inputs:</span>
              <button
                type="button"
                onClick={() => onToggleGlobalPhonetic(!isGlobalPhoneticEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                  isGlobalPhoneticEnabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    isGlobalPhoneticEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        {/* Navigation Tabs */}
        {!isMinimized && (
          <div className="flex border-b border-slate-200 dark:border-slate-800 px-4 bg-slate-50 dark:bg-slate-900/50 overflow-x-auto">
            <button
              onClick={() => setActiveTab('sandbox')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'sandbox'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Type className="w-3.5 h-3.5" />
              <span>Phonetic Typing Pad</span>
            </button>

            <button
              onClick={() => setActiveTab('ai-polish')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'ai-polish'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>AI Polish & Nuance</span>
            </button>

            <button
              onClick={() => setActiveTab('palette')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'palette'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>Visual Palette</span>
            </button>

            <button
              onClick={() => setActiveTab('custom-dict')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'custom-dict'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <BookMarked className="w-3.5 h-3.5" />
              <span>Custom Dictionary</span>
            </button>

            <button
              onClick={() => setActiveTab('cheatsheet')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'cheatsheet'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Phonetic Guide</span>
            </button>

            <button
              onClick={() => setActiveTab('batch')}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all shrink-0 ${
                activeTab === 'batch'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Batch Convert Cues</span>
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: PHONETIC TYPING PAD / SANDBOX */}
          {activeTab === 'sandbox' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Roman Input Box */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase font-mono tracking-wider text-slate-600 dark:text-slate-400 font-bold">
                      1. Type in English (Roman letters)
                    </label>
                    <span className="text-[10px] text-slate-400">e.g. "namaste aap kaise hain"</span>
                  </div>
                  <textarea
                    ref={scratchInputRef}
                    value={romanInput}
                    onChange={(e) => setRomanInput(e.target.value)}
                    placeholder={`Type in English phonetically (e.g., namaste, dhanyavaad, vanakkam, kaisa chal raha hai)...`}
                    rows={4}
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-indigo-500 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none resize-none leading-relaxed transition-all shadow-inner"
                  />
                </div>

                {/* Indic Output Box */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase font-mono tracking-wider text-indigo-600 dark:text-indigo-400 font-bold">
                      2. Converted {currentLangConfig.nativeName} Script
                    </label>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">Live Transliterated</span>
                  </div>
                  <textarea
                    value={indicOutput}
                    onChange={(e) => setIndicOutput(e.target.value)}
                    placeholder={`Converted ${currentLangConfig.name} text will appear here...`}
                    rows={4}
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-950 border border-indigo-300 dark:border-indigo-500/60 text-base font-serif text-slate-900 dark:text-white focus:outline-none resize-none leading-relaxed transition-all shadow-inner"
                  />
                </div>
              </div>

              {/* Suggestions Bar */}
              {suggestions.length > 0 && (
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono shrink-0">Candidates:</span>
                  <div className="flex items-center gap-1.5">
                    {suggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleApplySuggestion(sug)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-900 hover:text-white dark:bg-indigo-950/80 dark:hover:bg-indigo-600 dark:text-indigo-200 dark:hover:text-white border border-indigo-200 dark:border-indigo-800/80 text-xs font-serif transition-all"
                      >
                        <span className="font-mono text-[9px] opacity-75 mr-1">[{idx + 1}]</span>
                        <span>{sug}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Press Space to convert words automatically. Press Backspace right after to undo.</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!indicOutput}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-300 dark:border-slate-700 transition-all"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied!' : 'Copy Script'}</span>
                  </button>

                  {onInsertTextToActiveSegment && (
                    <button
                      type="button"
                      onClick={handleApplyToActiveSegment}
                      disabled={!indicOutput}
                      className="flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
                    >
                      {inserted ? <Check className="w-3.5 h-3.5 text-white" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      <span>{inserted ? 'Applied to Cue!' : 'Apply to Active Cue'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI INDIC POLISH & DIALOGUE NUANCE */}
          {activeTab === 'ai-polish' && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
                  <CheckCheck className="w-4 h-4" />
                  <span>Gemini AI Indic Dialogue Polish & Spellchecker</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Corrects broken matras, incorrect conjuncts (yuktakshar), missing halants, and refines phonetic words into 100% natural, colloquial dialogue for {currentLangConfig.nativeName} dubbing.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Input Textarea */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-mono">
                    Input Dialogue (Draft or Phonetic Script):
                  </label>
                  <textarea
                    value={aiInputText}
                    onChange={(e) => setAiInputText(e.target.value)}
                    placeholder={`Paste or type dialogue in ${currentLangConfig.nativeName} or Roman letters...`}
                    rows={5}
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-serif text-slate-900 dark:text-white focus:outline-none resize-none leading-relaxed transition-all shadow-inner"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleRunAiPolish}
                      disabled={isPolishing || !aiInputText.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/30"
                    >
                      {isPolishing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Polishing with AI...</span>
                        </>
                      ) : (
                        <>
                          <CheckCheck className="w-4 h-4" />
                          <span>AI Polish & Fix Script</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Output Polished Textarea */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-mono">
                    Polished Native Dialogue:
                  </label>
                  <textarea
                    value={aiOutputText}
                    onChange={(e) => setAiOutputText(e.target.value)}
                    placeholder={`Polished, natural ${currentLangConfig.name} dialogue will appear here...`}
                    rows={5}
                    className="w-full p-3 rounded-xl bg-white dark:bg-slate-950 border border-emerald-500/50 text-base font-serif text-slate-900 dark:text-white focus:outline-none resize-none leading-relaxed transition-all shadow-inner"
                  />
                  {aiNotes && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-300 font-medium italic">
                      Note: {aiNotes}
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (!aiOutputText) return;
                        navigator.clipboard.writeText(aiOutputText);
                        setAiCopied(true);
                        setTimeout(() => setAiCopied(false), 2000);
                      }}
                      disabled={!aiOutputText}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-300 dark:border-slate-700 flex items-center gap-1"
                    >
                      {aiCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{aiCopied ? 'Copied!' : 'Copy Script'}</span>
                    </button>

                    {onInsertTextToActiveSegment && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!aiOutputText) return;
                          onInsertTextToActiveSegment(aiOutputText);
                          setAiInserted(true);
                          setTimeout(() => setAiInserted(false), 2000);
                        }}
                        disabled={!aiOutputText}
                        className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 shadow-md shadow-indigo-600/30"
                      >
                        {aiInserted ? <Check className="w-3.5 h-3.5 text-white" /> : <ArrowRight className="w-3.5 h-3.5" />}
                        <span>{aiInserted ? 'Applied to Cue!' : 'Apply to Active Cue'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: VISUAL CHARACTER PALETTE */}
          {activeTab === 'palette' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click any character to insert it directly into the active cue text.
              </p>

              {/* Vowels (स्वर) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300 uppercase tracking-wider font-mono">
                  Vowels (स्वर):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentPalette.vowels.map((char, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleInsertChar(char)}
                      className="min-w-[36px] h-9 px-2 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white dark:bg-slate-800 dark:hover:bg-indigo-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-serif text-sm font-medium transition-all shadow-xs"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Matras (मात्राएं) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-300 uppercase tracking-wider font-mono">
                  Matras & Marks (मात्राएं):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentPalette.matras.map((char, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleInsertChar(char)}
                      className="min-w-[36px] h-9 px-2 rounded-lg bg-slate-100 hover:bg-cyan-600 hover:text-white dark:bg-slate-800/80 dark:hover:bg-cyan-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-serif text-sm font-medium transition-all shadow-xs"
                    >
                      ◌{char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Consonants (व्यंजन) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-300 uppercase tracking-wider font-mono">
                  Consonants (व्यंजन):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentPalette.consonants.map((char, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleInsertChar(char)}
                      className="min-w-[36px] h-9 px-2 rounded-lg bg-slate-100 hover:bg-amber-600 hover:text-white dark:bg-slate-800 dark:hover:bg-amber-600 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-serif text-sm font-medium transition-all shadow-xs"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Numbers & Symbols */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider font-mono">
                    Indic Digits:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {currentPalette.numbers.map((char, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleInsertChar(char)}
                        className="min-w-[34px] h-8 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-serif text-xs font-medium transition-all"
                      >
                        {char}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider font-mono">
                    Punctuation & Spiritual Marks:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {currentPalette.symbols.map((char, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleInsertChar(char)}
                        className="min-w-[34px] h-8 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white dark:bg-indigo-950/60 dark:hover:bg-indigo-600 dark:text-indigo-300 dark:hover:text-white border border-indigo-200 dark:border-indigo-800/80 font-serif text-sm font-bold transition-all"
                      >
                        {char}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CUSTOM VOCABULARY DICTIONARY */}
          {activeTab === 'custom-dict' && (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/80 rounded-xl text-xs space-y-1">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-bold">
                  <BookMarked className="w-4 h-4" />
                  <span>Personal Transliteration Dictionary ({currentLangConfig.name})</span>
                </div>
                <p className="text-slate-600 dark:text-slate-300">
                  Save character names, brand names, slang, or custom terms. Words saved here always take the #1 priority when you type!
                </p>
              </div>

              {/* Add New Word Form */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={customRoman}
                  onChange={(e) => setCustomRoman(e.target.value)}
                  placeholder="English Roman (e.g. sharma)"
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 w-44"
                />
                <span className="text-slate-400 font-bold">→</span>
                <input
                  type="text"
                  value={customNative}
                  onChange={(e) => setCustomNative(e.target.value)}
                  placeholder={`Native Script (e.g. शर्मा)`}
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-serif text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 w-44"
                />
                <button
                  type="button"
                  onClick={handleAddCustomWord}
                  disabled={!customRoman.trim() || !customNative.trim()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Word</span>
                </button>
              </div>

              {/* Saved Words List */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Saved Words ({customWordList.length}):
                </span>
                {customWordList.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No custom words added yet for {currentLangConfig.name}.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {customWordList.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-slate-500 dark:text-slate-400">{item.roman}</span>
                          <span className="text-slate-400">→</span>
                          <span className="font-serif font-bold text-indigo-600 dark:text-indigo-300">{item.native}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomWord(item.roman)}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="Delete word"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: PHONETIC CHEAT SHEET */}
          {activeTab === 'cheatsheet' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reference guide for typing Indian sounds using standard English QWERTY keyboard:
              </p>
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                    <tr>
                      <th className="p-2.5">Roman Keystrokes</th>
                      <th className="p-2.5">Description</th>
                      <th className="p-2.5">Script Sample</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-sans">
                    {PHONETIC_CHEAT_SHEET.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-2.5 font-mono text-indigo-600 dark:text-indigo-400 font-bold">{item.roman}</td>
                        <td className="p-2.5 text-slate-700 dark:text-slate-300">{item.desc}</td>
                        <td className="p-2.5 font-serif text-slate-900 dark:text-white font-medium">{item.sample}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: BATCH CONVERT ALL CUES */}
          {activeTab === 'batch' && (
            <div className="space-y-4 p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Bulk Roman-to-Native Transliteration for Project Cues</span>
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  If you have typed dialogue lines in Romanized English (e.g., Hinglish / Tanglish / Banglish), this tool will automatically convert all English words across your {segments.length} cues into native {currentLangConfig.nativeName} script in one click using Google Input Tools and the verified Indic dictionary.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBatchTransliterateAllCues}
                  disabled={segments.length === 0 || isBatchConverting}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-md"
                >
                  {isBatchConverting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Converting cues...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      <span>Convert All {segments.length} Cues to {currentLangConfig.nativeName}</span>
                    </>
                  )}
                </button>

                {batchConvertedCount !== null && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="w-4 h-4" />
                    Transliterated {batchConvertedCount} cue lines successfully!
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
