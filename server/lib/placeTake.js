/**
 * A take put in the dub, cut and placed the way Chunk sync places a line.
 *
 * When the user uses a take in the takes panel it first goes in whole, its
 * first word where the line's was (services/syncTakes.ts putTake). With Chunk
 * sync on, the line is then split and placed as Sync would split and place
 * it (chunkLine in chunkSync.js, and the solve in syncDub.js placeChunks):
 * cut where it goes quiet and at the original's pauses, each block pulled
 * towards where the original says the same words, pauses shrunk in
 * punctuation order. Only this line moves: the lines either side stay where
 * they are now, as a locked line stays put in Sync, and the line fits
 * between them.
 *
 * Nothing changes the voice: the chunks are the take's own samples, at the
 * speed it was voiced, and only the silence between them is left out.
 */
import { chunkLine, kindOf, pauseFloor } from './chunkSync.js';
import { placeClips } from './syncPlace.js';
import { sourcePauseCuts } from './sourceCuts.js';
import { LOCK_WEIGHT, SOURCE_CUT_ROUNDS, SOURCE_CUT_SLACK } from './syncDub.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Where the user placed `unit` on Review's dub lane (DubPlace on its first
 * cue), as Sync reads it: `{ start, cuts }`, the cuts kept only while the
 * line says what it said when it was cut; null when it wasn't placed.
 */
export const placeOfCue = (cue, text) => {
  const place = cue?.dubPlace;
  if (!place || typeof place !== 'object') return null;
  const start = finite(place.start) ? Math.max(0, place.start) : null;
  const cuts = place.text === text && Array.isArray(place.cuts) ? place.cuts.filter((cut) => Number.isInteger(cut?.letters) && cut.letters > 0) : [];
  return start === null && cuts.length === 0 ? null : { start, cuts };
};

/** The cuts at the original's pauses the user turned off on Review's dub lane (DubPlace.skip). */
const skipsOf = (cue, text) => {
  const place = cue?.dubPlace;
  return place && place.text === text && Array.isArray(place.skip) ? place.skip : [];
};

/**
 * Splits and places one take.
 *
 * - `samples`, `sampleRate`, `lead`, `speech`: the take, as in the bank.
 * - `unit`, `prevUnit`, `nextUnit`: the line and its neighbours as Sync
 *   groups them (syncUnits.js); a neighbour is null when there is none.
 * - `cues`: the line's cues, in order. `nextPlacedStart`: where the next
 *   line's first word is meant to be heard (its DubPlace, else its original).
 * - `words`: the take's words by forced alignment, or null.
 * - `prev`, `next`: `{ start, end }` timeline seconds where the lines either
 *   side play now, or null; they don't move.
 * - `join`, `tolerance`, `timingProtection`, `sourceDuration`, `multiSpeaker`:
 *   as the sync ran with them.
 *
 * Returns `{ chunks, sourceCuts, cutNotMade, fits }`: `chunks` as the bank
 * keeps them (`{ from, to }` samples of the take, `startSample` on the
 * timeline), and `fits` false when the line could not be fitted between its
 * neighbours and its limits.
 */
