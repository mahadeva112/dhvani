import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiGet, apiGetAudio, apiJson, DhvaniApiError } from './apiClient.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * Stands in for the backend: `request` answers the call under test, `health`
 * answers /api/health. Each is called with how many times it was hit before.
 */
const fakeBackend = (
  request: (n: number) => Response | Promise<Response>,
  health: (n: number) => Response | Promise<Response>
) => {
  const hits = { request: 0, health: 0, logged: [] as string[] };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/health')) return health(hits.health++);
    if (String(url).endsWith('/client-log')) {
      hits.logged.push(JSON.parse(String(init?.body)).message);
      return new Response(null, { status: 204 });
    }
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
  assert.match(hits.logged[0], /POST \/api\/sync lost its connection .*the engine had restarted/);
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
  // backend.log says why, so a problem report shows it.
  assert.match(hits.logged[0], /POST \/api\/sync lost its connection after \d+ s \(Failed to fetch\) while the engine was still running/);
});

test('polls that opt out fail at once, without waiting for the backend', async () => {
  const hits = fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() }));
  await assert.rejects(apiGet('/sync/jobs/x', { retry: false }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'backend_unreachable');
  assert.equal(hits.request, 1);
  assert.equal(hits.health, 0);
  assert.deepEqual(hits.logged, []);
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

test('a download that fails at once on a nearly full drive says the drive is full', async () => {
  const disk = { freeBytes: 0.4 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, drive: 'C:', low: true };
  const hits = fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() - 60_000, disk }));
  await assert.rejects(apiGetAudio('/sync/audio/x'), (err: unknown) => {
    assert.ok(err instanceof DhvaniApiError);
    assert.equal(err.code, 'disk_full');
    assert.match(err.message, /drive \(C:\) is almost full \(0\.4 GB free\)/);
    return true;
  });
  assert.match(hits.logged[0], /GET \/api\/sync\/audio\/x lost its connection .*while the engine was still running; the drive C: is almost full \(0\.4 GB free\)/);
});

test('a drive with room keeps the usual unreachable error', async () => {
  const disk = { freeBytes: 80 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, drive: 'C:', low: false };
  fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() - 60_000, disk }));
  await assert.rejects(apiJson('/sync', { body: {} }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'backend_unreachable');
});

test('a JSON request on a nearly full drive keeps backend_unreachable, so Sync recovery still runs', async () => {
  const disk = { freeBytes: 0.4 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, drive: 'C:', low: true };
  fakeBackend(refused, () => json({ ok: true, startedAt: Date.now() - 60_000, disk }));
  await assert.rejects(apiJson('/sync', { body: {} }), (err: unknown) => err instanceof DhvaniApiError && err.code === 'backend_unreachable');
});
