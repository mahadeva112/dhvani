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

test('a checkpoint is read back only for the same translation, and old ones are pruned', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { saveCheckpoint, loadCheckpoint, pruneCheckpoints, translationFingerprint } = await import('./translationJobs.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-tr-'));
  try {
    const fingerprint = translationFingerprint({ cues: [{ id: 'c1', text: 'hello' }], targetLanguage: 'Hindi' });
    saveCheckpoint('tr-check-001', fingerprint, { translations: new Map([['c1', 'नमस्ते']]), terms: [], modelUsed: 'm' }, dir);

    assert.deepEqual(loadCheckpoint('tr-check-001', fingerprint, dir).translations, { c1: 'नमस्ते' });
    const other = translationFingerprint({ cues: [{ id: 'c1', text: 'hello' }], targetLanguage: 'Bengali' });
    assert.equal(loadCheckpoint('tr-check-001', other, dir), null, 'another language never resumes from it');
    assert.equal(loadCheckpoint('tr-none-0001', fingerprint, dir), null);

    pruneCheckpoints(dir, Date.now() + 2 * 24 * 60 * 60_000);
    assert.equal(loadCheckpoint('tr-check-001', fingerprint, dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
