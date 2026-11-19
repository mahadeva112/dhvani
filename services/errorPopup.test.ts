import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainError, onErrorReport, reportError, stripMarkup } from './errorPopup.ts';

const apiError = (message: string, fields: Record<string, unknown>) =>
  Object.assign(new Error(message), { name: 'DhvaniApiError', status: 502, details: null, ...fields });

test('a gateway outage reads as a sentence, what it said, and what to do', () => {
  const page =
    '<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]--> <head> <title>ishaal.win | 502: Bad gateway</title> <meta charset="UTF-8" />';
  const report = explainError(
    apiError(`LLM gateway service error (502). This is usually temporary. — ${page}`, { code: 'provider_unavailable', provider: 'llm-gateway' }),
    { title: 'Translation failed', retry: () => {} }
  );
  assert.equal(report.summary, 'LLM gateway service error (502). This is usually temporary.');
  assert.match(report.serverSaid || '', /ishaal\.win \| 502: Bad gateway/);
  assert.doesNotMatch(report.serverSaid || '', /DOCTYPE|</);
  assert.match(report.steps[0], /press Try again/);
  assert.match(report.steps[1], /Change/);
});

test('an ElevenLabs key missing a permission says which one to turn on, and where', () => {
  const report = explainError(
    apiError('Your ElevenLabs key works, but it is not allowed to use Forced Alignment, which this needs.', {
      code: 'key_missing_permission',
      provider: 'ElevenLabs',
      details: { permission: 'forced_alignment', label: 'Forced Alignment' },
    }),
    { title: 'The words could not be found in the take' }
  );
  assert.match(report.steps[0], /Developers → API Keys/);
  assert.match(report.steps[1], /Turn on Forced Alignment/);
});

test('without a retry the steps do not point at a Try again button', () => {
  const report = explainError(apiError('Gemini rate limit reached.', { code: 'rate_limited', provider: 'gemini' }));
  assert.ok(report.steps.every((step) => !/Try again/.test(step)));
});

test('a cancelled request, or one already shown, opens no second popup', () => {
  const seen: string[] = [];
  const stop = onErrorReport((r) => seen.push(r.title));
  const err = apiError('boom', { code: 'provider_error' });
  reportError(err, { title: 'first' });
  reportError(err, { title: 'second' });
  reportError(apiError('stopped', { code: 'cancelled' }));
  stop();
  assert.deepEqual(seen, ['first']);
});

test('plain text passes through stripMarkup unchanged', () => {
  assert.equal(stripMarkup('Gemini returned 3 < 4 items.'), 'Gemini returned 3 < 4 items.');
});

test('the page failing to save to a full drive says so, and keeps what the browser said', () => {
  const report = explainError(new DOMException('Failed to write blobs (IOError)', 'UnknownError'), { title: 'Opening the project failed' });
  assert.match(report.summary, /usually means the drive is full/);
  assert.equal(report.serverSaid, 'Failed to write blobs (IOError)');
  assert.match(report.steps[0], /Free a few GB/);
  assert.match(report.details, /code: disk_full/);
});

test('a disk_full error from the app names the drive in its steps', () => {
  const err = Object.assign(new Error("This computer's drive (C:) is almost full (0.4 GB free), so DHVANI could not save the audio."), {
    name: 'DhvaniApiError',
    code: 'disk_full',
    details: { drive: 'C:' },
  });
  const report = explainError(err);
  assert.match(report.summary, /\(C:\) is almost full/);
  assert.match(report.steps[0], /on drive C:/);
});

test('other errors are not taken for a full drive', () => {
  assert.equal(explainError(new Error('Failed to fetch')).steps[0], 'Try again.');
});
