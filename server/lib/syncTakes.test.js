import test from 'node:test';
import assert from 'node:assert/strict';
import { directedSettings, fitTake, phraseCut, splicePhrase, takeGain } from './syncTakes.js';
import { resolveJoinSettings } from './syncSettings.js';
import { speechLoudness } from './loudness.js';
import { prepareClip } from './syncRender.js';
import { runSync, clearClipCache, clipHash } from './syncDub.js';

const RATE = 8000;

/** Silence, then bursts of a sine `tone` s long with `gap` s of silence between them, then silence. */
const burst = ({ lead = 0.2, tones = [0.5], gap = 0.3, tail = 0.2, level = 0.3 } = {}) => {
  const total = lead + tones.reduce((sum, t) => sum + t, 0) + gap * (tones.length - 1) + tail;
  const samples = new Float32Array(Math.round(total * RATE));
  const spans = [];
  let at = lead;
  for (const tone of tones) {
    const a = Math.round(at * RATE);
    const b = a + Math.round(tone * RATE);
    for (let i = a; i < b; i++) samples[i] = level * Math.sin((2 * Math.PI * 220 * i) / RATE);
    spans.push({ start: at, end: at + tone });
    at += tone + gap;
  }
  return { samples, spans };
};

test('a direction changes only how the voice is asked to read, within what each engine takes', () => {
  const settings = { stability: 0.5, similarity_boost: 0.75, style: 0.1, speed: 1 };
  assert.equal(directedSettings(settings, 'same', 'elevenlabs'), settings);
  assert.equal(directedSettings(settings, 'faster', 'elevenlabs').speed, 1.08);
  assert.equal(directedSettings(settings, 'slower', 'elevenlabs').speed, 0.92);
  assert.equal(directedSettings({ ...settings, speed: 1.18 }, 'faster', 'elevenlabs').speed, 1.2, 'ElevenLabs takes at most 1.2');
  const calmer = directedSettings(settings, 'calmer', 'elevenlabs');
  assert.ok(calmer.stability > settings.stability && calmer.style < settings.style);
  const livelier = directedSettings(settings, 'energy', 'elevenlabs');
  assert.ok(livelier.stability < settings.stability && livelier.style > settings.style);
  assert.equal(livelier.similarity_boost, 0.75, 'what the direction is not about is kept');
  assert.equal(directedSettings({ speed: 1 }, 'calmer', 'cartesia').emotion, 'calm');
  assert.equal(directedSettings(undefined, 'faster', 'cartesia').speed, 1.08);
});

test('a phrase retake keeps every sample of the line around the phrase as it was', () => {
  const join = resolveJoinSettings({ removeBreaths: false });
  const { samples: line, spans } = burst({ tones: [0.4, 0.5, 0.4] });
  const cut = phraseCut(line, new Map([['before', spans[0]], ['phrase', spans[1]], ['after', spans[2]]]), RATE);
  assert.ok(cut, 'the phrase is found');
  assert.ok(cut.from > spans[0].end * RATE && cut.from < spans[1].start * RATE, 'the first join is in the pause before the phrase');
  assert.ok(cut.to > spans[1].end * RATE && cut.to < spans[2].start * RATE, 'the second join is in the pause after it');

  const reading = fitTake(burst({ tones: [0.7], level: 0.2 }).samples, RATE, join);
  const take = splicePhrase(line, cut, reading, RATE, join);
  const start = prepareClip(line, RATE).start;
  for (let i = start; i < cut.from; i++) assert.equal(take.samples[i - start], line[i], `sample ${i} before the phrase is untouched`);
  const at = cut.from - start;
  for (let k = 0; k < reading.samples.length; k++) assert.equal(take.samples[at + k], reading.samples[k], `the new reading's sample ${k}`);
  const lastWord = Math.round(spans[2].end * RATE);
  for (let i = cut.to; i < lastWord; i++) {
    assert.equal(take.samples[at + reading.samples.length + i - cut.to], line[i], `sample ${i} after the phrase is untouched`);
  }
  assert.ok(take.speech > fitTake(line, RATE, join).speech, 'the longer reading makes the line longer');
});

test('a phrase at the start or end of a line keeps the rest', () => {
  const { samples: line, spans } = burst({ tones: [0.4, 0.5] });
  const atStart = phraseCut(line, new Map([['phrase', spans[0]], ['after', spans[1]]]), RATE);
  assert.equal(atStart.from, 0);
  assert.ok(atStart.to < spans[1].start * RATE);
  const atEnd = phraseCut(line, new Map([['before', spans[0]], ['phrase', spans[1]]]), RATE);
  assert.equal(atEnd.to, line.length);
  assert.equal(phraseCut(line, new Map([['before', spans[0]]]), RATE), null, 'no phrase, nothing to cut');
});

test('a new take of a loudness-matched line is brought to the level the line had', () => {
  const line = burst({ level: 0.2 }).samples;
  const loud = burst({ level: 0.4 }).samples;
  const gain = takeGain(loud, line, 1.2, RATE);
  const matched = speechLoudness(loud, RATE) * gain;
  assert.ok(Math.abs(matched - speechLoudness(line, RATE) * 1.2) < 1e-3, `matched at ${matched}`);
  assert.equal(takeGain(loud, new Float32Array(100), 1, RATE), 1, 'a silent line has no level to match');
});

test('Sync keeps a picked take exactly as it was, unless the line is retaken', async () => {
  clearClipCache();
  const cue = (id, startTime, endTime, text) => ({ id, startTime, endTime, textTarget: text, textSource: `src ${id}` });
  const segments = [cue(1, 1, 2, 'aaaaaaaaaa'), cue(2, 4, 5, 'bbbbbbbbbb')];
  const voiced = [];
  const deps = {
    voiceLines: async (lines) =>
      lines.map((line) => {
        voiced.push(line.text);
        return burst({ lead: 0.15, tones: [0.8], tail: 0.15 }).samples;
      }),
    decode: async (samples) => samples,
    encode: async (samples) => ({ buffer: Buffer.from(new Uint8Array(samples.buffer)), contentType: 'audio/test' }),
  };
  const pickedSamples = burst({ lead: 0.05, tones: [0.6], tail: 0.1, level: 0.25 }).samples;
  const pickedTakes = (units) => units.map((unit) => (unit.cueIds[0] === 2 ? { samples: pickedSamples, lead: 0.05, speech: 0.6, cutOff: false } : null));

  const { report, bank } = await runSync({ segments, sourceDuration: 6, sampleRate: RATE, voice: { voiceId: 'v' } }, { ...deps, pickedTakes });
  assert.deepEqual(voiced, ['aaaaaaaaaa.'], 'the picked line is not voiced again');
  const line = bank.lines.find((l) => l.key === '2');
  assert.equal(line.hash, clipHash(pickedSamples));
  assert.deepEqual(Array.from(bank.samples.subarray(line.bankStart, line.bankStart + line.length)), Array.from(pickedSamples));
  assert.equal(report.units[1].picked, true);
  assert.equal(report.units[1].fromDub, false);
  assert.equal(report.summary.picked, 1);

  voiced.length = 0;
  const retaken = await runSync(
    { segments, sourceDuration: 6, sampleRate: RATE, voice: { voiceId: 'v' }, lineSeeds: { 2: 7 } },
    { ...deps, pickedTakes }
  );
  assert.ok(voiced.includes('bbbbbbbbbb.'), 'a line asked to be retaken is voiced again');
  assert.equal(retaken.report.units[1].picked, false);
});
