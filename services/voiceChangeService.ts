import { apiGetAudio, apiJson, apiPutBlob, DhvaniApiError } from './apiClient';
import { sendBankAgain } from './bankUpload';
import { originalParts, partEnd, partsOf, type SyncBank, type SyncBankLine, type SyncEdits } from './syncEditModel.ts';
import { appendManyToBank, takesOf, type SyncTake, type SyncTakes } from './syncTakes.ts';
import type { ChangedVoice } from './changedVoices.ts';

export * from './changedVoices.ts';
import type { SyncReport } from './syncService';
import type { ElevenLabsVoiceSettings } from './elevenLabsService';

/**
 * Voice change line by line (server/lib/voiceChange.js): each synced line put
 * through the voice changer on its own, fitted back to its old length, and
 * put in the bank as a take of that line. Every edit of a line names samples
 * inside it, so a line that keeps its length keeps its place, trims, splits
 * and fades exactly; the old voice stays in the line's takes.
 */

/** A line whose new take was off by more than this share is flagged (as the server's FLAG_SHARE). */
export const VOICE_CHANGE_FLAG_SHARE = 0.05;

/** Lines changed at once; ElevenLabs limits how many requests a plan runs together. */
const CONCURRENCY = 2;

/** The speaker clips of the original render as (see syncEditModel.ts). */
export const ORIGINAL_LANE = 'Original audio';

/** One stretch of a line on the timeline, for drawing the lanes. */
export interface LaneClip {
  key: string;
  speaker: string;
  start: number;
  end: number;
}

/** Each line of the dub where Edit timing has it now, and the clips of the original, for the voice changer's lanes. */
export const laneClips = (bank: SyncBank, edits: SyncEdits | null | undefined, sourceDuration: number): LaneClip[] => {
  const rate = bank.sampleRate;
  const lines = bank.lines.flatMap((line) => {
    const parts = partsOf(edits, line, rate).filter((part) => !part.muted);
    if (parts.length === 0) return [];
    return [{ key: line.key, speaker: line.speaker, start: Math.min(...parts.map((p) => p.start)), end: Math.max(...parts.map(partEnd)) }];
  });
  const originals = originalParts(edits, sourceDuration).map((part, n) => ({ key: `original-${n}`, speaker: ORIGINAL_LANE, start: part.start, end: partEnd(part) }));
  return [...lines, ...originals];
};

/** The speakers of the dub in the order they first speak, each with how many lines they have. */
export const speakersOf = (bank: SyncBank) => {
  const counts = new Map<string, number>();
  for (const line of bank.lines) counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
  return [...counts].map(([name, lines]) => ({ name, lines }));
};

/** The voice each speaker is changed into; a speaker left out keeps their voice. `settings` are that speaker's own, when they differ from the run's. */
export type SpeakerVoices = Record<string, { voiceId: string; name: string; settings?: VoiceChangeSettings }>;

/** The lines to change: every line of a speaker given a voice. */
export const linesToChange = (bank: SyncBank, voices: SpeakerVoices) => bank.lines.filter((line) => Boolean(voices[line.speaker]));

export interface VoiceChangeSettings {
  modelId: string;
  voiceSettings: ElevenLabsVoiceSettings;
  removeBackgroundNoise: boolean;
  seed?: number;
}

export type LineState = 'waiting' | 'changing' | 'done' | 'flag' | 'silent' | 'error';

export interface LineProgress {
  state: LineState;
  /** How much longer (positive) or shorter the voice changer gave the line back, as a share. */
  change?: number;
}

/** One line changed: its new take's samples (a WAV in the bank's format) and what the bank line needs to play them. */
export interface ChangedLine {
  key: string;
  wav: Blob;
  length: number;
  change: number;
  gain: number;
  hash: string;
  voice: string;
  voiceId: string;
}

type Changed = { silent?: boolean; audioId: string; length: number; change: number; gain: number; hash: string };

