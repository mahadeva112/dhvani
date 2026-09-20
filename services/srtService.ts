import { AudioSegment, SubtitleConfiguration, WordTimestamp } from "../types";

/* ------------------------------------------------------------------ */
/* Types & Defaults                                                    */
/* ------------------------------------------------------------------ */

export type SubtitleCasing = 'original' | 'uppercase' | 'capitalize';

export interface SrtOptions {
  maxWordsPerLine: number;
  maxLinesPerCue: number;
  maxCharsPerLine: number;
  maxDurationSeconds: number;
  includePunctuation: boolean;
  casing?: SubtitleCasing;
  removeSpeakerLabel?: boolean;
}

export const DEFAULT_SRT_OPTIONS: SrtOptions = {
  maxWordsPerLine: 3, // Default: max 3 words per line
  maxLinesPerCue: 1, // Default: 1 line per cue
  maxCharsPerLine: 25,
  maxDurationSeconds: 2.5,
  includePunctuation: true,
  casing: 'original',
  removeSpeakerLabel: true,
};

export interface SrtPreset {
  id: string;
  name: string;
  description: string;
  options: SrtOptions;
}

export const SRT_PRESETS: SrtPreset[] = [
  {
    id: 'shorts_viral',
    name: 'Shorts / Reels / TikTok (Default)',
    description: '1 line, max 3 words, punchy pacing for vertical video',
    options: {
      maxWordsPerLine: 3,
      maxLinesPerCue: 1,
      maxCharsPerLine: 22,
      maxDurationSeconds: 2.2,
      includePunctuation: true,
      casing: 'original',
      removeSpeakerLabel: true,
    },
  },
  {
    id: 'shorts_uppercase',
    name: 'Shorts Viral (ALL CAPS)',
    description: '1 line, max 3 words in uppercase for high engagement',
    options: {
      maxWordsPerLine: 3,
      maxLinesPerCue: 1,
      maxCharsPerLine: 22,
      maxDurationSeconds: 2.2,
      includePunctuation: false,
      casing: 'uppercase',
      removeSpeakerLabel: true,
    },
  },
  {
    id: 'dynamic_5words',
    name: 'Single Line Dynamic',
    description: '1 line, max 5 words, balanced pacing',
    options: {
      maxWordsPerLine: 5,
      maxLinesPerCue: 1,
      maxCharsPerLine: 32,
      maxDurationSeconds: 3.5,
      includePunctuation: true,
      casing: 'original',
      removeSpeakerLabel: true,
    },
  },
  {
    id: 'youtube_standard',
    name: 'YouTube Standard',
    description: '2 lines, max 6 words per line, readable video subtitles',
    options: {
      maxWordsPerLine: 6,
      maxLinesPerCue: 2,
      maxCharsPerLine: 35,
      maxDurationSeconds: 4.5,
      includePunctuation: true,
      casing: 'original',
      removeSpeakerLabel: true,
    },
  },
  {
    id: 'broadcast_netflix',
    name: 'Broadcast / Netflix Standard',
    description: '2 lines, max 8 words per line, 37 chars, max 6.0s',
    options: {
      maxWordsPerLine: 8,
      maxLinesPerCue: 2,
      maxCharsPerLine: 37,
      maxDurationSeconds: 6.0,
      includePunctuation: true,
      casing: 'original',
      removeSpeakerLabel: true,
    },
  },
];

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

/**
 * Converts seconds to SRT timestamp format: HH:MM:SS,mmm
 */
export const formatSrtTime = (seconds: number): string => {
  const totalMs = Math.max(0, Math.round(seconds * 1000));

  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);

  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return (
    `${hh.toString().padStart(2, '0')}:` +
    `${mm.toString().padStart(2, '0')}:` +
    `${ss.toString().padStart(2, '0')},` +
    `${ms.toString().padStart(3, '0')}`
  );
};

/**
 * Strips common punctuation characters.
 */
export const stripPunctuation = (text: string): string =>
  text.replace(/[.,!?;:"'()\[\]{}_~`<>«»/\\-]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Cleans speaker labels like "[Speaker 1]:", "(Presenter):", "Host:"
 */
export const cleanSpeakerLabels = (text: string): string => {
  return text
    .replace(/^\[[^\]]+\]:\s*/gm, '')
    .replace(/^\([^)]+\):\s*/gm, '')
    .replace(/^[A-Za-z0-9_\s]{2,15}:\s*/gm, '')
    .trim();
};

