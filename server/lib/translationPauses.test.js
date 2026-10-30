import test from 'node:test';
import assert from 'node:assert/strict';
import { cuePauses, partSyllables, readPausedLine, withoutSplits } from './translationPauses.js';

const words = (...timed) => timed.map(([text, start, end]) => ({ text, start, end }));

test("a cue is cut where its speaker went quiet for 0.3 s or more, and nowhere else", () => {
  const cue = {
    text: 'So — you sit, and it comes.',
    words: words(['So', 0, 0.3], ['you', 0.7, 0.9], ['sit,', 0.9, 1.3], ['and', 1.5, 1.6], ['it', 1.6, 1.7], ['comes.', 2.1, 2.6]),
  };
  const split = cuePauses(cue);
  // A dash on its own stays with the word before it; 0.2 s is a breath, not a pause.
  assert.deepEqual(split.parts.map((part) => part.text), ['So —', 'you sit, and it', 'comes.']);
  assert.deepEqual(split.pauses.map((p) => Math.round(p * 10) / 10), [0.4, 0.4]);
  assert.deepEqual(split.parts.map((part) => Math.round(part.talk * 10) / 10), [0.3, 1, 0.5]);
});

test('a cue with no pause, no timestamps or a text edited since is not cut', () => {
  assert.equal(cuePauses({ text: 'One go.', words: words(['One', 0, 0.3], ['go.', 0.35, 0.7]) }), null);
  assert.equal(cuePauses({ text: 'No timings here.' }), null);
  // The user changed the words: they no longer match the timestamps.
  assert.equal(cuePauses({ text: 'One more go.', words: words(['One', 0, 0.3], ['go.', 1, 1.4]) }), null);
});

test('each piece gets its share of the syllables by how long it was said', () => {
  assert.deepEqual(partSyllables([{ talk: 1 }, { talk: 3 }], 12), [3, 9]);
  assert.deepEqual(partSyllables([{ talk: 0.05 }, { talk: 4 }], 10), [1, 10]);
});

test('a line keeps its pause marks only when it has one for each pause', () => {
  assert.deepEqual(readPausedLine('তারপর ‖ বুঝলাম।', [0.64]), { text: 'তারপর বুঝলাম।', paused: 'তারপর [pause 0.6s] বুঝলাম।' });
  // Long pauses are kept up to what a pause mark allows.
  assert.equal(readPausedLine('এক ‖ দুই', [3]).paused, 'এক [pause 2.0s] দুই');
  assert.deepEqual(readPausedLine('তারপর বুঝলাম।', [0.5]), { text: 'তারপর বুঝলাম।', paused: null });
  assert.deepEqual(readPausedLine('‖ তারপর বুঝলাম।', [0.5]), { text: 'তারপর বুঝলাম।', paused: null });
  assert.deepEqual(readPausedLine('এক ‖ দুই ‖ তিন', [0.5]), { text: 'এক দুই তিন', paused: null });
  // A line with nothing to keep is left exactly as it came.
  assert.deepEqual(readPausedLine('তারপর বুঝলাম ।', []), { text: 'তারপর বুঝলাম ।', paused: null });
  assert.equal(withoutSplits('এক ‖, দুই'), 'এক, দুই');
});

test("Sync voices a translated line with its speaker's pauses, between its cues too, until the line is edited", async () => {
  const { buildSyncUnits } = await import('./syncUnits.js');
  const cues = [
    { id: '1', startTime: 0, endTime: 2, speaker: 'A', textTarget: 'আর তারপর আমি', pausedTarget: 'আর তারপর [pause 0.5s] আমি' },
    // 0.7 s later, in the same sentence: one line, and the voice waits there too.
    { id: '2', startTime: 2.7, endTime: 4, speaker: 'A', textTarget: 'বসে বুঝলাম।', pausedTarget: 'বসে বুঝলাম।' },
    // After a sentence end the voice stops by itself: no mark is added.
    { id: '3', startTime: 4.35, endTime: 5, speaker: 'A', textTarget: 'সত্যি।', pausedTarget: 'সত্যি।' },
  ];
  const [unit] = buildSyncUnits(cues);
  assert.equal(unit.text, 'আর তারপর আমি বসে বুঝলাম। সত্যি।');
  assert.equal(unit.voiceText, 'আর তারপর [pause 0.5s] আমি [pause 0.7s] বসে বুঝলাম। সত্যি।');
  assert.equal(unit.last, undefined);

  // The user edited the first line: it is voiced as typed, and no pause is added after it.
  const edited = buildSyncUnits([{ ...cues[0], textTarget: 'তারপর আমি' }, cues[1]]);
  assert.equal(edited[0].voiceText, 'তারপর আমি বসে বুঝলাম।');

  // A line read with source-matched tags (Natural) keeps its tags and gets no marks.
  const tagged = buildSyncUnits([{ ...cues[0], voiceText: '[calm] আর তারপর আমি' }, cues[1]]);
  assert.equal(tagged[0].voiceText, '[calm] আর তারপর আমি বসে বুঝলাম।');

  // A project translated before pauses were kept is voiced as it always was.
  const old = buildSyncUnits(cues.map(({ pausedTarget, ...cue }) => cue));
  assert.equal(old[0].voiceText, old[0].text);
});
