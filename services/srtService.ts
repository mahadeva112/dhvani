import { AudioSegment, SubtitleConfiguration, WordTimestamp } from "../types";
import { buildScriptFile } from "./scriptShare";
import { buildCues, sanitizeCues, vlen, CueBudget, TimedCue, TimedWord } from "./subtitleCues";
import { stripPunctuation } from "./subtitleText";

export { stripPunctuation };

/* ------------------------------------------------------------------ */
/* Types & Defaults                                                    */
/* ------------------------------------------------------------------ */

export interface SrtOptions {
  maxWordsPerLine: number;
  maxLinesPerCue: number;
  maxCharsPerLine: number;
  maxDurationSeconds: number;
  /** Off means none: every mark in any script goes (subtitleText.ts). */
  includePunctuation: boolean;
  removeSpeakerLabel?: boolean;
}

/**
 * One line of up to five words (the "One line" preset). Three words was the
 * default until 2026-11-27: too few for a Hindi or Bengali phrase, so nearly
 * every cue broke one in two.
 */
export const DEFAULT_SRT_OPTIONS: SrtOptions = {
  maxWordsPerLine: 5,
  maxLinesPerCue: 1,
  maxCharsPerLine: 32,
  maxDurationSeconds: 3.5,
  includePunctuation: true,
  removeSpeakerLabel: true,
};

/** The default before 2026-11-27. Saved options still equal to it were never chosen by hand. */
const OLD_DEFAULT_LIMITS = { maxWordsPerLine: 3, maxLinesPerCue: 1, maxCharsPerLine: 25, maxDurationSeconds: 2.5 };

const SRT_OPTIONS_KEY = 'dhvani_srt_options';

