import type { AudioSegment } from '../types';
import { apiUpload } from './apiClient';
import { audioBufferToWav, readRange } from './audioService';
import type { WaveAudio } from './waveform';
import { speakerOf } from './speakers';
import { SECTION_PAD_SECONDS } from '../server/lib/sourceSections.js';
import { expressionOf, lineText, planExpression, wordsOf, type ExpressionSection, type ExpressionTags } from './expressionTags';

/**
 * Voice expression Natural heard ahead of Dub: the sections of the original
 * not heard yet, sent one at a time (see expressionTags.ts for what is kept
 * and why).
 */

export * from './expressionTags';

/** Rate the source is sent at: speech only needs to be heard, not played. */
const LISTEN_SAMPLE_RATE = 16000;

/** One section of the original, padded as the server pads it, as a small mono WAV. */
const sectionClip = async (audio: WaveAudio, section: ExpressionSection): Promise<Blob> => {
  const start = Math.max(0, section.start - SECTION_PAD_SECONDS);
  const end = Math.min(audio.duration, section.end + SECTION_PAD_SECONDS);
  const piece = await readRange(audio, start, end);
  const context = new OfflineAudioContext(1, Math.max(1, Math.ceil(piece.duration * LISTEN_SAMPLE_RATE)), LISTEN_SAMPLE_RATE);
  const source = context.createBufferSource();
  source.buffer = piece;
  source.connect(context.destination);
  source.start();
  return audioBufferToWav(await context.startRendering());
};

/** Sections heard at once. */
const CONCURRENCY = 3;

/**
 * Hears every section with a line not heard yet. `onSection` gets each
 * section's lines as soon as it is back (to save them), with how many of the
 * script's sections are heard by then. A line already heard keeps its tags.
 */
export const hearExpression = async (
  audio: WaveAudio,
  segments: AudioSegment[],
  language: string,
  tags: ExpressionTags | undefined,
  { signal, onSection }: { signal: AbortSignal; onSection: (entries: ExpressionTags, heard: number, total: number) => void }
) => {
  const plan = planExpression(segments, language, tags);
  const total = plan.sections.length;
  let heard = total - plan.toHear.length;
  let next = 0;
  // One section failing stops the others from starting more.
  let failed = false;

  const hearSection = async (section: ExpressionSection) => {
    const lines = section.indexes.map((i) => lineText(segments[i]));
    const form = new FormData();
    form.append('file', await sectionClip(audio, section), 'section.wav');
    form.append('lines', JSON.stringify(lines));
    // Who says each line, when more than one person speaks in the section: each is tagged from their own delivery.
    const speakers = section.indexes.map((i) => speakerOf(segments[i]));
    if (new Set(speakers).size > 1) form.append('speakers', JSON.stringify(speakers));
    if (language) form.append('language', language);
    const result = await apiUpload<{ lines: string[] }>('/delivery/source-cues/section', form, { signal });
    const entries: ExpressionTags = {};
    section.indexes.forEach((i, k) => {
      if (expressionOf(tags, language, segments[i])) return;
      const said = result?.lines?.[k];
      entries[plan.keys[i]] = { text: typeof said === 'string' && wordsOf(said) === wordsOf(lines[k]) ? said : lines[k] };
    });
    heard += 1;
    onSection(entries, heard, total);
  };

  const worker = async () => {
    while (next < plan.toHear.length && !failed) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        await hearSection(plan.toHear[next++]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.toHear.length) }, worker));
};

