import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { syncRouter } from './sync.js';
import { pcmToWav } from '../lib/wav.js';

const RATE = 8000;

/** 16-bit PCM: "one" from 0.3 to 0.6 s and "two" from 1.2 to 1.5 s, silence around and between. */
const voicePcm = () => {
  const pcm = Buffer.alloc(2 * Math.round(1.8 * RATE));
  for (const [from, to] of [[0.3, 0.6], [1.2, 1.5]]) {
    for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i++) pcm.writeInt16LE(Math.round(9000 * Math.sin(i * 0.3)), 2 * i);
  }
  return pcm;
};

test('a retake comes back with its words and where to cut between them, from the voice timing, with no alignment asked for', async () => {
  const app = express();
  app.use(express.json({ limit: '32mb' }));
  app.use('/api', syncRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const fetchLocal = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    asked.push(path.replace(/\?.*$/, ''));
    if (path.includes('/forced-alignment')) throw new Error('no alignment should be asked for');
    if (path.includes('/settings')) return Response.json({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 });
    assert.ok(path.includes('/with-timestamps'), `asked ${path}`);
    // Its timing is a little off, as the voice's is.
    const chars = [...'one two.'];
    const starts = [0.33, 0.43, 0.53, 0.6, 1.25, 1.33, 1.42, 1.48];
    return Response.json({
      audio_base64: voicePcm().toString('base64'),
      alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: starts.map((t) => t + 0.08) },
    });
  };
  try {
    const bank = pcmToWav(voicePcm(), { sampleRate: RATE });
    assert.equal((await fetchLocal(`${local}/api/sync/edit/banks/words-test-bank`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: bank })).status, 200);
    const res = await fetchLocal(`${local}/api/sync/takes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-elevenlabs-key': 'test-only' },
      body: JSON.stringify({
        bankId: 'words-test-bank',
        line: { bankStart: 0, length: Math.round(1.8 * RATE), gain: 1, text: 'one two.', speaker: 'A', readCount: 1 },
        seeds: [7],
        voiceId: 'voice-for-words-test',
        modelId: 'eleven_v4',
        outputFormat: `pcm_${RATE}`,
        join: {},
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    const [take] = body.takes;
    assert.equal(take.words.length, 2);
    assert.equal(take.gaps.length, 1);
    // Seconds into the take as it is in the bank, trimmed to a little before its first sound.
    const first = take.lead;
    assert.ok(Math.abs(take.words[0][0] - first) < 1e-3, `"one" starts on its sound, ${take.words[0][0]} s`);
    assert.ok(take.gaps[0] > take.words[0][1] && take.gaps[0] < take.words[1][0], `cut at ${take.gaps[0]} s, between ${take.words[0][1]} and ${take.words[1][0]}`);
    assert.ok(Math.abs(take.words[1][0] - take.words[0][0] - 0.9) < 0.01, 'the second word starts 0.9 s after the first, as it is said');
    assert.ok(!asked.some((path) => path.includes('forced-alignment')));
  } finally {
    globalThis.fetch = fetchLocal;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
