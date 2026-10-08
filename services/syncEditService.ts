import { apiJson, apiPutBlob, DhvaniApiError } from './apiClient';
import { fetchMixed } from './castService';
import { DubMixReport, DubStem } from '../types';
import type { SyncReport, SyncUnitReport } from './syncService';

/**
 * Edit timing: the synced dub's lines moved, trimmed, split, stretched,
 * turned up or down, faded or muted by hand, after Sync has placed them.
 *
 * Sync hands back a bank with the dub: every placed line exactly as the
 * render took it (server/lib/syncDub.js). The edits say what to do with each
 * line, and the server renders the dub again from the bank
 * (server/lib/syncEdit.js). A line with no edits is copied in exactly as Sync
 * placed it, so no edits at all is the synced dub again. Nothing here changes
 * a voice unless the user set it on that line: speed, gain and fades are
 * 100%, 0 dB and none until they are changed.
 */

/** One placed line in the bank. Sample counts are at the bank's own rate. */
export interface SyncBankLine {
  /** The line's key, as in the sync report. */
  key: string;
  speaker: string;
  /** Where the line's samples are in the bank. */
  bankStart: number;
  length: number;
  /** Where Sync put the line's first sample. */
  startSample: number;
  maxStartShift?: number;
  /** Seconds from the line's first sample to its first word, and of speech. */
  lead: number;
  speech: number;
  /** Loudness-matching gain the sync gave the line; 1 unless matching was on. */
  gain: number;
  /** What a later sync needs to recognise this take and cut it the same way. */
  hash: string;
  cuts: { start: number; end: number }[];
  crossfade: number;
  /** Samples dropped before 0:00 from the line's start. */
  dropped: number;
  /** The sync held this line where an earlier edit locked it. */
  locked: boolean;
  /** Not a bank line: the original, for a clip of it on the dub (see originalLine). */
  original?: boolean;
}

/** A bank: the lines' samples live in a WAV kept with the project (`syncBankBlob`). */
export interface SyncBank {
  bankId: string;
  sampleRate: number;
  float: boolean;
  lines: SyncBankLine[];
  speakerGains: Record<string, number>;
}

/**
 * One stretch of a line on the timeline. Times are seconds: `start` on the
 * timeline, `from` and `to` inside the line as Sync placed it.
 */
