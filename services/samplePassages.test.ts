import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_PASSAGES, samplePassage } from './samplePassages.ts';
import { syllableRate, timeLine } from './speechTiming.ts';

test('every sample passage is a short read with pauses, counted in believable syllables', () => {
  for (const [language, text] of Object.entries(SAMPLE_PASSAGES)) {
    const { syllables } = timeLine(text, 1);
    assert.ok(text.length <= 600, `${language} is short enough to send`);
    assert.ok(syllables >= 45 && syllables <= 120, `${language}: ${syllables} syllables`);
    assert.ok(/[,،]/.test(text), `${language} has a comma`);
    // Read at a typical 14 characters a second, the rate lands well inside the believable range.
    const rate = syllableRate([text], 14);
    assert.ok(rate > 2.5 && rate < 9, `${language}: ${rate.toFixed(2)} syllables/s`);
  }
});

test('a dub language with no sample has none to read', () => {
  assert.equal(samplePassage('Bengali'), SAMPLE_PASSAGES.Bengali);
  assert.equal(samplePassage('Santali'), null);
});
