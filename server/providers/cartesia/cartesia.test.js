import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeScript, synthesizeLines, getVoices, toCartesiaOutputFormat, cartesiaEmotionOf } from './speech.js';
import { toCartesiaLanguage, toCartesiaVoiceId, toDhvaniVoiceId } from './client.js';
import { cartesiaSettings } from '../../routes/sync.js';

const LONG_TEXT = 'The mind is restless, but you can watch it without judgement. '.repeat(60);

/** A fake Cartesia that records every request and answers `respond(url, init)`. */
const mockFetch = (respond) => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  return calls;
};

const audio = (bytes = 16000) =>
  new Response(new Uint8Array(bytes).fill(64), { status: 200, headers: { 'content-type': 'audio/pcm' } });

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('app output formats map onto Cartesia output_format objects', () => {
  assert.deepEqual(toCartesiaOutputFormat('mp3_44100_128').body, { container: 'mp3', sample_rate: 44100, bit_rate: 128000 });
  assert.deepEqual(toCartesiaOutputFormat('pcm_16000').body, { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 });
  // Rates Cartesia lacks are rounded to the nearest one it has, and the format says so.
  assert.equal(toCartesiaOutputFormat('mp3_22000_100').format, 'mp3_22050_96');
});

test('language names map to the two-letter codes Cartesia uses', () => {
  assert.equal(toCartesiaLanguage('Hindi'), 'hi');
  assert.equal(toCartesiaLanguage('Tamil'), 'ta');
  assert.equal(toCartesiaLanguage('Auto Detect'), '');
});

test('voice IDs carry a cartesia: prefix everywhere but the Cartesia API itself', () => {
  assert.equal(toDhvaniVoiceId('abc'), 'cartesia:abc');
  assert.equal(toCartesiaVoiceId('cartesia:abc'), 'abc');
  assert.equal(toCartesiaVoiceId('abc'), 'abc');
});

test('a long dub is voiced passage by passage with the right request and joined', async () => {
  const calls = mockFetch(() => audio());
  const updates = [];
  const { buffer, contentType } = await synthesizeScript(
    { voiceId: 'cartesia:voice-1', text: LONG_TEXT, modelId: 'sonic-3.6', outputFormat: 'pcm_16000', language: 'Hindi', voiceSettings: { speed: 3 } },
    { apiKey: 'sk_car_test', onProgress: (p) => updates.push({ ...p }) }
  );

  assert.ok(buffer.length > 0);
  // Joined once into lossless WAV, which a browser can play, not bare PCM.
  assert.equal(contentType, 'audio/wav');
  assert.equal(buffer.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.ok(calls.length > 1, 'the long script is split into passages');

  const { url, init } = calls[0];
  assert.match(url, /\/tts\/bytes$/);
  assert.match(init.headers.Authorization, /^Bearer /);
  assert.ok(init.headers['Cartesia-Version'], 'every request names the API version');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.voice, { id: 'voice-1' }, 'the prefix is stripped before calling Cartesia');
  assert.equal(body.model_id, 'sonic-3.6');
  assert.equal(body.language, 'hi');
  assert.deepEqual(body.output_format, { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 });
  assert.equal(body.generation_config.speed, 1.5, 'speed is clamped to what Cartesia accepts');

  const last = updates.filter((u) => u.phase === 'voicing').at(-1);
  assert.equal(last.passagesDone, last.passageCount);
  assert.equal(last.charsDone, last.totalChars);
  assert.equal(updates.at(-1).phase, 'joining');
});

test('sync lines are voiced one clip each, in order, with the voice and language', async () => {
  const calls = mockFetch((url, init) => audio(JSON.parse(init.body).transcript.length * 100));
  const done = [];
  const lines = [{ text: 'First line.' }, { text: 'A somewhat longer second line.' }, { text: 'Third.' }];
  const results = await synthesizeLines(
    { voiceId: 'cartesia:voice-1', lines, modelId: 'sonic-3.6', outputFormat: 'pcm_24000', language: 'Hindi', voiceSettings: { speed: 1.1 } },
    { apiKey: 'sk_car_test', onLine: (n) => done.push(n) }
  );

  assert.equal(calls.length, 3);
  assert.deepEqual(results.map((r) => r.buffer.length), lines.map((l) => l.text.length * 100));
  assert.deepEqual(done, [1, 2, 3]);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.voice.id, 'voice-1');
  assert.equal(body.language, 'hi');
  assert.deepEqual(body.output_format, { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 });
  assert.deepEqual(body.generation_config, { speed: 1.1 });
});

