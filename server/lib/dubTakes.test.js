import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentText, cueSpans, cutDubTakes, quietestPoint } from './dubTakes.js';
import { runSync, clearClipCache } from './syncDub.js';

const RATE = 8000;

/** A dub: `parts` of [seconds, level], each a stretch of sine (level > 0) or silence. */
const dub = (parts) => {
  const total = parts.reduce((sum, [seconds]) => sum + seconds, 0);
  const samples = new Float32Array(Math.round(total * RATE));
  let at = 0;
  for (const [seconds, level] of parts) {
    const n = Math.round(seconds * RATE);
    for (let i = at; i < at + n; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
    at += n;
  }
  return samples;
};

test('alignmentText gives the words the dub says, without tags', () => {
  assert.equal(alignmentText([{ id: 1, text: '[calm] আমি এলাম।' }, { id: 2, text: ' তুমি?' }]), 'আমি এলাম। তুমি?');
});

test('cueSpans gives each cue the time of its words, whatever the punctuation', () => {
  const cues = [
    { id: 1, text: 'আমি আজ সকালে,' },
    { id: 2, text: 'বাজারে গিয়েছিলাম।' },
  ];
  const words = [
    { text: 'আমি', start: 0.1, end: 0.3 },
    { text: 'আজ', start: 0.35, end: 0.5 },
    { text: 'সকালে', start: 0.55, end: 0.9 },
    { text: 'বাজারে', start: 1.2, end: 1.5 },
    { text: 'গিয়েছিলাম।', start: 1.55, end: 2.1 },
  ];
  const spans = cueSpans(words, cues);
  assert.deepEqual(spans.get('1'), { start: 0.1, end: 0.9 });
  assert.deepEqual(spans.get('2'), { start: 1.2, end: 2.1 });
});

test('cueSpans refuses words that are not the script', () => {
  const cues = [{ id: 1, text: 'one two' }];
  assert.equal(cueSpans([{ text: 'one', start: 0, end: 1 }, { text: 'three', start: 1, end: 2 }], cues), null);
  assert.equal(cueSpans([{ text: 'one', start: 0, end: 1 }], cues), null, 'words left over in the script');
});

test('quietestPoint lands inside the silence between two words', () => {
  const samples = dub([[1, 0.3], [0.3, 0], [1, 0.3]]);
  const at = quietestPoint(samples, 0.8 * RATE, 1.5 * RATE, 80);
  assert.ok(at > 1 * RATE && at < 1.3 * RATE, `cut at ${at / RATE} s`);
});

test('cutDubTakes cuts each line in the pause around it, and leaves a changed line to be voiced', () => {
  const samples = dub([[0.2, 0], [1, 0.3], [0.4, 0], [1, 0.3], [0.4, 0], [1, 0.3], [0.2, 0]]);
  const spans = new Map([
    ['1', { start: 0.22, end: 1.18 }],
    ['2', { start: 1.62, end: 2.58 }],
    ['3', { start: 3.02, end: 3.98 }],
  ]);
  const units = [{ cueIds: [1] }, { cueIds: [2] }, { cueIds: [3] }];
  const takes = cutDubTakes({ units, spans, usable: (id) => id !== '3', samples, sampleRate: RATE });
  assert.equal(takes[2], null, 'a changed line is voiced again');
  const seconds = (take) => take.length / RATE;
  // The first line runs from before the dub (a first line reaches back at most 0.5 s) into the pause after it.
  assert.ok(seconds(takes[0]) > 1.2 && seconds(takes[0]) < 1.6, `first take ${seconds(takes[0])} s`);
  // The second takes all of its words, and no sound of its neighbours.
  const second = takes[1];
  assert.ok(seconds(second) > 1 && seconds(second) < 1.8, `second take ${seconds(second)} s`);
  assert.ok(Math.abs(second[0]) < 1e-6 && Math.abs(second[second.length - 1]) < 1e-6, 'cut inside silence on both sides');
});

/** A fake voice as in syncDub.test.js: 0.08 s a character, 0.15 s of silence either side. */
const fakeVoice = () => {
  const voiced = [];
  return {
    voiced,
    voiceLines: async (lines, { onLine }) =>
      lines.map((line, n) => {
        voiced.push(line.text);
        onLine(n + 1);
        return dub([[0.15, 0], [line.text.replace(/[.।]$/u, '').length * 0.08, 0.3], [0.15, 0]]);
      }),
  };
};

test('a sync takes the lines the dub has and voices only the rest', async () => {
  clearClipCache();
  const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, textTarget: text, textSource: `src ${id}` });
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa.'), cue(2, 4, 5, 'bbbbbbbbbb.'), cue(3, 7, 8, 'cccccccccc.')];
  const { voiced, voiceLines } = fakeVoice();
  const dubbed = dub([[0.1, 0], [0.8, 0.3], [0.1, 0]]);
  const { report } = await runSync(
    { segments, sourceDuration: 10, sampleRate: RATE, voice: { voiceId: 'v', modelId: 'm', outputFormat: 'pcm_8000' }, lineSeeds: { 3: 99 } },
    {
      voiceLines,
      dubTakes: async (units) => units.map((unit) => (unit.cueIds[0] === 2 ? null : dubbed)),
      decode: async (samples) => samples,
      encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
    }
  );
  // Line 2 isn't in the dub, and line 3 was asked to be retaken.
  assert.deepEqual(voiced, ['bbbbbbbbbb.', 'cccccccccc.']);
  assert.deepEqual(report.units.map((unit) => unit.fromDub), [true, false, false]);
  assert.equal(report.summary.fromDub, 1);
});
