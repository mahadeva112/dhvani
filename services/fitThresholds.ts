/*
 * The thresholds the server's preview uses (server/lib/syncPreview.js and
 * syncDub.js), so a line re-timed or re-placed here is called long, tight or
 * short exactly as the server would call it at the same length.
 */

/** Seconds a line may run past its slot at each precision (SyncPrecision) before it is long. */
export const ALLOWED_OVERFLOW: Record<'lipsync' | 'phrase' | 'loose', number> = { lipsync: 0.15, phrase: 0.3, loose: 0.6 };
export const TIGHT_SHARE = 0.9;
export const SUGGESTION_MARGIN = 0.92;
export const LENGTHEN_FILL = 0.95;
const SHORT_SHARE = 0.6;
const MIN_SHORT_GAP = 1;
/** True when `seconds` of dub leave too much of `spoken` seconds of original unsaid. */
export const isShortSpeech = (seconds: number, spoken: number) => seconds < spoken * SHORT_SHARE && spoken - seconds >= MIN_SHORT_GAP;
