import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { syncRouter, keepResult } from './sync.js';
import { pcmToWav } from '../lib/wav.js';

const listen = async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', syncRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const close = async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { local: `http://127.0.0.1:${server.address().port}`, close };
};

test('kept results over the byte budget drop the oldest, never ones kept in the last minute', async () => {
  const { local, close } = await listen();
  // Counted as 200 MB each without holding that much.
  const big = (text) => Object.defineProperty(Buffer.from(text), 'byteLength', { value: 200 * 1024 * 1024 });
  const get = (id) => fetch(`${local}/api/sync/audio/${id}`);
  try {
    const t = 1_000_000;
    const first = keepResult(big('first'), 'audio/wav', t);
    const second = keepResult(big('second'), 'audio/wav', t + 10_000);
    keepResult(Buffer.from('small'), 'audio/wav', t + 20_000);
    // 400 MB over a 256 MB budget, but all of it from one reply's minute.
    assert.equal(await (await get(first)).text(), 'first');
    const later = keepResult(big('later'), 'audio/wav', t + 120_000);
    assert.equal((await get(second)).status, 404, 'the oldest goes once it is past the minute');
    assert.equal(await (await get(later)).text(), 'later');
  } finally {
    await close();
  }
});

test('edit renders sent together all finish, one at a time, and a failed one does not stop the rest', async () => {
  const { local, close } = await listen();
  const sampleRate = 8000;
  const samples = Buffer.alloc(sampleRate * 2 * 2);
  for (let i = 0; i < samples.length / 2; i++) samples.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), i * 2);
  try {
    const uploaded = await fetch(`${local}/api/sync/edit/banks/render-queue-bank`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: pcmToWav(samples, { sampleRate }) });
    assert.equal(uploaded.status, 200);
    const lines = [{ bankStart: 0, length: sampleRate }, { bankStart: sampleRate, length: sampleRate }];
    const render = (bankId, rate = 1) => fetch(`${local}/api/sync/edit/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bankId, sampleRate, lines, sourceDuration: 3,
        parts: [{ line: 0, from: 0, to: sampleRate, startSample: 0 }, { line: 1, from: 0, to: sampleRate, startSample: sampleRate, rate }],
      }),
    });
    const replies = await Promise.all([render('render-queue-bank'), render('missing-bank-id'), render('render-queue-bank', 1.1), render('render-queue-bank', 0.9)]);
    assert.deepEqual(replies.map(reply => reply.status), [200, 404, 200, 200]);
    assert.equal((await replies[1].json()).error.code, 'edit_bank_missing');
    for (const reply of [replies[0], replies[2], replies[3]]) {
      const { audioId } = await reply.json();
      const audio = await fetch(`${local}/api/sync/audio/${audioId}`);
      assert.equal(audio.status, 200);
      assert.ok((await audio.arrayBuffer()).byteLength > 44);
    }
  } finally {
    await close();
  }
});
