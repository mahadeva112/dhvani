import type { SyncBank } from './syncEditModel.ts';

/*
 * Each speaker's lane in Edit timing, as a DAW's tracks: a level the user
 * sets, which the file is rendered with, and a mute and a solo, which are for
 * listening only. The level goes on top of the gain the sync matched each
 * speaker at (the bank's speakerGains), so the render and the live dub both
 * apply it with what they already do for several speakers.
 */

/** The range of a speaker's level, in dB. */
export const MIN_SPEAKER_DB = -24;
export const MAX_SPEAKER_DB = 12;

/** For listening only: a speaker's lane muted, or soloed (several may be). */
export interface SpeakerMonitor {
  muted: boolean;
  solo: boolean;
}

const clampDb = (db: number) => Math.min(MAX_SPEAKER_DB, Math.max(MIN_SPEAKER_DB, db));

/** Levels worth sending: finite and not 0 dB, within the range. */
export const cleanSpeakerLevels = (levels: Record<string, number> | null | undefined): Record<string, number> =>
  Object.fromEntries(
    Object.entries(levels || {})
      .filter(([, db]) => Number.isFinite(db) && Math.abs(db) > 1e-6)
      .map(([speaker, db]) => [speaker, clampDb(db)])
  );

/** The bank with each speaker's level on top of the gain the sync gave them: what the file is rendered and played with. */
export const withSpeakerLevels = (bank: SyncBank, levels: Record<string, number> | null | undefined): SyncBank => {
  const set = Object.entries(cleanSpeakerLevels(levels));
  if (set.length === 0) return bank;
  const speakerGains = { ...bank.speakerGains };
  for (const [speaker, db] of set) {
    const matched = Number.isFinite(speakerGains[speaker]) && speakerGains[speaker] > 0 ? speakerGains[speaker] : 1;
    speakerGains[speaker] = matched * 10 ** (db / 20);
  }
  return { ...bank, speakerGains };
};

/**
 * The lanes a listener doesn't hear: muted, or left out by a solo. As in a
 * DAW, a solo anywhere in Edit timing (`soloElsewhere`: on a lane not in
 * `names`, such as a track when these are speakers) leaves out every lane
 * that isn't soloed.
 */
export const silencedSpeakers = (
  names: string[],
  monitor: Record<string, SpeakerMonitor> | null | undefined,
  soloElsewhere = false
): Set<string> => {
  const soloing = soloElsewhere || names.some((name) => monitor?.[name]?.solo);
  return new Set(names.filter((name) => monitor?.[name]?.muted || (soloing && !monitor?.[name]?.solo)));
};
