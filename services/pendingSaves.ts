/*
 * Saves of projects to this computer that have not finished yet.
 *
 * A save is a write to IndexedDB, and a big project (its audio, its takes)
 * can take a few seconds to write. Closing the window or restarting into an
 * update while one is under way would lose it, so the desktop app asks the
 * page to finish them first (window.__dhvaniWhenSaved, called from
 * desktop/main.cjs) and a browser tab asks before it is closed.
 */

const pending = new Set<Promise<unknown>>();

/** Counts `save` as under way until it settles, and hands it back. */
export const trackSave = <T>(save: Promise<T>): Promise<T> => {
  pending.add(save);
  const done = () => pending.delete(save);
  save.then(done, done);
  return save;
};

/** How many saves are under way. */
export const savesPending = (): number => pending.size;

/**
 * Settles once no save is under way, saves started meanwhile included. A save
 * that fails still counts as finished: it is reported where it was made.
 */
export const whenSaved = async (): Promise<void> => {
  while (pending.size > 0) await Promise.allSettled([...pending]);
};

if (typeof window !== 'undefined') {
  // The desktop shell calls this before it closes the window or installs an update.
  (window as unknown as { __dhvaniWhenSaved?: () => Promise<boolean> }).__dhvaniWhenSaved = () => whenSaved().then(() => true);
  // In a browser tab, closing while a save is under way asks first. The desktop app waits instead.
  window.addEventListener('beforeunload', (e) => {
    if (pending.size === 0 || 'dhvaniUpdates' in window) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
