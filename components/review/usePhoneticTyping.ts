import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPhoneticSuggestions, transliterateWordOffline } from '../../services/indicTransliteration';

const PHONETIC_KEY = 'dhvani_script_phonetic';
/** Keys that end a Roman word and turn it into the script. */
const ENDS_WORD = [' ', 'Enter', ',', '.', '?', '!', '।'];
/** The Roman word just before the caret; digits alone are left as they are. */
const romanAt = (text: string, pos: number) => {
  const word = text.substring(0, pos).match(/([a-zA-Z0-9]+)$/)?.[1] ?? '';
  return /[a-zA-Z]/.test(word) ? word : '';
};

export interface PhoneticPopup {
  word: string;
  suggestions: string[];
  selected: number;
  /** Where the caret sits in the window, for placing the list under it. */
  x: number;
  y: number;
}

/** Window position just below the caret of a textarea, measured on an invisible copy of it. */
const caretPoint = (ta: HTMLTextAreaElement) => {
  const cs = getComputedStyle(ta);
  const copy = document.createElement('div');
  for (const p of ['font', 'letterSpacing', 'padding', 'border', 'boxSizing', 'lineHeight', 'overflowWrap', 'wordBreak'] as const) {
    copy.style[p] = cs[p];
  }
  copy.style.width = `${ta.clientWidth}px`;
  copy.style.position = 'absolute';
  copy.style.visibility = 'hidden';
  copy.style.whiteSpace = 'pre-wrap';
  copy.textContent = ta.value.substring(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '​';
  copy.appendChild(mark);
  document.body.appendChild(copy);
  const box = ta.getBoundingClientRect();
  const x = box.left + mark.offsetLeft - ta.scrollLeft;
  const y = box.top + mark.offsetTop + mark.offsetHeight - ta.scrollTop;
  copy.remove();
  return { x, y };
};

/**
 * Phonetic typing for any number of plain textareas: Roman letters become the
 * script when a word ends, with the same suggestions and saved words as the
 * cue cards. The text lives with the caller, so each handler is handed the
 * textarea's value and the setter that writes it.
 */
export function usePhoneticTyping(language: string) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(PHONETIC_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [popup, setPopup] = useState<PhoneticPopup | null>(null);
  const latestLookup = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The last word turned into the script, so a Backspace right after brings the Roman letters back.
  const undo = useRef<{ ta: HTMLTextAreaElement; start: number; roman: string; converted: string; sep: string } | null>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  // The list is placed once, at the caret: when anything scrolls it would be left behind, so it closes.
  useEffect(() => {
    if (!popup) return;
    const close = () => setPopup(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [popup]);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      try {
        localStorage.setItem(PHONETIC_KEY, String(!on));
      } catch {
        /* the switch still works for this session */
      }
      return !on;
    });
    setPopup(null);
  }, []);

  const dismiss = useCallback(() => {
    latestLookup.current = '';
    setPopup(null);
  }, []);

  const lookUp = (ta: HTMLTextAreaElement, word: string) => {
    clearTimeout(timer.current);
    latestLookup.current = word;
    timer.current = setTimeout(async () => {
      let list: string[];
      try {
        list = await getPhoneticSuggestions(word, language, 5);
      } catch {
        list = [transliterateWordOffline(word, language), word].filter(Boolean);
      }
      // A slower lookup for an earlier prefix must not replace the current word's list.
      if (latestLookup.current !== word || document.activeElement !== ta) return;
      setPopup({ word, suggestions: list, selected: 0, ...caretPoint(ta) });
    }, 90);
  };

  /** Puts `converted` in place of the Roman word before the caret. */
  const replaceWord = (ta: HTMLTextAreaElement, setValue: (text: string) => void, converted: string, sep: string) => {
    const value = ta.value;
    const pos = ta.selectionStart;
    const roman = romanAt(value, pos);
    if (!roman) return;
    const start = pos - roman.length;
    const before = value.substring(0, start) + converted + sep;
    setValue(before + value.substring(pos));
    undo.current = { ta, start, roman, converted, sep };
    dismiss();
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(before.length, before.length);
    }, 0);
  };

  const pick = (ta: HTMLTextAreaElement, setValue: (text: string) => void, index: number) => {
    const choice = popup?.suggestions[index];
    if (choice) replaceWord(ta, setValue, choice, ' ');
  };

  /** True when the key was used for phonetic typing, so the caller leaves it alone. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, setValue: (text: string) => void): boolean => {
    const ta = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      toggle();
      return true;
    }
    if (!enabled) return false;

    const last = undo.current;
    if (e.key === 'Backspace' && last && last.ta === ta) {
      const end = last.start + last.converted.length + last.sep.length;
      if (ta.selectionStart === end && ta.selectionEnd === end && ta.value.substring(last.start, end) === last.converted + last.sep) {
        e.preventDefault();
        undo.current = null;
        setValue(ta.value.substring(0, last.start) + last.roman + ta.value.substring(end));
        setTimeout(() => {
          const pos = last.start + last.roman.length;
          ta.focus();
          ta.setSelectionRange(pos, pos);
          lookUp(ta, last.roman);
        }, 0);
        return true;
      }
    }
    if (e.key !== 'Backspace') undo.current = null;

    const roman = romanAt(ta.value, ta.selectionStart);
    const current = popup && popup.word === roman ? popup : null;
    if (current) {
      if (/^[1-5]$/.test(e.key) && Number(e.key) <= current.suggestions.length) {
        e.preventDefault();
        replaceWord(ta, setValue, current.suggestions[Number(e.key) - 1], ' ');
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : current.suggestions.length - 1;
        setPopup({ ...current, selected: (current.selected + step) % current.suggestions.length });
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        replaceWord(ta, setValue, current.suggestions[current.selected], ' ');
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return true;
      }
    }

    if (ENDS_WORD.includes(e.key) && roman) {
      e.preventDefault();
      const sep = e.key === 'Enter' ? '\n' : e.key;
      // Before the suggestions land, the offline spelling stands in.
      const converted = current ? current.suggestions[current.selected] : transliterateWordOffline(roman, language) || roman;
      replaceWord(ta, setValue, converted, sep);
      return true;
    }
    return false;
  };

  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!enabled || ['ArrowDown', 'ArrowUp', 'Tab', 'Escape', 'Enter'].includes(e.key)) return;
    const ta = e.currentTarget;
    const roman = romanAt(ta.value, ta.selectionStart);
    if (roman) lookUp(ta, roman);
    else dismiss();
  };

  return { enabled, toggle, popup, pick, dismiss, onKeyDown, onKeyUp };
}
