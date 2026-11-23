import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinReads, speakerReadPlan } from './speakerReads.ts';
import { pcmWavLayout } from './audioService.ts';
import type { AudioSegment } from '../types';

const wav = (samples: number[], { rate = 48000, float = false, channels = 1, list = false } = {}) => {
  const bytes = float ? 4 : 2;
  const extra = list ? 12 : 0;
  const b = new ArrayBuffer(44 + extra + samples.length * bytes);
  const v = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, b.byteLength - 8, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * bytes * channels, true); v.setUint16(32, bytes * channels, true); v.setUint16(34, bytes * 8, true);
  let at = 36;
  if (list) { w(at, 'LIST'); v.setUint32(at + 4, 4, true); w(at + 8, 'INFO'); at += 12; }
  w(at, 'data'); v.setUint32(at + 4, samples.length * bytes, true);
  samples.forEach((s, i) => (float ? v.setFloat32(at + 8 + i * 4, s, true) : v.setInt16(at + 8 + i * 2, s, true)));
  return new Blob([b]);
};

const samplesOf = async (blob: Blob) => {
  const buf = await blob.arrayBuffer();
  const layout = pcmWavLayout(buf, buf.byteLength)!;
  const v = new DataView(buf);
  return {
    layout,
    samples: Array.from({ length: layout.frames }, (_, i) => (layout.float ? v.getFloat32(layout.offset + i * 4, true) : v.getInt16(layout.offset + i * 2, true))),
  };
};

test('joins takes in order with silence between, samples untouched', async () => {
  const joined = await joinReads([wav([1, 2, 3], { rate: 4 }), wav([4, 5], { rate: 4, list: true }), wav([-6], { rate: 4 })], 0.5);
  assert.ok(joined);
  const { layout, samples } = await samplesOf(joined!);
  assert.equal(layout.sampleRate, 4);
  assert.equal(layout.float, false);
  assert.deepEqual(samples, [1, 2, 3, 0, 0, 4, 5, 0, 0, -6]);
});

test('keeps float takes as float', async () => {
  const joined = await joinReads([wav([0.25], { float: true, rate: 2 }), wav([-1.5], { float: true, rate: 2 })], 1);
  const { layout, samples } = await samplesOf(joined!);
  assert.equal(layout.float, true);
  assert.deepEqual(samples, [0.25, 0, 0, -1.5]);
});

test('refuses takes it would have to change', async () => {
  assert.equal(await joinReads([wav([1], { rate: 48000 }), wav([1], { rate: 44100 })]), null);
  assert.equal(await joinReads([wav([1]), wav([1], { float: true })]), null);
  assert.equal(await joinReads([wav([1, 1], { channels: 2 })]), null);
  assert.equal(await joinReads([wav([1]), new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])])]), null);
  assert.equal(await joinReads([]), null);
});

const seg = (id: number, speaker: string | undefined, textTarget: string): AudioSegment =>
  ({ id, startTime: id, endTime: id + 1, duration: 1, textSource: '', textTarget, speaker }) as AudioSegment;

test('plans one read per speaker, in the order each first speaks', () => {
  const plan = speakerReadPlan([seg(1, 'B', 'one'), seg(2, 'A', 'two'), seg(3, 'B', 'three'), seg(4, 'A', '  '), seg(5, 'A', 'five')]);
  assert.deepEqual(
    plan.map((p) => [p.speaker, p.segments.map((s) => s.id)]),
    [['B', [1, 3]], ['A', [2, 5]]]
  );
});
