import { AudioSegment, SubtitleConfiguration, WordTimestamp } from "../types";
import { buildScriptFile } from "./scriptShare";
import { buildCues, sanitizeCues, CueBudget, TimedCue, TimedWord } from "./subtitleCues";

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
 *
 * Segments that still carry their ElevenLabs word timings are cut by the
 * Srutilekha splitter (subtitleCues.ts) as one continuous word stream, so a
 * boundary lands where the phrase ends rather than where a budget ran out.
 * Every cue list then goes through sanitizeCues: no overlaps, a readable
 * minimum, and short silences bridged so captions do not flicker.
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
  const budget: CueBudget = {
    maxCharsPerLine: maxChars,
    maxLines,
    maxWordsPerLine: maxWords,
    maxSecs: maxDur,
  };
  // Per-word display text: casing and punctuation, but the speaker label has
  // already been taken off the segment as a whole.
  const wordDisplayOptions: Partial<SrtOptions> = { ...config, removeSpeakerLabel: false };

  const cues: TimedCue[] = [];
  let run: TimedWord[] = [];
  const flushRun = () => {
    if (run.length) cues.push(...buildCues(run, budget));
    run = [];
  };

  for (const segment of segments) {
    const rawText = segment.textTarget || segment.targetText || segment.textSource || segment.text || '';

    /*
     * Preferred path: this segment still carries the ElevenLabs word timings
     * for exactly this text, so every cue starts and ends on a measured word.
     * The original-language SRT always takes this path.
     */
    const measured: WordTimestamp[] = segment.words || [];
    const spoken = config.removeSpeakerLabel !== false ? cleanSpeakerLabels(rawText) : rawText.trim();
    const tokens = spoken.split(/\s+/).filter(Boolean);
    if (measured.length > 0 && tokens.length === measured.length) {
      tokens.forEach((token, i) => {
        const text = normalizeSubtitleText(token, wordDisplayOptions);
        if (!text) return;
        const start = measured[i].start;
        run.push({
          text,
          raw: token,
          start,
          end: Math.max(measured[i].end, start),
          speaker: segment.speaker ?? null,
        });
      });
      continue;
    }

    flushRun();

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
    const groups: string[][] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
      groups.push(lines.slice(i, i + maxLines));
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

    for (let i = 0; i < groups.length; i++) {
      const cueLines = groups[i];
      const cueWordCount = cueLines.reduce(
        (sum, line) => sum + line.split(/\s+/).filter(Boolean).length,
        0
      );

      // Weight by word count, fallback to equal ratio
      const weight = totalWordsInSegment > 0 ? cueWordCount / totalWordsInSegment : 1 / groups.length;
      const cueStart = cursorTime;
      let cueEnd = cueStart + weight * segmentDuration;

      // Last cue in the segment lands exactly on the measured segment end.
      if (i === groups.length - 1) {
        cueEnd = Math.max(cueStart + 0.3, segment.endTime);
      }

      // If cue exceeds maxDurationSeconds, clamp display end but keep cursor progression
      cues.push({ start: cueStart, end: Math.min(cueEnd, cueStart + maxDur), text: cueLines.join('\n') });
      cursorTime = cueEnd;
    }
  }
  flushRun();

  return sanitizeCues(cues)
    .map((cue, i) => `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`)
    .join('\n\n')
    .trim();
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
  title?: string,
  /** For the JSON script file: what lets another computer put the lines back on its cues. */
  share: { sourceLanguage?: string; fileName?: string; audioDuration?: number } = {}
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

    case 'json':
      // The script file "Paste script" opens on another computer.
      return JSON.stringify(buildScriptFile(segments, { targetLanguage, title: docTitle, ...share }), null, 2);

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



/* ------------------------------------------------------------------ */
/* Saved export choice: which language and which timing               */
/* ------------------------------------------------------------------ */

/** What the cues are timed to: Sync's placement, the whole dub stretched, or the original speech. */
export type SubtitleTiming = 'synced' | 'dubbed' | 'original';
/** Which text the cues carry: the dub's language or the transcribed source. */
export type SubtitleTrack = 'target' | 'source';

export interface SubtitleExportChoice {
  track: SubtitleTrack;
  timing: SubtitleTiming;
}

export const DEFAULT_SUBTITLE_EXPORT_CHOICE: SubtitleExportChoice = { track: 'target', timing: 'synced' };

const EXPORT_CHOICE_KEY = 'dhvani_srt_export_choice';

export const loadSubtitleExportChoice = (): SubtitleExportChoice => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_CHOICE_KEY) || 'null');
    if (saved && ['target', 'source'].includes(saved.track) && ['synced', 'dubbed', 'original'].includes(saved.timing)) {
      return { track: saved.track, timing: saved.timing };
    }
  } catch {}
  return DEFAULT_SUBTITLE_EXPORT_CHOICE;
};

