import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiGet, apiJson, DhvaniApiError } from './apiClient.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * Stands in for the backend: `request` answers the call under test, `health`
 * answers /api/health. Each is called with how many times it was hit before.
 */
const fakeBackend = (
  request: (n: number) => Response | Promise<Response>,
  health: (n: number) => Response | Promise<Response>
) => {
  const hits = { request: 0, health: 0 };
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('/health')) return health(hits.health++);
    return request(hits.request++);
  }) as typeof fetch;
  return hits;
};

const refused = () => Promise.reject(new TypeError('Failed to fetch'));

test('a request cut off by a backend restart is sent again once the new backend answers', async () => {
  const hits = fakeBackend(
    (n) => (n === 0 ? refused() : json({ done: true })),
    (n) => (n === 0 ? refused() : json({ ok: true, startedAt: Date.now() }))
  );
  assert.deepEqual(await apiJson('/sync', { body: {} }), { done: true });
  assert.equal(hits.request, 2);
});

test('an older backend without startedAt still counts as restarted once it was seen gone', async () => {
  const hits = fakeBackend(
    (n) => (n === 0 ? refused() : json({ done: true })),
    (n) => (n === 0 ? refused() : json({ ok: true }))
  );
  assert.deepEqual(await apiJson('/sync', { body: {} }), { done: true });
  assert.equal(hits.request, 2);
});

test('a backend that was up all along is not sent the request again', async () => {
  const hits = fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() - 60_000 }));
  await assert.rejects(apiJson('/sync', { body: {} }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'backend_unreachable');
  assert.equal(hits.request, 1);
});

test('polls that opt out fail at once, without waiting for the backend', async () => {
  const hits = fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() }));
  await assert.rejects(apiGet('/sync/jobs/x', { retry: false }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'backend_unreachable');
  assert.equal(hits.request, 1);
  assert.equal(hits.health, 0);
});

test('a cancelled request does not wait for the backend', async () => {
  const controller = new AbortController();
  controller.abort();
  const hits = fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() }));
  await assert.rejects(apiJson('/sync', { body: {}, signal: controller.signal }));
  assert.equal(hits.health, 0);
});

test('provider errors are not retried', async () => {
  const hits = fakeBackend(
    () => new Response(JSON.stringify({ error: { message: 'Quota exceeded', code: 'quota_exceeded' } }), { status: 429 }),
    () => json({ ok: true, startedAt: Date.now() })
  );
  await assert.rejects(apiJson('/sync', { body: {} }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'quota_exceeded');
  assert.equal(hits.request, 1);
});
