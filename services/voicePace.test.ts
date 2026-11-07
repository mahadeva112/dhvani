import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_PACE_LINES, paceFrom, paceSamplesOf } from './voicePace.ts';
import { DEFAULT_PAUSES, timeLine } from './speechTiming.ts';
import type { SyncUnitReport } from './syncService.ts';

/** A voiced line: its script, and its words as the voice read them. */
const unit = (text: string, readWords: [string, number, number][], extra: Partial<SyncUnitReport> = {}): SyncUnitReport =>
  ({ voiceId: 'v1', text, readWords, silent: false, cutOff: false, ...extra }) as SyncUnitReport;

// कमल (2 syllables) 0.4 s, नया (2) 0.4 s: 5 syllables a second while speaking.
const LINE = unit('कमल, नया। कमल नया', [
  ['कमल', 0, 0.4],
  ['नया', 0.6, 1.0], // 0.2 s after the comma
  ['कमल', 1.05, 1.45], // 0.05 s after the full stop
  ['नया', 1.5, 1.9], // 0.05 s between two words
]);

test("a voice's pace is read from its words as voiced: syllables while it speaks, and its pauses by the mark before them", () => {
  const sample = paceSamplesOf({ units: [LINE] }).get('v1')!;
  assert.equal(sample.syllables, 8);
  assert.ok(Math.abs(sample.seconds - 1.6) < 1e-9);
  assert.deepEqual([sample.comma, sample.stop, sample.gap], [[0.2], [0.05], [0.05]]);
  const pace = paceFrom(Array.from({ length: MIN_PACE_LINES + 2 }, () => sample))!;
  assert.equal(pace.syllablesPerSecond, 5);
  assert.deepEqual(pace.pauses, { comma: 0.2, stop: 0.05, gap: 0.05 });
  // The line read again at the learned pace takes as long as the voice took.
  assert.ok(Math.abs(timeLine(LINE.text, pace.syllablesPerSecond, pace.pauses).seconds - 1.9) < 1e-9);
});

test('too little said teaches nothing yet, and a pause with too few samples keeps its default', () => {
  const sample = paceSamplesOf({ units: [LINE] }).get('v1')!;
  assert.equal(paceFrom([sample]), null, 'one line is not enough');
  const noComma = { ...sample, comma: [] as number[] };
  assert.equal(paceFrom(Array.from({ length: MIN_PACE_LINES + 2 }, () => noComma))!.pauses.comma, DEFAULT_PAUSES.comma);
});

test("lines that aren't the voice's own read, or whose words aren't the script's, are left out", () => {
  const left = [
    unit(LINE.text, LINE.readWords!, { speedFit: 1.1 }),
    unit(LINE.text, LINE.readWords!, { stretched: 1.2 }),
    unit(LINE.text, LINE.readWords!, { cutOff: true }),
    unit(LINE.text, LINE.readWords!, { takeFit: { kind: 'faster', saved: 0.3, used: true, choice: { seed: 1 } } }),
    unit(LINE.text, LINE.readWords!, { voiceId: undefined }),
    unit('कमल नया और', LINE.readWords!), // a word the voice didn't say
  ];
  assert.equal(paceSamplesOf({ units: left }).size, 0);
  // A gap inside a script word (the voice split it) is no pause of the line's.
  const split = paceSamplesOf({ units: [unit('कमलनया', [['कमल', 0, 0.4], ['नया', 0.5, 0.9]])] }).get('v1')!;
  assert.deepEqual([split.comma, split.stop, split.gap], [[], [], []]);
  assert.equal(split.lines, 1);
});

test('each voice learns only from its own lines', () => {
  const samples = paceSamplesOf({ units: [LINE, unit(LINE.text, LINE.readWords!, { voiceId: 'v2' })] });
  assert.deepEqual([...samples.keys()], ['v1', 'v2']);
  assert.equal(samples.get('v2')!.lines, 1);
});
