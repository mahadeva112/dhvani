import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editedSrt, editedVtt, fingerprint, parseStampInput, stamp, subtitlesAsScript } from './subtitleEdits.ts';

test('reads hand-typed times', () => {
  assert.equal(parseStampInput('00:01:02,500'), 62.5);
  assert.equal(parseStampInput('1:02.5'), 62.5);
  assert.equal(parseStampInput('62.5'), 62.5);
  assert.equal(parseStampInput('62'), 62);
  assert.equal(parseStampInput(''), null);
  assert.equal(parseStampInput('1.5:02'), null);
  assert.equal(parseStampInput('abc'), null);
});

test('stamps round to the millisecond', () => {
  assert.equal(stamp(62.5), '00:01:02,500');
  assert.equal(stamp(3725.0004, '.'), '01:02:05.000');
});

test('edited subtitles export in time order, emptied ones left out', () => {
  const cues = [
    { start: 4, end: 6, text: 'second\n line two ' },
    { start: 1, end: 3, text: 'first' },
    { start: 7, end: 8, text: '   ' },
    { start: 9, end: 9, text: 'no length' },
  ];
  assert.equal(editedSrt(cues), '1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n2\n00:00:04,000 --> 00:00:06,000\nsecond\nline two');
  assert.ok(editedVtt(cues).startsWith('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nfirst'));
  const script = subtitlesAsScript(cues);
  assert.deepEqual(script.map((s) => s.textTarget), ['first', 'second line two']);
  assert.equal(script[1].startTime, 4);
});

test('fingerprint tells texts apart', () => {
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
});
