import { basePart, keptCopies, measureEdits, moveCopyAudio, partsOf, partTime, spokenSpan, syncedParts, type SyncBank, type SyncBankLine, type SyncEditPart, type SyncEdits } from './syncEditModel.ts';
import type { SyncReport, SyncUnitReport } from './syncService';

/**
 * Takes: new readings of one synced line, voiced on demand (POST
 * /api/sync/takes, see server/lib/syncTakes.js), heard side by side and
 * picked from. Every take of a line is kept, the one Sync voiced among them,
 * so the user can go back to any of them.
 *
 * A take lives in the dub's bank, after the lines Sync placed: asking for
 * takes adds them to the end of the bank (a new bank id, the old samples
 * unchanged), and picking one points the line at its samples. The dub is then
 * rendered as Edit timing renders it, so a picked take is heard within
 * seconds, not after another Sync. The next Sync keeps each picked take as it
 * is (pickedTakes below), and every take of every line comes along to the
 * new bank (carryTakes below), so the T window lists them all again.
 */

/** How a take is read, besides as Sync read the line. Words never change, only the reading. */
export type TakeDirection = 'same' | 'faster' | 'slower' | 'calmer' | 'energy';

export const TAKE_DIRECTIONS: { id: TakeDirection; label: string; hint: string }[] = [
  { id: 'same', label: 'Same', hint: 'Read as the line was: a new take with the same voice settings' },
  { id: 'faster', label: 'A bit faster', hint: "The voice's own speed, about 8% faster; the audio is never sped up afterwards" },
  { id: 'slower', label: 'A bit slower', hint: "The voice's own speed, about 8% slower; the audio is never slowed afterwards" },
  { id: 'calmer', label: 'Calmer', hint: 'Steadier and less stylised (a calm emotion on Cartesia)' },
  { id: 'energy', label: 'More energy', hint: 'Livelier and more stylised (a confident emotion on Cartesia)' },
];

/** Takes voiced each time the user asks, unless Retake pro picks more; each costs a voicing of the line (or of the words picked). */
export const TAKES_PER_ASK = 1;

/** How many takes Retake pro may ask for at once (the server takes up to 5). */
export const TAKE_COUNTS = [1, 2, 3, 5] as const;

/** Eleven v3's stability, as its own settings name it, for a retake in Retake pro. */
export const TAKE_STABILITIES = [
  { value: 0, label: 'Creative', hint: 'Most expressive and follows tags most, but can wander' },
  { value: 0.5, label: 'Natural', hint: 'Balanced, closest to the original voice' },
  { value: 1, label: 'Robust', hint: 'Very steady, but follows tags less' },
] as const;

/**
 * What the retake window asks for: a direction, and only some words
 * (`phrase`, with `say` when other words are typed in their place) or the
 * whole line in other words (`text`); both may carry pause marks and typed
 * tags. Retake pro may also set how many takes and the stability.
 */
export interface TakeAsk {
  direction: TakeDirection;
  phrase?: { from: number; to: number; say?: string };
  text?: string;
  count?: number;
  stability?: number;
}

/** One take of a line: where its samples are in the bank, and what a line needs to play them. */
export interface SyncTake {
  id: string;
  /** Sync's own take, a whole line voiced again, or some words of it voiced again. */
  kind: 'sync' | 'line' | 'phrase';
  bankStart: number;
  length: number;
  lead: number;
  speech: number;
  gain: number;
  hash: string;
  cutOff: boolean;
  /** As the bank line had them: only Sync's own take has pause cuts or samples dropped before 0:00. */
  cuts: { start: number; end: number; blend?: number }[];
  crossfade: number;
  dropped: number;
  maxStartShift?: number;
  /** Sync's own take with Chunk sync: the chunks it was placed as. Only it has them; they are cut from its samples. */
  chunks?: SyncBankLine['chunks'];
  seed?: number;
  direction?: TakeDirection;
  /** The words voiced again, for a phrase take. */
  phrase?: string;
  /** The voice a voice-changed take was changed into (the voice changer, line by line). */
  voice?: string;
  /** Its id: what tells a take already in a speaker's changed voice from one to change. */
  voiceId?: string;
  /** What the line said when the take was voiced. */
  text: string;
  /** What the voice read, when that was new words, pause marks ([pause 0.4s]) or typed tags ([sighs]): `text` is the words without them. */
  spoken?: string;
  /**
   * Its words' `[start, end]`, seconds into its samples: from the voice's own
   * timing when it was voiced, from Sync's alignment for Sync's take, or from
   * forced alignment once. Kept so cutting it between words never pays again.
   */
  words?: [number, number][];
  /** Where it may be cut between word w and the next (seconds), found in its sound; absent when only `words` are known. */
  gaps?: number[];
}

/** A line's takes, oldest first, and the one it plays. */
export interface LineTakes {
  takes: SyncTake[];
  active: string;
}

