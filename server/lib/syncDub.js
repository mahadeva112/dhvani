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
import { buildSyncUnits, minimumGap } from './syncUnits.js';
import { placeClips, measureSync } from './syncPlace.js';
import { prepareClip, shortenPauses, renderTimeline, startAfterCut } from './syncRender.js';
import { TTS_CONTEXT_CHARS } from './ttsText.js';

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

/** Suggestions asked for at once. */
const SUGGESTION_CONCURRENCY = 4;

/**
 * A clip often opens with a soft breath or room noise before its first word
 * (below speech level, above silence). All of it is kept, but only this much
 * before the first word counts when clips are spaced out: the rest may overlap
 * the silent tail of the line before, where it is mixed in, never cut.
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
  createHash('sha256').update(JSON.stringify([voice.voiceId, voice.modelId, voice.outputFormat, voice.voiceSettings ?? null, voice.seed ?? null, text])).digest('hex');

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
 * `params`: `{ segments, sourceDuration, sampleRate, precision, suggest, suggestLonger, language, voice, lineSeeds, matchLoudness, debug }`,
 * where `suggest` asks for shorter wordings of long lines and `suggestLonger` for fuller wordings of short ones (both on by default),
 * where `voice` is `{ voiceId, modelId, outputFormat, voiceSettings, seed }`,
 * `lineSeeds` maps a line's key (see lineKey) to the seed of a retake of it,
 * `matchLoudness` evens out the lines' loudness (off by default: each line is
 * kept at the level it was voiced at) and `debug` adds `report.audioDebug`,
 * a sample-exact account of every cut, placement, gain and fade.
 *
 * `deps`:
 * - `voiceLines(lines)` → `[Buffer]`, voicing `[{ text, previousText, nextText }]` in order;
 * - `decode(buffer)` → mono Float32Array at `sampleRate`;
 * - `encode(samples)` → `{ buffer, contentType }`;
 * - `shorten({ text, sourceText, language, targetChars })` → a shorter wording, or null, or
 *   `{ line, reason }` with `reason` 'meaning' when every wording changed the meaning; throwing
 *   when the text model fails (optional);
 * - `lengthen({ text, sourceText, language, targetChars })` → a fuller wording, the same way (optional).
 *
 * Returns `{ buffer, contentType, report }`.
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
    lineSeeds = {},
    matchLoudness = false,
    debug = false,
  } = params;
  const precision = SYNC_PRECISION[params.precision] ? params.precision : 'phrase';
  const { tolerance, allowedOverflow } = SYNC_PRECISION[precision];
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
  const units = buildSyncUnits(segments).filter((unit) => hasWords(unit.text));
  if (units.length === 0) {
    throw new ApiError('There are no translated lines to sync.', { status: 400, code: 'no_lines' });
  }
  report({ unitCount: units.length });

  // 2. Voicing. A retaken line is voiced with its own seed, which is a new take of it.
  report({ phase: 'voicing', step: 2 });
  const seedOf = (unit) => (Number.isInteger(lineSeeds[lineKey(unit)]) ? lineSeeds[lineKey(unit)] : voice.seed);
  const voiceOf = (unit) => ({ ...voice, seed: seedOf(unit) });
  const buffers = new Array(units.length);
  const missing = [];
  units.forEach((unit, i) => {
    const cached = clipCache.get(cacheKey(voiceOf(unit), unit.text));
    if (cached) buffers[i] = cached;
    else missing.push(i);
  });
  report({ unitsToVoice: missing.length });
  if (missing.length > 0) {
    const lines = missing.map((i) => ({
      text: units[i].text,
      previousText: i > 0 ? units[i - 1].text.slice(-TTS_CONTEXT_CHARS) : undefined,
      nextText: i < units.length - 1 ? units[i + 1].text.slice(0, TTS_CONTEXT_CHARS) : undefined,
      seed: seedOf(units[i]),
    }));
    const voiced = await deps.voiceLines(lines, { onLine: (done) => report({ unitsVoiced: done }) });
    missing.forEach((i, n) => {
      buffers[i] = voiced[n];
      remember(cacheKey(voiceOf(units[i]), units[i].text), voiced[n]);
    });
  }
  checkCancelled();

  // 3. Fitting
  report({ phase: 'fitting', step: 3 });
  const clips = [];
  const voicedLength = [];
  for (const buffer of buffers) {
    const samples = await deps.decode(buffer);
    voicedLength.push(samples.length);
    clips.push(prepareClip(samples, sampleRate));
  }
  checkCancelled();

  /**
   * The part of clip `i` that is spaced out against its neighbours: from just
   * before its first word to the end of its tail. `head` is the pre-roll before
   * that, which may overlap the line before.
   */
  const core = (i) => {
    const head = Math.max(0, clips[i].lead - LEAD_GUARD_SECONDS);
    return { head, lead: clips[i].lead - head, speech: clips[i].speech, length: clips[i].samples.length / sampleRate - head };
  };

  /** How long unit `i`'s core may be: from its wanted start to where the next clip's core wants to start, less a breath. */
  const budget = (i) => {
    const unit = units[i];
    const start = unit.srcStart - core(i).lead;
    const limit =
      unit.nextStart !== null
        ? unit.nextStart - (clips[i + 1] ? core(i + 1).lead : 0) - minimumGap(unit.gapAfter)
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
    const excess = overflow(i);
    if (!clips[i] || excess <= 0) return;
    const { samples, removed, cuts } = shortenPauses(clips[i].samples, sampleRate, excess);
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
      const want = unit.srcStart - cores[n].lead;
      return {
        want,
        length: cores[n].length,
        gapAfter: n < placedIndex.length - 1 ? minimumGap(unit.gapAfter) : 0,
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
  const track = renderTimeline(
    placedIndex.map((i, n) => {
      const start = positions[n] - cores[n].head;
      if (start >= 0) return { samples: clips[i].samples, position: start };
      const cut = startAfterCut(clips[i].samples, Math.round(-start * sampleRate), Math.round(clips[i].lead * sampleRate), sampleRate);
      dropped[n] = cut.from;
      delayed[n] = cut.delay;
      // Keeping a little more of the pre-roll starts the line that much later; the check below measures it there.
      positions[n] += cut.delay / sampleRate;
      return { samples: clips[i].samples.subarray(cut.from), startSample: 0, maxStartShift: 0 };
    }),
    { sampleRate, length: sourceDuration, matchLoudness, log: debug ? (entry) => rendered.push(entry) : undefined }
  );
  const { buffer, contentType } = await deps.encode(track);
  checkCancelled();

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

  // A line ends early when its words, as voiced, leave much of the original speech unsaid.
  const spokenOf = (i) => Math.max(0, units[i].srcEnd - units[i].srcStart);
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
    };
  });

  return {
    buffer,
    contentType,
    report: {
      precision,
      tolerance,
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
        silent: units.length - placedIndex.length,
      },
      units: unitReports,
      ...(audioDebug && { audioDebug }),
    },
  };
};
