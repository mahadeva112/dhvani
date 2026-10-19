import test from 'node:test';
import assert from 'node:assert/strict';
import { fromProviderResponse } from './errors.js';

test('ElevenLabs refusing an output format is told apart from a bad key', () => {
  const byStatus = fromProviderResponse('ElevenLabs', 403, {
    detail: { status: 'output_format_not_allowed', message: 'Your subscription does not allow pcm_48000.' },
  });
  assert.equal(byStatus.code, 'output_format_not_allowed');
  const byMessage = fromProviderResponse('ElevenLabs', 400, { detail: 'This output format requires a Pro subscription.' });
  assert.equal(byMessage.code, 'output_format_not_allowed');
  assert.equal(fromProviderResponse('ElevenLabs', 401, { detail: 'Invalid API key' }).code, 'invalid_api_key');
});