export type SyncTakes = Record<string, LineTakes>;

export const SYNC_TAKE_ID = 'sync';

const round4 = (seconds: number) => Math.round(seconds * 10000) / 10000;

/** A word the voice says: letters or digits in it, not lone punctuation. */
const spokenToken = (token: string) => /[\p{L}\p{N}]/u.test(token);

/** The words a line's text says, as takes count them. */
export const sayWords = (text: string) => text.split(/\s+/).filter(spokenToken);

/**
 * Sync's take's words, from its own forced alignment (the report's
 * `readWords`, seconds into the take before samples were dropped before
 * 0:00): seconds into the bank line's samples. Undefined without them.
 */
export const syncTakeWords = (line: Pick<SyncBankLine, 'dropped' | 'length'>, readWords: SyncUnitReport['readWords'], sampleRate: number): [number, number][] | undefined => {
  if (!readWords?.length) return undefined;
  const shift = (line.dropped || 0) / sampleRate;
  const end = line.length / sampleRate;
  const words = readWords
    .filter(([text, start, stop]) => spokenToken(String(text)) && Number.isFinite(start) && Number.isFinite(stop))
    .map(([, start, stop]): [number, number] => [round4(Math.min(end, Math.max(0, start - shift))), round4(Math.min(end, Math.max(0, stop - shift)))]);
  return words.length > 0 ? words : undefined;
};

/** The take Sync placed, as the bank line has it. */
export const syncTakeOf = (line: SyncBankLine, text: string, words?: [number, number][]): SyncTake => ({
  id: SYNC_TAKE_ID,
  kind: 'sync',
  bankStart: line.bankStart,
  length: line.length,
  lead: line.lead,
  speech: line.speech,
  gain: line.gain,
  hash: line.hash,
  cutOff: false,
  cuts: line.cuts,
  crossfade: line.crossfade,
  dropped: line.dropped,
  ...(line.maxStartShift !== undefined && { maxStartShift: line.maxStartShift }),
  ...(line.chunks?.length && { chunks: line.chunks }),
  ...(words?.length && { words }),
  text,
});

/** A line's takes: those kept, or only Sync's own before any was asked for. */
export const takesOf = (takes: SyncTakes | null | undefined, line: SyncBankLine, unit: SyncUnitReport, sampleRate?: number): LineTakes =>
  takes?.[line.key] ?? {
    takes: [{ ...syncTakeOf(line, unit.text, sampleRate ? syncTakeWords(line, unit.readWords, sampleRate) : undefined), cutOff: Boolean(unit.cutOff) }],
    active: SYNC_TAKE_ID,
  };

/**
 * A take's words, `{ start, end }` seconds into its samples, when they are
 * known: kept with it, or for Sync's own take an older project never kept,
 * Sync's alignment in the report. Null when they have to be aligned.
 */
export const knownWords = (take: SyncTake, unit: SyncUnitReport | undefined, sampleRate: number): SpokenWord[] | null => {
  const pairs = take.words?.length ? take.words : take.id === SYNC_TAKE_ID && unit ? syncTakeWords(take, unit.readWords, sampleRate) : undefined;
  return pairs?.length ? pairs.map(([start, end]) => ({ start, end })) : null;
};

/** The words of a line, as the takes panel picks them. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** A line's words split around the ones picked (`from` to `to`, inclusive). */
export const phraseOf = (text: string, from: number, to: number) => {
  const words = wordsOf(text);
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(words.length - 1, Math.max(from, to));
  return { before: words.slice(0, a).join(' '), words: words.slice(a, b + 1).join(' '), after: words.slice(b + 1).join(' ') };
};

/** The line with `say` in place of the words picked (`from` to `to`): what a phrase take in other words says. */
export const phraseLine = (text: string, from: number, to: number, say: string) => {
  const { before, after } = phraseOf(text, from, to);
  return [before, say.trim(), after].filter(Boolean).join(' ');
};

/* ---------- The bank's WAV ---------- */

const HEADER_BYTES = 44;

const wavHeader = (dataBytes: number, sampleRate: number, float: boolean) => {
  const view = new DataView(new ArrayBuffer(HEADER_BYTES));
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  const bytes = float ? 4 : 2;
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytes, true);
  view.setUint16(32, bytes, true);
  view.setUint16(34, bytes * 8, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return view.buffer;
};

/** Checks a WAV is the plain 44-byte mono header the server writes, in the format expected; returns its sample count. */
const samplesIn = async (wav: Blob, float: boolean) => {
  const head = new DataView(await wav.slice(0, HEADER_BYTES).arrayBuffer());
  const tag = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => head.getUint8(at + i)));
  const bytes = float ? 4 : 2;
  if (head.byteLength < HEADER_BYTES || tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(36) !== 'data' || head.getUint16(20, true) !== (float ? 3 : 1)) {
    throw new Error('The saved lines of this dub are not in the form takes need. Sync again to retake its lines.');
  }
  return (wav.size - HEADER_BYTES) / bytes;
};

