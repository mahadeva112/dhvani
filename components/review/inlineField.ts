import type { PhoneticField } from './usePhoneticTyping';

const fields = new WeakMap<HTMLElement, PhoneticField & { element: HTMLElement }>();

/**
 * A line of text typed in place (a contentEditable span) seen as a text box:
 * its text, the caret as character offsets, and where the caret sits on
 * screen. One object per element, so phonetic typing can tell boxes apart.
 */
export function inlineField(el: HTMLElement): PhoneticField & { element: HTMLElement } {
  const known = fields.get(el);
  if (known) return known;

  /** Characters before a point inside the element. */
  const offsetOf = (node: Node, offset: number) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(node, offset);
    return range.toString().length;
  };
  /** The text node and offset `pos` characters in. */
  const pointAt = (pos: number): [Node, number] => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = pos;
    let last: Text | null = null;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (left <= node.length) return [node, left];
      left -= node.length;
      last = node;
    }
    return last ? [last, last.length] : [el, 0];
  };
  const range = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    return el.contains(r.startContainer) && el.contains(r.endContainer) ? r : null;
  };

  const field = {
    element: el,
    get value() {
      return el.textContent || '';
    },
    get selectionStart() {
      const r = range();
      return r ? offsetOf(r.startContainer, r.startOffset) : (el.textContent || '').length;
    },
    get selectionEnd() {
      const r = range();
      return r ? offsetOf(r.endContainer, r.endOffset) : (el.textContent || '').length;
    },
    setSelectionRange(start: number, end: number) {
      const sel = window.getSelection();
      if (!sel) return;
      const r = document.createRange();
      r.setStart(...pointAt(start));
      r.setEnd(...pointAt(end));
      sel.removeAllRanges();
      sel.addRange(r);
    },
    focus() {
      el.focus({ preventScroll: true });
    },
    caretPoint() {
      const r = range();
      const rects = r?.getClientRects();
      const box = rects && rects.length ? rects[rects.length - 1] : r && r.getBoundingClientRect().height ? r.getBoundingClientRect() : el.getBoundingClientRect();
      return { x: box.left, y: box.bottom };
    },
  };
  fields.set(el, field);
  return field;
}

/** Puts the caret `pos` characters into an element typed in place (the end when past it). */
export const placeCaret = (el: HTMLElement, pos: number) => {
  el.focus({ preventScroll: true });
  const f = inlineField(el);
  const at = Math.min(Math.max(0, pos), f.value.length);
  f.setSelectionRange(at, at);
};
