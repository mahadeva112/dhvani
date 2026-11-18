import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDubJob, finishDubJob, getDubProgress, detachDubJob, dubJobOutcome, cancelDubJob, ORPHAN_MS } from './dubJobs.js';

test('a sync whose connection dropped keeps running while the app still polls it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const job = startDubJob('drop-12345678');
  let orphaned = false;
  assert.equal(detachDubJob('drop-12345678', { onOrphan: () => (orphaned = true) }), true);
  // The app polls every 0.7 s for longer than the orphan window.
  for (let ms = 0; ms < ORPHAN_MS * 3; ms += 700) {
    t.mock.timers.tick(700);
    getDubProgress('drop-12345678');
  }
  assert.equal(job.controller.signal.aborted, false);
  assert.equal(orphaned, false);
  assert.deepEqual(dubJobOutcome('drop-12345678'), { running: true });

  // Its answer is kept for the app to fetch.
  finishDubJob('drop-12345678', 'done', { status: 200, body: { audioId: 'a1' } });
  assert.deepEqual(dubJobOutcome('drop-12345678'), { status: 200, body: { audioId: 'a1' } });
  // Still there well past the usual one-minute grace.
  t.mock.timers.tick(5 * 60_000);
  assert.deepEqual(dubJobOutcome('drop-12345678')?.body, { audioId: 'a1' });
});

test('a sync whose app went quiet is stopped, so no credits go on a closed window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const job = startDubJob('gone-12345678');
  let orphaned = false;
  detachDubJob('gone-12345678', { onOrphan: () => (orphaned = true) });
  t.mock.timers.tick(ORPHAN_MS - 1);
  assert.equal(job.controller.signal.aborted, false);
  t.mock.timers.tick(2);
  assert.equal(job.controller.signal.aborted, true);
  assert.equal(orphaned, true);
});

test('only a running job can be kept after its connection drops', () => {
  assert.equal(detachDubJob('none-12345678'), false);
  startDubJob('stop-12345678');
  cancelDubJob('stop-12345678');
  assert.equal(detachDubJob('stop-12345678'), false);
  startDubJob('over-12345678');
  finishDubJob('over-12345678', 'done', { status: 200, body: {} });
  assert.equal(detachDubJob('over-12345678'), false);
  assert.equal(dubJobOutcome('unknown-12345678'), null);
});

test('a job finished without a dropped connection still answers with its result for the last poll', () => {
  startDubJob('kept-12345678');
  finishDubJob('kept-12345678', 'failed', { status: 402, body: { error: { code: 'quota_exceeded' } } });
  assert.equal(dubJobOutcome('kept-12345678')?.status, 402);
});