/** The subtitle options last saved, else the default. An untouched old default becomes the new one. */
export const loadSrtOptions = (fallback: SrtOptions = DEFAULT_SRT_OPTIONS): SrtOptions => {
  try {
    const saved = JSON.parse(localStorage.getItem(SRT_OPTIONS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const untouched = (Object.keys(OLD_DEFAULT_LIMITS) as (keyof typeof OLD_DEFAULT_LIMITS)[]).every(
        (key) => saved[key] === OLD_DEFAULT_LIMITS[key]
      );
      return untouched ? { ...saved, ...pickLimits(DEFAULT_SRT_OPTIONS) } : { ...DEFAULT_SRT_OPTIONS, ...saved };
    }
  } catch {}
  return fallback;
};

const pickLimits = ({ maxWordsPerLine, maxLinesPerCue, maxCharsPerLine, maxDurationSeconds }: SrtOptions) => ({
  maxWordsPerLine,
  maxLinesPerCue,
  maxCharsPerLine,
  maxDurationSeconds,
});

/** The preset these options match, else 'custom'. */
export const presetIdFor = (options: SrtOptions) => {
  const limits = JSON.stringify(pickLimits(options));
  return SRT_PRESETS.find((preset) => JSON.stringify(pickLimits(preset.options)) === limits)?.id ?? 'custom';
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
    name: 'Shorts / Reels / TikTok',
    description: '1 line, max 3 words, punchy pacing for vertical video',
    options: {
      maxWordsPerLine: 3,
      maxLinesPerCue: 1,
      maxCharsPerLine: 22,
      maxDurationSeconds: 2.2,
      includePunctuation: true,
      removeSpeakerLabel: true,
    },
  },
  {
    id: 'dynamic_5words',
    name: 'Single Line Dynamic (Default)',
    description: '1 line, max 5 words, balanced pacing',
    options: {
      maxWordsPerLine: 5,
      maxLinesPerCue: 1,
      maxCharsPerLine: 32,
      maxDurationSeconds: 3.5,
      includePunctuation: true,
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
 * Subtitle text as shown: speaker label and punctuation taken off when asked.
 * Letters are never re-cased: the subtitles are in the dub's language.
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
 * - maxWordsPerLine (default: 5)
 * - maxLinesPerCue (default: 1)
 * - maxCharsPerLine (default: 32)
 * - maxDurationSeconds (default: 3.5)
 * - includePunctuation
 *
 * Segments that still carry their ElevenLabs word timings are cut by the
 * Srutilekha splitter (subtitleCues.ts) as one continuous word stream, so a
 * boundary lands where the phrase ends rather than where a budget ran out.
 * A cue never runs from one dub line into the next. Lines without measured
 * words are cut by the same rules on times shared out by word length.
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
  // Per-word display text: punctuation, but the speaker label has
  // already been taken off the segment as a whole.
  const wordDisplayOptions: Partial<SrtOptions> = { ...config, removeSpeakerLabel: false };

  const cues: TimedCue[] = [];
  let run: TimedWord[] = [];
  const flushRun = () => {
    if (run.length) cues.push(...buildCues(run, budget));
    run = [];
  };
  // The last word of each dub line: no cue runs on into the next line.
  const endLine = (words: TimedWord[]) => {
    if (words.length) words[words.length - 1] = { ...words[words.length - 1], lineEnd: true };
  };

  for (const segment of segments) {
    // The dub's language only: a cue with no translation stays out, never the original's words.
    const rawText = segment.textTarget || segment.targetText || '';
    const spoken = config.removeSpeakerLabel !== false ? cleanSpeakerLabels(rawText) : rawText.trim();
    const tokens = spoken.split(/\s+/).filter(Boolean);

    /*
     * Preferred path: this segment still carries the ElevenLabs word timings
     * for exactly this text, so every cue starts and ends on a measured word.
     * Only the dub's own aligned words (buildSubtitleSegments) are kept for this.
     */
    const measured: WordTimestamp[] = segment.words || [];
    if (measured.length > 0 && tokens.length === measured.length) {
      const line: TimedWord[] = [];
      tokens.forEach((token, i) => {
        const text = normalizeSubtitleText(token, wordDisplayOptions);
        if (!text) return;
        const start = measured[i].start;
        line.push({
          text,
          raw: token,
          start,
          end: Math.max(measured[i].end, start),
          speaker: segment.speaker ?? null,
        });
      });
      endLine(line);
      run.push(...line);
      continue;
    }

    /*
     * No measured words for this text (alignment failed or is still running,
     * or the text was edited): the line's own span is shared out over its
     * words by their length, and the same phrase rules cut it. The first cue
     * starts at the line's start and the last ends at its end; the cuts inside
     * are estimates. Cut on their own, so their even spacing doesn't change
     * what counts as a pause in the measured words around them.
     */
    flushRun();
    const shown = tokens
      .map((token) => ({ raw: token, text: normalizeSubtitleText(token, wordDisplayOptions) }))
      .filter((token) => token.text);
    if (!shown.length) continue;
    const lineStart = segment.startTime;
    const lineEnd = Math.max(lineStart + 0.3, segment.endTime);
    const weights = shown.map((token) => vlen(token.text) + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let at = lineStart;
    const line: TimedWord[] = shown.map((token, i) => {
      const start = at;
      at = i === shown.length - 1 ? lineEnd : at + (weights[i] / total) * (lineEnd - lineStart);
      return { text: token.text, raw: token.raw, start, end: at, speaker: segment.speaker ?? null };
    });
    endLine(line);
    cues.push(...buildCues(line, budget));
  }
  flushRun();

  return sanitizeCues(cues)
    .map((cue, i) => `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`)
    .join('\n\n')
    .trim();
};

/**
 * Every word the subtitles are cut on with a measured time: the same words
 * generateSrtContent takes its timed path with. A hand split uses them so
 * the new boundary lands where the word is said.
 */
export const measuredSubtitleWords = (segments: AudioSegment[], options: Partial<SrtOptions> = {}): WordTimestamp[] => {
  const config: SrtOptions = { ...DEFAULT_SRT_OPTIONS, ...options };
  const display: Partial<SrtOptions> = { ...config, removeSpeakerLabel: false };
  const out: WordTimestamp[] = [];
  for (const segment of segments) {
    const rawText = segment.textTarget || segment.targetText || '';
    const spoken = config.removeSpeakerLabel !== false ? cleanSpeakerLabels(rawText) : rawText.trim();
    const words = spoken.split(/\s+/).filter(Boolean);
    const measured = segment.words || [];
    if (measured.length === 0 || words.length !== measured.length) continue;
    words.forEach((word, i) => {
      if (!normalizeSubtitleText(word, display)) return;
      out.push({ text: word, start: measured[i].start, end: Math.max(measured[i].end, measured[i].start) });
    });
  }
  return out;
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

/** `docx` is made by scriptDocx, not generateTargetLanguageScript: it is a file, not text. */
export type TargetScriptFormat = 'dialogue' | 'timecoded' | 'bilingual' | 'json' | 'csv' | 'docx';

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
      // Subtitles carry the dub's language only: no empty "Original Text" column for them.
      const hasOriginal = segments.some((seg) => (seg.textSource || seg.text || '').trim());
      const headers = ['Cue #', 'Start Time (s)', 'End Time (s)', 'Duration (s)', 'Speaker', ...(hasOriginal ? ['Original Text'] : []), `Target Text (${targetLanguage})`];
      const rows = segments.map((seg, idx) => [
        idx + 1,
        seg.startTime.toFixed(2),
        seg.endTime.toFixed(2),
        (seg.endTime - seg.startTime).toFixed(2),
        escapeCsv(seg.speaker || 'Speaker'),
        ...(hasOriginal ? [escapeCsv(seg.textSource || seg.text || '')] : []),
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
    const rawText = seg.textTarget || seg.targetText || '';
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
/** Which text the cues carry: always the dub's language (no original-language subtitles). */
export type SubtitleTrack = 'target';

export interface SubtitleExportChoice {
  track: SubtitleTrack;
  timing: SubtitleTiming;
}

export const DEFAULT_SUBTITLE_EXPORT_CHOICE: SubtitleExportChoice = { track: 'target', timing: 'synced' };

const EXPORT_CHOICE_KEY = 'dhvani_srt_export_choice';

export const loadSubtitleExportChoice = (): SubtitleExportChoice => {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_CHOICE_KEY) || 'null');
    // An old saved "source" track reads as the dub's language: there is no other.
    if (saved && ['synced', 'dubbed', 'original'].includes(saved.timing)) {
      return { track: 'target', timing: saved.timing };
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

const dubLineText = (segment: AudioSegment) => (segment.textTarget || segment.targetText || '').trim();

/**
 * The dub's lines on the dub's own clock when only some have aligned words
 * (the rest were said differently from the script). Each run of untimed lines
 * is shared out, by text length, over the room between the timed lines around
 * it; they carry no words, so they are cut on estimated times.
 */
const placeUntimedLines = (
  lines: AudioSegment[],
  timings: Map<string, WordTimestamp[]>,
  dubDuration: number
): AudioSegment[] => {
  const timed = lines.map((segment) => isTimed(segment, timings));
  const out = [...lines];
  for (let i = 0; i < out.length; ) {
    if (timed[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < out.length && !timed[j]) j += 1;
    const from = i > 0 ? out[i - 1].endTime : 0;
    const lengths = out.slice(i, j).map((segment) => Math.max(1, dubLineText(segment).length));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    const room = j < out.length ? out[j].startTime - from : dubDuration > from ? dubDuration - from : 0;
    // No room between the timed lines: an estimate of about 15 characters a second.
    const span = room > 0.3 * (j - i) ? room : total / 15;
    let at = from;
    for (let k = i; k < j; k += 1) {
      const length = (lengths[k - i] / total) * span;
      const { words: _words, ...rest } = out[k];
      out[k] = { ...rest, startTime: at, endTime: at + length, duration: length };
      at += length;
    }
    i = j;
  }
  return out;
};

/** How far a synced cue's aligned words may land from Sync's own placement of its line. */
const SYNCED_ALIGN_TOLERANCE = 2;

/**
 * The cues an export writes: the chosen language's text at the chosen timing.
 * The Export subtitles modal uses it for both the .srt and the .vtt.
 * With `dubWordTimings` (the dub's words, aligned), dub timings cut on the
 * dub's real word boundaries instead of sharing each line out by length.
 */
export const buildSubtitleSegments = ({
  segments,
  syncedSegments,
  timing,
  synthAudioDuration = 0,
  options,
  dubWordTimings,
}: {
  segments: AudioSegment[];
  syncedSegments?: AudioSegment[];
  timing: SubtitleTiming;
  /** Always the dub's language; kept so callers can say so. */
  track?: SubtitleTrack;
  synthAudioDuration?: number;
  options: SrtOptions;
  dubWordTimings?: Map<string, WordTimestamp[]> | null;
}): AudioSegment[] => {
  /*
   * The synced cues carry every cue's own fields at their placed times. The
   * original's measured words are taken off: they time the original's words,
   * not the dub's, and a line whose word count happened to match would be cut
   * on the wrong words. Only the dub's own aligned words go back on.
   */
  let base = (timing === 'synced' && syncedSegments ? syncedSegments : segments).map(({ words: _sourceWords, ...segment }) => segment);
  const keepWords = true;
  if (timing === 'synced' && syncedSegments && dubWordTimings) {
    base = applyDubWordTimings(base, dubWordTimings, { keepWords, tolerance: SYNCED_ALIGN_TOLERANCE });
  } else if (timing === 'dubbed' && dubWordTimings && base.some((segment) => isTimed(segment, dubWordTimings))) {
    // The dub is on its own clock: a cue it doesn't say has no time on it,
    // and a line said differently from its script sits between its neighbours.
    const said = base.filter((segment) => dubLineText(segment));
    base = placeUntimedLines(applyDubWordTimings(said, dubWordTimings, { keepWords }), dubWordTimings, synthAudioDuration);
  } else if (timing === 'dubbed' && synthAudioDuration > 0) {
    base = adjustSegmentsForDubbedTimeline(base, synthAudioDuration, options);
  }
  return base;
};

/** "hindi_synced": names the file after the language and timing actually exported. */
export const subtitleFileLabel = (language: string, timing: SubtitleTiming) =>
  `${(language || 'captions').toLowerCase().replace(/\s+/g, '_')}${timing === 'synced' ? '_synced' : ''}`;
