import type { SyncBank, SyncEditPart, SyncEdits } from './syncEditService';

/**
 * Live playback for Edit timing, the way a DAW plays its clips: the synced
 * dub's lines are played straight from the bank, each part scheduled on the
 * audio clock where the edits put it. An edit is heard the moment it is made,
 * and playback never stops for it.
 *
 * This is for listening only. The file the user downloads is still the
 * server's render (server/lib/syncEdit.js), which is what decides every
 * sample. The two differ only in what the render does on top of the parts:
 * it finds a quiet sample for a trimmed edge where this gives every cut edge
 * a 3 ms fade, it turns a whole mix down if it would clip, and a stretched
 * part is stretched by ffmpeg there and by a WSOLA stretch here.
 */

/** One part as it plays: seconds in the bank, seconds on the timeline. */
export interface LiveClip {
  /** The part, where it plays and how it sounds. */
  id: string;
  /** The samples and the speed, so a stretched copy is kept while the part only moves. */
  stretchKey: string;
  bankFrom: number;
  bankTo: number;
  start: number;
  rate: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  /** The part starts or ends inside its line, so its edge gets a short fade, as the render's micro-fade. */
  cutIn: boolean;
  cutOut: boolean;
}

const EDGE_FADE = 0.003;
/** How far ahead parts are scheduled; the rest are added as playback gets near them. */
const LOOKAHEAD = 8;
/** How far the dub may drift from the original's clock before it is put back on it. */
const MAX_DRIFT = 0.05;
/** Lead before the first part plays, so its start is never in the past. */
const START_LEAD = 0.02;

const clipLength = (clip: LiveClip) => (clip.bankTo - clip.bankFrom) / clip.rate;

