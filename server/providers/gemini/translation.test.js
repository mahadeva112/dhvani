import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanVoiceRate, cleanSpeakerRates, rateForCue, syllableTarget, withoutThreeStepNotes } from './translation.js';
import { TRANSLATION_PRESETS, currentPromptChoice, DEFAULT_PROMPT_PRESET_ID } from '../../../services/translationPromptPresets.ts';

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

test('a prompt saved from the removed 3-Step style keeps only the user\'s own lines', () => {
  const saved = '#pipeline: 3-step\n# Runs three passes\n# Keep the first line.\nUse "sadhana", never "practice".';
  assert.equal(withoutThreeStepNotes(saved), 'Use "sadhana", never "practice".');
  assert.equal(withoutThreeStepNotes('#pipeline: 3-step\n# notes only'), '');
  const own = '# Glossary\nKeep Isha in English.';
  assert.equal(withoutThreeStepNotes(own), own);
});

test('the 3-Step style is gone, and a project saved with it moves to the default', () => {
  assert.equal(TRANSLATION_PRESETS.some((p) => p.id === 'three_step' || p.prompt.includes('#pipeline')), false);
  const moved = currentPromptChoice('three_step', '#pipeline: 3-step\n# notes');
  assert.equal(moved.presetId, DEFAULT_PROMPT_PRESET_ID);
  assert.ok(!moved.prompt.includes('#pipeline'));
});
