/**
 * A dub that is in sync with its source, built without changing the voice.
 *
 * 1. The translated cues are grouped into sync units, one per spoken phrase.
 * 2. Each unit is voiced as its own clip (stitched to its neighbours).
 * 3. Every clip is trimmed to the silence around it and measured against its
 *    slot: the time from its source phrase's start to the next phrase's start.
 * 4. A clip too long for its slot has the silent pauses between its words
 *    shortened, then every clip is placed by an isotonic solve (syncPlace.js).
 * 5. The clips are rendered into one track the length of the source, exactly
 *    as voiced: no speed change, no gain and no fades.
 * 6. The placement is measured against the source phrase by phrase.
 * 7. A line still too long for its slot gets a shorter wording suggested by
 *    the text model, and a line that ends well before the original speaker
 *    stops gets a fuller one. They are only suggestions: the dub says what the
 *    script says, and nothing is rewritten without the user.
 *
 * The voice, the text model and the codecs are passed in, so the whole run
 * can be tested with fakes.
 */
import { createHash } from 'node:crypto';
import { ApiError } from '../errors.js';
import { cancelledError } from './http.js';
import { buildSyncUnits, unitGapAfter } from './syncUnits.js';
import { resolveJoinSettings, dbToAmplitude } from './syncSettings.js';
import { placeClips, measureSync } from './syncPlace.js';
import { prepareClip, removeBreaths, shortenPauses, applyCuts, renderTimeline, startAfterCut } from './syncRender.js';
import { matchingGains } from './loudness.js';
import { TTS_CONTEXT_CHARS, withSentenceEnd } from './ttsText.js';
import { mixSpeakers, speakerGains } from './speakerMix.js';

/**
 * How tight the sync must be. `tolerance` is how far a line's first word may
 * sit from the source's; a clip running more than `allowedOverflow` past its
 * slot is reported as too long even when the placer absorbed it by nudging
 * its neighbours.
 */
export const SYNC_PRECISION = {
  lipsync: { tolerance: 0.08, allowedOverflow: 0.15 },
  phrase: { tolerance: 0.15, allowedOverflow: 0.3 },
  loose: { tolerance: 0.3, allowedOverflow: 0.6 },
};

/** Suggestions aim this far under the slot, since a new wording rarely lands exactly on its target. */
export const SUGGESTION_MARGIN = 0.92;

/**
 * A line whose speech takes less than this share of the time the original
 * speaker talks for is short: the dub goes quiet while the speaker is still
 * talking on screen. Dubbing adaptation treats under about 60% as too short.
 */
export const SHORT_SHARE = 0.6;

/** A short line must also leave at least this many seconds unspoken, or the gap is too small to see. */
export const MIN_SHORT_GAP = 1;

/**
 * A fuller wording aims to cover this share of the original speech: close to
 * all of it, with room for a voice that comes out a little slower.
 */
export const LENGTHEN_FILL = 0.95;

/** True when `speech` seconds of dub leave too much of `spoken` seconds of original unsaid. */
export const isShortLine = (speech, spoken) => speech < spoken * SHORT_SHARE && spoken - speech >= MIN_SHORT_GAP;

/** Hard anchors (after long pauses and speaker changes) pull this much harder in the solve. */
const HARD_ANCHOR_WEIGHT = 3;

/** A line the user locked in Edit timing pulls so hard that the solve leaves it where it is. */
const LOCK_WEIGHT = 1e6;

/** Names a clip by its samples, so a line can be recognised as the same take in a later sync. */
export const clipHash = (samples) => createHash('sha1').update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)).digest('hex');

/** Cuts sent back from an earlier sync, kept only when they are in order and inside the clip. */
const validCuts = (cuts, length) => {
  if (!Array.isArray(cuts)) return null;
  let last = 0;
  for (const cut of cuts) {
    if (!Number.isInteger(cut?.start) || !Number.isInteger(cut?.end) || cut.start < last || cut.end <= cut.start || cut.end > length) return null;
    last = cut.end;
  }
  return cuts.map(({ start, end }) => ({ start, end }));
};

/** A speaker's line may start this close to the end of their previous one before it counts as talking over themself. */
const SELF_OVERLAP_SLACK = 0.01;

/** Times a line the voice cut off mid-word is voiced again before it is reported instead. */
export const MAX_RETAKES = 2;

