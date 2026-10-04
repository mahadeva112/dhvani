import { AudioSegment, SpeakerVoice } from '../types';
import { buildSpeechScript } from './speechScript';

/**
 * Speakers in a transcript, as ElevenLabs Scribe labelled them when asked to
 * tell speakers apart. A speaker is known by name only: renaming one renames
 * every cue it speaks, and merging one into another is a rename to a name
 * that is already in use.
 */

/** One colour per speaker, in the order they first speak. Readable on the app's dark panels. */
export const SPEAKER_COLORS = ['#a78bfa', '#2dd4bf', '#fb923c', '#f472b6', '#38bdf8', '#a3e635', '#fbbf24', '#e879f9'];

/** What a cue with no speaker label is called. */
export const DEFAULT_SPEAKER = 'Speaker';

export const speakerOf = (segment: AudioSegment): string => (segment.speaker || '').trim() || DEFAULT_SPEAKER;

export interface SpeakerSummary {
  name: string;
  color: string;
  cues: number;
  /** Seconds of speech, and its share of all speech (0-1). */
  seconds: number;
  share: number;
}

/** Every speaker, in the order they first speak. */
export const listSpeakers = (segments: AudioSegment[]): SpeakerSummary[] => {
  const byName = new Map<string, { cues: number; seconds: number }>();
  for (const seg of [...segments].sort((a, b) => a.startTime - b.startTime)) {
    const name = speakerOf(seg);
    const entry = byName.get(name) || { cues: 0, seconds: 0 };
    entry.cues += 1;
    entry.seconds += Math.max(0, seg.endTime - seg.startTime);
    byName.set(name, entry);
  }
  const total = [...byName.values()].reduce((sum, e) => sum + e.seconds, 0) || 1;
  return [...byName.entries()].map(([name, e], index) => ({
    name,
    color: SPEAKER_COLORS[index % SPEAKER_COLORS.length],
    cues: e.cues,
    seconds: e.seconds,
    share: e.seconds / total,
  }));
};

/** True when more than one speaker talks. */
export const isMultiSpeaker = (segments: AudioSegment[]): boolean => new Set(segments.map(speakerOf)).size > 1;

/** A cue this short, by another speaker between two cues of one speaker, is probably mislabelled. */
export const SLIP_MAX_SECONDS = 1.5;
/** ...as long as it runs on from them with no more than this much silence either side. */
export const SLIP_MAX_GAP_SECONDS = 0.6;
/** A speaker with less speech than this in all is probably a labelling slip too. */
export const MINOR_SPEAKER_SECONDS = 3;

export interface SpeakerSlip {
  /** The speaker this cue most likely belongs to. */
  suggested: string;
  reason: 'between' | 'minor';
}

/**
 * Cues whose speaker label is probably a slip, by cue id, each with the
 * speaker it most likely belongs to: a short cue sandwiched between two cues
 * of one other speaker with almost no pause, or a cue by a speaker who says
 * almost nothing in the whole recording. Only ever a suggestion.
 */
export const likelySlips = (segments: AudioSegment[]): Map<string, SpeakerSlip> => {
  const slips = new Map<string, SpeakerSlip>();
  const ordered = [...segments].sort((a, b) => a.startTime - b.startTime);
  const minor = new Set(listSpeakers(segments).filter((s) => s.seconds < MINOR_SPEAKER_SECONDS).map((s) => s.name));
  if (new Set(ordered.map(speakerOf)).size < 2) return slips;

  ordered.forEach((seg, i) => {
    const prev = ordered[i - 1];
    const next = ordered[i + 1];
    const name = speakerOf(seg);
    if (
      prev &&
      next &&
      speakerOf(prev) === speakerOf(next) &&
      speakerOf(prev) !== name &&
      seg.endTime - seg.startTime <= SLIP_MAX_SECONDS &&
      seg.startTime - prev.endTime <= SLIP_MAX_GAP_SECONDS &&
      next.startTime - seg.endTime <= SLIP_MAX_GAP_SECONDS
    ) {
      slips.set(String(seg.id), { suggested: speakerOf(prev), reason: 'between' });
      return;
    }
    if (minor.has(name)) {
      // The nearer neighbour that is somebody else.
      const before = prev && speakerOf(prev) !== name ? seg.startTime - prev.endTime : Infinity;
      const after = next && speakerOf(next) !== name ? next.startTime - seg.endTime : Infinity;
      const nearest = before <= after ? prev : next;
      if (nearest && speakerOf(nearest) !== name && !minor.has(speakerOf(nearest))) {
        slips.set(String(seg.id), { suggested: speakerOf(nearest), reason: 'minor' });
      }
    }
  });
  return slips;
};

