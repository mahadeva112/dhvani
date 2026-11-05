import { syncTakeOf, takesOf, type SyncTake, type SyncTakes } from './syncTakes.ts';
import type { SyncBank } from './syncEditModel.ts';
import type { SyncReport } from './syncService';
import type { VoiceChangeSettings } from './voiceChangeService';

/**
 * Speakers changed into another voice by the voice changer, line by line,
 * and which lines are in it: what retakes and lines a Sync voices again are
 * changed into (voiceChangeService.ts does the changing).
 */

/**
 * A speaker's voice after the voice changer, line by line: what their lines
 * are changed into, how, and the voice the dub was voiced in for them then
 * (`over`). Retakes of their lines are changed into it too, and lines a Sync
 * voices again, while their dub voice is still `over`.
 */
export interface ChangedVoice {
  voiceId: string;
  name: string;
  settings: VoiceChangeSettings;
  over: string;
}

export type ChangedVoices = Record<string, ChangedVoice>;

/** Whether a take is in `voice`: changed into it by the voice changer. */
export const takeIsIn = (take: SyncTake | undefined, voice: Pick<ChangedVoice, 'voiceId' | 'name'>) =>
  Boolean(take && (take.voiceId ? take.voiceId === voice.voiceId : take.voice === voice.name));

/** The voice each line's take in the dub was changed into, by line key; lines playing a voiced take are left out. */
export const lineVoiceIds = (bank: SyncBank, takes: SyncTakes | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of bank.lines) {
    const kept = takes?.[line.key];
    const take = kept?.takes.find((t) => t.id === kept.active);
    if (take?.voiceId) out[line.key] = take.voiceId;
  }
  return out;
};

/**
 * After a Sync: the lines it kept as a voice-changed take (picked, so cut
 * from the old bank as they were), each with that take again, so the next
 * Sync keeps them too and the voice changer knows they are changed. Null
 * when there are none.
 */
export const keptVoiceTakes = (bank: SyncBank, report: SyncReport, priorTakes: SyncTakes | null | undefined): SyncTakes | null => {
  if (!priorTakes) return null;
  const out: SyncTakes = {};
  for (const line of bank.lines) {
    const unit = report.units.find((u) => u.key === line.key);
    const kept = priorTakes[line.key];
    const prior = kept?.takes.find((t) => t.id === kept.active);
    if (!unit?.picked || !prior?.voiceId) continue;
    const take: SyncTake = {
      ...syncTakeOf(line, unit.text),
      id: `voice-${line.bankStart.toString(36)}`,
      kind: 'line',
      voice: prior.voice,
      voiceId: prior.voiceId,
      ...(prior.spoken && { spoken: prior.spoken }),
    };
    out[line.key] = { takes: [take], active: take.id };
  }
  return Object.keys(out).length > 0 ? out : null;
};

/**
 * The lines to change into their speaker's voice: those of a speaker in
 * `voices` whose take in the dub isn't in it yet (voiced again by a Sync, or
 * picked from takes of the old voice). Silent lines are left out.
 */
export const linesOutOfVoice = (bank: SyncBank, report: SyncReport, takes: SyncTakes | null | undefined, voices: ChangedVoices) =>
  bank.lines.filter((line) => {
    const voice = voices[line.speaker];
    const unit = report.units.find((u) => u.key === line.key);
    if (!voice || !unit || unit.silent || !(line.length > 0)) return false;
    const kept = takesOf(takes, line, unit);
    return !takeIsIn(kept.takes.find((t) => t.id === kept.active), voice);
  });
