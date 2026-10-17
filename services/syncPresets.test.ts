import test from 'node:test';
import assert from 'node:assert/strict';
import { presetExtras, syncJoinPreset, SYNC_JOIN_PRESETS, SYNC_JOIN_PRESET_OPTIONS, SYNC_SCREEN_OPTIONS, type SyncScreen } from './syncPresets.ts';
import { DEFAULT_JOIN_SETTINGS, JOIN_SETTING_RANGES, resolveJoinSettings } from '../server/lib/syncSettings.js';

const LENGTHS = ['short', 'natural', 'long', 'vlong'] as const;
const SCREENS: SyncScreen[] = ['any', 'narration', 'camera'];

test("the app's Natural is the server's default, setting for setting", () => {
  assert.deepEqual({ ...SYNC_JOIN_PRESETS.natural }, { ...DEFAULT_JOIN_SETTINGS });
});

test('every preset, with every screen, sets only values the server keeps as they are', () => {
  for (const length of LENGTHS) {
    for (const screen of SCREENS) {
      const join = syncJoinPreset(length, screen);
      assert.deepEqual(Object.keys(join).sort(), Object.keys(DEFAULT_JOIN_SETTINGS).sort(), `${length} · ${screen} has every setting`);
      for (const [key, [low, high]] of Object.entries(JOIN_SETTING_RANGES as unknown as Record<string, [number, number]>)) {
        const value = (join as unknown as Record<string, number>)[key];
        assert.ok(value >= low && value <= high, `${length} · ${screen}: ${key} ${value} is outside ${low}-${high}`);
      }
      assert.deepEqual(resolveJoinSettings(join), join, `${length} · ${screen} reaches the server unchanged`);
    }
  }
});

test('the presets run from loosest to tightest, and what is on screen adds to them', () => {
  const [short, natural, long, vlong] = LENGTHS.map((id) => SYNC_JOIN_PRESETS[id]);
  assert.ok(short.chunkGapShare > natural.chunkGapShare && natural.chunkGapShare > long.chunkGapShare && long.chunkGapShare > vlong.chunkGapShare);
  assert.ok(short.stopGap > natural.stopGap && natural.stopGap > long.stopGap && long.stopGap > vlong.stopGap);
  assert.equal(short.speedFit, 'off', 'a short dub is never read faster');
  assert.equal(short.bestTakes, 'off', 'nor voiced again for a better take');
  assert.equal(natural.bestTakes, 'off', 'no line is voiced again unless the user asks');
  assert.equal(natural.speedFit, 'off');
  assert.equal(vlong.bestTakes, 'off', 'not even by a long-dub preset');
  assert.equal(natural.endByVideo, false);
  assert.ok(long.endByVideo && vlong.endByVideo, 'a long dub ends with the original');
  assert.equal(vlong.maxVoiceSpeed, 1.2);

  assert.equal(syncJoinPreset('long', 'narration').preserveLongPauses, true, 'narration starts every paragraph on time');
  assert.ok(syncJoinPreset('long', 'narration').anchorWeight > long.anchorWeight);
  assert.equal(syncJoinPreset('long', 'narration').chunkGapShare, long.chunkGapShare, 'and keeps the length preset');
  assert.equal(presetExtras('camera').timingProtection, 'strict', 'faces on screen hold lines to Strict');
  assert.deepEqual(presetExtras('any'), { timingProtection: 'warn' }, 'no preset turns wording suggestions on');
});

test('the pickers list every preset and every screen', () => {
  assert.deepEqual(SYNC_JOIN_PRESET_OPTIONS.map((p) => p.id), [...LENGTHS, 'custom']);
  assert.deepEqual(SYNC_SCREEN_OPTIONS.map((s) => s.id), SCREENS);
});

test("a synced dub's length against the original picks its preset", async () => {
  const { dubLengthRatio, presetForRatio, presetSuggestion } = await import('./syncPresets.ts');
  const line = (speech: number, from: number, to: number, silent = false) => ({ speech, srcStart: from, srcEnd: to, silent });
  // 10 s of original, 12.5 s of dub: 25% longer.
  assert.equal(dubLengthRatio([line(5, 0, 4), line(7.5, 5, 11)]), 1.25);
  assert.equal(dubLengthRatio([line(3, 0, 3, true)]), null, 'a silent line says nothing');
  assert.deepEqual([0.9, 1, 1.1, 1.25].map(presetForRatio), ['short', 'natural', 'long', 'vlong']);
  assert.deepEqual(presetSuggestion([line(5, 0, 4), line(7.5, 5, 11)]), { preset: 'vlong', change: 0.25 });
  assert.equal(presetSuggestion(null), null);
});
