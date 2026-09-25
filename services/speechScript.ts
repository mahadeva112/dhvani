import { AudioSegment } from '../types';

/**
 * Turns subtitle cues back into the flowing text ElevenLabs reads best.
 *
 * Cues are cut for reading on screen, so they often break mid-sentence. Joining
 * every cue with a blank line made ElevenLabs treat each fragment as its own
 * paragraph: it paused and reset its intonation in the middle of sentences,
 * which is what sounded choppy and robotic. Cues are now joined with a space,
 * and a line break is kept only where a sentence ends at a real pause in the
 * original audio.
 */

/** Sentence-ending punctuation across the scripts DHVANI dubs into, plus trailing quotes. */
const SENTENCE_END = /[.!?…।॥。！？؟]["'”’)\]]*$/u;

/** A sentence end followed by at least this much silence gets a line break (a short breath). */
const PAUSE_GAP_SECONDS = 0.7;

/** ...and at least this much gets a blank line (a new paragraph, a longer pause). */
const PARAGRAPH_GAP_SECONDS = 1.5;

const cueText = (segment: AudioSegment) =>
  String(segment.textTarget || segment.targetText || '').trim();

export const buildSpeechScript = (segments: AudioSegment[]): string => {
  let script = '';
  let previous: AudioSegment | null = null;

  for (const segment of segments) {
    const text = cueText(segment);
    if (!text) continue;

    if (previous) {
      const gap = segment.startTime - previous.endTime;
      if (!SENTENCE_END.test(script)) script += ' ';
      else if (gap >= PARAGRAPH_GAP_SECONDS) script += '\n\n';
      else if (gap >= PAUSE_GAP_SECONDS) script += '\n';
      else script += ' ';
    }

    script += text;
    previous = segment;
  }

  return script;
};