/** The bank with the takes' samples after its own: the old bytes copied as they are, one header for both. */
export const appendToBank = async (bankBlob: Blob, takesWav: Blob, { sampleRate, float, baseLength }: { sampleRate: number; float: boolean; baseLength: number }) => {
  const had = await samplesIn(bankBlob, float);
  const added = await samplesIn(takesWav, float);
  if (had !== baseLength) {
    throw new Error("The saved lines of this dub don't match the server's copy. Sync again to retake its lines.");
  }
  const bytes = float ? 4 : 2;
  return new Blob([wavHeader((had + added) * bytes, sampleRate, float), bankBlob.slice(HEADER_BYTES), takesWav.slice(HEADER_BYTES)], { type: 'audio/wav' });
};

/** The bank with several WAVs' samples after its own, in order: the old bytes copied as they are, one header for all. */
export const appendManyToBank = async (bankBlob: Blob, wavs: Blob[], { sampleRate, float, baseLength }: { sampleRate: number; float: boolean; baseLength: number }) => {
  const had = await samplesIn(bankBlob, float);
  if (had !== baseLength) {
    throw new Error("The saved lines of this dub don't match. Sync again to change its voice line by line.");
  }
  let added = 0;
  for (const wav of wavs) added += await samplesIn(wav, float);
  const bytes = float ? 4 : 2;
  return new Blob([wavHeader((had + added) * bytes, sampleRate, float), bankBlob.slice(HEADER_BYTES), ...wavs.map((wav) => wav.slice(HEADER_BYTES))], {
    type: 'audio/wav',
  });
};

/**
 * The bank with only the samples the dub plays: each line's take now, and
 * each line's playing take, copied as they are into a new bank under
 * `bankId`; every other take is let go. Lines and takes point at their
 * samples' new place. For a smaller project file (Light export).
 */
export const compactBank = async (
  bank: SyncBank,
  bankBlob: Blob,
  takes: SyncTakes | null | undefined,
  bankId: string,
  /** The edits, for the samples copies play of their own: kept too, and the edits pointed at their new place. */
  edits?: SyncEdits | null
): Promise<{ bank: SyncBank; bankBlob: Blob; takes: SyncTakes | null; edits: SyncEdits | null }> => {
  await samplesIn(bankBlob, bank.float);
  const kept: SyncTakes = {};
  for (const [key, line] of Object.entries(takes || {})) {
    const playing = line.takes.find((t) => t.id === line.active);
    if (playing) kept[key] = { takes: [playing], active: playing.id };
  }
  const spans = [
    ...bank.lines.filter((l) => !l.original),
    ...Object.values(kept).flatMap((line) => line.takes),
    ...Object.values(edits ?? {}).flatMap((edit) => (Array.isArray(edit?.parts) ? edit.parts : []).flatMap((part) => (part.audio ? [part.audio] : []))),
  ]
    .filter((s) => s.length > 0)
    .map((s) => ({ start: s.bankStart, end: s.bankStart + s.length }))
    .sort((a, b) => a.start - b.start);
  // Overlapping spans (a line and its playing take are the same samples) are copied once.
  const merged: { start: number; end: number; to: number }[] = [];
  let at = 0;
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) {
        at += span.end - last.end;
        last.end = span.end;
      }
    } else {
      merged.push({ ...span, to: at });
      at += span.end - span.start;
    }
  }
  const moved = (bankStart: number) => {
    const span = merged.find((m) => bankStart >= m.start && bankStart < m.end);
    return span ? span.to + bankStart - span.start : bankStart;
  };
  const bytes = bank.float ? 4 : 2;
  const blob = new Blob(
    [wavHeader(at * bytes, bank.sampleRate, bank.float), ...merged.map((m) => bankBlob.slice(HEADER_BYTES + m.start * bytes, HEADER_BYTES + m.end * bytes))],
    { type: 'audio/wav' }
  );
  for (const line of Object.values(kept)) line.takes = line.takes.map((t) => ({ ...t, bankStart: moved(t.bankStart) }));
  return {
    bank: { ...bank, bankId, lines: bank.lines.map((l) => (l.original ? l : { ...l, bankStart: moved(l.bankStart) })) },
    bankBlob: blob,
    takes: Object.keys(kept).length ? kept : null,
    edits: moveCopyAudio(edits, moved),
  };
};

/**
 * After a Sync: the samples copies play of their own (locked lines keep their
 * copies) copied from the last bank to the end of the new one, as they are,
 * and the edits pointed at them there, the bank under `bankId` when it grew.
 * Copies whose samples can't come (banks in another format) go.
 */
