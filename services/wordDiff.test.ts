import test from 'node:test';
import assert from 'node:assert/strict';
import { diffWords } from './wordDiff.ts';

test('diffWords marks the changed words only', () => {
  assert.deepEqual(diffWords('हम सब समझते है।', 'हम सब समझते हैं।'), [
    { text: 'हम सब समझते ', type: 'same' },
    { text: 'हैं', type: 'ins' },
    { text: 'है', type: 'del' },
    { text: '।', type: 'same' },
  ]);
});

test('diffWords shows a changed mark on its own', () => {
  assert.deepEqual(diffWords('क्या तुम आओगे।', 'क्या तुम आओगे?'), [
    { text: 'क्या तुम आओगे', type: 'same' },
    { text: '?', type: 'ins' },
    { text: '।', type: 'del' },
  ]);
});

test('diffWords shows a dropped repeated word', () => {
  const parts = diffWords('मुझको को यह', 'मुझको यह');
  assert.equal(parts.filter((p) => p.type === 'del').map((p) => p.text).join(''), 'को ');
  assert.equal(parts.filter((p) => p.type === 'ins').length, 0);
});
