import { useEffect, useMemo, useState } from 'react';
import type { AudioSegment } from '../types';
import { compareVoices, profileSpeakers, scoreCues, type CueVoice, type MonoAudio, type VoiceMatch } from './voiceMatch';

export interface VoiceReading {
  /** How alike each pair of speakers sounds. */
  matches: VoiceMatch[];
  /** Each cue's fit to its own label, by cue id. */
  cues: Map<string, CueVoice>;
}

const NOTHING: VoiceReading = { matches: [], cues: new Map() };

/**
 * How alike each pair of speakers sounds, and how well each cue fits its label, worked out in the page once the
 * labels settle (a short wait after the last edit, so renaming or merging
 * doesn't start a read per keystroke). Nothing when there is one speaker or
 * no decoded audio yet.
 */
export const useVoiceMatches = (audio: MonoAudio | null | undefined, segments: AudioSegment[], enabled: boolean): VoiceReading => {
  const [reading, setReading] = useState<VoiceReading>(NOTHING);

  // Who says what and when: a change to any of it is a new read.
  const signature = useMemo(
    () => segments.map((s) => `${s.speaker || ''}@${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}`).join('|'),
    [segments]
  );

  useEffect(() => {
    if (!enabled || !audio) {
      setReading(NOTHING);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      profileSpeakers(audio, segments, { signal: controller.signal })
        .then(async (profiles) => {
          const matches = compareVoices(profiles, segments);
          const cues = await scoreCues(audio, segments, profiles, { signal: controller.signal });
          if (!controller.signal.aborted) setReading({ matches, cues });
        })
        .catch(() => {
          // A cancelled or failed read just means no suggestion.
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `segments` is read through its signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, signature, enabled]);

  return reading;
};
