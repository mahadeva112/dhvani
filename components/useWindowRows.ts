import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** Lists this short draw every row; windowing them is not worth what it costs. */
export const WINDOW_ROWS_FROM = 80;
/** Rows drawn before the list has a height to go by (it is hidden, or not laid out yet). */
const FIRST_ROWS = 40;

export interface WindowRows {
  /** The rows to draw: positions `start` up to (not including) `end`. */
  start: number;
  end: number;
  /** Heights of the spacers before and after them, standing in for the rows not drawn. */
  padTop: number;
  padBottom: number;
  /** On the element before the first row (the top spacer), so the rows' place in the scroller is known. */
  spacerRef: (el: HTMLElement | null) => void;
  /** On each row drawn, so its real height replaces the estimate. */
  rowRef: (position: number) => (el: HTMLElement | null) => void;
  /** Scrolls a row into view, drawn or not: to the middle, or the least distance. */
  scrollToRow: (position: number, align?: 'center' | 'nearest') => void;
  isDrawn: (position: number) => boolean;
}

/**
 * The rows to draw for a view `height` tall, `top` below the first row, with
 * `overscan` more either side. `offsets[i]` is where row i starts, and the
 * last entry where the rows end. Before the list has a height, its first rows.
 */
export const rowsInView = (offsets: ArrayLike<number>, top: number, height: number, overscan: number) => {
  const count = offsets.length - 1;
  if (height <= 0) return { start: 0, end: Math.min(count, FIRST_ROWS) };
  const from = top - overscan;
  const to = top + height + overscan;
  // The first row ending below `from`, and the first starting below `to`.
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= from) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < to) lo = mid + 1;
    else hi = mid;
  }
  return { start, end: Math.max(start, lo) };
};

/**
 * Draws only the rows of a long list that are in view, and a screen's worth
 * either side, with spacers for the rest: a 2-hour project has thousands of
 * subtitles or segments, and drawing them all made every change in the list
 * (the line being heard, a split) take half a second. Each row's height is
 * estimated until it has been drawn, then measured.
 *
 * `scroller` is the element that scrolls the rows; `count` the rows there
 * are; `estimate(position)` a row's height before it is measured;
 * `keyOf(position)` keeps a measured height with its row when rows are added
 * or removed above it; `data` is anything whose change changes the
 * estimates (the rows themselves); `gap` the space the scroller puts
 * between rows (a flex gap).
 */
export function useWindowRows({
  scroller,
  count,
  estimate,
  keyOf,
  data,
  gap = 0,
  overscan = 900,
}: {
  scroller: React.RefObject<HTMLElement | null>;
  count: number;
  estimate: (position: number) => number;
  keyOf?: (position: number) => string;
  data?: unknown;
  gap?: number;
  overscan?: number;
}): WindowRows {
  const windowed = count >= WINDOW_ROWS_FROM;
  const [view, setView] = useState({ top: 0, height: 0 });
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const heights = useRef(new Map<string, number>());
  const rows = useRef(new Map<number, HTMLElement>());
  const spacer = useRef<HTMLElement | null>(null);
  /** Reads the scroller's place now, for a scroll made here: its rows are drawn without waiting for the scroll event. */
  const readView = useRef<(() => void) | null>(null);
  const fn = useRef({ estimate, keyOf });
  fn.current = { estimate, keyOf };
  const keyAt = (position: number) => fn.current.keyOf?.(position) ?? String(position);

  // Where each row starts, from the top of the first: measured heights where there are some, estimates elsewhere.
  const offsets = useMemo(() => {
    const out = new Float64Array(count + 1);
    if (!windowed) return out;
    for (let i = 0; i < count; i++) out[i + 1] = out[i] + (heights.current.get(keyAt(i)) ?? fn.current.estimate(i)) + gap;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, windowed, measuredVersion, data, gap]);

  /** How far below the top of the scroller's content the first row starts. */
  const base = () => {
    const el = scroller.current;
    const top = spacer.current;
    if (!el || !top) return 0;
    return top.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  };

  // Follows the scroller's scroll and size (the browser sends both at most once a frame).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !windowed) return;
    const read = () => {
      const next = { top: el.scrollTop - base(), height: el.clientHeight };
      setView((v) => (Math.abs(v.top - next.top) < 1 && v.height === next.height ? v : next));
    };
    read();
    readView.current = read;
    el.addEventListener('scroll', read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      readView.current = null;
      el.removeEventListener('scroll', read);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, windowed]);

  const { start, end } = windowed ? rowsInView(offsets, view.top, view.height, overscan) : { start: 0, end: count };

  // Measures the rows just drawn; a row above the view that grew or shrank moves the scroll with it, so what is read stays put.
  useLayoutEffect(() => {
    if (!windowed) return;
    let changed = false;
    let above = 0;
    for (const [position, el] of rows.current) {
      if (!el.isConnected) continue;
      const h = el.getBoundingClientRect().height;
      const key = keyAt(position);
      const was = heights.current.get(key) ?? fn.current.estimate(position);
      if (Math.abs(h - was) < 0.5) continue;
      heights.current.set(key, h);
      changed = true;
      if (offsets[position + 1] <= view.top) above += h - was;
    }
    if (!changed) return;
    const el = scroller.current;
    if (el && above) el.scrollTop += above;
    setMeasuredVersion((v) => v + 1);
  });

  const spacerRef = useCallback((el: HTMLElement | null) => {
    spacer.current = el;
  }, []);
  const rowRef = useCallback(
    (position: number) => (el: HTMLElement | null) => {
      if (el) rows.current.set(position, el);
      else rows.current.delete(position);
    },
    []
  );

  const latest = useRef({ offsets, start, end, windowed });
  latest.current = { offsets, start, end, windowed };
  const scrollToRow = useCallback(
    (position: number, align: 'center' | 'nearest' = 'nearest') => {
      const el = scroller.current;
      const { offsets: at, windowed: on } = latest.current;
      if (!el || position < 0) return;
      if (!on) {
        rows.current.get(position)?.scrollIntoView({ block: align });
        return;
      }
      if (position >= at.length - 1) return;
      const top = base() + at[position];
      const height = at[position + 1] - at[position];
      if (align === 'center') el.scrollTop = top - (el.clientHeight - height) / 2;
      else if (top < el.scrollTop) el.scrollTop = top;
      else if (top + height > el.scrollTop + el.clientHeight) el.scrollTop = top + height - el.clientHeight;
      readView.current?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scroller]
  );
  const isDrawn = useCallback((position: number) => position >= latest.current.start && position < latest.current.end, []);

  return {
    start,
    end,
    padTop: windowed ? offsets[start] : 0,
    padBottom: windowed ? offsets[count] - offsets[end] : 0,
    spacerRef,
    rowRef,
    scrollToRow,
    isDrawn,
  };
}
