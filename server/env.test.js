import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Every variable these tests reason about, blanked unless a test sets one.
 *
 * `env.js` loads the project's own `.env` when it is imported, so without this
 * the result would depend on whatever the developer running the suite happens
 * to have configured. dotenv never overwrites a name already present in
 * process.env, and `str()` reads an empty value as unset — so an empty string
 * is what reliably means "not configured" here.
 */
const RELEVANT = [
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_BASE_URL',
  'ELEVENLABS_STT_MODEL',
  'ELEVENLABS_TTS_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_TRANSLATION_MODELS',
  'GEMINI_TTS_MODEL',
  'LLM_GATEWAY_URL',
  'LLM_GATEWAY_KEY',
  'LLM_GATEWAY_PROTOCOL',
  'LLM_GATEWAY_MODELS',
];

/**
 * Settings saved from the app, and how they relate to the environment.
 *
 * Each test gets its own config directory and its own module instance, because
 * `env.js` reads the config file once at import and the whole point of these
 * tests is what that file does to the values around it.
 */
const withEnv = async (vars, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhvani-env-'));
  const previous = { ...process.env };

  process.env.DHVANI_CONFIG_DIR = dir;
  for (const name of RELEVANT) process.env[name] = '';
  Object.assign(process.env, vars);

  try {
    const env = await import(`./env.js?cfg=${encodeURIComponent(dir)}`);
    await run(env, dir);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('a setting saved in the app wins over the environment', async () => {
  /*
   * DHVANI is installed per person. If `.env` won, the build someone was handed
   * would keep running on whatever keys shipped inside it and the settings
   * screen could only say so — not fix it.
   */
  await withEnv(
    {
      ELEVENLABS_API_KEY: 'sk_from_env',
      ELEVENLABS_STT_MODEL: 'scribe_v1_experimental',
      GEMINI_TRANSLATION_MODELS: 'gemini-2.0-flash',
    },
    async (env) => {
      assert.equal(env.config.elevenlabs.apiKey, 'sk_from_env', 'the environment seeds a fresh install');
      assert.equal(env.keySource().elevenLabs, 'env');

      await env.saveStoredKeys({
        elevenLabsApiKey: 'sk_mine',
        elevenLabsSttModel: 'scribe_v1',
        geminiTranslationModels: 'gemini-2.5-flash, gemini-2.5-pro',
      });

      assert.equal(env.config.elevenlabs.apiKey, 'sk_mine', 'what the user entered takes over');
      assert.equal(env.config.elevenlabs.sttModel, 'scribe_v1');
      assert.deepEqual(env.config.gemini.translationModels, ['gemini-2.5-flash', 'gemini-2.5-pro']);
      assert.equal(env.keySource().elevenLabs, 'saved');
      assert.equal(env.serverSettings().origins.elevenLabsSttModel, 'saved');
    }
  );
});

test('clearing a field falls back, but a blank secret is left alone', async () => {
  /*
   * The form shows endpoints and model names pre-filled, so emptying one is a
   * deliberate reset. It cannot show a key, so its field opens blank — and a
   * blank there has to mean "keep what is stored", or editing an endpoint
   * would wipe the credential beside it.
   */
  await withEnv({ ELEVENLABS_API_KEY: 'sk_from_env', ELEVENLABS_STT_MODEL: 'scribe_v1_experimental' }, async (env) => {
    await env.saveStoredKeys({ elevenLabsApiKey: 'sk_mine', elevenLabsSttModel: 'scribe_v1' });

    await env.saveStoredKeys({ elevenLabsSttModel: '', elevenLabsApiKey: '' });

    assert.equal(env.config.elevenlabs.sttModel, 'scribe_v1_experimental', 'the model fell back to .env');
    assert.equal(env.serverSettings().origins.elevenLabsSttModel, 'env');
    assert.equal(env.config.elevenlabs.apiKey, 'sk_mine', 'the blank key field changed nothing');

    // Clearing every stored field hands the app back to its defaults.
    await env.saveStoredKeys(Object.fromEntries(env.STORED_FIELDS.map((field) => [field, null])));
    assert.equal(env.config.elevenlabs.apiKey, 'sk_from_env');
    assert.equal(env.keySource().elevenLabs, 'env');
  });
});

test('a base URL entered as a bare host gets the API version path', async () => {
  // People paste `https://api.elevenlabs.io` as readily as the full /v1 form.
  await withEnv({}, async (env) => {
    await env.saveStoredKeys({ elevenLabsBaseUrl: 'https://proxy.example.com/' });
    assert.equal(env.config.elevenlabs.baseUrl, 'https://proxy.example.com/v1');

    // A path that was typed deliberately is left exactly as it is.
    await env.saveStoredKeys({ elevenLabsBaseUrl: 'https://proxy.example.com/elevenlabs/v1/' });
    assert.equal(env.config.elevenlabs.baseUrl, 'https://proxy.example.com/elevenlabs/v1');

    // Gemini's SDK wants the origin only, so no path is invented there.
    await env.saveStoredKeys({ geminiBaseUrl: 'https://gemini.example.com/' });
    assert.equal(env.config.gemini.baseUrl, 'https://gemini.example.com');
  });
});

test('the defaults stand when nothing is saved or set', async () => {
  await withEnv({}, async (env) => {
    assert.equal(env.config.elevenlabs.baseUrl, 'https://api.elevenlabs.io/v1');
    assert.equal(env.config.elevenlabs.sttModel, 'scribe_v1');
    assert.equal(env.config.gemini.baseUrl, '', 'blank means Google\'s own endpoint');
    assert.equal(env.serverSettings().origins.elevenLabsBaseUrl, 'default');
    assert.equal(env.keySource().gateway, 'none');
  });
});
