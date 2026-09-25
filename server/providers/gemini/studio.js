import fs from 'node:fs';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { geminiClient, parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import { toBcp47 } from '../../lib/languages.js';
import { pcmToWav } from '../../lib/wav.js';

/**
 * Gemini features that existed in the original app and are kept for parity.
 *
 * None of these touch subtitle timing. The two that look timing-adjacent —
 * `splitSegment` and `optimizeSegments` — are editor conveniences applied to
 * a cue the user chose to re-cut by hand; the ElevenLabs word timestamps stay
 * attached to the cue and remain the source of truth for the exported SRT.
 */

const MEDIA_INLINE_LIMIT = 18 * 1024 * 1024;

/** Inlines a media file as base64. Large files are rejected with a clear message. */
const inlineMedia = async (file) => {
  const stats = await fs.promises.stat(file.path);
  if (stats.size > MEDIA_INLINE_LIMIT) {
    throw new ApiError(
      `This audio is ${(stats.size / 1024 / 1024).toFixed(0)}MB, which is too large to send to Gemini for analysis ` +
        `(limit ${MEDIA_INLINE_LIMIT / 1024 / 1024}MB). Transcription is unaffected — ElevenLabs handles the full file.`,
      { status: 413, code: 'media_too_large', provider: 'gemini' }
    );
  }

  return {
    inlineData: {
      data: (await fs.promises.readFile(file.path)).toString('base64'),
      mimeType: file.mimetype || 'audio/mpeg',
    },
  };
};

/** Picks the single expression tag that best describes the speaker's delivery. */
export const detectExpression = async (file, { apiKey, models } = {}) => {
  const prompt = `Listen to this audio clip and judge the speaker's emotion, tone and pacing.

Choose the SINGLE most accurate tag from these categories:

TONE & PRESENCE: [calm] [gentle] [soft] [intimate] [peaceful] [soothing] [serene] [grounded] [warm] [compassionate] [clear] [centered]
WEIGHT & GRAVITY: [serious] [firm] [authoritative] [solemn] [grave] [heavy] [somber] [emotionally_weighted] [no_nonsense]
MENTAL PROCESSING: [thoughtful] [reflective] [contemplative] [meditative] [analytical] [matter_of_fact] [explanatory] [realization] [clarity] [intentional]
VULNERABILITY: [sad] [melancholic] [vulnerable] [tender] [fragile] [aching] [disappointed] [concerned]
URGENCY: [intense] [urgent] [direct] [wake_up] [corrective]
POSITIVITY: [hopeful] [reassuring] [encouraging] [inviting]
RESOLUTION: [resolved] [settled] [acceptance]

Return ONLY the tag, for example "[calm]".`;

  const { response } = await generateText({
    contents: { role: 'user', parts: [await inlineMedia(file), { text: prompt }] },
    models,
    apiKey,
  });

  return String(response.text || '').trim() || 'Natural';
};

/**
 * Re-cuts one cue into smaller cues inside its own time span.
 *
 * The model proposes where the *text* divides; the boundaries are then snapped
 * onto the cue's real ElevenLabs word timestamps when they are available, so
 * the split never invents a timing that was not measured from the audio.
 */
export const splitSegment = async (segment, { apiKey, models } = {}) => {
  const text = String(segment.textTarget || segment.textSource || '').trim();
  if (!text) return [segment];

  const parts = Math.max(2, Math.min(6, Math.ceil(text.split(/\s+/).length / 6)));

  const prompt = `Split this subtitle line into ${parts} shorter lines that each read as a complete, natural phrase.

Split at commas, clause boundaries or conjunctions. Keep every word, in order, with nothing added or removed.

LINE: "${text}"

Respond with ONLY this JSON:
{"parts":["<line 1>","<line 2>"]}`;

  const { response } = await generateText({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    models,
    apiKey,
  });

  const parsed = parseJsonResponse(response.text, 'Gemini split');
  const pieces = (parsed.parts || []).map((part) => String(part).trim()).filter(Boolean);
  if (pieces.length < 2) return [segment];

  const words = Array.isArray(segment.words) ? segment.words : [];
  const start = Number(segment.startTime) || 0;
  const end = Number(segment.endTime) || start;

  // Preferred path: snap each piece onto real word timestamps.
  if (words.length >= pieces.length) {
    const results = [];
    let cursor = 0;

    for (const [index, piece] of pieces.entries()) {
      const wordCount = piece.split(/\s+/).filter(Boolean).length;
      const isLast = index === pieces.length - 1;
      const take = isLast ? words.length - cursor : Math.min(wordCount, words.length - cursor - (pieces.length - index - 1));
      const slice = words.slice(cursor, cursor + Math.max(1, take));
      cursor += slice.length;

      results.push({
        id: `${segment.id}-split-${index}`,
        startTime: slice[0].start,
        endTime: slice[slice.length - 1].end,
        duration: slice[slice.length - 1].end - slice[0].start,
        speaker: segment.speaker,
        textSource: piece,
        textTarget: piece,
        words: slice,
        timingSource: 'elevenlabs',
      });
    }

    return results;
  }

  // Fallback for cues with no word data (e.g. a hand-typed cue): divide the
  // cue's own span proportionally. Still bounded by the measured cue, and
  // flagged so the UI can tell the two apart.
  const totalWords = pieces.reduce((sum, piece) => sum + piece.split(/\s+/).filter(Boolean).length, 0) || 1;
  let cursorTime = start;

  return pieces.map((piece, index) => {
    const weight = piece.split(/\s+/).filter(Boolean).length / totalWords;
    const pieceStart = cursorTime;
    const pieceEnd = index === pieces.length - 1 ? end : Math.min(end, cursorTime + weight * (end - start));
    cursorTime = pieceEnd;

    return {
      id: `${segment.id}-split-${index}`,
      startTime: pieceStart,
      endTime: pieceEnd,
      duration: pieceEnd - pieceStart,
      speaker: segment.speaker,
      textSource: piece,
      textTarget: piece,
      words: [],
      timingSource: 'derived',
    };
  });
};

/** Generates ElevenLabs SSML from the reviewed script and the measured rhythm. */
export const generateSsml = async (
  { script, segments = [], manualDuration, pronunciations = [], language = 'Hindi', file },
  { apiKey, models } = {}
) => {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);

  let rhythmMap = 'TIMING BLUEPRINT (SPEECH VS SILENCE):\n';
  let lastEnd = 0;
  for (const segment of sorted) {
    const gap = segment.startTime - lastEnd;
    if (gap >= 0.1) {
      rhythmMap += `(SILENCE: ${gap.toFixed(2)}s) -> REQUIRED <break time="${Math.floor(gap * 1000)}ms"/>\n`;
    } else if (gap > 0.02) {
      rhythmMap += `(MICRO-PAUSE: ${gap.toFixed(2)}s) -> optional tiny break or comma\n`;
    }
    const preview = String(segment.textTarget || '').replace(/\n/g, ' ').slice(0, 60);
    rhythmMap += `[SPEAKING for ${(segment.endTime - segment.startTime).toFixed(2)}s]: "${preview}..."\n`;
    lastEnd = segment.endTime;
  }

  const pronunciationBlock = pronunciations.length
    ? `\nPRONUNCIATION DICTIONARY (mandatory substitutions):\n${pronunciations
        .map((pair) => `- Write "${pair.original}" as "${pair.replacement}"`)
        .join('\n')}\n`
    : '';

  const limit = manualDuration ? `${Number(manualDuration).toFixed(2)}s` : 'the original audio duration';

  const prompt = `You are an audio engineer writing ElevenLabs SSML.

Reproduce the performance structure described by the timing blueprint below.

HARD DURATION LIMIT: ${limit} — the generated audio must not exceed it.

${rhythmMap}

RULES
1. Fit each [SPEAKING for X.XXs] block into that duration using <prosody rate="...">: raise the rate for dense text, lower it for sparse text.
2. Insert a <break time="..."/> matching every (SILENCE) entry. If you are short on time, speed up speech before shortening pauses.
3. Preserve the script text exactly. Do not rewrite, add or remove words.
4. Use emotion tags such as [calm], [reflective], [urgent] only where the blueprint supports them.

FORMAT
<speak>
  <voice name="${language}">
    <lang xml:lang="${toBcp47(language)}">
      <prosody rate="105%">First line...</prosody>
      <break time="400ms"/>
    </lang>
  </voice>
</speak>
${pronunciationBlock}
SCRIPT:
"${script}"

Return ONLY the SSML.`;

  const parts = [{ text: prompt }];
  if (file) {
    try {
      parts.unshift(await inlineMedia(file));
    } catch {
      // Too large to attach — the blueprint alone is enough to drive the SSML.
    }
  }

  const { response } = await generateText({
    contents: { role: 'user', parts },
    generationConfig: { temperature: 0.45 },
    models,
    apiKey,
  });

  let ssml = String(response.text || '')
    .replace(/^```(?:xml)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!ssml.includes('<speak>')) ssml = `<speak>${ssml}</speak>`;
  return ssml;
};

/** Quality-checks generated SSML against the measured speech activity. */
export const validateSsml = async ({ ssml, durationLimit, segments = [] }, { apiKey, models } = {}) => {
  const activity = segments.length
    ? segments.map((segment) => `[${segment.startTime.toFixed(2)}-${segment.endTime.toFixed(2)}]`).join(', ')
    : 'No speech-activity data available.';

  const prompt = `You are a QA specialist for ElevenLabs SSML.

Validate the script below against the measured speech activity.

HARD DURATION LIMIT: ${durationLimit ? `${Number(durationLimit).toFixed(2)} seconds` : 'natural flow, no hard limit'}
MEASURED SPEECH ACTIVITY: ${activity}

SCRIPT:
\`\`\`xml
${ssml}
\`\`\`

Estimate the spoken duration from word count and prosody rates, then report problems.

Respond with ONLY this JSON:
{"isValid":<true|false>,"durationStatus":"Safe|Risk of Exceeding|Too Short|Unknown","timingMatch":"Accurate|Misaligned|Not Applicable","issues":["<issue>"]}`;

  const { response } = await generateText({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
    models,
    apiKey,
  });

  const parsed = parseJsonResponse(response.text, 'Gemini validation');
  return {
    isValid: Boolean(parsed.isValid),
    durationStatus: parsed.durationStatus || 'Unknown',
    timingMatch: parsed.timingMatch || 'Not Applicable',
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
  };
};

/** Gemini text-to-speech. Returns a WAV buffer. */
export const synthesizeSpeechGemini = async (
  { text, voiceName = 'Puck', expression = 'Neutral' },
  { apiKey } = {}
) => {
  const clean = String(text || '').trim();
  if (!clean) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const prompt =
    expression && expression.toLowerCase() !== 'neutral'
      ? `Say with a ${expression} tone: ${clean}`
      : clean;

  const client = geminiClient(apiKey);

  let response;
  try {
    response = await client.models.generateContent({
      model: config.gemini.ttsModel,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    });
  } catch (err) {
    throw new ApiError(`Gemini text-to-speech failed: ${err?.message || err}`, {
      status: 502,
      code: 'tts_failed',
      provider: 'gemini',
    });
  }

  const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64) {
    throw new ApiError('Gemini did not return any audio data.', {
      status: 502,
      code: 'tts_empty',
      provider: 'gemini',
    });
  }

  // Gemini TTS returns raw 24 kHz mono PCM; wrap it in a WAV container.
  return pcmToWav(Buffer.from(base64, 'base64'), { sampleRate: 24000, channels: 1 });
};
