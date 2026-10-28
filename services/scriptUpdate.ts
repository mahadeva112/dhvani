import type { AudioSegment } from '../types';

/*
 * Update script: a newer Dhvani JSON from whoever owns the script (its
 * transcript, cuts, timing and wording), put on a project someone else is
 * dubbing. The script's changes win; changes made here to cues the script did
 * not touch are kept. The cues as the last script file had them (the base)
 * tell the two apart. Nothing is voiced here: the lines the update touched are
 * left for the next Sync, as any script edit leaves them.
 */

const sourceText = (s: AudioSegment) => (s.textSource || s.originalText || '').trim();
const dubText = (s: AudioSegment) => (s.textTarget || s.targetText || '').trim();

/** The same cue as far as the script goes: its timing, words and speaker. */
export const sameScriptCue = (a: AudioSegment, b: AudioSegment) =>
  a.startTime === b.startTime &&
  a.endTime === b.endTime &&
  sourceText(a) === sourceText(b) &&
  dubText(a) === dubText(b) &&
  (a.speaker || '') === (b.speaker || '');

export interface ScriptUpdate {
  /** The cues after the update. */
  segments: AudioSegment[];
  /** Cues the script changed, added or removed, by id. */
  changed: string[];
  added: string[];
  removed: string[];
  /** Cues changed here that the script did not touch: kept as they are here. */
  keptHere: string[];
  /** Cues changed both here and in the script: the script's are used. */
  conflicts: string[];
  /** Cues the script changed that were joined away here: left as they are here, to look at by hand. */
  notApplied: string[];
  /** No base: every cue that differs counts as the script's change. */
  noBase: boolean;
}

const byId = (list: AudioSegment[]) => new Map(list.map((s) => [String(s.id), s]));

/** The dub's own trim of a line stays with the cue here; the script never sets it. */
const withDubTrim = (cue: AudioSegment, here: AudioSegment | undefined): AudioSegment => {
  const { dubTargetSeconds: _theirs, ...rest } = cue;
  return here?.dubTargetSeconds !== undefined ? { ...rest, dubTargetSeconds: here.dubTargetSeconds } : rest;
};

const startOf = (s: AudioSegment) => (Number.isFinite(s.startTime) ? s.startTime : Infinity);

/**
 * The project's cues with the script's update put on them. `base` is the cues
 * as the last script file had them; without one the file is taken as it is.
 */
export const mergeScriptUpdate = (here: AudioSegment[], base: AudioSegment[] | null | undefined, incoming: AudioSegment[]): ScriptUpdate => {
  const hereById = byId(here);
  const inById = byId(incoming);

  if (!base) {
    const changed = incoming.filter((s) => {
      const was = hereById.get(String(s.id));
      return was && !sameScriptCue(was, s);
    });
    return {
      segments: incoming.map((s) => withDubTrim(s, hereById.get(String(s.id)))),
      changed: changed.map((s) => String(s.id)),
      added: incoming.filter((s) => !hereById.has(String(s.id))).map((s) => String(s.id)),
      removed: here.filter((s) => !inById.has(String(s.id))).map((s) => String(s.id)),
      keptHere: [],
      conflicts: [],
      notApplied: [],
      noBase: true,
    };
  }

  const baseById = byId(base);
  const changedHere = (id: string) => {
    const now = hereById.get(id);
    const was = baseById.get(id);
    return !now || !was || !sameScriptCue(now, was);
  };
  const changed = incoming.filter((s) => baseById.has(String(s.id)) && !sameScriptCue(s, baseById.get(String(s.id))!)).map((s) => String(s.id));
  const added = incoming.filter((s) => !baseById.has(String(s.id))).map((s) => String(s.id));
  const removed = base.filter((s) => !inById.has(String(s.id))).map((s) => String(s.id));
  const changedSet = new Set(changed);
  const removedSet = new Set(removed);
  const conflicts = [...changed, ...removed].filter((id) => hereById.has(id) && changedHere(id));
  // Put back, it would say again what the cue it was joined into already says.
  const notApplied = changed.filter((id) => !hereById.has(id));
  // A cue changed only here: a reword, a retime, or a cut or join of cues the script left alone.
  const keptHere = here
    .map((s) => String(s.id))
    .filter((id) => !changedSet.has(id) && !removedSet.has(id) && changedHere(id));

  const segments: AudioSegment[] = [];
  for (const cue of here) {
    const id = String(cue.id);
    if (removedSet.has(id)) continue;
    segments.push(changedSet.has(id) ? withDubTrim(inById.get(id)!, cue) : cue);
  }
  // A cue new in the script goes after the one before it there, then everything in time order.
  for (const id of added) {
    if (hereById.has(id)) continue;
    const at = incoming.findIndex((s) => String(s.id) === id);
    let after = -1;
    for (let i = at - 1; i >= 0 && after < 0; i--) after = segments.findIndex((s) => String(s.id) === String(incoming[i].id));
    segments.splice(after + 1, 0, withDubTrim(incoming[at], undefined));
  }
  const order = new Map(segments.map((s, i) => [s, i]));
  segments.sort((a, b) => startOf(a) - startOf(b) || order.get(a)! - order.get(b)!);

  return { segments, changed, added, removed, keptHere, conflicts, notApplied, noBase: false };
};

/** Whether the script reads like it was transcribed again: most cues it shares by id no longer line up. */
export const looksTranscribedAgain = (update: ScriptUpdate, cueCount: number) =>
  cueCount > 0 && update.changed.length + update.added.length > cueCount * 0.6;
