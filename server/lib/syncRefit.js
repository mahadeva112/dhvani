/**
 * Fit to this video, once more, after the lines are voiced.
 *
 * Before a sync, how long the dub will run is only an estimate: the text at a
 * rate from a short sample read, which can be a few percent off and so land
 * in the wrong length band. Once Sync has voiced every line, it knows how long
 * the voice really took. Here, before anything is placed, that real length
 * picks the band (lengthBands.js), and the join settings for it are swapped
 * in, so the first Sync places the dub as a second Sync would.
 *
 * Only settings that decide where the voiced lines go may change: grouping
 * (which text each clip was voiced from) and the settings that voice lines
 * again stay as they are, so nothing is voiced anew. The app sends, for each
 * band, the join settings it would use (`candidates`: the band's preset with
 * Fit's measured gaps on it); none is sent for the user's own Custom
 * settings. As before a sync, the swap goes in only when the preview, run at
 * the rate the voice really read at, has no fewer cues in sync.
 */
import { BAND_PAUSE_MOVES, LENGTH_BANDS, lengthBandFor } from './lengthBands.js';
import { resolveJoinSettings } from './syncSettings.js';
import { previewSync } from './syncPreview.js';

/** Grouping, and what voices lines again: kept from the settings the lines were voiced with. */
export const KEPT_KEYS = ['unitGap', 'maxUnit', 'preserveLongPauses', 'protectedPause', 'speedFit', 'maxVoiceSpeed', 'bestTakes', 'maxRevoice'];

/** Settings that shape a clip when it is prepared (syncDub.js `fit`): a swap that moves one prepares the clips again. */
export const CLIP_KEYS = ['removeBreaths', 'breathReduction', 'tailFloorDb', 'tailHold'];

const BANDS = LENGTH_BANDS.map((band) => band.preset);

/**
 * How long the voice took over the lines against the original speaker: the
 * seconds from each line's first word to its last as voiced (`reads[i]`),
 * over the seconds the speaker took, as the app measures it after a sync
 * (services/syncPresets.ts `dubLengthRatio`). Null with nothing voiced.
 */
export const readLengthRatio = (units, reads) => {
  let read = 0;
  let spoken = 0;
  units.forEach((unit, i) => {
    const said = unit.srcEnd - unit.srcStart;
    if (!(reads[i] > 0) || !(said > 0)) return;
    read += reads[i];
    spoken += said;
  });
  return spoken > 0 ? read / spoken : null;
};

/** Fit's pause moves for a band, on top of `join` (the same moves syncFit.js makes). */
export const withBandMoves = (join, band) => {
  const moves = BAND_PAUSE_MOVES[band] || {};
  const next = { ...join };
  if (moves.shortenPauses) next.shortenPauses = true;
  if (moves.maxPauseTakeAtLeast > next.maxPauseTake) next.maxPauseTake = moves.maxPauseTakeAtLeast;
  if (moves.gapShareAtMost !== undefined && next.gapShare > moves.gapShareAtMost) next.gapShare = moves.gapShareAtMost;
  if (moves.gapShareAtLeast !== undefined && next.gapShare < moves.gapShareAtLeast) next.gapShare = moves.gapShareAtLeast;
  return next;
};

const cuesInSync = (preview) => preview.units.reduce((sum, unit) => sum + (unit.status === 'long' ? 0 : unit.cueIds.length), 0);

/**
 * Decides the swap. Returns null without a `refit` request, else
 * `{ status, from, to, ratio, join, inSync, clipsChanged }`: `status`
 * 'applied' (use `join`), 'same' (the band the settings were for), 'worse'
 * (the preview had fewer cues in sync with it), or 'unmeasured'.
 */
export const refitAfterVoicing = ({ refit, join, units, reads, segments, precision, sourceDuration = 0 }) => {
  if (!refit || typeof refit !== 'object') return null;
  const from = BANDS.includes(refit.from) ? refit.from : null;
  const ratio = readLengthRatio(units, reads);
  if (!from || ratio === null) return { status: 'unmeasured', from, to: null, ratio, join: null, inSync: null, clipsChanged: false };
  const to = lengthBandFor(ratio);
  const candidate = refit.candidates && typeof refit.candidates === 'object' ? refit.candidates[to] : null;
  if (to === from || !candidate || typeof candidate !== 'object') return { status: 'same', from, to, ratio, join: null, inSync: null, clipsChanged: false };

  const kept = Object.fromEntries(KEPT_KEYS.map((key) => [key, join[key]]));
  const proposed = withBandMoves(resolveJoinSettings({ ...candidate, ...kept }), to);

  // The rate the voice really read at, so the preview judges each line at about its voiced length.
  let chars = 0;
  let seconds = 0;
  units.forEach((unit, i) => {
    if (reads[i] > 0) {
      chars += unit.text.length;
      seconds += reads[i];
    }
  });
  const charsPerSecond = seconds > 0 ? chars / seconds : 0;
  const now = cuesInSync(previewSync({ segments, precision, charsPerSecond, sourceDuration, join }));
  const next = cuesInSync(previewSync({ segments, precision, charsPerSecond, sourceDuration, join: proposed }));
  const inSync = { before: now, after: next };
  if (next < now) return { status: 'worse', from, to, ratio, join: null, inSync, clipsChanged: false };
  return { status: 'applied', from, to, ratio, join: proposed, inSync, clipsChanged: CLIP_KEYS.some((key) => proposed[key] !== join[key]) };
};
