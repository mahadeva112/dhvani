import { isOriginalClip, syncedParts, type SyncBank, type SyncBankLine, type SyncEditPart, type SyncEdits, type SyncLineEdit } from './syncEditModel.ts';
import { SYNC_TAKE_ID, type SyncTakes } from './syncTakes.ts';

/**
 * A line Sync again would place itself: the hand edits it would lose, and the
 * take picked in the T window, which it keeps but places afresh (`changes`).
 */
export interface UnlockedEdit {
  key: string;
  changes: string[];
}

// Less than this, in seconds, is not a change anyone made on purpose.
const EPSILON = 0.01;

const seconds = (value: number) => `${value.toFixed(2)} s`;

const sameParts = (a: SyncEditPart[], b: SyncEditPart[]) =>
  a.length === b.length &&
  a.every((part, n) => {
    const other = b[n];
    return (
      Math.abs(part.start - other.start) < EPSILON &&
      Math.abs(part.from - other.from) < EPSILON &&
      Math.abs(part.to - other.to) < EPSILON &&
      part.rate === other.rate &&
      part.gainDb === other.gainDb &&
      part.fadeIn === other.fadeIn &&
      part.fadeOut === other.fadeOut &&
      part.muted === other.muted
    );
  });

/**
 * What the user did to a line in Edit timing, in a few words each, measured
 * against the line as Sync placed it. Empty when the edit leaves it as placed.
 */
export const describeLineEdit = (line: SyncBankLine, edit: SyncLineEdit, sampleRate: number): string[] => {
  const placed = syncedParts(line, sampleRate);
  const parts = edit.parts;
  if (parts.length === 0) return ['Removed'];
  if (sameParts(parts, placed)) return [];
  if (parts.every((part) => part.muted)) return ['Muted'];
  const changes: string[] = [];
  const moved = Math.min(...parts.map((part) => part.start)) - Math.min(...placed.map((part) => part.start));
  if (Math.abs(moved) >= EPSILON) changes.push(`Moved ${seconds(Math.abs(moved))} ${moved < 0 ? 'earlier' : 'later'}`);
  const played = (list: SyncEditPart[]) => list.reduce((sum, part) => sum + (part.to - part.from), 0);
  const trimmed = played(placed) - played(parts);
  if (trimmed >= EPSILON) changes.push(`Trimmed by ${seconds(trimmed)}`);
  else if (trimmed <= -EPSILON) changes.push(`Plays ${seconds(-trimmed)} more of the take`);
  if (parts.length > placed.length) changes.push(`Split into ${parts.length} parts`);
  else if (parts.length < placed.length) changes.push(`Joined into ${parts.length} part${parts.length === 1 ? '' : 's'}`);
  const rate = parts.find((part) => part.rate !== 1)?.rate;
  if (rate !== undefined) changes.push(`Speed ${rate.toFixed(2)}×`);
  const gain = parts.find((part) => part.gainDb !== 0)?.gainDb;
  if (gain !== undefined) changes.push(`Level ${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`);
  if (parts.some((part) => part.fadeIn > 0 || part.fadeOut > 0)) changes.push('Fades');
  if (parts.some((part) => part.muted)) changes.push('Part muted');
  return changes.length > 0 ? changes : ['Timing changed'];
};

/** The take a line plays when it was picked in the T window, named as the T window names it; null for Sync's own. */
export const pickedTakeName = (takes: SyncTakes | null | undefined, key: string): string | null => {
  const kept = takes?.[key];
  if (!kept || kept.active === SYNC_TAKE_ID) return null;
  const n = kept.takes.filter((take) => take.id !== SYNC_TAKE_ID).findIndex((take) => take.id === kept.active);
  return n < 0 ? null : `Take ${n + 1}`;
};

/**
 * The lines Sync again would place itself, in the order they play: unlocked
 * lines with hand edits it would drop, and unlocked lines playing a take
 * picked in the T window, which it keeps but may move. Lines voiced again
 * anyway (`voicedAgain`) lose both whatever happens; clips of the original
 * are kept by any sync.
 */
export const unlockedEdits = (
  bank: SyncBank | null | undefined,
  edits: SyncEdits | null | undefined,
  voicedAgain: string[] = [],
  takes: SyncTakes | null | undefined = null
): UnlockedEdit[] => {
  if (!bank) return [];
  const out: UnlockedEdit[] = [];
  for (const line of bank.lines) {
    const edit = edits?.[line.key];
    if (edit?.locked || isOriginalClip(line.key) || voicedAgain.includes(line.key)) continue;
    const picked = pickedTakeName(takes, line.key);
    const changes = [...(picked ? [`${picked} picked in the T window`] : []), ...(edit ? describeLineEdit(line, edit, bank.sampleRate) : [])];
    if (changes.length > 0) out.push({ key: line.key, changes });
  }
  return out;
};

/**
 * The lines Sync changed lines only holds where they are: every line of the
 * dub but the changed ones, clips of the original and lines already locked.
 */
export const linesToHold = (bank: SyncBank | null | undefined, edits: SyncEdits | null | undefined, changed: string[]): string[] =>
  (bank?.lines ?? []).filter((line) => !isOriginalClip(line.key) && !changed.includes(line.key) && !edits?.[line.key]?.locked).map((line) => line.key);

/**
 * `edits` with the lines Sync changed lines only held let go again: a line
 * still as Sync placed it needs no edit, one with the user's own edits keeps
 * them, unlocked as they were. Null when no edit is left.
 */
export const releaseLines = (edits: SyncEdits | null | undefined, keys: string[], bank: SyncBank): SyncEdits | null => {
  if (!edits) return null;
  const next: SyncEdits = { ...edits };
  for (const key of keys) {
    const edit = next[key];
    if (!edit) continue;
    const line = bank.lines.find((l) => l.key === key);
    if (line && describeLineEdit(line, edit, bank.sampleRate).length === 0) delete next[key];
    else next[key] = { ...edit, locked: false };
  }
  return Object.keys(next).length > 0 ? next : null;
};

/**
 * `edits` with each of `keys` locked, so Sync again keeps those lines where
 * they are; a line with no edit is locked as placed, as Lock in Edit timing does.
 */
export const lockLines = (edits: SyncEdits | null | undefined, keys: string[], bank: SyncBank): SyncEdits => {
  const next = { ...edits };
  for (const key of keys) {
    if (next[key]) next[key] = { ...next[key], locked: true };
    else {
      const line = bank.lines.find((l) => l.key === key);
      if (line) next[key] = { parts: syncedParts(line, bank.sampleRate), locked: true };
    }
  }
  return next;
};