/** The parts that play, as the server would render them (renderPayload, renderEdits). */
export const liveClips = (bank: SyncBank, edits: SyncEdits | null | undefined, multiSpeaker: boolean): LiveClip[] => {
  const rate = bank.sampleRate;
  const out: LiveClip[] = [];
  for (const line of bank.lines) {
    const lineGain = Number.isFinite(line.gain) ? line.gain : 1;
    const speakerGain = multiSpeaker ? (Number.isFinite(bank.speakerGains?.[line.speaker]) ? bank.speakerGains[line.speaker] : 1) : 1;
    const seconds = line.length / rate;
    // A line nobody edited plays whole, where Sync put it (syncEditService's basePart).
    const parts: SyncEditPart[] = edits?.[line.key]?.parts ?? [
      { id: `${line.key}#0`, start: line.startSample / rate, from: 0, to: seconds, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0, muted: false },
    ];
    for (const part of parts) {
      if (part.muted) continue;
      const from = Math.max(0, Math.min(seconds, part.from));
      const to = Math.max(from, Math.min(seconds, part.to));
      if (to - from <= 0) continue;
      const bankFrom = line.bankStart / rate + from;
      const bankTo = line.bankStart / rate + to;
      out.push({
        id: [part.id, part.start, from, to, part.rate, part.gainDb, part.fadeIn, part.fadeOut].join(':'),
        stretchKey: `${bankFrom.toFixed(5)}:${bankTo.toFixed(5)}:${part.rate}`,
        bankFrom,
        bankTo,
        start: Math.max(0, part.start),
        rate: part.rate,
        gain: lineGain * speakerGain * 10 ** (part.gainDb / 20),
        fadeIn: part.fadeIn,
        fadeOut: part.fadeOut,
        cutIn: from > 1e-4,
        cutOut: to < seconds - 1e-4,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
};

/**
 * Plays `input` at `rate` with its pitch kept (WSOLA: overlapping windows
 * taken from the input at the new pace, each one shifted a little to where it
 * best continues the last). 1.1 plays ten per cent faster.
 */
export const stretchSamples = (input: Float32Array[], sampleRate: number, rate: number): Float32Array[] => {
  const length = input[0]?.length ?? 0;
  const outLength = Math.max(1, Math.round(length / rate));
  const frame = Math.max(64, Math.round(0.04 * sampleRate) & ~1);
  const hop = frame / 2;
  const tolerance = Math.round(0.01 * sampleRate);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const out = input.map(() => new Float32Array(outLength + frame));
  const norm = new Float32Array(outLength + frame);
  const ref = input[0];
  const at = (i: number) => (i >= 0 && i < length ? ref[i] : 0);
  let prev = 0;
  for (let outPos = 0; outPos < outLength; outPos += hop) {
    const nominal = Math.round(outPos * rate);
    let inPos = nominal;
    if (outPos > 0) {
      // The window that best continues the last one: the input right after it, matched over half a frame.
      const natural = prev + hop;
      let best = -Infinity;
      for (let d = -tolerance; d <= tolerance; d += 2) {
        const c = nominal + d;
        if (c < 0 || c + frame > length) continue;
        let score = 0;
        for (let i = 0; i < hop; i += 4) score += at(c + i) * at(natural + i);
        if (score > best) {
          best = score;
          inPos = c;
        }
      }
    }
    inPos = Math.max(0, Math.min(Math.max(0, length - 1), inPos));
    for (let ch = 0; ch < input.length; ch++) {
      const src = input[ch];
      const dst = out[ch];
      for (let i = 0; i < frame; i++) {
        const j = inPos + i;
        if (j >= length) break;
        dst[outPos + i] += src[j] * window[i];
      }
    }
    for (let i = 0; i < frame; i++) norm[outPos + i] += window[i];
    prev = inPos;
  }
  return out.map((channel) => {
    const result = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) result[i] = norm[i] > 1e-3 ? channel[i] / norm[i] : channel[i];
    return result;
  });
};

/** A raised-cosine fade, as the render draws one: 0 to 1 over `x` from 0 to 1. */
const rise = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

/** `fade` is only for stopping: the part's own envelope is a curve on `gain` that nothing else may touch. */
type Playing = { source: AudioBufferSourceNode; fade: GainNode };

export class LiveDubEngine {
  private clips: LiveClip[] = [];
  private playing = new Map<string, Playing>();
  private stretched = new Map<string, AudioBuffer>();
  /** Timeline seconds `t0` play at audio-clock seconds `ctx0`; null when stopped. */
  private clock: { t0: number; ctx0: number } | null = null;

  private ctx: AudioContext;
  private output: AudioNode;
  private bank: AudioBuffer;

  constructor(ctx: AudioContext, output: AudioNode, bank: AudioBuffer) {
    this.ctx = ctx;
    this.output = output;
    this.bank = bank;
  }

  get running() {
    return this.clock !== null;
  }

  /** The timeline time being heard now, from the audio clock. */
  now(): number | null {
    return this.clock ? this.clock.t0 + (this.ctx.currentTime - this.clock.ctx0) : null;
  }

  /**
   * New edits, heard straight away: parts that changed stop and play again
   * as edited, from where playback is; parts that didn't play on untouched.
   */
  setClips(clips: LiveClip[]) {
    this.clips = clips;
    const stretches = new Set(clips.map((clip) => clip.stretchKey));
    for (const key of this.stretched.keys()) if (!stretches.has(key)) this.stretched.delete(key);
    const ids = new Set(clips.map((clip) => clip.id));
    const at = this.ctx.currentTime;
    this.playing.forEach((node, id) => {
      if (ids.has(id)) return;
      this.release(node, at);
      this.playing.delete(id);
    });
    this.schedule();
  }

  /**
   * Keeps the dub on the original's clock: starts it if stopped, puts it back
   * if it drifted, and schedules the parts coming up. Call often while playing.
   */
  follow(t: number) {
    const heard = this.now();
    if (heard === null || Math.abs(heard - t) > MAX_DRIFT) this.start(t);
    else this.schedule();
  }

  stop() {
    const at = this.ctx.currentTime;
    this.playing.forEach((node) => this.release(node, at));
    this.playing.clear();
    this.clock = null;
  }

  /** Stops a part with a short fade, so stopping mid-word doesn't click. */
  private release({ source, fade }: Playing, at: number) {
    fade.gain.setValueAtTime(1, at);
    fade.gain.linearRampToValueAtTime(0, at + 0.008);
    try {
      source.stop(at + 0.01);
    } catch {
      /* already stopped */
    }
  }

  dispose() {
    this.stop();
    this.stretched.clear();
  }

  private start(t: number) {
    this.stop();
    this.clock = { t0: t + START_LEAD, ctx0: this.ctx.currentTime + START_LEAD };
    this.schedule();
  }

  private schedule() {
    const clock = this.clock;
    if (!clock) return;
    const now = this.now() as number;
    const until = now + LOOKAHEAD;
    for (const clip of this.clips) {
      if (clip.start > until) break;
      const end = clip.start + clipLength(clip);
      if (end <= now + START_LEAD || this.playing.has(clip.id)) continue;
      // A part already under way joins a moment from now, so its start is never in the past.
      this.play(clip, Math.max(clip.start, now + START_LEAD), clock);
    }
    // Parts that have finished leave the list, so they could be scheduled again after a seek.
    this.playing.forEach((_, id) => {
      const clip = this.clips.find((c) => c.id === id);
      if (!clip || clip.start + clipLength(clip) < now - 0.1) this.playing.delete(id);
    });
  }

  private bufferFor(clip: LiveClip): { buffer: AudioBuffer; offset: number } {
    if (Math.abs(clip.rate - 1) < 1e-6) return { buffer: this.bank, offset: clip.bankFrom };
    let buffer = this.stretched.get(clip.stretchKey);
    if (!buffer) {
      const sr = this.bank.sampleRate;
      const from = Math.round(clip.bankFrom * sr);
      const to = Math.min(this.bank.length, Math.round(clip.bankTo * sr));
      const channels = Array.from({ length: this.bank.numberOfChannels }, (_, ch) => this.bank.getChannelData(ch).subarray(from, to));
      const out = stretchSamples(channels, sr, clip.rate);
      buffer = this.ctx.createBuffer(out.length, out[0].length, sr);
      out.forEach((data, ch) => buffer!.copyToChannel(data, ch));
      this.stretched.set(clip.stretchKey, buffer);
    }
    return { buffer, offset: 0 };
  }

  /** Plays `clip` from timeline time `from` (its start, or later when playback starts inside it). */
  private play(clip: LiveClip, from: number, clock: { t0: number; ctx0: number }) {
    const length = clipLength(clip);
    const into = from - clip.start;
    const left = length - into;
    if (left <= 0.001) return;
    const when = Math.max(this.ctx.currentTime, clock.ctx0 + (from - clock.t0));
    const { buffer, offset } = this.bufferFor(clip);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    const fade = this.ctx.createGain();
    source.connect(gain);
    gain.connect(fade);
    fade.connect(this.output);

    /*
     * The envelope as one curve over what is left of the part: the user's
     * fades and the cut edges' short fades, raised-cosine and at most half the
     * part each, and a short ramp in when playback starts inside the part.
     */
    const half = length / 2;
    const fadeIn = Math.min(half, Math.max(clip.fadeIn, clip.cutIn ? EDGE_FADE : 0));
    const fadeOut = Math.min(half, Math.max(clip.fadeOut, clip.cutOut ? EDGE_FADE : 0));
    const ramp = into > 1e-4 ? Math.min(0.006, left / 2) : 0;
    const envelope = (u: number) =>
      clip.gain *
      (fadeIn > 0 ? rise(u / fadeIn) : 1) *
      (fadeOut > 0 ? rise((length - u) / fadeOut) : 1) *
      (ramp > 0 ? Math.min(1, (u - into) / ramp) : 1);
    const points = Math.min(200_000, Math.max(2, Math.ceil(left * 1000)));
    const values = new Float32Array(points);
    for (let i = 0; i < points; i++) values[i] = envelope(into + (left * i) / (points - 1));
    gain.gain.value = values[0];
    gain.gain.setValueCurveAtTime(values, when, left);

    source.start(when, Math.min(buffer.duration, offset + into), left);
    this.playing.set(clip.id, { source, fade });
  }
}
