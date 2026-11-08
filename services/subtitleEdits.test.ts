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

import {
  isEditedSubtitle,
  measuredWordsFor,
  mergeSubtitles,
  splitSubtitle,
  subtitleStats,
  wordsBeforeCaret,
  wrapSubtitle,
} from './subtitleEdits.ts';
import { wrapBalanced } from './subtitleCues.ts';

const limits = { maxChars: 42, maxLines: 2, maxCps: 20 };

test('wraps the way Srutilekha does', () => {
  // Expected lines from Srutilekha's transcribe.wrap on the same text.
  assert.equal(wrapBalanced('आज हम ध्यान के बारे में बात करेंगे,', 42, 2), 'आज हम\nध्यान के बारे में बात करेंगे,');
  assert.equal(
    wrapBalanced('जो हर इंसान के जीवन का एक बहुत ज़रूरी हिस्सा है और जिसे हम अक्सर भूल जाते हैं।', 42, 2),
    'जो हर इंसान के जीवन का एक बहुत\nज़रूरी हिस्सा है और जिसे हम अक्सर भूल जाते हैं।'
  );
  assert.equal(wrapBalanced('देखिए,', 42, 2), 'देखिए,');
  assert.equal(wrapBalanced('तो शायद पाँच दिन टिकेंगे।', 32, 1), 'तो शायद पाँच दिन टिकेंगे।');
});

test('counts the words before the caret', () => {
  assert.equal(wordsBeforeCaret('one two three', 0), 0);
  assert.equal(wordsBeforeCaret('one two three', 4), 1);
  assert.equal(wordsBeforeCaret('one two\nthree', 8), 2);
  assert.equal(wordsBeforeCaret('one two three', 5), 2); // inside "two": it stays on the left
});

const cue = { start: 10, end: 13, text: 'one two\nthree four', auto: 'one two\nthree four' };
const words = [
  { start: 10, end: 10.5 },
  { start: 10.6, end: 11 },
  { start: 11.6, end: 12.2 },
  { start: 12.3, end: 12.9 },
];

test('a split lands where the next word is said', () => {
  const r = splitSubtitle(cue, 2, limits, words)!;
  assert.equal(r.estimated, false);
  assert.equal(r.second.start, 11.6);
  assert.equal(r.second.end, 13);
  // A short silence is bridged so the captions don't flicker.
  assert.ok(Math.abs(r.first.end - 11.599) < 1e-9);
  assert.equal(r.first.text, 'one two');
  assert.equal(r.second.text, 'three four');
  assert.ok(Math.abs(r.pause - 0.6) < 1e-9);
  assert.equal(r.lastWord, 'two');
  assert.equal(isEditedSubtitle(r.first), true);
});

test('a split with no measured words is estimated and says so', () => {
  const r = splitSubtitle(cue, 1, limits, [])!;
  assert.equal(r.estimated, true);
  assert.equal(r.first.estimated, true);
  assert.ok(r.first.end < r.second.start && r.second.start > 10 && r.second.start < 13);
  assert.equal(splitSubtitle(cue, 0, limits, words), null);
  assert.equal(splitSubtitle(cue, 4, limits, words), null);
});

test('measured words count only when there is one per word', () => {
  assert.equal(measuredWordsFor(cue, words.slice(0, 3)), null);
  assert.equal(measuredWordsFor(cue, words)?.length, 4);
});

test('merge takes in the next subtitle and wraps again', () => {
  const m = mergeSubtitles({ start: 1, end: 2, text: 'देखिए,' }, { start: 2.1, end: 4, text: 'जब आप शांत बैठते हैं,\nमन अपने आप' }, limits);
  assert.equal(m.start, 1);
  assert.equal(m.end, 4);
  assert.equal(m.text, wrapBalanced('देखिए, जब आप शांत बैठते हैं, मन अपने आप', 42, 2));
  assert.equal(wrapSubtitle({ start: 0, end: 1, text: 'a\nb\nc' }, { ...limits, maxLines: 1 }).text, 'a b c');
});

test('stats flag fast, tall and wide subtitles', () => {
  const s = subtitleStats({ start: 0, end: 1, text: 'one two\nthree\nfour' }, limits);
  assert.deepEqual(s.lineChars, [7, 5, 4]);
  assert.equal(s.overLines, true);
  assert.equal(s.overCps, false);
  assert.equal(subtitleStats({ start: 0, end: 0.5, text: 'a fairly long line of words' }, limits).overCps, true);
  assert.equal(subtitleStats({ start: 0, end: 9, text: 'x'.repeat(43) }, limits).longLine, true);
  assert.equal(isEditedSubtitle({ start: 0, end: 1, text: 'a', auto: 'a' }), false);
});