export interface SyncEditPart {
  id: string;
  start: number;
  from: number;
  to: number;
  /** Speed: 1 as voiced, 1.1 ten per cent faster. Pitch is kept. */
  rate: number;
  gainDb: number;
  /** Fades the user drew, in seconds. */
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

/** What the user did to one line. `parts` empty: the line was removed. */
export interface SyncLineEdit {
  parts: SyncEditPart[];
  /** A locked line stays where it is when Sync runs again. */
  locked: boolean;
}

/** Edits by line key. A line not in it is as Sync placed it. */
export type SyncEdits = Record<string, SyncLineEdit>;

/**
 * Clips of the original on the dub: a stretch of the original's own voice
 * the user cut from its lane and put on the dub, to fill a gap. Each is kept
 * in the edits under a key starting with this, its parts' `from` and `to`
 * being seconds of the original; it plays and renders as it is, at the dub's
 * sample rate, with whatever gain, fades or speed the user gives it.
 */
export const ORIGINAL_CLIP_PREFIX = 'original:';
/** The speaker an original clip renders as, so a dub with several voices gives it a stem of its own. */
export const ORIGINAL_SPEAKER = 'Original audio';

export const isOriginalClip = (key: string) => key.startsWith(ORIGINAL_CLIP_PREFIX);

/** The original as a line, for the clip `key`: what its parts are cut from. */
export const originalLine = (key: string, sourceDuration: number, sampleRate: number): SyncBankLine => ({
  key,
  speaker: ORIGINAL_SPEAKER,
  bankStart: 0,
  length: Math.max(1, Math.round(sourceDuration * sampleRate)),
  startSample: 0,
  lead: 0,
  speech: 0,
  gain: 1,
  hash: '',
  cuts: [],
  crossfade: 0,
  dropped: 0,
  locked: false,
  original: true,
});

/** The clips of the original in `edits`, each as its line, in the order they were made. */
export const originalLines = (edits: SyncEdits | null | undefined, sourceDuration: number, sampleRate: number): SyncBankLine[] =>
  Object.keys(edits ?? {})
    .filter(isOriginalClip)
    .map((key) => originalLine(key, sourceDuration, sampleRate));

/** Speeds a part may be stretched to in Edit timing. */
export const MIN_EDIT_RATE = 0.7;
export const MAX_EDIT_RATE = 1.3;

/** The shortest a part may be trimmed to, in seconds. */
export const MIN_PART_SECONDS = 0.05;

/** The line as Sync placed it: one part, the whole line, nothing changed. */
export const basePart = (line: SyncBankLine, sampleRate: number): SyncEditPart => ({
  id: `${line.key}#0`,
  start: line.startSample / sampleRate,
  from: 0,
  to: line.length / sampleRate,
  rate: 1,
  gainDb: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
});

/** The parts a line plays: its edits, or the line as placed. */
export const partsOf = (edits: SyncEdits | null | undefined, line: SyncBankLine, sampleRate: number): SyncEditPart[] =>
  edits?.[line.key]?.parts ?? [basePart(line, sampleRate)];

/** Seconds a part takes on the timeline. */
export const partLength = (part: SyncEditPart) => (part.to - part.from) / part.rate;
export const partEnd = (part: SyncEditPart) => part.start + partLength(part);

/** Timeline seconds of a moment `t` inside the line, as this part plays it. */
export const partTime = (part: SyncEditPart, t: number) => part.start + (t - part.from) / part.rate;

export const hasEdits = (edits: SyncEdits | null | undefined) => Boolean(edits && Object.keys(edits).length > 0);

/** True when the line has been changed from what Sync placed. */
export const isEdited = (edits: SyncEdits | null | undefined, key: string) => Boolean(edits && edits[key]);

/**
 * Where a line's words land with its edits: from its first word to its last,
 * over the parts that still play some of them. Null when none does.
 */
export const spokenSpan = (line: SyncBankLine, parts: SyncEditPart[]): { start: number; end: number } | null => {
  const first = line.lead;
  const last = line.lead + line.speech;
  let start = Infinity;
  let end = -Infinity;
  for (const part of parts) {
    if (part.muted || part.to <= first || part.from >= last) continue;
    start = Math.min(start, partTime(part, Math.max(part.from, first)));
    end = Math.max(end, partTime(part, Math.min(part.to, last)));
  }
  return Number.isFinite(start) ? { start, end } : null;
};

const percentile = (sorted: number[], p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);

/**
 * The sync report for the edited dub, worked out from Sync's own report:
 * where every edited line's words now land, how far from its original line,
 * and the joins either side, measured as Sync measures them
 * (server/lib/syncPlace.js). A line nobody edited keeps its numbers exactly.
 */
export const measureEdits = (base: SyncReport, bank: SyncBank, edits: SyncEdits | null | undefined): SyncReport => {
  if (!hasEdits(edits)) return base;
  const lineByKey = new Map(bank.lines.map((line) => [line.key, line]));
  const tolerance = base.tolerance;
  const units: SyncUnitReport[] = base.units.map((unit, n) => {
    const line = lineByKey.get(unit.key);
    if (!line || !edits?.[unit.key]) return unit;
    const span = spokenSpan(line, partsOf(edits, line, bank.sampleRate));
    if (!span) return { ...unit, placedStart: null, placedEnd: null, offset: null, overrun: null, inSync: false, silent: true, late: false };
    const nextStart = base.units[n + 1]?.srcStart ?? null;
    const offset = span.start - unit.srcStart;
    const overrun = nextStart === null ? 0 : Math.max(0, span.end - nextStart);
    return {
      ...unit,
      placedStart: span.start,
      placedEnd: span.end,
      offset,
      overrun,
      inSync: Math.abs(offset) <= tolerance && overrun <= tolerance,
      silent: false,
      late: offset > base.join.maxLateStart,
    };
  });

  // Joins between the words of each line and the next one that still speaks.
  const spoken = units.filter((unit) => unit.placedStart !== null && unit.placedEnd !== null);
  const joinAfter = new Map<string, number>();
  spoken.forEach((unit, n) => {
    const next = spoken[n + 1];
    if (next) joinAfter.set(unit.key, (next.placedStart as number) - (unit.placedEnd as number));
  });
  // A join nobody changed keeps Sync's verdict (which allows overlaps kept from the original).
  const withJoins = units.map((unit) => {
    const join = joinAfter.has(unit.key) ? (joinAfter.get(unit.key) as number) : null;
    if (join === unit.joinAfter || (join !== null && unit.joinAfter !== null && Math.abs(join - unit.joinAfter) < 1e-6)) return unit;
    return { ...unit, joinAfter: join, tightJoin: join !== null && join < base.join.flagJoin };
  });

  // Parts of different lines playing over each other.
  const placed = bank.lines
    .flatMap((line) => partsOf(edits, line, bank.sampleRate).filter((part) => !part.muted))
    .sort((a, b) => a.start - b.start);
  let overlaps = 0;
  for (let i = 1; i < placed.length; i++) if (placed[i].start < partEnd(placed[i - 1]) - 1e-6) overlaps++;

  const errors = withJoins
    .filter((unit) => unit.offset !== null)
    .map((unit) => Math.abs(unit.offset as number))
    .sort((a, b) => a - b);
  return {
    ...base,
    units: withJoins,
    summary: {
      ...base.summary,
      inSync: withJoins.filter((unit) => unit.inSync).length,
      medianError: percentile(errors, 0.5),
      p90Error: percentile(errors, 0.9),
      maxError: errors.length ? errors[errors.length - 1] : 0,
      overlaps,
      late: withJoins.filter((unit) => unit.late).length,
      tightJoins: withJoins.filter((unit) => unit.tightJoin).length,
      silent: withJoins.filter((unit) => unit.silent).length,
    },
  };
};

/**
 * The locked lines, as Sync is told about them when it runs again: the take
 * each was edited on and the stretch of the timeline its parts take, so the
 * sync holds it there and places every other line around it. A removed line
 * has no stretch to hold and isn't sent; it stays removed if it comes back as
 * the same take (see rebaseEdits).
 */
export const lockedLines = (bank: SyncBank | null | undefined, edits: SyncEdits | null | undefined) => {
  const out: Record<string, { hash: string; cuts: { start: number; end: number }[]; crossfade: number; start: number; end: number }> = {};
  if (!bank || !edits) return out;
  for (const line of bank.lines) {
    const edit = edits[line.key];
    if (!edit?.locked || edit.parts.length === 0) continue;
    out[line.key] = {
      hash: line.hash,
      cuts: line.cuts,
      crossfade: line.crossfade,
      start: Math.min(...edit.parts.map((part) => part.start)),
      end: Math.max(...edit.parts.map(partEnd)),
    };
  }
  return out;
};

/**
 * The edits that carry over to a new sync: locked lines that came back as
 * the same take, moved by however far the sync had to shift them (nothing,
 * unless an earlier locked line was in the way). Every other line is as the
 * new sync placed it. Returns the edits and the keys of lines whose edits
 * were dropped because the line was voiced again.
 */
export const rebaseEdits = (
  edits: SyncEdits | null | undefined,
  oldBank: SyncBank | null | undefined,
  newBank: SyncBank
): { edits: SyncEdits; dropped: string[] } => {
  const out: SyncEdits = {};
  const dropped: string[] = [];
  if (!edits || !oldBank) return { edits: out, dropped };
  const oldLines = new Map(oldBank.lines.map((line) => [line.key, line]));
  const newLines = new Map(newBank.lines.map((line) => [line.key, line]));
  const rate = newBank.sampleRate;
  for (const [key, edit] of Object.entries(edits)) {
    // A clip of the original is cut from the original, which a new sync doesn't change.
    if (isOriginalClip(key)) {
      out[key] = edit;
      continue;
    }
    if (!edit.locked) continue;
    const before = oldLines.get(key);
    const now = newLines.get(key);
    if (!before || !now || before.hash !== now.hash || oldBank.sampleRate !== rate) {
      dropped.push(key);
      continue;
    }
    if (edit.parts.length === 0) {
      out[key] = edit;
      continue;
    }
    if (!now.locked) {
      dropped.push(key);
      continue;
    }
    // The line's samples are the same take, cut the same way; only what was dropped before 0:00 may differ.
    const shiftInside = (before.dropped - now.dropped) / rate;
    const heldAt = Math.min(...edit.parts.map((part) => part.start));
    const shift = now.startSample / rate - heldAt;
    out[key] = {
      locked: true,
      parts: edit.parts.map((part) => ({ ...part, start: part.start + shift, from: part.from + shiftInside, to: part.to + shiftInside })),
    };
  }
  return { edits: out, dropped };
};

/** The parts the server renders: every part that plays, in samples, by bank line. */
export const renderPayload = (bank: SyncBank, edits: SyncEdits | null | undefined) => {
  const rate = bank.sampleRate;
  return bank.lines.flatMap((line, index) =>
    partsOf(edits, line, rate)
      .filter((part) => !part.muted)
      .map((part) => {
        const from = Math.max(0, Math.min(line.length - 1, Math.round(part.from * rate)));
        return {
          line: index,
          from,
          to: Math.max(from + 1, Math.min(line.length, Math.round(part.to * rate))),
          startSample: Math.max(0, Math.round(part.start * rate)),
          rate: part.rate,
          gainDb: part.gainDb,
          fadeIn: part.fadeIn,
          fadeOut: part.fadeOut,
        };
      })
  );
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The parts of the clips of the original that play, in seconds of the original. */
export const originalParts = (edits: SyncEdits | null | undefined, sourceDuration: number) =>
  Object.entries(edits ?? {})
    .filter(([key]) => isOriginalClip(key))
    .flatMap(([, edit]) => edit.parts)
    .filter((part) => !part.muted)
    .map((part) => {
      const from = clamp(part.from, 0, sourceDuration);
      return { ...part, from, to: clamp(part.to, from, sourceDuration) };
    })
    .filter((part) => part.to - part.from > 0);

/** `from` to `to` seconds of `source` as one channel at `sampleRate`: the dub's own rate and channels. */
const originalSamples = async (source: AudioBuffer, from: number, to: number, sampleRate: number) => {
  const length = Math.max(1, Math.round((to - from) * sampleRate));
  if (source.sampleRate === sampleRate && source.numberOfChannels === 1) {
    const at = Math.round(from * sampleRate);
    return source.getChannelData(0).slice(at, at + length);
  }
  // Another rate or more channels: the browser resamples it and folds it to one channel, as the dub is.
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = source;
  node.connect(ctx.destination);
  node.start(0, from, to - from);
  return (await ctx.startRendering()).getChannelData(0);
};

/** One channel of 32-bit float samples as a WAV, as the server reads a bank. */
const floatWav = (samples: Float32Array, sampleRate: number) => {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 4));
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 4, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 4, true);
  for (let i = 0; i < samples.length; i++) view.setFloat32(44 + i * 4, samples[i], true);
  return new Blob([view], { type: 'audio/wav' });
};

