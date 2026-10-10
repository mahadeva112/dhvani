import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { syncRouter } from './sync.js';
import { pcmToWav } from '../lib/wav.js';

test('waveform alignment endpoint validates bank ranges, caches word times and rejects mismatched speech', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', syncRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const fetchLocal = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith('/forced-alignment'), 'no voice generation or other provider request');
    calls++;
    return Response.json({ words: [{ text: 'one', start: 0.1, end: 0.4 }, { text: 'two', start: 0.5, end: 0.8 }] });
  };
  const post = body => fetchLocal(`${local}/api/sync/takes/words`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-elevenlabs-key': 'test-only' }, body: JSON.stringify(body),
  });
  try {
    const line = { bankStart: 0, length: 8000, text: 'one two' };
    const missing = await post({ bankId: 'range-test-bank', line });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'edit_bank_missing');
    const uploaded = await fetchLocal(`${local}/api/sync/edit/banks/range-test-bank`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: pcmToWav(Buffer.alloc(16000), { sampleRate: 8000 }) });
    assert.equal(uploaded.status, 200);
    assert.equal((await post({ bankId: 'range-test-bank', line: { ...line, length: 9000 } })).status, 400);
    const first = await post({ bankId: 'range-test-bank', line });
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).words, [{ index: 0, text: 'one', start: 0.1, end: 0.4 }, { index: 1, text: 'two', start: 0.5, end: 0.8 }]);
    assert.equal((await post({ bankId: 'range-test-bank', line })).status, 200);
    assert.equal(calls, 1, 'reselecting the same audio/text reuses alignment');
    assert.equal((await post({ bankId: 'range-test-bank', line: { ...line, text: 'different words' } })).status, 422);
  } finally {
    globalThis.fetch = fetchLocal;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
