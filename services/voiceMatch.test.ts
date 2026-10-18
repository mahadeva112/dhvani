import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVoices, mergeSuggestions, profileSpeakers, scoreCues, type MonoAudio } from './voiceMatch.ts';

const RATE = 16000;

/** A made-up voice: a pitch with harmonics shaped by two formants, a little noise, and a loudness. */
const voice = (seconds: number, { pitch, f1, f2, gain }: { pitch: number; f1: number; f2: number; gain: number }, seed: number) => {
  const out = new Float32Array(Math.floor(seconds * RATE));
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 4.5 * t);
    let v = 0;
    for (let h = 1; h * pitch < 5000; h += 1) {
      const f = h * pitch * vibrato;
      const shape = 1 / (1 + ((f - f1) / 180) ** 2) + 0.7 / (1 + ((f - f2) / 250) ** 2);
      v += (shape / h ** 0.5) * Math.sin(2 * Math.PI * f * t);
    }
    out[i] = gain * (0.12 * v + 0.01 * rand());
  }
  return out;
};

const FEMALE = { pitch: 210, f1: 850, f2: 2400 };
const DEEP = { pitch: 110, f1: 500, f2: 1500 };

/** Audio laid out as cues one after another, each in its own voice: [speaker, seconds, voice]. */
const build = (cues: [string, number, { pitch: number; f1: number; f2: number; gain: number }][]) => {
  const parts: Float32Array[] = [];
  const segments = [];
  let at = 0;
  cues.forEach(([speaker, seconds, v], i) => {
    parts.push(voice(seconds, v, i + 1), new Float32Array(Math.floor(0.3 * RATE)));
    segments.push({ id: String(i), speaker, startTime: at, endTime: at + seconds } as never);
    at += seconds + 0.3;
  });
  const data = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    data.set(p, offset);
    offset += p.length;
  }
  const audio: MonoAudio = { sampleRate: RATE, getChannelData: () => data };
  return { audio, segments };
};

test('one voice under two labels is offered as a merge, and a different voice is not', async () => {
  const same = { ...DEEP, gain: 1 };
  const softer = { ...DEEP, gain: 0.35, pitch: 100 };
  const other = { ...FEMALE, gain: 1 };
  const { audio, segments } = build([
    ['Sadhguru', 4, same], ['Interviewer', 4, other], ['Sadhguru', 4, same], ['Interviewer', 4, other],
    ['Speaker 3', 4, softer], ['Sadhguru', 4, same], ['Speaker 3', 4, softer], ['Interviewer', 4, other],
  ]);
  const profiles = await profileSpeakers(audio, segments);
  const matches = compareVoices(profiles, segments);
  const pair = (a: string, b: string) => matches.find((m) => [m.from, m.into].sort().join() === [a, b].sort().join());
  assert.ok((pair('Sadhguru', 'Speaker 3')?.match ?? 0) > (pair('Interviewer', 'Speaker 3')?.match ?? 100), 'the same voice scores above a different one');
  const suggested = mergeSuggestions(matches);
  assert.deepEqual(suggested.map((m) => [m.from, m.into]), [['Speaker 3', 'Sadhguru']]);
});

test('two people who are different are not offered, however the cues fall', async () => {
  const { audio, segments } = build([
    ['A', 4, { ...DEEP, gain: 1 }], ['B', 4, { ...FEMALE, gain: 1 }], ['A', 4, { ...DEEP, gain: 1 }], ['B', 4, { ...FEMALE, gain: 1 }],
  ]);
  const matches = compareVoices(await profileSpeakers(audio, segments), segments);
  assert.deepEqual(mergeSuggestions(matches), []);
});

test('labels that talk over each other are two people', async () => {
  const same = { ...DEEP, gain: 1 };
  const { audio, segments } = build([['A', 4, same], ['B', 4, same], ['A', 4, same], ['B', 4, same]]);
  // Put B's cues on top of A's.
  segments.forEach((seg: any, i) => {
    if (seg.speaker === 'B') {
      seg.startTime = segments[i - 1].startTime;
      seg.endTime = segments[i - 1].endTime;
    }
  });
  assert.deepEqual(compareVoices(await profileSpeakers(audio, segments), segments), []);
});

test('a speaker with a few seconds of speech is not compared at all', async () => {
  const same = { ...DEEP, gain: 1 };
  const { audio, segments } = build([['A', 4, same], ['A', 4, same], ['A', 4, same], ['B', 1, same]]);
  assert.deepEqual(compareVoices(await profileSpeakers(audio, segments), segments), []);
});

test('a cue in the other speaker voice is flagged, and the cues that fit their label are not', async () => {
  const deep = { ...DEEP, gain: 1 };
  const other = { ...FEMALE, gain: 1 };
  const { audio, segments } = build([
    ['S', 4, deep], ['I', 4, other], ['S', 4, deep], ['I', 4, other], ['S', 4, deep],
    ['S', 3, other], // labelled S, but it is I's voice
    ['I', 4, other], ['S', 4, deep],
  ]);
  const profiles = await profileSpeakers(audio, segments);
  const cues = await scoreCues(audio, segments, profiles);
  const flagged = [...cues].filter(([, v]) => v.suggested).map(([id, v]) => [id, v.suggested]);
  assert.deepEqual(flagged, [['5', 'I']]);
  assert.ok((cues.get('0')?.match ?? 0) > (cues.get('5')?.match ?? 100));
});
