import test from 'node:test';
import assert from 'node:assert/strict';
import { startTranslationJob, updateTranslationJob, finishTranslationJob, getTranslationJob } from './translationJobs.js';

test('a translation job keeps its progress and then its result for a later ask', () => {
  assert.ok(startTranslationJob('tr-test-done'));
  updateTranslationJob('tr-test-done', { type: 'progress', batch: 2, batchCount: 5 });
  assert.deepEqual(getTranslationJob('tr-test-done'), {
    state: 'running',
    progress: { type: 'progress', batch: 2, batchCount: 5 },
    result: null,
    error: null,
  });

  finishTranslationJob('tr-test-done', { result: { type: 'result', cues: [] } });
  const job = getTranslationJob('tr-test-done');
  assert.equal(job.state, 'done');
  assert.deepEqual(job.result, { type: 'result', cues: [] });
});

test('a failed translation job keeps its error', () => {
  startTranslationJob('tr-test-failed');
  finishTranslationJob('tr-test-failed', { error: { message: 'gateway down', code: 'provider_unavailable' } });
  const job = getTranslationJob('tr-test-failed');
  assert.equal(job.state, 'failed');
  assert.equal(job.error.code, 'provider_unavailable');
});

test('no id, a malformed id or an unknown id makes no job', () => {
  assert.equal(startTranslationJob(undefined), null);
  assert.equal(startTranslationJob('bad id!'), null);
  assert.equal(getTranslationJob('tr-never-started'), null);
});
