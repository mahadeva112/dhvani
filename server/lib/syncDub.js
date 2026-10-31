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
import { prepareClip, removeBreaths, shortenPauses, tightenSilences, composeCuts, applyCuts, renderTimeline, startAfterCut, TIGHT_BLEND_SECONDS } from './syncRender.js';
import { matchingGains } from './loudness.js';
import { TTS_CONTEXT_CHARS, withSentenceEnd } from './ttsText.js';
import { stripPauses } from './linePauses.js';
import { mixSpeakers, speakerGains } from './speakerMix.js';
import { tooDeepCut } from './syncRewrite.js';
import { validateAlignedWords, measureWordTiming } from './syncWordTiming.js';
import { sourcePausesOf } from './sourcePauses.js';
import { splitChunks, chunkTargets, wordKinds, kindOf, pauseFloor, linePauses, joinSpokenBlocks, RIGID_GAP_SECONDS } from './chunkSync.js';
import { takeDiffers } from './takeChecks.js';
import { readStoredClip, storeClip } from './clipStore.js';

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
    if (cut.blend !== undefined && !(Number.isInteger(cut.blend) && cut.blend >= 0)) return null;
    last = cut.end;
  }
  return cuts.map(({ start, end, blend }) => (blend === undefined ? { start, end } : { start, end, blend }));
};

/** A speaker's line may start this close to the end of their previous one before it counts as talking over themself. */
const SELF_OVERLAP_SLACK = 0.01;

/** Fit by voice speed: a line this much too long (seconds) is voiced faster... */
const SPEED_FIT_MIN_OVER = 0.05;
/** ...aiming this far under its time, since a faster read rarely lands exactly... */
const SPEED_FIT_MARGIN = 1.03;
/** ...and not for less than this: a read barely faster is not worth a new take. */
const SPEED_FIT_MIN = 1.02;

/**
 * Whether `voice` reads faster when its speed is raised. Measured 2026-10-15
 * on one Hindi line: Eleven v3, v4 and v4 Turbo take the same 5.26 s at
 * speed 1 and 1.15 (they ignore it), Multilingual v2 goes from 3.22 s to
 * 2.74 s; v1 models reject speed, and of Cartesia's only sonic-3 takes it.
 */
export const followsSpeed = (voice) =>
  voice?.cartesia ? !voice.modelId || /^sonic-3/.test(voice.modelId) : !/^eleven_v[34]/.test(voice?.modelId || '') && !/_v1$/.test(voice?.modelId || '');

/**
 * Whether `voice` reads faster when asked to in words: Eleven v3 and v4,
 * which ignore speed, perform PACE_DIRECTION (measured 2026-10-17 on one
 * Hindi line: 5.27 s plain, 4.66 s with it, same pitch).
 */
export const followsPace = (voice) => !voice?.cartesia && /^eleven_v[34]/.test(voice?.modelId || '');

/** The pace direction a v3 or v4 voice reads a line faster with: faster, still calm. */
export const PACE_DIRECTION = '[calm, fast]';

/** Takes of a line that runs long compared to find one that fits (Best of 3 takes), and where their seeds start. */
export const BEST_TAKES = 3;
const BEST_TAKE_OFFSET = 200;

/** Forced alignments by take and text: a take aligned once isn't sent again on the next sync. */
const ALIGNMENT_CACHE_LIMIT = 2000;
const alignmentCache = new Map();

/** Times a line the voice cut off mid-word is voiced again before it is reported instead. */
export const MAX_RETAKES = 2;

/**
 * Takes voiced of a line the user asks to retake, the best fitting one kept,
 * when the retake does not say how many (`lineTakes`): retakes asked for
 * before the count could be picked. Each costs a voicing of the line.
 */
export const RETAKE_TAKES = 3;
/** The most takes a retake may ask for. */
export const MAX_RETAKE_TAKES = 3;
/** Where those takes' seeds start, clear of the seeds of cut-off retakes (1 to MAX_RETAKES). */
const RETAKE_TAKE_OFFSET = 100;

/** The seed of retake `attempt` of a line voiced with `seed` (none: the voice picked one). */
const retakeSeed = (seed, attempt) => ((Number.isInteger(seed) ? seed : 0) + attempt * 7919) % 2 ** 32;

/** Suggestions asked for at once. */
const SUGGESTION_CONCURRENCY = 4;
/** Lines either side of one being reworded that its prompt reads it with, as Review's do. */
const SUGGESTION_CONTEXT = 2;


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
 * already has. Oldest entries are dropped first. Each is also kept on disk
 * (clipStore.js), so a dub cut short by a closed or crashed app resumes too.
 */
const CLIP_CACHE_LIMIT = 2000;
const clipCache = new Map();

const cacheKey = (voice, text) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        voice.voiceId,
        voice.modelId,
        voice.outputFormat,
        voice.voiceSettings ?? null,
        voice.steady === true,
        voice.seed ?? null,
        voice.tuneStability === false,
        text,
        // A line read faster to fit (speedScale) is a take of its own; one read as voiced keeps its old key.
        ...(Number.isFinite(voice.speedScale) && voice.speedScale !== 1 ? [voice.speedScale] : []),
      ])
    )
    .digest('hex');

const keep = (key, buffer) => {
  clipCache.delete(key);
  clipCache.set(key, buffer);
  if (clipCache.size > CLIP_CACHE_LIMIT) clipCache.delete(clipCache.keys().next().value);
};

const remember = (key, buffer) => {
  const stored = clipCache.get(key) === buffer;
  keep(key, buffer);
  if (stored) return;
  storeClip(key, buffer).catch(() => {});
};

/** A clip voiced before under `key`, from memory or else from disk, or null. */
const recall = async (key) => {
  const held = clipCache.get(key);
  if (held) return held;
  const stored = await readStoredClip(key);
  if (stored) keep(key, stored);
  return stored;
};

/** Forgets every cached clip. For tests. */
/** Forgets every voiced clip and every alignment of one. */
export const clearClipCache = () => {
  clipCache.clear();
  alignmentCache.clear();
};

