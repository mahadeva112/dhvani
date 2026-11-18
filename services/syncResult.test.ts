import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitSyncResult } from './syncResult.ts';
import { DhvaniApiError } from './apiClient.ts';

const lost = new DhvaniApiError('Could not reach the local DHVANI backend: Failed to fetch.', { code: 'backend_unreachable' });
const noWait = async () => {};

test('a sync that lost its connection picks up the answer once the engine finishes it', async () => {
  const answers: unknown[] = [{ running: true }, { running: true }, { audioId: 'a1', report: {} }];
  const paths: string[] = [];
  const result = await awaitSyncResult('job-12345678', lost, {
    wait: noWait,
    get: async (path) => {
      paths.push(path);
      return answers.shift() as any;
    },
  });
  assert.deepEqual(result, { audioId: 'a1', report: {} });
  assert.equal(paths[0], '/sync/jobs/job-12345678/result');
  assert.equal(paths.length, 3);
});

test("the run's own error comes back as it is", async () => {
  await assert.rejects(
    awaitSyncResult('job-12345678', lost, {
      wait: noWait,
      get: async () => {
        throw new DhvaniApiError('Quota exceeded', { code: 'quota_exceeded', status: 402 });
      },
    }),
    (err: unknown) => err instanceof DhvaniApiError && err.code === 'quota_exceeded'
  );
});

test('an engine that no longer knows the run gives the original connection error', async () => {
  await assert.rejects(
    awaitSyncResult('job-12345678', lost, {
      wait: noWait,
      get: async () => {
        throw new DhvaniApiError('No sync with that id is running.', { code: 'sync_not_found', status: 404 });
      },
    }),
    (err: unknown) => err === lost
  );
});

test('a short blip while waiting is ridden out; an engine gone for good gives up', async () => {
  let calls = 0;
  const result = await awaitSyncResult('job-12345678', lost, {
    wait: noWait,
    get: async () => {
      calls += 1;
      if (calls < 3) throw new DhvaniApiError('down', { code: 'backend_unreachable' });
      return { audioId: 'a2' } as any;
    },
  });
  assert.deepEqual(result, { audioId: 'a2' });

  await assert.rejects(
    awaitSyncResult('job-12345678', lost, {
      wait: noWait,
      unreachableMs: -1,
      get: async () => {
        throw new DhvaniApiError('down', { code: 'backend_unreachable' });
      },
    }),
    (err: unknown) => err === lost
  );
});

test('a cancelled wait stops at once', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(awaitSyncResult('job-12345678', lost, { signal: controller.signal, wait: noWait, get: async () => ({ running: true }) as any }));
});
