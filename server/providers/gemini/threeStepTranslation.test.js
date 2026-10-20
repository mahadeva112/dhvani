import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isThreeStepPrompt,
  supportsThreeStep,
  threeStepLanguages,
  countSyllables,
  formatEnglishSegments,
  stripPaceTags,
  voiceSpeedNote,
  chunkRate,
  extraInstructions,
} from './threeStepTranslation.js';
import { TRANSLATION_PRESETS } from '../../../services/translationPromptPresets.ts';
import { cleanVoiceRate, cleanSpeakerRates, rateForCue, syllableTarget } from './translation.js';

test('the preset marker switches translation to the 3-step pipeline', () => {
  assert.equal(isThreeStepPrompt('#pipeline: 3-step\n# notes'), true);
  assert.equal(isThreeStepPrompt('  # Pipeline : 3-step'), true);
  assert.equal(isThreeStepPrompt('Translate naturally. Mention the 3-step idea.'), false);
  assert.equal(isThreeStepPrompt(''), false);
});

test('the 3-step preset runs the 3-step passes', () => {
  const preset = TRANSLATION_PRESETS.find((p) => p.id === 'three_step');
  assert.ok(preset);
  assert.equal(isThreeStepPrompt(preset.prompt), true);
  assert.equal(extraInstructions(preset.prompt), '');
});

test('every language with prompts has all three steps', () => {
  const languages = threeStepLanguages();
  assert.ok(languages.includes('Hindi'));
  assert.ok(languages.includes('Tamil'));
  assert.equal(languages.length, 11);
  assert.equal(supportsThreeStep('Hindi (हिन्दी)'), true);
  assert.equal(supportsThreeStep('telugu'), true);
  assert.equal(supportsThreeStep('Punjabi'), false);
});

test('syllable counts are close enough for density checks', () => {
  assert.equal(countSyllables('life'), 1);
  assert.equal(countSyllables('contemplative'), 4);
  assert.equal(countSyllables('A little pause and we are back'), 8);
});

test('segments carry duration, gap, availability and density metadata', () => {
  const text = formatEnglishSegments([
    { text: 'Time is life.', duration: 2, gap: 0.5, syllables: 3, rate: 1.5, relativeRate: 1, words: 3 },
    { text: 'No timing here.', duration: 0, gap: 0, syllables: 4, rate: 0, relativeRate: 0, words: 3 },
  ]);
  assert.equal(
    text,
    '[2.000s][0.500s][25%][2.500s] [3] [1.50] [1.00] [3] Time is life.\n\nNo timing here.'
  );
});

test('pace tags from the Step prompts are stripped, keeping the words and line breaks', () => {
  assert.equal(stripPaceTags('[fast]जैसा उसे होना चाहिए![/fast]'), 'जैसा उसे होना चाहिए!');
  assert.equal(stripPaceTags('पहला [fast] दूसरा [/fast]\nतीसरा'), 'पहला दूसरा\nतीसरा');
  assert.equal(stripPaceTags('No tags here.'), 'No tags here.');
});

test("the voice's speed turns each segment's durations into syllable counts", () => {
  const note = voiceSpeedNote('Bengali', 5.08);
  assert.match(note, /about 5\.1 Bengali syllables per second/);
  assert.match(note, /\[Segment duration\] × 5\.1/);
  assert.match(note, /\[Total duration available\] × 5\.1/);
});

test('a cue is sized from its own duration at the voice rate, and only a believable rate is used', () => {
  assert.equal(syllableTarget({ startTime: 10, endTime: 12.5 }, 4.8), 12);
  assert.equal(syllableTarget({ startTime: 3, endTime: 3 }, 4.8), null);
  assert.equal(syllableTarget({ startTime: 0, endTime: 2 }, null), null);
  assert.equal(cleanVoiceRate(5.1), 5.1);
  assert.equal(cleanVoiceRate('4.5'), 4.5);
  assert.equal(cleanVoiceRate(40), null);
  assert.equal(cleanVoiceRate(undefined), null);
});

test("a speaker with a voice of their own is sized at that voice's rate, the rest at the main voice's", () => {
  const speakers = cleanSpeakerRates({ Asha: 4, Ravi: '6', Mohan: 50 });
  assert.deepEqual(speakers, { Asha: 4, Ravi: 6 });
  assert.equal(rateForCue({ speaker: 'Asha' }, 5, speakers), 4);
  assert.equal(rateForCue({ speaker: 'Mohan' }, 5, speakers), 5);
  assert.equal(rateForCue({}, 5, speakers), 5);
});

test("a 3-step chunk gets its speakers' rates weighted by how long each speaks", () => {
  const chunk = [
    { speaker: 'Asha', duration: 3 },
    { speaker: 'Ravi', duration: 1 },
  ];
  assert.equal(chunkRate(chunk, 5, { Asha: 4, Ravi: 8 }), 5);
  assert.equal(chunkRate(chunk, 5, {}), 5);
  assert.equal(chunkRate([], 5, { Asha: 4 }), 5);
});
