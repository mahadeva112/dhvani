import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGatewayUrl, candidateBases, isLocalGateway, isInsecureRemote, rankModels } from './url.js';

test('a pasted URL is cleaned of trailing slashes and endpoint paths', () => {
  assert.equal(cleanGatewayUrl('http://172.18.1.17:14005'), 'http://172.18.1.17:14005');
  assert.equal(cleanGatewayUrl('http://172.18.1.17:14005/'), 'http://172.18.1.17:14005');
  assert.equal(cleanGatewayUrl('  http://172.18.1.17:14005/v1/  '), 'http://172.18.1.17:14005/v1');
  assert.equal(
    cleanGatewayUrl('http://172.18.1.17:14005/v1/chat/completions'),
    'http://172.18.1.17:14005/v1'
  );
  assert.equal(cleanGatewayUrl('https://gw.example.com/v1/models'), 'https://gw.example.com/v1');
});

test('a bare host:port is tried with /v1 first, then as given', () => {
  assert.deepEqual(candidateBases('http://172.18.1.17:14005'), [
    'http://172.18.1.17:14005/v1',
    'http://172.18.1.17:14005',
  ]);
});

test('a URL that already ends in /v1 is never doubled', () => {
  const bases = candidateBases('http://172.18.1.17:14005/v1');
  assert.equal(bases[0], 'http://172.18.1.17:14005/v1');
  assert.ok(!bases.some((base) => base.includes('/v1/v1')), 'no /v1/v1 anywhere');
});

test('the Gemini protocol probes /v1beta rather than /v1', () => {
  assert.deepEqual(candidateBases('https://proxy.example.com', 'gemini'), [
    'https://proxy.example.com/v1beta',
    'https://proxy.example.com',
  ]);
});

test('private and loopback addresses count as local', () => {
  for (const url of [
    'http://localhost:4000',
    'http://127.0.0.1:8000',
    'http://10.1.2.3:4000',
    'http://172.18.1.17:14005',
    'http://172.31.255.1:4000',
    'http://192.168.1.50:4000',
    'http://gateway.local:4000',
    'http://[::1]:4000',
  ]) {
    assert.equal(isLocalGateway(url), true, `${url} should be local`);
  }
});

test('public addresses do not count as local', () => {
  for (const url of [
    'https://api.openai.com/v1',
    'http://172.15.0.1:4000', // just outside 172.16/12
    'http://172.32.0.1:4000', // just outside 172.16/12
    'https://gateway.example.com',
    'http://8.8.8.8:4000',
  ]) {
    assert.equal(isLocalGateway(url), false, `${url} should not be local`);
  }
});

test('plain HTTP to a public host is flagged, but a private one is not', () => {
  assert.equal(isInsecureRemote('http://gateway.example.com/v1'), true);
  assert.equal(isInsecureRemote('https://gateway.example.com/v1'), false);
  assert.equal(isInsecureRemote('http://172.18.1.17:14005'), false);
});

test('model ranking prefers a current Gemini chat model', () => {
  const ranked = rankModels([
    'text-embedding-004',
    'vertex_ai/gemini-3.1-pro-preview',
    'gpt-4o-mini',
    'vertex_ai/gemini-2.5-flash',
    'whisper-1',
  ]);

  assert.ok(!ranked.includes('text-embedding-004'), 'embeddings are excluded');
  assert.ok(!ranked.includes('whisper-1'), 'speech models are excluded');
  assert.match(ranked[0], /gemini/, 'a Gemini model ranks first');
});

test('LiteLLM provider-prefixed names survive ranking intact', () => {
  const ranked = rankModels(['vertex_ai/gemini-3.1-pro-preview', 'openai/gpt-4o']);
  assert.ok(ranked.includes('vertex_ai/gemini-3.1-pro-preview'), 'prefix is preserved verbatim');
});

test('an empty or junk URL yields no candidates rather than throwing', () => {
  assert.deepEqual(candidateBases(''), []);
  assert.deepEqual(candidateBases('   '), []);
  assert.equal(isLocalGateway('not a url'), false);
});

test('a keyless local gateway counts as configured', async () => {
  // A working keyless LiteLLM instance must not be saved and then left
  // inactive because no bearer token was supplied.
  const { isGatewayUsable } = await import('../../env.js');

  assert.equal(isGatewayUsable('http://172.18.1.17:14005/v1', ''), true);
  assert.equal(isGatewayUsable('http://localhost:4000/v1', ''), true);
  assert.equal(isGatewayUsable('http://127.0.0.1:14005', ''), true);

  // A gateway out on the internet still needs authentication.
  assert.equal(isGatewayUsable('https://gateway.example.com/v1', ''), false);
  assert.equal(isGatewayUsable('https://gateway.example.com/v1', 'sk-x'), true);

  // No URL means no gateway, key or not.
  assert.equal(isGatewayUsable('', 'sk-x'), false);
  assert.equal(isGatewayUsable(undefined, undefined), false);
});

test('a blank key leaves a stored one alone; null clears it', async () => {
  // The settings form starts with blank key fields because a stored secret is
  // never sent back. Treating blank as "clear" wiped working credentials.
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-cfg-'));
  process.env.DHVANI_CONFIG_DIR = dir;

  // A fresh module instance so it picks up the temp config directory.
  const env = await import(`../../env.js?cfg=${encodeURIComponent(dir)}`);

  try {
    await env.saveStoredKeys({ elevenLabsApiKey: 'sk_original', llmGatewayKey: 'sk-gateway' });

    // Changing only the URL, with blank key fields, must not disturb the keys.
    await env.saveStoredKeys({ llmGatewayUrl: 'http://10.0.0.5:4000/v1', llmGatewayKey: '' });

    let saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(saved.elevenLabsApiKey, 'sk_original', 'untouched field survives');
    assert.equal(saved.llmGatewayKey, 'sk-gateway', 'blank did not wipe the key');
    assert.equal(saved.llmGatewayUrl, 'http://10.0.0.5:4000/v1', 'the URL did change');

    // null is the explicit clear.
    await env.saveStoredKeys({ llmGatewayKey: null });
    saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(saved.llmGatewayKey, undefined, 'null clears it');
    assert.equal(saved.elevenLabsApiKey, 'sk_original', 'and only it');
  } finally {
    delete process.env.DHVANI_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a model the gateway lists twice appears once', () => {
  // LiteLLM lists a name once per deployment, so duplicates are normal.
  const ranked = rankModels([
    'anthropic/claude-sonnet-4-5',
    'gemini-2.5-flash',
    'anthropic/claude-sonnet-4-5',
  ]);

  assert.equal(ranked.length, 2, 'the duplicate is collapsed');
  assert.equal(ranked.filter((m) => m === 'anthropic/claude-sonnet-4-5').length, 1);
});
