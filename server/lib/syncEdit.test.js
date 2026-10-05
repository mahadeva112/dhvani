import test from 'node:test';
import assert from 'node:assert/strict';
import { runSync, clearClipCache } from './syncDub.js';
import { checkParts, lineArrays, renderEdits } from './syncEdit.js';
import { applyCuts, shortenPauses } from './syncRender.js';
import { encodeAudio } from './media.js';
import { pcmToWav, floatToWav, parseWav } from './wav.js';

const RATE = 8000;

const cue = (id, startTime, endTime, text, extra = {}) => ({ id, startTime, endTime, duration: endTime - startTime, textTarget: text, textSource: `src ${id}`, ...extra });

/** Silence, then a tone `chars` × 0.08 s long (with a pause in the middle when asked), then silence. */
const voiced = (text, { level = 0.3, gap = 0 } = {}) => {
  const tone = text.length * 0.08;
  const lead = 0.15;
  const samples = new Float32Array(Math.round((lead + tone + gap + 0.15) * RATE));
  const write = (from, seconds) => {
    const a = Math.round(from * RATE);
    const b = a + Math.round(seconds * RATE);
    for (let i = a; i < b; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
  };
  if (gap > 0) {
    write(lead, tone / 2);
    write(lead + tone / 2 + gap, tone / 2);
  } else write(lead, tone);
  return samples;
};

const deps = (takes = {}) => ({
  voiceLines: async (lines, { onLine }) =>
    lines.map((line, n) => {
      onLine(n + 1);
      return takes[line.text] ? takes[line.text]() : voiced(line.text);
    }),
  decode: async (samples) => samples,
  encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength))), contentType: 'audio/test' }),
});

const asFloat = (buffer) => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

