import test from 'node:test';
import assert from 'node:assert/strict';
import { registerProvider } from '../providers/index.js';
import { runSubtitlePipeline } from './pipeline.js';
import { buildCuesFromWords, parseSrt } from './srt.js';

/**
 * End-to-end pipeline behaviour, with the two network providers stubbed.
 *
 * The property under test is the one that matters most: whatever the translator
 * does, the exported timestamps are exactly the ones the transcriber measured.
 */

const WORDS = [
  { text: 'Time', start: 0.2, end: 0.55, type: 'word' },
  { text: 'is', start: 0.58, end: 0.71, type: 'word' },
  { text: 'not', start: 0.74, end: 1.02, type: 'word' },
  { text: 'money.', start: 1.05, end: 1.61, type: 'word' },
  { text: 'Time', start: 3.4, end: 3.78, type: 'word' },
  { text: 'is', start: 3.81, end: 3.95, type: 'word' },
  { text: 'life.', start: 3.98, end: 4.52, type: 'word' },
];

const stubTranscriber = () => ({
  label: 'Stub Scribe',
  providesWordTimestamps: true,
  isConfigured: () => true,
  transcribe: async () => ({
    text: 'Time is not money. Time is life.',
    languageCode: 'eng',
    languageName: 'English',
    languageProbability: 0.99,
    words: WORDS,
    cues: buildCuesFromWords(WORDS),
    duration: 5,
    audioExtracted: false,
  }),
});

const fakeFile = { originalname: 'talk.mp3', mimetype: 'audio/mpeg', path: 'unused' };

const timingsOf = (srt) => parseSrt(srt).map((cue) => [cue.startTime, cue.endTime]);

test('translated SRT carries the transcriber timestamps verbatim', async () => {
  registerProvider('transcription', 'stub', stubTranscriber());
  registerProvider('translation', 'stub-good', {
    label: 'Stub translator',
    isConfigured: () => true,
    translate: async (cues) => ({
      translations: new Map(cues.map((cue) => [String(cue.id), `HI:${cue.text}`])),
      modelUsed: 'stub-model',
      translatedCount: cues.length,
      missingIds: [],
      failedBatches: 0,
    }),
  });

  const result = await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'Hindi',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-good',
  });

  assert.equal(result.detectedLanguage, 'English');
  assert.equal(result.cues.length, 2);
  assert.equal(result.translationWarning, null);

  assert.deepEqual(timingsOf(result.translatedSrt), timingsOf(result.originalSrt));
  assert.deepEqual(timingsOf(result.originalSrt), [
    [0.2, 1.61],
    [3.4, 4.52],
  ]);

  assert.match(result.translatedSrt, /HI:Time is not money\./);
  assert.match(result.originalSrt, /Time is not money\./);
  assert.doesNotMatch(result.originalSrt, /HI:/);
});

test('a translator that returns bogus timings cannot corrupt the SRT', async () => {
  registerProvider('translation', 'stub-hostile', {
    label: 'Hostile translator',
    isConfigured: () => true,
    // Returns only text keyed by id, which is the entire contract. Any timing
    // it tried to emit has nowhere to go.
    translate: async (cues) => ({
      translations: new Map(
        cues.map((cue) => [String(cue.id), '00:00:99,000 --> 00:01:99,000 garbage'])
      ),
      modelUsed: 'stub-model',
      translatedCount: cues.length,
      missingIds: [],
      failedBatches: 0,
    }),
  });

  const result = await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'Hindi',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-hostile',
  });

  assert.deepEqual(timingsOf(result.translatedSrt), [
    [0.2, 1.61],
    [3.4, 4.52],
  ]);
});

test('a failed translation still returns the transcription and original SRT', async () => {
  registerProvider('translation', 'stub-broken', {
    label: 'Broken translator',
    isConfigured: () => true,
    translate: async () => {
      throw new Error('Gemini quota exhausted');
    },
  });

  const result = await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'Hindi',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-broken',
  });

  assert.equal(result.cues.length, 2, 'transcription survives');
  assert.ok(result.originalSrt.includes('Time is not money.'), 'original SRT survives');
  assert.equal(result.words.length, WORDS.length, 'word timestamps survive');
  assert.match(result.translationWarning, /Gemini quota exhausted/);
  assert.match(result.translationWarning, /timestamps are safe/);
  assert.equal(result.translatedSrt, '', 'no half-written translated SRT');
});

test('cues the translator skips keep their source text and their timing', async () => {
  registerProvider('translation', 'stub-partial', {
    label: 'Partial translator',
    isConfigured: () => true,
    translate: async (cues) => ({
      // Only the first cue comes back.
      translations: new Map([[String(cues[0].id), 'HI:first']]),
      modelUsed: 'stub-model',
      translatedCount: 1,
      missingIds: [String(cues[1].id)],
      failedBatches: 0,
    }),
  });

  const result = await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'Hindi',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-partial',
  });

  const cues = parseSrt(result.translatedSrt);
  assert.equal(cues.length, 2, 'cue count and numbering are preserved');
  assert.equal(cues[0].text, 'HI:first');
  assert.equal(cues[1].text, 'Time is life.', 'untranslated cue falls back to source text');
  assert.deepEqual(timingsOf(result.translatedSrt), timingsOf(result.originalSrt));
  assert.match(result.translationWarning, /could not be translated/);
});

test('matching source and target languages skips translation without re-timing', async () => {
  const result = await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'English',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-good',
  });

  assert.deepEqual(timingsOf(result.translatedSrt), timingsOf(result.originalSrt));
  assert.match(result.translationWarning, /both English/);
  assert.doesNotMatch(result.translatedSrt, /HI:/);
});

test('progress events are emitted in pipeline order', async () => {
  const stages = [];
  await runSubtitlePipeline(fakeFile, {
    targetLanguage: 'Hindi',
    transcriptionProvider: 'stub',
    translationProvider: 'stub-good',
    onProgress: (event) => stages.push(event.stage),
  });

  assert.ok(stages.includes('transcribing'));
  assert.ok(stages.indexOf('transcribed') < stages.indexOf('srt_generated'));
  assert.ok(stages.indexOf('srt_generated') < stages.indexOf('translating'));
  assert.equal(stages.at(-1), 'completed');
});
