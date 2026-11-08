/**
 * Where a take used from the Retake window goes, after it is put in whole:
 * - 'old': cut at the same words as the old take's parts and each part put
 *   where the old one was, under the original (fitTakeToParts);
 * - 'sync': cut and placed as Chunk sync places a line (placeTake.js).
 * 'old' unless the user picked otherwise; kept in this browser only.
 */
export type RetakePlacement = 'old' | 'sync';

const KEY = 'dhvani.retake.placement';

export const readRetakePlacement = (): RetakePlacement => {
  try {
    return localStorage.getItem(KEY) === 'sync' ? 'sync' : 'old';
  } catch {
    return 'old';
  }
};

export const writeRetakePlacement = (placement: RetakePlacement) => {
  try {
    localStorage.setItem(KEY, placement);
  } catch {
    // Without storage it is 'old', as it is for everyone at first.
  }
};
