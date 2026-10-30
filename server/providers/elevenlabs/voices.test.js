import test from 'node:test';
import assert from 'node:assert/strict';
import { getVoices } from './speech.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('getVoices pages through /v2/voices and sorts by name', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).includes('next_page_token=t1')
      ? json({ voices: [{ voice_id: 'a', name: 'Anna' }], has_more: false, next_page_token: null })
      : json({ voices: [{ voice_id: 'z', name: 'Zed' }], has_more: true, next_page_token: 't1' });
  };
  const voices = await getVoices({ apiKey: 'k' });
  assert.deepEqual(voices.map((v) => v.name), ['Anna', 'Zed']);
  assert.ok(urls.every((u) => u.includes('/v2/voices?')), urls.join('\n'));
});

test('getVoices falls back to /v1/voices when /v2 is unavailable', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('/v2/voices')
      ? json({ detail: { message: 'nope' } }, 404)
      : json({ voices: [{ voice_id: 'b', name: 'Bela' }] });
  const voices = await getVoices({ apiKey: 'k' });
  assert.deepEqual(voices.map((v) => v.voice_id), ['b']);
});

test('a candidate key is probed even when another key is already stored', async () => {
  const { config } = await import('../../env.js');
  const { getUser } = await import('./speech.js');
  const saved = Object.getOwnPropertyDescriptor(config.elevenlabs, 'apiKey');
  Object.defineProperty(config.elevenlabs, 'apiKey', { get: () => 'sk_old', configurable: true });
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(init.headers['xi-api-key']);
    return json({ subscription: { tier: 'enterprise' } });
  };
  try {
    await getUser({ apiKey: 'sk_new', candidate: true });
    await getUser({ apiKey: 'sk_new' });
    assert.deepEqual(sent, ['sk_new', 'sk_old']);
  } finally {
    Object.defineProperty(config.elevenlabs, 'apiKey', saved);
  }
});
