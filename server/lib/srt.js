/**
 * Subtitle timing engine.
 *
 * INVARIANT: every timestamp produced here comes from an ElevenLabs word
 * timestamp. Nothing in this file estimates, interpolates across a gap, or
 * lets a language model influence a start/end value. Translation replaces
 * cue *text* only — see `retextCues`.
 */

export const DEFAULT_CUE_OPTIONS = {
  maxCharsPerCue: 84,
  maxWordsPerCue: 14,
  maxDurationSeconds: 6,
  /** A silence longer than this forces a cue boundary. */
  gapThresholdSeconds: 0.6,
  /** Sentence-final punctuation closes a cue when it is long enough already. */
  minCharsBeforeSentenceBreak: 20,
};

const SENTENCE_END = /[.!?。！？।॥؟…]["'”’)\]]*$/;

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Keeps only real spoken words. ElevenLabs also returns `spacing` tokens and,
 * when enabled, `audio_event` tokens such as `(laughter)` — neither should
 * drive subtitle timing or text.
 */
export const filterSpokenWords = (words = []) =>
  words
    .filter((word) => (word?.type || 'word') === 'word')
    .filter((word) => typeof word?.start === 'number' && typeof word?.end === 'number')
    .filter((word) => String(word.text || '').trim().length > 0)
    .map((word, index) => ({
      index,
      text: String(word.text).trim(),
      start: round3(Number(word.start)),
      end: round3(Math.max(Number(word.end), Number(word.start))),
      speaker: word.speaker_id || null,
    }))
    .sort((a, b) => a.start - b.start);

/**
 * Groups ElevenLabs words into subtitle cues.
 *
 * Boundaries come from silence gaps, sentence punctuation, speaker changes and
 * the configured length limits. A cue's start is its first word's start and its
 * end is its last word's end — both verbatim from ElevenLabs.
 */
export const buildCuesFromWords = (words, options = {}) => {
  const config = { ...DEFAULT_CUE_OPTIONS, ...options };
  const spoken = filterSpokenWords(words);
  if (spoken.length === 0) return [];

  const cues = [];
  let current = null;

  const flush = () => {
    if (!current || current.words.length === 0) return;
    cues.push({
      id: `cue-${cues.length + 1}`,
      index: cues.length + 1,
      startTime: current.words[0].start,
      endTime: current.words[current.words.length - 1].end,
      speaker: current.speaker || 'Speaker',
      text: current.words
        .map((word) => word.text)
        .join(' ')
        .replace(/\s+([,.;:!?])/g, '$1'),
      words: current.words.map(({ text, start, end }) => ({ text, start, end })),
    });
    current = null;
  };

  for (const word of spoken) {
    if (!current) {
      current = { words: [word], speaker: word.speaker, chars: word.text.length };
      continue;
    }

    const previous = current.words[current.words.length - 1];
    const gap = word.start - previous.end;
    const prospectiveChars = current.chars + 1 + word.text.length;
    const prospectiveDuration = word.end - current.words[0].start;

    const speakerChanged =
      Boolean(word.speaker) && Boolean(current.speaker) && word.speaker !== current.speaker;
    const sentenceClosed =
      SENTENCE_END.test(previous.text) && current.chars >= config.minCharsBeforeSentenceBreak;

    const mustBreak =
      speakerChanged ||
      gap >= config.gapThresholdSeconds ||
      sentenceClosed ||
      prospectiveChars > config.maxCharsPerCue ||
      current.words.length >= config.maxWordsPerCue ||
      prospectiveDuration > config.maxDurationSeconds;

    if (mustBreak) {
      flush();
      current = { words: [word], speaker: word.speaker, chars: word.text.length };
    } else {
      current.words.push(word);
      current.chars = prospectiveChars;
    }
  }

  flush();
  return cues;
};

/** Formats seconds as the SRT timecode `HH:MM:SS,mmm`. */
export const formatSrtTimestamp = (seconds) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMs = Math.round(safe * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = (totalMs - ms) / 1000;
  const s = totalSeconds % 60;
  const totalMinutes = (totalSeconds - s) / 60;
  const m = totalMinutes % 60;
  const h = (totalMinutes - m) / 60;

  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

/** Wraps a cue's text onto at most `maxLines` lines without touching timing. */
const wrapText = (text, maxCharsPerLine = 42, maxLines = 2) => {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';

  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharsPerLine && lines.length < maxLines - 1) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join('\n');
};

/**
 * Serialises cues to an `.srt` document. Cue numbering is sequential and
 * timestamps are written exactly as stored.
 */
export const serializeSrt = (cues, { field = 'text', maxCharsPerLine = 42, maxLines = 2 } = {}) => {
  const blocks = [];
  let index = 1;

  for (const cue of cues) {
    const raw = (cue[field] ?? cue.text ?? '').toString().trim();
    if (!raw) continue;

    blocks.push(
      [
        String(index),
        `${formatSrtTimestamp(cue.startTime)} --> ${formatSrtTimestamp(cue.endTime)}`,
        wrapText(raw, maxCharsPerLine, maxLines),
      ].join('\n')
    );
    index += 1;
  }

  return `${blocks.join('\n\n')}\n`;
};

/** WebVTT uses the same cue list; only the millisecond separator differs. */
export const serializeVtt = (cues, options = {}) =>
  `WEBVTT\n\n${serializeSrt(cues, options).replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;

/**
 * Replaces cue text from an id-keyed map while leaving `startTime`, `endTime`
 * and the word list untouched. This is the only way translated text is allowed
 * to enter a cue.
 */
export const retextCues = (cues, textById, field = 'translatedText') =>
  cues.map((cue) => ({
    ...cue,
    [field]: (textById.get(String(cue.id)) ?? '').toString().trim(),
  }));

/**
 * Parses an `.srt` document back into cues, for callers that hand us an
 * existing SRT to translate. Timestamps are read, never recomputed.
 */
export const parseSrt = (srt) => {
  const blocks = String(srt || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/);

  const toSeconds = (stamp) => {
    const match = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(stamp);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    // Accumulate in integer milliseconds. Adding the fractional part directly
    // introduces float error, which would then fail the timing-integrity check
    // on an SRT that round-trips through this parser.
    const totalMs =
      Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(ms.padEnd(3, '0'));
    return round3(totalMs / 1000);
  };

  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) continue;

    const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingLineIndex === -1) continue;

    const [startStamp, endStamp] = lines[timingLineIndex].split('-->');
    cues.push({
      id: `cue-${cues.length + 1}`,
      index: cues.length + 1,
      startTime: toSeconds(startStamp),
      endTime: toSeconds(endStamp),
      text: lines
        .slice(timingLineIndex + 1)
        .join(' ')
        .trim(),
      words: [],
    });
  }

  return cues;
};

/**
 * Defence in depth: asserts a translated cue list still carries the exact
 * timings of the source cue list. A thrown failure means a bug, not bad input.
 */
export const assertTimingsPreserved = (sourceCues, translatedCues) => {
  if (sourceCues.length !== translatedCues.length) {
    throw new Error(
      `Subtitle integrity check failed: ${sourceCues.length} source cues but ${translatedCues.length} translated cues.`
    );
  }

  for (let i = 0; i < sourceCues.length; i += 1) {
    const a = sourceCues[i];
    const b = translatedCues[i];
    if (a.startTime !== b.startTime || a.endTime !== b.endTime || String(a.id) !== String(b.id)) {
      throw new Error(`Subtitle integrity check failed at cue ${i + 1}: timestamps were modified.`);
    }
  }

  return true;
};
