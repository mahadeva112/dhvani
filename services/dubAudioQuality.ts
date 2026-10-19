/**
 * The format a dub's lines are voiced in. ElevenLabs keeps WAV 48 kHz for
 * its Pro plan and MP3 192 kbps for Creator and up; a plan that refuses one
 * is asked again in the next, before anything is voiced, so it costs nothing.
 */
export type DubAudioQuality = 'pcm_48000' | 'mp3_44100_192' | 'mp3_44100_128';

export const DEFAULT_DUB_AUDIO_QUALITY: DubAudioQuality = 'pcm_48000';

export const DUB_AUDIO_QUALITIES: { id: DubAudioQuality; label: string; hint: string }[] = [
  { id: 'pcm_48000', label: 'WAV · 48 kHz', hint: 'Lossless, as ElevenLabs voices it. Needs the ElevenLabs Pro plan or above.' },
  { id: 'mp3_44100_192', label: 'MP3 · 44.1 kHz · 192 kbps', hint: 'Needs the ElevenLabs Creator plan or above.' },
  { id: 'mp3_44100_128', label: 'MP3 · 44.1 kHz · 128 kbps', hint: 'Every ElevenLabs plan.' },
];

/** What a refused format is asked again in. */
const NEXT_QUALITY: Partial<Record<DubAudioQuality, DubAudioQuality>> = {
  pcm_48000: 'mp3_44100_192',
  mp3_44100_192: 'mp3_44100_128',
};

export const isDubAudioQuality = (value: unknown): value is DubAudioQuality =>
  DUB_AUDIO_QUALITIES.some((q) => q.id === value);

export const dubAudioQualityLabel = (id: string) => DUB_AUDIO_QUALITIES.find((q) => q.id === id)?.label ?? id;

/** The format to ask for: the chosen one, or the first after it the plan hasn't refused. */
export const allowedQuality = (chosen: DubAudioQuality, refused: ReadonlySet<string>): DubAudioQuality => {
  let format = chosen;
  while (refused.has(format) && NEXT_QUALITY[format]) format = NEXT_QUALITY[format]!;
  return format;
};

/**
 * Runs `voice` in `chosen`, and again in the next format each time the plan
 * refuses one. `onRefused` hears each refused format, so the next dub starts
 * where this one ended up.
 */
export const voiceInAllowedQuality = async <T>(
  chosen: DubAudioQuality,
  refused: ReadonlySet<string>,
  voice: (format: DubAudioQuality) => Promise<T>,
  onRefused: (format: DubAudioQuality) => void
): Promise<{ result: T; format: DubAudioQuality }> => {
  let format = allowedQuality(chosen, refused);
  for (;;) {
    try {
      return { result: await voice(format), format };
    } catch (err: any) {
      const next = NEXT_QUALITY[format];
      if (err?.code !== 'output_format_not_allowed' || !next) throw err;
      onRefused(format);
      format = next;
    }
  }
};

/** Why a dub came out in a lower format than the one chosen, for the user. */
export const fallbackNotice = (chosen: DubAudioQuality, used: string) =>
  chosen === used
    ? null
    : `Your ElevenLabs plan doesn't include ${dubAudioQualityLabel(chosen)}, so this dub was voiced in ${dubAudioQualityLabel(used)}. ` +
      (chosen === 'pcm_48000' ? 'WAV 48 kHz needs the Pro plan or above.' : 'MP3 192 kbps needs the Creator plan or above.');