export const saveSubtitleExportChoice = (choice: SubtitleExportChoice) => {
  try {
    localStorage.setItem(EXPORT_CHOICE_KEY, JSON.stringify(choice));
  } catch {}
};

/** The saved timing when this project has it, else the most exact one it does have. */
export const resolveSubtitleTiming = (timing: SubtitleTiming, hasSynced: boolean, hasDub: boolean): SubtitleTiming => {
  if (timing === 'synced' && !hasSynced) return hasDub ? 'dubbed' : 'original';
  if (timing === 'dubbed' && !hasDub) return hasSynced ? 'synced' : 'original';
  return timing;
};

/**
 * Puts the dub's own word timings (forced alignment, see dubSubtitleTiming.ts)
 * on the cues they belong to. A cue whose aligned words land far from where
 * its line was placed (`tolerance` seconds) is left as it was: that dub audio
 * is not this line's. The words are kept only for the dub's own text; the
 * original's text at the dub's timing gets the measured cue span alone.
 */
export const applyDubWordTimings = (
  segments: AudioSegment[],
  timings: Map<string, WordTimestamp[]>,
  { keepWords, tolerance = Infinity }: { keepWords: boolean; tolerance?: number }
): AudioSegment[] =>
  segments.map((segment) => {
    const words = timings.get(String(segment.id)) || [];
    const said = words.filter((word) => word.end > word.start);
    if (said.length === 0) return segment;
    const startTime = said[0].start;
    const endTime = said[said.length - 1].end;
    if (Math.abs(startTime - segment.startTime) > tolerance || Math.abs(endTime - segment.endTime) > tolerance) {
      return segment;
    }
    const { words: _sourceWords, ...rest } = segment;
    return {
      ...rest,
      startTime,
      endTime,
      duration: endTime - startTime,
      timingSource: 'elevenlabs',
      ...(keepWords ? { words } : {}),
    };
  });

const isTimed = (segment: AudioSegment, timings: Map<string, WordTimestamp[]>) =>
  (timings.get(String(segment.id)) || []).some((word) => word.end > word.start);

/** Every cue the dub says has its words timed; otherwise the whole dub keeps the estimate, on one clock. */
const everyLineTimed = (segments: AudioSegment[], timings: Map<string, WordTimestamp[]>) =>
  segments.every((segment) => !(segment.textTarget || segment.targetText || '').trim() || isTimed(segment, timings));

/** How far a synced cue's aligned words may land from Sync's own placement of its line. */
const SYNCED_ALIGN_TOLERANCE = 2;

/**
 * The cues an export writes: the chosen language's text at the chosen timing.
 * The Export subtitles modal and the one-click subtitle card both use it, so they give the same file.
 * With `dubWordTimings` (the dub's words, aligned), dub timings cut on the
 * dub's real word boundaries instead of sharing each line out by length.
 */
export const buildSubtitleSegments = ({
  segments,
  syncedSegments,
  timing,
  track,
  synthAudioDuration = 0,
  options,
  dubWordTimings,
}: {
  segments: AudioSegment[];
  syncedSegments?: AudioSegment[];
  timing: SubtitleTiming;
  track: SubtitleTrack;
  synthAudioDuration?: number;
  options: SrtOptions;
  dubWordTimings?: Map<string, WordTimestamp[]> | null;
}): AudioSegment[] => {
  // The synced cues carry every cue's own fields, source text included, at their placed times.
  let base = timing === 'synced' && syncedSegments ? syncedSegments : segments;
  const keepWords = track === 'target';
  if (timing === 'synced' && syncedSegments && dubWordTimings) {
    base = applyDubWordTimings(base, dubWordTimings, { keepWords, tolerance: SYNCED_ALIGN_TOLERANCE });
  } else if (timing === 'dubbed' && dubWordTimings && everyLineTimed(base, dubWordTimings)) {
    // The dub is on its own clock: a cue it doesn't say has no time on it.
    const said = base.filter((segment) => isTimed(segment, dubWordTimings));
    base = applyDubWordTimings(said, dubWordTimings, { keepWords });
  } else if (timing === 'dubbed' && synthAudioDuration > 0) {
    base = adjustSegmentsForDubbedTimeline(base, synthAudioDuration, options);
  }
  return track === 'target'
    ? base
    : base.map((segment) => ({ ...segment, textTarget: segment.textSource || '', targetText: segment.textSource || '' }));
};

/** "hindi_synced": names the file after the language and timing actually exported. */
export const subtitleFileLabel = (language: string, timing: SubtitleTiming) =>
  `${(language || 'captions').toLowerCase().replace(/\s+/g, '_')}${timing === 'synced' ? '_synced' : ''}`;