/**
 * Normalizes subtitle text based on casing and punctuation options.
 */
export const normalizeSubtitleText = (
  text: string,
  options: Partial<SrtOptions> = {}
): string => {
  let cleaned = (text || '').trim();
  if (options.removeSpeakerLabel !== false) {
    cleaned = cleanSpeakerLabels(cleaned);
  }
  if (options.includePunctuation === false) {
    cleaned = stripPunctuation(cleaned);
  }
  if (options.casing === 'uppercase') {
    cleaned = cleaned.toUpperCase();
  } else if (options.casing === 'capitalize') {
    cleaned = cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return cleaned.replace(/\s+/g, ' ').trim();
};

/* ------------------------------------------------------------------ */
/* Core Logic                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Word-timestamp anchoring                                            */
/* ------------------------------------------------------------------ */

/**
 * Splits a segment's ElevenLabs word timings into groups matching `lines`.
 *
 * Returns null when the segment has no word data, or when the text has been
 * translated or edited so its word count no longer lines up with the measured
 * words. In that case the caller falls back to distributing time inside the
 * segment's own measured span.
 */
const groupWordTimingsForLines = (
  segment: AudioSegment,
  lines: string[]
): { start: number; end: number }[] | null => {
  const words: WordTimestamp[] = segment.words || [];
  if (words.length === 0 || lines.length === 0) return null;

  const counts = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
  const total = counts.reduce((sum, count) => sum + count, 0);

  // A mismatch means these are not the words that were measured (e.g. the cue
  // has been translated), so exact per-word anchoring is not available.
  if (total !== words.length) return null;

  const spans: { start: number; end: number }[] = [];
  let cursor = 0;

  for (const count of counts) {
    if (count === 0) {
      spans.push({ start: words[Math.min(cursor, words.length - 1)].start, end: words[Math.min(cursor, words.length - 1)].start });
      continue;
    }
    const slice = words.slice(cursor, cursor + count);
    spans.push({ start: slice[0].start, end: slice[slice.length - 1].end });
    cursor += count;
  }

  return spans;
};

/**
 * Re-cuts segments to subtitle constraints using the ElevenLabs word timings.
 *
 * Every resulting cue starts and ends on a measured word boundary, so tightening
 * the subtitle limits never drifts the timing away from the audio.
 */
export const resegmentByWordTimestamps = (
  segments: AudioSegment[],
  config: SubtitleConfiguration
): AudioSegment[] => {
  const maxChars = Math.max(10, config.maxCharsPerLine || 42) * Math.max(1, config.maxLinesPerCue || 2);
  const maxDuration = Math.max(0.5, config.maxSecondsPerCue || 6);

  const output: AudioSegment[] = [];

  for (const segment of segments) {
    const words = segment.words || [];

    // No word data (a hand-typed cue, or a translated cue): keep it as-is
    // rather than inventing boundaries inside it.
    if (words.length === 0) {
      output.push(segment);
      continue;
    }

    let bucket: WordTimestamp[] = [];
    let chars = 0;

    const flush = () => {
      if (bucket.length === 0) return;
      const start = bucket[0].start;
      const end = bucket[bucket.length - 1].end;
      output.push({
        id: `${segment.id}-opt-${output.length}`,
        startTime: start,
        endTime: end,
        duration: Math.max(0.05, end - start),
        speaker: segment.speaker,
        textSource: bucket.map((word) => word.text).join(' '),
        textTarget: bucket.map((word) => word.text).join(' '),
        words: [...bucket],
        timingSource: 'elevenlabs',
      });
      bucket = [];
      chars = 0;
    };

    for (const word of words) {
      const prospectiveChars = chars + (bucket.length > 0 ? 1 : 0) + word.text.length;
      const prospectiveDuration = bucket.length > 0 ? word.end - bucket[0].start : 0;

      if (bucket.length > 0 && (prospectiveChars > maxChars || prospectiveDuration > maxDuration)) {
        flush();
      }

      bucket.push(word);
      chars = bucket.length === 1 ? word.text.length : prospectiveChars;
    }

    flush();
  }

  return output.length > 0 ? output : segments;
};

/**
 * Generates an SRT string from audio segments using custom user constraints:
 * - maxWordsPerLine (default: 3)
 * - maxLinesPerCue (default: 1)
 * - maxCharsPerLine (default: 25)
 * - maxDurationSeconds (default: 2.5)
 * - includePunctuation
 */
export const generateSrtContent = (
  segments: AudioSegment[],
  options: Partial<SrtOptions> = {}
): string => {
  const config: SrtOptions = { ...DEFAULT_SRT_OPTIONS, ...options };

  // Sanitize limits
  const maxWords = Math.max(1, config.maxWordsPerLine || 3);
  const maxLines = Math.max(1, config.maxLinesPerCue || 1);
  const maxChars = Math.max(10, config.maxCharsPerLine || 25);
  const maxDur = Math.max(0.5, config.maxDurationSeconds || 2.5);

  let cueIndex = 1;
  const cueBlocks: string[] = [];

  for (const segment of segments) {
    const rawText = segment.textTarget || segment.targetText || segment.textSource || segment.text || '';
    const text = normalizeSubtitleText(rawText, config);

    if (!text) continue;

    const segmentDuration = Math.max(0.2, segment.endTime - segment.startTime);

    /* ---------------- Split into words ---------------- */
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;

    /* ---------------- Build subtitle lines based on maxWords & maxChars ---------------- */
    const lines: string[] = [];
    let currentLineWords: string[] = [];
    let currentLineChars = 0;

    for (const word of words) {
      const prospectiveWordCount = currentLineWords.length + 1;
      const prospectiveChars = currentLineChars + (currentLineWords.length > 0 ? 1 : 0) + word.length;

      if (
        currentLineWords.length > 0 &&
        (prospectiveWordCount > maxWords || prospectiveChars > maxChars)
      ) {
        lines.push(currentLineWords.join(' '));
        currentLineWords = [word];
        currentLineChars = word.length;
      } else {
        currentLineWords.push(word);
        currentLineChars = prospectiveChars;
      }
    }
    if (currentLineWords.length > 0) {
      lines.push(currentLineWords.join(' '));
    }

    /* ---------------- Group lines into cues based on maxLinesPerCue ---------------- */
    const cues: string[][] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
      cues.push(lines.slice(i, i + maxLines));
    }

    if (cues.length === 0) continue;

    /* ---------------- Assign timing to each cue ---------------- */
    /*
     * Preferred path: this segment still carries the ElevenLabs word timings
     * for exactly this text, so every sub-cue starts and ends on a measured
     * word boundary. The original-language SRT always takes this path.
     */
    const cueTexts = cues.map((cueLines) => cueLines.join('\n'));
    const exactSpans = groupWordTimingsForLines(segment, cueTexts);

    if (exactSpans) {
      for (let i = 0; i < cues.length; i++) {
        const span = exactSpans[i];
        cueBlocks.push(
          `${cueIndex}\n${formatSrtTime(span.start)} --> ${formatSrtTime(span.end)}\n${cueTexts[i]}`
        );
        cueIndex++;
      }
      continue;
    }

    /*
     * Fallback for translated or hand-edited text, whose words have no
     * one-to-one correspondence with the measured source words. Time is shared
     * out *inside* the segment's measured span: the first sub-cue starts at the
     * segment's real ElevenLabs start and the last ends at its real end, so the
     * cue never drifts against the audio even though the internal split points
     * are derived.
     */
    const totalWordsInSegment = words.length;
    let cursorTime = segment.startTime;

    for (let i = 0; i < cues.length; i++) {
      const cueLines = cues[i];
      const cueText = cueTexts[i];
      const cueWordCount = cueLines.reduce(
        (sum, line) => sum + line.split(/\s+/).filter(Boolean).length,
        0
      );

      // Weight by word count, fallback to equal ratio
      const weight = totalWordsInSegment > 0 ? cueWordCount / totalWordsInSegment : 1 / cues.length;
      const allocatedDuration = weight * segmentDuration;

      const cueStart = cursorTime;
      // Clamped end time
      let cueEnd = cueStart + allocatedDuration;

      // Last cue in the segment lands exactly on the measured segment end.
      if (i === cues.length - 1) {
        cueEnd = Math.max(cueStart + 0.3, segment.endTime);
      }

      // If cue exceeds maxDurationSeconds, clamp display end but keep cursor progression
      const displayEnd = Math.min(cueEnd, cueStart + maxDur);

      cueBlocks.push(
        `${cueIndex}\n${formatSrtTime(cueStart)} --> ${formatSrtTime(displayEnd)}\n${cueText}`
      );

      cueIndex++;
      cursorTime = cueEnd;
    }
  }

  return cueBlocks.join('\n\n').trim();
};

