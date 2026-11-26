import React, { useLayoutEffect, useRef } from 'react';

/** The smallest a fitted line's text gets, in pixels: smaller than this it is read by zooming in. */
const MIN_FONT_PX = 6;
/** Font sizes are tried in steps of this many pixels. */
const FONT_STEP_PX = 0.5;
/** A bar narrower than this (px) shows no text at all, as in DaVinci: at that zoom a line is read by zooming in. */
export const FIT_TEXT_MIN_WIDTH_PX = 16;

/**
 * Every FitText on the page is fitted together, in a few rounds: each round
 * sets the size of every text still being fitted, then reads them all, so
 * the page is laid out once a round instead of once a step per bar (a
 * zoomed-out lane of 1500 lines froze the page for 115 s that way). Each
 * text's size is found by halving the sizes it can have.
 */
type Fit = {
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  maxPx: number;
  /** The box's width when last fitted; -1 to fit again whatever it is. */
  width: number;
};

const fits = new Map<Element, Fit>();
const pending = new Set<Fit>();
let scheduled = false;
let observer: ResizeObserver | null = null;

const sizeAt = (step: number) => MIN_FONT_PX + step * FONT_STEP_PX;
const overflows = ({ outer, inner }: Fit) => inner.offsetHeight > outer.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1;

const flush = () => {
  scheduled = false;
  const batch = [...pending].filter((f) => f.outer.isConnected);
  pending.clear();
  // Read every width first, then write: one layout for all of them.
  const widths = batch.map((f) => f.outer.clientWidth);
  const todo: { fit: Fit; lo: number; hi: number }[] = [];
  batch.forEach((fit, n) => {
    const width = widths[n];
    if (width === fit.width) return;
    fit.width = width;
    if (width < FIT_TEXT_MIN_WIDTH_PX) {
      fit.inner.style.display = 'none';
      return;
    }
    fit.inner.style.display = '';
    const top = Math.max(0, Math.round((fit.maxPx - MIN_FONT_PX) / FONT_STEP_PX));
    fit.inner.style.fontSize = `${sizeAt(top)}px`;
    todo.push({ fit, lo: 0, hi: top });
  });
  // The full size first: most lines fit at it, and are done in this round.
  let open = todo.filter((t) => {
    if (!overflows(t.fit)) {
      t.lo = t.hi;
      return false;
    }
    t.hi -= 1;
    return t.hi > t.lo;
  });
  // The largest size that fits, by halving; one that never fits ends at the smallest.
  while (open.length > 0) {
    const mids = open.map((t) => Math.ceil((t.lo + t.hi) / 2));
    open.forEach((t, n) => (t.fit.inner.style.fontSize = `${sizeAt(mids[n])}px`));
    const over = open.map((t) => overflows(t.fit));
    open.forEach((t, n) => {
      if (over[n]) t.hi = mids[n] - 1;
      else t.lo = mids[n];
    });
    open = open.filter((t) => t.hi > t.lo);
  }
  for (const t of todo) t.fit.inner.style.fontSize = `${sizeAt(t.lo)}px`;
};

const schedule = (fit: Fit) => {
  pending.add(fit);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
};

const resizeObserver = () =>
  (observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const fit = fits.get(entry.target);
      if (fit) schedule(fit);
    }
  }));

/**
 * Text that fits the box it is drawn in, which keeps its size: it breaks
 * between words first, and only when it still doesn't fit (or one word is
 * wider than the box) does the text get smaller, down to MIN_FONT_PX. A word
 * is never broken. In a box narrower than FIT_TEXT_MIN_WIDTH_PX it isn't
 * drawn. Used for a whole line inside its bar on Review's lanes.
 */
export const FitText: React.FC<{ maxPx?: number; className?: string; children: React.ReactNode; fitKey: string }> = ({
  maxPx = 12,
  className = '',
  children,
  fitKey,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = body.current;
    if (!outer || !inner) return;
    const fit: Fit = { outer, inner, maxPx, width: -1 };
    fits.set(outer, fit);
    schedule(fit);
    // The bar widens and narrows with the zoom.
    const ro = resizeObserver();
    ro.observe(outer);
    return () => {
      ro.unobserve(outer);
      fits.delete(outer);
      pending.delete(fit);
    };
  }, [fitKey, maxPx]);
  return (
    <div
      ref={box}
      className={`absolute inset-0 flex flex-col justify-center overflow-hidden px-1.5 py-0.5 pointer-events-none ${className}`}
      // Its text's size changes lay out this box only, never the page around it.
      style={{ contain: 'strict' }}
    >
      <div ref={body} className="leading-[1.15] break-normal" style={{ overflowWrap: 'normal' }}>
        {children}
      </div>
    </div>
  );
};

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/** How wide `text` is at `px` pixels in the app's font, measured once. */
const textWidth = (text: string, px: number) => {
  const key = `${px}|${text}`;
  const known = widthCache.get(key);
  if (known !== undefined) return known;
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `${px}px ${getComputedStyle(document.body).fontFamily}`;
  const width = measureCtx.measureText(text).width;
  if (widthCache.size > 5000) widthCache.clear();
  widthCache.set(key, width);
  return width;
};

/**
 * A word squeezed into a box `boxPx` wide: drawn at `px` and narrowed
 * (not cut) when it is wider than the box. Nothing in a box too narrow to
 * hold a letter. Used for a word inside its block on Review's lanes.
 */
export const SqueezedWord: React.FC<{ text: string; boxPx: number; px?: number }> = ({ text, boxPx, px = 11 }) => {
  const room = boxPx - 4;
  if (room < 3) return null;
  const natural = textWidth(text, px);
  const scale = natural > room ? room / natural : 1;
  return (
    <span className="inline-block whitespace-nowrap" style={{ fontSize: px, transform: scale < 1 ? `scaleX(${scale})` : undefined }}>
      {text}
    </span>
  );
};