export const carryCopyAudio = async ({
  edits,
  priorBank,
  priorBankBlob,
  bank,
  bankBlob,
  bankId,
}: {
  edits: SyncEdits | null | undefined;
  priorBank: SyncBank | null | undefined;
  priorBankBlob: Blob | null | undefined;
  bank: SyncBank;
  bankBlob: Blob;
  bankId: string;
}): Promise<{ edits: SyncEdits | null; bank: SyncBank; bankBlob: Blob }> => {
  const spans = new Map<number, number>();
  for (const edit of Object.values(edits ?? {})) {
    for (const part of Array.isArray(edit?.parts) ? edit.parts : []) if (part.audio) spans.set(part.audio.bankStart, Math.max(spans.get(part.audio.bankStart) ?? 0, part.audio.length));
  }
  if (spans.size === 0) return { edits: edits ?? null, bank, bankBlob };
  const joinable = Boolean(priorBank && priorBankBlob && priorBank.sampleRate === bank.sampleRate && priorBank.float === bank.float);
  if (!joinable) return { edits: moveCopyAudio(edits, () => null), bank, bankBlob };
  const priorLength = await samplesIn(priorBankBlob!, priorBank!.float);
  let at = await samplesIn(bankBlob, bank.float);
  const copies: { from: number; length: number }[] = [];
  const moved = new Map<number, number>();
  for (const [from, length] of spans) {
    if (from < 0 || length <= 0 || from + length > priorLength) continue;
    moved.set(from, at);
    copies.push({ from, length });
    at += length;
  }
  const next = moveCopyAudio(edits, (bankStart) => moved.get(bankStart) ?? null);
  if (copies.length === 0) return { edits: next, bank, bankBlob };
  const bytes = bank.float ? 4 : 2;
  const blob = new Blob(
    [
      wavHeader(at * bytes, bank.sampleRate, bank.float),
      bankBlob.slice(HEADER_BYTES),
      ...copies.map((c) => priorBankBlob!.slice(HEADER_BYTES + c.from * bytes, HEADER_BYTES + (c.from + c.length) * bytes)),
    ],
    { type: 'audio/wav' }
  );
  return { edits: next, bank: { ...bank, bankId }, bankBlob: blob };
};

/** A take's id at its new place in the bank: ids end in the take's bankStart, so they stay unique there. */
const idAt = (id: string, bankStart: number) => `${id.includes('-') ? id.slice(0, id.lastIndexOf('-')) : id}-${bankStart.toString(36)}`;

/**
 * After a Sync: every line's takes, kept. The new bank has only the lines
 * Sync placed, so each take still in the line's words is copied from the
 * last bank (`priorBank`) to the end of the new one, as it is, and joins the
 * line's takes there; the new bank then goes under `bankId`. A line playing a
 * take picked in the T window (the report says `picked`) keeps it as its
 * take, now the line's own samples; a line Sync voiced again plays Sync's new
 * take, and its old ones stay to go back to (the old Sync take only when it
 * sounds different from the new one). Takes in other words than the line has
 * now are let go. Null when the banks can't be joined (another format) or
 * nothing was kept, for the caller's own fallback.
 */
