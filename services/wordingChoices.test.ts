import test from 'node:test';
import assert from 'node:assert/strict';

// A plain in-memory localStorage, as the app's renderer has.
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
};

const { rememberChoice, choicesFor, MAX_EXAMPLES } = await import('./wordingChoices.ts');

test('a project keeps the wordings its user chose, and a request for a line gets the latest others', () => {
  memory.clear();
  for (let i = 0; i < 8; i++) rememberChoice('job-1', { from: `line ${i}`, to: `wording ${i}` });
  rememberChoice('job-2', { from: 'other', to: 'project' });
  const examples = choicesFor('job-1', 'line 7');
  assert.equal(examples.length, MAX_EXAMPLES);
  // Never the line being asked for, and the newest choices last.
  assert.ok(examples.every((e) => e.from !== 'line 7'));
  assert.deepEqual(examples.at(-1), { from: 'line 6', to: 'wording 6' });
  assert.deepEqual(choicesFor('job-2', 'x'), [{ from: 'other', to: 'project' }]);
});

test('a line changed again replaces its earlier choice; no change, or no project, is not kept', () => {
  memory.clear();
  rememberChoice('job', { from: 'a line', to: 'first' });
  rememberChoice('job', { from: 'a line', to: 'second' });
  rememberChoice('job', { from: 'same', to: 'same' });
  rememberChoice(null, { from: 'x', to: 'y' });
  assert.deepEqual(choicesFor('job', 'z'), [{ from: 'a line', to: 'second' }]);
  assert.deepEqual(choicesFor(null, 'z'), []);
});