/** A clip voiced before with exactly this voice and text, or null; for takes (see syncTakes.js). */
export const cachedClip = (voice, text) => recall(cacheKey(voice, text));
/** Keeps a clip a take voiced, as Sync keeps its own. */
export const rememberClip = (voice, text, buffer) => remember(cacheKey(voice, text), buffer);

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
 * `params`: `{ segments, sourceDuration, sampleRate, precision, join, suggest, suggestLonger, keep, language, voice, voiceFor, multiSpeaker, peak, lineSeeds, lineTakes, matchLoudness, locked, debug }`,
 * where `join` is how lines are joined (gaps, pauses, tails and flags; see syncSettings.js, Natural when left out),
 * where `suggest` asks for shorter wordings of long lines and `suggestLonger` for fuller wordings of short ones (both on by default),
 * `keep` the glossary terms a wording must keep exactly,
 * where `voice` is `{ voiceId, modelId, outputFormat, voiceSettings, seed }`,
 * `lineSeeds` maps a line's key (see lineKey) to the seed of a retake of it,
 * `lineTakes` a retaken line's key to how many takes of it to voice (1 to
 * MAX_RETAKE_TAKES; RETAKE_TAKES when left out),
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
 * - `voiceLines(lines, { voice, onLine, readCount })` → `[Buffer]`, voicing `[{ text, previousText, nextText, seed }]` in order
 *   with `voice`; `readCount` is how many lines the whole dub has, so a retake of one line is voiced
 *   with the same settings as the rest of the read;
 * - `cue(texts)` → the same texts with delivery cues (voice expression Expressive), every word kept (optional);
 * - `dubTakes(units)` → for each unit, its take cut from the Final dub (mono Float32Array at
 *   `sampleRate`) or null to voice it (optional; see dubTakes.js);
 * - `pickedTakes(units)` → for each unit, the take the user picked in the takes panel, as the
 *   bank holds it (`{ samples, lead, speech, cutOff }`, already fitted), or null (optional);
 *   a picked take is used exactly as it is, unless the user asked to retake the line;
 * - `decode(buffer)` → mono Float32Array at `sampleRate`;
 * - `encode(samples, { float })` → `{ buffer, contentType }`, `float` asking for 32-bit float;
 * - `shorten({ text, sourceText, language, targetChars, context, keep })` → a shorter wording, or null, or
 *   `{ line, reason }` with `reason` 'meaning' when every wording changed the meaning; throwing
 *   when the text model fails (optional);
 * - `lengthen({ text, sourceText, language, targetChars, context, keep })` → a fuller wording, the same way (optional).
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
    keep = [],
    language,
    voice,
    voiceFor,
    multiSpeaker = false,
    peak = 'float',
    lineSeeds = {},
    lineTakes = {},
    matchLoudness = false,
    locked = {},
    debug = false,
    verifyWords = false,
    timingProtection = 'warn',
    takeChoices = {},
    declinedTakes = [],
  } = params;
  const precision = SYNC_PRECISION[params.precision] ? params.precision : 'phrase';
  const { tolerance, allowedOverflow } = SYNC_PRECISION[precision];
  const join = resolveJoinSettings(params.join);
  // Chunk sync: each line placed as the chunks of speech between its pauses (see chunkSync.js).
  const chunked = join.chunkSync;
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
  /**
   * The take the user chose for a line in Review (a better fitting take, or
   * one read faster): its seed and how it was read. Gone once the line is
   * retaken or its words change.
   */
  const choiceOf = (unit) => {
    if (Number.isInteger(lineSeeds[lineKey(unit)])) return null;
    const choice = takeChoices && typeof takeChoices === 'object' ? takeChoices[lineKey(unit)] : null;
    return choice && choice.text === unit.text ? choice : null;
  };
  const seedOf = (unit) =>
    Number.isInteger(lineSeeds[lineKey(unit)]) ? lineSeeds[lineKey(unit)] : Number.isInteger(choiceOf(unit)?.seed) ? choiceOf(unit).seed : voice.seed;
  /** How a chosen take was read: faster by speed, or by a pace direction. */
  const readOf = (unit) => {
    const choice = choiceOf(unit);
    if (!choice) return {};
    return { ...(Number.isFinite(choice.speedScale) && choice.speedScale !== 1 && { speedScale: choice.speedScale }), ...(choice.pace && { performanceTags: true }) };
  };
  const speakerOf = (unit) => unit.speaker || 'Speaker';
  const baseVoiceOf = (unit) => (multiSpeaker && voiceFor ? voiceFor(speakerOf(unit)) || voice : voice);
  const voiceOf = (unit) => ({ ...baseVoiceOf(unit), ...readOf(unit), seed: seedOf(unit) });
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
  // A take the user picked from the takes panel is kept as it is, already fitted.
  const pickedTakes = deps.pickedTakes ? deps.pickedTakes(units) : [];
  const picked = units.map((unit, i) => {
    const take = pickedTakes?.[i];
    return !Number.isInteger(lineSeeds[lineKey(unit)]) && take?.samples instanceof Float32Array && take.samples.length > 0 ? take : null;
  });
  const taken = units.map((unit, i) =>
    picked[i]
      ? picked[i].samples
      : !Number.isInteger(lineSeeds[lineKey(unit)]) && fromDub?.[i] instanceof Float32Array && fromDub[i].length > 0
        ? fromDub[i]
        : null
  );
  // What each line is voiced from: its text with any delivery tags, ending a
  // sentence so the voice finishes the last word.
  const voiceTexts = units.map((unit) => unit.voiceText || unit.text);
  if (deps.cue && taken.some((take) => !take)) {
    // Expressive: each speaker's lines are cued together as one script, so the tone holds from line to line.
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
  /** What line `i` is voiced from: with the pace direction of a take chosen read faster. */
  const textOf = (i) => (choiceOf(units[i])?.pace ? `${choiceOf(units[i]).pace} ${spoken[i]}` : spoken[i]);
  const buffers = new Array(units.length);
  const clips = new Array(units.length);
  const voicedLength = new Array(units.length);
  const breathsRemoved = units.map(() => 0);
  const fit = async (i) => {
    if (picked[i]) {
      const { samples, lead, speech, cutOff } = picked[i];
      voicedLength[i] = samples.length;
      clips[i] = { samples, lead, speech, start: 0, end: samples.length, cutOff: Boolean(cutOff) };
      return;
    }
    const decoded = taken[i] || (await deps.decode(buffers[i]));
    voicedLength[i] = decoded.length;
    const { samples, removed } = join.removeBreaths ? removeBreaths(decoded, sampleRate, { reduction: join.breathReduction }) : { samples: decoded, removed: 0 };
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
    const voiceWith = (i) => ({ ...baseVoiceOf(units[i]), ...readOf(units[i]), seed: seedFor(units[i]) });
    const missing = [];
    for (const i of indexes) {
      const cached = await recall(cacheKey(voiceWith(i), textOf(i)));
      if (cached) buffers[i] = cached;
      else missing.push(i);
    }
    report({ unitsToVoice: progress.unitsToVoice + missing.length });
    const groups = new Map();
    for (const i of missing) {
      // A chosen take read faster is voiced on its own: its speed is the voice's for that request.
      const key = `${multiSpeaker ? speakerOf(units[i]) : ''}|${JSON.stringify(readOf(units[i]))}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (const group of groups.values()) {
      checkCancelled();
      const lines = group.map((i) => ({
        text: textOf(i),
        previousText: neighbour(i, -1)?.text.slice(-TTS_CONTEXT_CHARS),
        nextText: neighbour(i, 1)?.text.slice(0, TTS_CONTEXT_CHARS),
        seed: seedFor(units[i]),
      }));
      const before = voicedSoFar;
      const voiced = await deps.voiceLines(lines, {
        voice: { ...baseVoiceOf(units[group[0]]), ...readOf(units[group[0]]) },
        onLine: (done, n, buffer) => {
          report({ unitsVoiced: before + done });
          // Kept as each line arrives, so a run that stops part way has paid for no line twice.
          if (Number.isInteger(n) && buffer) remember(cacheKey(voiceWith(group[n]), textOf(group[n])), buffer);
        },
        readCount: units.length,
      });
      group.forEach((i, n) => {
        buffers[i] = voiced[n];
        remember(cacheKey(voiceWith(i), textOf(i)), voiced[n]);
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

  // A line the user asked to retake is voiced as many times as asked, and the take
  // that best fits its slot is kept: one that finishes its last word, then
  // one that runs least past the slot, then one closest to how long the
  // original speaker took. The takes' seeds follow from the line's own, so a
  // later sync finds them in the cache and keeps the same one.
  const slotOf = (unit) => Math.max(0.05, (unit.nextStart ?? unit.srcEnd + 0.5) - unit.srcStart);
  const takeScore = (clip, unit) =>
    !clip
      ? Infinity
      : (clip.cutOff ? 1000 : 0) + Math.max(0, clip.speech - slotOf(unit)) * 10 + Math.abs(clip.speech - Math.max(0, unit.srcEnd - unit.srcStart));
  const askedRetake = units.map((_, i) => i).filter((i) => Number.isInteger(lineSeeds[lineKey(units[i])]) && !taken[i]);
  const takesAsked = (i) => {
    const n = lineTakes?.[lineKey(units[i])];
    return Number.isInteger(n) ? Math.min(MAX_RETAKE_TAKES, Math.max(1, n)) : RETAKE_TAKES;
  };
  const takesCompared = units.map((_, i) => (askedRetake.includes(i) ? 1 : 0));
  if (askedRetake.length > 0) {
    const best = new Map(askedRetake.map((i) => [i, { buffer: buffers[i], clip: clips[i], length: voicedLength[i], breaths: breathsRemoved[i] }]));
    for (let take = 1; take < MAX_RETAKE_TAKES; take++) {
      const more = askedRetake.filter((i) => take < takesAsked(i));
      if (more.length === 0) break;
      await voiceAndFit(more, (unit) => retakeSeed(seedOf(unit), RETAKE_TAKE_OFFSET + take));
      for (const i of more) {
        takesCompared[i]++;
        if (takeScore(clips[i], units[i]) < takeScore(best.get(i).clip, units[i])) {
          best.set(i, { buffer: buffers[i], clip: clips[i], length: voicedLength[i], breaths: breathsRemoved[i] });
        }
      }
    }
    for (const [i, kept] of best) {
      buffers[i] = kept.buffer;
      clips[i] = kept.clip;
      voicedLength[i] = kept.length;
      breathsRemoved[i] = kept.breaths;
    }
  }

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
      join.preserveLongPauses && unit.gapAfter >= join.protectedPause
        ? unit.srcEnd
        : unit.nextStart !== null
        ? unit.nextStart - (clips[i + 1] ? core(i + 1).lead : 0) - gapAfterUnit(i)
        : sourceDuration > 0
          ? Math.max(sourceDuration, unit.srcEnd) + 0.5
          : Infinity;
    return limit - start;
  };
  const overflow = (i) => (clips[i] ? core(i).length - budget(i) : 0);

  // 4. Placing: a clip pauses only where the original speaker did (matchSourcePauses),
  // and a clip that runs long first gives up silence between its words.
  report({ phase: 'placing', step: 4 });
  const segmentById = new Map(segments.map((cue) => [cue?.id, cue]));
  const sourcePauses = units.map((unit) => (join.matchSourcePauses ? sourcePausesOf(unit.cueIds.map((id) => segmentById.get(id))) : null));
  const sourcePauseTrimmed = new Map();
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
    if (!clips[i]) return;
    // With Chunk sync a line that runs long gives up the pauses between its chunks instead;
    // a pause the original never made goes all the same, chunk or no chunk.
    const excess = join.shortenPauses && !chunked ? Math.max(0, overflow(i)) : 0;
    const source = sourcePauses[i] ? { lead: clips[i].lead, speech: clips[i].speech, pauses: sourcePauses[i], keep: join.unmatchedPause } : null;
    if (excess <= 0 && !source) return;
    const { samples, removed, cuts, matched } = shortenPauses(clips[i].samples, sampleRate, excess, {
      minPause: join.minInnerPause,
      maxTake: join.maxPauseTake,
      crossfade: join.spliceCrossfade,
      protectAbove: join.preserveLongPauses ? join.protectedPause : Infinity,
      source,
    });
    if (removed > 0) {
      clips[i] = { ...clips[i], samples, speech: clips[i].speech - removed };
      pauseTrimmed.set(i, removed);
      pauseCuts.set(i, cuts);
      if (matched > 0) sourcePauseTrimmed.set(i, matched);
    }
  });

  // A line still too long once its pauses are shortened tightens its silences:
  // its tail, then the pauses between its words, measured against its own
  // room tone (see tightenSilences). With checkCutWords, forced alignment
  // first says where its words are, and no cut comes near one; a line whose
  // words can't be timed is left as it is rather than cut blind.
  const silenceTightened = new Map();
  const cutCheckErrors = new Map();
  if (join.tightenSilences) {
    const tightOptions = (i, protect = []) => ({
      firstWord: Math.round(clips[i].lead * sampleRate),
      minPause: join.tightMinPause,
      margin: join.tightMargin,
      blend: Math.round(Math.max(TIGHT_BLEND_SECONDS, join.spliceCrossfade) * sampleRate),
      protect,
    });
    // Only lines with silence to give: a line that has none needs no alignment request.
    const toTighten = units
      .map((_, i) => i)
      .filter((i) => clips[i] && !lockOf[i] && overflow(i) > 1 / sampleRate && tightenSilences(clips[i].samples, sampleRate, overflow(i), tightOptions(i)).removed > 0);
    await mapLimit(toTighten, 2, async (i) => {
      checkCancelled();
      let protect = [];
      if (join.checkCutWords) {
        try {
          if (!deps.align) throw new Error('Word alignment is unavailable.');
          const { words } = await deps.align({ samples: clips[i].samples, text: units[i].text, sampleRate });
          checkCancelled();
          protect = validateAlignedWords(words, units[i].text, clips[i].samples.length / sampleRate)
            .filter((word) => /[\p{L}\p{N}]/u.test(String(word.text ?? '')))
            .map((word) => ({ start: Math.floor(word.start * sampleRate), end: Math.ceil(word.end * sampleRate) }));
        } catch (error) {
          checkCancelled();
          cutCheckErrors.set(i, error.message || 'Word timing could not be checked.');
          return;
        }
      }
      const { samples, removed, cuts } = tightenSilences(clips[i].samples, sampleRate, overflow(i), tightOptions(i, protect));
      if (removed <= 0) return;
      // What came out between the first word and the last sound shortens the speech.
      const from = clips[i].lead * sampleRate;
      const to = from + clips[i].speech * sampleRate;
      const inSpeech = cuts.reduce((sum, cut) => sum + Math.max(0, Math.min(cut.end, to) - Math.max(cut.start, from)), 0) / sampleRate;
      clips[i] = { ...clips[i], samples, speech: clips[i].speech - inSpeech };
      pauseCuts.set(i, composeCuts(pauseCuts.get(i) || [], cuts, Math.round(join.spliceCrossfade * sampleRate)));
      pauseTrimmed.set(i, (pauseTrimmed.get(i) || 0) + removed);
      silenceTightened.set(i, removed);
    });
  }

  // Chunk sync times every line's words once, with checkCutWords: no split is
  // made inside a word, and a line whose words can't be timed stays whole.
  /** Line `samples`' words, by forced alignment, checked to cover `text`; from the cache when this take was aligned before. */
  const alignedWords = async (samples, text) => {
    const key = `${clipHash(samples)}|${text}`;
    if (alignmentCache.has(key)) return alignmentCache.get(key);
    if (!deps.align) throw new Error('Word alignment is unavailable.');
    const { words } = await deps.align({ samples, text, sampleRate });
    const checked = validateAlignedWords(words, text, samples.length / sampleRate);
    alignmentCache.delete(key);
    alignmentCache.set(key, checked);
    if (alignmentCache.size > ALIGNMENT_CACHE_LIMIT) alignmentCache.delete(alignmentCache.keys().next().value);
    return checked;
  };
  const chunkWords = new Map();
  if (chunked && join.checkCutWords) {
    const toAlign = units.map((_, i) => i).filter((i) => clips[i] && !lockOf[i]);
    let aligned = 0;
    report({ phase: 'placing', step: 4, wordChecksTotal: toAlign.length, wordChecksDone: 0 });
    await mapLimit(toAlign, 6, async (i) => {
      checkCancelled();
      try {
        const words = await alignedWords(clips[i].samples, units[i].text);
        checkCancelled();
        chunkWords.set(i, words);
      } catch (error) {
        checkCancelled();
        cutCheckErrors.set(i, error.message || 'Word timing could not be checked.');
      }
      report({ wordChecksDone: ++aligned });
    });
    report({ phase: 'placing', step: 4 });
  }

  // Chunk sync, line by line (see chunkSync.js and placeChunks below).
  const spokenWord = (word) => /[\p{L}\p{N}]/u.test(String(word?.text ?? ''));
  const chunkGaps = { gapShare: join.chunkGapShare, wordGap: join.wordGap, commaGap: join.commaGap, stopGap: join.stopGap, maxGap: join.maxChunkGap };
  /**
   * Line `i` as Chunk sync splits it: its chunks in blocks said in one breath,
   * each chunk with its first sound (`onset`, seconds into the line) and where
   * that should land (`target`), each block with the pause before it and how
   * the script reads there. A locked line is one block, the whole line.
   * Every block has its `length` in seconds and each chunk its `at`, seconds
   * from its block's start; with joinSpokenChunks, blocks the original says
   * in one go are one block (see joinSpokenBlocks).
   */
  const chunkLineOf = (i) => {
    const unit = units[i];
    const clip = clips[i];
    if (lockOf[i]) return { i, locked: true, blocks: [{ from: 0, to: clip.samples.length, length: clip.samples.length / sampleRate, chunks: [{ from: 0, to: clip.samples.length, at: 0 }] }] };
    const words = chunkWords.get(i) || null;
    // Without the words, and asked to check against them, the line isn't split blind: it stays whole.
    const whole = join.checkCutWords && !words;
    const protect = words ? words.filter(spokenWord).map((word) => ({ start: Math.floor(word.start * sampleRate), end: Math.ceil(word.end * sampleRate) })) : [];
    const split = splitChunks(clip.samples, sampleRate, {
      openDb: join.gateOpenDb,
      hysteresisDb: join.gateHysteresisDb,
      minSlice: join.minSliceLength,
      minSilence: join.minSilenceLength,
      leadPad: join.leadPad,
      trailPad: join.trailPad,
      protect,
    });
    // Only the silence before its first sound and after its last goes from a line kept whole.
    const chunks = whole ? [{ from: split[0].from, to: split.at(-1).to }] : split;
    // Where each chunk's first sound is, in seconds into the line: its first word, or past its leading pad.
    const onsets = chunks.map((chunk, k) => {
      const word = words?.find((w) => spokenWord(w) && w.end * sampleRate > chunk.from && w.start * sampleRate < chunk.to);
      if (word) return Math.max(chunk.from / sampleRate, word.start);
      return k === 0 ? Math.max(chunk.from / sampleRate, clip.lead) : Math.min(chunk.to, chunk.from + Math.round(join.leadPad * sampleRate)) / sampleRate;
    });
    const cues = unit.cueIds.map((id) => segmentById.get(id)).filter(Boolean).sort((a, b) => a.startTime - b.startTime);
    const targets = chunkTargets({ onsets, words, cues, lead: clip.lead, speech: clip.speech });
    const kinds = words ? wordKinds(unit.text, words) : null;
    // How the script reads at the pause before the chunk starting at `from`: after the last word before it.
    const kindBefore = (from) => {
      if (!words) return 'word';
      let kind = 'word';
      words.forEach((word, w) => {
        if (spokenWord(word) && word.end * sampleRate <= from + 0.02 * sampleRate) kind = kinds[w];
      });
      return kind;
    };
    // Chunks said in one breath move as one block.
    const blocks = [];
    chunks.forEach((chunk, k) => {
      const last = blocks.at(-1);
      const member = { ...chunk, onset: onsets[k], target: targets[k] };
      if (last && (chunk.from - last.to) / sampleRate <= RIGID_GAP_SECONDS) {
        last.chunks.push({ ...member, at: (chunk.from - last.from) / sampleRate });
        last.to = chunk.to;
        last.length = (last.to - last.from) / sampleRate;
      } else {
        blocks.push({
          from: chunk.from,
          to: chunk.to,
          length: (chunk.to - chunk.from) / sampleRate,
          chunks: [{ ...member, at: 0 }],
          kindBefore: last ? kindBefore(chunk.from) : null,
          pauseBefore: last ? (chunk.from - last.to) / sampleRate : 0,
        });
      }
    });
    if (!join.joinSpokenChunks) return { i, blocks };
    // Said in one go in the original: the dub doesn't stop there either.
    const floorOf = (kind) => (kind === 'stop' ? join.stopGap : kind === 'comma' ? join.commaGap : join.wordGap);
    return { i, blocks: joinSpokenBlocks(blocks, linePauses(cues), floorOf) };
  };

  /** The last line with a take: no pause after it. */
  const lastVoiced = () => clips.findLastIndex(Boolean);
  /** The least pause after block `b` of `line` at priority `tier`; after its last block, the join to the next line. */
  const chunkGapAfter = (line, b, tier) => {
    const next = line.blocks[b + 1];
    if (next) return pauseFloor(next.kindBefore, next.pauseBefore, tier, chunkGaps);
    if (line.i === lastVoiced()) return 0;
    const unit = units[line.i];
    if (overlapAfter(line.i) > 0) return -overlapAfter(line.i);
    const sourceGap = Math.max(0, unit.gapAfter ?? 0);
    const gap = pauseFloor(kindOf(unit.text.trim().split(/\s+/).at(-1) || ''), sourceGap, tier, chunkGaps);
    return unit.speakerChangeAfter ? Math.max(gap, join.speakerGap) : gap;
  };

  /**
   * How far `line`'s words run past the time to the next line with every
   * pause it has as short as it may go: what no placement can win back.
   */
  const chunkLineOverflow = (line) => {
    const clip = clips[line.i];
    const unit = units[line.i];
    let packed = 0;
    line.blocks.forEach((block, b) => {
      packed += block.length + (b < line.blocks.length - 1 ? chunkGapAfter(line, b, 2) : 0);
    });
    const lead = (Math.max(clip.lead * sampleRate, line.blocks[0].from) - line.blocks[0].from) / sampleRate;
    const room = unit.nextStart !== null ? unit.nextStart - unit.srcStart - Math.max(0, chunkGapAfter(line, line.blocks.length - 1, 2)) : Infinity;
    return { over: packed - lead - room, packed: packed - lead };
  };

  // When a line still runs long (Chunk sync): with every pause as short as it
  // may go, it has more words than time, which no placement wins back. It is
  // voiced again, the words as they are, in two ways: two more takes of it
  // (bestTakes), and a faster read (speedFit) by the voice itself, its speed
  // raised on Multilingual v2 and Cartesia, a calm pace direction on Eleven v3
  // and v4 (which ignore speed). A new take must finish every word, be the
  // same read (see takeDiffers) and run shorter; the shortest is kept at once
  // ('auto') or offered beside the old one for the user to choose ('ask').
  // Lines the user picked, took from the dub, locked, chose a take for or
  // kept as they were are left alone, and at most maxRevoice lines are tried.
  const speedFits = new Map();
  // Lines that needed it, on a voice that reads no faster either way: not voiced again.
  const speedUnfollowed = new Set();
  /** By line: the take used or offered: `{ kind, saved, used, choice: { seed, speedScale?, pace? }, take?, speed? }`. */
  const takeFits = new Map();
  /** By line: an offered take's samples, for the user to listen to. */
  const offeredTakes = new Map();
  /** By line: why no new take was used or offered, when every one tried fell short, and the first one turned down for how it sounds. */
  const takeRejects = new Map();
  const rejectedTakes = new Map();
  const declined = new Set(Array.isArray(declinedTakes) ? declinedTakes : []);
  if (chunked && (join.speedFit !== 'off' || join.bestTakes !== 'off')) {
    const tooLong = units
      .map((_, i) => i)
      .filter((i) => clips[i] && !lockOf[i] && !taken[i] && !choiceOf(units[i]) && !declined.has(lineKey(units[i])) && !(join.checkCutWords && !chunkWords.has(i)))
      .map((i) => ({ i, ...chunkLineOverflow(chunkLineOf(i)) }))
      .filter(({ over }) => over > SPEED_FIT_MIN_OVER)
      .sort((a, b) => b.over - a.over)
      .slice(0, join.maxRevoice);
    if (tooLong.length > 0) {
      report({ phase: 'voicing', step: 2, unitsToVoice: progress.unitsToVoice + tooLong.length });
      let voicedNow = progress.unitsVoiced;
      await mapLimit(tooLong, 2, async ({ i, over, packed }) => {
        checkCancelled();
        const unit = units[i];
        const base = baseVoiceOf(unit);
        const tries = [];
        if (join.bestTakes !== 'off') {
          for (let take = 2; take <= BEST_TAKES; take++) {
            tries.push({ kind: 'take', take, voice: { ...voiceOf(unit), seed: retakeSeed(seedOf(unit), BEST_TAKE_OFFSET + take) }, text: spoken[i] });
          }
        }
        if (join.speedFit !== 'off') {
          const speed = Math.round(Math.min(join.maxVoiceSpeed, (packed / Math.max(0.1, packed - over)) * SPEED_FIT_MARGIN) * 100) / 100;
          if (speed < SPEED_FIT_MIN) {
            // Barely too long: not worth a faster read.
          } else if (followsSpeed(base)) {
            tries.push({ kind: 'faster', speed, voice: { ...voiceOf(unit), speedScale: speed }, text: spoken[i] });
          } else if (followsPace(base)) {
            tries.push({ kind: 'faster', pace: PACE_DIRECTION, voice: { ...voiceOf(unit), performanceTags: true }, text: `${PACE_DIRECTION} ${spoken[i]}` });
          } else speedUnfollowed.add(i);
        }
        if (tries.length === 0) return;
        const before = { buffer: buffers[i], clip: clips[i], length: voicedLength[i], breaths: breathsRemoved[i], words: chunkWords.get(i) };
        const restore = () => {
          buffers[i] = before.buffer;
          clips[i] = before.clip;
          voicedLength[i] = before.length;
          breathsRemoved[i] = before.breaths;
          if (before.words) chunkWords.set(i, before.words);
        };
        let best = null;
        const reasons = [];
        for (const attempt of tries) {
          checkCancelled();
          try {
            const key = cacheKey(attempt.voice, attempt.text);
            let buffer = await recall(key);
            if (!buffer) {
              [buffer] = await deps.voiceLines(
                [{ text: attempt.text, previousText: neighbour(i, -1)?.text.slice(-TTS_CONTEXT_CHARS), nextText: neighbour(i, 1)?.text.slice(0, TTS_CONTEXT_CHARS), seed: attempt.voice.seed }],
                { voice: attempt.voice, onLine: () => {}, readCount: units.length }
              );
              remember(key, buffer);
            }
            checkCancelled();
            buffers[i] = buffer;
            await fit(i);
            if (!clips[i] || clips[i].cutOff) throw new Error('It stops before its last word is finished.');
            // The same read: louder or softer only matters when the dub isn't evened out afterwards.
            const differs = takeDiffers(before.clip.samples, clips[i].samples, sampleRate, { level: !matchLoudness });
            if (differs) {
              if (!rejectedTakes.has(i)) rejectedTakes.set(i, clips[i].samples);
              throw new Error(differs);
            }
            let words = null;
            if (join.checkCutWords) {
              const aligned = await alignedWords(clips[i].samples, unit.text);
              checkCancelled();
              words = aligned;
              chunkWords.set(i, words);
            }
            const after = chunkLineOverflow(chunkLineOf(i)).over;
            if (after > over - SPEED_FIT_MIN_OVER) throw new Error('It came out no shorter.');
            if (!best || after < best.after) {
              best = { ...attempt, after, buffer, clip: clips[i], length: voicedLength[i], breaths: breathsRemoved[i], words };
            }
          } catch (error) {
            checkCancelled();
            reasons.push(error.message || 'It could not be voiced.');
          } finally {
            restore();
          }
        }
        if (!best) {
          // A take turned down for how it sounds is said first, so its audio and its reason go together.
          if (reasons.length) takeRejects.set(i, reasons.find((reason) => / than the take it would replace\.$/.test(reason)) ?? reasons[0]);
          report({ unitsVoiced: ++voicedNow });
          return;
        }
        const mode = best.kind === 'take' ? join.bestTakes : join.speedFit;
        const choice = { seed: best.voice.seed, ...(best.speed && { speedScale: best.speed }), ...(best.pace && { pace: best.pace }) };
        const fitted = { kind: best.kind, saved: over - best.after, used: mode === 'auto', choice, ...(best.take && { take: best.take }), ...(best.speed && { speed: best.speed }), ...(best.pace && { pace: best.pace }) };
        takeFits.set(i, fitted);
        if (mode === 'auto') {
          buffers[i] = best.buffer;
          clips[i] = best.clip;
          voicedLength[i] = best.length;
          breathsRemoved[i] = best.breaths;
          if (best.words) chunkWords.set(i, best.words);
          hashes[i] = clipHash(clips[i].samples);
          // A new take: the pauses cut from the old one say nothing of it.
          for (const cut of [pauseCuts, pauseTrimmed, sourcePauseTrimmed, silenceTightened]) cut.delete(i);
          if (best.speed) speedFits.set(i, best.speed);
        } else offeredTakes.set(i, best.clip.samples);
        rejectedTakes.delete(i);
        report({ unitsVoiced: ++voicedNow });
      });
      report({ phase: 'placing', step: 4 });
    }
  }

  const wordTimings = new Map(chunkWords);
  const wordErrors = new Map();
  if (verifyWords) {
    // Lines Chunk sync timed already are not asked about again.
    const toCheck = units.map((_, i) => i).filter((i) => clips[i] && !chunkWords.has(i));
    let checksDone = 0;
    report({ phase: 'placing', step: 4, wordChecksTotal: toCheck.length, wordChecksDone: 0 });
    await mapLimit(toCheck, 2, async (i) => {
      checkCancelled();
      try {
        const words = await alignedWords(clips[i].samples, units[i].text);
        checkCancelled();
        wordTimings.set(i, words);
        // Only checked: the line is placed exactly as it would be with the check off.
      } catch (error) {
        checkCancelled();
        wordErrors.set(i, error.message || 'Word timing could not be checked.');
      }
      report({ wordChecksDone: ++checksDone });
    });
    report({ phase: 'placing', step: 4 });
  }

  const placedIndex = units.map((_, i) => i).filter((i) => clips[i]);
  const cores = placedIndex.map((i) => core(i));
  // Lines whose timing limits could not be met, with why: the dub is still made, and they are flagged for review.
  const timingConflicts = new Map();
  const placeConflicts = [];
  // Must end by: no later than this may the dub's last line end (see endByVideo).
  const endLimit = join.endByVideo && sourceDuration > 0 ? sourceDuration + join.endSlack : Infinity;

  // Chunk sync. Each line's chunks, by placed line: `{ from, to }` samples of
  // its clip and, once placed, `start` seconds on the timeline.
  const chunkPlan = new Map();
  // How far each line runs past its slot with every pause it has shrunk as far as it may.
  const chunkOverflow = new Map();
  const placeChunks = () => {
    const lines = placedIndex.map((i, n) => ({ ...chunkLineOf(i), n }));
    const gapAfter = chunkGapAfter;

    const solve = (tier) => {
      const items = [];
      for (const line of lines) {
        const unit = units[line.i];
        line.blocks.forEach((block, b) => {
          if (line.locked) {
            const lock = lockOf[line.i];
            if (tier === 2 && join.preserveLongPauses && ((unit.gapBefore >= join.protectedPause && lock.start < unit.srcStart - 1 / sampleRate) ||
              (unit.gapAfter >= join.protectedPause && lock.end > unit.srcEnd + 1 / sampleRate))) {
              timingConflicts.set(line.i, 'Your locked edit of this line runs into a protected pause. It is kept where you put it.');
            }
            items.push({ line, block, want: lock.start, length: lock.end - lock.start, gapAfter: gapAfter(line, b, tier), weight: LOCK_WEIGHT, fixed: true, earliest: lock.start, floor: 0 });
            return;
          }
          // Each chunk pulls by its length (Samanvaya: 0.3 to 3) towards the start that puts its first sound on its target.
          // A block joined from several (joinSpokenChunks) moves as one: every chunk in it pulls, so its error is shared out.
          let sum = 0;
          let weight = 0;
          for (const chunk of block.chunks) {
            const w = Math.max(0.3, Math.min(3, (chunk.to - chunk.from) / sampleRate));
            sum += w * (chunk.target - (chunk.at + chunk.onset - chunk.from / sampleRate));
            weight += w;
          }
          const want = sum / weight;
          const { length } = block;
          // A protected pause: the line's first chunk starts no sooner than the original line, its last ends no later.
          const preserveBefore = b === 0 && join.preserveLongPauses && unit.gapBefore >= join.protectedPause;
          const preserveAfter = b === line.blocks.length - 1 && join.preserveLongPauses && unit.gapAfter >= join.protectedPause;
          const strict = b === 0 && timingProtection === 'strict' ? want + join.maxLateStart : Infinity;
          // Must end by: the dub's last chunk ends by the original's end, give or take endSlack.
          const last = line.n === placedIndex.length - 1 && b === line.blocks.length - 1;
          const latest = Math.min(strict, preserveAfter ? unit.srcEnd - length : Infinity, last ? endLimit - length : Infinity);
          items.push({
            line,
            block,
            want,
            length,
            ...(preserveBefore && { earliest: want }),
            ...(Number.isFinite(latest) && { latest }),
            gapAfter: gapAfter(line, b, tier),
            weight: Math.max(0.3, Math.min(3, weight)) * (b === 0 && unit.hardAnchor ? join.anchorWeight : 1),
            // Only its first sound has to be inside the track: the pad before it may go before 0:00.
            floor: -(block.chunks[0].onset - block.chunks[0].from / sampleRate),
          });
        });
      }
      const conflicts = [];
      const at = placeClips(items, { conflicts });
      let worst = 0;
      items.forEach((item, k) => {
        if (item.line.locked) return;
        // A chunk joined on was moved off its word on purpose: it doesn't keep the pauses from shrinking in punctuation order.
        for (const chunk of item.block.chunks) if (!chunk.follows) worst = Math.max(worst, Math.abs(at[k] + chunk.at + chunk.onset - chunk.from / sampleRate - chunk.target));
      });
      return { items, at, conflicts, worst };
    };
    // Pauses between words shrink first, then those at a comma, a sentence end's last, while any chunk is still out.
    let solved = solve(2);
    if (join.punctuationPriority) {
      for (const tier of [0, 1]) {
        const tried = solve(tier);
        if (tried.worst <= tolerance) {
          solved = tried;
          break;
        }
      }
    }
    const { items, at, conflicts } = solved;
    for (const k of conflicts) {
      const { line } = items[k];
      if (!placeConflicts.includes(line.n)) placeConflicts.push(line.n);
    }
    items.forEach((item, k) => {
      for (const chunk of item.block.chunks) {
        chunk.start = at[k] + chunk.at;
        // What would play before 0:00 is the pad before its first sound: it is left out.
        if (chunk.start < 0) {
          chunk.from = Math.min(chunk.to - 1, chunk.from + Math.round(-chunk.start * sampleRate));
          chunk.start = 0;
        }
      }
    });

    return lines.map((line) => {
      const { i, n } = line;
      const clip = clips[i];
      const chunks = line.blocks.flatMap((block) => block.chunks.map(({ from, to, start }) => ({ from, to, start })));
      chunkPlan.set(i, chunks);
      // The line's first sample, had it been placed whole: what its words are measured from.
      const origin = chunks[0].start - chunks[0].from / sampleRate;
      const timeOf = (t) => {
        const chunk = chunks.findLast((c) => c.from <= t * sampleRate) ?? chunks[0];
        return chunk.start + (Math.min(Math.max(t, chunk.from / sampleRate), chunk.to / sampleRate) - chunk.from / sampleRate);
      };
      const first = timeOf(clip.lead);
      const last = timeOf(clip.lead + clip.speech);
      const end = chunks.at(-1).start + (chunks.at(-1).to - chunks.at(-1).from) / sampleRate;
      cores[n] = { head: 0, lead: first - origin, speech: Math.max(0, last - first), length: end - origin };
      if (!line.locked) {
        chunkOverflow.set(i, chunkLineOverflow(line).over);
      }
      return origin;
    });
  };

  const positions = chunked ? placeChunks() : placeClips(
    placedIndex.map((i, n) => {
      const unit = units[i];
      const lock = lockOf[i];
      // A locked line is one rigid block, the stretch its edits take, held where the user put it.
      if (lock) {
        if (join.preserveLongPauses && ((unit.gapBefore >= join.protectedPause && lock.start < unit.srcStart - 1 / sampleRate) ||
          (unit.gapAfter >= join.protectedPause && lock.end > unit.srcEnd + 1 / sampleRate))) {
          timingConflicts.set(i, 'Your locked edit of this line runs into a protected pause. It is kept where you put it.');
        }
        return {
          want: lock.start,
          length: lock.end - lock.start,
          gapAfter: n < placedIndex.length - 1 ? gapAfterUnit(i) : 0,
          weight: LOCK_WEIGHT,
          fixed: true,
          earliest: lock.start,
          floor: 0,
        };
      }
      const want = unit.srcStart - cores[n].lead;
      const preserveBefore = join.preserveLongPauses && unit.gapBefore >= join.protectedPause;
      const preserveAfter = join.preserveLongPauses && unit.gapAfter >= join.protectedPause;
      return {
        want,
        length: cores[n].length,
        gapAfter: n < placedIndex.length - 1 ? gapAfterUnit(i) : 0,
        weight: unit.hardAnchor ? join.anchorWeight : 1,
        earliest: preserveBefore ? want : want - tolerance,
        latest: Math.min(
          timingProtection === 'strict' ? want + join.maxLateStart : Infinity,
          preserveAfter ? unit.srcEnd - cores[n].length : Infinity,
          n === placedIndex.length - 1 ? endLimit - cores[n].length : Infinity
        ),
        // Only the first word has to be inside the track; what comes before it may be dropped.
        floor: -cores[n].lead,
      };
    }),
    { conflicts: placeConflicts }
  );
  for (const n of placeConflicts) {
    const i = placedIndex[n];
    const moved = lockOf[i] ? positions[n] - lockOf[i].start : null;
    timingConflicts.set(
      i,
      moved !== null
        ? `The lines before it needed more room, so your locked line moved ${moved.toFixed(2)} s later. Shorten or retake the line before it, or move the lock.`
        : 'The lines before it need more room than its timing limit allows, so it starts late. Shorten or retake the line before it, or relax the limit.'
    );
  }
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
    // Chunk sync: the whole line goes to the bank; its chunks are what the render places (renderClips).
    if (chunked) return { samples: clips[i].samples, startSample: Math.max(0, Math.round(positions[n] * sampleRate)), speaker };
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
  const log = (debug || verifyWords) && !chunked ? (entry) => rendered.push(entry) : undefined;
  if (timingProtection === 'strict') {
    // A line that still starts past the Strict limit once its audio edge is placed is flagged, never dropped.
    placedIndex.forEach((i, n) => {
      if (lockOf[i] || timingConflicts.has(i)) return;
      const late = positions[n] + cores[n].lead - units[i].srcStart;
      if (late > join.maxLateStart + 1 / sampleRate) {
        timingConflicts.set(i, `It starts ${late.toFixed(2)} s after the original line, past the Strict limit. Shorten or retake the line before it, or relax the limit.`);
      }
    });
  }
  // How far the dub runs past the original's end; with Must end by, a dub that still does is flagged on its last line.
  const dubEnd = placedIndex.reduce((end, i, n) => Math.max(end, positions[n] + cores[n].length), 0);
  const endsPastVideo = sourceDuration > 0 ? Math.max(0, dubEnd - sourceDuration) : 0;
  if (Number.isFinite(endLimit) && dubEnd > endLimit + 1 / sampleRate && placedIndex.length > 0) {
    // Said in place of the solve's own note, which can't tell the end was the limit it missed.
    timingConflicts.set(placedIndex.at(-1), `The dub still runs ${endsPastVideo.toFixed(2)} s past the original's end. Shorten a long line or read it faster, then sync again.`);
  }
  // The gains are worked out here rather than inside the render so the bank can
  // carry them, and an edit render of the same lines comes out the same.
  const lineGains = !multiSpeaker && matchLoudness ? matchingGains(placedClips.map((clip) => clip.samples), sampleRate) : placedClips.map(() => 1);
  const voiceGains = multiSpeaker && matchLoudness ? speakerGains(placedClips, sampleRate) : new Map();
  // Chunk sync renders each chunk where it was placed, as views of its line, as Edit timing renders split parts.
  const chunkStart = (chunk) => Math.max(0, Math.round(chunk.start * sampleRate));
  const renderClips = chunked
    ? placedIndex.flatMap((i, n) =>
        chunkPlan.get(i).map((chunk) => ({ samples: clips[i].samples.subarray(chunk.from, chunk.to), startSample: chunkStart(chunk), speaker: placedClips[n].speaker, gain: lineGains[n] }))
      )
    : placedClips.map((clip, n) => ({ ...clip, gain: lineGains[n] }));
  const mixed = multiSpeaker
    ? mixSpeakers(renderClips, { sampleRate, length: sourceDuration, fadeSeconds: join.edgeFade, peak, gains: voiceGains, log })
    : null;
  const track = mixed ? mixed.mix : renderTimeline(renderClips, { sampleRate, length: sourceDuration, fadeSeconds: join.edgeFade, log });
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
      // Chunk sync: where each chunk of the line plays, which Edit timing shows as the line's parts.
      ...(chunked && { chunks: chunkPlan.get(i).map((chunk) => ({ from: chunk.from, to: chunk.to, startSample: chunkStart(chunk) })) }),
    };
  });
  const bank = { sampleRate, samples: bankSamples, lines: bankLines, speakerGains: Object.fromEntries(voiceGains) };

  // Where every sample of every line came from and where it went, for tracing an artifact to the step that made it.
  const audioDebug = debug && !chunked
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
  if (chunked) {
    // Chunks of one line playing over another's, as the chunks lie rather than as each line would whole.
    const spans = placedIndex
      .flatMap((i) => chunkPlan.get(i).map((chunk) => ({ i, start: chunkStart(chunk) / sampleRate, end: chunkStart(chunk) / sampleRate + (chunk.to - chunk.from) / sampleRate })))
      .sort((a, b) => a.start - b.start);
    let reach = null;
    summary.overlaps = 0;
    for (const span of spans) {
      if (reach && reach.i !== span.i && span.start < reach.end - 1e-6) summary.overlaps++;
      if (!reach || span.end > reach.end) reach = span;
    }
  }
  const lineFor = new Map(placedIndex.map((i, n) => [i, lines[n]]));
  const exceededBy = units.map((_, i) => Math.max(0, chunkOverflow.has(i) ? chunkOverflow.get(i) : overflow(i)));
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
  // Syllables a suggested shorter wording still runs past its target, when no wording fit.
  const suggestionOver = new Map();
  let suggestionError = null;
  // Suggestions held back because every wording changed what the source line says.
  let meaningRejected = 0;
  const tooLong = units.map((_, i) => i).filter((i) => exceeded[i]);
  const tooShort = units.map((_, i) => i).filter((i) => shortBy[i] > 0);
  // A line that would lose more than a third of itself to fit needs its timing changed, not fewer words.
  const deepCut = units.map((unit, i) => exceeded[i] && tooDeepCut(unit.text, targetChars[i]));
  const asks = [
    ...(suggest && deps.shorten ? tooLong.filter((i) => !deepCut[i]).map((i) => ({ i, ask: deps.shorten })) : []),
    ...(suggestLonger && deps.lengthen ? tooShort.map((i) => ({ i, ask: deps.lengthen })) : []),
  ];
  // The lines either side and the speaker, so a line is reworded as part of the conversation.
  const contextOf = (i) => ({
    before: units.slice(Math.max(0, i - SUGGESTION_CONTEXT), i).map((unit) => unit.text),
    after: units.slice(i + 1, i + 1 + SUGGESTION_CONTEXT).map((unit) => unit.text),
    speaker: units[i].speaker || '',
  });
  if (asks.length > 0) {
    report({ suggestionsTotal: asks.length });
    let done = 0;
    await mapLimit(asks, SUGGESTION_CONCURRENCY, async ({ i, ask }) => {
      checkCancelled();
      try {
        const answer = await ask({
          text: units[i].text,
          sourceText: units[i].sourceText,
          language,
          targetChars: targetChars[i],
          context: contextOf(i),
          keep,
        });
        const line = typeof answer === 'string' || answer === null ? answer : answer?.line;
        if (line && line !== units[i].text) {
          suggestions.set(i, line);
          if (answer?.over > 0) suggestionOver.set(i, answer.over);
        }
        else if (answer?.reason === 'meaning') meaningRejected++;
      } catch (err) {
        // The dub is finished either way; a missing suggestion must not fail the sync.
        suggestionError ??= err?.message || 'The text model did not answer.';
      }
      report({ suggestionsDone: ++done });
    });
  }

  const cueById = new Map(segments.map((cue) => [cue.id, cue]));
  const verifiedTiming = new Map();
  if (verifyWords) placedIndex.forEach((i, n) => {
    const words = wordTimings.get(i);
    if (!words) return;
    const cuesOf = () => units[i].cueIds.map((id) => cueById.get(id)).filter(Boolean).sort((a, b) => a.startTime - b.startTime);
    if (chunked) {
      // Each word where its chunk put it: no split is made inside a word.
      const chunks = chunkPlan.get(i);
      const at = (t) => {
        const chunk = chunks.findLast((c) => c.from <= t * sampleRate + 1) ?? chunks[0];
        return chunkStart(chunk) / sampleRate + t - chunk.from / sampleRate;
      };
      verifiedTiming.set(i, measureWordTiming(words.map((word) => ({ ...word, start: at(word.start), end: at(word.end) })), units[i], cuesOf(), 0, tolerance));
      return;
    }
    const retainedFrom = (dropped[n] + rendered[n].edgeTrimStartSamples) / sampleRate;
    const retainedTo = (dropped[n] + placedClips[n].samples.length - rendered[n].edgeTrimEndSamples) / sampleRate;
    if (words[0].start < retainedFrom - 1 / sampleRate || words.at(-1).end > retainedTo + 1 / sampleRate) {
      wordErrors.set(i, 'The rendered audio edge moved through an aligned word. Review this take.');
      return;
    }
    const origin = (rendered[n].timelineStartSample - rendered[n].edgeTrimStartSamples - dropped[n]) / sampleRate;
    verifiedTiming.set(i, measureWordTiming(words, units[i], units[i].cueIds.map((id) => cueById.get(id)).filter(Boolean).sort((a, b) => a.startTime - b.startTime), origin, tolerance));
  });
  const unitReports = units.map((unit, i) => {
    const line = lineFor.get(i);
    return {
      index: i,
      key: lineKey(unit),
      cueIds: unit.cueIds,
      speaker: unit.speaker || null,
      voiceId: baseVoiceOf(unit).voiceId,
      text: unit.text,
      // The line as voiced with the speaker's pauses (syncUnits.js), so a retake of the same words keeps them.
      ...(unit.voiceText && unit.voiceText !== unit.text && stripPauses(unit.voiceText) === stripPauses(unit.text) && { pausedText: unit.voiceText }),
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
      suggestionOver: suggestionOver.get(i) || null,
      deepCut: deepCut[i],
      pauseTrimmed: pauseTrimmed.get(i) || 0,
      // Of that, what the original has no pause for (matchSourcePauses); null where its words are untimed.
      sourcePauseTrimmed: sourcePauses[i] ? sourcePauseTrimmed.get(i) || 0 : null,
      // Of that, what Tighten silences took from its tail and pauses.
      silenceTightened: silenceTightened.get(i) || 0,
      // Chunk sync: the chunks the line was placed as, and how much faster it was read to fit (Fit by voice speed).
      ...(chunkPlan.has(i) && { chunks: chunkPlan.get(i).length }),
      ...(speedFits.has(i) && { speedFit: speedFits.get(i) }),
      // A new take of a line too long: used, or offered for the user to choose; or why none was.
      ...(takeFits.has(i) && { takeFit: takeFits.get(i) }),
      ...(takeRejects.has(i) && { takeRejected: takeRejects.get(i) }),
      ...(choiceOf(unit) && { takeChosen: true }),
      // Too long, but its voice's model ignores speed: Fit by voice speed could not help.
      ...(speedUnfollowed.has(i) && { speedFitUnsupported: true }),
      // Why Tighten silences left the line as it was: its words could not be timed to check the cuts.
      cutCheckError: cutCheckErrors.get(i) || null,
      late: late[i],
      joinAfter: joinAfter.has(i) ? joinAfter.get(i) : null,
      tightJoin: tightJoin[i],
      retakes: retakes[i],
      // A line the user retook: how many takes were voiced to pick the best fitting one from.
      takesCompared: takesCompared[i],
      fromDub: Boolean(taken[i]) && !picked[i],
      // The take the user picked from the takes panel, kept as it was.
      picked: Boolean(picked[i]),
      cutOff: Boolean(clips[i]?.cutOff),
      breathsRemoved: breathsRemoved[i],
      // Why the line could not meet its timing limits (Strict, a protected pause or a lock), or null.
      timingConflict: timingConflicts.get(i) || null,
      ...(verifyWords && { wordTiming: verifiedTiming.has(i)
        ? verifiedTiming.get(i)
        : { status: 'unavailable', reason: wordErrors.get(i) || 'This line contains no audible speech.' } }),
    };
  });

  // Takes offered for the user to choose, to listen to beside the ones in the dub.
  const offers = [];
  for (const [i, samples] of offeredTakes) offers.push({ key: lineKey(units[i]), ...(await deps.encode(samples, { float: false })) });
  // A take turned down for how it sounds, to listen to anyway.
  for (const [i, samples] of rejectedTakes) offers.push({ key: lineKey(units[i]), rejected: true, ...(await deps.encode(samples, { float: false })) });

  return {
    buffer,
    contentType,
    bank,
    offers,
    ...(mixed && { stems }),
    report: {
      precision,
      language,
      tolerance,
      join,
      timingProtection: timingProtection === 'strict' ? 'strict' : 'warn',
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
        deepCuts: deepCut.filter(Boolean).length,
        suggestionError,
        pauseTrimmed: pauseTrimmed.size,
        sourcePauseTrimmed: [...sourcePauseTrimmed.values()].reduce((sum, seconds) => sum + seconds, 0),
        // Lines Tighten silences shortened, the seconds it took, and lines it left because their words could not be timed.
        silenceTightened: silenceTightened.size,
        silenceTightenedSeconds: [...silenceTightened.values()].reduce((sum, seconds) => sum + seconds, 0),
        cutChecksFailed: cutCheckErrors.size,
        // Seconds the dub runs past the original's end (0 when it ends in time).
        endsPastVideo,
        ...(chunked && { chunkSync: true, chunks: [...chunkPlan.values()].reduce((sum, chunks) => sum + chunks.length, 0), speedFitted: speedFits.size, speedFitUnsupported: speedUnfollowed.size,
          takesUsed: [...takeFits.values()].filter((fitted) => fitted.used).length,
          takesOffered: [...takeFits.values()].filter((fitted) => !fitted.used).length }),
        // Lines Match source pauses could not check, their original having no word timestamps.
        sourcePausesUnknown: join.matchSourcePauses ? sourcePauses.filter((pauses, i) => !pauses && clips[i]).length : 0,
        late: late.filter(Boolean).length,
        tightJoins: tightJoin.filter(Boolean).length,
        silent: units.length - placedIndex.length,
        retaken: retakes.filter((n) => n > 0).length,
        fromDub: taken.filter((take, i) => take && !picked[i]).length,
        picked: picked.filter(Boolean).length,
        cutOff: clips.filter((clip) => clip?.cutOff).length,
        breathsRemoved: breathsRemoved.reduce((sum, n) => sum + n, 0),
        timingConflicts: timingConflicts.size,
        ...(verifyWords && { wordTimingMeasured: verifiedTiming.size, wordTimingUnavailable: units.length - verifiedTiming.size,
          boundaryMismatches: unitReports.filter((unit) => unit.wordTiming?.boundaryMismatch).length,
          endMismatches: unitReports.filter((unit) => unit.wordTiming?.endMismatch).length }),
      },
      units: unitReports,
      ...(mixed && { mix: { ...mixed.report, overlapsKept, selfOverlaps } }),
      ...(audioDebug && { audioDebug }),
    },
  };
};