export const carryTakes = async ({
  priorBank,
  priorBankBlob,
  priorTakes,
  bank,
  bankBlob,
  report,
  bankId,
}: {
  priorBank: SyncBank | null | undefined;
  priorBankBlob: Blob | null | undefined;
  priorTakes: SyncTakes | null | undefined;
  bank: SyncBank;
  bankBlob: Blob;
  report: SyncReport;
  bankId: string;
}): Promise<{ bank: SyncBank; bankBlob: Blob; takes: SyncTakes | null } | null> => {
  if (!priorBank || !priorBankBlob || !priorTakes || priorBank.sampleRate !== bank.sampleRate || priorBank.float !== bank.float) return null;
  const priorLength = await samplesIn(priorBankBlob, priorBank.float);
  const baseLength = await samplesIn(bankBlob, bank.float);
  const units = new Map(report.units.map((unit) => [unit.key, unit]));
  const copies: { from: number; length: number }[] = [];
  let at = baseLength;
  const out: SyncTakes = {};
  for (const line of bank.lines) {
    if (line.original) continue;
    const prior = priorTakes[line.key];
    const unit = units.get(line.key);
    if (!prior || !unit) continue;
    const active = prior.takes.find((take) => take.id === prior.active);
    const pickedNow = Boolean(unit.picked && active && active.kind !== 'sync');
    // What the line plays now: the picked take, at the line's samples, or Sync's new take.
    const playing: SyncTake = pickedNow && active
      ? {
          ...syncTakeOf(line, unit.text),
          ...(active.seed !== undefined && { seed: active.seed }),
          ...(active.direction && { direction: active.direction }),
          ...(active.phrase && { phrase: active.phrase }),
          ...(active.voice && { voice: active.voice }),
          ...(active.voiceId && { voiceId: active.voiceId }),
          ...(active.spoken && { spoken: active.spoken }),
          id: idAt(active.id, line.bankStart),
          kind: active.kind,
        }
      : { ...syncTakeOf(line, unit.text), cutOff: Boolean(unit.cutOff) };
    const takes: SyncTake[] = pickedNow ? [] : [playing];
    for (const take of prior.takes) {
      if (pickedNow && take === active) {
        takes.push(playing);
        continue;
      }
      if (take.text !== unit.text || !(take.length > 0) || take.bankStart < 0 || take.bankStart + take.length > priorLength) continue;
      // Sync voiced the line again just as it was: its old take is the one playing.
      if (!pickedNow && take.hash === line.hash) continue;
      const bankStart = at;
      copies.push({ from: take.bankStart, length: take.length });
      at += take.length;
      if (take.kind === 'sync' && !pickedNow) {
        // The last Sync's take beside this Sync's own: a take like any other, played whole.
        const { chunks: _chunks, maxStartShift: _shift, ...rest } = take;
        takes.push({ ...rest, id: `was-sync-${bankStart.toString(36)}`, kind: 'line', bankStart });
      } else {
        takes.push({ ...take, id: take.id === SYNC_TAKE_ID ? SYNC_TAKE_ID : idAt(take.id, bankStart), bankStart });
      }
    }
    // Only Sync's own take: nothing to keep that the line doesn't have anyway.
    if (pickedNow || takes.length > 1) out[line.key] = { takes, active: playing.id };
  }
  const takes = Object.keys(out).length > 0 ? out : null;
  if (copies.length === 0) return takes ? { bank, bankBlob, takes } : null;
  const bytes = bank.float ? 4 : 2;
  const blob = new Blob(
    [
      wavHeader(at * bytes, bank.sampleRate, bank.float),
      bankBlob.slice(HEADER_BYTES),
      ...copies.map((c) => priorBankBlob.slice(HEADER_BYTES + c.from * bytes, HEADER_BYTES + (c.from + c.length) * bytes)),
    ],
    { type: 'audio/wav' }
  );
  return { bank: { ...bank, bankId }, bankBlob: blob, takes };
};

/** One take on its own, as a WAV, for listening to it: its samples copied out of the bank. */
export const takeWav = (bankBlob: Blob, take: Pick<SyncTake, 'bankStart' | 'length'>, { sampleRate, float }: { sampleRate: number; float: boolean }) => {
  const bytes = float ? 4 : 2;
  const from = HEADER_BYTES + take.bankStart * bytes;
  return new Blob([wavHeader(take.length * bytes, sampleRate, float), bankBlob.slice(from, from + take.length * bytes)], { type: 'audio/wav' });
};

/* ---------- How a take fits ---------- */

/** A line whose speech covers less than this share of the original's, leaving at least MIN_SHORT_GAP unsaid, ends early (as server/lib/syncDub.js). */
const SHORT_SHARE = 0.6;
const MIN_SHORT_GAP = 1;
const isShort = (speech: number, spoken: number) => speech < spoken * SHORT_SHARE && spoken - speech >= MIN_SHORT_GAP;

export type TakeTone = 'fits' | 'over' | 'short' | 'cut';

export interface TakeFit {
  tone: TakeTone;
  label: string;
  /** Lower is better, as Sync picks among retakes: one that finishes its words, then one that runs least over, then one closest to the original. */
  score: number;
  /** Seconds past the next line's start, placed where the line's first word is now. */
  over: number;
}

/** Where a line's first word is on the timeline now, with its edits. */
export const firstWordAt = (line: SyncBankLine, edits: SyncEdits | null | undefined, sampleRate: number) =>
  spokenSpan(line, partsOf(edits, line, sampleRate))?.start ?? line.startSample / sampleRate + line.lead;

/** How a take would sit, with its first word where the line's is now. */
export const takeFit = (take: SyncTake, unit: SyncUnitReport, firstWord: number, nextStart: number | null, tolerance: number): TakeFit => {
  const spoken = Math.max(0, unit.srcEnd - unit.srcStart);
  const over = nextStart === null ? 0 : firstWord + take.speech - nextStart;
  const score = (take.cutOff ? 1000 : 0) + Math.max(0, over) * 10 + Math.abs(take.speech - spoken);
  if (take.cutOff) return { tone: 'cut', label: 'Last word cut off', score, over };
  if (over > tolerance) return { tone: 'over', label: `Runs ${over.toFixed(1)} s over`, score, over };
  if (isShort(take.speech, spoken)) return { tone: 'short', label: 'Ends early', score, over };
  return { tone: 'fits', label: 'Fits', score, over };
};

/* ---------- Picking a take ---------- */

/**
 * The dub with `take` playing for line `key`: the bank line points at the
 * take's samples, placed so its first word lands where the line's does now.
 * Hand edits of the old take don't fit the new one; its gain and lock carry
 * over. The report as Sync made it is measured again for the line.
 */
