/**
 * A dub that is in sync with its source, built without changing the voice's
 * speed.
 *
 * 1. The translated cues are grouped into sync units, one per spoken phrase.
 * 2. Each unit is voiced as its own clip (stitched to its neighbours).
 * 3. Every clip is trimmed to its speech and measured against its slot: the
 *    time from its source phrase's start to the next phrase's start.
 * 4. A clip too long for its slot has its line rewritten shorter and voiced
 *    again, at most MAX_REWRITE_ROUNDS times.
 * 5. Whatever still runs long has the pauses between its words shortened.
 * 6. Every clip is placed by an isotonic solve (syncPlace.js) and the clips
 *    are rendered into one track the length of the source.
 * 7. The placement is measured against the source phrase by phrase.
 *
 * The voice, the text model and the codecs are passed in, so the whole run
 * can be tested with fakes.
 */
import { createHash } from 'node:crypto';
import { ApiError } from '../errors.js';
import { cancelledError } from './http.js';
import { buildSyncUnits, minimumGap } from './syncUnits.js';
import { placeClips, measureSync } from './syncPlace.js';
import { prepareClip, shortenPauses, renderTimeline, CLIP_LEAD_SECONDS } from './syncRender.js';
import { TTS_CONTEXT_CHARS } from './ttsText.js';

/**
 * How tight the sync must be. `tolerance` is how far a line's first word may
 * sit from the source's; `allowedOverflow` is how far past its slot a clip may
 * run before its line is rewritten (the placer absorbs the rest by nudging
 * neighbours).
 */
export const SYNC_PRECISION = {
  lipsync: { tolerance: 0.08, allowedOverflow: 0.15 },
  phrase: { tolerance: 0.15, allowedOverflow: 0.3 },
  loose: { tolerance: 0.3, allowedOverflow: 0.6 },
};

export const MAX_REWRITE_ROUNDS = 2;

/** Rewrites aim this far under the slot, since a rewrite rarely lands exactly on its target. */
const REWRITE_MARGIN = 0.92;

/** Hard anchors (after long pauses and speaker changes) pull this much harder in the solve. */
const HARD_ANCHOR_WEIGHT = 3;

/** Lines rewritten at once. */
const REWRITE_CONCURRENCY = 4;

/** The steps of a run, in order; `step` in progress reports counts from 1. */
export const SYNC_STEPS = ['units', 'voicing', 'fitting', 'rewriting', 'placing', 'rendering', 'checking'];

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
 * `params`: `{ segments, sourceDuration, sampleRate, precision, rewrite, language, voice }`,
 * where `voice` is `{ voiceId, modelId, outputFormat, voiceSettings, seed }`.
 *
 * `deps`:
 * - `voiceLines(lines)` → `[Buffer]`, voicing `[{ text, previousText, nextText }]` in order;
 * - `decode(buffer)` → mono Float32Array at `sampleRate`;
 * - `encode(samples)` → `{ buffer, contentType }`;
 * - `shorten({ text, sourceText, language, targetChars })` → shorter text or null (optional).
 *
 * Returns `{ buffer, contentType, report }`.
 */