/**
 * Generates standard WebVTT content from audio segments.
 */
export const generateVttContent = (
  segments: AudioSegment[],
  options: Partial<SrtOptions> = {}
): string => {
  const srt = generateSrtContent(segments, options);
  // WebVTT requires WEBVTT header and uses '.' instead of ',' for millisecond delimiter
  const vttTimes = srt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${vttTimes}`;
};

/**
 * Generates a clean timecoded transcript text.
 */
export const generateTextTranscript = (segments: AudioSegment[]): string => {
  return segments
    .map((seg) => {
      const inTime = formatSrtTime(seg.startTime).slice(3, 8); // MM:SS
      const outTime = formatSrtTime(seg.endTime).slice(3, 8);
      const spk = seg.speaker ? `[${seg.speaker}] ` : '';
      const text = seg.textTarget || seg.textSource || '';
      return `[${inTime} - ${outTime}] ${spk}${text}`;
    })
    .join('\n\n');
};

export type TargetScriptFormat = 'dialogue' | 'timecoded' | 'bilingual' | 'json' | 'csv';

/**
 * Generates a clean, professional script in the target language.
 */
export const generateTargetLanguageScript = (
  segments: AudioSegment[],
  targetLanguage: string = 'Target Language',
  format: TargetScriptFormat = 'dialogue',
  title?: string
): string => {
  if (!segments || segments.length === 0) {
    return `--- ${targetLanguage.toUpperCase()} SCRIPT ---\nNo dialogue cues found.`;
  }

  const docTitle = title || 'Dhvani AI Dubbing Studio';
  const totalDurationSeconds = Math.max(...segments.map((s) => s.endTime), 0);
  const durationFormatted = `${Math.floor(totalDurationSeconds / 60)}m ${Math.floor(totalDurationSeconds % 60)}s`;

  switch (format) {
    case 'dialogue': {
      // Pure continuous dialogue text suitable for reading, teleprompter, or dubbing voice artist
      const header = `====================================================\n${docTitle.toUpperCase()}\nTarget Language: ${targetLanguage}\nTotal Cues: ${segments.length} | Duration: ${durationFormatted}\n====================================================\n\n`;
      const dialogueBody = segments
        .map((seg, idx) => {
          const text = (seg.textTarget || seg.targetText || seg.textSource || '').trim();
          const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
          return `${speaker}${text}`;
        })
        .filter(Boolean)
        .join('\n\n');
      return header + dialogueBody;
    }

    case 'timecoded': {
      // Timestamped broadcast cue script with in/out timestamps, duration, speaker, and target translation
      const header = `====================================================\n${docTitle.toUpperCase()} - BROADCAST CUE SCRIPT\nLanguage: ${targetLanguage}\nTotal Cues: ${segments.length} | Duration: ${durationFormatted}\n====================================================\n\n`;
      const cues = segments
        .map((seg, idx) => {
          const inTime = formatSrtTime(seg.startTime);
          const outTime = formatSrtTime(seg.endTime);
          const dur = (seg.endTime - seg.startTime).toFixed(2);
          const speaker = seg.speaker || `Speaker`;
          const target = (seg.textTarget || seg.targetText || '').trim() || '(No translation)';
          return `CUE #${idx + 1} [${inTime} ➔ ${outTime}] (${dur}s)\n${speaker}: ${target}`;
        })
        .join('\n\n----------------------------------------------------\n\n');
      return header + cues;
    }

    case 'bilingual': {
      // Side-by-side / interleaved source vs target script for review and QA
      const header = `====================================================\n${docTitle.toUpperCase()} - BILINGUAL DUBBING SCRIPT\nTarget Language: ${targetLanguage}\nTotal Cues: ${segments.length} | Duration: ${durationFormatted}\n====================================================\n\n`;
      const pairs = segments
        .map((seg, idx) => {
          const inTime = formatSrtTime(seg.startTime).slice(3, 8);
          const outTime = formatSrtTime(seg.endTime).slice(3, 8);
          const speaker = seg.speaker || 'Speaker';
          const src = (seg.textSource || seg.text || '').trim();
          const tgt = (seg.textTarget || seg.targetText || '').trim();
          return `[#${idx + 1} | ${inTime} - ${outTime}] ${speaker}\nORIGINAL: ${src}\n${targetLanguage.toUpperCase()}: ${tgt}`;
        })
        .join('\n\n----------------------------------------------------\n\n');
      return header + pairs;
    }

    case 'json': {
      const data = {
        title: docTitle,
        language: targetLanguage,
        cueCount: segments.length,
        totalDurationSeconds,
        exportedAt: new Date().toISOString(),
        segments: segments.map((seg, idx) => ({
          cueNumber: idx + 1,
          id: seg.id,
          startTime: seg.startTime,
          endTime: seg.endTime,
          duration: Number((seg.endTime - seg.startTime).toFixed(3)),
          speaker: seg.speaker || 'Speaker',
          sourceText: seg.textSource || seg.text || '',
          targetText: seg.textTarget || seg.targetText || '',
          targetLanguage,
        })),
      };
      return JSON.stringify(data, null, 2);
    }

    case 'csv': {
      const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
      const headers = ['Cue #', 'Start Time (s)', 'End Time (s)', 'Duration (s)', 'Speaker', 'Original Text', `Target Text (${targetLanguage})`];
      const rows = segments.map((seg, idx) => [
        idx + 1,
        seg.startTime.toFixed(2),
        seg.endTime.toFixed(2),
        (seg.endTime - seg.startTime).toFixed(2),
        escapeCsv(seg.speaker || 'Speaker'),
        escapeCsv(seg.textSource || seg.text || ''),
        escapeCsv(seg.textTarget || seg.targetText || ''),
      ]);
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    }

    default:
      return segments.map((s) => s.textTarget || s.targetText || '').join('\n\n');
  }
};

