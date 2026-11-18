import test from 'node:test';
import assert from 'node:assert/strict';
import type { AudioSegment } from '../types';
import type { Voice } from './elevenLabsService';
import { speakerClipRanges, suggestSpeakerVoices, voiceGender } from './speakerVoice.ts';

const cue = (id: number, speaker: string, startTime: number, endTime: number) =>
  ({ id, speaker, startTime, endTime, duration: endTime - startTime }) as unknown as AudioSegment;

test("a speaker is heard in their longest lines no one talks over, in file order", () => {
  const segments = [
    cue(1, 'Host', 0, 5),
    cue(2, 'Anita', 4, 12), // Host talks over its start
    cue(3, 'Anita', 13, 17),
    cue(4, 'Anita', 18, 18.5), // too short to judge
    cue(5, 'Anita', 20, 26),
    cue(6, 'Host', 27, 30),
  ];
  assert.deepEqual(speakerClipRanges(segments, 'Anita'), [
    { start: 13, end: 17 },
    { start: 20, end: 26 },
  ]);
  // Only talked-over lines: those are used rather than nothing.
  assert.deepEqual(speakerClipRanges([cue(1, 'A', 0, 5), cue(2, 'B', 1, 4)], 'B'), [{ start: 1, end: 4 }]);
  assert.deepEqual(speakerClipRanges([cue(1, 'A', 0, 0.5)], 'A'), []);
});

test('a long speaker is heard for about twelve seconds, never more than twenty', () => {
  const segments = [cue(1, 'A', 0, 30), cue(2, 'A', 31, 40)];
  const ranges = speakerClipRanges(segments, 'A');
  const total = ranges.reduce((sum, r) => sum + r.end - r.start, 0);
  assert.equal(total, 20);
  assert.equal(ranges.length, 1);
});

const voice = (voice_id: string, gender: string | undefined, extra: Partial<Voice> = {}): Voice =>
  ({ voice_id, name: voice_id, category: 'premade', labels: gender ? { gender } : {}, ...extra }) as Voice;

test('voices are read as a man or a woman from their labels only', () => {
  assert.equal(voiceGender(voice('a', 'female')), 'woman');
  assert.equal(voiceGender(voice('b', 'Male')), 'man');
  assert.equal(voiceGender(voice('c', 'neutral')), null);
  assert.equal(voiceGender(voice('d', undefined)), null);
});

test("suggested voices match the gender, skip taken ones, and put the dub language's first", () => {
  const voices = [
    voice('w1', 'female', { labels: { gender: 'female', accent: 'american' } }),
    voice('m1', 'male'),
    voice('w2', 'female', { verified_languages: [{ language: 'hi' }] }),
    voice('w3', 'female', { labels: { gender: 'female', accent: 'indian' } }),
    voice('w4', 'female'),
    voice('wc', 'female', { provider: 'cartesia' }),
  ];
  const ids = (list: Voice[]) => list.map((v) => v.voice_id);
  assert.deepEqual(ids(suggestSpeakerVoices(voices, 'woman', { language: 'Hindi', engine: 'elevenlabs', taken: ['w4'] })), ['w2', 'w3', 'w1']);
  assert.deepEqual(ids(suggestSpeakerVoices(voices, 'man', { language: 'Hindi', engine: 'elevenlabs', taken: [] })), ['m1']);
  assert.deepEqual(ids(suggestSpeakerVoices(voices, 'woman', { language: 'Hindi', engine: 'cartesia', taken: [] })), ['wc']);
  assert.deepEqual(ids(suggestSpeakerVoices(voices, 'woman', { language: 'French', engine: 'elevenlabs', taken: [], count: 2 })), ['w1', 'w2']);
});
