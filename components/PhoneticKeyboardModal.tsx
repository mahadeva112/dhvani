import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Copy, Check, Trash2, RefreshCw, ArrowRight, AlertCircle } from 'lucide-react';
import {
  INDIC_LANGUAGES,
  SCRIPT_PALETTES,
  PHONETIC_CHEAT_SHEET,
  transliterateTextOffline,
  transliterateTextSmart,
  getPhoneticSuggestions,
  getIndicLanguageConfig,
  saveUserCustomWord,
  deleteUserCustomWord,
  listAllUserCustomWords,
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
  /** Adds text to the end of the active cue. */
  onInsertTextToActiveSegment?: (text: string) => void;
  isGlobalPhoneticEnabled: boolean;
  onToggleGlobalPhonetic: (enabled: boolean) => void;
}

type PaletteTab = 'vowels' | 'matras' | 'consonants' | 'marks';
type SideTab = 'guide' | 'words' | 'script';

const targetOf = (seg: AudioSegment) => seg.textTarget || (seg as any).targetText || '';
const hasLatin = (text: string) => /[a-zA-Z]/.test(text);
/** Signs that sit on a letter show on a placeholder circle, as a keyboard would. */
const COMBINING = /^[ऀ-ःऺ-ॏ॑-ॗॢॣঁ-ঃ়-ৗਁ-ਃ਼-ੑઁ-ઃ઼-્ଁ-ଃ଼-ୗஂா-்ఀ-ఄా-ౖಁ-ಃ಼-ೖഀ-ഃാ-ൗ]+$/;

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
  const [paletteTab, setPaletteTab] = useState<PaletteTab>('matras');
  const [sideTab, setSideTab] = useState<SideTab>('guide');

  // Typing pad: the Roman text, words the user picked a spelling for, and characters tapped in after it.
  const [romanInput, setRomanInput] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [tail, setTail] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const romanRef = useRef<HTMLInputElement>(null);

  // Custom words
  const [customRoman, setCustomRoman] = useState('');
  const [customNative, setCustomNative] = useState('');
  const [customWordList, setCustomWordList] = useState<{ roman: string; native: string }[]>([]);

  // Whole script
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [polishInput, setPolishInput] = useState('');
  const [polishOutput, setPolishOutput] = useState('');
  const [polishNote, setPolishNote] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);

  const lang = getIndicLanguageConfig(selectedLang);
  const palette = SCRIPT_PALETTES[lang.script] || SCRIPT_PALETTES.Devanagari;

  useEffect(() => {
    if (targetLanguage) setSelectedLang(targetLanguage);
  }, [targetLanguage]);

  useEffect(() => {
    setCustomWordList(listAllUserCustomWords(lang.code));
  }, [lang.code]);

  const activeIndex = segments.findIndex((s) => s.id === activeSegmentId || (s as any)._id === activeSegmentId);
  const activeSegment = activeIndex >= 0 ? segments[activeIndex] : null;
  const cueLabel = activeIndex >= 0 ? `cue ${String(activeIndex + 1).padStart(2, '0')}` : null;

  // The polish box starts from the active cue's line.
  useEffect(() => {
    if (isOpen && activeSegment) setPolishInput(targetOf(activeSegment));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeSegmentId]);

  const romanWords = romanInput.split(/\s+/).filter(Boolean);
  const typingWord = romanInput && !/\s$/.test(romanInput) ? romanWords[romanWords.length - 1] : null;
  const convertedWords = romanWords.map((w) => picked[w] ?? transliterateTextOffline(w, selectedLang));
  // Tapped characters join straight on, so a vowel sign lands on the letter before it; a typed space still separates.
  const tailGap = tail && romanWords.length > 0 && /\s$/.test(romanInput) ? ' ' : '';
  const output = convertedWords.join(' ') + tailGap + tail;

  // Suggestions for the word being typed.
  useEffect(() => {
    if (!typingWord || !hasLatin(typingWord)) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    getPhoneticSuggestions(typingWord, selectedLang, 5).then((s) => !cancelled && setSuggestions(s));
    return () => {
      cancelled = true;
    };
  }, [typingWord, selectedLang]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1800);
  };

  const pickSuggestion = (s: string) => {
    if (!typingWord) return;
    setPicked((p) => ({ ...p, [typingWord]: s }));
    setRomanInput((v) => `${v} `);
    romanRef.current?.focus();
  };

  const clearPad = () => {
    setRomanInput('');
    setPicked({});
    setTail('');
    romanRef.current?.focus();
  };

  const copyOutput = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      flash('Copied');
    } catch {
      flash('Could not copy; select the text instead');
    }
  };

  const addToCue = () => {
    if (!output || !onInsertTextToActiveSegment || !activeSegment) return;
    const existing = targetOf(activeSegment);
    onInsertTextToActiveSegment(existing && !/\s$/.test(existing) ? ` ${output}` : output);
    flash(`Added to ${cueLabel}`);
    clearPad();
  };

  // Cues that still carry Roman letters, for the whole-script tab.
  const latinCues = useMemo(
    () => segments.map((seg, i) => ({ seg, i })).filter(({ seg }) => hasLatin(targetOf(seg))),
    [segments]
  );

  const convertLatinCues = async () => {
    if (!onUpdateSegments || latinCues.length === 0) return;
    setIsBatchConverting(true);
    try {
      const updated = await Promise.all(
        segments.map(async (seg) => {
          const text = targetOf(seg);
          if (!hasLatin(text)) return seg;
          const converted = await transliterateTextSmart(text, selectedLang);
          return { ...seg, textTarget: converted, targetText: converted };
        })
      );
      onUpdateSegments(updated);
      flash(`Converted ${latinCues.length} ${latinCues.length === 1 ? 'cue' : 'cues'}`);
    } finally {
      setIsBatchConverting(false);
    }
  };

  const runPolish = async () => {
    if (!polishInput.trim()) return;
    setIsPolishing(true);
    setPolishNote(null);
    setPolishOutput('');
    try {
      const res = await polishIndicDialogueWithAI(polishInput, lang.name, `Dialogue cue for Indic dubbing in ${lang.nativeName}`);
      setPolishOutput(res.correctedText);
      setPolishNote(res.notes || null);
    } catch {
      setPolishNote('The translation engine could not be reached. Check API settings and try again.');
    } finally {
      setIsPolishing(false);
    }
  };

  // The polished line replaces the cue's text rather than being added to it.
  const usePolished = () => {
    if (!polishOutput || !activeSegment || !onUpdateSegments) return;
    onUpdateSegments(
      segments.map((s) => (s.id === activeSegment.id ? { ...s, textTarget: polishOutput, targetText: polishOutput } : s))
    );
    flash(`Replaced the line in ${cueLabel}`);
  };

  const addCustomWord = () => {
    if (!customRoman.trim() || !customNative.trim()) return;
    saveUserCustomWord(customRoman, customNative, lang.code);
    setCustomWordList(listAllUserCustomWords(lang.code));
    setCustomRoman('');
    setCustomNative('');
  };

  if (!isOpen) return null;

  const paletteKeys: string[] =
    paletteTab === 'marks' ? [...(palette.symbols || []), ...(palette.numbers || [])] : (palette as any)[paletteTab] || [];

  const tabClass = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
      on ? 'bg-slate-900 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'
    }`;
  const ghost =
    'h-[38px] px-3 flex items-center justify-center gap-1.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-title"
        className="relative w-full max-w-[65rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div
            className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0 text-lg font-semibold"
            aria-hidden="true"
          >
            {palette.consonants?.[0] || 'क'}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="keyboard-title" className="text-lg font-semibold text-slate-100 leading-tight">
              {lang.name} keyboard
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              Type how it sounds in English letters. It becomes {lang.name} as you go.
            </p>
          </div>
          <div className="w-full sm:w-auto flex flex-wrap items-center gap-3">
            <select
              value={selectedLang}
              onChange={(e) => {
                setSelectedLang(e.target.value);
                onLanguageChange?.(e.target.value);
              }}
              aria-label="Script"
              className="h-[34px] bg-slate-950/60 border border-slate-700 rounded-[9px] px-2.5 text-[12.5px] text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {Object.keys(INDIC_LANGUAGES).map((l) => (
                <option key={l} value={l} className="bg-slate-900">
                  {INDIC_LANGUAGES[l].nativeName} {l}
                </option>
              ))}
            </select>
            <button
              type="button"
              role="switch"
              aria-checked={isGlobalPhoneticEnabled}
              onClick={() => onToggleGlobalPhonetic(!isGlobalPhoneticEnabled)}
              className="flex items-center gap-2 text-[12.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
              title="Turns Roman typing into the script in every cue's text box"
            >
              <span className={`relative w-8 h-[18px] rounded-full transition-colors ${isGlobalPhoneticEnabled ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${isGlobalPhoneticEnabled ? 'left-4' : 'left-0.5'}`} />
              </span>
              Type {lang.name} in every cue
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto sm:ml-0 w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Typing pad and characters */}
          <div className="px-5 sm:px-6 py-5 flex flex-col gap-3.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Typing pad</span>
              <span className="text-[11.5px] text-slate-400">Pick a spelling with 1–5 · it carries on into the next word</span>
            </div>

            <div className="rounded-[14px] border border-slate-700 bg-slate-950/60 overflow-hidden focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/15">
              <div className="px-4 pt-3.5 pb-1.5 min-h-[3.75rem] text-[26px] leading-normal text-slate-100 break-words" aria-live="polite">
                {convertedWords.map((w, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && ' '}
                    <span className={i === convertedWords.length - 1 && typingWord ? 'border-b-2 border-indigo-400' : ''}>{w}</span>
                  </React.Fragment>
                ))}
                {tailGap}
                {tail}
                {!output && <span className="text-slate-600 text-lg">Your {lang.name} text appears here</span>}
              </div>
              <div className="flex items-center gap-2.5 px-4 py-2 border-t border-dashed border-slate-800">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 shrink-0">Roman</span>
                <input
                  ref={romanRef}
                  id="keyboard-roman"
                  value={romanInput}
                  onChange={(e) => setRomanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (/^[1-5]$/.test(e.key) && suggestions[+e.key - 1]) {
                      e.preventDefault();
                      pickSuggestion(suggestions[+e.key - 1]);
                    }
                  }}
                  placeholder="e.g. namaste aap kaise hain"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Type in Roman letters"
                  className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[13.5px] text-slate-300 placeholder:font-sans placeholder-slate-600"
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 border-t border-slate-800 bg-slate-900" aria-label="Suggestions">
                <span className="text-[11.5px] text-slate-500 mr-0.5">
                  {typingWord ? `For “${typingWord}”` : 'Suggestions appear as you type'}
                </span>
                {suggestions.map((s, i) => (
                  <button
                    key={`${s}-${i}`}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className={`flex items-center gap-1.5 h-8 pl-1.5 pr-2.5 rounded-[9px] border text-base transition-colors cursor-pointer ${
                      i === 0 ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800'
                    }`}
                  >
                    <kbd className="w-[17px] h-[17px] rounded border border-slate-700 bg-slate-900 font-mono text-[10px] text-slate-400 flex items-center justify-center">
                      {i + 1}
                    </kbd>
                    {s}
                    {s === typingWord && <span className="text-[10.5px] text-slate-500">as typed</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onInsertTextToActiveSegment && (
                <button
                  type="button"
                  onClick={addToCue}
                  disabled={!output || !activeSegment}
                  className="h-[38px] px-4 flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ArrowRight className="w-4 h-4" /> {cueLabel ? `Add to ${cueLabel}` : 'Add to a cue'}
                </button>
              )}
              <button type="button" onClick={copyOutput} disabled={!output} className={ghost}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button type="button" onClick={clearPad} disabled={!output && !romanInput} className={ghost}>
                Clear
              </button>
              <span className="min-w-0 flex-1 sm:text-right text-xs text-slate-400 truncate">
                {activeSegment ? (
                  <>
                    Editing <span className="text-slate-200 font-medium">{cueLabel}</span>
                    <span className="text-slate-500"> · {targetOf(activeSegment) || 'empty'}</span>
                  </>
                ) : (
                  'Open the keyboard from a cue to add text to it'
                )}
              </span>
            </div>

            <div className="rounded-[14px] border border-slate-800 overflow-hidden">
              <div role="tablist" aria-label="Characters" className="flex gap-0.5 p-1.5 bg-slate-950/60 border-b border-slate-800 overflow-x-auto [scrollbar-width:none]">
                {([
                  ['vowels', 'Vowels'],
                  ['matras', 'Vowel signs'],
                  ['consonants', 'Consonants'],
                  ['marks', 'Marks & numbers'],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={paletteTab === id} onClick={() => setPaletteTab(id)} className={tabClass(paletteTab === id)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5 p-2.5">
                {paletteKeys.map((ch, i) => (
                  <button
                    key={`${ch}-${i}`}
                    type="button"
                    onClick={() => setTail((t) => t + ch)}
                    className="h-12 rounded-[9px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-700 active:translate-y-px text-[19px] text-slate-100 shadow-[0_1px_0_rgb(30_41_59)] cursor-pointer"
                    title={`Add ${ch}`}
                  >
                    {COMBINING.test(ch) ? `◌${ch}` : ch}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Help and tools */}
          <aside aria-label="Help and tools" className="border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/40 flex flex-col min-w-0">
            <div role="tablist" className="flex gap-0.5 px-3 pt-2.5 border-b border-slate-800">
              {([
                ['guide', 'Guide'],
                ['words', 'My words'],
                ['script', 'Whole script'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === id}
                  onClick={() => setSideTab(id)}
                  className={`flex-1 px-1.5 pt-2 pb-2.5 -mb-px border-b-2 text-[12.5px] font-medium transition-colors cursor-pointer ${
                    sideTab === id ? 'text-slate-100 border-indigo-400' : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="px-4 py-3.5 flex flex-col gap-3">
              {sideTab === 'guide' && (
                <>
                  <div className="flex flex-col">
                    {PHONETIC_CHEAT_SHEET.map((row, i) => (
                      <div key={row.roman} className={`flex flex-col gap-0.5 px-2.5 py-2 rounded-lg ${i % 2 === 0 ? 'bg-slate-900' : ''}`}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-xs text-slate-300">{row.roman}</span>
                          <span className="text-[10.5px] text-slate-500 text-right">{row.desc}</span>
                        </span>
                        <span className="text-[15px] text-slate-100">{row.sample}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11.5px] text-slate-400 leading-relaxed p-2.5 rounded-[10px] border border-dashed border-slate-700">
                    <span className="font-semibold text-slate-200">Capitals matter.</span> <span className="font-mono">t</span> and{' '}
                    <span className="font-mono">T</span> are different letters, as are <span className="font-mono">n</span> and{' '}
                    <span className="font-mono">N</span>. Double a vowel to make it long.
                  </p>
                </>
              )}

              {sideTab === 'words' && (
                <>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Names and terms that should always come out one way. Used here and in every cue.
                  </p>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                    <input
                      value={customRoman}
                      onChange={(e) => setCustomRoman(e.target.value)}
                      placeholder="sadhguru"
                      aria-label="Roman spelling"
                      className="min-w-0 h-9 bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 font-mono text-[13px] text-slate-100 placeholder-slate-600 focus:outline-none"
                    />
                    <input
                      value={customNative}
                      onChange={(e) => setCustomNative(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCustomWord()}
                      placeholder={transliterateTextOffline('sadhguru', selectedLang)}
                      aria-label={`${lang.name} spelling`}
                      className="min-w-0 h-9 bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-[9px] px-2.5 text-[14px] text-slate-100 placeholder-slate-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomWord}
                      disabled={!customRoman.trim() || !customNative.trim()}
                      className="h-9 px-3 rounded-[9px] border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 disabled:opacity-40 cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {customWordList.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">No words yet.</p>
                    ) : (
                      customWordList.map((w) => (
                        <div key={w.roman} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-[9px] bg-slate-900 border border-slate-800">
                          <span className="font-mono text-[12.5px] text-slate-400">{w.roman}</span>
                          <span className="text-[11px] text-slate-600">→</span>
                          <span className="text-[15px] text-slate-100 min-w-0 truncate">{w.native}</span>
                          <button
                            type="button"
                            onClick={() => {
                              deleteUserCustomWord(w.roman, lang.code);
                              setCustomWordList(listAllUserCustomWords(lang.code));
                            }}
                            className="ml-auto p-1 rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                            aria-label={`Delete ${w.roman}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              {sideTab === 'script' && (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[22px] font-semibold text-slate-100 tabular-nums">{latinCues.length}</span>
                      <span className="text-xs text-slate-400 leading-snug">
                        {latinCues.length === 1 ? 'cue still has' : 'cues still have'} English letters in {latinCues.length === 1 ? 'it' : 'them'}
                      </span>
                    </div>
                    {latinCues.length > 0 && (
                      <div className="rounded-[10px] border border-slate-800 overflow-hidden">
                        {latinCues.slice(0, 3).map(({ seg, i }) => (
                          <div key={seg.id} className="flex flex-col gap-0.5 px-2.5 py-2 border-t border-slate-800 first:border-t-0">
                            <span className="font-mono text-[11.5px] text-slate-500 truncate">
                              #{String(i + 1).padStart(2, '0')} · {targetOf(seg)}
                            </span>
                            <span className="text-[14.5px] text-slate-100 truncate">{transliterateTextOffline(targetOf(seg), selectedLang)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={convertLatinCues}
                      disabled={!onUpdateSegments || latinCues.length === 0 || isBatchConverting}
                      className={`${ghost} w-full`}
                    >
                      {isBatchConverting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      {isBatchConverting
                        ? 'Converting…'
                        : latinCues.length > 0
                          ? `Convert ${latinCues.length === 1 ? 'that cue' : `those ${latinCues.length} cues`}`
                          : 'Nothing to convert'}
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 pt-3 border-t border-slate-800">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Polish a line with AI</span>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Fixes vowel signs, joined letters and word choice the way a native speaker would. Uses your translation engine.
                    </p>
                    <textarea
                      value={polishInput}
                      onChange={(e) => setPolishInput(e.target.value)}
                      rows={3}
                      placeholder={`A ${lang.name} line to polish`}
                      aria-label="Line to polish"
                      className="w-full resize-none bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-[10px] px-3 py-2 text-[14px] leading-relaxed text-slate-100 placeholder-slate-600 focus:outline-none"
                    />
                    <button type="button" onClick={runPolish} disabled={!polishInput.trim() || isPolishing} className={`${ghost} w-full`}>
                      {isPolishing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      {isPolishing ? 'Polishing…' : 'Polish'}
                    </button>
                    {polishOutput && (
                      <div className="flex flex-col gap-2 p-2.5 rounded-[10px] bg-emerald-500/10 border border-emerald-500/30">
                        <span className="text-[14.5px] text-slate-100 leading-relaxed">{polishOutput}</span>
                        {polishNote && <span className="text-[11.5px] text-slate-400">{polishNote}</span>}
                        {activeSegment && onUpdateSegments && (
                          <button type="button" onClick={usePolished} className={`${ghost} w-full`}>
                            <Check className="w-3.5 h-3.5" /> Use it in {cueLabel}
                          </button>
                        )}
                      </div>
                    )}
                    {!polishOutput && polishNote && (
                      <p className="flex items-start gap-1.5 text-xs text-rose-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {polishNote}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>

        {notice && (
          <div
            role="status"
            className="absolute left-1/2 bottom-5 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-100 text-slate-950 text-[12.5px] font-medium shadow-2xl"
          >
            <Check className="w-3.5 h-3.5" /> {notice}
          </div>
        )}
      </section>
    </div>
  );
};