/** Some samples of the bank (a line, or a take of it) put through the voice changer and fitted back to their length; nothing in the bank changes. */
const changeRegion = (
  bankId: string,
  region: { bankStart: number; length: number; gain: number },
  voiceId: string,
  settings: VoiceChangeSettings,
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal }
) =>
  apiJson<Changed>('/sync/voice-change', {
    body: {
      bankId,
      line: { bankStart: region.bankStart, length: region.length, gain: region.gain },
      voiceId,
      modelId: settings.modelId,
      voiceSettings: settings.voiceSettings,
      removeBackgroundNoise: settings.removeBackgroundNoise,
      ...(settings.seed !== undefined && { seed: settings.seed }),
      // Each line stays at the level it had in the dub.
      matchLoudness: true,
    },
    keys: { elevenLabsKey: apiKey },
    signal,
  });

/**
 * Changes the voice of `lines`, a few at a time. A line the voice changer
 * gives back silent keeps its old take. The first failure stops the lines
 * not yet started; those already changed are kept, with the error.
 */
export const voiceChangeLines = async (
  {
    bank,
    bankBlob,
    lines,
    voices,
    settings,
  }: { bank: SyncBank; bankBlob: Blob; lines: SyncBankLine[]; voices: SpeakerVoices; settings: VoiceChangeSettings },
  { apiKey, signal, onLine }: { apiKey?: string; signal?: AbortSignal; onLine?: (key: string, progress: LineProgress) => void } = {}
): Promise<{ changed: ChangedLine[]; error: Error | null }> => {
  let resent: Promise<unknown> | null = null;
  const send = (line: SyncBankLine) =>
    changeRegion(bank.bankId, line, voices[line.speaker].voiceId, voices[line.speaker].settings ?? settings, { apiKey, signal });

  const changed = new Map<string, ChangedLine>();
  let error: Error | null = null;
  let next = 0;
  const worker = async () => {
    while (next < lines.length && !error && !signal?.aborted) {
      const line = lines[next++];
      onLine?.(line.key, { state: 'changing' });
      try {
        let data: Changed;
        try {
          data = await send(line);
        } catch (err) {
          // The server keeps a bank a few hours, and not across a restart: send it again, once for all lines.
          if (!(err instanceof DhvaniApiError) || err.code !== 'edit_bank_missing') throw err;
          resent ??= sendBankAgain(bank.bankId, bankBlob, { signal });
          await resent;
          data = await send(line);
        }
        if (data.silent) {
          onLine?.(line.key, { state: 'silent' });
          continue;
        }
        if (data.length !== line.length) throw new Error('A changed line came back at another length. Try again.');
        const wav = await apiGetAudio(`/sync/audio/${encodeURIComponent(data.audioId)}`, { signal });
        changed.set(line.key, {
          key: line.key,
          wav,
          length: data.length,
          change: data.change,
          gain: data.gain,
          hash: data.hash,
          voice: voices[line.speaker].name,
          voiceId: voices[line.speaker].voiceId,
        });
        onLine?.(line.key, { state: Math.abs(data.change) > VOICE_CHANGE_FLAG_SHARE ? 'flag' : 'done', change: data.change });
      } catch (err: any) {
        if (signal?.aborted) return;
        onLine?.(line.key, { state: 'error' });
        error ??= err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));
  // In the bank's order, so the bank grows the same way however the lines finished.
  return { changed: lines.map((line) => changed.get(line.key)).filter((c): c is ChangedLine => Boolean(c)), error };
};

const newBankId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `bank-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The bank with the changed lines in it: their samples after the bank's own,
 * each line pointed at its new take, same length, so every edit still fits.
 * Each new take joins the line's takes and plays; the old voice stays there
 * to go back to. The server gets the new bank under a new id.
 */
export const putChangedLines = async (
  { bank, bankBlob, takes, report, changed }: { bank: SyncBank; bankBlob: Blob; takes: SyncTakes | null | undefined; report: SyncReport; changed: ChangedLine[] },
  { signal }: { signal?: AbortSignal } = {}
): Promise<{ bank: SyncBank; bankBlob: Blob; takes: SyncTakes | null }> => {
  const bytes = bank.float ? 4 : 2;
  const baseLength = Math.round((bankBlob.size - 44) / bytes);
  const blob = await appendManyToBank(bankBlob, changed.map((c) => c.wav), { sampleRate: bank.sampleRate, float: bank.float, baseLength });
  const byKey = new Map(changed.map((c) => [c.key, c]));
  const nextTakes: SyncTakes = { ...(takes ?? {}) };
  let at = baseLength;
  const starts = new Map<string, number>();
  for (const c of changed) {
    starts.set(c.key, at);
    at += c.length;
  }
  const lines = bank.lines.map((line) => {
    const c = byKey.get(line.key);
    if (!c) return line;
    const bankStart = starts.get(line.key)!;
    const unit = report.units.find((u) => u.key === line.key);
    if (unit) {
      const kept = takesOf(takes, line, unit);
      const take: SyncTake = {
        id: `voice-${bankStart.toString(36)}`,
        kind: 'line',
        bankStart,
        length: c.length,
        lead: line.lead,
        speech: line.speech,
        gain: c.gain,
        hash: c.hash,
        cutOff: false,
        // The same length as the take it was changed from, so the pauses that take had cut fit it too.
        cuts: line.cuts,
        crossfade: line.crossfade,
        dropped: line.dropped,
        ...(line.maxStartShift !== undefined && { maxStartShift: line.maxStartShift }),
        voice: c.voice,
        voiceId: c.voiceId,
        text: kept.takes.find((t) => t.id === kept.active)?.text ?? unit.text,
      };
      nextTakes[line.key] = { takes: [...kept.takes, take], active: take.id };
    }
    return { ...line, bankStart, gain: c.gain, hash: c.hash };
  });
  const bankId = newBankId();
  await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bankId)}`, blob, { signal });
  return { bank: { ...bank, bankId, lines }, bankBlob: blob, takes: Object.keys(nextTakes).length > 0 ? nextTakes : null };
};