const voice = { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' };

const SEGMENTS = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbbbb'), cue(3, 7, 8, 'cccccccccc')];

/** Every bank line as one part, where the sync put it: no edits at all. */
const asSynced = (bank) => bank.lines.map((line, n) => ({ line: n, from: 0, to: line.length, startSample: line.startSample, rate: 1, gainDb: 0, fadeIn: 0, fadeOut: 0 }));

const render = async (bank, parts, options = {}) =>
  (await renderEdits({ bank, arrays: lineArrays(bank), parts: checkParts(parts, bank), sourceDuration: 10, ...options })).track;

const sync = async (params = {}, takes) => {
  clearClipCache();
  return runSync({ segments: SEGMENTS, sourceDuration: 10, sampleRate: RATE, voice, ...params }, deps(takes));
};

test('the bank holds every placed line, and rendering it with no edits is the synced dub, sample for sample', async () => {
  const { buffer, bank } = await sync();
  assert.equal(bank.lines.length, 3);
  assert.deepEqual(bank.lines.map((line) => line.key), ['1', '2', '3']);
  for (const line of bank.lines) {
    assert.ok(line.length > 0 && line.bankStart + line.length <= bank.samples.length);
    assert.match(line.hash, /^[0-9a-f]{40}$/);
    assert.equal(line.gain, 1, 'no gain unless loudness matching was asked for');
  }
  assert.deepEqual(await render(bank, asSynced(bank)), asFloat(buffer));
});

test('with loudness matching on, the bank carries each line its gain and the render still matches', async () => {
  const takes = { aaaaaaaaaa: () => voiced('aaaaaaaaaa', { level: 0.05 }) };
  const { buffer, bank } = await sync({ matchLoudness: true }, takes);
  assert.ok(bank.lines[0].gain > 1, 'the quiet line is brought up');
  assert.deepEqual(await render(bank, asSynced(bank)), asFloat(buffer));
});

test('a line split in two and played straight through is the line as it was', async () => {
  const { bank } = await sync();
  const whole = await render(bank, asSynced(bank));
  const parts = asSynced(bank);
  const [first] = parts.splice(1, 1);
  const cut = Math.round(first.to * 0.4);
  parts.push({ ...first, to: cut }, { ...first, from: cut, startSample: first.startSample + cut });
  assert.deepEqual(await render(bank, parts), whole);
});

test('a moved line sounds exactly as it did; only its place changes, and the others are untouched', async () => {
  const { bank } = await sync();
  const before = await render(bank, asSynced(bank));
  const parts = asSynced(bank);
  const shift = Math.round(0.3 * RATE);
  parts[1] = { ...parts[1], startSample: parts[1].startSample + shift };
  const after = await render(bank, parts);
  const line = bank.lines[1];
  const original = before.subarray(line.startSample, line.startSample + line.length);
  assert.deepEqual(after.subarray(line.startSample + shift, line.startSample + shift + line.length), original);
  const first = bank.lines[0];
  assert.deepEqual(after.subarray(first.startSample, first.startSample + first.length), before.subarray(first.startSample, first.startSample + first.length));
});

test('a trim plays fewer of the same samples, and a trim inside silence changes nothing else', async () => {
  const { bank } = await sync();
  const before = await render(bank, asSynced(bank));
  const parts = asSynced(bank);
  // Half the silence the line keeps before its first word.
  const trim = Math.floor((bank.lines[0].lead * RATE) / 2);
  assert.ok(trim > 0);
  parts[0] = { ...parts[0], from: trim, startSample: parts[0].startSample + trim };
  const after = await render(bank, parts);
  assert.deepEqual(after, before, 'trimming silence leaves the dub as it was');

  const into = asSynced(bank);
  const words = Math.round(bank.lines[2].lead * RATE) + Math.round(0.2 * RATE);
  into[2] = { ...into[2], to: words };
  const cutShort = await render(bank, into);
  const line = bank.lines[2];
  assert.ok(cutShort.subarray(line.startSample + words + 64, line.startSample + line.length).every((s) => s === 0), 'nothing plays after the trim');
});

test('gain and fades change only the part they were set on', async () => {
  const { bank } = await sync();
  const before = await render(bank, asSynced(bank));
  const parts = asSynced(bank);
  parts[1] = { ...parts[1], gainDb: -6, fadeIn: 0.05, fadeOut: 0.05 };
  const after = await render(bank, parts);
  const line = bank.lines[1];
  const mid = line.startSample + Math.round(line.lead * RATE) + Math.round(0.3 * RATE);
  assert.ok(Math.abs(after[mid] - before[mid] * 10 ** (-6 / 20)) < 1e-6, 'turned down by 6 dB');
  assert.equal(after[line.startSample], 0, 'the fade starts from silence');
  for (const other of [bank.lines[0], bank.lines[2]]) {
    assert.deepEqual(after.subarray(other.startSample, other.startSample + other.length), before.subarray(other.startSample, other.startSample + other.length));
  }
});

test('a stretched part is played through the stretch, at its own place, and only it', async () => {
  const { bank } = await sync();
  const parts = asSynced(bank);
  parts[0] = { ...parts[0], rate: 1.25 };
  const calls = [];
  const stretch = async (samples, rate) => {
    calls.push(rate);
    return samples.subarray(0, Math.round(samples.length / rate));
  };
  const result = await renderEdits({ bank, arrays: lineArrays(bank), parts: checkParts(parts, bank), sourceDuration: 10 }, { stretch });
  assert.deepEqual(calls, [1.25]);
  assert.ok(result.track.length > 0);
  await assert.rejects(renderEdits({ bank, arrays: lineArrays(bank), parts: checkParts(parts, bank) }), /ffmpeg/);
});

test('parts outside their line, before 0:00 or naming no line are refused', async () => {
  const { bank } = await sync();
  const length = bank.lines[0].length;
  assert.throws(() => checkParts([{ line: 9, from: 0, to: 10, startSample: 0 }], bank), /no line/);
  assert.throws(() => checkParts([{ line: 0, from: 0, to: length + 1, startSample: 0 }], bank), /outside/);
  assert.throws(() => checkParts([{ line: 0, from: 5, to: 5, startSample: 0 }], bank), /outside/);
  assert.throws(() => checkParts([{ line: 0, from: 0, to: 10, startSample: -1 }], bank), /before 0:00/);
  assert.equal(checkParts([{ line: 0, from: 0, to: 10, startSample: 0, rate: 9 }], bank)[0].rate, 2, 'a speed is kept in range');
});

test('a locked line stays where the user put it in the next sync, and its neighbours are placed around it', async () => {
  const first = await sync();
  const line = first.bank.lines[1];
  const start = line.startSample / RATE + 0.4;
  const lock = { hash: line.hash, cuts: line.cuts, crossfade: line.crossfade, start, end: start + line.length / RATE };
  const second = await sync({ locked: { 2: lock } });
  const kept = second.bank.lines[1];
  assert.equal(kept.locked, true);
  assert.equal(kept.hash, line.hash);
  assert.equal(kept.length, line.length, 'the same samples, so the edits on it still fit');
  assert.ok(Math.abs(kept.startSample / RATE - start) < 1e-3, `held at ${start}, got ${kept.startSample / RATE}`);
  assert.ok(second.bank.lines[0].startSample + second.bank.lines[0].length <= kept.startSample, 'the line before ends before it');
});

test('a locked line voiced differently this time is placed as usual', async () => {
  const first = await sync();
  const line = first.bank.lines[1];
  const lock = { hash: 'not-this-take', cuts: [], crossfade: 0, start: 6, end: 6 + line.length / RATE };
  const second = await sync({ locked: { 2: lock } });
  assert.equal(second.bank.lines[1].locked, false);
  assert.equal(second.bank.lines[1].startSample, line.startSample);
});

test('a locked line is cut again exactly as the sync it was edited on cut it', async () => {
  const samples = voiced('x'.repeat(20), { gap: 1 });
  const { samples: shortened, cuts } = shortenPauses(samples, RATE, 0.5, { crossfade: 0.01 });
  assert.ok(cuts.length > 0);
  assert.deepEqual(applyCuts(samples, cuts, Math.round(0.01 * RATE)), shortened);
});

test('a dub with several speakers renders from its bank as it was mixed', async () => {
  clearClipCache();
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa', { speaker: 'A' }), cue(2, 4, 5, 'bbbbbbbbbb', { speaker: 'B' })];
  const takes = { aaaaaaaaaa: () => voiced('aaaaaaaaaa', { level: 0.1 }) };
  const { buffer, bank, report } = await runSync(
    { segments, sourceDuration: 7, sampleRate: RATE, voice, multiSpeaker: true, voiceFor: () => voice, matchLoudness: true },
    deps(takes)
  );
  assert.ok(Object.keys(bank.speakerGains).length === 2);
  const result = await renderEdits({ bank, arrays: lineArrays(bank), parts: checkParts(asSynced(bank), bank), sourceDuration: 7, multiSpeaker: true });
  assert.deepEqual(result.track, asFloat(buffer));
  assert.deepEqual(result.report.gains, report.mix.gains);
});

test('a bank written as 16-bit or float WAV reads back as written', async () => {
  const samples = new Float32Array([0, 0.5, -0.5, 0.999, -1, 0.123456]);
  const pcm = parseWav(pcmToWav(await encodeAudio(samples, 'pcm_8000'), { sampleRate: 8000 }));
  assert.equal(pcm.sampleRate, 8000);
  assert.equal(pcm.float, false);
  pcm.samples.forEach((value, i) => assert.equal(value, Math.round(samples[i] * 32768) / 32768));
  const float = parseWav(floatToWav(samples, { sampleRate: 8000 }));
  assert.equal(float.float, true);
  assert.deepEqual(float.samples, samples);
  assert.throws(() => parseWav(Buffer.from('nope')), /Not a WAV/);
});