/** A name for these samples, so the server keeps one copy of them however often they render. */
const samplesId = (samples: Float32Array) => {
  const words = new Uint32Array(samples.buffer, samples.byteOffset, samples.length);
  let a = 0x811c9dc5;
  let b = 0x9747b28c ^ samples.length;
  for (let i = 0; i < words.length; i++) {
    a = Math.imul(a ^ words[i], 0x01000193);
    b = Math.imul(b ^ words[i], 0x5bd1e995) ^ (b >>> 13);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `original-${hex(a)}${hex(b)}-${samples.length.toString(36)}`;
};

/**
 * The clips of the original as the server renders them: each part's stretch
 * of the original, one after another as a bank of their own, and the parts
 * to play from it, numbered after the bank's lines.
 */
const originalRender = async (bank: SyncBank, edits: SyncEdits | null | undefined, source: AudioBuffer | null | undefined) => {
  const rate = bank.sampleRate;
  const parts = originalParts(edits, source?.duration ?? Infinity);
  if (parts.length === 0) return null;
  if (!source) throw new DhvaniApiError('The original audio is still loading. Try again in a moment.', { code: 'original_not_loaded' });
  const lines: { bankStart: number; length: number }[] = [];
  const pieces: Float32Array[] = [];
  let at = 0;
  for (const part of parts) {
    const piece = await originalSamples(source, part.from, part.to, rate);
    pieces.push(piece);
    lines.push({ bankStart: at, length: piece.length });
    at += piece.length;
  }
  const samples = new Float32Array(at);
  pieces.forEach((piece, n) => samples.set(piece, lines[n].bankStart));
  return {
    bankId: samplesId(samples),
    blob: () => floatWav(samples, rate),
    lines,
    parts: parts.map((part, n) => ({
      line: bank.lines.length + n,
      from: 0,
      to: lines[n].length,
      startSample: Math.max(0, Math.round(part.start * rate)),
      rate: part.rate,
      gainDb: part.gainDb,
      fadeIn: part.fadeIn,
      fadeOut: part.fadeOut,
    })),
  };
};

export interface SyncEditRender {
  blob: Blob;
  stems: DubStem[];
  mix: DubMixReport | null;
}

/**
 * Renders the edited dub on the server. When the server no longer has the
 * bank (it keeps banks a few hours, and not across a restart) the copy saved
 * with the project is sent again first.
 */
export const renderSyncEdits = async (
  {
    bank,
    bankBlob,
    edits,
    report,
    sourceDuration,
    source,
  }: {
    bank: SyncBank;
    bankBlob: Blob | null | undefined;
    edits: SyncEdits | null | undefined;
    report: SyncReport;
    sourceDuration: number;
    /** The original, for the clips of it on the dub. */
    source?: AudioBuffer | null;
  },
  { signal }: { signal?: AbortSignal } = {}
): Promise<SyncEditRender> => {
  const original = await originalRender(bank, edits, source);
  const body = {
    bankId: bank.bankId,
    sampleRate: bank.sampleRate,
    lines: bank.lines.map(({ bankStart, length, maxStartShift, gain, speaker }) => ({ bankStart, length, maxStartShift, gain, speaker })),
    speakerGains: bank.speakerGains,
    parts: [...renderPayload(bank, edits), ...(original?.parts ?? [])],
    ...(original && { original: { bankId: original.bankId, lines: original.lines } }),
    sourceDuration,
    edgeFade: report.join?.edgeFade ?? 0,
    multiSpeaker: Boolean(report.mix),
    peak: report.mix?.peak,
  };
  type Rendered = { audioId: string; contentType: string; stems: { speaker: string; audioId: string; contentType: string }[]; report: { mix?: DubMixReport } };
  let data: Rendered | null = null;
  // A bank the server doesn't have (it went, or the clips of the original are new) is sent, and the render tried again.
  for (let attempt = 0; !data; attempt++) {
    try {
      data = await apiJson<Rendered>('/sync/edit/render', { body, signal });
    } catch (err) {
      if (!(err instanceof DhvaniApiError) || attempt >= 2) throw err;
      if (err.code === 'edit_bank_missing') {
        if (!bankBlob) throw new DhvaniApiError('The lines of this sync were not saved with the project. Sync again to edit its timing.', { code: 'edit_bank_lost' });
        await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bank.bankId)}`, bankBlob, { signal });
      } else if (err.code === 'edit_original_missing' && original) {
        await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(original.bankId)}`, original.blob(), { signal });
      } else throw err;
    }
  }
  const { blob, stems, report: rendered } = await fetchMixed(data, signal);
  return { blob, stems, mix: rendered?.mix ?? null };
};