export const placeTake = ({
  samples,
  sampleRate,
  lead,
  speech,
  unit,
  prevUnit = null,
  nextUnit = null,
  cues,
  nextPlacedStart = null,
  words = null,
  prev = null,
  next = null,
  join,
  tolerance,
  timingProtection = 'warn',
  sourceDuration = 0,
  multiSpeaker = false,
}) => {
  const chunkGaps = { gapShare: join.chunkGapShare, wordGap: join.wordGap, commaGap: join.commaGap, stopGap: join.stopGap, maxGap: join.maxChunkGap };
  const place = placeOfCue(cues[0], unit.text);
  const autoCuts = join.cutAtSourcePauses ? sourcePauseCuts(cues, unit.text, { minPause: join.sourceCutMinPause, skip: skipsOf(cues[0], unit.text) }) : [];
  const build = (off) => chunkLine({ samples, sampleRate, lead, speech, text: unit.text, cues, words, join, place, autoCuts, off });
  const placedStart = place?.start ?? unit.srcStart;
  const endLimit = join.endByVideo && sourceDuration > 0 ? sourceDuration + join.endSlack : Infinity;

  /** The least pause after line `u`, with `after` the line that follows it in the original (syncDub.js chunkGapAfter). */
  const joinGap = (u, after, tier) => {
    const overlap = multiSpeaker && u.speakerChangeAfter && after ? Math.max(0, u.srcEnd - after.srcStart) : 0;
    if (overlap > 0) return -overlap;
    const sourceGap = Math.max(0, u.gapAfter ?? 0);
    const gap = pauseFloor(kindOf(u.text.trim().split(/\s+/).at(-1) || ''), sourceGap, tier, chunkGaps);
    return u.speakerChangeAfter ? Math.max(gap, join.speakerGap) : gap;
  };

  const solve = (blocks, tier, caps) => {
    const items = [];
    // The lines either side are held where they play, as Sync holds a locked line.
    if (prev && prevUnit) {
      items.push({ want: prev.start, length: Math.max(0, prev.end - prev.start), gapAfter: joinGap(prevUnit, unit, tier), weight: LOCK_WEIGHT, fixed: true, earliest: prev.start, floor: Math.min(0, prev.start) });
    }
    const first = items.length;
    blocks.forEach((block, b) => {
      const after = blocks[b + 1];
      const gapAfter = after ? pauseFloor(after.kindBefore, after.pauseBefore, tier, chunkGaps) : next ? joinGap(unit, nextUnit, tier) : 0;
      // A part the user placed is held there: its first word where they put it.
      if (Number.isFinite(block.pin)) {
        const lead0 = block.chunks[0];
        const want = block.pin - (lead0.onset - lead0.from / sampleRate);
        items.push({ want, length: block.length, gapAfter, weight: LOCK_WEIGHT, fixed: true, earliest: want, floor: 0 });
        return;
      }
      // Each chunk pulls by its length (0.3 to 3) towards the start that puts its first sound on its target.
      let sum = 0;
      let weight = 0;
      for (const chunk of block.chunks) {
        const w = Math.max(0.3, Math.min(3, (chunk.to - chunk.from) / sampleRate));
        sum += w * (chunk.target - (chunk.at + chunk.onset - chunk.from / sampleRate));
        weight += w;
      }
      const want = sum / weight;
      const { length } = block;
      const preserveBefore = b === 0 && join.preserveLongPauses && unit.gapBefore >= join.protectedPause;
      const preserveAfter = b === blocks.length - 1 && join.preserveLongPauses && unit.gapAfter >= join.protectedPause;
      const strict = b === 0 && timingProtection === 'strict' ? want + join.maxLateStart : Infinity;
      const last = !nextUnit && b === blocks.length - 1;
      const capped = block.auto ? caps.get(block.auto) ?? Infinity : Infinity;
      const latest = Math.min(strict, preserveAfter ? unit.srcEnd - length : Infinity, last ? endLimit - length : Infinity, capped);
      items.push({
        want,
        length,
        ...(preserveBefore && { earliest: want }),
        ...(Number.isFinite(latest) && { latest }),
        gapAfter,
        weight: Math.max(0.3, Math.min(3, weight)) * (b === 0 && unit.hardAnchor ? join.anchorWeight : 1),
        floor: -(block.chunks[0].onset - block.chunks[0].from / sampleRate),
      });
    });
    if (next) items.push({ want: next.start, length: Math.max(0, next.end - next.start), gapAfter: 0, weight: LOCK_WEIGHT, fixed: true, earliest: next.start, floor: Math.min(0, next.start) });
    const conflicts = [];
    const placed = placeClips(items, { conflicts });
    const at = placed.slice(first, first + blocks.length);
    let worst = 0;
    blocks.forEach((block, k) => {
      for (const chunk of block.chunks) if (!chunk.follows) worst = Math.max(worst, Math.abs(at[k] + chunk.at + chunk.onset - chunk.from / sampleRate - chunk.target));
    });
    // The line didn't fit where a part of it, or the line after it, had to go later than its limits.
    const conflict = conflicts.some((k) => k >= first);
    return { at, worst, conflict };
  };
  // Pauses between words shrink first, then those at a comma, a sentence end's last, while any chunk is still out.
  const solveAll = (blocks, caps) => {
    let solved = solve(blocks, 2, caps);
    if (join.punctuationPriority) {
      for (const tier of [0, 1]) {
        const tried = solve(blocks, tier, caps);
        if (tried.worst <= tolerance) {
          solved = tried;
          break;
        }
      }
    }
    return solved;
  };
  /** How far the line's first word is from where it should be, and how far its end runs into the next line. */
  const fitOf = (blocks, { at }) => {
    const first = blocks[0].chunks[0];
    const end = at.at(-1) + blocks.at(-1).length;
    const over = nextUnit && unit.nextStart !== null ? Math.max(0, end - (nextPlacedStart ?? unit.nextStart)) : 0;
    return { start: Math.abs(at[0] + first.at + first.onset - first.from / sampleRate - placedStart), over };
  };

  const caps = new Map();
  let off = false;
  // The line with no cuts at pauses comes first, what they are measured against (syncDub.js settleSourceCuts).
  const uncut = autoCuts.length ? build(true).blocks : null;
  const base = uncut ? fitOf(uncut, solveAll(uncut, caps)) : null;
  let line = build(off);
  let solved = solveAll(line.blocks, caps);
  if (base && line.blocks.some((block) => block.auto)) {
    for (let round = 0; round < SOURCE_CUT_ROUNDS; round++) {
      let changed = false;
      line.blocks.forEach((block, k) => {
        if (!block.auto || k === 0) return;
        const before = solved.at[k - 1] + line.blocks[k - 1].length + block.pauseBefore;
        if (solved.at[k] - before <= join.sourceCutMaxInsert + 1e-3) return;
        caps.set(block.auto, before + join.sourceCutMaxInsert);
        changed = true;
      });
      const fit = fitOf(line.blocks, solved);
      if (!off && !(fit.over <= base.over + SOURCE_CUT_SLACK && fit.start <= base.start + 2 * SOURCE_CUT_SLACK)) {
        off = true;
        changed = true;
      }
      if (!changed) break;
      line = build(off);
      solved = solveAll(line.blocks, caps);
    }
  }

  const chunks = line.blocks.flatMap((block, k) =>
    block.chunks.map((chunk) => {
      let start = solved.at[k] + chunk.at;
      let from = chunk.from;
      // What would play before 0:00 is the pad before its first sound: it is left out.
      if (start < 0) {
        from = Math.min(chunk.to - 1, from + Math.round(-start * sampleRate));
        start = 0;
      }
      return { from, to: chunk.to, startSample: Math.max(0, Math.round(start * sampleRate)) };
    })
  );
  return { chunks, sourceCuts: line.sourceCuts, cutNotMade: line.cutNotMade, fits: !solved.conflict };
};
