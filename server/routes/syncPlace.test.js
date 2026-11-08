import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { syncRouter } from './sync.js';
import { pcmToWav } from '../lib/wav.js';

const RATE = 8000;

/** 16-bit PCM of a take: "one" from 0.1 to 0.4 s and "two" from 1.4 to 1.7 s, silence around and between. */
const takePcm = () => {
  const pcm = Buffer.alloc(2 * RATE * 2);
  const tone = (from, to) => {
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) pcm.writeInt16LE(Math.round(9000 * Math.sin(i * 0.3)), 2 * i);
  };
  tone(0.1, 0.4);
  tone(1.4, 1.7);
  return pcm;
};

test('a take used in the dub is cut where it goes quiet and placed on the original, aligning only its words', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', syncRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const fetchLocal = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith('/forced-alignment'), 'no voice generation or other provider request');
    calls++;
    return Response.json({ words: [{ text: 'one', start: 0.1, end: 0.4 }, { text: 'two', start: 1.4, end: 1.7 }] });
  };
  const post = (body) =>
    fetchLocal(`${local}/api/sync/takes/place`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-elevenlabs-key': 'test-only' }, body: JSON.stringify(body) });
  // The original says "one", pauses, and says "two" a second later; the lines either side are far off.
  const segments = [
    { id: 1, startTime: 0, endTime: 0.5, textTarget: 'zero.' },
    { id: 2, startTime: 3, endTime: 5, textTarget: 'one two', words: [{ text: 'ONE', start: 3, end: 3.3 }, { text: 'TWO', start: 4.7, end: 5 }] },
    { id: 3, startTime: 8, endTime: 8.5, textTarget: 'three.' },
  ];
  const body = {
    bankId: 'place-test-bank',
    key: '2',
    take: { bankStart: 0, length: 2 * RATE, lead: 0.1, speech: 1.6 },
    segments,
    join: { chunkSync: true },
    tolerance: 0.15,
    sourceDuration: 10,
    prev: { start: 0, end: 0.5 },
    next: { start: 8, end: 8.5 },
  };
  try {
    const missing = await post(body);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'edit_bank_missing');
    const uploaded = await fetchLocal(`${local}/api/sync/edit/banks/place-test-bank`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: pcmToWav(takePcm(), { sampleRate: RATE }) });
    assert.equal(uploaded.status, 200);
    assert.equal((await post({ ...body, take: { ...body.take, length: 3 * RATE } })).status, 400);
    assert.equal((await post({ ...body, key: '9' })).status, 409, 'a line no longer in the script is not placed');

    const placed = await post(body);
    assert.equal(placed.status, 200);
    const { chunks, fits, wordsError } = await placed.json();
    assert.equal(wordsError, null);
    assert.equal(fits, true);
    assert.equal(chunks.length, 2, 'cut at the second of silence between its words');
    // Each word lands on the original's: "one" at 3 s, "two" at 4.7 s.
    const firstWordAt = (chunk, word) => chunk.startSample / RATE + (word - chunk.from / RATE);
    assert.ok(Math.abs(firstWordAt(chunks[0], 0.1) - 3) <= 0.15, `"one" at ${firstWordAt(chunks[0], 0.1)} s`);
    assert.ok(Math.abs(firstWordAt(chunks[1], 1.4) - 4.7) <= 0.15, `"two" at ${firstWordAt(chunks[1], 1.4)} s`);

    assert.equal((await post(body)).status, 200);
    assert.equal(calls, 1, 'the same take is aligned once');
  } finally {
    globalThis.fetch = fetchLocal;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
