import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedQuality, fallbackNotice, voiceInAllowedQuality } from './dubAudioQuality.ts';

const refusal = () => Object.assign(new Error('not on this plan'), { code: 'output_format_not_allowed' });

test('a plan that refuses WAV 48 kHz is asked for MP3 192 kbps, then 128', async () => {
  const asked: string[] = [];
  const refused: string[] = [];
  const { result, format } = await voiceInAllowedQuality(
    'pcm_48000',
    new Set(),
    async (f) => {
      asked.push(f);
      if (f !== 'mp3_44100_128') throw refusal();
      return 'dub';
    },
    (f) => refused.push(f)
  );
  assert.equal(result, 'dub');
  assert.equal(format, 'mp3_44100_128');
  assert.deepEqual(asked, ['pcm_48000', 'mp3_44100_192', 'mp3_44100_128']);
  assert.deepEqual(refused, ['pcm_48000', 'mp3_44100_192']);
});

test('a format already refused is not asked for again', async () => {
  const asked: string[] = [];
  await voiceInAllowedQuality('pcm_48000', new Set(['pcm_48000']), async (f) => (asked.push(f), 'dub'), () => {});
  assert.deepEqual(asked, ['mp3_44100_192']);
  assert.equal(allowedQuality('pcm_48000', new Set(['pcm_48000', 'mp3_44100_192'])), 'mp3_44100_128');
});

test('other errors are not taken for a refused format', async () => {
  await assert.rejects(
    voiceInAllowedQuality('pcm_48000', new Set(), async () => { throw Object.assign(new Error('bad key'), { code: 'invalid_api_key' }); }, () => {}),
    /bad key/
  );
});

test('the notice says why only when the dub came out lower', () => {
  assert.equal(fallbackNotice('pcm_48000', 'pcm_48000'), null);
  assert.match(fallbackNotice('pcm_48000', 'mp3_44100_192') || '', /plan doesn't include WAV · 48 kHz.*Pro plan/);
});
