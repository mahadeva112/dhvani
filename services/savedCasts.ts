import type { SpeakerProfile, SpeakerVoice } from '../types';

/**
 * Casts saved by name for the next project with the same people: each
 * speaker's voice, gender and own settings, by speaker name. A saved cast is
 * used only when the user picks it, and only on speakers with the same name;
 * the rest keep what they have. Kept in this browser (localStorage).
 */

export interface SavedCastSpeaker {
  voiceId?: string;
  profile?: SpeakerProfile;
}

export interface SavedCast {
  name: string;
  speakers: Record<string, SavedCastSpeaker>;
  savedAt: number;
}

const STORAGE_KEY = 'dhvani_saved_casts';
/** Saved casts kept; the oldest go first. */
export const MAX_SAVED_CASTS = 30;

const read = (): SavedCast[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((c): c is SavedCast => Boolean(c) && typeof c.name === 'string' && c.speakers && typeof c.speakers === 'object')
      : [];
  } catch {
    return [];
  }
};

const write = (casts: SavedCast[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(casts));
  } catch {
    /* Storage full or blocked: the cast is simply not kept. */
  }
};

/** The saved casts, newest first. */
export const loadSavedCasts = (): SavedCast[] => read().sort((a, b) => b.savedAt - a.savedAt);

/** What a project's cast and profiles save as: speakers with a voice or a profile only. */
export const castEntries = (
  speakers: string[],
  cast: Record<string, SpeakerVoice> | undefined,
  profiles: Record<string, SpeakerProfile> | undefined
): Record<string, SavedCastSpeaker> =>
  Object.fromEntries(
    speakers.flatMap((name) => {
      const voiceId = cast?.[name]?.voiceId;
      const profile = profiles?.[name];
      const hasProfile = profile && Object.values(profile).some((v) => v !== undefined);
      return voiceId || hasProfile ? [[name, { ...(voiceId && { voiceId }), ...(hasProfile && { profile: { ...profile } }) }]] : [];
    })
  );

/** Saves a cast under `name`, replacing one of that name. Returns the casts now saved. */
export const saveCast = (name: string, speakers: Record<string, SavedCastSpeaker>): SavedCast[] => {
  const clean = name.trim().slice(0, 60);
  if (!clean || Object.keys(speakers).length === 0) return loadSavedCasts();
  const rest = read().filter((c) => c.name.toLowerCase() !== clean.toLowerCase());
  const next = [{ name: clean, speakers, savedAt: Date.now() }, ...rest.sort((a, b) => b.savedAt - a.savedAt)].slice(0, MAX_SAVED_CASTS);
  write(next);
  return next;
};

/** Removes the saved cast called `name`. Returns the casts now saved. */
export const deleteSavedCast = (name: string): SavedCast[] => {
  const next = read().filter((c) => c.name !== name);
  write(next);
  return loadSavedCasts().filter((c) => c.name !== name);
};

/**
 * A project's cast and profiles with a saved cast put on: speakers of the
 * same name take its voice, gender and settings; the others keep theirs.
 * `matched` is how many of the project's speakers it named.
 */
export const applySavedCast = (
  saved: SavedCast,
  speakers: string[],
  cast: Record<string, SpeakerVoice> | undefined,
  profiles: Record<string, SpeakerProfile> | undefined
): { cast: Record<string, SpeakerVoice>; speakerProfiles: Record<string, SpeakerProfile>; matched: number } => {
  const nextCast = { ...(cast || {}) };
  const nextProfiles = { ...(profiles || {}) };
  let matched = 0;
  for (const name of speakers) {
    const entry = saved.speakers[name];
    if (!entry) continue;
    matched += 1;
    if (entry.voiceId) nextCast[name] = { voiceId: entry.voiceId };
    else delete nextCast[name];
    if (entry.profile) nextProfiles[name] = { ...entry.profile };
    else delete nextProfiles[name];
  }
  return { cast: nextCast, speakerProfiles: nextProfiles, matched };
};
