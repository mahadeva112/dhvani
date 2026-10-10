import { apiJson, apiPutBlob, DhvaniApiError } from './apiClient';
import { fetchMixed } from './castService';
import { DubMixReport, DubStem } from '../types';
import type { SyncReport } from './syncService';
import { originalParts, renderPayload, type SyncBank, type SyncEdits } from './syncEditModel.ts';

/** The bank, the edits and what they do to the report (syncEditModel.ts); here, rendering them on the server. */
export * from './syncEditModel.ts';

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
