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

test('a restricted ElevenLabs key missing one permission is told apart from a bad key, and names it', () => {
  const err = fromProviderResponse('ElevenLabs', 401, {
    detail: { status: 'missing_permissions', message: 'The API key you used is missing the permission forced_alignment to execute this operation.' },
  });
  assert.equal(err.code, 'key_missing_permission');
  assert.equal(err.status, 403);
  assert.equal(err.details.permission, 'forced_alignment');
  assert.equal(err.details.label, 'Forced Alignment');
  assert.match(err.message, /key works, but it is not allowed to use Forced Alignment/);
  const stt = fromProviderResponse('ElevenLabs', 401, { detail: { message: 'The API key you used is missing the permission speech_to_text to execute this operation.' } });
  assert.equal(stt.details.label, 'Speech to Text');
  const unnamed = fromProviderResponse('ElevenLabs', 401, { detail: { status: 'missing_permissions', message: 'Not allowed.' } });
  assert.equal(unnamed.code, 'key_missing_permission');
  assert.match(unnamed.message, /not allowed to use this feature/);
});

test('an HTML error page from a proxy becomes its title, not markup', () => {
  const page =
    '<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]--> ' +
    '<head> <title>ishaal.win | 502: Bad gateway</title> <meta charset="UTF-8" /></head><body>x</body></html>';
  const error = fromProviderResponse('LLM gateway', 502, { message: page });
  assert.equal(error.code, 'provider_unavailable');
  assert.doesNotMatch(error.message, /<|DOCTYPE/);
  assert.match(error.message, /ishaal\.win \| 502: Bad gateway/);
});

test("a gateway's own upstream key being refused is not read as a bad user key", () => {
  const message =
    'litellm.AuthenticationError: GeminiException - { "error": { "code": 400, "message": "API key not valid.", ' +
    '"status": "INVALID_ARGUMENT", "details": [ { "reason": "API_KEY_INVALID", "domain": "googleapis.com" } ] } }. ' +
    'Received Model Group=gemini-2.5-flash Available Model Group Fallbacks=None';
  const err = fromProviderResponse('LLM gateway', 401, { error: { message, type: 'auth_error' } });

  assert.equal(err.code, 'upstream_key_invalid');
  assert.equal(err.details.upstream, 'Google');
  assert.equal(err.details.model, 'gemini-2.5-flash');
  assert.match(err.message, /Your key is fine/);

  // The proxy refusing the user's own token stays a bad key.
  const own = fromProviderResponse('LLM gateway', 401, {
    error: { message: 'Authentication Error, Invalid proxy server token passed.', type: 'auth_error' },
  });
  assert.equal(own.code, 'invalid_api_key');
});
