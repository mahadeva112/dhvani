import React, { useEffect, useLayoutEffect, useRef } from 'react';

/** How long typing has to pause before an edited sentence is saved. */
const COMMIT_DELAY_MS = 400;

interface DocumentSegmentSpanProps {
  segmentId: string | number;
  value: string;
  /** Read-only spans (the source column) render the same way but cannot be typed into. */
  editable: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
  /*
   * Handlers take the segment's id so the parent can pass the same functions
   * to every span, and a span only re-renders when its own text or look changes.
   */
  onCommit?: (segmentId: string | number, text: string) => void;
  /** Moves the caret to a neighbouring sentence: -1 previous, 1 next. */
  onNavigate?: (segmentId: string | number, direction: -1 | 1, caret: 'start' | 'end') => void;
  onFocusChange?: (segmentId: string | number, focused: boolean) => void;
  onClick?: (segmentId: string | number, event: React.MouseEvent<HTMLSpanElement>) => void;
}

/** Characters between the start of the span and the caret, or null when the selection isn't a caret in it. */
const caretOffset = (el: HTMLElement): number | null => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
};

/** Focuses a sentence and puts the caret at its start or end. */
export const placeCaret = (el: HTMLElement, at: 'start' | 'end') => {
  el.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(at === 'start');
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
};

/**
 * One segment's text as an inline span, so sentences flow on as prose while
 * each stays its own editable unit.
 *
 * The span is uncontrolled while it has focus: React writing textContent on
 * every keystroke would throw the caret to the start. The text from props is
 * applied whenever the span isn't being typed into, and typing is saved after
 * a short pause, on blur, and when the view closes.
 */
export const DocumentSegmentSpan = React.memo(function DocumentSegmentSpan({
  segmentId,
  value,
  editable,
  className = '',
  placeholder,
  title,
  onCommit,
  onNavigate,
  onFocusChange,
  onClick,
}: DocumentSegmentSpanProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Text typed here that hasn't been saved yet.
  const dirty = useRef(false);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  /** Saves typed text; false when there was nothing to save. */
  const commit = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const el = ref.current;
    if (!dirty.current || !el) return false;
    dirty.current = false;
    const text = el.textContent ?? '';
    if (text === latest.current.value) return false;
    latest.current.onCommit?.(segmentId, text);
    return true;
  };

  // Text from elsewhere (another view, a QA fix, the phonetic keyboard) shows here unless it's being typed into.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || dirty.current || document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  // Leaving the view keeps what was typed.
  useEffect(
    () => () => {
      commit();
    },
    []
  );

  if (!editable) {
    return (
      <span
        ref={ref}
        data-seg-id={String(segmentId)}
        className={className}
        title={title}
        onClick={onClick ? (e) => onClick(segmentId, e) : undefined}
      />
    );
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el) return;
    // A line break would split the document, so Enter moves on to the next sentence instead.
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      onNavigate?.(segmentId, 1, 'start');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      onNavigate?.(segmentId, e.shiftKey ? -1 : 1, e.shiftKey ? 'end' : 'start');
      return;
    }
    if (e.key === 'Escape') {
      el.blur();
      return;
    }
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const offset = caretOffset(el);
    if (offset === null) return;
    // Arrowing past a sentence's edge carries on into the next, as in one document.
    if (e.key === 'ArrowRight' && offset >= (el.textContent ?? '').length) {
      e.preventDefault();
      onNavigate?.(segmentId, 1, 'start');
    } else if (e.key === 'ArrowLeft' && offset === 0) {
      e.preventDefault();
      onNavigate?.(segmentId, -1, 'end');
    }
  };

  // Pasted text joins the sentence: its line breaks become spaces.
  const handlePaste = (e: React.ClipboardEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\s*[\r\n]+\s*/g, ' ');
    // insertText keeps the paste on the browser's own undo stack.
    document.execCommand('insertText', false, text);
  };

  return (
    <span
      ref={ref}
      data-seg-id={String(segmentId)}
      data-placeholder={placeholder}
      contentEditable="plaintext-only"
      spellCheck={false}
      role="textbox"
      aria-multiline={false}
      aria-label={title}
      title={title}
      className={className}
      onClick={onClick ? (e) => onClick(segmentId, e) : undefined}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDrop={(e) => e.preventDefault()}
      onInput={() => {
        dirty.current = true;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, COMMIT_DELAY_MS);
      }}
      onFocus={() => onFocusChange?.(segmentId, true)}
      onBlur={() => {
        // Unsaved typing wins; otherwise text that changed elsewhere while this had focus shows now.
        const el = ref.current;
        if (!commit() && el && el.textContent !== latest.current.value) el.textContent = latest.current.value;
        onFocusChange?.(segmentId, false);
      }}
    />
  );
});
