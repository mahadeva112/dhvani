import { basePart, measureEdits, partsOf, spokenSpan, type SyncBank, type SyncBankLine, type SyncEdits } from './syncEditModel.ts';
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
 * is (pickedTakes below), and starts the takes afresh.
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

/** Takes voiced each time the user asks; each costs a voicing of the line (or of the words picked). */
export const TAKES_PER_ASK = 3;

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
  cuts: { start: number; end: number }[];
  crossfade: number;
  dropped: number;
  maxStartShift?: number;
  seed?: number;
  direction?: TakeDirection;
  /** The words voiced again, for a phrase take. */
  phrase?: string;
  /** What the line said when the take was voiced. */
  text: string;
}

/** A line's takes, oldest first, and the one it plays. */
export interface LineTakes {
  takes: SyncTake[];
  active: string;
}

export type SyncTakes = Record<string, LineTakes>;

export const SYNC_TAKE_ID = 'sync';

/** The take Sync placed, as the bank line has it. */
export const syncTakeOf = (line: SyncBankLine, text: string): SyncTake => ({
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
  text,
});

/** A line's takes: those kept, or only Sync's own before any was asked for. */
export const takesOf = (takes: SyncTakes | null | undefined, line: SyncBankLine, unit: SyncUnitReport): LineTakes =>
  takes?.[line.key] ?? { takes: [{ ...syncTakeOf(line, unit.text), cutOff: Boolean(unit.cutOff) }], active: SYNC_TAKE_ID };

/** The words of a line, as the takes panel picks them. */
export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** A line's words split around the ones picked (`from` to `to`, inclusive). */
export const phraseOf = (text: string, from: number, to: number) => {
  const words = wordsOf(text);
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(words.length - 1, Math.max(from, to));
  return { before: words.slice(0, a).join(' '), words: words.slice(a, b + 1).join(' '), after: words.slice(b + 1).join(' ') };
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
  const { maxStartShift: _shift, ...rest } = old;
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
  const lines = bank.lines.map((l, n) => (n === index ? line : l));
  const nextBank = { ...bank, lines };

  const nextEdits: SyncEdits = { ...(edits ?? {}) };
  const before = edits?.[key];
  delete nextEdits[key];
  const gainDb = before?.parts[0]?.gainDb ?? 0;
  if (before && (before.locked || gainDb !== 0)) nextEdits[key] = { locked: before.locked, parts: [{ ...basePart(line, rate), gainDb }] };
  const cleanEdits = Object.keys(nextEdits).length > 0 ? nextEdits : null;

  const n = baseReport.units.findIndex((unit) => unit.key === key);
  const measured = measureEdits(baseReport, nextBank, null, [key]);
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
          pauseTrimmed: 0,
          retakes: 0,
          fromDub: false,
          picked: take.kind !== 'sync',
        }
      : u
  );
  const nextBase: SyncReport = {
    ...measured,
    units,
    summary: {
      ...measured.summary,
      exceeded: units.filter((u) => u.exceeded).length,
      short: units.filter((u) => u.short).length,
      cutOff: units.filter((u) => u.cutOff).length,
    },
  };
  return { bank: nextBank, edits: cleanEdits, baseReport: nextBase };
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
