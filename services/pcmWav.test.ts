import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcmWavLayout, readStreamedAudio, wavSamples } from './audioService.ts';
import { detailPeaks, peakRange } from './waveform.ts';

const wav = ({ format = 1, bits = 16, channels = 1, rate = 48000, frames = 10, list = false, dataSize }: { format?: number; bits?: number; channels?: number; rate?: number; frames?: number; list?: boolean; dataSize?: number }) => {
  const align = channels * (bits / 8);
  const extra = list ? 12 : 0;
  const b = new ArrayBuffer(44 + extra + frames * align);
  const v = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, b.byteLength - 8, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, format, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * align, true);
  v.setUint16(32, align, true); v.setUint16(34, bits, true);
  let at = 36;
  if (list) { w(at, 'LIST'); v.setUint32(at + 4, 4, true); w(at + 8, 'INFO'); at += 12; }
  w(at, 'data'); v.setUint32(at + 4, dataSize ?? frames * align, true);
  return b;
};

test('a plain PCM WAV is read for where its samples are', () => {
  assert.deepEqual(pcmWavLayout(wav({}), 64), { offset: 44, frames: 10, channels: 1, sampleRate: 48000, float: false });
  assert.deepEqual(pcmWavLayout(wav({ format: 3, bits: 32, channels: 2, rate: 44100, list: true }), 136), { offset: 56, frames: 10, channels: 2, sampleRate: 44100, float: true });
});

test('a data size never filled in is bounded by the file', () => {
  assert.equal(pcmWavLayout(wav({ dataSize: 0xffffffff }), 64)?.frames, 10);
});

test('anything but 16-bit or 32-bit float PCM goes to the browser decoder', () => {
  assert.equal(pcmWavLayout(wav({ bits: 24 }), 74), null);
  assert.equal(pcmWavLayout(wav({ format: 0xfffe }), 64), null);
  assert.equal(pcmWavLayout(new TextEncoder().encode('ID3 not a wav at all').buffer as ArrayBuffer, 20), null);
});

/** A 16-bit WAV with `samples` (interleaved), as a Blob. */
const wavBlob = (samples: Int16Array, channels: number, rate = 48000) => {
  const head = wav({ channels, rate, frames: samples.length / channels });
  const bytes = new Uint8Array(head);
  bytes.set(new Uint8Array(samples.buffer), 44);
  return new Blob([bytes]);
};

test('a stretch read from the file is the samples the whole file decodes to, channel by channel', async () => {
  const frames = 5000;
  const pcm = new Int16Array(frames * 2).map((_, i) => ((i * 7919) % 65536) - 32768);
  const blob = wavBlob(pcm, 2);
  const layout = pcmWavLayout(await blob.slice(0, 1024).arrayBuffer(), blob.size)!;
  const source = wavSamples(blob, layout);
  assert.equal(source.length, frames);
  const [left, right] = await source.read(1234, 1300);
  assert.equal(left.length, 66);
  for (let i = 0; i < 66; i++) {
    const l = pcm[(1234 + i) * 2];
    const r = pcm[(1234 + i) * 2 + 1];
    assert.equal(left[i], Math.fround(l * (l < 0 ? Math.fround(1 / 32768) : Math.fround(1 / 32767))));
    assert.equal(right[i], Math.fround(r * (r < 0 ? Math.fround(1 / 32768) : Math.fround(1 / 32767))));
  }
  // Past the end it stops at the end.
  const [tail] = await source.read(4990, 6000);
  assert.equal(tail.length, 10);
});

test('streamed audio reads its peaks and, zoomed in, its samples from the file', async () => {
  const frames = 48000;
  const pcm = new Int16Array(frames).map((_, i) => Math.round(Math.sin(i / 9) * 10000));
  pcm[30000] = 32000;
  const audio = await readStreamedAudio(wavBlob(pcm, 1));
  assert.equal(audio.duration, 1);
  assert.equal(audio.peaks.data, null);
  assert.ok(Math.abs((peakRange(audio.peaks, 0, frames)?.hi ?? 0) - 32000 / 32767) < 1e-3);
  const detail = await detailPeaks(audio, 0.6, 0.7);
  assert.ok(detail?.data);
  assert.equal(detail.start, 28800 / 48000);
  assert.equal(detail.data.length, 4800);
  assert.ok(Math.abs(detail.data[30000 - 28800] - 32000 / 32767) < 1e-6);
});
