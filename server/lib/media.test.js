import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutputFormat, decodeAudio, encodeAudio, ffmpegAvailable } from './media.js';

const tone = (rate, secondsLong) => {
  const samples = new Float32Array(Math.round(rate * secondsLong));
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / rate);
  return samples;
};

test('ElevenLabs output formats are parsed', () => {
  assert.deepEqual(parseOutputFormat('mp3_44100_128'), { codec: 'mp3', sampleRate: 44100, bitrate: 128 });
  assert.deepEqual(parseOutputFormat('pcm_24000'), { codec: 'pcm', sampleRate: 24000, bitrate: null });
  assert.equal(parseOutputFormat('opus_48000_64'), null);
});

test('16-bit PCM round-trips without ffmpeg', async () => {
  const samples = tone(24000, 0.1);
  const decoded = await decodeAudio(await encodeAudio(samples, 'pcm_24000'), 'pcm_24000');
  assert.equal(decoded.length, samples.length);
  for (let i = 0; i < samples.length; i++) assert.ok(Math.abs(decoded[i] - samples[i]) < 1e-4);
});

test('MP3 round-trips through ffmpeg at the same length', { skip: !(await ffmpegAvailable()) }, async () => {
  const samples = tone(44100, 1);
  const mp3 = await encodeAudio(samples, 'mp3_44100_128');
  assert.equal(mp3.subarray(0, 3).toString('latin1') === 'ID3', false, 'no ID3 tag');
  const decoded = await decodeAudio(mp3, 'mp3_44100_128');
  // The LAME header lets the decoder drop the encoder padding.
  assert.ok(Math.abs(decoded.length - samples.length) < 1200, `decoded ${decoded.length} of ${samples.length}`);
});
