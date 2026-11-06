import React, { useLayoutEffect, useRef } from 'react';

/** The smallest a fitted line's text gets, in pixels: smaller than this it is read by zooming in. */
const MIN_FONT_PX = 6;

/**
 * Text that fits the box it is drawn in, which keeps its size: it breaks
 * between words first, and only when it still doesn't fit (or one word is
 * wider than the box) does the text get smaller, down to MIN_FONT_PX. A word
 * is never broken. Used for a whole line inside its bar on Review's lanes.
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
    let lastWidth = -1;
    const fit = () => {
      const width = outer.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      let size = maxPx;
      inner.style.fontSize = `${size}px`;
      const over = () => inner.offsetHeight > outer.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1;
      while (size > MIN_FONT_PX && over()) {
        size -= 0.5;
        inner.style.fontSize = `${size}px`;
      }
    };
    fit();
    // The bar widens and narrows with the zoom.
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [fitKey, maxPx]);
  return (
    <div ref={box} className={`absolute inset-0 flex flex-col justify-center overflow-hidden px-1.5 py-0.5 pointer-events-none ${className}`}>
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