/**
 * Triggers a direct browser file download for text/json/csv content.
 */
export const downloadFile = (
  content: string,
  fileName: string,
  mimeType: string = 'text/plain;charset=utf-8'
) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Adjusts segments to match the SYNTHESIZED DUB's timeline.
 *
 * This is deliberately not the source timeline: the dubbed audio is a new
 * recording with its own length, so subtitles for it cannot use the source
 * timestamps. The ElevenLabs timings stay untouched on the original segments
 * and continue to drive the source-language SRT; this function only produces
 * captions for the generated dub track.
 */
export const adjustSegmentsForDubbedTimeline = (
  segments: AudioSegment[],
  synthAudioDuration: number,
  options: Partial<SrtOptions> = {}
): AudioSegment[] => {
  if (!segments || segments.length === 0 || !synthAudioDuration || synthAudioDuration <= 0) {
    return segments;
  }

  // Filter and normalize text for each segment
  const segmentsWithText = segments.map((seg) => {
    const rawText = seg.textTarget || seg.targetText || seg.textSource || seg.text || '';
    const text = normalizeSubtitleText(rawText, options);
    return {
      segment: seg,
      text,
      length: text.trim().length,
    };
  });

  const totalLength = segmentsWithText.reduce((sum, item) => sum + item.length, 0);

  if (totalLength === 0) {
    // Fallback: distribute equally
    const perSegmentDuration = synthAudioDuration / segments.length;
    return segments.map((seg, idx) => ({
      ...seg,
      startTime: idx * perSegmentDuration,
      endTime: (idx + 1) * perSegmentDuration,
      duration: perSegmentDuration,
    }));
  }

  let currentStartTime = 0;
  return segmentsWithText.map((item) => {
    const ratio = item.length / totalLength;
    const rawAllocated = ratio * synthAudioDuration;
    
    // Minimum 0.3s duration for readable cue if there is spoken text
    const allocatedDuration = item.length > 0 ? Math.max(0.3, rawAllocated) : 0;
    
    const startTime = currentStartTime;
    const endTime = currentStartTime + allocatedDuration;
    
    currentStartTime = endTime;

    return {
      ...item.segment,
      startTime,
      endTime,
      duration: allocatedDuration,
    };
  });
};


