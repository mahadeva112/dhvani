import test from 'node:test';
import assert from 'node:assert/strict';
import { fitJoinSettings, quantile } from './syncFit.js';
import { DEFAULT_JOIN_SETTINGS } from './syncSettings.js';

/** A cue of `words` one-second words, each pair `wordGap` apart. */
const cue = (id, startTime, text, { speaker = 'A', words = 2, wordGap = 0.1, wordLength = 0.4 } = {}) => {
  const timed = Array.from({ length: words }, (_, n) => {
    const start = startTime + n * (wordLength + wordGap);
    return { text: `w${n}`, start, end: start + wordLength };
  });
  return { id, startTime, endTime: timed[timed.length - 1].end, speaker, textTarget: text, words: timed };
};

/** `count` cues of one speaker, `pause` apart; each spoken for 0.9 s. */
const run = (count, pause, options = {}) => {
  const cues = [];
  let t = 0;
  for (let n = 0; n < count; n++) {
    const c = cue(n + 1, t, options.text ?? 'x'.repeat(9), options);
    cues.push(c);
    t = c.endTime + pause;
  }
  return cues;
};

test('quantile reads between neighbours', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 10], 0.2), 2);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

test('too few cues propose nothing and say why', () => {
  const fit = fitJoinSettings({ segments: [cue(1, 0, 'one')], charsPerSecond: 10 });
  assert.deepEqual(fit.changes, []);
  assert.deepEqual(fit.join, { ...DEFAULT_JOIN_SETTINGS });
  assert.ok(fit.note);
});

test('a slow speaker with long pauses gets wider gaps and groups across longer mid-phrase pauses', () => {
  // Mid-phrase pauses of 0.4 s, 1.2 s between lines; 9 characters at 10 chars/s = 0.9 s, as long as the original.
  const fit = fitJoinSettings({ segments: run(10, 1.2, { wordGap: 0.4, wordLength: 0.25 }), charsPerSecond: 10, rateMeasured: true });
  const to = Object.fromEntries(fit.changes.map((c) => [c.key, c.to]));
  assert.equal(to.unitGap, 0.45);
  assert.equal(to.minGap, 0.3);
  assert.equal(to.flagJoin, 0.2);
  assert.equal(fit.join.minGap, 0.3);
  assert.equal(fit.note, null);
  assert.ok(fit.changes.every((c) => c.reason));
});

test('a quick speaker gets a shorter minimum gap', () => {
  const fit = fitJoinSettings({ segments: run(10, 0.25), charsPerSecond: 10 });
  assert.equal(fit.join.minGap, 0.15);
  assert.equal(fit.join.flagJoin, 0.13);
});

test('handovers set the gap at a speaker change, never below the minimum gap', () => {
  const segments = run(8, 0.5).map((c, n) => ({ ...c, speaker: n % 2 ? 'B' : 'A' }));
  const fit = fitJoinSettings({ segments, charsPerSecond: 10 });
  assert.equal(fit.join.speakerGap, 0.3);
  assert.equal(fit.measured.handovers, 7);
});

test('a dub that runs long may take more of a pause, and lends long pauses to the line before', () => {
  // 15 characters at 10 chars/s = 1.5 s against 0.9 s spoken.
  const fit = fitJoinSettings({ segments: run(10, 0.6, { text: 'x'.repeat(15) }), charsPerSecond: 10 });
  assert.equal(fit.join.maxPauseTake, 0.6);
  assert.equal(fit.join.gapShare, 0.25);
  assert.match(fit.changes.find((c) => c.key === 'maxPauseTake').reason, /67% longer.*typical speaking rate/);
});

test('a dub that runs short keeps more of each pause', () => {
  const fit = fitJoinSettings({ segments: run(10, 0.6, { text: 'x'.repeat(6) }), charsPerSecond: 10, rateMeasured: true });
  assert.equal(fit.join.gapShare, 0.4);
  assert.doesNotMatch(fit.changes.find((c) => c.key === 'gapShare').reason, /typical/);
});

test('the user’s own settings stay wherever nothing is proposed, and audio settings are never touched', () => {
  const current = { ...DEFAULT_JOIN_SETTINGS, tailFloorDb: -80, edgeFade: 0.02, spliceCrossfade: 0.005, removeBreaths: false };
  const fit = fitJoinSettings({ segments: run(10, 1.2), join: current, charsPerSecond: 10 });
  for (const key of ['tailFloorDb', 'edgeFade', 'spliceCrossfade', 'removeBreaths', 'breathClear', 'tailHold', 'maxLateStart', 'maxUnit']) {
    assert.equal(fit.join[key], current[key], key);
  }
  assert.ok(fit.changes.every((c) => c.from !== c.to));
});