export const runSync = async (params, deps, { signal, onProgress = () => {} } = {}) => {
  const { segments, sourceDuration = 0, sampleRate, rewrite = true, language, voice } = params;
  const precision = SYNC_PRECISION[params.precision] ? params.precision : 'phrase';
  const { tolerance, allowedOverflow } = SYNC_PRECISION[precision];
  const checkCancelled = () => {
    if (signal?.aborted) throw cancelledError('Sync');
  };

  const progress = { phase: 'units', step: 1, unitCount: 0, unitsVoiced: 0, unitsToVoice: 0, rewritesTotal: 0, rewritesDone: 0 };
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
  const texts = units.map((unit) => unit.text);
  report({ unitCount: units.length });

  // 2. Voicing
  const buffers = new Array(units.length);
  const voiceUnits = async (indices) => {
    const missing = [];
    for (const i of indices) {
      const cached = clipCache.get(cacheKey(voice, texts[i]));
      if (cached) buffers[i] = cached;
      else missing.push(i);
    }
    report({ unitsToVoice: missing.length, unitsVoiced: 0 });
    if (missing.length === 0) return;
    const lines = missing.map((i) => ({
      text: texts[i],
      previousText: i > 0 ? texts[i - 1].slice(-TTS_CONTEXT_CHARS) : undefined,
      nextText: i < texts.length - 1 ? texts[i + 1].slice(0, TTS_CONTEXT_CHARS) : undefined,
    }));
    const voiced = await deps.voiceLines(lines, { onLine: (done) => report({ unitsVoiced: done }) });
    missing.forEach((i, n) => {
      buffers[i] = voiced[n];
      remember(cacheKey(voice, texts[i]), voiced[n]);
    });
    checkCancelled();
  };

  const clips = new Array(units.length);
  const measure = async (indices) => {
    for (const i of indices) clips[i] = prepareClip(await deps.decode(buffers[i]), sampleRate);
  };

  /** How long unit `i`'s clip may be, from its wanted start to the latest it may end. */
  const budget = (i) => {
    const unit = units[i];
    const start = unit.srcStart - clips[i].lead;
    const limit =
      unit.nextStart !== null
        ? unit.nextStart - CLIP_LEAD_SECONDS - minimumGap(unit.gapAfter)
        : sourceDuration > 0
          ? Math.max(sourceDuration, unit.srcEnd) + 0.5
          : Infinity;
    return limit - start;
  };
  const overflow = (i) => (clips[i] ? clips[i].samples.length / sampleRate - budget(i) : 0);

  report({ phase: 'voicing', step: 2 });
  await voiceUnits(units.map((_, i) => i));

  // 3. Fitting
  report({ phase: 'fitting', step: 3 });
  await measure(units.map((_, i) => i));
  checkCancelled();

  // 4. Rewriting
  const rewritten = new Set();
  report({ phase: 'rewriting', step: 4 });
  if (rewrite && deps.shorten) {
    for (let round = 0; round < MAX_REWRITE_ROUNDS; round++) {
      const long = units.map((_, i) => i).filter((i) => clips[i] && overflow(i) > allowedOverflow);
      if (long.length === 0) break;
      report({ rewritesTotal: progress.rewritesTotal + long.length });

      const changed = [];
      const previous = new Map();
      await mapLimit(long, REWRITE_CONCURRENCY, async (i) => {
        checkCancelled();
        const clip = clips[i];
        const tail = clip.samples.length / sampleRate - clip.lead - clip.speech;
        const speechBudget = Math.max(0.2, budget(i) - clip.lead - tail);
        const targetChars = Math.max(1, Math.floor(texts[i].length * (speechBudget / clip.speech) * REWRITE_MARGIN));
        const line = await deps.shorten({ text: texts[i], sourceText: units[i].sourceText, language, targetChars });
        if (line && line !== texts[i]) {
          previous.set(i, { text: texts[i], buffer: buffers[i], clip });
          texts[i] = line;
          changed.push(i);
        }
        report({ rewritesDone: progress.rewritesDone + 1 });
      });
      if (changed.length === 0) break;

      changed.sort((a, b) => a - b);
      await voiceUnits(changed);
      await measure(changed);
      for (const i of changed) {
        const before = previous.get(i);
        // A rewrite that came out no shorter is undone.
        if (!clips[i] || clips[i].samples.length >= before.clip.samples.length) {
          texts[i] = before.text;
          buffers[i] = before.buffer;
          clips[i] = before.clip;
        } else {
          rewritten.add(i);
        }
      }
      checkCancelled();
    }
  }

  // 5. Placing: shorten pauses where a clip still runs long, then solve.
  report({ phase: 'placing', step: 5 });
  const pauseTrimmed = new Map();
  units.forEach((_, i) => {
    const excess = overflow(i);
    if (!clips[i] || excess <= 0) return;
    const { samples, removed } = shortenPauses(clips[i].samples, sampleRate, excess);
    if (removed > 0) {
      clips[i] = { ...clips[i], samples, speech: clips[i].speech - removed };
      pauseTrimmed.set(i, removed);
    }
  });

  // A line that starts within its lead-in of 0:00 can't begin before the track does; its lead-in is cut short instead.
  units.forEach((unit, i) => {
    if (!clips[i] || unit.srcStart >= clips[i].lead) return;
    const cut = Math.round((clips[i].lead - Math.max(0, unit.srcStart)) * sampleRate);
    clips[i] = { ...clips[i], samples: clips[i].samples.subarray(cut), lead: clips[i].lead - cut / sampleRate };
  });

  const placedIndex = units.map((_, i) => i).filter((i) => clips[i]);
  const positions = placeClips(
    placedIndex.map((i, n) => {
      const unit = units[i];
      const want = unit.srcStart - clips[i].lead;
      return {
        want,
        length: clips[i].samples.length / sampleRate,
        gapAfter: n < placedIndex.length - 1 ? minimumGap(unit.gapAfter) : 0,
        weight: unit.hardAnchor ? HARD_ANCHOR_WEIGHT : 1,
        earliest: want - tolerance,
      };
    })
  );
  checkCancelled();

  // 6. Rendering
  report({ phase: 'rendering', step: 6 });
  const track = renderTimeline(
    placedIndex.map((i, n) => ({ samples: clips[i].samples, position: positions[n] })),
    { sampleRate, length: sourceDuration }
  );
  const { buffer, contentType } = await deps.encode(track);
  checkCancelled();

  // 7. Checking
  report({ phase: 'checking', step: 7 });
  const placedUnits = placedIndex.map((i) => units[i]);
  const { lines, summary } = measureSync(placedUnits, placedIndex.map((i) => clips[i]), positions, { tolerance });
  const lineFor = new Map(placedIndex.map((i, n) => [i, lines[n]]));

  const unitReports = units.map((unit, i) => {
    const line = lineFor.get(i);
    return {
      index: i,
      cueIds: unit.cueIds,
      text: texts[i],
      originalText: unit.text,
      sourceText: unit.sourceText,
      srcStart: unit.srcStart,
      srcEnd: unit.srcEnd,
      placedStart: line ? line.placedStart : null,
      placedEnd: line ? line.placedEnd : null,
      offset: line ? line.offset : null,
      overrun: line ? line.overrun : null,
      inSync: line ? line.inSync : false,
      silent: !line,
      rewritten: rewritten.has(i),
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
        rewritten: rewritten.size,
        pauseTrimmed: pauseTrimmed.size,
        silent: units.length - placedIndex.length,
      },
      units: unitReports,
    },
  };
};
