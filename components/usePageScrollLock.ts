import { useLayoutEffect } from 'react';

/**
 * Holds the page still while a window is open over it: the page does not
 * scroll under the wheel, the keys or a scrollIntoView, and stays where it
 * was. When the last open window closes the page scrolls again from there.
 *
 * Boxes inside the page and the window (timelines, lists) still scroll; only
 * the page itself is held. Windows stack: each one counts, and the page is let
 * go when the count is back to none.
 */

let holders = 0;
let restore: (() => void) | null = null;

const hold = () => {
  holders += 1;
  if (holders > 1) return;
  const root = document.documentElement;
  const top = window.scrollY;
  const left = window.scrollX;
  // Keep the scrollbar's room so the page does not shift sideways when it goes.
  const hadScrollbar = window.innerWidth > root.clientWidth;
  const before = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
  root.style.overflow = 'hidden';
  if (hadScrollbar) root.style.scrollbarGutter = 'stable';
  // A page held by overflow can still be scrolled by code; put it straight back.
  const stay = () => {
    if (window.scrollY !== top || window.scrollX !== left) {
      window.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior });
    }
  };
  window.addEventListener('scroll', stay);
  restore = () => {
    window.removeEventListener('scroll', stay);
    root.style.overflow = before.overflow;
    root.style.scrollbarGutter = before.gutter;
    stay();
  };
};

const release = () => {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  restore?.();
  restore = null;
};

export const usePageScrollLock = (active = true) => {
  useLayoutEffect(() => {
    if (!active) return;
    hold();
    return release;
  }, [active]);
};

/** Holds the page still while it is on screen: put it inside a window's overlay. */
export const PageScrollLock = () => {
  usePageScrollLock();
  return null;
};