/** The seed of retake `attempt` of a line voiced with `seed` (none: the voice picked one). */
const retakeSeed = (seed, attempt) => ((Number.isInteger(seed) ? seed : 0) + attempt * 7919) % 2 ** 32;

/** Suggestions asked for at once. */
const SUGGESTION_CONCURRENCY = 4;


/**
 * A clip often opens with a soft breath or room noise before its first word
 * (below speech level, above silence). All of it is kept, but only this much
 * before the first word counts when clips are spaced out: the rest may overlap
 * the silent tail of the line before, where it is mixed in, never cut. With
 * `breathClear` on (the default) the whole pre-roll is spaced out instead.
 */
const LEAD_GUARD_SECONDS = 0.03;

/** The steps of a run, in order; `step` in progress reports counts from 1. */
export const SYNC_STEPS = ['units', 'voicing', 'fitting', 'placing', 'rendering', 'checking', 'suggesting'];

/**
 * Clips already voiced, by everything that decides how they sound, so a second
 * Sync (after a precision change, or a failed run) doesn't pay for lines it
 * already has. Oldest entries are dropped first.
 */
const CLIP_CACHE_LIMIT = 2000;
const clipCache = new Map();

const cacheKey = (voice, text) =>
  createHash('sha256')
    .update(JSON.stringify([voice.voiceId, voice.modelId, voice.outputFormat, voice.voiceSettings ?? null, voice.seed ?? null, text]))
    .digest('hex');

const remember = (key, buffer) => {
  clipCache.delete(key);
  clipCache.set(key, buffer);
  if (clipCache.size > CLIP_CACHE_LIMIT) clipCache.delete(clipCache.keys().next().value);
};

/** Forgets every cached clip. For tests. */
export const clearClipCache = () => clipCache.clear();

const hasWords = (text) => /[\p{L}\p{N}]/u.test(text);

/** A line's key: the id of its first cue, which a retake and the report both name it by. */
export const lineKey = (unit) => String(unit.cueIds[0]);

const mapLimit = async (items, limit, fn) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

/**
 * Runs a sync.
 *
 * `params`: `{ segments, sourceDuration, sampleRate, precision, join, suggest, suggestLonger, language, voice, voiceFor, multiSpeaker, peak, lineSeeds, matchLoudness, locked, debug }`,
 * where `join` is how lines are joined (gaps, pauses, tails and flags; see syncSettings.js, Natural when left out),
 * where `suggest` asks for shorter wordings of long lines and `suggestLonger` for fuller wordings of short ones (both on by default),
 * where `voice` is `{ voiceId, modelId, outputFormat, voiceSettings, seed }`,
 * `lineSeeds` maps a line's key (see lineKey) to the seed of a retake of it,
 * `matchLoudness` evens out the lines' loudness (off by default: each line is
 * kept at the level it was voiced at) and `debug` adds `report.audioDebug`,
 * a sample-exact account of every cut, placement, gain and fade.
 *
 * `locked` maps a line's key to a line the user placed by hand in Edit timing
 * and locked: `{ hash, cuts, crossfade, start, end }`, `hash` and `cuts` as
 * the bank (below) gave them and `start`/`end` the stretch of the timeline the
 * user's edits of it take. A locked line that comes back as the same take
 * (same hash) is cut exactly as before and held at `start`, every other line
 * placed around it; a line voiced differently this time is placed as usual,
 * and its bank line says it is no longer locked.
 *
 * With `multiSpeaker`, each line is voiced by `voiceFor(speaker)` (`voice`
 * when that returns nothing) and told only the lines either side by the same
 * speaker; where the original has two speakers talking over each other the
 * dub keeps that overlap rather than pushing the second line back; and the
 * track is mixed with one stem per speaker (see speakerMix.js), `peak`
 * deciding how a mix above full scale is handled and `matchLoudness` giving
 * one gain per speaker instead of one per line.
 *
 * `deps`:
 * - `voiceLines(lines, { voice, onLine })` → `[Buffer]`, voicing `[{ text, previousText, nextText, seed }]` in order with `voice`;
 * - `cue(texts)` → the same texts with delivery cues (Enhance emotion), every word kept (optional);
 * - `dubTakes(units)` → for each unit, its take cut from the Final dub (mono Float32Array at
 *   `sampleRate`) or null to voice it (optional; see dubTakes.js);
 * - `decode(buffer)` → mono Float32Array at `sampleRate`;
 * - `encode(samples, { float })` → `{ buffer, contentType }`, `float` asking for 32-bit float;
 * - `shorten({ text, sourceText, language, targetChars })` → a shorter wording, or null, or
 *   `{ line, reason }` with `reason` 'meaning' when every wording changed the meaning; throwing
 *   when the text model fails (optional);
 * - `lengthen({ text, sourceText, language, targetChars })` → a fuller wording, the same way (optional).
 *
 * Returns `{ buffer, contentType, report, bank }`, plus `stems` (`[{ speaker, buffer, contentType }]`)
 * with `multiSpeaker`. `bank` is every placed line exactly as the render took it, for Edit timing:
 * `{ sampleRate, samples, lines, speakerGains }`, `samples` holding the lines one after another and
 * `lines[n]` being `{ key, speaker, bankStart, length, startSample, maxStartShift, lead, speech, gain,
 * hash, cuts, crossfade, dropped, locked }`: where its samples are in `samples`, where the sync put
 * its first sample, how far its start edge may move, seconds from that sample to its first word and
 * of speech, its loudness-matching gain, and what a later sync needs to rebuild it the same way.
 * Rendering every bank line at its `startSample` with its `gain` (and `speakerGains`) is the dub.
 */
