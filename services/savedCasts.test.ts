import test from 'node:test';
import assert from 'node:assert/strict';
import { applySavedCast, castEntries, type SavedCast } from './savedCasts.ts';
import { castForVoicing, newSpeakerName, ownSettingsOf, renameCast, speakerGenderMatters, speakerGendersOf } from './speakers.ts';

test('a saved cast keeps only speakers with a voice or a profile', () => {
  const entries = castEntries(['Host', 'Anita', 'Raj'], { Host: { voiceId: 'v1' } }, { Anita: { gender: 'woman' }, Raj: {} });
  assert.deepEqual(entries, { Host: { voiceId: 'v1' }, Anita: { profile: { gender: 'woman' } } });
});

test('a saved cast goes onto speakers of the same name only', () => {
  const saved: SavedCast = { name: 'Weekly', savedAt: 1, speakers: { Host: { voiceId: 'v1', profile: { gender: 'man', speed: 0.9 } }, Anita: { profile: { gender: 'woman' } } } };
  const out = applySavedCast(saved, ['Host', 'Anita', 'Speaker 3'], { Anita: { voiceId: 'old' }, 'Speaker 3': { voiceId: 'v3' } }, undefined);
  assert.equal(out.matched, 2);
  assert.deepEqual(out.cast, { Host: { voiceId: 'v1' }, 'Speaker 3': { voiceId: 'v3' } });
  assert.deepEqual(out.speakerProfiles, { Host: { gender: 'man', speed: 0.9 }, Anita: { gender: 'woman' } });
});

test("a speaker's own settings are sent with their voice, or with the main voice", () => {
  assert.equal(ownSettingsOf({ gender: 'woman' }), null);
  assert.deepEqual(ownSettingsOf({ gender: 'man', speed: 0.9, stability: Number.NaN }), { speed: 0.9 });
  const cast = castForVoicing({ Host: { voiceId: 'v1' } }, { Host: { stability: 0.7 }, Anita: { speed: 1.1 }, Raj: { gender: 'man' } }, 'main');
  assert.deepEqual(cast, { Host: { voiceId: 'v1', own: { stability: 0.7 } }, Anita: { voiceId: 'main', own: { speed: 1.1 } } });
  // No own settings: the cast goes as it is.
  const plain = { Host: { voiceId: 'v1' } };
  assert.deepEqual(castForVoicing(plain, { Host: { gender: 'man' } }, 'main'), plain);
});

test('genders, new speaker names and renames', () => {
  assert.equal(speakerGenderMatters('Hindi'), true);
  assert.equal(speakerGenderMatters('Bengali'), false);
  assert.equal(speakerGenderMatters(''), false);
  assert.deepEqual(speakerGendersOf({ A: { gender: 'woman' }, B: { speed: 1 } }), { A: 'woman' });
  assert.equal(speakerGendersOf({ B: { speed: 1 } }), undefined);
  const seg = (speaker: string) => ({ id: speaker, startTime: 0, endTime: 1, speaker }) as never;
  assert.equal(newSpeakerName([seg('Speaker 1'), seg('Speaker 2')]), 'Speaker 3');
  assert.equal(newSpeakerName([seg('Host'), seg('Speaker 3')]), 'Speaker 4');
  assert.deepEqual(renameCast({ 'Speaker 1': { gender: 'woman' } }, 'Speaker 1', 'Anita'), { Anita: { gender: 'woman' } });
});
