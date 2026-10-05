/**
 * Edit timing: a synced dub rendered again from its bank (see runSync), with
 * the lines moved, trimmed, split, stretched, turned up or down, faded or
 * muted by hand.
 *
 * The bank holds every line exactly as the sync rendered it, so a line the
 * user left alone is copied in exactly as before, and rendering the bank with
 * no edits is the synced dub again. Everything the sync never does to a voice
 * happens here only because the user asked for it, on the lines they asked:
 *
 * - a move or a trim copies the same samples to a new place, or fewer of them;
 *   a trim that lands on sound gets the render's usual edge treatment (the
 *   edge moves to a quiet sample within 5 ms, or a 3 ms micro-fade);
 * - a split is two views of one line; played back to back where they were,
 *   they join without a seam, as if never split;
 * - a stretch changes the line's speed and keeps its pitch (ffmpeg's atempo,
 *   passed in as `stretch`); a gain and a fade change its level.
 */
import { renderTimeline } from './syncRender.js';
import { mixSpeakers } from './speakerMix.js';

/** Speeds a part may be stretched to, as a share of how it was voiced. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

/** Gain the user may set on a part, in dB. */
export const MIN_GAIN_DB = -48;
export const MAX_GAIN_DB = 24;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The parts to render, checked against the bank. `parts[i]` is `{ line, from,
 * to, startSample, rate, gainDb, fadeIn, fadeOut }`: the index of a bank line,
 * the samples of it to play (from, to), where the first of them goes on the
 * timeline, its speed (1 as voiced), gain in dB and fades in seconds. A part
 * outside its line, or naming a line the bank doesn't have, is refused.
 */
export const checkParts = (parts, bank) => {
  if (!Array.isArray(parts)) throw new Error('parts must be a list');
  return parts.map((part, n) => {
    const line = bank.lines[part?.line];
    if (!line) throw new Error(`part ${n} names no line of the bank`);
    const from = Math.round(Number(part.from));
    const to = Math.round(Number(part.to));
    if (!(from >= 0 && to <= line.length && to > from)) throw new Error(`part ${n} is outside its line`);
    const startSample = Math.round(Number(part.startSample));
    if (!(startSample >= 0)) throw new Error(`part ${n} starts before 0:00`);
    const rate = Number.isFinite(Number(part.rate)) ? clamp(Number(part.rate), MIN_RATE, MAX_RATE) : 1;
    const gainDb = Number.isFinite(Number(part.gainDb)) ? clamp(Number(part.gainDb), MIN_GAIN_DB, MAX_GAIN_DB) : 0;
    const fade = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
    return { line: part.line, from, to, startSample, rate, gainDb, fadeIn: fade(part.fadeIn), fadeOut: fade(part.fadeOut) };
  });
};

/**
 * Each bank line as its own array, made once per bank: two parts of one line
 * are views of the same array, which is what lets the render join a split
 * played straight through; parts of different lines never join.
 */
export const lineArrays = (bank) => bank.lines.map((line) => bank.samples.slice(line.bankStart, line.bankStart + line.length));

/**
 * Renders the edited dub. `params`: `{ bank, arrays, parts, sourceDuration,
 * edgeFade, multiSpeaker, peak }`, `arrays` from lineArrays and `parts` from
 * checkParts. `deps.stretch(samples, rate, { line, from, to })` returns the
 * samples played at `rate` with their pitch kept; it is only called for a
 * part that is stretched. Returns `{ track, stems?, report? }` as runSync
 * renders them: `stems` and the mix report with `multiSpeaker`.
 */
export const renderEdits = async ({ bank, arrays, parts, sourceDuration = 0, edgeFade = 0, multiSpeaker = false, peak = 'float' }, deps = {}) => {
  const { sampleRate } = bank;
  const clips = [];
  for (const part of parts) {
    const line = bank.lines[part.line];
    let samples = arrays[part.line].subarray(part.from, part.to);
    if (Math.abs(part.rate - 1) > 1e-6) {
      if (!deps.stretch) throw new Error('Stretching a line needs ffmpeg.');
      samples = await deps.stretch(samples, part.rate, { line: part.line, from: part.from, to: part.to });
    }
    if (samples.length === 0) continue;
    clips.push({
      samples,
      startSample: part.startSample,
      // The line's own start keeps the edge limit the sync gave it (none for a line cut at 0:00).
      ...(part.from === 0 && line.maxStartShift !== undefined && { maxStartShift: line.maxStartShift }),
      gain: (Number.isFinite(line.gain) ? line.gain : 1) * 10 ** (part.gainDb / 20),
      fadeInSamples: Math.round(part.fadeIn * sampleRate),
      fadeOutSamples: Math.round(part.fadeOut * sampleRate),
      speaker: line.speaker,
    });
  }

  if (multiSpeaker) {
    const gains = new Map(Object.entries(bank.speakerGains || {}).filter(([, gain]) => Number.isFinite(gain)));
    const mixed = mixSpeakers(clips, { sampleRate, length: sourceDuration, fadeSeconds: edgeFade, peak, gains });
    return { track: mixed.mix, stems: mixed.stems, report: mixed.report };
  }
  return { track: renderTimeline(clips, { sampleRate, length: sourceDuration, fadeSeconds: edgeFade }) };
};