export const runSync = async (params, deps, { signal, onProgress = () => {} } = {}) => {
  const {
    segments,
    sourceDuration = 0,
    sampleRate,
    suggest = true,
    suggestLonger = true,
    language,
    voice,
    voiceFor,
    multiSpeaker = false,
    peak = 'float',
    lineSeeds = {},
    matchLoudness = false,
    locked = {},
    debug = false,
  } = params;
  const precision = SYNC_PRECISION[params.precision] ? params.precision : 'phrase';
  const { tolerance, allowedOverflow } = SYNC_PRECISION[precision];
  const join = resolveJoinSettings(params.join);
  const checkCancelled = () => {
    if (signal?.aborted) throw cancelledError('Sync');
  };

  const progress = { phase: 'units', step: 1, unitCount: 0, unitsVoiced: 0, unitsToVoice: 0, suggestionsTotal: 0, suggestionsDone: 0 };
  const report = (patch) => {
    Object.assign(progress, patch);
    onProgress({ ...progress });
  };
  report({});

  // 1. Units
  const units = buildSyncUnits(segments, join).filter((unit) => hasWords(unit.text));
  if (units.length === 0) {
    throw new ApiError('There are no translated lines to sync.', { status: 400, code: 'no_lines' });
  }
  report({ unitCount: units.length });

  // 2. Voicing. A retaken line is voiced with its own seed, which is a new take of it.
  report({ phase: 'voicing', step: 2 });
  const seedOf = (unit) => (Number.isInteger(lineSeeds[lineKey(unit)]) ? lineSeeds[lineKey(unit)] : voice.seed);
  const speakerOf = (unit) => unit.speaker || 'Speaker';
  const baseVoiceOf = (unit) => (multiSpeaker && voiceFor ? voiceFor(speakerOf(unit)) || voice : voice);
  const voiceOf = (unit) => ({ ...baseVoiceOf(unit), seed: seedOf(unit) });
  // The lines a line is told about: its neighbours, by the same speaker when there are several.
  const neighbour = (i, step) => {
    for (let j = i + step; j >= 0 && j < units.length; j += step) {
      if (!multiSpeaker || speakerOf(units[j]) === speakerOf(units[i])) return units[j];
    }
    return null;
  };
  // Takes cut from the Final dub (see dubTakes.js), used as they are. A line
  // the user asked to retake is voiced again even when the dub has it.
  const fromDub = deps.dubTakes ? await deps.dubTakes(units) : [];
  checkCancelled();
  const taken = units.map((unit, i) =>
    !Number.isInteger(lineSeeds[lineKey(unit)]) && fromDub?.[i] instanceof Float32Array && fromDub[i].length > 0 ? fromDub[i] : null
  );
  // What each line is voiced from: its text with any delivery tags, ending a
  // sentence so the voice finishes the last word.
  const voiceTexts = units.map((unit) => unit.voiceText || unit.text);
  if (deps.cue && taken.some((take) => !take)) {
    // Enhance emotion: each speaker's lines are cued together as one script, so the tone holds from line to line.
    const bySpeaker = new Map();
    units.forEach((unit, i) => {
      const key = multiSpeaker ? speakerOf(unit) : '';
      if (!bySpeaker.has(key)) bySpeaker.set(key, []);
      bySpeaker.get(key).push(i);
    });
    for (const indexes of bySpeaker.values()) {
      checkCancelled();
      const cued = await deps.cue(indexes.map((i) => voiceTexts[i]));
      if (Array.isArray(cued) && cued.length === indexes.length) {
        indexes.forEach((i, k) => {
          if (typeof cued[k] === 'string' && cued[k].trim()) voiceTexts[i] = cued[k];
        });
      }
    }
  }
  const spoken = voiceTexts.map(withSentenceEnd);
  const buffers = new Array(units.length);
  const clips = new Array(units.length);
  const voicedLength = new Array(units.length);
  const breathsRemoved = units.map(() => 0);
  const fit = async (i) => {
    const decoded = taken[i] || (await deps.decode(buffers[i]));
    voicedLength[i] = decoded.length;
    const { samples, removed } = join.removeBreaths ? removeBreaths(decoded, sampleRate) : { samples: decoded, removed: 0 };
    breathsRemoved[i] = removed;
    clips[i] = prepareClip(samples, sampleRate, { tailQuiet: dbToAmplitude(join.tailFloorDb), tailHold: join.tailHold });
  };

  /**
   * Voices lines `indexes` with `seedFor(unit)` as their seed, from the cache
   * where it has them, one run of requests per voice so all of a speaker's
   * lines are read as one, and fits each take.
   */
  let voicedSoFar = 0;
  const voiceAndFit = async (indexes, seedFor) => {
    const voiceWith = (i) => ({ ...baseVoiceOf(units[i]), seed: seedFor(units[i]) });
    const missing = [];
    for (const i of indexes) {
      const cached = clipCache.get(cacheKey(voiceWith(i), spoken[i]));
      if (cached) buffers[i] = cached;
      else missing.push(i);
    }
    report({ unitsToVoice: progress.unitsToVoice + missing.length });
    const groups = new Map();
    for (const i of missing) {
      const key = multiSpeaker ? speakerOf(units[i]) : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const group of groups.values()) {
      checkCancelled();
      const lines = group.map((i) => ({
        text: spoken[i],
        previousText: neighbour(i, -1)?.text.slice(-TTS_CONTEXT_CHARS),
        nextText: neighbour(i, 1)?.text.slice(0, TTS_CONTEXT_CHARS),
        seed: seedFor(units[i]),
      }));
      const before = voicedSoFar;
      const voiced = await deps.voiceLines(lines, {
        voice: baseVoiceOf(units[group[0]]),
        onLine: (done) => report({ unitsVoiced: before + done }),
      });
      group.forEach((i, n) => {
        buffers[i] = voiced[n];
        remember(cacheKey(voiceWith(i), spoken[i]), voiced[n]);
      });
      voicedSoFar += group.length;
    }
    checkCancelled();
    for (const i of indexes) await fit(i);
    checkCancelled();
  };

  await voiceAndFit(
    units.map((_, i) => i).filter((i) => !taken[i]),
    seedOf
  );
  for (let i = 0; i < units.length; i++) if (taken[i]) await fit(i);

  // A take the voice cut off before its last word died away is voiced again
  // with another seed, up to MAX_RETAKES times. A take the user locked in
  // Edit timing is theirs and is kept, and so is a take from the dub. Retake seeds follow from the line's own
  // seed, so a later sync finds the same takes in the cache.
  const retakes = units.map(() => 0);
  const heldByLock = (i) => {
    const lock = locked && typeof locked === 'object' ? locked[lineKey(units[i])] : null;
    return Boolean(lock) && lock.hash === clipHash(clips[i].samples);
  };
  for (let attempt = 1; attempt <= MAX_RETAKES; attempt++) {
    const cut = units.map((_, i) => i).filter((i) => clips[i]?.cutOff && !heldByLock(i) && !taken[i]);
    if (cut.length === 0) break;
    await voiceAndFit(cut, (unit) => retakeSeed(seedOf(unit), attempt));
    for (const i of cut) retakes[i] = attempt;
  }

  // How long the original speaker took over each line.
  const spokenOf = (i) => Math.max(0, units[i].srcEnd - units[i].srcStart);

  // 3. Fitting
  report({ phase: 'fitting', step: 3 });
  // Each take by its samples before any pause is shortened: a locked line is the same line only if this matches.
  const hashes = clips.map((clip) => (clip ? clipHash(clip.samples) : null));
  const lockOf = units.map((unit, i) => {
    const lock = locked && typeof locked === 'object' ? locked[lineKey(unit)] : null;
    if (!lock || !clips[i] || lock.hash !== hashes[i] || !(Number.isFinite(lock.start) && Number.isFinite(lock.end) && lock.end > lock.start)) return null;
    const cuts = validCuts(lock.cuts ?? [], clips[i].samples.length);
    return cuts ? { start: Math.max(0, lock.start), end: lock.end, cuts, crossfade: Math.max(0, Number(lock.crossfade) || 0) } : null;
  });

  /**
   * The part of clip `i` that is spaced out against its neighbours: from just
   * before its first word to the end of its tail. `head` is the pre-roll before
   * that, which may overlap the line before; none when breaths are kept clear.
   */
  const core = (i) => {
    const head = join.breathClear ? 0 : Math.max(0, clips[i].lead - LEAD_GUARD_SECONDS);
    return { head, lead: clips[i].lead - head, speech: clips[i].speech, length: clips[i].samples.length / sampleRate - head };
  };

  /**
   * How much of unit `i` the next speaker's line overlaps in the original,
   * with several speakers: a line started before the other speaker had
   * finished. The dub keeps that overlap instead of pushing the line back.
   */
  const overlapAfter = (i) =>
    multiSpeaker && units[i].speakerChangeAfter && units[i + 1] ? Math.max(0, units[i].srcEnd - units[i + 1].srcStart) : 0;
  /** The pause the dub must leave after unit `i`; negative where an overlap is kept. */
  const gapAfterUnit = (i) => (overlapAfter(i) > 0 ? -overlapAfter(i) : unitGapAfter(units[i], join));

  /** How long unit `i`'s core may be: from its wanted start to where the next clip's core wants to start, less a breath. */
  const budget = (i) => {
    const unit = units[i];
    const start = unit.srcStart - core(i).lead;
    const limit =
      unit.nextStart !== null
        ? unit.nextStart - (clips[i + 1] ? core(i + 1).lead : 0) - gapAfterUnit(i)
        : sourceDuration > 0
          ? Math.max(sourceDuration, unit.srcEnd) + 0.5
          : Infinity;
    return limit - start;
  };
  const overflow = (i) => (clips[i] ? core(i).length - budget(i) : 0);

  // 4. Placing: a clip that runs long first gives up silence between its words.
  report({ phase: 'placing', step: 4 });
  const pauseTrimmed = new Map();
  const pauseCuts = new Map();
  units.forEach((_, i) => {
    // A locked line is cut exactly as the sync it was edited on cut it, whatever the settings now say.
    if (lockOf[i]) {
      const { cuts, crossfade } = lockOf[i];
      if (cuts.length === 0) return;
      const samples = applyCuts(clips[i].samples, cuts, Math.round(crossfade * sampleRate));
      const removed = (clips[i].samples.length - samples.length) / sampleRate;
      clips[i] = { ...clips[i], samples, speech: clips[i].speech - removed };
      pauseTrimmed.set(i, removed);
      pauseCuts.set(i, cuts);
      return;
    }
    const excess = overflow(i);
    if (!join.shortenPauses || !clips[i] || excess <= 0) return;
    const { samples, removed, cuts } = shortenPauses(clips[i].samples, sampleRate, excess, {
      minPause: join.minInnerPause,
      maxTake: join.maxPauseTake,
      crossfade: join.spliceCrossfade,
    });
    if (removed > 0) {
      clips[i] = { ...clips[i], samples, speech: clips[i].speech - removed };
      pauseTrimmed.set(i, removed);
      pauseCuts.set(i, cuts);
    }
  });

  const placedIndex = units.map((_, i) => i).filter((i) => clips[i]);
  const cores = placedIndex.map((i) => core(i));
  const positions = placeClips(
    placedIndex.map((i, n) => {
      const unit = units[i];
      const lock = lockOf[i];
      // A locked line is one rigid block, the stretch its edits take, held where the user put it.
      if (lock) {
        return {
          want: lock.start,
          length: lock.end - lock.start,
          gapAfter: n < placedIndex.length - 1 ? gapAfterUnit(i) : 0,
          weight: LOCK_WEIGHT,
          earliest: lock.start,
          floor: 0,
        };
      }
      const want = unit.srcStart - cores[n].lead;
      return {
        want,
        length: cores[n].length,
        gapAfter: n < placedIndex.length - 1 ? gapAfterUnit(i) : 0,
        weight: unit.hardAnchor ? HARD_ANCHOR_WEIGHT : 1,
        earliest: want - tolerance,
        // Only the first word has to be inside the track; what comes before it may be dropped.
        floor: -cores[n].lead,
      };
    })
  );
  checkCancelled();

  // 5. Rendering. Each clip goes in with its pre-roll before its core. Only a
  // line at the very start can't fit what comes before its first word; the
  // part before 0:00 (silence, breath or noise, never a word) is dropped, on
  // a quiet sample so the line doesn't start on a step (see startAfterCut).
  report({ phase: 'rendering', step: 5 });
  const dropped = placedIndex.map(() => 0);
  const delayed = placedIndex.map(() => 0);
  const rendered = [];
  const placedClips = placedIndex.map((i, n) => {
    const speaker = speakerOf(units[i]);
    // A locked line's position is its first sample's: it has no pre-roll spaced out on its own.
    const start = positions[n] - (lockOf[i] ? 0 : cores[n].head);
    if (start >= 0) return { samples: clips[i].samples, position: start, speaker };
    const cut = startAfterCut(clips[i].samples, Math.round(-start * sampleRate), Math.round(clips[i].lead * sampleRate), sampleRate);
    dropped[n] = cut.from;
    delayed[n] = cut.delay;
    // Keeping a little more of the pre-roll starts the line that much later; the check below measures it there.
    positions[n] += cut.delay / sampleRate;
    return { samples: clips[i].samples.subarray(cut.from), startSample: 0, maxStartShift: 0, speaker };
  });
  const log = debug ? (entry) => rendered.push(entry) : undefined;
  // The gains are worked out here rather than inside the render so the bank can
  // carry them, and an edit render of the same lines comes out the same.
  const lineGains = !multiSpeaker && matchLoudness ? matchingGains(placedClips.map((clip) => clip.samples), sampleRate) : placedClips.map(() => 1);
  const voiceGains = multiSpeaker && matchLoudness ? speakerGains(placedClips, sampleRate) : new Map();
  const mixed = multiSpeaker
    ? mixSpeakers(placedClips, { sampleRate, length: sourceDuration, fadeSeconds: join.edgeFade, peak, gains: voiceGains, log })
    : null;
  const track = mixed
    ? mixed.mix
    : renderTimeline(
        placedClips.map((clip, n) => ({ ...clip, gain: lineGains[n] })),
        { sampleRate, length: sourceDuration, fadeSeconds: join.edgeFade, log }
      );
  const float = Boolean(mixed) && mixed.report.peak === 'float';
  const { buffer, contentType } = await deps.encode(track, { float });
  const stems = [];
  if (mixed) {
    for (const stem of mixed.stems) stems.push({ speaker: stem.speaker, ...(await deps.encode(stem.samples, { float })) });
  }
  checkCancelled();

  // The bank: every placed line exactly as the render took it, one after another.
  const bankSamples = new Float32Array(placedClips.reduce((sum, clip) => sum + clip.samples.length, 0));
  let bankAt = 0;
  const bankLines = placedIndex.map((i, n) => {
    const clip = placedClips[n];
    const bankStart = bankAt;
    bankSamples.set(clip.samples, bankAt);
    bankAt += clip.samples.length;
    return {
      key: lineKey(units[i]),
      speaker: clip.speaker,
      bankStart,
      length: clip.samples.length,
      // As renderTimeline rounds it.
      startSample: Math.max(0, Number.isInteger(clip.startSample) ? clip.startSample : Math.round(clip.position * sampleRate)),
      ...(clip.maxStartShift !== undefined && { maxStartShift: clip.maxStartShift }),
      lead: Math.max(0, clips[i].lead - dropped[n] / sampleRate),
      speech: clips[i].speech,
      gain: lineGains[n],
      hash: hashes[i],
      cuts: pauseCuts.get(i) || [],
      crossfade: lockOf[i] ? lockOf[i].crossfade : join.spliceCrossfade,
      dropped: dropped[n],
      locked: Boolean(lockOf[i]),
    };
  });
  const bank = { sampleRate, samples: bankSamples, lines: bankLines, speakerGains: Object.fromEntries(voiceGains) };

  // Where every sample of every line came from and where it went, for tracing an artifact to the step that made it.
  const audioDebug = debug
    ? {
        sampleRate,
        channels: 1,
        resampled: false,
        matchLoudness,
        output: { contentType, samples: track.length, encodes: 1 },
        lines: placedIndex.map((i, n) => {
          const { start: sourceStartSample, end: sourceEndSample, samples } = clips[i];
          // Where the clip's first sample would sit on the timeline had nothing been dropped from its start.
          const origin = rendered[n].timelineStartSample - rendered[n].edgeTrimStartSamples - dropped[n];
          // Pause cuts are counted in the clip before shortening; each join moves up by what the cuts before it took.
          let removedBefore = 0;
          const cuts = (pauseCuts.get(i) || []).map((cut) => {
            const join = cut.start - removedBefore;
            removedBefore += cut.end - cut.start;
            return {
              sourceStartSample: sourceStartSample + cut.start,
              sourceEndSample: sourceStartSample + cut.end,
              timelineJoinSample: origin + join,
              joinStep: Math.abs(samples[join] - samples[join - 1]),
            };
          });
          return {
            key: lineKey(units[i]),
            voicedSamples: voicedLength[i],
            sourceStartSample,
            sourceEndSample,
            pauseCuts: cuts,
            droppedBeforeZeroSamples: dropped[n],
            startDelaySamples: delayed[n],
            ...rendered[n],
          };
        }),
      }
    : undefined;

  // 6. Checking
  report({ phase: 'checking', step: 6 });
  const { lines, summary } = measureSync(placedIndex.map((i) => units[i]), cores, positions, { tolerance });
  const lineFor = new Map(placedIndex.map((i, n) => [i, lines[n]]));
  const exceededBy = units.map((_, i) => Math.max(0, overflow(i)));
  const exceeded = units.map((_, i) => {
    const line = lineFor.get(i);
    return Boolean(line) && (exceededBy[i] > allowedOverflow || (!line.inSync && exceededBy[i] > 0));
  });
  // A line pushed later than the user allows, and a join with too little silence between the words either side.
  const late = units.map((_, i) => Boolean(lineFor.get(i)) && lineFor.get(i).offset > join.maxLateStart);
  const joinAfter = new Map();
  placedIndex.forEach((i, n) => {
    if (n < placedIndex.length - 1) joinAfter.set(i, lines[n + 1].placedStart - lines[n].placedEnd);
  });
  // A kept overlap is not a tight join: the original speakers overlap there too.
  const tightJoin = units.map((_, i) => joinAfter.has(i) && overlapAfter(i) === 0 && joinAfter.get(i) < join.flagJoin);

  // With several speakers: the overlaps kept from the original, and any place
  // one speaker's lines run into each other (never wanted).
  let overlapsKept = 0;
  let selfOverlaps = 0;
  if (multiSpeaker) {
    const lastEnd = new Map();
    placedIndex.forEach((i, n) => {
      if (n < placedIndex.length - 1 && overlapAfter(i) > 0 && lines[n + 1].placedStart < lines[n].placedEnd) overlapsKept++;
      const speaker = speakerOf(units[i]);
      if (lastEnd.has(speaker) && lines[n].placedStart < lastEnd.get(speaker) - SELF_OVERLAP_SLACK) selfOverlaps++;
      lastEnd.set(speaker, Math.max(lastEnd.get(speaker) ?? 0, lines[n].placedEnd));
    });
  }

  // A line ends early when its words, as voiced, leave much of the original speech unsaid.
  const shortBy = units.map((_, i) => (lineFor.get(i) && !exceeded[i] && isShortLine(clips[i].speech, spokenOf(i)) ? spokenOf(i) - clips[i].speech : 0));

  /** Seconds the words of line `i` may take: its slot, less the silence around them. */
  const speechBudget = (i) => {
    const clip = core(i);
    return Math.max(0.2, budget(i) - clip.lead - (clip.length - clip.lead - clip.speech));
  };
  // The voice's own rate on this line turns seconds into characters.
  const targetChars = units.map((unit, i) => {
    if (exceeded[i]) return Math.max(1, Math.floor(unit.text.length * Math.min(1, speechBudget(i) / clips[i].speech) * SUGGESTION_MARGIN));
    if (shortBy[i] > 0) {
      const aim = Math.min(spokenOf(i) * LENGTHEN_FILL, speechBudget(i) * SUGGESTION_MARGIN);
      return Math.max(unit.text.length + 1, Math.floor(unit.text.length * (aim / clips[i].speech)));
    }
    return null;
  });

  // 7. Suggesting: a shorter wording for each line that is too long and a fuller
  // one for each line that ends early, for the user to take or leave.
  report({ phase: 'suggesting', step: 7 });
  const suggestions = new Map();
  let suggestionError = null;
  // Suggestions held back because every wording changed what the source line says.
  let meaningRejected = 0;
  const tooLong = units.map((_, i) => i).filter((i) => exceeded[i]);
  const tooShort = units.map((_, i) => i).filter((i) => shortBy[i] > 0);
  const asks = [
    ...(suggest && deps.shorten ? tooLong.map((i) => ({ i, ask: deps.shorten })) : []),
    ...(suggestLonger && deps.lengthen ? tooShort.map((i) => ({ i, ask: deps.lengthen })) : []),
  ];
  if (asks.length > 0) {
    report({ suggestionsTotal: asks.length });
    let done = 0;
    await mapLimit(asks, SUGGESTION_CONCURRENCY, async ({ i, ask }) => {
      checkCancelled();
      try {
        const answer = await ask({ text: units[i].text, sourceText: units[i].sourceText, language, targetChars: targetChars[i] });
        const line = typeof answer === 'string' || answer === null ? answer : answer?.line;
        if (line && line !== units[i].text) suggestions.set(i, line);
        else if (answer?.reason === 'meaning') meaningRejected++;
      } catch (err) {
        // The dub is finished either way; a missing suggestion must not fail the sync.
        suggestionError ??= err?.message || 'The text model did not answer.';
      }
      report({ suggestionsDone: ++done });
    });
  }

  const unitReports = units.map((unit, i) => {
    const line = lineFor.get(i);
    return {
      index: i,
      key: lineKey(unit),
      cueIds: unit.cueIds,
      speaker: unit.speaker || null,
      text: unit.text,
      sourceText: unit.sourceText,
      srcStart: unit.srcStart,
      srcEnd: unit.srcEnd,
      placedStart: line ? line.placedStart : null,
      placedEnd: line ? line.placedEnd : null,
      offset: line ? line.offset : null,
      overrun: line ? line.overrun : null,
      inSync: line ? line.inSync : false,
      silent: !line,
      exceeded: exceeded[i],
      exceededBy: exceededBy[i],
      short: shortBy[i] > 0,
      shortBy: shortBy[i],
      speech: clips[i] ? clips[i].speech : 0,
      targetChars: targetChars[i],
      suggestion: suggestions.get(i) || null,
      pauseTrimmed: pauseTrimmed.get(i) || 0,
      late: late[i],
      joinAfter: joinAfter.has(i) ? joinAfter.get(i) : null,
      tightJoin: tightJoin[i],
      retakes: retakes[i],
      fromDub: Boolean(taken[i]),
      cutOff: Boolean(clips[i]?.cutOff),
      breathsRemoved: breathsRemoved[i],
    };
  });

  return {
    buffer,
    contentType,
    bank,
    ...(mixed && { stems }),
    report: {
      precision,
      tolerance,
      join,
      duration: track.length / sampleRate,
      summary: {
        ...summary,
        lines: units.length,
        exceeded: tooLong.length,
        short: tooShort.length,
        // Suggestions asked for: long lines with `suggest` on, short ones with `suggestLonger` on.
        suggestionsAsked: asks.length,
        suggested: suggestions.size,
        meaningRejected,
        suggestionError,
        pauseTrimmed: pauseTrimmed.size,
        late: late.filter(Boolean).length,
        tightJoins: tightJoin.filter(Boolean).length,
        silent: units.length - placedIndex.length,
        retaken: retakes.filter((n) => n > 0).length,
        fromDub: taken.filter(Boolean).length,
        cutOff: clips.filter((clip) => clip?.cutOff).length,
        breathsRemoved: breathsRemoved.reduce((sum, n) => sum + n, 0),
      },
      units: unitReports,
      ...(mixed && { mix: { ...mixed.report, overlapsKept, selfOverlaps } }),
      ...(audioDebug && { audioDebug }),
    },
  };
};
