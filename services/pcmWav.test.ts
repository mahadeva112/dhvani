import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcmWavLayout } from './audioService.ts';

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