/** Overlaps shorter than this are timing noise, not two people talking together. */
const MIN_OVERLAP_SECONDS = 0.05;

/**
 * Cues that start while another speaker is still talking in the original, by
 * cue id: who they talk over, and for how long. A synced dub keeps these
 * overlaps rather than pushing the line back.
 */
export const overlapsBefore = (segments: AudioSegment[]): Map<string, { speaker: string; seconds: number }> => {
  const out = new Map<string, { speaker: string; seconds: number }>();
  const ordered = [...segments].sort((a, b) => a.startTime - b.startTime);
  ordered.forEach((seg, i) => {
    let best: { speaker: string; seconds: number } | null = null;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      const other = ordered[j];
      if (speakerOf(other) === speakerOf(seg)) continue;
      const seconds = Math.min(other.endTime, seg.endTime) - seg.startTime;
      if (seconds > MIN_OVERLAP_SECONDS && (!best || seconds > best.seconds)) best = { speaker: speakerOf(other), seconds };
    }
    if (best) out.set(String(seg.id), best);
  });
  return out;
};

/** Every cue by `from` now spoken by `to`. Renaming to a speaker who already exists merges the two. */
export const renameSpeaker = (segments: AudioSegment[], from: string, to: string): AudioSegment[] => {
  const name = to.trim();
  if (!name || name === from) return segments;
  return segments.map((seg) => (speakerOf(seg) === from ? { ...seg, speaker: name } : seg));
};

/**
 * The cast after renaming `from` to `to`: the voice moves with the speaker,
 * unless `to` already has one (a merge keeps the voice of the speaker merged into).
 */
export const renameCast = (
  cast: Record<string, SpeakerVoice> | undefined,
  from: string,
  to: string
): Record<string, SpeakerVoice> => {
  const next = { ...(cast || {}) };
  const name = to.trim();
  if (!name || name === from) return next;
  if (next[from] && !next[name]) next[name] = next[from];
  delete next[from];
  return next;
};

/** One turn of a conversation dub: a run of cues by one speaker, read as one passage. */
export interface ConversationTurn {
  speaker: string;
  text: string;
  /** Seconds of silence in the original before the next turn (negative when the next speaker cuts in). */
  gapAfter: number | null;
}

/** The script as turns in spoken order, each turn's cues rejoined as buildSpeechScript joins them. */
export const conversationTurns = (segments: AudioSegment[]): ConversationTurn[] => {
  const ordered = [...segments].sort((a, b) => a.startTime - b.startTime);
  const groups: AudioSegment[][] = [];
  for (const seg of ordered) {
    const last = groups[groups.length - 1];
    if (last && speakerOf(last[0]) === speakerOf(seg)) last.push(seg);
    else groups.push([seg]);
  }
  return groups
    .map((group, n) => {
      const next = groups[n + 1];
      return {
        speaker: speakerOf(group[0]),
        text: buildSpeechScript(group),
        gapAfter: next ? next[0].startTime - group[group.length - 1].endTime : null,
      };
    })
    .filter((turn) => turn.text.trim().length > 0);
};

/** The voice a speaker is dubbed with: their own when cast, the main voice otherwise. */
export const voiceForSpeaker = (cast: Record<string, SpeakerVoice> | undefined, speaker: string, mainVoiceId: string): string =>
  cast?.[speaker]?.voiceId || mainVoiceId;