/**
 * Takes of a line put through the voice changer into `voice`, each fitted to
 * its own length, so it plays exactly as the take it was changed from. They
 * come back as new takes after the bank's samples (a new bank, sent to the
 * server under a new id); a take the voice changer gives back silent comes
 * back as it was. The first failure stops them all.
 */
export const voiceChangeTakes = async (
  { bank, bankBlob, takes, voice }: { bank: SyncBank; bankBlob: Blob; takes: SyncTake[]; voice: Pick<ChangedVoice, 'voiceId' | 'name' | 'settings'> },
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<{ bank: SyncBank; bankBlob: Blob; takes: SyncTake[] }> => {
  let resent = false;
  const send = async (take: SyncTake) => {
    try {
      return await changeRegion(bank.bankId, take, voice.voiceId, voice.settings, { apiKey, signal });
    } catch (err) {
      // The server keeps a bank a few hours, and not across a restart: send it again, once.
      if (resent || !(err instanceof DhvaniApiError) || err.code !== 'edit_bank_missing') throw err;
      resent = true;
      await sendBankAgain(bank.bankId, bankBlob, { signal });
      return changeRegion(bank.bankId, take, voice.voiceId, voice.settings, { apiKey, signal });
    }
  };
  const changed: { take: SyncTake; wav: Blob; data: Changed }[] = [];
  for (const take of takes) {
    const data = await send(take);
    if (data.silent) continue;
    if (data.length !== take.length) throw new Error('A changed take came back at another length. Try again.');
    changed.push({ take, wav: await apiGetAudio(`/sync/audio/${encodeURIComponent(data.audioId)}`, { signal }), data });
  }
  if (changed.length === 0) return { bank, bankBlob, takes };
  const bytes = bank.float ? 4 : 2;
  const baseLength = Math.round((bankBlob.size - 44) / bytes);
  const blob = await appendManyToBank(bankBlob, changed.map((c) => c.wav), { sampleRate: bank.sampleRate, float: bank.float, baseLength });
  let at = baseLength;
  const byTake = new Map<SyncTake, SyncTake>();
  for (const { take, data } of changed) {
    const bankStart = at;
    at += data.length;
    byTake.set(take, { ...take, id: `voice-${bankStart.toString(36)}`, bankStart, gain: data.gain, hash: data.hash, voice: voice.name, voiceId: voice.voiceId });
  }
  const bankId = newBankId();
  await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bankId)}`, blob, { signal });
  return { bank: { ...bank, bankId }, bankBlob: blob, takes: takes.map((take) => byTake.get(take) ?? take) };
};
