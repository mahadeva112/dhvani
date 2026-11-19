import type { SyncBank, SyncEditPart, SyncEdits } from './syncEditService';
import { partLine, syncedParts } from './syncEditModel.ts';
import { isStreamedAudio, type SampleSource, type WaveAudio } from './waveform.ts';

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
  /** A clip of the original: `bankFrom` and `bankTo` are seconds of the original, not of the bank. */
  original?: boolean;
  /** An audio clip on a track: `bankFrom` and `bankTo` are seconds of this file (its id), not of the bank. */
  file?: string;
}

/** An audio clip's part as it plays, with its track's level (syncEditModel's audioParts). */
export interface LiveTrackPart {
  part: SyncEditPart;
  file: string;
  /** The track's level as a gain. */
  gain: number;
}

const EDGE_FADE = 0.003;
/** How far ahead parts are scheduled; the rest are added as playback gets near them. */
const LOOKAHEAD = 8;
/**
 * A bank held as peaks (a long dub) has its parts read from its file: those
 * starting up to this far ahead are read before they are due, and parts
 * this far behind are let go, so only the stretch around the playhead is in
 * memory.
 */
const READ_AHEAD = 20;
const KEEP_BEHIND = 10;
/** How far the dub may drift from the original's clock before it is put back on it. */
const MAX_DRIFT = 0.05;
/** Lead before the first part plays, so its start is never in the past. */
const START_LEAD = 0.02;

const clipLength = (clip: LiveClip) => (clip.bankTo - clip.bankFrom) / clip.rate;

