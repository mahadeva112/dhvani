import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipName, davinciTracks, isTimecode, lineNote } from './davinciExport.ts';

const unit = (over: Record<string, unknown>) =>
  ({
    index: 0,
    key: 'c1',
    cueIds: ['c1'],
    text: 'नमस्ते',
    sourceText: 'Hello',
    srcStart: 0,
    srcEnd: 1,
    placedStart: 1,
    placedEnd: 2,
    offset: 0,
    overrun: null,
    inSync: true,
    silent: false,
    exceeded: false,
    exceededBy: 0,
    short: false,
    shortBy: 0,
    speech: 1,
    targetChars: null,
    suggestion: null,
    pauseTrimmed: 0,
    late: false,
    joinAfter: null,
    tightJoin: false,
    ...over,
  }) as any;

const wav = new Blob(['RIFF'], { type: 'audio/wav' });

test('timecodes are checked against the frame rate', () => {
  assert.equal(isTimecode('01:00:00:00', '25'), true);
  assert.equal(isTimecode('01:00:00:24', '24'), false);
  assert.equal(isTimecode('01:00:00:29', '29.97'), true);
  assert.equal(isTimecode('1 hour', '25'), false);
});

test('only lines the Dub page flags get a marker note', () => {
  assert.equal(lineNote(unit({})), null);
  assert.equal(lineNote(unit({ index: 4, exceeded: true, exceededBy: 0.42 })), 'Line 5: too long by 0.4 s');
  assert.equal(lineNote(unit({ inSync: false, offset: 0.31 })), 'Line 1: late by 0.3 s');
  assert.equal(lineNote(unit({ silent: true })), 'Line 1: came back silent');
});

test('clip names are the line number and its first words, without tags', () => {
  assert.equal(clipName(unit({ index: 11, text: '[sighs] नमस्ते   दोस्तों' })), '12 नमस्ते दोस्तों');
  assert.equal(clipName(unit({ text: '' })), 'Line 1');
});

test('one track per speaker reads each stem; lines go to their own speaker', () => {
  const report = {
    units: [
      unit({ index: 0, speaker: 'Asha', placedStart: 1, placedEnd: 2 }),
      unit({ index: 1, speaker: 'Ravi', placedStart: 3, placedEnd: 4 }),
      unit({ index: 2, speaker: 'Asha', placedStart: null, placedEnd: null, silent: true }),
    ],
  };
  const { tracks, perSpeakerPossible } = davinciTracks({
    report,
    dub: wav,
    stems: [
      { speaker: 'Asha', blob: wav },
      { speaker: 'Ravi: guest', blob: wav },
      { speaker: 'Ravi', blob: wav },
    ],
    fileStem: 'Talk',
    perSpeaker: true,
  });
  assert.equal(perSpeakerPossible, true);
  assert.deepEqual(
    tracks.map((t) => [t.name, t.fileName, t.lines.length]),
    [
      ['Asha', 'Talk - Asha.wav', 1],
      ['Ravi', 'Talk - Ravi.wav', 1],
    ]
  );
});

test('a line whose speaker has no stem puts everything on one dub track', () => {
  const report = { units: [unit({ speaker: 'Asha' }), unit({ index: 1, speaker: null, placedStart: 3, placedEnd: 4 })] };
  const { tracks, perSpeakerPossible } = davinciTracks({ report, dub: wav, stems: [{ speaker: 'Asha', blob: wav }, { speaker: 'Ravi', blob: wav }], fileStem: 'Talk', perSpeaker: true });
  assert.equal(perSpeakerPossible, false);
  assert.deepEqual(tracks.map((t) => [t.fileName, t.lines.length]), [['Talk - dub.wav', 2]]);
});