export const putTake = ({
  bank,
  edits,
  baseReport,
  key,
  take,
}: {
  bank: SyncBank;
  edits: SyncEdits | null | undefined;
  baseReport: SyncReport;
  key: string;
  take: SyncTake;
}): { bank: SyncBank; edits: SyncEdits | null; baseReport: SyncReport } => {
  const rate = bank.sampleRate;
  const index = bank.lines.findIndex((line) => line.key === key);
  if (index === -1) return { bank, edits: edits ?? null, baseReport };
  const old = bank.lines[index];
  const firstWord = firstWordAt(old, edits, rate);
  const startSample = Math.max(0, Math.round((firstWord - take.lead) * rate));
  // The old take's chunks are cut from its samples, not this take's: the take plays whole, at its own length.
  const { maxStartShift: _shift, chunks: _chunks, ...rest } = old;
  const line: SyncBankLine = {
    ...rest,
    bankStart: take.bankStart,
    length: take.length,
    startSample,
    lead: take.lead,
    speech: take.speech,
    gain: take.gain,
    hash: take.hash,
    cuts: take.cuts,
    crossfade: take.crossfade,
    dropped: take.dropped,
    locked: false,
    // Sync's own take keeps the edge limit Sync gave it, where it still starts where Sync put it.
    ...(take.maxStartShift !== undefined && startSample === old.startSample && { maxStartShift: take.maxStartShift }),
  };
  // Sync's own take gets its chunks back, moved together so its first word lands where the line's is now.
  if (take.chunks?.length) {
    const placed = spokenSpan(line, syncedParts({ ...line, chunks: take.chunks }, rate))?.start;
    const shift = placed === undefined ? 0 : Math.round((firstWord - placed) * rate);
    line.chunks = take.chunks.map((chunk) => ({ ...chunk, startSample: Math.max(0, chunk.startSample + shift) }));
  }
  const lines = bank.lines.map((l, n) => (n === index ? line : l));
  const nextBank = { ...bank, lines };

  const nextEdits: SyncEdits = { ...(edits ?? {}) };
  const before = edits?.[key];
  delete nextEdits[key];
  const gainDb = before?.parts.find((part) => !part.copy)?.gainDb ?? 0;
  // Alt + drag copies are not the line: each keeps playing what it played.
  const copies = keptCopies(before?.parts, old);
  if (before && (before.locked || gainDb !== 0 || copies.length > 0)) {
    nextEdits[key] = { locked: before.locked, parts: [{ ...basePart(line, rate), gainDb }, ...copies] };
  }
  const cleanEdits = Object.keys(nextEdits).length > 0 ? nextEdits : null;
  return { bank: nextBank, edits: cleanEdits, baseReport: measureTake(baseReport, nextBank, key, take) };
};

/** The report as Sync made it, measured again for line `key` now playing `take` as it sits in `bank`. */
const measureTake = (baseReport: SyncReport, bank: SyncBank, key: string, take: SyncTake): SyncReport => {
  const n = baseReport.units.findIndex((unit) => unit.key === key);
  const measured = measureEdits(baseReport, bank, null, [key]);
  const unit = measured.units[n];
  const spoken = Math.max(0, unit.srcEnd - unit.srcStart);
  const short = !unit.silent && (unit.overrun ?? 0) <= baseReport.tolerance && isShort(take.speech, spoken);
  const exceeded = !unit.silent && (unit.overrun ?? 0) > baseReport.tolerance;
  const units = measured.units.map((u, i) =>
    i === n
      ? {
          ...u,
          speech: take.speech,
          cutOff: take.cutOff,
          exceeded,
          exceededBy: exceeded ? unit.overrun ?? 0 : 0,
          short,
          shortBy: short ? spoken - take.speech : 0,
          // A suggestion was for the take it was made for, and only while the line still needs one.
          suggestion: exceeded || short ? u.suggestion : null,
          suggestionOver: exceeded || short ? u.suggestionOver ?? null : null,
          pauseTrimmed: 0,
          retakes: 0,
          fromDub: false,
          picked: take.kind !== 'sync',
        }
      : u
  );
  return {
    ...measured,
    units,
    summary: {
      ...measured.summary,
      exceeded: units.filter((u) => u.exceeded).length,
      short: units.filter((u) => u.short).length,
      cutOff: units.filter((u) => u.cutOff).length,
    },
  };
};

/** Where a used take is cut and placed as Chunk sync places a line (POST /api/sync/takes/place, server/lib/placeTake.js). */
export interface TakeChunk {
  /** Samples into the take. */
  from: number;
  to: number;
  /** Where it plays on the timeline, in samples. */
  startSample: number;
}

