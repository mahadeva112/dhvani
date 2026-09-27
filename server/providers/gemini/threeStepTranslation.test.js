import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isThreeStepPrompt,
  supportsThreeStep,
  threeStepLanguages,
  countSyllables,
  formatEnglishSegments,
} from './threeStepTranslation.js';

test('the preset marker switches translation to the 3-step pipeline', () => {
  assert.equal(isThreeStepPrompt('#pipeline: 3-step\n# notes'), true);
  assert.equal(isThreeStepPrompt('  # Pipeline : 3-step'), true);
  assert.equal(isThreeStepPrompt('Translate naturally. Mention the 3-step idea.'), false);
  assert.equal(isThreeStepPrompt(''), false);
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