test('a synced line is voiced with the same model, emotion and volume as a dub', async () => {
  // What the app sends for a Cartesia voice, plus ElevenLabs fields that must not leak through.
  const delivery = { speed: 0.9, volume: 1.4, emotion: 'calm', stability: 0.3, style: 0.5 };
  assert.deepEqual(cartesiaSettings(delivery), { speed: 0.9, volume: 1.4, emotion: 'calm' });
  assert.equal(cartesiaSettings({ stability: 0.5 }), undefined);
  assert.equal(cartesiaSettings(null), undefined);

  const calls = mockFetch(() => audio());
  await synthesizeScript(
    { voiceId: 'cartesia:v', text: 'Hello there.', modelId: 'sonic-3', outputFormat: 'pcm_16000', voiceSettings: delivery },
    { apiKey: 'sk_car_test' }
  );
  await synthesizeLines(
    { voiceId: 'cartesia:v', lines: [{ text: 'Hello there.' }], modelId: 'sonic-3', outputFormat: 'pcm_16000', voiceSettings: cartesiaSettings(delivery) },
    { apiKey: 'sk_car_test' }
  );
  const [dub, synced] = calls.map((call) => JSON.parse(call.init.body));
  assert.equal(synced.model_id, 'sonic-3');
  assert.deepEqual(synced.generation_config, { speed: 0.9, volume: 1.4, emotion: 'calm' });
  assert.deepEqual(synced, dub, 'the sync and the dub ask Cartesia for exactly the same thing');
});

test('generation_config is only sent to models that take it', async () => {
  const calls = mockFetch(() => audio());
  await synthesizeScript(
    { voiceId: 'cartesia:v', text: 'Hello there.', modelId: 'sonic-2', outputFormat: 'pcm_16000', voiceSettings: { speed: 1.1 } },
    { apiKey: 'sk_car_test' }
  );
  assert.equal(JSON.parse(calls[0].init.body).generation_config, undefined);
});

test('the voice library is paged through and reshaped like the ElevenLabs list', async () => {
  const pages = [
    { data: [{ id: 'b', name: 'Bela', gender: 'feminine', is_owner: false, accents: [{ accent: 'Indian', locale: 'hi-IN', is_native: true }] }], has_more: true, next_page: 'b' },
    { data: [{ id: 'a', name: 'Arjun', gender: 'masculine', is_owner: true, language: 'ta' }], has_more: false },
  ];
  const calls = mockFetch(() => json(pages.shift()));
  const voices = await getVoices({ apiKey: 'sk_car_test' });

  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /starting_after=b/);
  assert.deepEqual(voices.map((v) => v.voice_id), ['cartesia:a', 'cartesia:b'], 'sorted by name, prefixed');
  const bela = voices[1];
  assert.equal(bela.provider, 'cartesia');
  assert.equal(bela.category, 'premade');
  assert.equal(bela.labels.gender, 'female');
  assert.equal(bela.labels.language, 'hi');
  assert.equal(bela.preview_url, '/api/cartesia/voices/b/preview');
  assert.equal(voices[0].category, 'cloned', "the account's own voices count as cloned");
});

test('Natural on Cartesia voices each line with one mild emotion from its source tags, and never speaks the tags', async () => {
  assert.equal(cartesiaEmotionOf('[explaining, calm, slow] नमस्ते।'), 'calm');
  assert.equal(cartesiaEmotionOf('[questioning, rising pitch] क्यों?'), 'curious');
  assert.equal(cartesiaEmotionOf('[sentence-build pause] [reasoning, focused] तो...'), 'contemplative');
  assert.equal(cartesiaEmotionOf('[jovial, dramatic pause] नमस्ते।'), 'neutral');
  assert.equal(cartesiaEmotionOf('नमस्ते।'), 'neutral');

  const calls = mockFetch(() => audio());
  await synthesizeLines(
    {
      voiceId: 'cartesia:v',
      lines: [{ text: '[explaining, calm, slow] नमस्ते।' }, { text: '[questioning] क्यों?' }],
      modelId: 'sonic-3',
      outputFormat: 'pcm_16000',
      voiceSettings: { speed: 1, emotion: 'excited' },
      performanceTags: true,
    },
    { apiKey: 'sk_car_test' }
  );
  await synthesizeScript(
    { voiceId: 'cartesia:v', text: '[meditative, calm] नमस्ते।', modelId: 'sonic-3', outputFormat: 'pcm_16000', performanceTags: true },
    { apiKey: 'sk_car_test' }
  );
  const bodies = calls.map((call) => JSON.parse(call.init.body));
  assert.deepEqual(bodies.map((b) => b.transcript), ['नमस्ते।', 'क्यों?', 'नमस्ते।']);
  assert.deepEqual(bodies.map((b) => b.generation_config.emotion), ['calm', 'curious', 'calm']);
  assert.equal(bodies[0].generation_config.speed, 1);
});