/**
 * The dub with line `key`'s take cut into `chunks` and each played where it
 * was placed, as Sync leaves a line it split: Edit timing shows them as the
 * line's parts. A gain the user gave the line stays on every part. Null when
 * the line no longer plays `take` as it went in, or is locked: then nothing
 * moves.
 */
export const placeTakeChunks = ({
  bank,
  edits,
  baseReport,
  key,
  take,
  chunks,
}: {
  bank: SyncBank;
  edits: SyncEdits | null | undefined;
  baseReport: SyncReport;
  key: string;
  take: SyncTake;
  chunks: TakeChunk[];
}): { bank: SyncBank; edits: SyncEdits | null; baseReport: SyncReport } | null => {
  const rate = bank.sampleRate;
  const index = bank.lines.findIndex((line) => line.key === key);
  const old = bank.lines[index];
  const before = edits?.[key];
  if (!old || old.bankStart !== take.bankStart || old.length !== take.length || before?.locked) return null;
  // Only a take still as it went in: one part, the whole take, nothing changed but its gain. Copies are not the line.
  const own = before?.parts.filter((part) => !part.copy) ?? [];
  const copies = keptCopies(before?.parts, old);
  if (before && (own.length !== 1 || own[0].from !== 0 || Math.abs(own[0].to - old.length / rate) > 1e-6 || own[0].rate !== 1)) return null;
  const valid = chunks.filter((c) => Number.isInteger(c.from) && Number.isInteger(c.to) && Number.isInteger(c.startSample) && c.from >= 0 && c.to <= old.length && c.to > c.from && c.startSample >= 0);
  if (valid.length === 0 || valid.length !== chunks.length) return null;
  const { maxStartShift: _shift, ...rest } = old;
  const line: SyncBankLine = { ...rest, startSample: Math.max(0, valid[0].startSample - valid[0].from), chunks: valid };
  const nextBank = { ...bank, lines: bank.lines.map((l, n) => (n === index ? line : l)) };
  const nextEdits: SyncEdits = { ...(edits ?? {}) };
  delete nextEdits[key];
  const gainDb = own[0]?.gainDb ?? 0;
  if (gainDb !== 0 || copies.length > 0) nextEdits[key] = { locked: false, parts: [...syncedParts(line, rate).map((part) => ({ ...part, gainDb })), ...copies] };
  return {
    bank: nextBank,
    edits: Object.keys(nextEdits).length > 0 ? nextEdits : null,
    baseReport: measureTake(baseReport, nextBank, key, take),
  };
};

/**
 * The takes picked for a Sync to keep: each line playing a take the user
 * picked (not Sync's own), whose words haven't changed since. Undefined when
 * there are none.
 */
export const pickedTakes = (bank: SyncBank | null | undefined, takes: SyncTakes | null | undefined, pendingKeys: string[] = []) => {
  if (!bank || !takes) return undefined;
  const lines: Record<string, { bankStart: number; length: number; lead: number; speech: number; cutOff: boolean }> = {};
  for (const line of bank.lines) {
    const kept = takes[line.key];
    const take = kept?.takes.find((t) => t.id === kept.active);
    if (!take || take.kind === 'sync' || pendingKeys.includes(line.key)) continue;
    lines[line.key] = { bankStart: take.bankStart, length: take.length, lead: take.lead, speech: take.speech, cutOff: take.cutOff };
  }
  return Object.keys(lines).length > 0 ? { bankId: bank.bankId, lines } : undefined;
};

/* ---------- A take on one Alt + drag copy ---------- */

/**
 * An Alt + drag copy playing `take` instead, on its own: the line and its
 * other parts keep theirs. With both takes' words known (`oldWords` for what
 * the copy plays now), the copy is cut at the same words of the new take, its
 * first word where it was (fitTakeToParts); without, the whole take plays, its
 * first word at `firstWord`. Its gain, fades and mute stay; it plays at the
 * speed it was voiced.
 */
export const takeOnCopy = ({
  key,
  copy,
  take,
  sampleRate,
  firstWord,
  oldWords,
  newWords,
}: {
  key: string;
  copy: SyncEditPart;
  take: SyncTake;
  sampleRate: number;
  firstWord: number;
  oldWords?: SpokenWord[] | null;
  newWords?: SpokenWord[] | null;
}): SyncEditPart => {
  const audio = { bankStart: take.bankStart, length: take.length, lead: take.lead, speech: take.speech, gain: take.gain };
  const seconds = take.length / sampleRate;
  if (oldWords?.length && newWords?.length) {
    const fit = fitTakeToParts({ key, oldParts: [{ ...copy, copy: false }], oldWords, newWords, takeSeconds: seconds, cuts: take.gaps });
    if (fit?.parts.length === 1) return { ...fit.parts[0], id: copy.id, copy: true, audio };
  }
  const half = seconds / 2;
  return {
    ...copy,
    start: Math.max(0, firstWord - take.lead),
    from: 0,
    to: seconds,
    rate: 1,
    fadeIn: Math.min(copy.fadeIn, half),
    fadeOut: Math.min(copy.fadeOut, half),
    copy: true,
    audio,
  };
};

