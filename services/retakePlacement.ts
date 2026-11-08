/**
 * Whether a take used from the Retake window is cut and placed as Chunk sync
 * places a line (on), or plays whole where the line was (off). On unless the
 * user turned it off; kept in this browser only.
 */
const KEY = 'dhvani.retake.placeLikeSync';

export const readPlaceLikeSync = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};

export const writePlaceLikeSync = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Without storage it is on, as it is for everyone at first.
  }
};
