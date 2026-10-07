import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPhoneticSuggestions, transliterateWordOffline } from '../../services/indicTransliteration';

/** Keys that end a Roman word and turn it into the script, as in the phonetic textarea. */
const COMMIT_KEYS = new Set([' ', ',', '.', '?', '!', '।']);
const ROMAN_WORD = /([a-zA-Z0-9]+)$/;

interface Lookup {
  word: string;
  options: string[];
  selected: number;
  /** Where the caret is on screen, for the suggestion strip. */
  at: { left: number; top: number };
}

interface UndoEntry {
  roman: string;
  inserted: string;
  /** Characters from the start of the span to the end of the inserted text. */
  end: number;
}

/** The text node and offset a character count from the start of an element lands on. */
const pointAt = (el: HTMLElement, offset: number): { node: Node; offset: number } => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) return { node, offset: left };
    left -= length;
    last = node;
  }
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : { node: el, offset: 0 };
};

/** Text before the caret and the caret's screen position, or null when the selection isn't a caret in el. */
const caretContext = (el: HTMLElement) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const rect = range.getClientRects()[0] ?? el.getBoundingClientRect();
  return { textBefore: before.toString(), left: rect.left, bottom: rect.bottom };
};

/** Selects characters [start, end) of el, so the next insertText replaces them. */
const selectChars = (el: HTMLElement, start: number, end: number) => {
  const a = pointAt(el, start);
  const b = pointAt(el, end);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
};

/**
 * Roman-to-script typing for a contentEditable sentence: type "namaste", and
 * Space or punctuation writes "नमस्ते". Number keys or Tab pick another
 * spelling from the strip under the caret, and Backspace straight after
 * brings the Roman letters back. Replacements go through insertText, so they
 * stay on the browser's own undo stack.
 */
export function usePhoneticSpan(ref: React.RefObject<HTMLElement | null>, language: string | null) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const pending = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undo = useRef<UndoEntry | null>(null);

  const close = () => {
    pending.current = '';
    if (timer.current) clearTimeout(timer.current);
    setLookup(null);
  };

  useEffect(() => {
    if (!language) close();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [language]);

  const replaceWord = (roman: string, chosen: string, separator: string) => {
    const el = ref.current;
    const ctx = el && caretContext(el);
    if (!el || !ctx || !ctx.textBefore.endsWith(roman)) return;
    const end = ctx.textBefore.length;
    selectChars(el, end - roman.length, end);
    const inserted = chosen + separator;
    document.execCommand('insertText', false, inserted);
    undo.current = { roman, inserted, end: end - roman.length + inserted.length };
    close();
  };

  /** Call from the span's keydown first; true when the key was used here. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>): boolean => {
    const el = ref.current;
    if (!language || !el || e.altKey || e.metaKey || e.ctrlKey) return false;

    if (e.key === 'Backspace' && undo.current) {
      const ctx = caretContext(el);
      const entry = undo.current;
      undo.current = null;
      if (ctx && ctx.textBefore.length === entry.end && ctx.textBefore.endsWith(entry.inserted)) {
        e.preventDefault();
        selectChars(el, entry.end - entry.inserted.length, entry.end);
        document.execCommand('insertText', false, entry.roman);
        return true;
      }
      return false;
    }
    if (e.key !== 'Backspace') undo.current = null;

    const ctx = caretContext(el);
    const roman = ctx?.textBefore.match(ROMAN_WORD)?.[1] ?? '';
    const current = lookup && lookup.word === roman && lookup.options.length > 0 ? lookup : null;

    if (current) {
      if (/^[1-5]$/.test(e.key) && Number(e.key) <= current.options.length) {
        e.preventDefault();
        replaceWord(roman, current.options[Number(e.key) - 1], ' ');
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setLookup({ ...current, selected: (current.selected + step + current.options.length) % current.options.length });
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        replaceWord(roman, current.options[current.selected], ' ');
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return true;
      }
    }

    if (COMMIT_KEYS.has(e.key) && roman && /[a-zA-Z]/.test(roman)) {
      e.preventDefault();
      // Before suggestions land, the offline rules give the spelling.
      const chosen = current ? current.options[current.selected] : transliterateWordOffline(roman, language) || roman;
      replaceWord(roman, chosen, e.key);
      return true;
    }
    return false;
  };

  /** Call from the span's input handler: looks up spellings for the word being typed. */
  const onInput = () => {
    const el = ref.current;
    if (!language || !el) return;
    const ctx = caretContext(el);
    const word = ctx?.textBefore.match(ROMAN_WORD)?.[1] ?? '';
    if (!ctx || !word || !/[a-zA-Z]/.test(word)) {
      close();
      return;
    }
    pending.current = word;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      let options: string[];
      try {
        options = await getPhoneticSuggestions(word, language, 5);
      } catch {
        options = [transliterateWordOffline(word, language), word].filter(Boolean);
      }
      // A slower lookup for an earlier prefix must not replace the current word's list.
      if (pending.current !== word || options.length === 0) return;
      setLookup({ word, options, selected: 0, at: { left: ctx.left, top: ctx.bottom + 6 } });
    }, 90);
  };

  const strip =
    lookup &&
    createPortal(
      <div
        role="listbox"
        aria-label="Spellings"
        className="fixed z-50 flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-700 shadow-xl text-xs"
        style={{ left: Math.min(lookup.at.left, window.innerWidth - 320), top: lookup.at.top }}
      >
        {lookup.options.map((option, i) => (
          <button
            key={option + i}
            type="button"
            role="option"
            aria-selected={i === lookup.selected}
            // Keeps the caret in the sentence.
            onMouseDown={(e) => {
              e.preventDefault();
              replaceWord(lookup.word, option, ' ');
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer ${
              i === lookup.selected ? 'bg-indigo-600 text-white' : 'text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span className="font-mono text-[10px] opacity-70">{i + 1}</span>
            {option}
          </button>
        ))}
      </div>,
      document.body
    );

  return { onKeyDown, onInput, onBlur: close, strip };
}