/* ---------- A used take where the old take's parts were ---------- */

/** The least room left between two parts of a line, or a part and the line next to it. */
export const PART_GAP_SECONDS = 0.05;

/** A word in a take, seconds into its samples (forced alignment). */
export interface SpokenWord {
  start: number;
  end: number;
}

/**
 * A take used in place of one the user had cut and placed by hand: cut at
 * the same words as the old take's parts, never inside a word, and each part
 * placed so its first word plays where the old part's first word did, under
 * the original. Each part keeps the old one's gain, fades and mute; it plays
 * at the speed it was voiced.
 *
 * `oldParts` are the old take's parts (copies left out), `oldWords` and
 * `newWords` the two takes' words in the same order (the same words, so the
 * same count), `takeSeconds` the new take's length, `prevEnd` and
 * `nextStart` where the lines either side end and start (null when there is
 * none). A part that would run into the next is moved earlier into the room
 * before it; one that still doesn't fit is left as it is, to be fixed by hand
 * (`over` says by how much). Null when the words don't pair up.
 */
export const fitTakeToParts = ({
  key,
  oldParts,
  oldWords,
  newWords,
  takeSeconds,
  prevEnd = null,
  nextStart = null,
  cuts,
}: {
  key: string;
  oldParts: SyncEditPart[];
  oldWords: SpokenWord[];
  newWords: SpokenWord[];
  takeSeconds: number;
  prevEnd?: number | null;
  nextStart?: number | null;
  /** Where the new take may be cut after each word but its last, in its silence (SyncTake.gaps); halfway through each pause when not given. */
  cuts?: number[];
}): { parts: SyncEditPart[]; moved: number[]; over: number[] } | null => {
  if (oldWords.length === 0 || oldWords.length !== newWords.length || !(takeSeconds > 0)) return null;
  const last = newWords.length - 1;
  const quiet = cuts?.length === last ? cuts : null;
  /** Where the pause after word `w` of the new take may be cut: no part reaches past it into the next word. */
  const after = (w: number) => (w < last ? quiet?.[w] ?? (newWords[w].end + newWords[w + 1].start) / 2 : takeSeconds);
  const before = (w: number) => (w > 0 ? after(w - 1) : 0);
  const sorted = oldParts.filter((part) => !part.copy && part.rate > 0).sort((a, b) => a.start - b.start);
  const planned: { part: SyncEditPart; old: SyncEditPart }[] = [];
  for (const old of sorted) {
    // The words this part plays: those whose middle is inside it.
    const inside = oldWords.map((w, i) => ({ i, mid: (w.start + w.end) / 2 })).filter(({ mid }) => mid >= old.from && mid <= old.to).map(({ i }) => i);
    if (inside.length === 0) continue;
    const a = inside[0];
    const b = inside[inside.length - 1];
    // As much before its first word and after its last as the old part kept, never into the next word.
    const lead = Math.max(0, oldWords[a].start - old.from);
    const tail = Math.max(0, old.to - oldWords[b].end);
    const from = Math.max(before(a), newWords[a].start - lead, 0);
    const to = Math.min(after(b), newWords[b].end + tail, takeSeconds);
    if (!(to > from)) continue;
    // Its first word where the old part's first word played.
    const start = partTime(old, oldWords[a].start) - (newWords[a].start - from);
    const half = (to - from) / 2;
    planned.push({
      old,
      part: { id: `${key}#r${planned.length}`, start, from, to, rate: 1, gainDb: old.gainDb, fadeIn: Math.min(old.fadeIn, half), fadeOut: Math.min(old.fadeOut, half), muted: old.muted },
    });
  }
  if (planned.length === 0) return null;
  const moved: number[] = planned.map(() => 0);
  const over: number[] = planned.map(() => 0);
  let end = prevEnd ?? -Infinity;
  planned.forEach(({ part }, k) => {
    const length = part.to - part.from;
    const limit = (k < planned.length - 1 ? planned[k + 1].part.start : nextStart ?? Infinity) - PART_GAP_SECONDS;
    const runs = part.start + length - limit;
    if (runs > 1e-6) {
      const room = Math.max(0, part.start - Math.max(0, end + PART_GAP_SECONDS));
      const shift = Math.min(runs, room);
      part.start -= shift;
      moved[k] = shift;
      over[k] = Math.max(0, runs - shift);
    }
    // What would play before 0:00 is the pad before its first word: it is left out.
    if (part.start < 0) {
      part.from = Math.min(part.to, part.from - part.start);
      part.start = 0;
    }
    end = part.start + (part.to - part.from);
  });
  return { parts: planned.map(({ part }) => part), moved, over };
};
