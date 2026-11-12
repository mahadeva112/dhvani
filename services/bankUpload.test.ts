import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBankAgain } from './bankUpload.ts';

test('a bank sent again is one upload for every caller, and an aborted caller does not cut it off', async () => {
  const puts: { url: string; signal?: AbortSignal | null }[] = [];
  let finish: () => void = () => {};
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    puts.push({ url: String(url), signal: init?.signal });
    return new Promise<Response>((resolve) => {
      finish = () => resolve(new Response(JSON.stringify({ bankId: 'b', samples: 4 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
  }) as typeof fetch;
  const blob = new Blob([new Uint8Array(48)]);
  const first = new AbortController();
  const waitFirst = sendBankAgain('bank-shared-1', blob, { signal: first.signal });
  const waitSecond = sendBankAgain('bank-shared-1', blob);
  first.abort();
  await assert.rejects(waitFirst, { name: 'AbortError' });
  finish();
  assert.deepEqual(await waitSecond, { bankId: 'b', samples: 4 });
  assert.equal(puts.length, 1, 'one upload for both callers');
  assert.ok(!puts[0].signal?.aborted, 'the upload itself was never aborted');
  // Once it is done, a later miss sends it again.
  const again = sendBankAgain('bank-shared-1', blob);
  finish();
  await again;
  assert.equal(puts.length, 2);
});
