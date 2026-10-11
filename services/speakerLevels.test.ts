import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeakerLevels, silencedSpeakers, withSpeakerLevels } from './speakerLevels.ts';
import { liveClips } from './liveDubEngine.ts';
import type { SyncBank } from './syncEditService';

const line = (key: string, speaker: string, startSample: number) => ({
  key, speaker, bankStart: 0, length: 1000, startSample, lead: 0, speech: 1, gain: 1, hash: 'h', cuts: [], crossfade: 0, dropped: 0, locked: false,
});
const bank: SyncBank = { bankId: 'b', sampleRate: 1000, float: true, speakerGains: { Asha: 0.5 }, lines: [line('a', 'Asha', 0), line('r', 'Ravi', 2000)] };

test("a speaker's level goes on top of the gain the sync matched them at, and 0 dB changes nothing", () => {
  const leveled = withSpeakerLevels(bank, { Asha: 6, Ravi: -6, Mohan: 0 });
  assert.ok(Math.abs(leveled.speakerGains.Asha - 0.5 * 10 ** (6 / 20)) < 1e-9);
  assert.ok(Math.abs(leveled.speakerGains.Ravi - 10 ** (-6 / 20)) < 1e-9);
  assert.equal('Mohan' in leveled.speakerGains, false);
  assert.equal(withSpeakerLevels(bank, { Asha: 0 }), bank);
  assert.deepEqual(cleanSpeakerLevels({ Asha: 40, Ravi: Number.NaN, Mohan: 0 }), { Asha: 12 });
});

test('a muted speaker, or one left out by a solo, is not heard', () => {
  assert.deepEqual([...silencedSpeakers(['Asha', 'Ravi', 'Mohan'], { Ravi: { muted: true, solo: false } })], ['Ravi']);
  assert.deepEqual([...silencedSpeakers(['Asha', 'Ravi', 'Mohan'], { Asha: { muted: false, solo: true }, Mohan: { muted: false, solo: true } })], ['Ravi']);
  assert.deepEqual([...silencedSpeakers(['Asha'], {})], []);
});

test('the live dub leaves out silenced speakers and plays a new level at once', () => {
  const all = liveClips(withSpeakerLevels(bank, {}), null, true);
  const louder = liveClips(withSpeakerLevels(bank, { Ravi: 6 }), null, true);
  assert.equal(all.length, 2);
  assert.notEqual(all[1].id, louder[1].id);
  assert.equal(all[0].id, louder[0].id);
  assert.deepEqual(liveClips(bank, null, true, [], new Set(['Ravi'])).map((clip) => clip.start), [0]);
});
