/**
 * Remembers that a window was opened from Tools and settings, so that window
 * can show a Back button that brings the list back. The list marks the moment
 * it opens a tool; the next tool window to appear within a short while takes
 * that mark as its own and clears it, so a window opened some other way (a
 * line's Ctrl G, a button on a step) never shows Back.
 */

const FRESH_MS = 2000;
let openedAt = 0;

/** Called by the list right before it opens a tool. */
export const markOpenedFromTools = () => {
  openedAt = Date.now();
};

/** True when the window appearing now was opened from the list. Reading it changes nothing. */
export const openedFromTools = () => openedAt > 0 && Date.now() - openedAt < FRESH_MS;

/** Called once the window that took the mark is on screen. */
export const clearOpenedFromTools = () => {
  openedAt = 0;
};

/** Asks the header to open Tools and settings again. */
export const OPEN_TOOLS_EVENT = 'dhvani:open-tools';
export const reopenTools = () => window.dispatchEvent(new Event(OPEN_TOOLS_EVENT));
