import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedPrompts, upsertSavedPrompt } from './savedTranslationPrompts.ts';
import { currentPromptChoice, DEFAULT_PROMPT_PRESET_ID, SAVED_PROMPT_ID_PREFIX } from './translationPromptPresets.ts';

test("a saved prompt is kept as saved, whatever the built-in styles are", () => {
  const id = `${SAVED_PROMPT_ID_PREFIX}abc`;
  assert.deepEqual(currentPromptChoice(id, 'Keep Sanskrit words.'), { presetId: id, prompt: 'Keep Sanskrit words.' });
});

test('a removed built-in style still falls back to the default', () => {
  assert.equal(currentPromptChoice('three_step', 'old text').presetId, DEFAULT_PROMPT_PRESET_ID);
  assert.equal(currentPromptChoice(`${SAVED_PROMPT_ID_PREFIX}abc`, '').presetId, DEFAULT_PROMPT_PRESET_ID, 'a saved id with no text has nothing to keep');
});

test('saving under a name already used writes that prompt again', () => {
  const first = upsertSavedPrompt([], 'Bengali talks', 'one', 1);
  assert.equal(first.replaced, false);
  assert.ok(first.saved.id.startsWith(SAVED_PROMPT_ID_PREFIX));
  const again = upsertSavedPrompt(first.list, '  bengali TALKS ', 'two', 2);
  assert.equal(again.replaced, true);
  assert.equal(again.list.length, 1);
  assert.equal(again.saved.id, first.saved.id);
  assert.equal(again.saved.prompt, 'two');
  const other = upsertSavedPrompt(again.list, 'Hindi', 'three', 3);
  assert.equal(other.list.length, 2);
});

test('stored prompts are read back, dropping anything broken', () => {
  const good = { id: `${SAVED_PROMPT_ID_PREFIX}x`, name: 'Mine', prompt: 'text', savedAt: 1 };
  const raw = JSON.stringify([good, { id: 'sadhguru_spoken', name: 'X', prompt: 'y' }, { id: `${SAVED_PROMPT_ID_PREFIX}y`, name: ' ', prompt: 'z' }, null]);
  assert.deepEqual(parseSavedPrompts(raw), [good]);
  assert.deepEqual(parseSavedPrompts('not json'), []);
  assert.deepEqual(parseSavedPrompts(null), []);
});