/** The parts that play, as the server would render them (renderPayload, renderEdits). */
export const liveClips = (
  bank: SyncBank,
  edits: SyncEdits | null | undefined,
  multiSpeaker: boolean,
  /** The clips of the original that play (syncEditService's originalParts), from the original's own buffer. */
  originals: SyncEditPart[] = [],
  /** Speakers not to play: muted or left out by a solo in Edit timing. Listening only. */
  silenced: ReadonlySet<string> = new Set(),
  /** The audio clips on tracks that play (not muted or soloed away), from their files' own buffers. */
  trackParts: LiveTrackPart[] = []
): LiveClip[] => {
  const rate = bank.sampleRate;
  const out: LiveClip[] = [];
  for (const { part, file, gain: trackGain } of trackParts) {
    const gain = trackGain * 10 ** (part.gainDb / 20);
    out.push({
      id: ['file', file, part.id, part.start, part.from, part.to, part.rate, gain.toFixed(5), part.fadeIn, part.fadeOut].join(':'),
      stretchKey: `file:${file}:${part.from.toFixed(5)}:${part.to.toFixed(5)}:${part.rate}`,
      bankFrom: part.from,
      bankTo: part.to,
      start: Math.max(0, part.start),
      rate: part.rate,
      gain,
      fadeIn: part.fadeIn,
      fadeOut: part.fadeOut,
      cutIn: true,
      cutOut: true,
      file,
    });
  }
  for (const part of originals) {
    out.push({
      id: ['original', part.id, part.start, part.from, part.to, part.rate, part.gainDb, part.fadeIn, part.fadeOut].join(':'),
      stretchKey: `original:${part.from.toFixed(5)}:${part.to.toFixed(5)}:${part.rate}`,
      bankFrom: part.from,
      bankTo: part.to,
      start: Math.max(0, part.start),
      rate: part.rate,
      gain: 10 ** (part.gainDb / 20),
      fadeIn: part.fadeIn,
      fadeOut: part.fadeOut,
      cutIn: true,
      cutOut: true,
      original: true,
    });
  }
  for (const base of bank.lines) {
    if (silenced.has(base.speaker)) continue;
    const speakerGain = multiSpeaker ? (Number.isFinite(bank.speakerGains?.[base.speaker]) ? bank.speakerGains[base.speaker] : 1) : 1;
    // A line nobody edited plays as Sync placed it: whole, or as its chunks (syncEditModel's syncedParts).
    const parts: SyncEditPart[] = edits?.[base.key]?.parts ?? syncedParts(base, rate);
    for (const part of parts) {
      if (part.muted) continue;
      // A copy with samples of its own plays those.
      const line = partLine(base, part);
      const lineGain = Number.isFinite(line.gain) ? line.gain : 1;
      const seconds = line.length / rate;
      const from = Math.max(0, Math.min(seconds, part.from));
      const to = Math.max(from, Math.min(seconds, part.to));
      if (to - from <= 0) continue;
      const bankFrom = line.bankStart / rate + from;
      const bankTo = line.bankStart / rate + to;
      const gain = lineGain * speakerGain * 10 ** (part.gainDb / 20);
      out.push({
        // The gain is in the id, so a speaker's level set while playing is heard at once.
        id: [part.id, part.start, from, to, part.rate, gain.toFixed(5), part.fadeIn, part.fadeOut].join(':'),
        stretchKey: `${bankFrom.toFixed(5)}:${bankTo.toFixed(5)}:${part.rate}`,
        bankFrom,
        bankTo,
        start: Math.max(0, part.start),
        rate: part.rate,
        gain,
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
  /** The bank decoded whole, or null when its parts are read from its file (`bankFile`). */
  private bank: AudioBuffer | null;
  private bankFile: SampleSource | null;
  /** Parts of a bank read from its file, as they play (stretched where they are), by stretchKey. */
  private read = new Map<string, AudioBuffer>();
  private reading = new Set<string>();
  /** The original, for the clips of it on the dub; they stay silent without it. Held as its peaks, they are read from its file. */
  private original: AudioBuffer | null = null;
  private originalFile: SampleSource | null = null;

  constructor(ctx: AudioContext, output: AudioNode, bank: WaveAudio) {
    this.ctx = ctx;
    this.output = output;
    this.bank = isStreamedAudio(bank) ? null : bank;
    this.bankFile = isStreamedAudio(bank) ? bank.samples ?? null : null;
  }

  /** The files on tracks, by id, for their clips; a clip whose file isn't here stays silent. */
  private files: Record<string, AudioBuffer> = {};
  setFiles(files: Record<string, AudioBuffer>) {
    if (files === this.files) return;
    this.files = files;
    for (const key of this.stretched.keys()) if (key.startsWith('file:')) this.stretched.delete(key);
    this.schedule();
  }

  private originalAudio: WaveAudio | null = null;
  setOriginal(original: WaveAudio | null) {
    if (original === this.originalAudio) return;
    this.originalAudio = original;
    this.original = original && !isStreamedAudio(original) ? original : null;
    this.originalFile = isStreamedAudio(original) ? original.samples ?? null : null;
    for (const key of this.stretched.keys()) if (key.startsWith('original:')) this.stretched.delete(key);
    for (const key of this.read.keys()) if (key.startsWith('original:')) this.read.delete(key);
    this.schedule();
  }

  /** Where a part's samples are read from when they are not in memory: the bank's file, or the original's. */
  private fileOf(clip: LiveClip): SampleSource | null {
    if (clip.file) return null;
    return clip.original ? this.originalFile : this.bankFile;
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
    for (const key of this.read.keys()) if (!stretches.has(key)) this.read.delete(key);
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
    this.read.clear();
    this.reading.clear();
    this.bankFile = null;
    this.originalFile = null;
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
    if (this.bankFile || this.originalFile) this.readAround(now);
  }

  /** Reads the bank's parts coming up from its file, and lets go of the ones long played. */
  private readAround(now: number) {
    const near = new Set<string>();
    for (const clip of this.clips) {
      if (clip.start > now + READ_AHEAD) break;
      if (!this.fileOf(clip) || clip.start + clipLength(clip) < now - KEEP_BEHIND) continue;
      near.add(clip.stretchKey);
      this.readPart(clip);
    }
    // A part playing keeps its own buffer; this only lets the copy here go.
    for (const key of this.read.keys()) if (!near.has(key)) this.read.delete(key);
  }

  private readPart(clip: LiveClip) {
    const file = this.fileOf(clip);
    const key = clip.stretchKey;
    if (!file || this.read.has(key) || this.reading.has(key)) return;
    this.reading.add(key);
    const sr = file.sampleRate;
    file
      .read(Math.round(clip.bankFrom * sr), Math.round(clip.bankTo * sr))
      .then((channels) => {
        if (!this.reading.has(key) || this.fileOf(clip) !== file || channels[0].length === 0) return;
        const out = Math.abs(clip.rate - 1) < 1e-6 ? channels : stretchSamples(channels, sr, clip.rate);
        const buffer = this.ctx.createBuffer(out.length, out[0].length, sr);
        out.forEach((data, ch) => buffer.copyToChannel(data, ch));
        this.read.set(key, buffer);
        // Due already (playback started inside it, or it was read late): it joins from where playback is.
        this.schedule();
      })
      .catch((err) => console.warn('A line could not be read from the dub file:', err))
      .finally(() => this.reading.delete(key));
  }

  private bufferFor(clip: LiveClip): { buffer: AudioBuffer; offset: number } | null {
    if (this.fileOf(clip)) {
      // Read from the file, stretched already: silent until it is read, then it joins.
      const buffer = this.read.get(clip.stretchKey);
      if (buffer) return { buffer, offset: 0 };
      this.readPart(clip);
      return null;
    }
    const audio = clip.file ? this.files[clip.file] ?? null : clip.original ? this.original : this.bank;
    if (!audio) return null;
    if (Math.abs(clip.rate - 1) < 1e-6) return { buffer: audio, offset: clip.bankFrom };
    let buffer = this.stretched.get(clip.stretchKey);
    if (!buffer) {
      const sr = audio.sampleRate;
      const from = Math.round(clip.bankFrom * sr);
      const to = Math.min(audio.length, Math.round(clip.bankTo * sr));
      const channels = Array.from({ length: audio.numberOfChannels }, (_, ch) => audio.getChannelData(ch).subarray(from, to));
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
    const audio = this.bufferFor(clip);
    if (!audio) return;
    const { buffer, offset } = audio;
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
