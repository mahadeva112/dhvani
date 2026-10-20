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
